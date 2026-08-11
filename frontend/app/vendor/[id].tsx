import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, VendorBill, VendorDashboard, VendorPayment } from "@/src/api";
import { colors, font, money, spacing } from "@/src/theme";
import { Empty } from "@/src/components/ui";
import { useAuth } from "@/src/context/AuthContext";

type Tab = "bills" | "payments";

export default function VendorDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const isOwner = session?.role === "owner";
  const [tab, setTab] = useState<Tab>("bills");
  const [dash, setDash] = useState<VendorDashboard | null>(null);
  const [bills, setBills] = useState<VendorBill[]>([]);
  const [payments, setPayments] = useState<VendorPayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const [d, bs, ps] = await Promise.all([
        api.get<VendorDashboard>(`/vendors/${id}/dashboard`),
        api.get<VendorBill[]>(`/vendor-bills?vendor_id=${id}`),
        isOwner ? api.get<VendorPayment[]>(`/vendor-payments?vendor_id=${id}`) : Promise.resolve([]),
      ]);
      setDash(d); setBills(bs); setPayments(ps);
    } catch {
      /* silent */
    } finally { setLoading(false); }
  }, [id, isOwner]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filteredBills = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return bills;
    return bills.filter((b) =>
      b.bill_code.toLowerCase().includes(s)
      || String(b.bill_no).includes(s)
      || b.date.includes(s)
      || b.lines.some((l) => l.farmer_name.toLowerCase().includes(s) || l.lot_no.toLowerCase().includes(s))
      || (b.vendor_details || "").toLowerCase().includes(s)
    );
  }, [bills, q]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="vendor-detail-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{dash?.vendor_name || "VENDOR"}</Text>
          <Text style={styles.headerSub}>Ledger · {dash?.total_bills || 0} bills</Text>
        </View>
      </View>

      <View style={styles.summaryRow}>
        <SummaryBox label="Purchase" value={money(dash?.total_purchase || 0)} />
        <SummaryBox label="Paid" value={money(dash?.total_paid || 0)} />
        <SummaryBox label="Due" value={money(dash?.outstanding || 0)} dark />
      </View>

      <View style={styles.actionsRow}>
        <Pressable
          style={styles.actionBtn}
          onPress={() => router.push({ pathname: "/vendor-bill/new", params: { vendor_id: id } })}
          testID="vendor-new-bill"
        >
          <Ionicons name="document-text-outline" size={16} color={colors.onSurface} />
          <Text style={styles.actionText}>NEW BILL</Text>
        </Pressable>
        {isOwner ? (
          <Pressable
            style={[styles.actionBtn, styles.actionBtnPrimary]}
            onPress={() => router.push({ pathname: "/vendor-payment/new", params: { vendor_id: id } })}
            testID="vendor-receive-payment"
          >
            <Ionicons name="cash-outline" size={16} color={colors.onBrandPrimary} />
            <Text style={[styles.actionText, { color: colors.onBrandPrimary }]}>RECEIVE PAYMENT</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Bill #, farmer, lot, date…"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          testID="vendor-bill-search"
        />
      </View>

      <View style={styles.tabsRow}>
        <Pressable style={[styles.tabBtn, tab === "bills" && styles.tabBtnOn]} onPress={() => setTab("bills")} testID="tab-bills">
          <Text style={[styles.tabText, tab === "bills" && styles.tabTextOn]}>BILLS · {filteredBills.length}</Text>
        </Pressable>
        {isOwner ? (
          <Pressable style={[styles.tabBtn, tab === "payments" && styles.tabBtnOn]} onPress={() => setTab("payments")} testID="tab-payments">
            <Text style={[styles.tabText, tab === "payments" && styles.tabTextOn]}>PAYMENTS · {payments.length}</Text>
          </Pressable>
        ) : null}
      </View>

      {tab === "bills" || !isOwner ? (
        <FlatList
          data={filteredBills}
          keyExtractor={(x) => x.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brandPrimary} />}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 140 }}
          ListEmptyComponent={<Empty title="No bills yet" subtitle="Tap NEW BILL to create." />}
          renderItem={({ item }) => (
            <Pressable
              style={styles.billCard}
              onPress={() => router.push({ pathname: "/vendor-bill/[id]", params: { id: item.id } })}
              testID={`bill-row-${item.id}`}
            >
              <View style={styles.billTop}>
                <Text style={styles.billNo}>{item.bill_code}</Text>
                <StatusChip status={item.status} />
              </View>
              <View style={styles.billMid}>
                <Text style={styles.billMeta}>{item.date} · {item.total_bags} bags</Text>
                <Text style={styles.billTotal}>{money(item.grand_total)}</Text>
              </View>
              <View style={styles.billBottom}>
                <Text style={styles.billMeta}>Paid {money(item.paid)}</Text>
                <Text style={[styles.billBal, item.balance > 0 && { color: colors.error }]}>Due {money(item.balance)}</Text>
              </View>
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={payments}
          keyExtractor={(x) => x.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brandPrimary} />}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 140 }}
          ListEmptyComponent={<Empty title="No payments yet" subtitle="Tap RECEIVE PAYMENT to record." />}
          renderItem={({ item }) => (
            <View style={styles.payCard}>
              <View style={styles.billTop}>
                <Text style={styles.billNo}>{item.date}</Text>
                <Text style={styles.mode}>{item.mode.toUpperCase()}</Text>
              </View>
              <View style={styles.billMid}>
                <Text style={styles.billMeta}>{item.allocations.length} bill(s) allocated</Text>
                <Text style={styles.billTotal}>{money(item.amount)}</Text>
              </View>
              {item.remarks ? <Text style={styles.remarks}>{item.remarks}</Text> : null}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function SummaryBox({ label, value, dark }: { label: string; value: string; dark?: boolean }) {
  return (
    <View style={[summaryStyles.box, dark && summaryStyles.dark]}>
      <Text style={[summaryStyles.label, dark && { color: "#9CA3AF" }]}>{label}</Text>
      <Text style={[summaryStyles.value, dark && { color: colors.onSurfaceInverse }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

function StatusChip({ status }: { status: VendorBill["status"] }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    unpaid: { bg: "#FEE2E2", fg: "#991B1B", label: "UNPAID" },
    partial: { bg: "#FEF3C7", fg: "#78350F", label: "PARTIAL" },
    paid: { bg: "#D1FAE5", fg: "#065F46", label: "PAID" },
    deleted: { bg: "#E5E7EB", fg: "#6B7280", label: "DELETED" },
  };
  const s = map[status] || map.unpaid;
  return (
    <View style={[chipStyles.chip, { backgroundColor: s.bg, borderColor: s.fg }]}>
      <Text style={[chipStyles.text, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

const summaryStyles = StyleSheet.create({
  box: { flex: 1, borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.sm, backgroundColor: colors.surface, minHeight: 62 },
  dark: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  label: { fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: colors.muted, fontFamily: font.display, fontWeight: "800" },
  value: { fontSize: 16, fontWeight: "800", color: colors.onSurface, fontFamily: font.mono, marginTop: 2 },
});
const chipStyles = StyleSheet.create({
  chip: { borderWidth: 1.5, paddingHorizontal: 8, paddingVertical: 2 },
  text: { fontSize: 10, letterSpacing: 1, fontWeight: "800", fontFamily: font.display },
});
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  headerTitle: { fontSize: 20, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.3 },
  headerSub: { fontSize: 11, color: colors.muted, letterSpacing: 1, fontWeight: "700" },

  summaryRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  actionsRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.md,
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, height: 44,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: 15 },
  actionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 2, borderColor: colors.borderStrong, paddingVertical: 12, backgroundColor: colors.surface,
  },
  actionBtnPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brand },
  actionText: { color: colors.onSurface, fontFamily: font.display, fontWeight: "800", letterSpacing: 1, fontSize: 12 },

  tabsRow: { flexDirection: "row", paddingHorizontal: spacing.lg, marginTop: spacing.lg, gap: 0 },
  tabBtn: { flex: 1, borderWidth: 2, borderColor: colors.borderStrong, paddingVertical: 10, alignItems: "center", backgroundColor: colors.surface },
  tabBtnOn: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  tabText: { fontSize: 11, letterSpacing: 1, fontFamily: font.display, fontWeight: "800", color: colors.muted },
  tabTextOn: { color: colors.onSurfaceInverse },

  billCard: { borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, backgroundColor: colors.surface },
  payCard: { borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, backgroundColor: colors.surface },
  billTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  billMid: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 },
  billBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
  billNo: { fontSize: 14, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: 0.5 },
  billMeta: { fontSize: 11, color: colors.muted, fontFamily: font.mono },
  billTotal: { fontSize: 16, fontWeight: "800", color: colors.onSurface, fontFamily: font.mono },
  billBal: { fontSize: 12, color: colors.muted, fontFamily: font.mono, fontWeight: "700" },
  mode: { fontSize: 10, letterSpacing: 1, color: colors.muted, fontFamily: font.display, fontWeight: "800" },
  remarks: { fontSize: 11, color: colors.muted, marginTop: 6, fontFamily: font.display },
});
