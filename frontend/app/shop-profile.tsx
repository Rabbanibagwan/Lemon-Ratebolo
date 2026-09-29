import { useCallback, useEffect, useState } from "react";
import {
  Alert, Image, Platform, Pressable, StyleSheet, Text, View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

import { api, ShopProfile } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { Button, Input } from "@/src/components/ui";
import { colors, font, spacing } from "@/src/theme";
import { isValidUpiId, normalizeUpiId } from "@/src/utils/merchant-upi";
import { imageDataUri } from "@/src/utils/png-mono";

/** Max stored base64 length (matches backend ShopProfile.upi_qr_base64). */
const MAX_QR_BASE64 = 480_000;

export default function ShopProfileScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const isOwner = session?.role === "owner";

  const [p, setP] = useState<ShopProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setP(await api.get<ShopProfile>("/shop/profile")); } catch { /* silent */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (k: keyof ShopProfile, v: string | null) => {
    if (!p) return;
    setP({ ...p, [k]: v });
  };

  const qrPreview = imageDataUri(p?.upi_qr_base64);

  const pickMerchantQr = async (source: "camera" | "gallery") => {
    if (!p || !isOwner) return;
    setError(null); setMsg(null);
    try {
      setPicking(true);
      const perm = source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Permission needed",
          source === "camera" ? "Camera access is required to capture the Merchant QR." : "Photo library access is required to upload the Merchant QR.",
        );
        return;
      }
      const result = source === "camera"
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            quality: 0.9,
            allowsEditing: Platform.OS !== "web",
            aspect: [1, 1],
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 0.9,
            allowsEditing: Platform.OS !== "web",
            aspect: [1, 1],
          });
      if (result.canceled || !result.assets?.[0]?.uri) return;

      // Normalize to compact square PNG for storage + thermal raster print.
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 360 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.PNG, base64: true },
      );
      const b64 = manipulated.base64 || "";
      if (!b64) {
        setError("Could not read QR image. Try another photo.");
        return;
      }
      if (b64.length > MAX_QR_BASE64) {
        setError("QR image is too large. Crop closer to the QR and try again.");
        return;
      }
      set("upi_qr_base64", `data:image/png;base64,${b64}`);
      setMsg("Merchant QR ready — tap SAVE PROFILE to keep it.");
    } catch (e: any) {
      setError(e?.message || "Failed to upload QR image");
    } finally {
      setPicking(false);
    }
  };

  const clearMerchantQr = () => {
    if (!p || !isOwner) return;
    set("upi_qr_base64", null);
    setMsg("Merchant QR cleared — tap SAVE PROFILE to apply.");
  };

  const save = async () => {
    if (!p) return;
    setError(null); setMsg(null);
    if (!p.shop_name.trim()) { setError("Shop name required"); return; }
    const upiRaw = String(p.upi_id || "").trim();
    const upiId = upiRaw ? normalizeUpiId(upiRaw) : "";
    if (upiRaw && !isValidUpiId(upiId)) {
      setError("Enter a valid Merchant UPI ID (example: merchant@upi)");
      return;
    }
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
        bank_branch: p.bank_branch || null,
        upi_id: upiId || null,
        upi_name: String(p.upi_name || "").trim() || null,
        upi_qr_base64: p.upi_qr_base64 || null,
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

          <Text style={styles.section}>Payment / UPI QR</Text>
          <Text style={styles.hint}>
            Upload the merchant&apos;s own UPI QR image for Vendor Bill thermal print.
            Public UPI ID is optional. Never enter PIN, OTP, or banking passwords.
          </Text>

          <View style={styles.qrBox} testID="pf-upi-qr-box">
            {qrPreview ? (
              <Image source={{ uri: qrPreview }} style={styles.qrImg} accessibilityLabel="Merchant QR preview" />
            ) : (
              <View style={styles.qrPlaceholder}>
                <Ionicons name="qr-code-outline" size={40} color={colors.muted} />
                <Text style={styles.qrPlaceholderText}>No Merchant QR uploaded</Text>
              </View>
            )}
            {isOwner ? (
              <View style={styles.qrActions}>
                <Pressable
                  style={({ pressed }) => [styles.qrBtn, pressed && { opacity: 0.85 }, picking && { opacity: 0.5 }]}
                  onPress={() => pickMerchantQr("gallery")}
                  disabled={picking}
                  testID="pf-upi-qr-gallery"
                >
                  <Ionicons name="images-outline" size={16} color={colors.onSurface} />
                  <Text style={styles.qrBtnText}>GALLERY</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.qrBtn, pressed && { opacity: 0.85 }, picking && { opacity: 0.5 }]}
                  onPress={() => pickMerchantQr("camera")}
                  disabled={picking}
                  testID="pf-upi-qr-camera"
                >
                  <Ionicons name="camera-outline" size={16} color={colors.onSurface} />
                  <Text style={styles.qrBtnText}>CAMERA</Text>
                </Pressable>
                {qrPreview ? (
                  <Pressable
                    style={({ pressed }) => [styles.qrBtn, styles.qrBtnDanger, pressed && { opacity: 0.85 }]}
                    onPress={clearMerchantQr}
                    testID="pf-upi-qr-clear"
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                    <Text style={[styles.qrBtnText, { color: colors.error }]}>CLEAR</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>

          <Input
            label="Merchant UPI ID / VPA (optional)"
            value={p?.upi_id || ""}
            onChangeText={(v) => set("upi_id", v)}
            autoCapitalize="none"
            autoCorrect={false}
            editable={isOwner}
            placeholder="merchant@upi"
            testID="pf-upi"
          />
          <Input
            label="UPI Display Name (optional)"
            value={p?.upi_name || ""}
            onChangeText={(v) => set("upi_name", v)}
            editable={isOwner}
            placeholder="Shown as payee name"
            testID="pf-upi-name"
          />

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
  hint: {
    fontSize: 11, color: colors.muted, fontFamily: font.display, fontWeight: "600",
    marginBottom: spacing.sm, lineHeight: 16,
  },
  qrBox: {
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, marginBottom: spacing.md,
    alignItems: "center", backgroundColor: colors.surface,
  },
  qrImg: { width: 180, height: 180, marginBottom: spacing.sm },
  qrPlaceholder: {
    width: 180, height: 180, marginBottom: spacing.sm, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.divider, borderStyle: "dashed",
  },
  qrPlaceholderText: { marginTop: 8, fontSize: 11, color: colors.muted, fontFamily: font.display, fontWeight: "700" },
  qrActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "center" },
  qrBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 12, paddingVertical: 10,
  },
  qrBtnDanger: { borderColor: colors.error },
  qrBtnText: { fontFamily: font.display, fontWeight: "900", fontSize: 11, letterSpacing: 0.5, color: colors.onSurface },
  err: { color: colors.error, backgroundColor: "#FEE2E2", borderWidth: 2, borderColor: colors.error, padding: spacing.sm, marginBottom: spacing.sm, fontFamily: font.display, fontWeight: "700" },
  ok: { color: colors.success, backgroundColor: "#D1FAE5", borderWidth: 2, borderColor: colors.success, padding: spacing.sm, marginBottom: spacing.sm, fontFamily: font.display, fontWeight: "700" },
});
