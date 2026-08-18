import { useCallback, useMemo, useState } from "react";
import {
  FlatList, Modal, Pressable,
  RefreshControl, StyleSheet, Text, TextInput, View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, AuctionDay, DriverRange, Patti } from "@/src/api";
import { useWorkingDate } from "@/src/context/WorkingDateContext";
import { Button, Empty, Input } from "@/src/components/ui";
import { colors, font, money, spacing } from "@/src/theme";
import { DatePickerModal } from "@/src/components/DatePickerModal";

export default function Auction() {
  const router = useRouter();
  const { workingDate, workingDateISO, displayDate, isWorkingToday, setWorkingDate } = useWorkingDate();

  const [day, setDay] = useState<AuctionDay | null>(null);
  const [pattis, setPattis] = useState<Patti[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [showDriverModal, setShowDriverModal] = useState(false);
  const [drivers, setDrivers] = useState<DriverRange[]>([]);
  const [saveDriverError, setSaveDriverError] = useState<string | null>(null);
  const [savingDrivers, setSavingDrivers] = useState(false);

  const load = useCallback(async (iso?: string) => {
    const dateISO = iso || workingDateISO;
    try {
      setLoading(true);
      const d = await api.get<AuctionDay>(`/auction-days/today?date=${dateISO}`);
      setDay(d);
      const ps = await api.get<Patti[]>(`/pattis?date=${dateISO}`);
      setPattis(ps);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [workingDateISO]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onApplyDate = (d: Date | null) => {
    setShowDatePicker(false);
    if (!d) return;
    setWorkingDate(d);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    load(`${yyyy}-${mm}-${dd}`);
  };

  const openDriverModal = () => {
    setDrivers(day?.drivers?.length ? [...day.drivers] : [{ range_from: 1, range_to: 100, name: "", place: "", bhada_per_bag: 0 }]);
    setSaveDriverError(null);
    setShowDriverModal(true);
  };
  const setDriverField = (idx: number, patch: Partial<DriverRange>) =>
    setDrivers((xs) => xs.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  const addDriverRow = () => setDrivers((xs) => [...xs, { range_from: 1, range_to: 1, name: "", place: "", bhada_per_bag: 0 }]);
  const removeDriverRow = (idx: number) => setDrivers((xs) => xs.filter((_, i) => i !== idx));

  const saveDrivers = async () => {
    setSaveDriverError(null);
    for (const d of drivers) {
      if (!d.name.trim()) { setSaveDriverError("Every driver needs a name"); return; }
      if (!(d.range_from >= 1) || !(d.range_to >= d.range_from)) { setSaveDriverError(`Range invalid for ${d.name || "driver"}`); return; }
      if (d.bhada_per_bag < 0) { setSaveDriverError("Bhada cannot be negative"); return; }
    }
    const sorted = [...drivers].sort((a, b) => a.range_from - b.range_from);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].range_from <= sorted[i - 1].range_to) {
        setSaveDriverError(`Ranges overlap between ${sorted[i - 1].name} and ${sorted[i].name}`); return;
      }
    }
    if (!day) return;
    try {
      setSavingDrivers(true);
      const updated = await api.put<AuctionDay>(`/auction-days/${day.id}`, { date: day.date, drivers });
      setDay(updated);
      setShowDriverModal(false);
      await load();
    } catch (e: any) {
      setSaveDriverError(e?.detail || "Failed to save");
    } finally { setSavingDrivers(false); }
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return pattis;
    return pattis.filter((p) => {
      const lotNos = (p.lots || []).map((l) => (l.lot_no || "").toLowerCase()).join(" ");
      return (
        p.farmer_name.toLowerCase().includes(s) ||
        String(p.patti_no).includes(s) ||
        `pt-${String(p.patti_no).padStart(6, "0")}`.includes(s) ||
        (p.driver_name || "").toLowerCase().includes(s) ||
        (p.receiver_name || "").toLowerCase().includes(s) ||
        lotNos.includes(s)
      );
    });
  }, [pattis, q]);

  const stats = useMemo(() => {
    const farmerIds = new Set(pattis.map((p) => p.farmer_id));
    const bagCount = pattis.reduce((s, p) => s + (p.total_bags || 0), 0);
    return {
      pattis: pattis.length,
      farmers: farmerIds.size,
      bags: bagCount,
      drivers: day?.drivers?.length ?? 0,
    };
  }, [pattis, day]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>AUCTION BOOK</Text>
          <Pressable
            onPress={() => setShowDatePicker(true)}
            style={styles.dateTap}
            testID="auction-date-picker"
          >
            <Text style={styles.subtitle}>
              {isWorkingToday ? `${workingDateISO} · Today's Pattis` : `${workingDateISO} · ${displayDate}`}
            </Text>
            <Ionicons name="calendar-outline" size={14} color={colors.onSurface} />
          </Pressable>
        </View>
        <Pressable style={styles.headerBtn} onPress={openDriverModal} testID="edit-drivers">
          <Ionicons name="car-outline" size={16} color={colors.onSurface} />
          <Text style={styles.headerBtnText}>DRIVERS</Text>
        </Pressable>
      </View>

      {showDatePicker ? (
        <DatePickerModal
          visible={showDatePicker}
          value={workingDate}
          onCancel={() => setShowDatePicker(false)}
          onApply={onApplyDate}
          title="AUCTION BOOK DATE"
          maximumDate={new Date(2100, 11, 31)}
        />
      ) : null}

      <View style={styles.statsRow}>
        <Stat label="PATTIS" value={String(stats.pattis)} />
        <Stat label="FARMERS" value={String(stats.farmers)} />
        <Stat label="BAGS" value={String(stats.bags)} />
        <Stat label="DRIVERS" value={String(stats.drivers)} />
      </View>

      {stats.drivers === 0 ? (
        <View style={styles.warnBox}>
          <Ionicons name="warning-outline" size={16} color={colors.warning} />
          <Text style={styles.warnText}>Set up drivers first (top-right) — driver + bhada auto-fills per lot.</Text>
        </View>
      ) : null}

      <View style={styles.actionsRow}>
        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color={colors.muted} />
          <TextInput
            value={q} onChangeText={setQ}
            placeholder="Search patti, farmer, driver, lot…"
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            autoCapitalize="none"
            testID="auction-search"
          />
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.sm }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={
          loading ? null : (
            <Empty
              title={isWorkingToday ? "No Pattis today yet" : `No Pattis on ${displayDate}`}
              subtitle="Create Pattis via Create Action Diary (Scan or Manual Entry)."
              testID="auction-empty"
            />
          )
        }
        renderItem={({ item }) => {
          const isPrinted = !!item.printed;
          return (
          <Pressable
            testID={`patti-row-${item.id}`}
            onPress={() => router.push({ pathname: "/edit-patti", params: { id: item.id } })}
            style={({ pressed }) => [
              styles.pattiRow,
              isPrinted && styles.pattiRowPrinted,
              pressed && { opacity: 0.9 },
            ]}
          >
            {isPrinted ? (
              <View style={styles.printedBanner} testID={`patti-printed-${item.id}`}>
                <Text style={styles.printedBannerText}>PRINTED</Text>
              </View>
            ) : null}
            <View style={styles.pattiRowBody}>
              <View style={styles.numBox}><Text style={styles.numText}>#{item.patti_no}</Text></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={styles.farmerName} numberOfLines={1}>{item.farmer_name}</Text>
                  {item.status === "received" ? (
                    <View style={[styles.statusChip, { backgroundColor: colors.brandSecondary, borderColor: colors.brandPrimary }]}>
                      <Text style={[styles.statusText, { color: colors.onBrandSecondary }]}>✓ RECEIVED</Text>
                    </View>
                  ) : (
                    <View style={styles.statusChip}>
                      <Text style={styles.statusText}>⧗ PENDING</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.meta} numberOfLines={1}>
                  Lot {(item.lots || []).map((l) => l.lot_no).join(", ")}
                  {" · "}{item.total_bags} bag{item.total_bags === 1 ? "" : "s"}
                  {item.driver_name ? ` · ${item.driver_name}` : ""}
                </Text>
                <Text style={styles.receiver} numberOfLines={1}>Receiver: {item.receiver_name || "—"}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.net}>{money(item.net_payable)}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.muted} />
              </View>
            </View>
          </Pressable>
          );
        }}
      />

      {/* Driver Setup Modal */}
      <Modal visible={showDriverModal} transparent animationType="slide" onRequestClose={() => setShowDriverModal(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setShowDriverModal(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>DRIVER DAY SETUP</Text>
              <Pressable onPress={() => setShowDriverModal(false)} hitSlop={12} testID="driver-modal-close">
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <KeyboardAwareScrollView
              style={{ maxHeight: 500 }}
              contentContainerStyle={{ padding: spacing.lg }}
              keyboardShouldPersistTaps="handled"
              bottomOffset={80}
            >
              <Text style={styles.hint}>
                Lot numbers are matched by their first number (before &quot;/&quot;). e.g. Lot 35/2 → driver whose range covers 35.
              </Text>
              {drivers.map((d, idx) => (
                <View key={idx} style={styles.driverEditCard} testID={`driver-card-${idx}`}>
                  <View style={styles.driverEditHeader}>
                    <Text style={styles.driverEditTitle}>DRIVER {idx + 1}</Text>
                    {drivers.length > 1 ? (
                      <Pressable onPress={() => removeDriverRow(idx)} hitSlop={8} testID={`driver-remove-${idx}`}>
                        <Ionicons name="trash-outline" size={18} color={colors.error} />
                      </Pressable>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <Input style={{ flex: 1 }} label="Range from" keyboardType="number-pad"
                      value={String(d.range_from || "")} onChangeText={(t) => setDriverField(idx, { range_from: parseInt(t || "0", 10) })}
                      testID={`driver-from-${idx}`} />
                    <Input style={{ flex: 1 }} label="Range to" keyboardType="number-pad"
                      value={String(d.range_to || "")} onChangeText={(t) => setDriverField(idx, { range_to: parseInt(t || "0", 10) })}
                      testID={`driver-to-${idx}`} />
                  </View>
                  <Input label="Driver name" value={d.name} onChangeText={(t) => setDriverField(idx, { name: t })} testID={`driver-name-${idx}`} />
                  <Input label="Place (optional)" value={d.place || ""} onChangeText={(t) => setDriverField(idx, { place: t })} testID={`driver-place-${idx}`} />
                  <Input label="Lot Bhada ₹" keyboardType="decimal-pad"
                    value={String(d.bhada_per_bag || "")}
                    onChangeText={(t) => setDriverField(idx, { bhada_per_bag: Number(t || "0") })}
                    hint="Circled diary amount for the whole lot (not × bags)"
                    testID={`driver-bhada-${idx}`} />
                </View>
              ))}
              <Pressable style={styles.addDriverBtn} onPress={addDriverRow} testID="driver-add-row">
                <Ionicons name="add-circle-outline" size={20} color={colors.brandPrimary} />
                <Text style={styles.addDriverText}>ADD ANOTHER DRIVER RANGE</Text>
              </Pressable>
              {saveDriverError ? <Text style={styles.err}>{saveDriverError}</Text> : null}
              <View style={{ marginTop: spacing.md }}>
                <Button label={savingDrivers ? "SAVING…" : "SAVE DRIVER SETUP"} onPress={saveDrivers} loading={savingDrivers} testID="driver-save" />
              </View>
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
    flexDirection: "row", alignItems: "flex-end", gap: spacing.md,
  },
  title: { fontSize: 22, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: colors.muted, fontFamily: font.mono, fontWeight: "700" },
  dateTap: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2, alignSelf: "flex-start" },
  headerBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 12, paddingVertical: 8,
  },
  headerBtnText: { color: colors.onSurface, fontFamily: font.display, fontWeight: "800", letterSpacing: 1, fontSize: 12 },

  statsRow: {
    flexDirection: "row", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
  },
  stat: { flex: 1, borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.sm, alignItems: "center", minHeight: 60, justifyContent: "center" },
  statValue: { fontFamily: font.mono, fontWeight: "900", fontSize: 20, color: colors.onSurface },
  statLabel: { fontFamily: font.display, fontSize: 10, letterSpacing: 1, color: colors.muted, fontWeight: "800", marginTop: 2 },

  warnBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md,
    borderWidth: 2, borderColor: colors.warning, backgroundColor: "#FFFBEB",
  },
  warnText: { flex: 1, fontSize: 12, color: "#78350F", fontFamily: font.display, fontWeight: "700" },

  actionsRow: {
    flexDirection: "row", gap: spacing.sm,
    paddingHorizontal: spacing.lg, marginTop: spacing.md,
  },
  searchRow: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm,
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, height: 44,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: 15, paddingVertical: 8 },

  pattiRow: {
    borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surface, overflow: "hidden",
  },
  pattiRowPrinted: {
    backgroundColor: colors.brandSecondary, borderColor: colors.brandPrimary,
  },
  printedBanner: {
    backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: 4,
  },
  printedBannerText: {
    color: colors.onBrandPrimary, fontFamily: font.display, fontWeight: "900",
    letterSpacing: 1.5, fontSize: 11,
  },
  pattiRowBody: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md,
  },
  numBox: {
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: colors.surfaceSecondary, minWidth: 54, alignItems: "center",
  },
  numText: { fontFamily: font.mono, fontWeight: "800", color: colors.onSurface, fontSize: 13 },
  farmerName: { fontSize: 16, fontWeight: "800", color: colors.onSurface, fontFamily: font.display },
  meta: { fontSize: 12, color: colors.muted, fontFamily: font.display, marginTop: 2 },
  receiver: { fontSize: 12, color: colors.onSurfaceTertiary, fontFamily: font.display, marginTop: 2, fontWeight: "700" },
  net: { fontSize: 16, fontWeight: "800", color: colors.brandPrimary, fontFamily: font.mono },
  statusChip: {
    borderWidth: 1, borderColor: colors.muted, paddingHorizontal: 6, paddingVertical: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  statusText: { fontSize: 9, fontWeight: "800", color: colors.muted, letterSpacing: 0.5, fontFamily: font.display },

  // Driver modal
  modalRoot: { flex: 1, backgroundColor: "rgba(17,24,39,0.5)", justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject },
  modalSheet: { backgroundColor: colors.surface, borderTopWidth: 2, borderTopColor: colors.borderStrong },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  modalTitle: { fontSize: 16, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: 1 },
  hint: { fontSize: 12, color: colors.muted, marginBottom: spacing.md, fontFamily: font.display },
  driverEditCard: { borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, marginBottom: spacing.md, backgroundColor: colors.surfaceSecondary, gap: spacing.sm },
  driverEditHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  driverEditTitle: { fontSize: 11, fontWeight: "900", letterSpacing: 1, color: colors.onSurface, fontFamily: font.display },
  addDriverBtn: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", padding: spacing.md, borderWidth: 2, borderColor: colors.divider, borderStyle: "dashed" },
  addDriverText: { fontFamily: font.display, fontWeight: "900", letterSpacing: 1, color: colors.brandPrimary, fontSize: 12 },
  err: { color: colors.error, fontFamily: font.display, fontWeight: "700", marginTop: 8 },
});
