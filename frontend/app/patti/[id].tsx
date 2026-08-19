import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, Patti, Settings, ShopProfile } from "@/src/api";
import { KeyboardFormAvoid } from "@/src/components/KeyboardForm";
import { useAuth } from "@/src/context/AuthContext";
import { colors, font, money, spacing } from "@/src/theme";
import { Button, Input } from "@/src/components/ui";
import { qrDataUri } from "@/src/utils/qr";
import { thermalPrintAndMark, sharePattiPdf, canUserPrintPatti, canUserSharePatti, staffPrintBlockedMessage, staffShareBlockedMessage } from "@/src/utils/patti-print";
import { clampPaperMm, thermalPrintUserMessage } from "@/src/utils/thermal-print";
import { routeParam } from "@/src/utils/route-params";

export default function PattiDetail() {
  const params = useLocalSearchParams<{ id: string; fresh?: string; autoPrint?: string; autoShare?: string; from?: string }>();
  const id = routeParam(params.id);
  const fresh = routeParam(params.fresh);
  const autoPrint = routeParam(params.autoPrint);
  const autoShare = routeParam(params.autoShare);
  const fromScreen = routeParam(params.from);
  const router = useRouter();
  const { session } = useAuth();
  const isOwner = session?.role === "owner";

  const [p, setP] = useState<Patti | null>(null);
  const [profile, setProfile] = useState<ShopProfile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [autoActionRan, setAutoActionRan] = useState(false);

  const [showReceiver, setShowReceiver] = useState(false);
  const [receiver, setReceiver] = useState("");
  const [receiverErr, setReceiverErr] = useState<string | null>(null);
  const [savingReceiver, setSavingReceiver] = useState(false);

  const canPrint = isOwner && canUserPrintPatti(p, session);
  const canShare = canUserSharePatti(session);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [d, pf, st] = await Promise.all([
        api.get<Patti>(`/pattis/${id}`),
        api.get<ShopProfile>("/shop/profile").catch(() => null),
        api.get<Settings>("/settings").catch(() => null),
      ]);
      setP(d);
      setProfile(pf);
      setSettings(st);
      setReceiver(d.receiver_name || "");
      try {
        const uri = await qrDataUri(d.qr_token, 260);
        setQr(uri);
      } catch (e) {
        console.warn("patti QR render error", e);
        setQr(null);
      }
    } catch {
      setP(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Auto-trigger print/share when navigated with query param from add-lot/save flows.
  useEffect(() => {
    if (loading || autoActionRan || !p) return;
    if (autoPrint === "1") {
      setAutoActionRan(true);
      if (!canUserPrintPatti(p, session)) {
        if (session?.role === "counter") {
          Alert.alert("Already printed", staffPrintBlockedMessage());
        }
        return;
      }
      // Small delay so the UI can render first.
      setTimeout(() => { printThermal(); }, 250);
    } else if (autoShare === "1") {
      setAutoActionRan(true);
      if (!canUserSharePatti(session)) {
        Alert.alert("Share unavailable", staffShareBlockedMessage());
        return;
      }
      setTimeout(() => { share(); }, 250);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, p, autoPrint, autoShare, autoActionRan]);

  const share = async () => {
    if (!p || !session) return;
    if (!canUserSharePatti(session)) {
      Alert.alert("Share unavailable", staffShareBlockedMessage());
      return;
    }
    try {
      setSharing(true);
      await sharePattiPdf(
        p,
        profile || { shop_name: session.shop_name } as any,
        session.display_name,
        !!settings?.detailed_print_format,
        session,
      );
    } catch (e) {
      console.warn("share error", e);
      Alert.alert("Share failed", "Could not prepare the PDF. Try again.");
    } finally {
      setSharing(false);
    }
  };

  const printThermal = async () => {
    if (!p || !session) return;
    if (!canUserPrintPatti(p, session)) {
      Alert.alert("Already printed", staffPrintBlockedMessage());
      return;
    }
    try {
      setSharing(true);
      // Always fetch fresh settings + profile at print time so paper width is correct
      // regardless of whether the React state has loaded yet (race with auto-print).
      const [freshProfile, freshSettings] = await Promise.all([
        api.get<ShopProfile>("/shop/profile").catch(() => profile),
        api.get<Settings>("/settings").catch(() => settings),
      ]);
      const resolvedProfile = freshProfile || profile || { shop_name: session.shop_name } as any;
      const paperMm = clampPaperMm((freshSettings ?? settings)?.thermal_paper_width_mm || 80);
      const detailed = !!( freshSettings ?? settings)?.detailed_print_format;
      const updated = await thermalPrintAndMark(
        p,
        resolvedProfile,
        paperMm,
        session,
        detailed,
      );
      setP(updated);
      if (freshProfile) setProfile(freshProfile);
      if (freshSettings) setSettings(freshSettings);
    } catch (e: any) {
      console.warn("thermal print error", e);
      const detail = typeof e?.detail === "string" ? e.detail : null;
      Alert.alert(
        "Print failed",
        detail || `${thermalPrintUserMessage(e)} Patti stays Saved (not Printed).`,
      );
    } finally {
      setSharing(false);
    }
  };

  const saveReceiver = async () => {
    setReceiverErr(null);
    if (!receiver.trim()) { setReceiverErr("Enter a name"); return; }
    try {
      setSavingReceiver(true);
      const d = await api.put<Patti>(`/pattis/${id}/receiver`, { receiver_name: receiver.trim() });
      setP(d);
      setShowReceiver(false);
    } catch (e: any) {
      setReceiverErr(e?.detail || "Failed to save");
    } finally {
      setSavingReceiver(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root}><View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View></SafeAreaView>
    );
  }
  if (!p) {
    return (
      <SafeAreaView style={styles.root}><View style={styles.center}><Text style={styles.err}>Patti not found</Text></View></SafeAreaView>
    );
  }

  const date = new Date(p.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  const isDeleted = (p as any).deleted === true || p.status === ("deleted" as any);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (fresh === "1" ? router.replace("/(tabs)/history") : router.back())}
          hitSlop={12} testID="patti-back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>PATTI #{p.patti_no}</Text>
          <Text style={styles.headerSub}>{date} {isDeleted ? "· DELETED" : ""}</Text>
        </View>
        <View style={styles.headerActions}>
          {/* Edit & Delete buttons intentionally removed per spec. Only Receiver-edit remains inline below. */}
        </View>
      </View>

      {fresh === "1" && !isDeleted ? (
        <View style={styles.freshBanner}>
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
          <Text style={styles.freshText}>
            {isOwner ? "Patti generated · Ready to print/share" : "Patti generated · Saved successfully"}
          </Text>
        </View>
      ) : null}
      {isDeleted ? (
        <View style={styles.delBanner}>
          <Ionicons name="warning" size={16} color={colors.error} />
          <Text style={styles.delText}>Deleted by {(p as any).deleted_by || "—"} · {(p as any).deleted_reason || "no reason"}</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 160 }}>
        {/* Receiver / status bar */}
        <View style={styles.receiverBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.receiverLabel}>RECEIVER</Text>
            <Text style={styles.receiverValue} numberOfLines={1}>{p.receiver_name || "—"}</Text>
            <Text style={styles.receiverMeta}>
              {p.status === "received" ? "✓ RECEIVED" : "⧗ PENDING"}
              {p.receiver_updated_by ? ` · by ${p.receiver_updated_by}` : ""}
            </Text>
          </View>
          <Pressable
            style={styles.editReceiverBtn}
            onPress={() => { setReceiver(p.receiver_name); setShowReceiver(true); }}
            testID="edit-receiver-btn"
          >
            <Ionicons name="pencil" size={14} color={colors.onSurfaceInverse} />
            <Text style={styles.editReceiverText}>EDIT</Text>
          </Pressable>
        </View>

        {/* Patti body — NO vendor names */}
        <View style={styles.pattiCard} testID="patti-body">
          <View style={styles.pattiHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.shopName} numberOfLines={2}>{(profile?.shop_name || session?.shop_name || "").toUpperCase()}</Text>
              {(() => {
                const addr = [profile?.address, profile?.village, profile?.taluk, profile?.district, profile?.state]
                  .filter(Boolean).join(", ");
                return addr ? (
                  <Text style={styles.shopMeta} numberOfLines={3}>{addr}</Text>
                ) : null;
              })()}
              {profile?.mobile ? (
                <Text style={styles.shopMeta} numberOfLines={1}>Mobile: {profile.mobile}</Text>
              ) : null}
              <Text style={styles.pattiKind}>PATTI / BILL</Text>
            </View>
            <View style={styles.pattiNumBox}>
              <Text style={styles.pattiNumLabel}>NO.</Text>
              <Text style={styles.pattiNum}>{p.patti_no}</Text>
            </View>
          </View>

          <View style={styles.dividerHeavy} />

          <View style={styles.farmerRow}>
            <Text style={styles.farmerLabel}>FARMER</Text>
            <Text style={styles.metaValueFarmer} numberOfLines={2}>{p.farmer_name}</Text>
          </View>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>DATE</Text><Text style={styles.metaValue}>{date}</Text></View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>DRIVER</Text>
            <Text style={styles.metaValue}>{p.driver_name ? `${p.driver_name}${p.driver_place ? ` · ${p.driver_place}` : ""}` : "—"}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.thRow}>
            <Text style={[styles.th, { flex: 0.9 }]}>LOT</Text>
            <Text style={[styles.th, { flex: 1.6, textAlign: "right" }]}>BAGS × RATE</Text>
            <Text style={[styles.th, { flex: 1, textAlign: "right" }]}>AMOUNT</Text>
          </View>

          {p.lots.map((lot, li) => (
            <View key={li} style={{ paddingVertical: 4 }}>
              {lot.sales.map((s, si) => (
                <View key={`${li}-${si}`} style={styles.lineRow}>
                  <Text style={[styles.lineCell, styles.lineLot, styles.mono, { flex: 0.9 }]}>
                    {si === 0 ? lot.lot_no : ""}
                  </Text>
                  <Text style={[styles.lineCell, styles.mono, { flex: 1.6, textAlign: "right" }]}>
                    <Text style={styles.lineBags}>{s.bags}</Text>
                    {" × "}
                    {money(s.rate_per_bag * p.payment_factor)}
                  </Text>
                  <Text style={[styles.lineCell, styles.mono, { flex: 1, textAlign: "right" }]}>
                    {money(s.bags * s.rate_per_bag * p.payment_factor)}
                  </Text>
                </View>
              ))}
            </View>
          ))}

          <View style={styles.divider} />

          <Row label="Gross total" value={money(p.farmer_gross)} strong />
          <Row
            label={settings?.detailed_print_format ? `Hamali (${p.total_bags} × ${money(p.hamali_per_bag)})` : "Hamali"}
            value={"− " + money(p.hamali_total)}
          />
          <Row label="Bhada" value={"− " + money(p.bhada_total)} />
          <Row label="Stationery" value={"− " + money(p.stationery_total)} />
          <Row label="Total deduction" value={"− " + money(p.deductions_total)} strong />

          <View style={styles.netBox}>
            <Text style={styles.netLabel}>NET PAYABLE</Text>
            <Text style={styles.netValue}>{money(p.net_payable)}</Text>
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>RECEIVER</Text>
            <Text style={styles.metaValue}>{p.receiver_name || "—"}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>STATUS</Text>
            <Text style={styles.metaValue}>{p.status === "received" ? "RECEIVED" : "PENDING"}</Text>
          </View>

          {qr ? (
            <View style={styles.qrBox}>
              <Image source={{ uri: qr }} style={styles.qrImg} />
              <View style={{ flex: 1 }}>
                <Text style={styles.qrLabel}>SCAN AT COUNTER</Text>
                <Text style={styles.qrHint}>
                  Scan to open this Patti and enter/update the receiver name.
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {isOwner ? (
      <View style={styles.footerBar}>
        <View style={styles.footerRow}>
          {canPrint ? (
            <Pressable
              style={[styles.thermalBtn, !canShare && { flex: 1 }]}
              onPress={printThermal}
              disabled={sharing}
              testID="patti-print-thermal"
            >
              <Ionicons name="print-outline" size={18} color={colors.onSurface} />
              <Text style={styles.thermalBtnText}>PRINT</Text>
            </Pressable>
          ) : isOwner ? (
            <View style={[styles.thermalBtn, styles.thermalBtnDisabled]} testID="patti-print-disabled">
              <Ionicons name="print-outline" size={18} color={colors.muted} />
              <Text style={[styles.thermalBtnText, { color: colors.muted }]}>PRINT</Text>
            </View>
          ) : null}
          {canShare ? (
            <View style={{ flex: 1 }}>
              <Button label={sharing ? "PREPARING…" : "SHARE PDF"} onPress={share} loading={sharing} testID="patti-share" />
            </View>
          ) : null}
        </View>
      </View>
      ) : null}

      {/* Edit receiver modal */}
      <Modal visible={showReceiver} transparent animationType="fade" onRequestClose={() => setShowReceiver(false)}>
        <KeyboardFormAvoid style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setShowReceiver(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>UPDATE RECEIVER</Text>
              <Pressable onPress={() => setShowReceiver(false)} hitSlop={12}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <View style={{ padding: spacing.lg }}>
              <Text style={styles.hintDim}>
                Default is the driver name. If someone else collected the Patti, enter their name.
              </Text>
              <Input
                label="Receiver name"
                value={receiver}
                onChangeText={setReceiver}
                autoCapitalize="words"
                autoFocus
                placeholder="e.g. Mahesh Patil"
                testID="receiver-input"
              />
              {receiverErr ? <Text style={styles.err}>{receiverErr}</Text> : null}
              <Button label="SAVE RECEIVER" onPress={saveReceiver} loading={savingReceiver} testID="receiver-save" />
            </View>
          </View>
        </KeyboardFormAvoid>
      </Modal>
    </SafeAreaView>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.rowFlex}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong && { fontWeight: "800" }]}>{value}</Text>
    </View>
  );
}


const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  err: { color: colors.error, fontFamily: font.display, fontWeight: "800" },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
    flexDirection: "row", alignItems: "center", gap: spacing.md,
  },
  headerTitle: { fontSize: 20, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.3 },
  headerSub: { fontSize: 12, color: colors.muted, fontFamily: font.mono },
  headerActions: { flexDirection: "row", gap: spacing.md },

  freshBanner: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    borderBottomWidth: 2, borderBottomColor: colors.success, backgroundColor: "#D1FAE5",
    padding: spacing.md,
  },
  freshText: { color: colors.success, fontFamily: font.display, fontWeight: "800", letterSpacing: 0.5 },
  delBanner: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    borderBottomWidth: 2, borderBottomColor: colors.error, backgroundColor: "#FEE2E2",
    padding: spacing.md,
  },
  delText: { flex: 1, color: colors.error, fontFamily: font.display, fontWeight: "800", fontSize: 12 },

  receiverBar: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, marginBottom: spacing.md,
    backgroundColor: colors.surfaceSecondary,
  },
  receiverLabel: { fontSize: 10, letterSpacing: 1.5, color: colors.muted, fontFamily: font.display, fontWeight: "800" },
  receiverValue: { fontSize: 18, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, marginTop: 2 },
  receiverMeta: { fontSize: 11, color: colors.muted, fontFamily: font.display, marginTop: 2 },
  editReceiverBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.surfaceInverse, paddingVertical: 8, paddingHorizontal: 12,
    borderWidth: 2, borderColor: colors.surfaceInverse,
  },
  editReceiverText: { color: colors.onSurfaceInverse, fontFamily: font.display, fontWeight: "800", fontSize: 11, letterSpacing: 1 },

  pattiCard: { borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.lg, backgroundColor: colors.surface },
  pattiHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  shopName: { fontSize: 20, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.5 },
  shopMeta: { fontSize: 10.5, color: colors.muted, fontFamily: font.display, marginTop: 2, lineHeight: 14 },
  pattiKind: { fontSize: 10, letterSpacing: 2, color: colors.muted, fontWeight: "800", fontFamily: font.display, marginTop: 2 },
  pattiNumBox: { borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 10, paddingVertical: 4, alignItems: "flex-end" },
  pattiNumLabel: { fontSize: 9, letterSpacing: 1, color: colors.muted, fontWeight: "800", fontFamily: font.display },
  pattiNum: { fontSize: 20, fontWeight: "800", color: colors.onSurface, fontFamily: font.mono },
  dividerHeavy: { height: 2, backgroundColor: colors.borderStrong, marginVertical: spacing.md },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.md },
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 2 },
  farmerRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "baseline",
    paddingVertical: 6, gap: 8,
  },
  farmerLabel: {
    fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase",
    color: colors.muted, fontWeight: "800", fontFamily: font.display, flexShrink: 0,
  },
  metaLabel: { fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: colors.muted, fontWeight: "800", fontFamily: font.display },
  metaValue: { fontSize: 14, fontWeight: "700", color: colors.onSurface, fontFamily: font.display },
  metaValueFarmer: {
    fontSize: 24, fontWeight: "900", letterSpacing: -0.3, color: colors.onSurface,
    fontFamily: font.display, lineHeight: 28, flexShrink: 1, flex: 1, textAlign: "right",
  },
  thRow: { flexDirection: "row", borderBottomWidth: 2, borderBottomColor: colors.borderStrong, paddingBottom: 6 },
  th: { fontSize: 10, letterSpacing: 1, color: colors.muted, fontWeight: "800", fontFamily: font.display },
  lineRow: { flexDirection: "row", paddingVertical: 4, alignItems: "baseline" },
  lineCell: { fontSize: 13, color: colors.onSurface },
  lineLot: { fontSize: 16, fontWeight: "900" },
  lineBags: { fontSize: 16, fontWeight: "900", fontFamily: font.mono, color: colors.onSurface },
  mono: { fontFamily: font.mono },
  monoStrong: { fontFamily: font.mono, fontWeight: "800" },
  rowFlex: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 3 },
  rowLabel: { fontSize: 13, color: colors.onSurfaceTertiary, fontFamily: font.display, flex: 1 },
  rowValue: { fontSize: 14, fontFamily: font.mono, color: colors.onSurface },
  netBox: {
    backgroundColor: colors.surfaceInverse, padding: spacing.md, marginTop: spacing.md,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  netLabel: { color: colors.onSurfaceInverse, fontFamily: font.display, fontWeight: "900", letterSpacing: 1.5, fontSize: 13 },
  netValue: { color: colors.onSurfaceInverse, fontFamily: font.mono, fontWeight: "900", fontSize: 24 },

  qrBox: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, marginTop: spacing.md,
  },
  qrImg: { width: 100, height: 100 },
  qrLabel: { fontSize: 10, letterSpacing: 1.5, color: colors.muted, fontWeight: "800", fontFamily: font.display },
  qrHint: { fontSize: 12, color: colors.onSurfaceTertiary, fontFamily: font.display, marginTop: 2 },

  footerBar: { borderTopWidth: 2, borderTopColor: colors.borderStrong, padding: spacing.lg, backgroundColor: colors.surface },
  footerRow: { flexDirection: "row", gap: spacing.sm, alignItems: "stretch" },
  thermalBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  thermalBtnDisabled: { opacity: 0.7, backgroundColor: colors.surfaceSecondary },
  thermalBtnText: { fontSize: 12, letterSpacing: 1, fontWeight: "900", color: colors.onSurface, fontFamily: font.display },
  staffPrintHint: {
    marginTop: 8, fontSize: 11, color: colors.muted, fontFamily: font.display, fontWeight: "700",
  },

  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  modalSheet: { backgroundColor: colors.surface, borderTopWidth: 2, borderColor: colors.borderStrong, paddingBottom: spacing.xl },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  modalTitle: { fontSize: 16, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: 1 },
  hintDim: { color: colors.muted, fontSize: 12, fontFamily: font.display, marginBottom: spacing.md },
});
