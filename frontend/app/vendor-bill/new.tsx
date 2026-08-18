import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, apiErrorMessage, Settings, Vendor, VendorBill, VendorDayLine } from "@/src/api";
import { routeParam } from "@/src/utils/route-params";
import { Input } from "@/src/components/ui";
import { colors, font, money, spacing } from "@/src/theme";
import { useWorkingDate } from "@/src/context/WorkingDateContext";
import { DatePickerModal } from "@/src/components/DatePickerModal";
import { formatDisplayDate, parseISODate, toISODate } from "@/src/utils/date";

type LineDraft = {
  key: string;
  lot_id: string | null;
  lot_no: string;
  farmer_name: string;
  bags: string;
  auction_rate: string; // original auction rate — never written back to Farmer Patti
  vendor_rate: string; // editable final rate/bag (override); empty = use formula
};

const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export default function NewVendorBill() {
  const params = useLocalSearchParams<{ vendor_id?: string; id?: string }>();
  const vendor_id = routeParam(params.vendor_id);
  const editId = routeParam(params.id);
  const router = useRouter();
  const isEdit = !!editId;
  const { workingDateISO, setWorkingDate } = useWorkingDate();

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [date, setDate] = useState(workingDateISO);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [margin, setMargin] = useState("30");
  const [vendorFactor, setVendorFactor] = useState("1.06");
  const [commission, setCommission] = useState("10");
  const [hamali, setHamali] = useState("0");
  const [cess, setCess] = useState("0");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const bagsRefs = useRef<Record<string, TextInput | null>>({});
  const rateRefs = useRef<Record<string, TextInput | null>>({});

  useEffect(() => {
    (async () => {
      try {
        const s = await api.get<Settings>("/settings").catch(() => null);
        if (s) {
          setMargin(String(s.vendor_margin_per_bag ?? 30));
          setVendorFactor(String(s.vendor_factor ?? 1.06));
          setCommission(String(s.commission_per_bag ?? 10));
          setHamali(String(s.vendor_hamali_default ?? 0));
        }
        if (isEdit) {
          const b = await api.get<VendorBill>(`/vendor-bills/${editId}`);
          setVendor({ id: b.vendor_id, name: b.vendor_name, details: b.vendor_details, phone: null, created_at: b.created_at });
          setDate(b.date);
          setMargin(String(b.margin_per_bag));
          setVendorFactor(String(b.vendor_factor ?? 1.06));
          setCommission(String(b.commission_per_bag));
          setHamali(String(b.hamali));
          setCess(String(b.cess));
          setNotes(b.notes || "");
          setLines(b.lines.map((l) => {
            const factor = Number(b.vendor_factor ?? 1.06);
            const marginN = Number(b.margin_per_bag) || 0;
            const formula = l.auction_rate * factor + marginN;
            // Only keep an explicit override when it differs from the factor formula.
            // Otherwise leave empty so Vendor factor / margin changes recalculate rates.
            const isOverride = Math.abs(Number(l.vendor_rate) - formula) > 0.009;
            return {
              key: newKey(), lot_id: l.lot_id, lot_no: l.lot_no, farmer_name: l.farmer_name,
              bags: String(l.bags), auction_rate: String(l.auction_rate),
              vendor_rate: isOverride ? String(l.vendor_rate) : "",
            };
          }));
        } else if (vendor_id) {
          const v = await api.get<Vendor[]>("/vendors").then((xs) => xs.find((x) => x.id === vendor_id) || null);
          setVendor(v);
          setDate(workingDateISO);
        } else {
          setDate(workingDateISO);
        }
      } catch {
        /* silent */
      }
    })();
  }, [isEdit, editId, vendor_id]);

  // Keep new bills on the global working date when Dashboard/Auction changes it.
  useEffect(() => {
    if (!isEdit) setDate(workingDateISO);
  }, [workingDateISO, isEdit]);

  const loadUnbilled = useCallback(async (v: Vendor, iso: string, quiet = false) => {
    try {
      const day = await api.get<VendorDayLine[]>(`/vendors/${v.id}/unbilled-lines?date=${iso}`);
      if (!day.length) {
        if (!quiet) Alert.alert("No lots", `No pending purchases for ${v.name} on ${iso}.`);
        setLines([]);
        return;
      }
      setLines(day.map((d) => ({
        key: newKey(),
        lot_id: d.lot_id, lot_no: d.lot_no, farmer_name: d.farmer_name,
        bags: String(d.bags), auction_rate: String(d.auction_rate), vendor_rate: "",
      })));
    } catch (e: any) {
      if (!quiet) Alert.alert("Failed", e?.detail || "Could not fetch lots");
    }
  }, []);

  useEffect(() => {
    if (isEdit || !vendor) return;
    void loadUnbilled(vendor, workingDateISO, true);
  }, [isEdit, vendor, workingDateISO, loadUnbilled]);

  const addLine = useCallback(() => {
    setLines((xs) => [...xs, { key: newKey(), lot_id: null, lot_no: "", farmer_name: "", bags: "", auction_rate: "", vendor_rate: "" }]);
  }, []);

  const updateLine = (k: string, patch: Partial<LineDraft>) =>
    setLines((xs) => xs.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const removeLine = (k: string) => setLines((xs) => xs.filter((l) => l.key !== k));

  const autoDraft = async () => {
    if (!vendor) return;
    await loadUnbilled(vendor, date, false);
  };

  const totals = useMemo(() => {
    const marginN = Number(margin) || 0;
    const factorN = Number(vendorFactor) || 1;
    const commN = Number(commission) || 0;
    const hamaliN = Number(hamali) || 0;
    const cessN = Number(cess) || 0;
    let bags = 0, goods = 0;
    for (const l of lines) {
      const b = Number(l.bags) || 0;
      const r = Number(l.auction_rate) || 0;
      const override = l.vendor_rate.trim() === "" ? null : Number(l.vendor_rate);
      const vendorRate = override != null && isFinite(override) ? override : r * factorN + marginN;
      bags += b;
      goods += b * vendorRate;
    }
    const commTotal = bags * commN;
    const grand = goods + commTotal + hamaliN + cessN;
    return { bags, goods, commTotal, marginN, factorN, commN, hamaliN, cessN, grand };
  }, [lines, margin, vendorFactor, commission, hamali, cess]);

  const save = async (mode: "save" | "print" | "share" = "save") => {
    if (saving) return;
    setError(null);
    if (!vendor) { setError("Vendor missing"); return; }
    const cleaned = lines.filter((l) => l.lot_no.trim() && l.farmer_name.trim() && Number(l.bags) > 0);
    if (!cleaned.length) { setError("Add at least one line"); return; }
    setSaving(true);
    const payload = {
      vendor_id: vendor.id,
      date,
      vendor_factor: Number(vendorFactor) || 1.06,
      margin_per_bag: Number(margin) || 0,
      commission_per_bag: Number(commission) || 0,
      hamali: Number(hamali) || 0,
      cess: Number(cess) || 0,
      notes: notes.trim() || null,
      lines: cleaned.map((l) => {
        const override = l.vendor_rate.trim() === "" ? null : Number(l.vendor_rate);
        return {
          lot_id: l.lot_id,
          lot_no: l.lot_no.trim(),
          farmer_name: l.farmer_name.trim(),
          bags: Number(l.bags),
          auction_rate: Number(l.auction_rate) || 0,
          vendor_rate: override != null && isFinite(override) ? override : null,
        };
      }),
    };
    try {
      const b = isEdit
        ? await api.put<VendorBill>(`/vendor-bills/${editId}`, payload)
        : await api.post<VendorBill>("/vendor-bills", payload);
      if (mode === "print" || mode === "share") {
        router.replace({
          pathname: "/vendor-bill/[id]",
          params: {
            id: b.id,
            ...(mode === "print" ? { autoPrint: "1" } : {}),
            ...(mode === "share" ? { autoShare: "1" } : {}),
          },
        });
      } else {
        // Land on Vendors → Posted so pending/posted lists refresh immediately.
        router.replace({ pathname: "/vendors", params: { tab: "posted", highlight: b.id } });
      }
    } catch (e: unknown) {
      setError(apiErrorMessage(e, "Failed to save"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="new-bill-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{isEdit ? "EDIT BILL" : "NEW VENDOR BILL"}</Text>
          <Text style={styles.headerSub}>{vendor?.name || "…"}</Text>
        </View>
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 200 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={120}
      >
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1.2 }}>
              <Text style={styles.fieldLabel}>DATE</Text>
              <Pressable
                style={styles.dateBtn}
                onPress={() => setShowDatePicker(true)}
                testID="bill-date"
              >
                <Text style={styles.dateBtnText}>{formatDisplayDate(parseISODate(date))}</Text>
                <Ionicons name="calendar-outline" size={16} color={colors.onSurface} />
              </Pressable>
            </View>
            <View style={{ flex: 1 }}>
              <Pressable style={styles.draftBtn} onPress={autoDraft} testID="bill-autodraft" disabled={isEdit}>
                <Ionicons name="flash-outline" size={16} color={isEdit ? colors.muted : colors.onSurface} />
                <Text style={[styles.draftText, isEdit && { color: colors.muted }]}>AUTO-DRAFT DAY</Text>
              </Pressable>
            </View>
          </View>

          {showDatePicker ? (
            <DatePickerModal
              visible={showDatePicker}
              value={parseISODate(date)}
              onCancel={() => setShowDatePicker(false)}
              onApply={(d) => {
                setShowDatePicker(false);
                if (!d) return;
                const iso = toISODate(d);
                setDate(iso);
                setWorkingDate(d);
              }}
              title="VENDOR BILL DATE"
              maximumDate={new Date(2100, 11, 31)}
            />
          ) : null}

          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Input label="Vendor factor" value={vendorFactor} onChangeText={(v) => setVendorFactor(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" testID="bill-vendor-factor" />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Margin / bag ₹" value={margin} onChangeText={(v) => setMargin(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" testID="bill-margin" />
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Input label="Commission / bag ₹" value={commission} onChangeText={(v) => setCommission(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" testID="bill-commission" />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Hamali (total) ₹" value={hamali} onChangeText={(v) => setHamali(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" testID="bill-hamali" />
            </View>
          </View>
          <Input label="Cess / Other (total) ₹" value={cess} onChangeText={(v) => setCess(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" testID="bill-cess" />

          <Text style={styles.section}>Lines</Text>

          {lines.map((l, idx) => (
            <View key={l.key} style={styles.lineCard} testID={`bill-line-${idx}`}>
              <View style={styles.lineHead}>
                <Text style={styles.lineHeadText}>LINE {idx + 1}</Text>
                <Pressable onPress={() => removeLine(l.key)} hitSlop={10} testID={`bill-line-remove-${idx}`}>
                  <Ionicons name="close-circle-outline" size={20} color={colors.error} />
                </Pressable>
              </View>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Input label="Lot No" value={l.lot_no} onChangeText={(v) => updateLine(l.key, { lot_no: v })} placeholder="e.g. 3/10" testID={`bill-lot-${idx}`} />
                </View>
                <View style={{ flex: 1.4 }}>
                  <Input label="Farmer" value={l.farmer_name} onChangeText={(v) => updateLine(l.key, { farmer_name: v })} placeholder="Farmer name" testID={`bill-farmer-${idx}`} />
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Bags"
                    value={l.bags}
                    onChangeText={(v) => updateLine(l.key, { bags: v.replace(/[^0-9]/g, "") })}
                    keyboardType="number-pad"
                    inputRef={(r) => { bagsRefs.current[l.key] = r; }}
                    returnKeyType="next"
                    onSubmitEditing={() => rateRefs.current[l.key]?.focus()}
                    testID={`bill-bags-${idx}`}
                  />
                </View>
                <View style={{ flex: 1.4 }}>
                  <Input
                    label="Auction rate / bag ₹"
                    value={l.auction_rate}
                    onChangeText={(v) => updateLine(l.key, { auction_rate: v.replace(/[^0-9.]/g, ""), vendor_rate: "" })}
                    keyboardType="decimal-pad"
                    inputRef={(r) => { rateRefs.current[l.key] = r; }}
                    returnKeyType="done"
                    onSubmitEditing={() => { /* no auto-add; user must tap ADD LINE */ }}
                    testID={`bill-rate-${idx}`}
                  />
                </View>
              </View>
              <Input
                label="Final vendor rate / bag ₹ (editable)"
                value={
                  l.vendor_rate !== ""
                    ? l.vendor_rate
                    : (Number(l.auction_rate) > 0
                      ? String(Number(l.auction_rate) * (Number(vendorFactor) || 1) + (Number(margin) || 0))
                      : "")
                }
                onChangeText={(v) => updateLine(l.key, { vendor_rate: v.replace(/[^0-9.]/g, "") })}
                keyboardType="decimal-pad"
                hint="Changing this does not affect Farmer Patti."
                testID={`bill-vendor-rate-${idx}`}
              />
              {Number(l.bags) > 0 && (Number(l.auction_rate) > 0 || Number(l.vendor_rate) > 0) ? (
                <Text style={styles.subT}>
                  Line total: {money(Number(l.bags) * (
                    l.vendor_rate.trim() !== ""
                      ? (Number(l.vendor_rate) || 0)
                      : (Number(l.auction_rate) * (Number(vendorFactor) || 1) + (Number(margin) || 0))
                  ))}
                </Text>
              ) : null}
            </View>
          ))}

          <Pressable style={styles.addRow} onPress={addLine} testID="bill-add-line">
            <Ionicons name="add-circle-outline" size={20} color={colors.brandPrimary} />
            <Text style={styles.addRowText}>ADD LINE</Text>
          </Pressable>

          <View style={styles.divider} />

          <Text style={styles.section}>Totals</Text>
          <SummaryRow label="Bags" value={String(totals.bags)} />
          <SummaryRow label={`Goods (×${totals.factorN} + ₹${totals.marginN}/bag)`} value={money(totals.goods)} />
          <SummaryRow label={`Commission (${totals.bags} × ₹${totals.commN})`} value={money(totals.commTotal)} />
          <SummaryRow label="Hamali" value={money(totals.hamaliN)} />
          {totals.cessN > 0 ? <SummaryRow label="Cess / Other" value={money(totals.cessN)} /> : null}
          <SummaryRow label="GRAND TOTAL" value={money(totals.grand)} strong />

          <View style={{ marginTop: spacing.md }}>
            <Input label="Notes (optional)" value={notes} onChangeText={setNotes} multiline testID="bill-notes" />
          </View>
      </KeyboardAwareScrollView>

      <KeyboardStickyView>
        <View style={styles.footer}>
          {error ? <Text style={styles.err}>{error}</Text> : null}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Pressable
              style={({ pressed }) => [styles.actBtn, styles.actSave, pressed && { opacity: 0.85 }, saving && { opacity: 0.5 }]}
              onPress={() => save("save")}
              disabled={saving}
              testID="save-bill"
            >
              <Ionicons name="save-outline" size={16} color={colors.onSurface} />
              <Text style={[styles.actBtnText, { color: colors.onSurface }]}>SAVE</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.actBtn, styles.actPrint, pressed && { opacity: 0.85 }, saving && { opacity: 0.5 }]}
              onPress={() => save("print")}
              disabled={saving}
              testID="save-and-print-bill"
            >
              <Ionicons name="print-outline" size={16} color={colors.onSurfaceInverse} />
              <Text style={[styles.actBtnText, { color: colors.onSurfaceInverse }]}>SAVE & PRINT</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.actBtn, styles.actShare, pressed && { opacity: 0.85 }, saving && { opacity: 0.5 }]}
              onPress={() => save("share")}
              disabled={saving}
              testID="save-and-share-bill"
            >
              <Ionicons name="share-social-outline" size={16} color={colors.onBrandPrimary} />
              <Text style={[styles.actBtnText, { color: colors.onBrandPrimary }]}>SHARE</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardStickyView>
    </SafeAreaView>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.sumRow}>
      <Text style={[styles.sumLabel, strong && { fontWeight: "900", color: colors.onSurface }]}>{label}</Text>
      <Text style={[styles.sumValue, strong && { fontSize: 16, fontWeight: "900" }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  headerTitle: { fontSize: 20, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.3 },
  headerSub: { fontSize: 11, color: colors.muted, letterSpacing: 1, fontWeight: "700" },
  section: { fontSize: 11, letterSpacing: 2, color: colors.muted, textTransform: "uppercase", fontWeight: "800", marginTop: spacing.lg, marginBottom: spacing.sm, fontFamily: font.display },
  draftBtn: {
    flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.borderStrong, padding: 12, height: 48, marginBottom: 14, marginTop: 22,
  },
  draftText: { fontSize: 11, letterSpacing: 1, fontWeight: "800", color: colors.onSurface, fontFamily: font.display },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: colors.onSurfaceTertiary, letterSpacing: 1, marginBottom: 6, fontFamily: font.display },
  dateBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 12, height: 48, marginBottom: 14,
    backgroundColor: colors.surface,
  },
  dateBtnText: { fontSize: 15, fontWeight: "800", color: colors.onSurface, fontFamily: font.mono },
  lineCard: { borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, marginBottom: spacing.sm },
  lineHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  lineHeadText: { fontSize: 11, letterSpacing: 1.5, fontWeight: "900", color: colors.onSurface, fontFamily: font.display },
  subT: { fontSize: 12, color: colors.muted, marginTop: 4, fontFamily: font.mono },
  addRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    borderWidth: 2, borderColor: colors.brandPrimary, borderStyle: "dashed",
    padding: spacing.md, marginTop: spacing.sm,
  },
  addRowText: { color: colors.brandPrimary, fontFamily: font.display, fontWeight: "800", letterSpacing: 1 },
  divider: { height: 2, backgroundColor: colors.divider, marginVertical: spacing.md },
  sumRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  sumLabel: { fontSize: 13, color: colors.muted, fontFamily: font.display },
  sumValue: { fontSize: 14, color: colors.onSurface, fontFamily: font.mono, fontWeight: "700" },
  footer: {
    borderTopWidth: 2, borderTopColor: colors.borderStrong,
    padding: spacing.lg, backgroundColor: colors.surface, gap: spacing.sm,
  },
  actBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 2, paddingVertical: 14, minHeight: 48,
  },
  actSave: { borderColor: colors.borderStrong, backgroundColor: colors.surface },
  actPrint: { borderColor: colors.surfaceInverse, backgroundColor: colors.surfaceInverse },
  actShare: { borderColor: colors.brand, backgroundColor: colors.brandPrimary },
  actBtnText: { fontFamily: font.display, fontWeight: "900", letterSpacing: 0.5, fontSize: 11 },
  err: {
    color: colors.error, backgroundColor: "#FEE2E2", borderWidth: 2, borderColor: colors.error,
    padding: spacing.sm, fontFamily: font.display, fontWeight: "700",
  },
});
