import { useCallback, useEffect, useState } from "react";
import {
  Pressable, StyleSheet, Text, View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { api, ShopProfile } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { Button, Input } from "@/src/components/ui";
import { colors, font, spacing } from "@/src/theme";

export default function ShopProfileScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const isOwner = session?.role === "owner";

  const [p, setP] = useState<ShopProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setP(await api.get<ShopProfile>("/shop/profile")); } catch { /* silent */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (k: keyof ShopProfile, v: string) => {
    if (!p) return;
    setP({ ...p, [k]: v });
  };

  const save = async () => {
    if (!p) return;
    setError(null); setMsg(null);
    if (!p.shop_name.trim()) { setError("Shop name required"); return; }
    try {
      setSaving(true);
      const upd = await api.put<ShopProfile>("/shop/profile", {
        shop_name: p.shop_name.trim(),
        owner_name: p.owner_name || null,
        mobile: p.mobile || null, alt_mobile: p.alt_mobile || null, email: p.email || null,
        address: p.address || null, village: p.village || null, taluk: p.taluk || null,
        district: p.district || null, state: p.state || null,
        gst_number: p.gst_number || null, pan_number: p.pan_number || null,
        bank_name: p.bank_name || null, bank_account_holder: p.bank_account_holder || null,
        bank_account_number: p.bank_account_number || null, bank_ifsc: p.bank_ifsc || null,
        bank_branch: p.bank_branch || null, upi_id: p.upi_id || null,
      });
      setP(upd);
      setMsg("Saved");
    } catch (e: any) {
      setError(e?.detail || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="profile-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>SHOP PROFILE</Text>
          <Text style={styles.sub}>{isOwner ? "Editable by owner" : "Read only for staff"}</Text>
        </View>
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={80}
      >
          <Text style={styles.section}>Shop</Text>
          <Input label="Shop name" value={p?.shop_name || ""} onChangeText={(v) => set("shop_name", v)} editable={isOwner} testID="pf-shop" />
          <Input label="Owner name" value={p?.owner_name || ""} onChangeText={(v) => set("owner_name", v)} editable={isOwner} testID="pf-owner" />
          <Input label="Mobile" value={p?.mobile || ""} onChangeText={(v) => set("mobile", v)} keyboardType="phone-pad" editable={isOwner} testID="pf-mobile" />
          <Input label="Alternate mobile" value={p?.alt_mobile || ""} onChangeText={(v) => set("alt_mobile", v)} keyboardType="phone-pad" editable={isOwner} />
          <Input label="Email" value={p?.email || ""} onChangeText={(v) => set("email", v)} keyboardType="email-address" autoCapitalize="none" editable={isOwner} />

          <Text style={styles.section}>Address</Text>
          <Input label="Address" value={p?.address || ""} onChangeText={(v) => set("address", v)} multiline editable={isOwner} testID="pf-address" />
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}><Input label="Village / City" value={p?.village || ""} onChangeText={(v) => set("village", v)} editable={isOwner} /></View>
            <View style={{ flex: 1 }}><Input label="Taluk" value={p?.taluk || ""} onChangeText={(v) => set("taluk", v)} editable={isOwner} /></View>
          </View>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}><Input label="District" value={p?.district || ""} onChangeText={(v) => set("district", v)} editable={isOwner} /></View>
            <View style={{ flex: 1 }}><Input label="State" value={p?.state || ""} onChangeText={(v) => set("state", v)} editable={isOwner} /></View>
          </View>

          <Text style={styles.section}>Statutory (optional)</Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}><Input label="GST number" value={p?.gst_number || ""} onChangeText={(v) => set("gst_number", v)} autoCapitalize="characters" editable={isOwner} testID="pf-gst" /></View>
            <View style={{ flex: 1 }}><Input label="PAN" value={p?.pan_number || ""} onChangeText={(v) => set("pan_number", v)} autoCapitalize="characters" editable={isOwner} /></View>
          </View>

          <Text style={styles.section}>Bank details (used on Vendor Bill)</Text>
          <Input label="Bank name" value={p?.bank_name || ""} onChangeText={(v) => set("bank_name", v)} editable={isOwner} testID="pf-bank" />
          <Input label="Account holder" value={p?.bank_account_holder || ""} onChangeText={(v) => set("bank_account_holder", v)} editable={isOwner} />
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1.4 }}><Input label="Account number" value={p?.bank_account_number || ""} onChangeText={(v) => set("bank_account_number", v)} keyboardType="number-pad" editable={isOwner} /></View>
            <View style={{ flex: 1 }}><Input label="IFSC" value={p?.bank_ifsc || ""} onChangeText={(v) => set("bank_ifsc", v)} autoCapitalize="characters" editable={isOwner} /></View>
          </View>
          <Input label="Branch" value={p?.bank_branch || ""} onChangeText={(v) => set("bank_branch", v)} editable={isOwner} />
          <Input label="UPI ID" value={p?.upi_id || ""} onChangeText={(v) => set("upi_id", v)} autoCapitalize="none" editable={isOwner} testID="pf-upi" />

          {error ? <Text style={styles.err}>{error}</Text> : null}
          {msg ? <Text style={styles.ok}>{msg}</Text> : null}

          {isOwner && <Button label="SAVE PROFILE" onPress={save} loading={saving} testID="pf-save" />}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
    flexDirection: "row", alignItems: "center", gap: spacing.md,
  },
  title: { fontSize: 20, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.3 },
  sub: { fontSize: 11, color: colors.muted, fontFamily: font.display, letterSpacing: 1, fontWeight: "700" },
  section: {
    fontSize: 11, letterSpacing: 2, color: colors.muted, textTransform: "uppercase",
    fontFamily: font.display, fontWeight: "800", marginTop: spacing.md, marginBottom: spacing.sm,
  },
  err: { color: colors.error, backgroundColor: "#FEE2E2", borderWidth: 2, borderColor: colors.error, padding: spacing.sm, marginBottom: spacing.sm, fontFamily: font.display, fontWeight: "700" },
  ok: { color: colors.success, backgroundColor: "#D1FAE5", borderWidth: 2, borderColor: colors.success, padding: spacing.sm, marginBottom: spacing.sm, fontFamily: font.display, fontWeight: "700" },
});
