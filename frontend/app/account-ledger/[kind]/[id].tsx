import { useCallback, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, LedgerAccountType, LedgerDetail, Settings } from "@/src/api";
import { routeParam } from "@/src/utils/route-params";
import { colors, font, money, spacing } from "@/src/theme";
import { useWorkingDate } from "@/src/context/WorkingDateContext";
import { clampPaperMm, thermalPrintUserMessage } from "@/src/utils/thermal-print";
import { shareLedgerPdf, thermalPrintLedger } from "@/src/utils/ledger-print";

function cellAmt(n: number): string {
  return n > 0.0001 ? money(n) : "—";
}

export default function LedgerDetailScreen() {
  const params = useLocalSearchParams<{ kind: string; id: string }>();
  const kind = routeParam(params.kind);
  const id = routeParam(params.id);
  const router = useRouter();
  const { workingDateISO, displayDate } = useWorkingDate();
  const accountType: LedgerAccountType = (kind || "").toLowerCase() === "vendor" ? "VENDOR" : "FARMER";

  const [data, setData] = useState<LedgerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const d = await api.get<LedgerDetail>(
        `/account-ledger/detail?account_type=${accountType}&party_id=${encodeURIComponent(id)}&date=${workingDateISO}`,
      );
      setData(d);
    } catch (e) {
      setData(null);
      console.warn("Ledger detail failed", e);
    } finally {
      setLoading(false);
    }
  }, [accountType, id, workingDateISO]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const share = async () => {
    if (!data) return;
    try {
      setBusy(true);
      await shareLedgerPdf(data);
    } catch {
      Alert.alert("Share failed", "Could not prepare the PDF. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const printThermal = async () => {
    if (!data) return;
    try {
      setBusy(true);
      const settings = await api.get<Settings>("/settings").catch(() => null);
      const paperMm = clampPaperMm(settings?.thermal_paper_width_mm || 80);
      await thermalPrintLedger(data, paperMm);
    } catch (e) {
      Alert.alert("Print failed", thermalPrintUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>ACCOUNT LEDGER · {accountType}</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{data?.party_name || "…"}</Text>
          <Text style={styles.headerSub}>{displayDate}</Text>
        </View>
      </View>

      {loading && !data ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 160 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brandPrimary} />}
        >
          <View style={styles.tableHead}>
            <Text style={[styles.th, { flex: 1.1 }]}>DATE</Text>
            <Text style={[styles.th, { flex: 1.6 }]}>DETAILS</Text>
            <Text style={[styles.th, styles.right, { flex: 1.2 }]}>CREDIT</Text>
            <Text style={[styles.th, styles.right, { flex: 1.2 }]}>DEBIT</Text>
            <Text style={[styles.th, styles.right, { flex: 1.3 }]}>BAL</Text>
          </View>

          {(data?.rows || []).length === 0 ? (
            <Text style={styles.empty}>No transactions on this working date.</Text>
          ) : (
            data?.rows.map((r) => (
              <View key={r.id} style={styles.tr} testID={`ledger-row-${r.id}`}>
                <Text style={[styles.td, { flex: 1.1 }]}>{r.date.slice(8)}</Text>
                <Text style={[styles.td, { flex: 1.6 }]} numberOfLines={2}>{r.description}</Text>
                <Text style={[styles.td, styles.right, styles.mono, { flex: 1.2 }]}>{cellAmt(r.credit)}</Text>
                <Text style={[styles.td, styles.right, styles.mono, { flex: 1.2 }]}>{cellAmt(r.debit)}</Text>
                <Text style={[styles.td, styles.right, styles.mono, styles.strong, { flex: 1.3 }]}>{money(r.balance)}</Text>
              </View>
            ))
          )}

          {accountType === "VENDOR" && (data?.bills || []).map((b) => (
            <View key={b.id} style={styles.billBox}>
              <Text style={styles.billLine}>Vendor Bill: {b.bill_code}</Text>
              <Text style={styles.billLine}>Paid Amount: {money(b.paid)}</Text>
              <Text style={styles.billLine}>Balance: {money(b.balance)}</Text>
              <Text style={styles.billLine}>Status: {(b.status || "").toUpperCase()}</Text>
            </View>
          ))}

          <View style={styles.totals}>
            <View style={styles.totRow}>
              <Text style={styles.totL}>TOTAL CREDIT</Text>
              <Text style={styles.totV}>{money(data?.total_credit || 0)}</Text>
            </View>
            <View style={styles.totRow}>
              <Text style={styles.totL}>TOTAL DEBIT</Text>
              <Text style={styles.totV}>{money(data?.total_debit || 0)}</Text>
            </View>
            <View style={styles.balRow}>
              <Text style={styles.balL}>BALANCE</Text>
              <Text style={styles.balV}>{money(data?.balance || 0)}</Text>
            </View>
          </View>
        </ScrollView>
      )}

      <View style={styles.footer}>
        <Pressable style={styles.footBtn} onPress={share} disabled={busy || !data} testID="ledger-share">
          <Ionicons name="share-social-outline" size={16} color={colors.onSurface} />
          <Text style={styles.footTxt}>SHARE PDF</Text>
        </Pressable>
        <Pressable style={styles.footBtn} onPress={printThermal} disabled={busy || !data} testID="ledger-print">
          <Ionicons name="print-outline" size={16} color={colors.onSurface} />
          <Text style={styles.footTxt}>PRINT</Text>
        </Pressable>
        <Pressable
          style={[styles.footBtn, styles.footPrimary]}
          onPress={() => router.push({
            pathname: "/account-ledger/new",
            params: { kind: accountType, party_id: id },
          })}
          testID="ledger-detail-add"
        >
          <Ionicons name="add" size={16} color={colors.onBrandPrimary} />
          <Text style={[styles.footTxt, { color: colors.onBrandPrimary }]}>ADD</Text>
        </Pressable>
      </View>
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
  kicker: { fontSize: 10, letterSpacing: 1.4, color: colors.muted, fontWeight: "800", fontFamily: font.display },
  headerTitle: { fontSize: 20, fontWeight: "900", fontFamily: font.display, color: colors.onSurface },
  headerSub: { fontSize: 13, fontFamily: font.mono, fontWeight: "700", color: colors.onSurface },
  tableHead: {
    flexDirection: "row", borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
    paddingBottom: 6, marginBottom: 4,
  },
  th: { fontSize: 9, letterSpacing: 0.6, fontWeight: "800", color: colors.muted, fontFamily: font.display },
  tr: {
    flexDirection: "row", alignItems: "flex-start",
    borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: 8, gap: 2,
  },
  td: { fontSize: 11, color: colors.onSurface, fontFamily: font.display },
  right: { textAlign: "right" },
  mono: { fontFamily: font.mono, fontSize: 10 },
  strong: { fontWeight: "800" },
  empty: { color: colors.muted, marginTop: spacing.md, fontFamily: font.display },
  billBox: { borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, marginTop: spacing.md },
  billLine: { fontSize: 13, fontWeight: "700", fontFamily: font.display, marginBottom: 2 },
  totals: { marginTop: spacing.lg, borderTopWidth: 2, borderTopColor: colors.borderStrong, paddingTop: spacing.md },
  totRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  totL: { fontSize: 11, letterSpacing: 1, fontWeight: "800", color: colors.muted, fontFamily: font.display },
  totV: { fontSize: 15, fontWeight: "800", fontFamily: font.mono },
  balRow: {
    marginTop: spacing.sm, backgroundColor: colors.surfaceInverse,
    padding: spacing.md, flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  balL: { color: colors.onSurfaceInverse, fontWeight: "900", letterSpacing: 1.2, fontFamily: font.display },
  balV: { color: colors.onSurfaceInverse, fontWeight: "900", fontSize: 20, fontFamily: font.mono },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", gap: spacing.sm, padding: spacing.lg,
    backgroundColor: colors.surface, borderTopWidth: 2, borderTopColor: colors.borderStrong,
  },
  footBtn: {
    flex: 1, borderWidth: 2, borderColor: colors.borderStrong, paddingVertical: 12,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
  },
  footPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brand },
  footTxt: { fontSize: 11, fontWeight: "900", letterSpacing: 0.6, fontFamily: font.display, color: colors.onSurface },
});
