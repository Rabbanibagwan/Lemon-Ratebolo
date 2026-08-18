import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, Farmer, LedgerAccountType, LedgerTxnType, Vendor, apiErrorMessage } from "@/src/api";
import { routeParam } from "@/src/utils/route-params";
import { Button, Input } from "@/src/components/ui";
import { PartyPicker } from "@/src/components/PartyPicker";
import { colors, font, spacing } from "@/src/theme";
import { useWorkingDate } from "@/src/context/WorkingDateContext";

export default function NewLedgerTxn() {
  const params = useLocalSearchParams<{ kind?: string; party_id?: string }>();
  const kind = routeParam(params.kind);
  const party_id = routeParam(params.party_id) || undefined;
  const router = useRouter();
  const { workingDateISO, displayDate } = useWorkingDate();
  const accountType: LedgerAccountType = (kind || "").toUpperCase() === "VENDOR" ? "VENDOR" : "FARMER";

  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [farmerId, setFarmerId] = useState<string | null>(accountType === "FARMER" ? party_id || null : null);
  const [vendorId, setVendorId] = useState<string | null>(accountType === "VENDOR" ? party_id || null : null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [txnType, setTxnType] = useState<LedgerTxnType>("CREDIT");
  const [amount, setAmount] = useState("");
  const [details, setDetails] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      if (accountType === "FARMER") {
        const fs = await api.get<Farmer[]>("/farmers");
        setFarmers(fs);
      } else {
        const vs = await api.get<Vendor[]>("/vendors");
        setVendors(vs);
      }
    } catch { /* keep */ }
  }, [accountType]);

  useEffect(() => { load(); }, [load]);

  const farmer = farmers.find((f) => f.id === farmerId);
  const vendor = vendors.find((v) => v.id === vendorId);
  const selectedName = accountType === "FARMER" ? farmer?.name : vendor?.name;

  const save = async () => {
    setError(null);
    const n = Number(amount);
    if (!selectedName) {
      setError(accountType === "FARMER" ? "Select a Farmer" : "Select a Vendor");
      return;
    }
    if (!(n > 0)) {
      setError("Enter amount");
      return;
    }
    if (!details.trim()) {
      setError("Enter details");
      return;
    }
    try {
      setSaving(true);
      await api.post("/account-ledger", {
        account_type: accountType,
        farmer_id: accountType === "FARMER" ? farmerId : null,
        vendor_id: accountType === "VENDOR" ? vendorId : null,
        date: workingDateISO,
        transaction_type: txnType,
        amount: n,
        description: details.trim(),
        remarks: remarks.trim() || null,
      });
      const id = accountType === "FARMER" ? farmerId : vendorId;
      router.replace({
        pathname: "/account-ledger/[kind]/[id]",
        params: { kind: accountType === "FARMER" ? "farmer" : "vendor", id: id || "" },
      });
    } catch (e) {
      setError(apiErrorMessage(e, "Could not save transaction"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>ADD TRANSACTION</Text>
      </View>

      <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>{accountType === "FARMER" ? "FARMER" : "VENDOR"}</Text>
        <Pressable style={styles.pickBox} onPress={() => setPickerOpen(true)} testID="ledger-pick-party">
          <Text style={[styles.pickText, !selectedName && { color: colors.muted }]} numberOfLines={1}>
            {selectedName || (accountType === "FARMER" ? "Select Farmer" : "Select Vendor")}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>

        <Text style={styles.label}>TRANSACTION TYPE</Text>
        <View style={styles.tabsRow}>
          {(["CREDIT", "DEBIT"] as LedgerTxnType[]).map((t) => (
            <Pressable
              key={t}
              style={[styles.tabBtn, txnType === t && styles.tabBtnOn]}
              onPress={() => setTxnType(t)}
              testID={`ledger-type-${t.toLowerCase()}`}
            >
              <Text style={[styles.tabText, txnType === t && styles.tabTextOn]}>{t}</Text>
            </Pressable>
          ))}
        </View>

        <Input
          label="AMOUNT ₹"
          value={amount}
          onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ""))}
          keyboardType="decimal-pad"
          placeholder="0"
          testID="ledger-amount"
        />
        <Input
          label="DETAILS"
          value={details}
          onChangeText={setDetails}
          placeholder="e.g. Previous balance adjustment"
          testID="ledger-details"
        />

        <Text style={styles.label}>DATE</Text>
        <View style={styles.dateBox}>
          <Text style={styles.dateVal}>{displayDate}</Text>
          <Text style={styles.hint}>Uses the global working date</Text>
        </View>

        <Input
          label="REMARKS (optional)"
          value={remarks}
          onChangeText={setRemarks}
          placeholder="Optional note"
          testID="ledger-remarks"
        />

        {error ? <Text style={styles.err}>{error}</Text> : null}
        <Button label="SAVE" onPress={save} loading={saving} testID="ledger-save" />
      </KeyboardAwareScrollView>

      <PartyPicker
        visible={pickerOpen}
        kind={accountType === "FARMER" ? "farmer" : "vendor"}
        items={accountType === "FARMER" ? farmers : vendors}
        selectedId={accountType === "FARMER" ? farmerId : vendorId}
        onClose={() => setPickerOpen(false)}
        onSelect={(item) => {
          if (accountType === "FARMER") setFarmerId(item.id);
          else setVendorId(item.id);
          setPickerOpen(false);
        }}
        onCreated={(item) => {
          if (accountType === "FARMER") {
            setFarmers((xs) => [...xs, item as Farmer].sort((a, b) => a.name.localeCompare(b.name)));
            setFarmerId(item.id);
          } else {
            setVendors((xs) => [...xs, item as Vendor].sort((a, b) => a.name.localeCompare(b.name)));
            setVendorId(item.id);
          }
          setPickerOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  headerTitle: { fontSize: 18, fontWeight: "900", fontFamily: font.display, color: colors.onSurface },
  label: {
    fontSize: 11, letterSpacing: 1.5, color: colors.muted, textTransform: "uppercase",
    fontFamily: font.display, fontWeight: "800", marginBottom: 6, marginTop: 4,
  },
  pickBox: {
    flexDirection: "row", alignItems: "center", borderWidth: 2, borderColor: colors.borderStrong,
    paddingHorizontal: 12, paddingVertical: 14, marginBottom: spacing.md, gap: 8,
  },
  pickText: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.onSurface, fontFamily: font.display },
  tabsRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  tabBtn: { flex: 1, borderWidth: 2, borderColor: colors.borderStrong, paddingVertical: 12, alignItems: "center" },
  tabBtnOn: { backgroundColor: colors.surfaceInverse },
  tabText: { fontSize: 13, fontFamily: font.display, fontWeight: "800", letterSpacing: 1, color: colors.onSurface },
  tabTextOn: { color: colors.onSurfaceInverse },
  dateBox: { borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, marginBottom: spacing.md },
  dateVal: { fontSize: 16, fontFamily: font.mono, fontWeight: "800", color: colors.onSurface },
  hint: { fontSize: 11, color: colors.muted, marginTop: 4 },
  err: { color: colors.error, fontWeight: "700", marginBottom: spacing.md },
});
