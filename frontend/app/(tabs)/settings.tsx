import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { api, apiErrorMessage, Settings as SettingsT } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { KeyboardFormScroll } from "@/src/components/KeyboardForm";
import { Button, Input } from "@/src/components/ui";
import {
  LEGAL_SUPPORT_EMAIL,
  LEGAL_URLS,
  openPrivacyPolicy,
  openSupportContact,
  openSupportEmail,
  openTermsOfService,
} from "@/src/utils/legal-links";
import { colors, font, spacing } from "@/src/theme";

export default function SettingsScreen() {
  const { session, logout, deleteAccount } = useAuth();
  const router = useRouter();
  const isOwner = session?.role === "owner";
  const [s, setS] = useState<SettingsT | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try { setS(await api.get<SettingsT>("/settings")); } catch { /* silent */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (k: keyof SettingsT, v: string) => {
    if (!s) return;
    const num = v === "" ? 0 : Number(v);
    setS({ ...s, [k]: isFinite(num) ? num : 0 });
  };

  const save = async () => {
    if (!s) return;
    setError(null); setMsg(null);
    if (s.payment_factor <= 0 || s.payment_factor > 1) { setError("Farmer factor must be between 0 and 1"); return; }
    if (!s.vendor_factor || s.vendor_factor <= 0) { setError("Vendor factor must be greater than 0"); return; }
    if (s.hamali_per_bag < 0 || s.stationery_flat < 0 || s.default_bhada_per_bag < 0) {
      setError("Rates cannot be negative"); return;
    }
    if ((s.vendor_margin_per_bag ?? 0) < 0 || (s.commission_per_bag ?? 0) < 0) {
      setError("Vendor rates cannot be negative"); return;
    }
    try {
      setSaving(true);
      const d = await api.put<SettingsT>("/settings", s);
      setS(d);
      setMsg("Saved");
    } catch (e: any) {
      setError(e?.detail || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const openDeleteModal = () => {
    setDeletePassword("");
    setDeleteError(null);
    setDeleteOpen(true);
  };

  const closeDeleteModal = () => {
    if (deleting) return;
    setDeleteOpen(false);
    setDeletePassword("");
    setDeleteError(null);
  };

  const confirmDeleteAccount = async () => {
    if (!deletePassword.trim()) {
      setDeleteError("Enter your password to confirm deletion.");
      return;
    }
    setDeleteError(null);
    try {
      setDeleting(true);
      await deleteAccount(deletePassword);
      setDeleteOpen(false);
      router.replace("/login");
    } catch (e) {
      setDeleteError(apiErrorMessage(e, "Could not delete account"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}><Text style={styles.title}>SETTINGS</Text></View>

      <KeyboardFormScroll contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}>
          <View style={styles.shopCard}>
            <View style={styles.shopIcon}>
              <Ionicons name={isOwner ? "storefront" : "person"} size={22} color={colors.onBrandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.shopName} numberOfLines={1}>{session?.display_name || "—"}</Text>
              <Text style={styles.shopUser}>{isOwner ? session?.shop_name : `Counter · ${session?.shop_name}`}</Text>
              <Text style={styles.shopUser}>@{session?.username}</Text>
            </View>
          </View>

          {isOwner ? (
            <>
              <Text style={styles.section}>Farmer Patti defaults</Text>
              <Input
                label="Farmer Commission Factor (0–1)"
                value={s ? String(s.payment_factor) : ""}
                onChangeText={(v) => set("payment_factor", v)}
                keyboardType="decimal-pad"
                hint="Used only for Farmer Patti. Independent of Vendor Factor."
                testID="settings-factor"
              />
              <Input
                label="Hamali per bag (₹)"
                value={s ? String(s.hamali_per_bag) : ""}
                onChangeText={(v) => set("hamali_per_bag", v)}
                keyboardType="decimal-pad"
                testID="settings-hamali"
              />
              <Input
                label="Stationery per Patti (₹) — flat"
                value={s ? String(s.stationery_flat) : ""}
                onChangeText={(v) => set("stationery_flat", v)}
                keyboardType="decimal-pad"
                hint="Fixed charge per bill, not per bag."
                testID="settings-stationery"
              />
              <Input
                label="Default Bhada per bag (₹)"
                value={s ? String(s.default_bhada_per_bag) : ""}
                onChangeText={(v) => set("default_bhada_per_bag", v)}
                keyboardType="decimal-pad"
                hint="Used only if no driver range applies for a lot."
                testID="settings-bhada"
              />

              <Text style={[styles.section, { marginTop: spacing.lg }]}>Vendor Bill defaults</Text>
              <Input
                label="Vendor Commission Factor"
                value={s ? String(s.vendor_factor ?? 1.06) : ""}
                onChangeText={(v) => set("vendor_factor", v)}
                keyboardType="decimal-pad"
                hint="e.g. 1.06. Used only for Vendor Bill. Never affects Farmer Patti."
                testID="settings-vendor-factor"
              />
              <Input
                label="Vendor Margin / bag (₹)"
                value={s ? String(s.vendor_margin_per_bag ?? 30) : ""}
                onChangeText={(v) => set("vendor_margin_per_bag", v)}
                keyboardType="decimal-pad"
                hint="Vendor rate = auction × factor + margin. Snapshot on each bill."
                testID="settings-vendor-margin"
              />
              <Input
                label="Vendor Commission / bag (₹)"
                value={s ? String(s.commission_per_bag ?? 10) : ""}
                onChangeText={(v) => set("commission_per_bag", v)}
                keyboardType="decimal-pad"
                hint="Added as bags × commission on the Vendor Bill total."
                testID="settings-vendor-commission"
              />

              <Text style={[styles.section, { marginTop: spacing.lg }]}>Printing Settings</Text>
              <Pressable
                onPress={() => s && setS({ ...s, detailed_print_format: !s.detailed_print_format })}
                style={styles.toggleRow}
                testID="settings-detailed-print"
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleLabel}>Detailed print format</Text>
                  <Text style={styles.toggleHint}>Show Hamali formula on digital PDF only. Thermal slip stays compact.</Text>
                </View>
                <View style={[styles.toggleBox, s?.detailed_print_format && styles.toggleBoxOn]}>
                  {s?.detailed_print_format ? <Ionicons name="checkmark" size={18} color={colors.onBrandPrimary} /> : null}
                </View>
              </Pressable>

              <View style={styles.paperRow}>
                <Text style={styles.toggleLabel}>Printer Paper Size</Text>
                <Text style={styles.toggleHint}>
                  Current: {s?.thermal_paper_width_mm || 80} mm. Changes fonts, margins, columns & QR for Farmer Patti and Vendor Bill. Default 80 mm.
                </Text>
                <View style={styles.paperChoices}>
                  {[58, 80, 100].map((w) => (
                    <Pressable
                      key={w}
                      onPress={() => s && setS({ ...s, thermal_paper_width_mm: w })}
                      style={[styles.paperChip, (s?.thermal_paper_width_mm || 80) === w && styles.paperChipOn]}
                      testID={`settings-paper-${w}`}
                    >
                      <Text style={[styles.paperChipText, (s?.thermal_paper_width_mm || 80) === w && styles.paperChipTextOn]}>{w} mm</Text>
                    </Pressable>
                  ))}
                </View>
                <Input
                  label="Custom width (mm)"
                  value={
                    s && ![58, 80, 100].includes(s.thermal_paper_width_mm || 80)
                      ? String(s.thermal_paper_width_mm)
                      : ""
                  }
                  onChangeText={(v) => {
                    if (!s) return;
                    const digits = v.replace(/[^0-9]/g, "");
                    if (!digits) {
                      setS({ ...s, thermal_paper_width_mm: 80 });
                      return;
                    }
                    const n = Math.max(40, Math.min(120, parseInt(digits, 10) || 80));
                    setS({ ...s, thermal_paper_width_mm: n });
                  }}
                  keyboardType="number-pad"
                  placeholder="e.g. 72 (40–120)"
                  hint="Optional. Leave blank and use 58 / 80 / 100 above."
                  testID="settings-paper-custom"
                />
              </View>

              {error ? <Text style={styles.err}>{error}</Text> : null}
              {msg ? <Text style={styles.ok}>{msg}</Text> : null}
              <Button label="SAVE SETTINGS" onPress={save} loading={saving} testID="settings-save" />

              <Text style={[styles.section, { marginTop: spacing.xl }]}>Manage</Text>
              <NavRow icon="storefront-outline" label="SHOP PROFILE & BANK" onPress={() => router.push("/shop-profile")} testID="settings-shop-profile" />
              <NavRow icon="people-outline" label="FARMERS & VENDORS" onPress={() => router.push("/(tabs)/directory")} testID="settings-directory" />
              <NavRow icon="id-card-outline" label="STAFF ACCOUNTS" onPress={() => router.push("/staff")} testID="settings-staff" />
              <NavRow icon="cloud-upload-outline" label="BACKUP & RESTORE" onPress={() => router.push("/backup" as any)} testID="settings-backup" />
            </>
          ) : (
            <View style={styles.roleNote}>
              <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
              <Text style={styles.roleNoteText}>
                Counter role has limited access. Contact the shop owner to change billing defaults or manage staff.
              </Text>
            </View>
          )}

          <Text style={[styles.section, { marginTop: spacing.xl }]}>Printing</Text>
          <NavRow icon="print-outline" label="PRINTER" onPress={() => router.push("/printer")} testID="settings-printer-all" />

          <Text style={[styles.section, { marginTop: spacing.xl }]}>Legal & Support</Text>
          {LEGAL_URLS.privacyPolicy ? (
            <ExternalLinkRow
              icon="shield-checkmark-outline"
              label="PRIVACY POLICY"
              onPress={() => openPrivacyPolicy()}
              testID="settings-privacy-policy"
            />
          ) : null}
          {LEGAL_URLS.termsOfService ? (
            <ExternalLinkRow
              icon="document-text-outline"
              label="TERMS OF SERVICE"
              onPress={() => openTermsOfService()}
              testID="settings-terms"
            />
          ) : null}
          {LEGAL_URLS.support ? (
            <ExternalLinkRow
              icon="help-circle-outline"
              label="SUPPORT / CONTACT"
              onPress={() => openSupportContact()}
              testID="settings-support"
            />
          ) : null}
          <ExternalLinkRow
            icon="mail-outline"
            label={`EMAIL · ${LEGAL_SUPPORT_EMAIL}`}
            onPress={() => openSupportEmail()}
            testID="settings-support-email"
          />

          <View style={styles.dangerBox}>
            <Text style={styles.dangerTitle}>Session</Text>
            <Pressable onPress={logout} style={styles.logout} testID="settings-logout">
              <Ionicons name="log-out-outline" size={18} color={colors.error} />
              <Text style={styles.logoutText}>LOGOUT</Text>
            </Pressable>
            {isOwner ? (
              <>
                <Text style={[styles.dangerTitle, { marginTop: spacing.lg }]}>Account</Text>
                <Text style={styles.deleteHint}>
                  Permanently deletes your shop account and all associated data (Pattis, lots, farmers,
                  vendors, staff, bills, wallet, and backups on this device). This cannot be undone.
                </Text>
                <Pressable onPress={openDeleteModal} style={styles.deleteAccount} testID="settings-delete-account">
                  <Ionicons name="trash-outline" size={18} color={colors.error} />
                  <Text style={styles.logoutText}>DELETE ACCOUNT</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </KeyboardFormScroll>

      <Modal
        visible={deleteOpen}
        transparent
        animationType="fade"
        onRequestClose={closeDeleteModal}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeDeleteModal} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete account?</Text>
            <Text style={styles.modalBody}>
              This permanently removes {session?.shop_name || "your shop"} and all shop data from our
              servers. Staff accounts will lose access. Enter your password to confirm.
            </Text>
            <Input
              label="Password"
              value={deletePassword}
              onChangeText={setDeletePassword}
              secureTextEntry
              autoCapitalize="none"
              testID="settings-delete-password"
            />
            {deleteError ? <Text style={styles.err}>{deleteError}</Text> : null}
            <Button
              label="DELETE MY ACCOUNT"
              onPress={confirmDeleteAccount}
              loading={deleting}
              testID="settings-delete-confirm"
            />
            <Pressable style={styles.modalCancel} onPress={closeDeleteModal} disabled={deleting}>
              <Text style={styles.modalCancelText}>CANCEL</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function NavRow({ icon, label, onPress, testID }: { icon: any; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.navRow, pressed && { backgroundColor: colors.surfaceSecondary }]}
    >
      <Ionicons name={icon} size={20} color={colors.onSurface} />
      <Text style={styles.navRowText}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

function ExternalLinkRow({ icon, label, onPress, testID }: { icon: any; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.navRow, pressed && { backgroundColor: colors.surfaceSecondary }]}
    >
      <Ionicons name={icon} size={20} color={colors.onSurface} />
      <Text style={styles.navRowText} numberOfLines={2}>{label}</Text>
      <Ionicons name="open-outline" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  title: { fontSize: 28, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.5 },
  shopCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md,
    marginBottom: spacing.lg, backgroundColor: colors.surface,
  },
  shopIcon: {
    width: 48, height: 48, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.brand,
  },
  shopName: { fontSize: 18, fontWeight: "900", color: colors.onSurface, fontFamily: font.display },
  shopUser: { fontSize: 12, color: colors.muted, fontFamily: font.mono },
  section: {
    fontSize: 11, letterSpacing: 2, color: colors.muted, textTransform: "uppercase",
    fontFamily: font.display, fontWeight: "800", marginBottom: spacing.sm,
  },
  err: { color: colors.error, backgroundColor: "#FEE2E2", borderWidth: 2, borderColor: colors.error, padding: spacing.sm, marginBottom: spacing.sm, fontFamily: font.display, fontWeight: "700" },
  ok: { color: colors.success, backgroundColor: "#D1FAE5", borderWidth: 2, borderColor: colors.success, padding: spacing.sm, marginBottom: spacing.sm, fontFamily: font.display, fontWeight: "700" },
  navRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, marginBottom: spacing.sm,
  },
  navRowText: { flex: 1, fontSize: 14, fontFamily: font.display, fontWeight: "800", letterSpacing: 1, color: colors.onSurface },
  dangerBox: {
    marginTop: spacing.xxl, borderWidth: 2, borderColor: colors.error, padding: spacing.md,
  },
  dangerTitle: {
    fontSize: 11, letterSpacing: 2, color: colors.error, textTransform: "uppercase",
    fontFamily: font.display, fontWeight: "800", marginBottom: spacing.sm,
  },
  logout: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingVertical: 12, paddingHorizontal: 14, borderWidth: 2, borderColor: colors.error, backgroundColor: colors.surface,
    justifyContent: "center",
  },
  deleteAccount: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingVertical: 12, paddingHorizontal: 14, borderWidth: 2, borderColor: colors.error, backgroundColor: "#FEE2E2",
    justifyContent: "center", marginTop: spacing.sm,
  },
  deleteHint: {
    fontSize: 12, color: colors.muted, fontFamily: font.display, lineHeight: 18, marginBottom: spacing.sm,
  },
  logoutText: { color: colors.error, fontFamily: font.display, fontWeight: "800", letterSpacing: 1 },
  modalBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.lg,
  },
  modalTitle: {
    fontSize: 20, fontWeight: "900", color: colors.error, fontFamily: font.display, marginBottom: spacing.sm,
  },
  modalBody: {
    fontSize: 13, color: colors.onSurface, fontFamily: font.display, lineHeight: 20, marginBottom: spacing.md,
  },
  modalCancel: { marginTop: spacing.md, alignItems: "center", paddingVertical: spacing.sm },
  modalCancelText: { fontSize: 13, fontWeight: "800", color: colors.muted, fontFamily: font.display, letterSpacing: 1 },
  roleNote: {
    flexDirection: "row", gap: spacing.sm, alignItems: "flex-start",
    padding: spacing.md, backgroundColor: colors.surfaceSecondary,
    borderWidth: 2, borderColor: colors.border,
  },
  roleNoteText: { flex: 1, color: colors.muted, fontFamily: font.display, fontSize: 13 },
  toggleRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md,
    marginBottom: spacing.md, backgroundColor: colors.surface,
  },
  toggleLabel: { fontSize: 14, fontWeight: "800", color: colors.onSurface, fontFamily: font.display },
  toggleHint: { fontSize: 11, color: colors.muted, marginTop: 2 },
  toggleBox: {
    width: 28, height: 28, borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.surface,
  },
  toggleBoxOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brand },
  paperRow: {
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md,
    marginBottom: spacing.md, backgroundColor: colors.surface,
  },
  paperChoices: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  paperChip: {
    flex: 1, borderWidth: 2, borderColor: colors.borderStrong,
    paddingVertical: 10, alignItems: "center", backgroundColor: colors.surface,
  },
  paperChipOn: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  paperChipText: { fontSize: 13, fontWeight: "800", color: colors.onSurface, fontFamily: font.display, letterSpacing: 1 },
  paperChipTextOn: { color: colors.onSurfaceInverse },
});
