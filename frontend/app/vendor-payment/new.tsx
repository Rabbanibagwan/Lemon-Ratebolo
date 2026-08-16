import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Pressable, StyleSheet, Text, View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, Vendor, VendorBill } from "@/src/api";
import { Button, Input } from "@/src/components/ui";
import { useWorkingDate } from "@/src/context/WorkingDateContext";
import { colors, font, money, spacing } from "@/src/theme";

const MODES = ["cash", "upi", "bank", "cheque"] as const;
type Mode = typeof MODES[number];

export default function NewVendorPayment() {
  const { vendor_id } = useLocalSearchParams<{ vendor_id: string }>();
  const router = useRouter();
  const { workingDateISO } = useWorkingDate();

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [openBills, setOpenBills] = useState<VendorBill[]>([]);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(workingDateISO);
  const [mode, setMode] = useState<Mode>("cash");
  const [remarks, setRemarks] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({}); // bill_id -> "amount"
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!vendor_id) return;
    try {
      const [vs, bs] = await Promise.all([
        api.get<Vendor[]>("/vendors"),
        api.get<VendorBill[]>(`/vendor-bills?vendor_id=${vendor_id}`),
      ]);
      setVendor(vs.find((v) => v.id === vendor_id) || null);
      // Only open bills (not fully paid, not deleted)
      const open = bs.filter((b) => b.status === "unpaid" || b.status === "partial")
        .sort((a, b) => a.date.localeCompare(b.date) || a.bill_no - b.bill_no);
      setOpenBills(open);
    } catch { /* silent */ }
  }, [vendor_id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setDate(workingDateISO); }, [workingDateISO]);

  const amountN = Number(amount) || 0;
  const allocN = useMemo(() => Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0), [alloc]);
  const remaining = Math.max(0, amountN - allocN);

  const autoFIFO = () => {
    if (amountN <= 0) { Alert.alert("Enter amount", "Enter payment amount first."); return; }
    let left = amountN;
    const next: Record<string, string> = {};
    for (const b of openBills) {
      if (left <= 0) break;
      const bal = Number(b.balance) || 0;
      const take = Math.min(bal, left);
      if (take > 0) {
        next[b.id] = String(round2(take));
        left = round2(left - take);
      }
    }
    setAlloc(next);
  };

  const clearAlloc = () => setAlloc({});

  const save = async () => {
    setError(null);
    if (!vendor) { setError("Vendor missing"); return; }
    if (amountN <= 0) { setError("Enter amount > 0"); return; }
    if (allocN - amountN > 0.01) { setError("Allocations exceed payment amount"); return; }
    // Build allocations list (skip zeros)
    const allocations = Object.entries(alloc)
      .map(([bill_id, v]) => ({ bill_id, amount: Number(v) || 0 }))
      .filter((a) => a.amount > 0);
    try {
      setSaving(true);
      await api.post("/vendor-payments", {
        vendor_id: vendor.id,
        date, amount: amountN, mode, remarks: remarks.trim() || null, allocations,
      });
      router.back();
    } catch (e: any) {
      setError(e?.detail || "Failed to save");
    } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="pay-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>RECEIVE PAYMENT</Text>
          <Text style={styles.headerSub}>{vendor?.name || "…"}</Text>
        </View>
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 200 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={100}
      >
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1.4 }}>
              <Input label="Amount ₹" value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" placeholder="0" testID="pay-amount" />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" testID="pay-date" />
            </View>
          </View>

          <Text style={styles.section}>Payment mode</Text>
          <View style={styles.modeRow}>
            {MODES.map((m) => (
              <Pressable key={m} style={[styles.modeChip, mode === m && styles.modeChipOn]} onPress={() => setMode(m)} testID={`pay-mode-${m}`}>
                <Text style={[styles.modeText, mode === m && styles.modeTextOn]}>{m.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.allocHeader}>
            <Text style={styles.section}>Allocate to bills</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable style={styles.miniBtn} onPress={autoFIFO} testID="pay-auto-fifo">
                <Ionicons name="flash-outline" size={14} color={colors.onSurface} />
                <Text style={styles.miniBtnText}>AUTO FIFO</Text>
              </Pressable>
              <Pressable style={[styles.miniBtn, { borderColor: colors.error }]} onPress={clearAlloc} testID="pay-clear">
                <Text style={[styles.miniBtnText, { color: colors.error }]}>CLEAR</Text>
              </Pressable>
            </View>
          </View>

          {openBills.length === 0 ? (
            <Text style={styles.emptyLine}>No unpaid bills for this vendor.</Text>
          ) : (
            openBills.map((b) => (
              <View key={b.id} style={styles.billRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.billNo}>{b.bill_code}</Text>
                  <Text style={styles.billMeta}>{b.date} · Total {money(b.grand_total)} · Due {money(b.balance)}</Text>
                </View>
                <View style={{ width: 110 }}>
                  <Input
                    label=""
                    value={alloc[b.id] || ""}
                    onChangeText={(v) => setAlloc((prev) => ({ ...prev, [b.id]: v.replace(/[^0-9.]/g, "") }))}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    testID={`pay-alloc-${b.bill_no}`}
                  />
                </View>
              </View>
            ))
          )}

          <View style={styles.summary}>
            <SummaryRow label="Amount" value={money(amountN)} />
            <SummaryRow label="Allocated" value={money(allocN)} />
            <SummaryRow label="Remaining (on account)" value={money(remaining)} strong={remaining > 0} />
          </View>

          <Input label="Remarks (optional)" value={remarks} onChangeText={setRemarks} multiline testID="pay-remarks" />
      </KeyboardAwareScrollView>

      <View style={styles.footer}>
        {error ? <Text style={styles.err}>{error}</Text> : null}
        <Button label="RECEIVE PAYMENT" onPress={save} loading={saving} testID="save-pay" />
      </View>
    </SafeAreaView>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.sumRow}>
      <Text style={[styles.sumLabel, strong && { color: colors.onSurface, fontWeight: "800" }]}>{label}</Text>
      <Text style={[styles.sumValue, strong && { fontWeight: "900", color: colors.brandPrimary }]}>{value}</Text>
    </View>
  );
}
const round2 = (n: number) => Math.round(n * 100) / 100;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  headerTitle: { fontSize: 20, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.3 },
  headerSub: { fontSize: 11, color: colors.muted, letterSpacing: 1, fontWeight: "700" },
  section: { fontSize: 11, letterSpacing: 2, color: colors.muted, textTransform: "uppercase", fontWeight: "800", marginTop: spacing.md, marginBottom: spacing.sm, fontFamily: font.display },
  modeRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  modeChip: {
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 14, paddingVertical: 8,
    minWidth: 72, alignItems: "center", backgroundColor: colors.surface,
  },
  modeChipOn: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  modeText: { fontSize: 11, letterSpacing: 1, fontFamily: font.display, fontWeight: "800", color: colors.onSurface },
  modeTextOn: { color: colors.onSurfaceInverse },

  allocHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.lg },
  miniBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 10, paddingVertical: 6 },
  miniBtnText: { fontSize: 10, letterSpacing: 1, fontWeight: "800", color: colors.onSurface, fontFamily: font.display },
  emptyLine: { color: colors.muted, textAlign: "center", padding: spacing.lg, fontFamily: font.display },
  billRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.md, borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.sm, marginBottom: spacing.sm },
  billNo: { fontSize: 13, fontWeight: "900", color: colors.onSurface, fontFamily: font.display },
  billMeta: { fontSize: 11, color: colors.muted, marginTop: 2, fontFamily: font.mono },

  summary: { borderTopWidth: 2, borderTopColor: colors.divider, marginTop: spacing.md, paddingTop: spacing.md },
  sumRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  sumLabel: { fontSize: 13, color: colors.muted, fontFamily: font.display },
  sumValue: { fontSize: 14, color: colors.onSurface, fontFamily: font.mono, fontWeight: "700" },

  footer: {
    borderTopWidth: 2, borderTopColor: colors.borderStrong,
    padding: spacing.lg, backgroundColor: colors.surface, gap: spacing.sm,
  },
  err: {
    color: colors.error, backgroundColor: "#FEE2E2", borderWidth: 2, borderColor: colors.error,
    padding: spacing.sm, fontFamily: font.display, fontWeight: "700",
  },
});
