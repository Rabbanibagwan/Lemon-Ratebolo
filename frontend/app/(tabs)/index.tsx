import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, BagWallet, Dashboard } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { useWorkingDate } from "@/src/context/WorkingDateContext";
import { colors, font, money, spacing } from "@/src/theme";
import { DatePickerModal } from "@/src/components/DatePickerModal";

export default function Home() {
  const { session } = useAuth();
  const router = useRouter();
  const { workingDate, workingDateISO, displayDate, isWorkingToday, setWorkingDate } = useWorkingDate();
  const [data, setData] = useState<Dashboard | null>(null);
  const [wallet, setWallet] = useState<BagWallet | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const isOwner = session?.role === "owner";

  const load = useCallback(async (iso?: string) => {
    const day = iso || workingDateISO;
    try {
      setLoading(true);
      const d = await api.get<Dashboard>(`/dashboard?date=${day}`);
      setData(d);
      if (session?.role === "owner") {
        try {
          setWallet(await api.get<BagWallet>("/billing/wallet"));
        } catch {
          setWallet(null);
        }
      } else {
        setWallet(null);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [workingDateISO, session?.role]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onApplyDate = (d: Date | null) => {
    setShowPicker(false);
    if (d) {
      setWorkingDate(d);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      load(`${yyyy}-${mm}-${dd}`);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.hello}>
            {session?.role === "counter" ? "COUNTER" : "OWNER"} · {session?.display_name}
          </Text>
          <Text style={styles.shop} numberOfLines={1} testID="home-shop-name">{session?.shop_name || "—"}</Text>
        </View>
        <Pressable style={styles.dateBox} onPress={() => setShowPicker(true)} testID="home-date-picker">
          <Text style={styles.dateLabel}>{isWorkingToday ? "TODAY" : "WORKING DATE"}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={styles.dateValue}>{displayDate}</Text>
            <Ionicons name="calendar-outline" size={14} color={colors.onSurface} />
          </View>
        </Pressable>
      </View>

      {showPicker ? (
        <DatePickerModal
          visible={showPicker}
          value={workingDate}
          onCancel={() => setShowPicker(false)}
          onApply={onApplyDate}
          title="WORKING DATE"
          maximumDate={new Date(2100, 11, 31)}
        />
      ) : null}

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} tintColor={colors.brandPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>{isWorkingToday ? "Today · Snapshot" : `${displayDate} · Snapshot`}</Text>

        <View style={styles.kpiGrid}>
          {isOwner ? (
            <>
              <KPI big label="Farmer Payout" value={money(data?.today_farmer_payout || 0)} accent testID="kpi-payout" />
              <KPI label="Gross" value={money(data?.today_gross || 0)} testID="kpi-gross" />
            </>
          ) : null}
          <KPI label="Pattis" value={String(data?.today_pattis ?? 0)} testID="kpi-pattis" />
          <KPI label="Lots" value={String(data?.today_lots ?? 0)} testID="kpi-lots" />
          <KPI label="Bags" value={String(data?.today_bags ?? 0)} testID="kpi-bags" />
          <KPI label="Pending" value={String(data?.today_pending ?? 0)} accent={(data?.today_pending ?? 0) > 0} testID="kpi-pending" />
        </View>

        {isOwner && wallet ? (
          <>
            <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>Bag Balance</Text>
            <Pressable
              style={styles.bagCard}
              onPress={() => router.push("/billing")}
              testID="home-bag-wallet"
            >
              <Text style={styles.bagAvailLabel}>TOTAL AVAILABLE</Text>
              <Text style={styles.bagAvailValue}>{wallet.total_available.toLocaleString()} BAGS</Text>
              {wallet.low_balance ? (
                <Text style={styles.bagWarn}>Only {wallet.total_available} bags remaining.</Text>
              ) : null}
              <Text style={styles.bagLine}>
                FREE {wallet.free_used.toLocaleString()} / {wallet.free_allocated.toLocaleString()} USED · REMAINING {wallet.free_remaining.toLocaleString()}
              </Text>
              <Text style={styles.bagLine}>
                PURCHASED {wallet.purchased_bags.toLocaleString()} · USED {wallet.purchased_used.toLocaleString()} · {money(wallet.price_per_bag)} / BAG
              </Text>
              <Text style={styles.bagCta}>PURCHASE BAGS →</Text>
            </Pressable>
          </>
        ) : null}

        {isOwner ? (
          <>
            <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>Shop</Text>
            <View style={styles.kpiGrid}>
              <KPI label="Farmers" value={String(data?.total_farmers ?? 0)} onPress={() => router.push("/(tabs)/directory")} testID="kpi-farmers" />
              <KPI label="Vendors" value={String(data?.total_vendors ?? 0)} onPress={() => router.push("/vendors")} testID="kpi-vendors" />
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>Vendors</Text>
            <View style={styles.kpiGrid}>
              <KPI label="Vendors" value={String(data?.total_vendors ?? 0)} onPress={() => router.push("/vendors")} testID="kpi-vendors" />
            </View>
          </>
        )}

        <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>Quick Actions</Text>
        <View style={styles.quickRow}>
          <QuickTile icon="search-outline" label="Search" onPress={() => router.push("/search")} testID="quick-search" />
          <QuickTile icon="qr-code-outline" label="Scan Patti" onPress={() => router.push("/scan")} testID="quick-scan" />
          <QuickTile icon="add-circle-outline" label="Create Action Diary" onPress={() => router.push("/action-diary")} testID="quick-action-diary" />
          <QuickTile icon="document-text-outline" label="Patti Details" onPress={() => router.push("/(tabs)/history")} testID="quick-pattis" />
          <QuickTile icon="cash-outline" label="Vendors" onPress={() => router.push("/vendors")} testID="quick-vendors" />
          {isOwner && <QuickTile icon="book-outline" label="Account Ledger" onPress={() => router.push("/account-ledger")} testID="quick-ledger" />}
          {isOwner && <QuickTile icon="bag-handle-outline" label="Bag Balance" onPress={() => router.push("/billing")} testID="quick-billing" />}
        </View>
      </ScrollView>

      <Pressable
        style={({ pressed }) => [styles.fab, { opacity: pressed ? 0.85 : 1 }]}
        onPress={() => router.push("/action-diary")}
        testID="home-create-diary-fab"
      >
        <Ionicons name="add-circle" size={20} color={colors.onBrandPrimary} />
        <Text style={styles.fabText}>CREATE ACTION DIARY</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function KPI({ label, value, big, accent, onPress, testID }: { label: string; value: string; big?: boolean; accent?: boolean; onPress?: () => void; testID?: string }) {
  const C: any = onPress ? Pressable : View;
  return (
    <C
      testID={testID}
      onPress={onPress}
      style={[styles.kpi, big && styles.kpiBig, accent && { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse }]}
    >
      <Text style={[styles.kpiLabel, accent && { color: "#9CA3AF" }]}>{label}</Text>
      <Text style={[styles.kpiValue, big && styles.kpiValueBig, accent && { color: colors.onSurfaceInverse }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </C>
  );
}

function QuickTile({ icon, label, onPress, testID }: { icon: any; label: string; onPress?: () => void; testID?: string }) {
  return (
    <Pressable style={({ pressed }) => [styles.quickTile, pressed && { backgroundColor: colors.surfaceSecondary }]} onPress={onPress} testID={testID}>
      <Ionicons name={icon} size={22} color={colors.onSurface} />
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "flex-end", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong, backgroundColor: colors.surface,
  },
  hello: { fontSize: 11, letterSpacing: 1.5, color: colors.muted, textTransform: "uppercase", fontFamily: font.display, fontWeight: "800" },
  shop: { fontSize: 24, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.3 },
  dateBox: { borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 10, paddingVertical: 6, alignItems: "flex-end" },
  dateLabel: { fontSize: 9, fontFamily: font.display, letterSpacing: 1, color: colors.muted, fontWeight: "800" },
  dateValue: { fontSize: 13, fontFamily: font.mono, color: colors.onSurface, fontWeight: "700" },
  sectionLabel: { fontSize: 11, letterSpacing: 2, color: colors.muted, textTransform: "uppercase", marginBottom: spacing.sm, fontFamily: font.display, fontWeight: "800" },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  kpi: {
    flexBasis: "48%", flexGrow: 1, borderWidth: 2, borderColor: colors.borderStrong,
    padding: spacing.md, minHeight: 88, justifyContent: "space-between", backgroundColor: colors.surface,
  },
  kpiBig: { flexBasis: "100%", minHeight: 120 },
  kpiLabel: { fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: colors.muted, fontFamily: font.display, fontWeight: "800" },
  kpiValue: { fontSize: 22, fontWeight: "800", color: colors.onSurface, fontFamily: font.mono },
  kpiValueBig: { fontSize: 32 },
  quickRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  quickTile: {
    flexBasis: "31%", flexGrow: 1, borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md,
    alignItems: "center", justifyContent: "center", gap: 6, minHeight: 78,
  },
  quickLabel: { fontSize: 11, fontFamily: font.display, fontWeight: "800", letterSpacing: 1, color: colors.onSurface, textTransform: "uppercase", textAlign: "center" },
  fab: {
    position: "absolute", left: spacing.lg, right: spacing.lg, bottom: spacing.lg + 62,
    backgroundColor: colors.brandPrimary, borderWidth: 2, borderColor: colors.brand,
    paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  fabText: { color: colors.onBrandPrimary, fontFamily: font.display, fontWeight: "900", letterSpacing: 1, fontSize: 14 },
  bagCard: {
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, gap: 4, backgroundColor: colors.surface,
  },
  bagAvailLabel: { fontSize: 11, letterSpacing: 1.5, color: colors.muted, fontFamily: font.display, fontWeight: "800" },
  bagAvailValue: { fontSize: 26, fontWeight: "900", fontFamily: font.mono, color: colors.onSurface },
  bagWarn: { fontSize: 13, color: "#B45309", fontFamily: font.display, fontWeight: "700", marginTop: 2 },
  bagLine: { fontSize: 12, color: colors.onSurface, fontFamily: font.mono, marginTop: 2 },
  bagCta: { marginTop: 8, fontSize: 12, letterSpacing: 1, fontWeight: "900", fontFamily: font.display, color: colors.brandPrimary },
});
