import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, ShopProfile, VendorBill } from "@/src/api";
import { KeyboardFormAvoid } from "@/src/components/KeyboardForm";
import { useAuth } from "@/src/context/AuthContext";
import { colors, font, money, spacing } from "@/src/theme";
import { Button, Input } from "@/src/components/ui";
import { clampPaperMm, thermalPrintUserMessage } from "@/src/utils/thermal-print";
import { shareVendorBillPdf, thermalPrintVendorBill } from "@/src/utils/vendor-bill-print";
import { routeParam } from "@/src/utils/route-params";

export default function VendorBillDetail() {
  const params = useLocalSearchParams<{ id: string; autoPrint?: string; autoShare?: string }>();
  const id = routeParam(params.id);
  const autoPrint = routeParam(params.autoPrint);
  const autoShare = routeParam(params.autoShare);
  const router = useRouter();
  const { session } = useAuth();
  const isOwner = session?.role === "owner";

  const [b, setB] = useState<VendorBill | null>(null);
  const [profile, setProfile] = useState<ShopProfile | null>(null);
  const [settings, setSettings] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [autoActionRan, setAutoActionRan] = useState(false);

  const [showDelete, setShowDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [d, pf, st] = await Promise.all([
        api.get<VendorBill>(`/vendor-bills/${id}`),
        api.get<ShopProfile>("/shop/profile").catch(() => null),
        api.get<any>("/settings").catch(() => null),
      ]);
      setB(d); setProfile(pf); setSettings(st);
    } catch { setB(null); } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const share = async () => {
    if (!b || !session) return;
    try {
      setSharing(true);
      let pf = profile;
      if (!pf?.bank_account_holder && !pf?.bank_account_number) {
        pf = await api.get<ShopProfile>("/shop/profile").catch(() => pf);
        if (pf) setProfile(pf);
      }
      await shareVendorBillPdf(b, pf || { shop_name: session.shop_name } as any, session.display_name);
    } catch (e) {
      console.warn("share error", e);
      Alert.alert("Share failed", "Could not prepare the PDF. Try again.");
    } finally { setSharing(false); }
  };

  const printThermal = async () => {
    if (!b || !session) return;
    try {
      setSharing(true);
      let pf = profile;
      if (!pf?.bank_account_holder && !pf?.bank_account_number) {
        pf = await api.get<ShopProfile>("/shop/profile").catch(() => pf);
        if (pf) setProfile(pf);
      }
      const paperMm = clampPaperMm(settings?.thermal_paper_width_mm || 80);
      await thermalPrintVendorBill(b, pf || { shop_name: session.shop_name } as any, paperMm);
    } catch (e) {
      console.warn("thermal print error", e);
      Alert.alert("Print failed", thermalPrintUserMessage(e));
    } finally { setSharing(false); }
  };

  // Auto-trigger print/share when navigated from save & print / share.
  useEffect(() => {
    if (loading || autoActionRan || !b) return;
    if (autoPrint === "1") {
      setAutoActionRan(true);
      setTimeout(() => { printThermal(); }, 250);
    } else if (autoShare === "1") {
      setAutoActionRan(true);
      setTimeout(() => { share(); }, 250);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, b, autoPrint, autoShare, autoActionRan]);

  const softDelete = async () => {
    if (!b) return;
    try {
      setDeleting(true);
      await api.del(`/vendor-bills/${b.id}`, { reason: deleteReason.trim() || null });
      setShowDelete(false);
      router.back();
    } catch (e: any) {
      Alert.alert("Failed", e?.detail || "Could not delete");
    } finally { setDeleting(false); }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root}><View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View></SafeAreaView>
    );
  }
  if (!b) {
    return (
      <SafeAreaView style={styles.root}><View style={styles.center}><Text style={styles.err}>Bill not found</Text></View></SafeAreaView>
    );
  }

  const isDeleted = b.status === "deleted";

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="bill-detail-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{b.bill_code}</Text>
          <Text style={styles.headerSub}>{b.date}</Text>
        </View>
        {!isDeleted && (
          <>
            <Pressable
              onPress={() => router.push({ pathname: "/vendor/[id]", params: { id: b.vendor_id } })}
              hitSlop={12}
              testID="bill-ledger"
              style={{ marginRight: 10 }}
            >
              <Ionicons name="book-outline" size={20} color={colors.onSurface} />
            </Pressable>
            <Pressable
              onPress={() => router.push({ pathname: "/vendor-payment/new", params: { vendor_id: b.vendor_id } })}
              hitSlop={12}
              testID="bill-pay"
              style={{ marginRight: 10 }}
            >
              <Ionicons name="cash-outline" size={20} color={colors.onSurface} />
            </Pressable>
            <Pressable
              onPress={() => router.push({ pathname: "/vendor-bill/new", params: { id: b.id } })}
              hitSlop={12}
              testID="bill-edit"
              style={{ marginRight: 10 }}
            >
              <Ionicons name="create-outline" size={20} color={colors.onSurface} />
            </Pressable>
            {isOwner ? (
              <Pressable onPress={() => setShowDelete(true)} hitSlop={12} testID="bill-delete">
                <Ionicons name="trash-outline" size={20} color={colors.error} />
              </Pressable>
            ) : null}
          </>
        )}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}>
        <View style={styles.card}>
          <View style={styles.rowSpread}>
            <View>
              <Text style={styles.shopName}>{(profile?.shop_name || session?.shop_name || "").toUpperCase()}</Text>
              <Text style={styles.subInfo}>{profile?.address || ""}</Text>
              <Text style={styles.subInfo}>{profile?.mobile || ""}</Text>
            </View>
            <View style={styles.billBox}>
              <Text style={styles.billBoxLbl}>BILL</Text>
              <Text style={styles.billBoxNo}>{b.bill_code}</Text>
            </View>
          </View>
          <View style={styles.divHeavy} />
          <MetaRow label="VENDOR" value={b.vendor_name} />
          {b.vendor_details ? <MetaRow label="DETAILS" value={b.vendor_details} /> : null}
          <MetaRow label="DATE" value={b.date} />
          <MetaRow label="STATUS" value={b.status.toUpperCase()} />

          <View style={styles.divider} />
          <View style={styles.thRow}>
            <Text style={[styles.th, { flex: 0.9 }]}>LOT</Text>
            <Text style={[styles.th, { flex: 1.4 }]}>FARMER</Text>
            <Text style={[styles.th, { flex: 1.5, textAlign: "right" }]}>BAGS × RATE</Text>
            <Text style={[styles.th, { flex: 1, textAlign: "right" }]}>AMOUNT</Text>
          </View>
          {b.lines.map((l, i) => (
            <View key={i} style={styles.lineRow}>
              <Text style={[styles.mono, { flex: 0.9 }]}>{l.lot_no}</Text>
              <Text style={[styles.mono, { flex: 1.4 }]} numberOfLines={1}>{l.farmer_name}</Text>
              <Text style={[styles.mono, { flex: 1.5, textAlign: "right" }]}>{l.bags} × {money(l.vendor_rate)}</Text>
              <Text style={[styles.monoStrong, { flex: 1, textAlign: "right" }]}>{money(l.amount)}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          <Row label={`Goods (×${b.vendor_factor ?? 1} + ₹${b.margin_per_bag}/bag)`} value={money(b.goods_total)} />
          <Row label={`Commission (${b.total_bags} × ₹${b.commission_per_bag})`} value={money(b.commission_total)} />
          <Row label="Hamali" value={money(b.hamali)} />
          {b.cess > 0 ? <Row label="Cess / Other" value={money(b.cess)} /> : null}
          <View style={styles.netBox}>
            <Text style={styles.netLbl}>GRAND TOTAL</Text>
            <Text style={styles.netVal}>{money(b.grand_total)}</Text>
          </View>
          <Row label="Paid" value={money(b.paid)} />
          <Row label="Balance Due" value={money(b.balance)} strong />

          {profile?.bank_account_holder || profile?.bank_account_number ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.section}>Bank</Text>
              {profile?.bank_account_holder ? <Text style={styles.subInfo}>A/c Name: {profile.bank_account_holder}</Text> : null}
              {profile?.bank_account_number ? <Text style={styles.subInfo}>A/c No: {profile.bank_account_number}</Text> : null}
              {profile?.bank_ifsc ? <Text style={styles.subInfo}>IFSC: {profile.bank_ifsc}</Text> : null}
              {profile?.bank_name ? <Text style={styles.subInfo}>Bank: {profile.bank_name}</Text> : null}
            </>
          ) : null}

          {b.notes ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.section}>Notes</Text>
              <Text style={styles.subInfo}>{b.notes}</Text>
            </>
          ) : null}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Pressable
            style={({ pressed }) => [detailStyles.footBtn, detailStyles.footPrint, pressed && { opacity: 0.85 }, sharing && { opacity: 0.5 }]}
            onPress={printThermal}
            disabled={sharing}
            testID="bill-print-thermal"
          >
            <Ionicons name="print-outline" size={16} color={colors.onSurfaceInverse} />
            <Text style={[detailStyles.footText, { color: colors.onSurfaceInverse }]}>PRINT</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [detailStyles.footBtn, detailStyles.footShare, pressed && { opacity: 0.85 }, sharing && { opacity: 0.5 }]}
            onPress={share}
            disabled={sharing}
            testID="bill-share"
          >
            <Ionicons name="share-social-outline" size={16} color={colors.onBrandPrimary} />
            <Text style={[detailStyles.footText, { color: colors.onBrandPrimary }]}>SHARE PDF</Text>
          </Pressable>
        </View>
      </View>

      <Modal transparent visible={showDelete} animationType="fade" onRequestClose={() => setShowDelete(false)}>
        <KeyboardFormAvoid style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setShowDelete(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>DELETE BILL</Text>
              <Pressable onPress={() => setShowDelete(false)} hitSlop={12}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <View style={{ padding: spacing.lg }}>
              <Input label="Reason (optional)" value={deleteReason} onChangeText={setDeleteReason} multiline testID="delete-reason" />
              <Button label="DELETE" variant="danger" onPress={softDelete} loading={deleting} testID="delete-confirm" />
            </View>
          </View>
        </KeyboardFormAvoid>
      </Modal>
    </SafeAreaView>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}
function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.rowFlex}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong && { fontWeight: "900", fontSize: 15 }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  err: { color: colors.error, fontFamily: font.display, fontWeight: "700" },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  headerTitle: { fontSize: 20, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.3 },
  headerSub: { fontSize: 11, color: colors.muted, letterSpacing: 1, fontWeight: "700" },
  card: { borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.lg, backgroundColor: colors.surface },
  rowSpread: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  shopName: { fontSize: 20, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.5 },
  subInfo: { fontSize: 11, color: colors.muted, marginTop: 2, fontFamily: font.display },
  billBox: { borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 10, paddingVertical: 6, alignItems: "flex-end" },
  billBoxLbl: { fontSize: 9, letterSpacing: 1, color: colors.muted, fontWeight: "800" },
  billBoxNo: { fontSize: 15, fontFamily: font.mono, fontWeight: "800", color: colors.onSurface },
  divHeavy: { height: 2, backgroundColor: colors.onSurface, marginVertical: spacing.md },
  divider: { height: 2, backgroundColor: colors.divider, marginVertical: spacing.md },
  metaRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  metaLabel: { fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: colors.muted, fontFamily: font.display, fontWeight: "800" },
  metaValue: { fontSize: 13, fontWeight: "700", color: colors.onSurface, fontFamily: font.display },
  thRow: { flexDirection: "row", borderBottomWidth: 2, borderBottomColor: colors.onSurface, paddingBottom: 6 },
  th: { fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: colors.muted, fontFamily: font.display, fontWeight: "800" },
  lineRow: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: "#D1D5DB", borderStyle: "dashed" },
  mono: { fontFamily: font.mono, fontSize: 12, color: colors.onSurface },
  monoStrong: { fontFamily: font.mono, fontSize: 12, color: colors.onSurface, fontWeight: "800" },
  section: { fontSize: 11, letterSpacing: 2, color: colors.muted, textTransform: "uppercase", fontWeight: "800", fontFamily: font.display, marginBottom: 4 },
  rowFlex: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  rowLabel: { fontSize: 13, color: colors.muted, fontFamily: font.display },
  rowValue: { fontSize: 14, color: colors.onSurface, fontFamily: font.mono, fontWeight: "700" },
  netBox: {
    backgroundColor: colors.surfaceInverse, padding: spacing.md, marginTop: 8, marginBottom: 8,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  netLbl: { color: colors.onSurfaceInverse, fontFamily: font.display, letterSpacing: 1.5, fontWeight: "900", fontSize: 12 },
  netVal: { color: colors.onSurfaceInverse, fontFamily: font.mono, fontWeight: "900", fontSize: 22 },
  footer: { borderTopWidth: 2, borderTopColor: colors.borderStrong, padding: spacing.lg, backgroundColor: colors.surface },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  modalSheet: { backgroundColor: colors.surface, borderTopWidth: 2, borderColor: colors.borderStrong, paddingBottom: spacing.xl },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  modalTitle: { fontSize: 16, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: 1 },
});

const detailStyles = StyleSheet.create({
  footBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 2, paddingVertical: 14, minHeight: 48,
  },
  footPrint: { borderColor: colors.surfaceInverse, backgroundColor: colors.surfaceInverse },
  footShare: { borderColor: colors.brand, backgroundColor: colors.brandPrimary },
  footText: { fontFamily: font.display, fontWeight: "900", letterSpacing: 0.5, fontSize: 11 },
});
