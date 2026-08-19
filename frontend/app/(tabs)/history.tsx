import { useCallback, useMemo, useState } from "react";
import {
  Alert, FlatList, Pressable, RefreshControl,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, Patti, ShopProfile } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { useWorkingDate } from "@/src/context/WorkingDateContext";
import { Empty } from "@/src/components/ui";
import { colors, font, money, spacing } from "@/src/theme";
import { thermalPrintAndMark } from "@/src/utils/patti-print";
import { clampPaperMm, thermalPrintUserMessage } from "@/src/utils/thermal-print";
import { DatePickerModal } from "@/src/components/DatePickerModal";
import { PrintRangeModal } from "@/src/components/PrintRangeModal";
import { toISODate } from "@/src/utils/date";

export default function History() {
  const router = useRouter();
  const { session } = useAuth();
  const isOwner = session?.role === "owner";
  const { workingDate, workingDateISO, displayDate, isWorkingToday, setWorkingDate } = useWorkingDate();

  const [items, setItems] = useState<Patti[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  const [dateFilter, setDateFilter] = useState<Date | null>(workingDate); // default = working date
  const [showPicker, setShowPicker] = useState(false);
  const [showRange, setShowRange] = useState(false);
  const [printingBulk, setPrintingBulk] = useState(false);

  const load = useCallback(async (dt: Date | null | undefined = dateFilter) => {
    try {
      setLoading(true);
      const qs = dt ? `?date=${toISODate(dt)}` : "";
      const d = await api.get<Patti[]>(`/pattis${qs}`);
      setItems(d);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [dateFilter]);

  // Keep local filter aligned when global working date changes (e.g. from Dashboard).
  useFocusEffect(
    useCallback(() => {
      setDateFilter(workingDate);
      void load(workingDate);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workingDateISO]),
  );

  const filtered = useMemo(() => {
    if (!items) return [];
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((p) => {
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
  }, [items, q]);

  const onApplyDate = (d: Date | null) => {
    setShowPicker(false);
    setDateFilter(d);
    if (d) setWorkingDate(d); // sync global working date when a concrete day is chosen
    load(d);
  };

  const clearDate = () => {
    setDateFilter(null);
    load(null);
  };

  const openPrintRange = () => {
    if (!filtered.length) {
      Alert.alert("Nothing to print", "There are no Pattis to print.");
      return;
    }
    setShowRange(true);
  };

  const printRange = async (from: number, to: number) => {
    setShowRange(false);
    const inRange = filtered.filter((p) => p.patti_no >= from && p.patti_no <= to);
    if (!inRange.length) {
      Alert.alert("No Pattis in range", `No Pattis found between #${from} and #${to} in the current view.`);
      return;
    }
    try {
      setPrintingBulk(true);
      const [profile, settings] = await Promise.all([
        api.get<ShopProfile>("/shop/profile").catch(() => null),
        api.get<any>("/settings").catch(() => null),
      ]);
      const paperMm = clampPaperMm(settings?.thermal_paper_width_mm || 80);
      const ordered = [...inRange].sort((a, b) => a.patti_no - b.patti_no);
      let ok = 0, fail = 0;
      for (const p of ordered) {
        try {
          const updated = await thermalPrintAndMark(p, profile || { shop_name: session?.shop_name || "" } as any, paperMm, session);
          setItems((xs) => (xs || []).map((row) => (row.id === updated.id ? updated : row)));
          ok += 1;
        } catch (e) {
          fail += 1;
          console.warn("bulk print failed for patti", p.patti_no, e);
        }
      }
      Alert.alert("Print complete", `${ok} printed · ${fail} failed`);
    } catch (e) {
      console.warn("printRange error", e);
      Alert.alert("Print failed", thermalPrintUserMessage(e));
    } finally {
      setPrintingBulk(false);
    }
  };

  const dateLabel = dateFilter
    ? (isWorkingToday && toISODate(dateFilter) === workingDateISO
      ? `TODAY · ${displayDate}`
      : dateFilter.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }))
    : "ALL DATES";

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>PATTI DETAILS</Text>
          <Text style={styles.subtitle}>{items ? `${filtered.length} of ${items.length} patti${items.length === 1 ? "" : "s"}` : "…"}</Text>
        </View>
        <Pressable style={styles.scanBtn} onPress={() => router.push("/scan")} testID="history-scan">
          <Ionicons name="qr-code-outline" size={16} color={colors.onSurfaceInverse} />
          <Text style={styles.scanBtnText}>SCAN</Text>
        </Pressable>
      </View>

      <View style={styles.filterRow}>
        <Pressable style={styles.dateChip} onPress={() => setShowPicker(true)} testID="history-date-filter">
          <Ionicons name="calendar-outline" size={14} color={colors.onSurface} />
          <Text style={styles.dateChipText}>{dateLabel}</Text>
          {dateFilter ? (
            <Pressable onPress={clearDate} hitSlop={8} testID="history-date-clear">
              <Ionicons name="close-circle" size={16} color={colors.muted} />
            </Pressable>
          ) : null}
        </Pressable>
        {isOwner ? (
          <Pressable
            style={[styles.printAllBtn, (!filtered.length || printingBulk) && styles.disabledBtn]}
            onPress={openPrintRange}
            disabled={!filtered.length || printingBulk}
            testID="history-print-range"
          >
            <Ionicons name="print" size={14} color={colors.onBrandPrimary} />
            <Text style={styles.printAllText}>{printingBulk ? "PRINTING…" : "PRINT"}</Text>
          </Pressable>
        ) : null}
      </View>

      {showPicker ? (
        <DatePickerModal
          visible={showPicker}
          value={dateFilter}
          onCancel={() => setShowPicker(false)}
          onApply={onApplyDate}
          title="WORKING DATE"
          allowClear
          maximumDate={new Date(2100, 11, 31)}
        />
      ) : null}

      {(() => {
        const nums = filtered.map((p) => p.patti_no);
        const min = nums.length ? Math.min(...nums) : undefined;
        const max = nums.length ? Math.max(...nums) : undefined;
        return (
          <PrintRangeModal
            visible={showRange}
            onCancel={() => setShowRange(false)}
            onConfirm={printRange}
            suggestedFrom={min}
            suggestedTo={max}
            minAllowed={min}
            maxAllowed={max}
            countHint={filtered.length ? `${filtered.length} Patti${filtered.length === 1 ? "" : "s"} in view (#${min}–#${max}).` : undefined}
          />
        );
      })()}

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search: PT-000125, farmer, driver, lot…"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          autoCapitalize="none"
          testID="history-search"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100, gap: spacing.sm }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={
          loading ? null : (
            <Empty
              title={dateFilter ? "No Pattis on this date" : "No Pattis yet"}
              subtitle={dateFilter ? "Try clearing the date filter." : "Add lots via Create Action Diary."}
              testID="history-empty"
            />
          )
        }
        renderItem={({ item }) => {
          const isPrinted = !!item.printed;
          return (
          <Pressable
            testID={`patti-row-${item.id}`}
            onPress={() => router.push({ pathname: "/patti/[id]", params: { id: item.id, from: "history" } })}
            style={({ pressed }) => [
              styles.row,
              isPrinted && styles.rowPrinted,
              pressed && { opacity: 0.9 },
            ]}
          >
            {isPrinted ? (
              <View style={styles.printedBanner} testID={`patti-printed-${item.id}`}>
                <Text style={styles.printedBannerText}>PRINTED</Text>
              </View>
            ) : null}
            <View style={styles.rowBody}>
              <View style={styles.numBox}>
                <Text style={styles.numText}>#{item.patti_no}</Text>
              </View>
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
                <Text style={styles.meta}>
                  {new Date(item.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
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
    </SafeAreaView>
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
  scanBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.surfaceInverse, borderWidth: 2, borderColor: colors.surfaceInverse,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  scanBtnText: { color: colors.onSurfaceInverse, fontFamily: font.display, fontWeight: "800", letterSpacing: 1, fontSize: 12 },

  filterRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.lg, marginTop: spacing.md,
  },
  dateChip: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 10, paddingVertical: 8,
  },
  dateChipText: { flex: 1, fontFamily: font.mono, fontWeight: "700", color: colors.onSurface, fontSize: 13 },
  printAllBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.brandPrimary, borderWidth: 2, borderColor: colors.brand,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  printAllText: { color: colors.onBrandPrimary, fontFamily: font.display, fontWeight: "900", letterSpacing: 0.5, fontSize: 12 },
  disabledBtn: { opacity: 0.4 },

  searchRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.md,
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, height: 44,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: 15, paddingVertical: 8 },

  row: {
    borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surface, overflow: "hidden",
  },
  rowPrinted: {
    backgroundColor: colors.brandSecondary, borderColor: colors.brandPrimary,
  },
  printedBanner: {
    backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: 4,
  },
  printedBannerText: {
    color: colors.onBrandPrimary, fontFamily: font.display, fontWeight: "900",
    letterSpacing: 1.5, fontSize: 11,
  },
  rowBody: {
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
});
