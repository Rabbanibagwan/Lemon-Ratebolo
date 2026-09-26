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
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import {
  api,
  apiErrorMessage,
  BagPurchase,
  BagUsageRow,
  BagWallet,
  FreeBagAllocation,
  MerchantNotification,
} from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { Button, Input } from "@/src/components/ui";
import { colors, font, money, spacing } from "@/src/theme";
import { routeParam } from "@/src/utils/route-params";

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

function fmtDateDMY(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${d.getFullYear()}`;
  } catch {
    return "—";
  }
}

type BillingTab = "buy" | "purchases" | "usage" | "free";

export default function BillingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string; allocationId?: string }>();
  const initialTab = (routeParam(params.tab) || "").toLowerCase();
  const highlightAllocationId = routeParam(params.allocationId);
  const { session } = useAuth();
  const isOwner = session?.role === "owner";

  const [wallet, setWallet] = useState<BagWallet | null>(null);
  const [purchases, setPurchases] = useState<BagPurchase[]>([]);
  const [usage, setUsage] = useState<BagUsageRow[]>([]);
  const [freeAllocs, setFreeAllocs] = useState<FreeBagAllocation[]>([]);
  const [notifications, setNotifications] = useState<MerchantNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [qty, setQty] = useState("1000");
  const [buying, setBuying] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [confirmClaim, setConfirmClaim] = useState<FreeBagAllocation | null>(null);
  const [tab, setTab] = useState<BillingTab>(
    initialTab === "free" || initialTab === "history" || initialTab === "usage" || initialTab === "purchase"
      ? (initialTab === "history" ? "purchases" : initialTab === "purchase" ? "buy" : (initialTab as BillingTab))
      : "buy",
  );

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
      // Free-bag APIs may be unavailable until backend deploy — keep PURCHASE/HISTORY/USAGE working.
      try {
        setFreeAllocs(await api.get<FreeBagAllocation[]>("/billing/free-allocations"));
      } catch {
        setFreeAllocs([]);
      }
      try {
        setNotifications(await api.get<MerchantNotification[]>("/billing/notifications?limit=20"));
      } catch {
        setNotifications([]);
      }
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
      const t = (routeParam(params.tab) || "").toLowerCase();
      if (t === "free") setTab("free");
      load();
    }, [isOwner, load, router, params.tab]),
  );

  const openClaimConfirm = (alloc: FreeBagAllocation) => {
    if ((alloc.status !== "PENDING" && alloc.status !== "AVAILABLE") || claimingId) return;
    setConfirmClaim(alloc);
  };

  const performClaim = async (alloc: FreeBagAllocation) => {
    try {
      setClaimingId(alloc.id);
      setConfirmClaim(null);
      const claimed = await api.post<FreeBagAllocation>(
        `/billing/free-allocations/${alloc.id}/claim`,
        {},
      );
      Alert.alert(
        "Claimed",
        `${claimed.bags.toLocaleString()} free bags have been added to your Bag Balance.`,
      );
      const related = notifications.find((n) => n.allocation_id === alloc.id && !n.read);
      if (related) {
        try {
          await api.post(`/billing/notifications/${related.id}/read`, {});
        } catch {
          /* ignore */
        }
      }
      await load();
    } catch (e) {
      Alert.alert("Claim failed", apiErrorMessage(e, "Could not claim free bags"));
    } finally {
      setClaimingId(null);
    }
  };

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

        {(wallet?.free_available_to_claim || 0) > 0 ? (
          <Pressable
            style={styles.freeBanner}
            onPress={() => setTab("free")}
            testID="billing-free-claim-banner"
          >
            <Text style={styles.freeBannerTitle}>
              🎁 {(wallet?.free_available_to_claim || 0).toLocaleString()} free bags ready to claim
            </Text>
            <Text style={styles.freeBannerSub}>Open FREE tab · balance increases only after CLAIM NOW</Text>
          </Pressable>
        ) : null}

        <View style={styles.tabs}>
          {([
            ["buy", "PURCHASE"],
            ["purchases", "HISTORY"],
            ["usage", "USAGE"],
            ["free", "FREE"],
          ] as const).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              style={[styles.tab, tab === key && styles.tabOn]}
              testID={`billing-tab-${key === "buy" ? "buy" : key}`}
            >
              <Text style={[styles.tabText, tab === key && styles.tabTextOn]} numberOfLines={1}>
                {label}
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
                    {p.status === "PAID" && p.invoice_number ? (
                      <Text style={styles.histSub}>Invoice {p.invoice_number}</Text>
                    ) : null}
                  </View>
                  <View style={styles.histActions}>
                    <Text style={[styles.status, p.status === "PAID" && styles.statusPaid]}>{p.status}</Text>
                    {p.status === "PAID" ? (
                      <Pressable
                        onPress={() => router.push({ pathname: "/billing-invoice", params: { id: p.id } })}
                        style={styles.invoiceBtn}
                        testID={`purchase-invoice-${p.id}`}
                      >
                        <Text style={styles.invoiceBtnText}>INVOICE</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ))
            )}
          </View>
        ) : null}

        {tab === "usage" ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>BAG USAGE</Text>
            {wallet ? (
              <View style={styles.usageSummary} testID="usage-free-paid-summary">
                <View style={styles.usageBlock} testID="usage-free-block">
                  <Text style={styles.usageBlockTitle}>FREE BAGS</Text>
                  <Text style={styles.usageBlockLine}>
                    Used {wallet.free_used.toLocaleString()} | Remaining {wallet.free_remaining.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.usageBlock} testID="usage-paid-block">
                  <Text style={styles.usageBlockTitle}>PAID BAGS</Text>
                  <Text style={styles.usageBlockLine}>
                    Used {wallet.purchased_used.toLocaleString()} | Remaining {wallet.purchased_remaining.toLocaleString()}
                  </Text>
                </View>
              </View>
            ) : null}
            <Text style={[styles.cardLabel, { marginTop: spacing.sm }]}>USAGE HISTORY</Text>
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

        {tab === "free" ? (
          <View style={styles.card} testID="billing-free-tab">
            <Text style={styles.cardLabel}>FREE BAGS</Text>
            <Text style={styles.hint}>
              Admin allocations appear here. Usable balance increases only after you tap CLAIM NOW.
            </Text>
            {freeAllocs.length === 0 ? (
              <Text style={styles.hint} testID="billing-free-empty">No free bag allocations yet.</Text>
            ) : (
              freeAllocs.map((a) => {
                const highlight = highlightAllocationId === a.id;
                const pending = a.status === "PENDING" || a.status === "AVAILABLE";
                return (
                  <View
                    key={a.id}
                    style={[styles.freeCard, highlight && styles.freeCardHighlight]}
                    testID={`free-alloc-${a.id}`}
                  >
                    <Text style={styles.freePeriod}>{a.period_label}</Text>
                    <Text style={styles.freeBags}>Free Bags Received: {a.bags.toLocaleString()}</Text>
                    {pending ? (
                      <Text style={styles.freeBags} testID={`free-claimable-${a.id}`}>
                        Available to Claim: {a.bags.toLocaleString()}
                      </Text>
                    ) : a.status === "CLAIMED" ? (
                      <>
                        <Text style={styles.histSub}>Claimed: {a.bags.toLocaleString()}</Text>
                        <Text style={styles.histSub}>Available to Claim: 0</Text>
                      </>
                    ) : null}
                    <Text style={styles.freeStatus} testID={`free-status-${a.id}`}>
                      Status: {pending ? "PENDING" : a.status}
                    </Text>
                    {a.status === "CLAIMED" ? (
                      <>
                        <Text style={styles.histSub}>Claim date: {fmtDateDMY(a.claimed_at)}</Text>
                        {a.claim_ref ? <Text style={styles.histSub}>Ref: {a.claim_ref}</Text> : null}
                      </>
                    ) : null}
                    {a.reason ? <Text style={styles.histSub}>Note: {a.reason}</Text> : null}
                    {pending ? (
                      <Button
                        label={claimingId === a.id ? "CLAIMING…" : "CLAIM NOW"}
                        onPress={() => openClaimConfirm(a)}
                        loading={claimingId === a.id}
                        disabled={!!claimingId}
                        testID={`free-claim-${a.id}`}
                        style={{ marginTop: spacing.sm }}
                      />
                    ) : null}
                  </View>
                );
              })
            )}

            {notifications.filter((n) => n.kind === "FREE_BAGS" && !n.read).length > 0 ? (
              <>
                <Text style={[styles.cardLabel, { marginTop: spacing.md }]}>NOTIFICATIONS</Text>
                {notifications
                  .filter((n) => n.kind === "FREE_BAGS" && !n.read)
                  .map((n) => (
                    <Pressable
                      key={n.id}
                      style={styles.notifRow}
                      testID={`free-notif-${n.id}`}
                      onPress={async () => {
                        try {
                          await api.post(`/billing/notifications/${n.id}/read`, {});
                        } catch {
                          /* ignore */
                        }
                        if (n.allocation_id) {
                          const target = freeAllocs.find((a) => a.id === n.allocation_id);
                          if (target && (target.status === "PENDING" || target.status === "AVAILABLE")) {
                            openClaimConfirm(target);
                          }
                        }
                        await load();
                      }}
                    >
                      <Text style={styles.histTitle}>{n.title}</Text>
                      <Text style={styles.histSub}>{n.body}</Text>
                      <Text style={styles.claimLink}>CLAIM FREE BAGS →</Text>
                    </Pressable>
                  ))}
              </>
            ) : null}

            {confirmClaim ? (
              <View style={styles.confirmBox} testID="free-claim-confirm">
                <Text style={styles.freePeriod}>Claim {confirmClaim.bags.toLocaleString()} free bags?</Text>
                <Text style={styles.hint}>{confirmClaim.period_label}</Text>
                <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label="CANCEL"
                      variant="secondary"
                      onPress={() => setConfirmClaim(null)}
                      disabled={!!claimingId}
                      testID="free-claim-cancel"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={claimingId ? "CLAIMING…" : "CLAIM NOW"}
                      onPress={() => performClaim(confirmClaim)}
                      loading={!!claimingId}
                      disabled={!!claimingId}
                      testID="free-claim-confirm-btn"
                    />
                  </View>
                </View>
              </View>
            ) : null}
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
  tabs: { flexDirection: "row", gap: 6, marginBottom: spacing.md },
  tab: {
    flex: 1,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    paddingVertical: 10,
    paddingHorizontal: 2,
    alignItems: "center",
    minWidth: 0,
  },
  tabOn: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  tabText: { fontSize: 10, fontWeight: "800", fontFamily: font.display, letterSpacing: 0.5, color: colors.onSurface },
  tabTextOn: { color: colors.onSurfaceInverse },
  freeBanner: {
    borderWidth: 2,
    borderColor: colors.brandPrimary,
    backgroundColor: colors.brandSecondary,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 4,
  },
  freeBannerTitle: { fontSize: 14, fontWeight: "900", fontFamily: font.display, color: colors.onBrandSecondary },
  freeBannerSub: { fontSize: 12, fontFamily: font.display, color: colors.onBrandSecondary },
  freeCard: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: spacing.md,
    marginTop: spacing.sm,
    gap: 4,
    backgroundColor: colors.surfaceSecondary,
  },
  freeCardHighlight: { borderColor: colors.brandPrimary, backgroundColor: colors.brandSecondary },
  freePeriod: { fontSize: 16, fontWeight: "900", fontFamily: font.display, color: colors.onSurface },
  freeBags: { fontSize: 22, fontWeight: "900", fontFamily: font.mono, color: colors.brandPrimary },
  freeStatus: { fontSize: 12, fontWeight: "800", fontFamily: font.display, color: colors.onSurface, marginTop: 2 },
  notifRow: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: spacing.md,
    marginTop: spacing.sm,
    gap: 4,
  },
  claimLink: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    fontFamily: font.display,
    color: colors.brandPrimary,
  },
  confirmBox: {
    borderWidth: 2,
    borderColor: colors.brandPrimary,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: 4,
  },
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
  histActions: { alignItems: "flex-end", gap: 6 },
  invoiceBtn: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  invoiceBtnText: { fontSize: 11, fontWeight: "900", letterSpacing: 1, fontFamily: font.display, color: colors.onSurface },
  usageSummary: { gap: spacing.sm, marginBottom: spacing.sm },
  usageBlock: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: spacing.sm,
    gap: 4,
  },
  usageBlockTitle: {
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: "900",
    fontFamily: font.display,
    color: colors.muted,
  },
  usageBlockLine: { fontSize: 15, fontWeight: "800", fontFamily: font.mono, color: colors.onSurface },
  status: { fontSize: 11, fontWeight: "800", fontFamily: font.display, color: colors.muted },
  statusPaid: { color: "#15803D" },
});
