import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, PendingVendorBill, VendorBill } from "@/src/api";
import { colors, font, money, spacing } from "@/src/theme";
import { Empty } from "@/src/components/ui";
import { useWorkingDate } from "@/src/context/WorkingDateContext";
import { DatePickerModal } from "@/src/components/DatePickerModal";
import { routeParam } from "@/src/utils/route-params";

type Tab = "pending" | "posted";

function bagsLabel(n: number): string {
  return `${n} ${n === 1 ? "BAG" : "BAGS"}`;
}

export default function VendorsList() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string; highlight?: string }>();
  const tabParam = routeParam(params.tab);
  const highlightId = routeParam(params.highlight);
  const { workingDate, workingDateISO, displayDate, setWorkingDate } = useWorkingDate();
  const [tab, setTab] = useState<Tab>(tabParam === "posted" ? "posted" : "pending");
  const [pending, setPending] = useState<PendingVendorBill[]>([]);
  const [posted, setPosted] = useState<VendorBill[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [p, bills] = await Promise.all([
        api.get<PendingVendorBill[]>(`/vendor-bills/pending-summary?date=${workingDateISO}`),
        api.get<VendorBill[]>(`/vendor-bills?date=${workingDateISO}`),
      ]);
      setPending(p);
      setPosted(bills.filter((b) => b.status !== "deleted"));
    } catch {
      /* keep previous */
    } finally {
      setLoading(false);
    }
  }, [workingDateISO]);

  useFocusEffect(useCallback(() => {
    if (tabParam === "posted" || tabParam === "pending") {
      setTab(tabParam);
    }
    load();
  }, [load, tabParam]));

  const filteredPending = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return pending;
    return pending.filter((r) =>
      r.vendor_name.toLowerCase().includes(s)
      || (r.vendor_details || "").toLowerCase().includes(s)
      || (r.phone || "").includes(s));
  }, [pending, q]);

  const filteredPosted = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return posted;
    return posted.filter((b) =>
      b.vendor_name.toLowerCase().includes(s)
      || (b.vendor_details || "").toLowerCase().includes(s)
      || b.bill_code.toLowerCase().includes(s)
      || String(b.bill_no).includes(s)
      || b.status.toLowerCase().includes(s));
  }, [posted, q]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="vendors-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>VENDORS</Text>
          <Pressable onPress={() => setShowPicker(true)} style={styles.dateTap} testID="vendors-date-picker">
            <Text style={styles.headerSub}>{displayDate}</Text>
            <Ionicons name="calendar-outline" size={13} color={colors.onSurface} />
          </Pressable>
        </View>
      </View>

      {showPicker ? (
        <DatePickerModal
          visible={showPicker}
          value={workingDate}
          onCancel={() => setShowPicker(false)}
          onApply={(d) => {
            setShowPicker(false);
            if (d) setWorkingDate(d);
          }}
          title="WORKING DATE"
          maximumDate={new Date(2100, 11, 31)}
        />
      ) : null}

      <View style={styles.tabsRow}>
        <Pressable
          style={[styles.tabBtn, tab === "pending" && styles.tabBtnOn]}
          onPress={() => setTab("pending")}
          testID="vendors-tab-pending"
        >
          <Text style={[styles.tabText, tab === "pending" && styles.tabTextOn]}>
            PENDING BILLS · {filteredPending.length}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tabBtn, tab === "posted" && styles.tabBtnOn]}
          onPress={() => setTab("posted")}
          testID="vendors-tab-posted"
        >
          <Text style={[styles.tabText, tab === "posted" && styles.tabTextOn]}>
            POSTED BILLS · {filteredPosted.length}
          </Text>
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search name, details, phone…"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          testID="vendors-search"
        />
      </View>

      {tab === "pending" ? (
        <FlatList
          data={filteredPending}
          keyExtractor={(x) => x.vendor_id}
          extraData={workingDateISO}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 140 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brandPrimary} />}
          ListEmptyComponent={
            <Empty title="No pending bills" subtitle="Purchases for this date will appear here until a Vendor Bill is saved." />
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push({ pathname: "/vendor-bill/new", params: { vendor_id: item.vendor_id } })}
              testID={`pending-vendor-${item.vendor_id}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{item.vendor_name}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.bags}>{bagsLabel(item.total_bags)}</Text>
                <Text style={styles.amount}>{money(item.grand_total)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={filteredPosted}
          keyExtractor={(x) => x.id}
          extraData={workingDateISO}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 140 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brandPrimary} />}
          ListEmptyComponent={
            <Empty title="No posted bills" subtitle="Saved Vendor Bills for this date appear here." />
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.postedCard}
              onPress={() => router.push({ pathname: "/vendor-bill/[id]", params: { id: item.id } })}
              testID={`posted-bill-${item.id}`}
            >
              <View style={styles.postedTop}>
                <Text style={styles.name} numberOfLines={1}>{item.vendor_name}</Text>
                <StatusChip status={item.status} />
              </View>
              <Text style={styles.billCode}>{item.bill_code}</Text>
              <View style={styles.postedRow}>
                <Text style={styles.bags}>{bagsLabel(item.total_bags)}</Text>
                <Text style={styles.amount}>{money(item.grand_total)}</Text>
              </View>
              <View style={styles.postedRow}>
                <Text style={styles.meta}>Paid {money(item.paid)}</Text>
                <Text style={[styles.meta, item.balance > 0 && { color: colors.error, fontWeight: "800" }]}>
                  Balance Due {money(item.balance)}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
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
  headerSub: { fontSize: 13, color: colors.onSurface, letterSpacing: 0.4, fontWeight: "800", fontFamily: font.display },
  dateTap: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2, alignSelf: "flex-start" },
  tabsRow: { flexDirection: "row", paddingHorizontal: spacing.lg, marginTop: spacing.md, gap: 0 },
  tabBtn: { flex: 1, borderWidth: 2, borderColor: colors.borderStrong, paddingVertical: 12, alignItems: "center", backgroundColor: colors.surface },
  tabBtnOn: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  tabText: { fontSize: 11, letterSpacing: 0.6, fontFamily: font.display, fontWeight: "800", color: colors.muted },
  tabTextOn: { color: colors.onSurfaceInverse },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.md,
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, height: 44,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: 15 },
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, backgroundColor: colors.surface,
  },
  postedCard: {
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, backgroundColor: colors.surface,
  },
  postedTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  postedRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
  name: { fontSize: 16, fontWeight: "800", color: colors.onSurface, fontFamily: font.display },
  bags: { fontSize: 12, fontWeight: "800", color: colors.onSurface, fontFamily: font.display, letterSpacing: 0.6 },
  amount: { fontSize: 16, fontWeight: "800", fontFamily: font.mono, color: colors.onSurface, marginTop: 2 },
  billCode: { fontSize: 13, fontWeight: "800", color: colors.muted, fontFamily: font.display, marginTop: 4, letterSpacing: 0.5 },
  meta: { fontSize: 12, color: colors.muted, fontFamily: font.mono, fontWeight: "700" },
});
