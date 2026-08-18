import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, Modal,
  Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, Farmer, Patti, ShopProfile, Vendor } from "@/src/api";
import { KeyboardFormAvoid, KeyboardFormScroll } from "@/src/components/KeyboardForm";
import { useAuth } from "@/src/context/AuthContext";
import { Button, Input } from "@/src/components/ui";
import { PartyPicker } from "@/src/components/PartyPicker";
import { colors, font, money, spacing } from "@/src/theme";
import { thermalPrintAndMark, canUserPrintPatti, staffPrintBlockedMessage } from "@/src/utils/patti-print";
import { clampPaperMm, thermalPrintUserMessage } from "@/src/utils/thermal-print";
import { handleBagBillingError } from "@/src/utils/bag-billing";

type LocalSale = { key: string; vendor_id: string | null; vendor_name: string; bags: string; rate: string };
type LocalLot = {
  key: string;
  lot_serial_no: string;
  total_bags: string;
  bhada_total: string;
  sales: LocalSale[];
};

const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function errText(e: any): string {
  const d = e?.detail;
  if (!d) return e?.message || "Something went wrong";
  if (typeof d === "string") return d;
  if (typeof d === "object" && d.message) return String(d.message);
  return "Something went wrong";
}

export default function EditPatti() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const isOwner = session?.role === "owner";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [patti, setPatti] = useState<Patti | null>(null);
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [farmerId, setFarmerId] = useState<string | null>(null);
  const [lots, setLots] = useState<LocalLot[]>([]);
  const [hamali, setHamali] = useState("");
  const [stationery, setStationery] = useState("");
  const [factor, setFactor] = useState("");
  const [receiver, setReceiver] = useState("");

  const [farmerPickerOpen, setFarmerPickerOpen] = useState(false);
  const [vendorPickerFor, setVendorPickerFor] = useState<{ lotKey: string; saleKey: string } | null>(null);

  const [showDelete, setShowDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const [p, f, v] = await Promise.all([
        api.get<Patti>(`/pattis/${id}`),
        api.get<Farmer[]>("/farmers"),
        api.get<Vendor[]>("/vendors"),
      ]);
      setPatti(p);
      setFarmers(f);
      setVendors(v);
      setFarmerId(p.farmer_id);
      setHamali(String(p.hamali_per_bag ?? ""));
      setStationery(String(p.stationery_flat ?? ""));
      setFactor(String(p.payment_factor ?? ""));
      setReceiver(p.receiver_name || "");
      setLots(
        (p.lots || []).map((lot) => ({
          key: newKey(),
          lot_serial_no: String(lot.lot_serial_no ?? ""),
          total_bags: String(lot.total_bags ?? ""),
          bhada_total: String(lot.bhada_total ?? lot.bhada_per_bag ?? 0),
          sales: (lot.sales || []).map((s) => ({
            key: newKey(),
            vendor_id: s.vendor_id,
            vendor_name: s.vendor_name,
            bags: String(s.bags),
            rate: String(s.rate_per_bag),
          })),
        })),
      );
    } catch (e: any) {
      setPatti(null);
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const farmerName = useMemo(
    () => farmers.find((f) => f.id === farmerId)?.name || patti?.farmer_name || "—",
    [farmers, farmerId, patti],
  );

  const setLotField = (lotKey: string, patch: Partial<LocalLot>) =>
    setLots((xs) => xs.map((l) => (l.key === lotKey ? { ...l, ...patch } : l)));

  const setSaleField = (lotKey: string, saleKey: string, patch: Partial<LocalSale>) =>
    setLots((xs) =>
      xs.map((l) =>
        l.key !== lotKey
          ? l
          : { ...l, sales: l.sales.map((s) => (s.key === saleKey ? { ...s, ...patch } : s)) },
      ),
    );

  const addSale = (lotKey: string) =>
    setLots((xs) =>
      xs.map((l) =>
        l.key !== lotKey
          ? l
          : { ...l, sales: [...l.sales, { key: newKey(), vendor_id: null, vendor_name: "", bags: "", rate: "" }] },
      ),
    );

  const removeSale = (lotKey: string, saleKey: string) =>
    setLots((xs) =>
      xs.map((l) =>
        l.key !== lotKey ? l : { ...l, sales: l.sales.filter((s) => s.key !== saleKey) },
      ),
    );

  const save = async () => {
    if (!patti || !farmerId || !session) return;
    setError(null);

    if (!lots.length) { setError("At least one lot is required"); return; }

    const bodyLots = [];
    for (const lot of lots) {
      const serial = parseInt(lot.lot_serial_no.trim(), 10);
      const totalBags = parseInt(lot.total_bags.trim(), 10);
      if (!isFinite(serial) || serial < 1) { setError("Each lot needs a valid serial number"); return; }
      if (!isFinite(totalBags) || totalBags < 1) { setError(`Lot ${serial}: enter total bags`); return; }
      const sales = [];
      for (const s of lot.sales) {
        if (!s.vendor_id) { setError(`Lot ${serial}: pick a vendor for every sale`); return; }
        const bags = parseInt(s.bags.trim(), 10);
        const rate = Number(s.rate.trim());
        if (!isFinite(bags) || bags < 1) { setError(`Lot ${serial}: enter bags for each vendor`); return; }
        if (!isFinite(rate) || rate < 0) { setError(`Lot ${serial}: enter a valid rate`); return; }
        sales.push({ vendor_id: s.vendor_id, bags, rate_per_bag: rate });
      }
      if (!sales.length) { setError(`Lot ${serial}: add at least one vendor sale`); return; }
      const sold = sales.reduce((n, s) => n + s.bags, 0);
      if (sold !== totalBags) {
        setError(`Lot ${serial}: declared ${totalBags} bags but vendors sum to ${sold}`);
        return;
      }
      const bhadaTotal = Number(lot.bhada_total.trim() || "0");
      if (!isFinite(bhadaTotal) || bhadaTotal < 0) { setError(`Lot ${serial}: invalid bhada`); return; }
      bodyLots.push({
        lot_serial_no: serial,
        total_bags: totalBags,
        bhada_total: bhadaTotal,
        sales,
      });
    }

    const hamali_per_bag = Number(hamali.trim() || "0");
    const stationery_flat = Number(stationery.trim() || "0");
    const payment_factor = Number(factor.trim() || "0");
    if (!isFinite(hamali_per_bag) || hamali_per_bag < 0) { setError("Invalid hamali"); return; }
    if (!isFinite(stationery_flat) || stationery_flat < 0) { setError("Invalid stationery"); return; }
    if (!isFinite(payment_factor) || payment_factor <= 0 || payment_factor > 1) {
      setError("Payment factor must be between 0 and 1 (e.g. 0.90)");
      return;
    }

    try {
      setSaving(true);
      const updated = await api.put<Patti>(`/pattis/${patti.id}`, {
        farmer_id: farmerId,
        lots: bodyLots,
        hamali_per_bag,
        stationery_flat,
        payment_factor,
        receiver_name: receiver.trim() || undefined,
      });
      setPatti(updated);
      // Return to Action Diary so the list reloads the synced Lot + Patti.
      router.back();
      Alert.alert("Saved", `Patti #${updated.patti_no} updated. Net ${money(updated.net_payable)}`);
    } catch (e: any) {
      if (handleBagBillingError(e, router)) {
        setError("Insufficient bag balance. Please purchase additional bags to continue.");
      } else {
        setError(errText(e));
      }
    } finally {
      setSaving(false);
    }
  };

  const reprint = async () => {
    // Action Diary manage screen: Staff may only Save — no print/reprint/share.
    if (!isOwner || !patti || !session) return;
    if (!canUserPrintPatti(patti, session)) {
      Alert.alert("Already printed", staffPrintBlockedMessage());
      return;
    }
    try {
      setPrinting(true);
      const [profile, settings] = await Promise.all([
        api.get<ShopProfile>("/shop/profile").catch(() => null),
        api.get<any>("/settings").catch(() => null),
      ]);
      const paperMm = clampPaperMm(settings?.thermal_paper_width_mm || 80);
      const updated = await thermalPrintAndMark(patti, profile || { shop_name: session.shop_name } as any, paperMm, session);
      setPatti(updated);
    } catch (e: any) {
      const detail = typeof e?.detail === "string" ? e.detail : null;
      Alert.alert("Print failed", detail || `${thermalPrintUserMessage(e)} Patti stays Saved (not Printed).`);
    } finally {
      setPrinting(false);
    }
  };

  const softDelete = async () => {
    if (!patti || !isOwner) return;
    try {
      setDeleting(true);
      await api.del(`/pattis/${patti.id}`, { reason: deleteReason.trim() || null });
      setShowDelete(false);
      Alert.alert("Deleted", `Patti #${patti.patti_no} deleted.`);
      router.back();
    } catch (e: any) {
      Alert.alert("Failed", errText(e));
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  if (!patti) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>EDIT PATTI</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.err}>{error || "Patti not found"}</Text>
          <Button label="GO BACK" onPress={() => router.back()} style={{ marginTop: spacing.lg }} />
        </View>
      </SafeAreaView>
    );
  }

  const readOnly = false;
  const canPrint = isOwner && canUserPrintPatti(patti, session);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="edit-patti-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>MANAGE PATTI</Text>
          <Text style={styles.sub}>#{patti.patti_no} · {farmerName}</Text>
        </View>
        {isOwner ? (
          <Pressable onPress={() => setShowDelete(true)} hitSlop={12} testID="edit-patti-delete">
            <Ionicons name="trash-outline" size={22} color={colors.error} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryVal}>{patti.total_bags}</Text>
          <Text style={styles.summaryLbl}>BAGS</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryVal, { color: colors.brandPrimary }]}>{money(patti.net_payable)}</Text>
          <Text style={styles.summaryLbl}>NET</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryVal}>{patti.status === "received" ? "✓" : "⧗"}</Text>
          <Text style={styles.summaryLbl}>{patti.status.toUpperCase()}</Text>
        </View>
      </View>

      <KeyboardFormScroll
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 160 }}
        bottomOffset={100}
      >
        <Text style={styles.section}>FARMER</Text>
        <Pressable
          style={[styles.pickerBtn, readOnly && styles.disabled]}
          onPress={readOnly ? undefined : () => { setFarmerPickerOpen(true); }}
          testID="edit-patti-farmer"
        >
          <Text style={styles.pickerText}>{farmerName}</Text>
          {!readOnly ? <Ionicons name="chevron-down" size={18} color={colors.muted} /> : null}
        </Pressable>

        {lots.map((lot, li) => (
          <View key={lot.key} style={styles.lotCard} testID={`edit-lot-${li}`}>
            <Text style={styles.lotTitle}>LOT {li + 1}</Text>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Input
                  label="Serial no"
                  keyboardType="number-pad"
                  value={lot.lot_serial_no}
                  editable={!readOnly}
                  onChangeText={(t) => setLotField(lot.key, { lot_serial_no: t })}
                  testID={`edit-lot-serial-${li}`}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Input
                  label="Total bags"
                  keyboardType="number-pad"
                  value={lot.total_bags}
                  editable={!readOnly}
                  onChangeText={(t) => setLotField(lot.key, { total_bags: t })}
                  testID={`edit-lot-bags-${li}`}
                />
              </View>
            </View>
            <Input
              label="Total bhada ₹"
              keyboardType="decimal-pad"
              value={lot.bhada_total}
              editable={!readOnly}
              onChangeText={(t) => setLotField(lot.key, { bhada_total: t })}
              testID={`edit-lot-bhada-${li}`}
            />

            <Text style={styles.saleHead}>VENDOR SALES</Text>
            {lot.sales.map((s, si) => (
              <View key={s.key} style={styles.saleRow}>
                <Pressable
                  style={[styles.vendorPick, readOnly && styles.disabled]}
                  onPress={readOnly ? undefined : () => {
                    setVendorPickerFor({ lotKey: lot.key, saleKey: s.key });
                  }}
                  testID={`edit-sale-vendor-${li}-${si}`}
                >
                  <Text style={styles.vendorPickText} numberOfLines={1}>
                    {s.vendor_name || "Pick vendor"}
                  </Text>
                  {!readOnly ? <Ionicons name="chevron-down" size={14} color={colors.muted} /> : null}
                </Pressable>
                <TextInput
                  style={styles.miniInput}
                  keyboardType="number-pad"
                  placeholder="Bags"
                  placeholderTextColor={colors.muted}
                  value={s.bags}
                  editable={!readOnly}
                  onChangeText={(t) => setSaleField(lot.key, s.key, { bags: t })}
                  testID={`edit-sale-bags-${li}-${si}`}
                />
                <TextInput
                  style={styles.miniInput}
                  keyboardType="decimal-pad"
                  placeholder="Rate"
                  placeholderTextColor={colors.muted}
                  value={s.rate}
                  editable={!readOnly}
                  onChangeText={(t) => setSaleField(lot.key, s.key, { rate: t })}
                  testID={`edit-sale-rate-${li}-${si}`}
                />
                {!readOnly && lot.sales.length > 1 ? (
                  <Pressable onPress={() => removeSale(lot.key, s.key)} hitSlop={8}>
                    <Ionicons name="close-circle" size={20} color={colors.error} />
                  </Pressable>
                ) : null}
              </View>
            ))}
            {!readOnly ? (
              <Pressable style={styles.addSaleBtn} onPress={() => addSale(lot.key)} testID={`edit-add-sale-${li}`}>
                <Ionicons name="add" size={16} color={colors.brandPrimary} />
                <Text style={styles.addSaleText}>ADD VENDOR</Text>
              </Pressable>
            ) : null}
          </View>
        ))}

        <Text style={styles.section}>DEDUCTIONS</Text>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Input
              label="Hamali / bag ₹"
              keyboardType="decimal-pad"
              value={hamali}
              editable={!readOnly}
              onChangeText={setHamali}
              testID="edit-hamali"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Stationery ₹"
              keyboardType="decimal-pad"
              value={stationery}
              editable={!readOnly}
              onChangeText={setStationery}
              testID="edit-stationery"
            />
          </View>
        </View>
        <Input
          label="Payment factor (e.g. 0.90)"
          keyboardType="decimal-pad"
          value={factor}
          editable={!readOnly}
          onChangeText={setFactor}
          testID="edit-factor"
        />
        <Input
          label="Receiver name"
          value={receiver}
          editable={!readOnly}
          onChangeText={setReceiver}
          autoCapitalize="words"
          testID="edit-receiver"
        />

        {error ? <Text style={styles.err}>{error}</Text> : null}
        {!isOwner ? (
          <Text style={styles.hint}>Save updates only. Print is available once from Save &amp; Print when creating a Patti.</Text>
        ) : null}
      </KeyboardFormScroll>

      <View style={styles.footer}>
        {isOwner ? (
          canPrint ? (
            <Pressable
              style={[styles.reprintBtn, printing && styles.disabled]}
              onPress={reprint}
              disabled={printing}
              testID="edit-patti-reprint"
            >
              <Ionicons name="print-outline" size={18} color={colors.onSurface} />
              <Text style={styles.reprintText}>{printing ? "PRINTING…" : "PRINT"}</Text>
            </Pressable>
          ) : (
            <View style={[styles.reprintBtn, styles.disabled]} testID="edit-patti-reprint-disabled">
              <Ionicons name="print-outline" size={18} color={colors.muted} />
              <Text style={[styles.reprintText, { color: colors.muted }]}>PRINTED</Text>
            </View>
          )
        ) : null}
        <View style={{ flex: 1 }}>
          <Button
            label={saving ? "SAVING…" : "SAVE CHANGES"}
            onPress={save}
            loading={saving}
            testID="edit-patti-save"
          />
        </View>
      </View>

      <PartyPicker
        visible={farmerPickerOpen}
        kind="farmer"
        items={farmers}
        selectedId={farmerId}
        initialQuery={farmerName !== "—" ? farmerName : ""}
        onClose={() => setFarmerPickerOpen(false)}
        onSelect={(item) => { setFarmerId(item.id); setFarmerPickerOpen(false); }}
        onCreated={(item) => {
          setFarmers((xs) => [...xs, item as Farmer].sort((a, b) => a.name.localeCompare(b.name)));
          setFarmerId(item.id);
          setFarmerPickerOpen(false);
        }}
      />
      <PartyPicker
        visible={!!vendorPickerFor}
        kind="vendor"
        items={vendors}
        selectedId={
          vendorPickerFor
            ? lots.find((l) => l.key === vendorPickerFor.lotKey)?.sales.find((s) => s.key === vendorPickerFor.saleKey)?.vendor_id
            : undefined
        }
        initialQuery={
          vendorPickerFor
            ? (lots.find((l) => l.key === vendorPickerFor.lotKey)?.sales.find((s) => s.key === vendorPickerFor.saleKey)?.vendor_name || "")
            : ""
        }
        onClose={() => setVendorPickerFor(null)}
        onSelect={(item) => {
          if (vendorPickerFor) {
            setSaleField(vendorPickerFor.lotKey, vendorPickerFor.saleKey, {
              vendor_id: item.id,
              vendor_name: item.name,
            });
          }
          setVendorPickerFor(null);
        }}
        onCreated={(item) => {
          setVendors((xs) => [...xs, item as Vendor].sort((a, b) => a.name.localeCompare(b.name)));
          if (vendorPickerFor) {
            setSaleField(vendorPickerFor.lotKey, vendorPickerFor.saleKey, {
              vendor_id: item.id,
              vendor_name: item.name,
            });
          }
          setVendorPickerFor(null);
        }}
      />

      {/* Delete confirm */}
      <Modal visible={showDelete} transparent animationType="fade" onRequestClose={() => setShowDelete(false)}>
        <KeyboardFormAvoid style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setShowDelete(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>DELETE PATTI</Text>
              <Pressable onPress={() => setShowDelete(false)} hitSlop={12}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <View style={{ padding: spacing.lg }}>
              <Text style={styles.hint}>
                Soft-delete Patti #{patti.patti_no} for {farmerName}. You can restore it later from reports if needed.
              </Text>
              <Input
                label="Reason (optional)"
                value={deleteReason}
                onChangeText={setDeleteReason}
                placeholder="e.g. Wrong farmer"
                testID="edit-delete-reason"
              />
              <Button
                label={deleting ? "DELETING…" : "CONFIRM DELETE"}
                variant="danger"
                onPress={softDelete}
                loading={deleting}
                testID="edit-delete-confirm"
              />
            </View>
          </View>
        </KeyboardFormAvoid>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
    flexDirection: "row", alignItems: "center", gap: spacing.md,
  },
  title: { fontSize: 18, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.3 },
  sub: { fontSize: 12, color: colors.muted, fontFamily: font.mono, fontWeight: "700" },

  summary: {
    flexDirection: "row", borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  summaryItem: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingVertical: spacing.md, borderRightWidth: 2, borderRightColor: colors.borderStrong,
  },
  summaryVal: { fontFamily: font.mono, fontWeight: "900", fontSize: 16, color: colors.onSurface },
  summaryLbl: { fontFamily: font.display, fontSize: 10, letterSpacing: 1, color: colors.muted, fontWeight: "800", marginTop: 2 },

  section: {
    fontSize: 11, fontWeight: "900", letterSpacing: 1.5, color: colors.muted,
    fontFamily: font.display, marginBottom: spacing.sm, marginTop: spacing.md,
  },
  pickerBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, height: 48,
    marginBottom: spacing.md, backgroundColor: colors.surfaceSecondary,
  },
  pickerText: { fontSize: 16, fontWeight: "800", color: colors.onSurface, fontFamily: font.display, flex: 1 },

  lotCard: {
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md,
    marginBottom: spacing.md, backgroundColor: colors.surfaceSecondary, gap: 4,
  },
  lotTitle: { fontSize: 12, fontWeight: "900", letterSpacing: 1, color: colors.onSurface, fontFamily: font.display, marginBottom: 4 },
  saleHead: { fontSize: 10, fontWeight: "900", letterSpacing: 1, color: colors.muted, fontFamily: font.display, marginTop: 4, marginBottom: 6 },
  saleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  vendorPick: {
    flex: 1.4, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 8, height: 40, backgroundColor: colors.surface,
  },
  vendorPickText: { flex: 1, fontSize: 13, fontWeight: "700", color: colors.onSurface, fontFamily: font.display },
  miniInput: {
    flex: 0.7, borderWidth: 2, borderColor: colors.borderStrong, height: 40,
    paddingHorizontal: 8, color: colors.onSurface, fontFamily: font.mono, fontSize: 14, backgroundColor: colors.surface,
  },
  addSaleBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
    paddingVertical: 6, paddingHorizontal: 4,
  },
  addSaleText: { fontFamily: font.display, fontWeight: "900", letterSpacing: 1, color: colors.brandPrimary, fontSize: 11 },

  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", gap: spacing.sm, alignItems: "center",
    padding: spacing.lg, borderTopWidth: 2, borderTopColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  reprintBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 14, paddingVertical: 14,
  },
  reprintText: { color: colors.onSurface, fontFamily: font.display, fontWeight: "900", letterSpacing: 0.5, fontSize: 13 },
  disabled: { opacity: 0.45 },

  modalRoot: { flex: 1, backgroundColor: "rgba(17,24,39,0.5)", justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject },
  modalSheet: { backgroundColor: colors.surface, borderTopWidth: 2, borderTopColor: colors.borderStrong },
  modalHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: spacing.lg, borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  modalTitle: { fontSize: 16, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: 1 },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    margin: spacing.lg, marginBottom: spacing.sm,
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, height: 44,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: 15 },
  listRow: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  listName: { fontSize: 16, fontWeight: "800", color: colors.onSurface, fontFamily: font.display },
  listMeta: { fontSize: 12, color: colors.muted, fontFamily: font.display, marginTop: 2 },
  hint: { fontSize: 13, color: colors.muted, fontFamily: font.display, marginBottom: spacing.md },
  err: { color: colors.error, fontFamily: font.display, fontWeight: "700", marginTop: 8, marginBottom: 8 },
});
