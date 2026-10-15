import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";

import { api, Patti } from "@/src/api";
import { Button } from "@/src/components/ui";
import { colors, font, spacing } from "@/src/theme";

export default function Scan() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    if (!permission) return;
    if (!permission.granted && permission.canAskAgain) requestPermission();
  }, [permission, requestPermission]);

  const onScanned = async ({ data }: { data: string }) => {
    if (!scanning || lookingUp) return;
    setLookingUp(true);
    setScanning(false);
    try {
      // Accept either a bare token or a URL with token
      const token = extractToken(data);
      const p = await api.get<Patti>(`/pattis/by-qr/${encodeURIComponent(token)}`);
      // Opens UPDATE RECEIVER directly (patti screen handles from=scan — not the details view).
      router.replace({ pathname: "/patti/[id]", params: { id: p.id, from: "scan" } });
    } catch (e: any) {
      Alert.alert("QR not recognised", e?.detail || "This QR does not match any Patti in this shop.", [
        { text: "Scan again", onPress: () => { setScanning(true); setLookingUp(false); } },
        { text: "Cancel", onPress: () => router.back() },
      ]);
    }
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.root}><View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View></SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <Header router={router} />
        <View style={styles.permBox}>
          <View style={styles.permIcon}><Ionicons name="camera-outline" size={36} color={colors.onSurface} /></View>
          <Text style={styles.permTitle}>Camera Permission Needed</Text>
          <Text style={styles.permText}>
            Point the camera at a Patti QR to update the receiver name.
          </Text>
          {permission.canAskAgain ? (
            <Button label="ALLOW CAMERA" onPress={() => requestPermission()} testID="scan-request-perm" />
          ) : (
            <Button label="OPEN SETTINGS" onPress={() => {
              // Linking to settings — done conditionally in a real device; on web just no-op
              const { Linking } = require("react-native");
              Linking.openSettings?.();
            }} testID="scan-open-settings" />
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <Header router={router} />
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={scanning ? onScanned : undefined}
        />
        <View style={styles.overlay} pointerEvents="none">
          <View style={styles.reticle}>
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />
          </View>
          <Text style={styles.overlayText}>{lookingUp ? "OPENING RECEIVER…" : "POINT AT PATTI QR"}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

function extractToken(raw: string): string {
  const s = (raw || "").trim();
  // If it's a URL, take last path segment
  const m = s.match(/([0-9a-f-]{36})/i);
  return m ? m[1] : s;
}

function Header({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={12} testID="scan-back">
        <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>SCAN PATTI</Text>
        <Text style={styles.sub}>QR at payment counter</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceInverse },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong, backgroundColor: colors.surface,
    flexDirection: "row", alignItems: "center", gap: spacing.md,
  },
  title: { fontSize: 20, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.3 },
  sub: { fontSize: 11, color: colors.muted, fontFamily: font.display, letterSpacing: 1, fontWeight: "700" },

  permBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md, backgroundColor: colors.surface },
  permIcon: { width: 80, height: 80, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  permTitle: { fontSize: 20, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, textAlign: "center" },
  permText: { fontSize: 13, color: colors.muted, fontFamily: font.display, textAlign: "center", marginBottom: spacing.md },

  cameraWrap: { flex: 1, backgroundColor: "#000" },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  reticle: { width: 260, height: 260 },
  corner: { position: "absolute", width: 40, height: 40, borderColor: "#FFFFFF" },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  overlayText: {
    marginTop: spacing.xl, color: "#FFFFFF", fontFamily: font.display,
    fontWeight: "900", letterSpacing: 2, backgroundColor: "rgba(0,0,0,0.6)", paddingVertical: 8, paddingHorizontal: 14,
  },
});
