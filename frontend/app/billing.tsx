import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, apiErrorMessage, BagPurchase, BagUsageRow, BagWallet } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { Button, Input } from "@/src/components/ui";
import { colors, font, money, spacing } from "@/src/theme";

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
    const dd = String(d.getDate()).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${dd}-${months[d.getMonth()]}`;
  } catch {
    return String(iso).slice(0, 10);
  }
}

export default function BillingScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const isOwner = session?.role === "owner";

  const [wallet, setWallet] = useState<BagWallet | null>(null);
  const [purchases, setPurchases] = useState<BagPurchase[]>([]);
  const [usage, setUsage] = useState<BagUsageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [qty, setQty] = useState("1000");
  const [buying, setBuying] = useState(false);
  const [tab, setTab] = useState<"buy" | "purchases" | "usage">("buy");

  const load = useCallback(async () => {
    if (!isOwner) return;
    try {
      setLoading(true);
      const [w, p, u] = await Promise.all([
        api.get<BagWallet>("/billing/wallet"),
        api.get<BagPurchase[]>("/billing/purchases"),
        api.get<BagUsageRow[]>("/billing/usage?limit=100"),
      ]);
      setWallet(w);
      setPurchases(p);
      setUsage(u);
    } catch (e: any) {
      if (e?.status === 403) {
        Alert.alert("Merchant only", "Bag billing is for Merchant accounts.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      }
    } finally {
      setLoading(false);
    }
  }, [isOwner, router]);

  useFocusEffect(
    useCallback(() => {
      if (!isOwner) {
        Alert.alert("Merchant only", "Bag billing is for Merchant accounts.", [
          { text: "OK", onPress: () => router.back() },
        ]);
        return;
      }
      load();
    }, [isOwner, load, router]),
  );

  const bagsToBuy = useMemo(() => {
    const n = Math.floor(Number(qty));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [qty]);

  const quote = useMemo(() => {
    const price = wallet?.price_per_bag ?? 0;
    const base = Math.round(bagsToBuy * price * 100) / 100;
    return { price, base, total: base };
  }, [bagsToBuy, wallet?.price_per_bag]);

  const purchase = async () => {
    if (!bagsToBuy) {
      Alert.alert("Enter quantity", "Enter how many bags to purchase.");
      return;
    }
    try {
      setBuying(true);
      const pending = await api.post<BagPurchase>("/billing/purchases", { bags: bagsToBuy });
      // Dev / Admin-enabled test payment — balance increases only after backend confirm.
      const paid = await api.post<BagPurchase>(`/billing/purchases/${pending.id}/confirm-test`, {});
      Alert.alert(
        "Purchase successful",
        `${paid.bags.toLocaleString()} bags added.\nPaid ${money(paid.total_amount)} @ ${money(paid.price_per_bag)}/bag`,
      );
      setQty("1000");
      await load();
    } catch (e) {
      Alert.alert("Purchase failed", apiErrorMessage(e, "Could not complete purchase"));
    } finally {
      setBuying(false);
    }
  };

  if (!isOwner) {
    return <SafeAreaView style={styles.root} edges={["top"]} />;
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="billing-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>BAG BALANCE</Text>
          <Text style={styles.headerSub}>Merchant prepaid billing</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brandPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        {wallet ? (
          <View style={styles.card} testID="billing-wallet-card">
            <Text style={styles.cardLabel}>TOTAL AVAILABLE</Text>
            <Text style={styles.bigNum} testID="billing-total-available">
              {wallet.total_available.toLocaleString()} BAGS
            </Text>
            {wallet.low_balance ? (
              <Text style={styles.warn} testID="billing-low-warn">
                Only {wallet.total_available} bags remaining.
              </Text>
            ) : null}

            <View style={styles.row}>
              <Stat
                label="POOL (FREE + PURCHASED)"
                value={String((wallet.free_allocated + wallet.purchased_bags).toLocaleString())}
              />
              <Stat
                label="USED"
                value={String((wallet.free_used + wallet.purchased_used).toLocaleString())}
              />
            </View>
            <View style={styles.row}>
              <Stat label="REMAINING" value={String(wallet.total_available.toLocaleString())} />
              <Stat label="CURRENT PRICE" value={`${money(wallet.price_per_bag)} / BAG`} />
            </View>
            <View style={styles.row}>
              <Stat
                label="FREE USED / ALLOCATED"
                value={`${wallet.free_used.toLocaleString()} / ${wallet.free_allocated.toLocaleString()}`}
              />
              <Stat
                label="PURCHASED USED / TOTAL"
                value={`${wallet.purchased_used.toLocaleString()} / ${wallet.purchased_bags.toLocaleString()}`}
              />
            </View>
          </View>
        ) : null}

        <View style={styles.tabs}>
          {(["buy", "purchases", "usage"] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={[styles.tab, tab === t && styles.tabOn]}
              testID={`billing-tab-${t}`}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>
                {t === "buy" ? "PURCHASE" : t === "purchases" ? "HISTORY" : "USAGE"}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === "buy" ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>PURCHASE BAGS</Text>
            <Text style={styles.hint}>
              Price is set by Admin. Balance increases only after payment is confirmed.
            </Text>
            <Input
              label="Quantity"
              value={qty}
              onChangeText={setQty}
              keyboardType="number-pad"
              testID="billing-qty"
            />
            <Text style={styles.quote} testID="billing-quote">
              {bagsToBuy.toLocaleString()} × {money(quote.price)} = {money(quote.base)}
            </Text>
            <Button
              label={buying ? "PROCESSING…" : "PURCHASE BAGS"}
              onPress={purchase}
              loading={buying}
              disabled={buying || !bagsToBuy}
              testID="billing-purchase-btn"
            />
          </View>
        ) : null}

        {tab === "purchases" ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>PURCHASE HISTORY</Text>
            {purchases.length === 0 ? (
              <Text style={styles.hint}>No purchases yet.</Text>
            ) : (
              purchases.map((p) => (
                <View key={p.id} style={styles.histRow} testID={`purchase-${p.id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.histTitle}>
                      {fmtDate(p.paid_at || p.created_at)} · {p.bags.toLocaleString()} bags
                    </Text>
                    <Text style={styles.histSub}>
                      {money(p.price_per_bag)}/bag · Base {money(p.base_amount)}
                      {p.gst_amount > 0 ? ` · GST ${money(p.gst_amount)}` : ""} · Total {money(p.total_amount)}
                    </Text>
                  </View>
                  <Text style={[styles.status, p.status === "PAID" && styles.statusPaid]}>{p.status}</Text>
                </View>
              ))
            )}
          </View>
        ) : null}

        {tab === "usage" ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>BAG USAGE</Text>
            {usage.length === 0 ? (
              <Text style={styles.hint}>No usage yet.</Text>
            ) : (
              usage.map((u) => (
                <View key={u.id} style={styles.histRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.histTitle}>
                      {fmtDate(u.at)} · {u.kind} · {u.bags} bags
                    </Text>
                    <Text style={styles.histSub}>
                      Free {u.free_bags} · Paid {u.purchased_bags} · {u.status}
                      {u.patti_id ? ` · Patti ${u.patti_id.slice(0, 8)}` : ""}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: colors.borderStrong,
  },
  headerTitle: { fontSize: 18, fontWeight: "900", fontFamily: font.display, color: colors.onSurface },
  headerSub: { fontSize: 12, color: colors.muted, fontFamily: font.display },
  card: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  cardLabel: {
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: "800",
    color: colors.muted,
    fontFamily: font.display,
  },
  bigNum: { fontSize: 28, fontWeight: "900", fontFamily: font.mono, color: colors.onSurface },
  warn: { color: "#B45309", fontFamily: font.display, fontWeight: "700", fontSize: 13 },
  row: { flexDirection: "row", gap: spacing.sm },
  stat: { flex: 1, gap: 2 },
  statLabel: { fontSize: 10, letterSpacing: 1, color: colors.muted, fontFamily: font.display, fontWeight: "800" },
  statValue: { fontSize: 14, fontWeight: "800", fontFamily: font.mono, color: colors.onSurface },
  tabs: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  tab: {
    flex: 1,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    paddingVertical: 10,
    alignItems: "center",
  },
  tabOn: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  tabText: { fontSize: 11, fontWeight: "800", fontFamily: font.display, letterSpacing: 1, color: colors.onSurface },
  tabTextOn: { color: colors.onSurfaceInverse },
  hint: { fontSize: 13, color: colors.muted, fontFamily: font.display, marginBottom: 4 },
  quote: { fontSize: 16, fontWeight: "800", fontFamily: font.mono, marginVertical: spacing.sm },
  histRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  histTitle: { fontSize: 14, fontWeight: "800", fontFamily: font.display, color: colors.onSurface },
  histSub: { fontSize: 12, color: colors.muted, fontFamily: font.mono, marginTop: 2 },
  status: { fontSize: 11, fontWeight: "800", fontFamily: font.display, color: colors.muted },
  statusPaid: { color: "#15803D" },
});
