import { useEffect, useState } from "react";
import {
  Alert, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView,
  StyleSheet, Text, View, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

import { api } from "@/src/api";
import { setOcrSession, OcrExtractedRow, BLANK_LOT_ROWS, DEMO_OCR_ROWS } from "@/src/ocr-session";
import { Button, Input } from "@/src/components/ui";
import { colors, font, spacing } from "@/src/theme";

type Stage = "pick" | "crop" | "ready";

export default function OcrCapture() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("pick");
  const [rawUri, setRawUri] = useState<string | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [geminiKey, setGeminiKey] = useState("");
  const [needKey, setNeedKey] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [cropInsets, setCropInsets] = useState({ top: 0, bottom: 0, left: 0, right: 0 });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Env / Settings key → Extract works without the yellow paste box.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const st = await api.get<{ configured: boolean }>("/ocr/status");
        if (!cancelled && st?.configured) {
          setKeyConfigured(true);
          setNeedKey(false);
        }
      } catch {
        // ignore — extract will surface missing-key if needed
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const reset = () => {
    setStage("pick");
    setRawUri(null);
    setImageUri(null);
    setImageBase64(null);
    setCropInsets({ top: 0, bottom: 0, left: 0, right: 0 });
    setError(null);
  };

  const pickImage = async (source: "camera" | "gallery") => {
    setError(null);
    try {
      const perm = source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) {
          Alert.alert(
            "Permission required",
            `${source === "camera" ? "Camera" : "Photo library"} access is needed to scan diary pages.`,
            [
              { text: "Cancel", style: "cancel" },
              { text: "Open Settings", onPress: () => Linking.openSettings() },
            ],
          );
        }
        return;
      }
      // Native platforms: allowsEditing opens the system crop UI (mandatory crop step).
      // Web: allowsEditing is limited — we show our own crop confirm screen next.
      const result = source === "camera"
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            quality: 0.92,
            allowsEditing: Platform.OS !== "web",
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 0.92,
            allowsEditing: Platform.OS !== "web",
          });
      if (result.canceled || !result.assets?.[0]) return;
      const uri = result.assets[0].uri;
      setRawUri(uri);
      if (Platform.OS === "web") {
        setStage("crop");
        setImageUri(uri);
      } else {
        // Already cropped via system UI → compress and go to confirm/extract
        await finalizeCrop(uri);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to pick image");
    }
  };

  const finalizeCrop = async (uri: string, insets = cropInsets) => {
    try {
      setError(null);
      // Measure via manipulate: first get size by loading without ops if needed
      let actions: ImageManipulator.Action[] = [];
      const hasInsets = insets.top > 0 || insets.bottom > 0 || insets.left > 0 || insets.right > 0;
      if (hasInsets) {
        // Probe dimensions with a no-op resize pass
        const probe = await ImageManipulator.manipulateAsync(uri, [], { format: ImageManipulator.SaveFormat.JPEG });
        // We don't get width/height from all platforms reliably; use Image.getSize
        const size = await new Promise<{ w: number; h: number }>((resolve, reject) => {
          Image.getSize(
            probe.uri,
            (w, h) => resolve({ w, h }),
            (err) => reject(err),
          );
        });
        const left = Math.round((insets.left / 100) * size.w);
        const top = Math.round((insets.top / 100) * size.h);
        const width = Math.max(40, size.w - left - Math.round((insets.right / 100) * size.w));
        const height = Math.max(40, size.h - top - Math.round((insets.bottom / 100) * size.h));
        actions = [{ crop: { originX: left, originY: top, width, height } }];
      }
      actions.push({ resize: { width: 1600 } });
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        actions,
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      setImageUri(manipulated.uri);
      setImageBase64(manipulated.base64 || null);
      setStage("ready");
    } catch (e: any) {
      setError(e?.message || "Crop failed");
    }
  };

  const goToPreview = (rows: OcrExtractedRow[], model: string, warning?: string) => {
    setOcrSession(rows, { model, warning, imageUri: imageUri || null });
    router.push("/ocr/preview");
  };

  const openManualReview = (warning?: string) => {
    goToPreview(
      BLANK_LOT_ROWS,
      "manual",
      warning || "Enter Lot / Farmer / Vendors from the photo below.",
    );
  };

  /** Primary path: extract lots from the diary photo via Gemini. */
  const runOcr = async () => {
    if (!imageBase64) return;
    setError(null);
    setProcessing(true);
    try {
      const payload: Record<string, unknown> = {
        image_base64: imageBase64,
        mime_type: "image/jpeg",
        hint: hint.trim() || "Standard diary: 1/5 ABDG (50) then MM 02 1000. 1=Lot, 5=Bags, (50)=Bhada/bag. Multi vendors = one lot.",
      };
      if (geminiKey.trim()) {
        payload.gemini_api_key = geminiKey.trim();
        payload.persist_key = true;
      }
      const cloud = Promise.race([
        api.post<{ rows: OcrExtractedRow[]; model: string; warning?: string }>(
          "/ocr/action-diary",
          payload,
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("OCR timed out")), 60000),
        ),
      ]);
      const resp = await cloud;
      if (resp.warning === "NO_CLOUD_OCR_KEY") {
        setNeedKey(true);
        setKeyConfigured(false);
        setError("Paste a free Gemini API key below to extract from the photo (aistudio.google.com/apikey).");
        return;
      }
      setNeedKey(false);
      setKeyConfigured(true);
      if (!resp.rows?.length) {
        setError(resp.warning || "Nothing extracted. Retake a clearer photo, or enter manually.");
        return;
      }
      goToPreview(resp.rows, resp.model, resp.warning);
    } catch (e: any) {
      const msg = typeof e?.detail === "string" ? e.detail : (e?.detail?.message || e?.message || "OCR failed");
      const text = String(msg);
      if (/not valid|API key|NO_CLOUD_OCR_KEY|401|403/i.test(text)) {
        setNeedKey(true);
        setKeyConfigured(false);
        setError(
          "Saved Gemini key is invalid or missing. Paste a fresh key from aistudio.google.com/apikey below, then Extract again.",
        );
      } else if (text.includes("timed out")) {
        setError("Extraction timed out. Try a tighter crop and Extract again.");
      } else {
        setError(text);
      }
    } finally {
      setProcessing(false);
    }
  };

  const runTextParse = async () => {
    if (!pasteText.trim()) return;
    setError(null);
    setProcessing(true);
    try {
      const resp = await api.post<{ rows: OcrExtractedRow[]; model: string; warning?: string }>(
        "/ocr/action-diary-text",
        { text: pasteText },
      );
      if (!resp.rows?.length) {
        setError(resp.warning || "Could not parse text. Example:\n1/5 ABDG (50)\nMM 2 1000\nAB 2 1000");
        return;
      }
      goToPreview(resp.rows, resp.model, resp.warning);
    } catch (e: any) {
      setError(e?.detail || e?.message || "Parse failed");
    } finally {
      setProcessing(false);
    }
  };

  const bumpInset = (key: keyof typeof cropInsets, delta: number) => {
    setCropInsets((c) => ({ ...c, [key]: Math.max(0, Math.min(40, c[key] + delta)) }));
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="ocr-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>SCAN ACTION DIARY</Text>
          <Text style={styles.headerSub}>
            {stage === "pick" ? "Capture or choose a page" : stage === "crop" ? "Crop relevant portion" : "Confirm & extract"}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 220 }} keyboardShouldPersistTaps="handled">
          {stage === "pick" ? (
            <>
              <View style={styles.captureRow}>
                <Pressable style={styles.captureTile} onPress={() => pickImage("camera")} testID="ocr-camera">
                  <Ionicons name="camera-outline" size={32} color={colors.onSurface} />
                  <Text style={styles.captureLabel}>CAPTURE PHOTO</Text>
                </Pressable>
                <Pressable style={styles.captureTile} onPress={() => pickImage("gallery")} testID="ocr-gallery">
                  <Ionicons name="images-outline" size={32} color={colors.onSurface} />
                  <Text style={styles.captureLabel}>SELECT FROM GALLERY</Text>
                </Pressable>
              </View>
              <View style={styles.tipsBox}>
                <Text style={styles.tipsTitle}>WORKFLOW</Text>
                <Text style={styles.tipsText}>1. Capture photo or pick from gallery</Text>
                <Text style={styles.tipsText}>2. Crop only the Action Diary portion</Text>
                <Text style={styles.tipsText}>3. Extract fills Lot No, Total Bags, Farmer, rates from the photo</Text>
                <Text style={styles.tipsText}>4. Review & edit → Save / Save & Print</Text>
              </View>

              <Pressable style={styles.pasteToggle} onPress={() => setShowPaste((v) => !v)} testID="ocr-paste-toggle">
                <Ionicons name="document-text-outline" size={16} color={colors.onSurface} />
                <Text style={styles.pasteToggleText}>{showPaste ? "HIDE TEXT PASTE" : "OR PASTE DIARY TEXT"}</Text>
              </Pressable>
              {showPaste ? (
                <View style={{ marginTop: spacing.sm }}>
                  <Input
                    label="Diary text"
                    value={pasteText}
                    onChangeText={setPasteText}
                    multiline
                    placeholder={"1/5 ABDG (50)\nMM 2 1000\nAB 2 1000\nMC 1 1000"}
                    testID="ocr-paste-text"
                  />
                  <Button label={processing ? "PARSING…" : "PARSE TEXT → REVIEW"} onPress={runTextParse} loading={processing} testID="ocr-parse-text" />
                </View>
              ) : null}

              <Pressable
                style={[styles.pasteToggle, { marginTop: spacing.sm }]}
                onPress={() => goToPreview(DEMO_OCR_ROWS, "demo", "Sample extraction — edit every field before saving.")}
                testID="ocr-open-sample-preview"
              >
                <Ionicons name="eye-outline" size={16} color={colors.onSurface} />
                <Text style={styles.pasteToggleText}>OPEN SAMPLE REVIEW SCREEN</Text>
              </Pressable>
            </>
          ) : null}

          {stage === "crop" && imageUri ? (
            <View>
              <View style={styles.previewBox}>
                <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="contain" />
                <View
                  pointerEvents="none"
                  style={[
                    styles.cropOverlay,
                    {
                      top: `${cropInsets.top}%` as any,
                      bottom: `${cropInsets.bottom}%` as any,
                      left: `${cropInsets.left}%` as any,
                      right: `${cropInsets.right}%` as any,
                    },
                  ]}
                />
              </View>
              <Text style={styles.cropHint}>Trim edges so only the diary block remains, then confirm crop.</Text>
              {(["top", "bottom", "left", "right"] as const).map((side) => (
                <View key={side} style={styles.cropRow}>
                  <Text style={styles.cropLabel}>{side.toUpperCase()} {cropInsets[side]}%</Text>
                  <Pressable style={styles.cropBtn} onPress={() => bumpInset(side, -2)} testID={`crop-dec-${side}`}>
                    <Text style={styles.cropBtnText}>−</Text>
                  </Pressable>
                  <Pressable style={styles.cropBtn} onPress={() => bumpInset(side, 2)} testID={`crop-inc-${side}`}>
                    <Text style={styles.cropBtnText}>+</Text>
                  </Pressable>
                </View>
              ))}
              <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Button label="RETAKE" variant="secondary" onPress={reset} testID="ocr-retake-crop" />
                </View>
                <View style={{ flex: 1.4 }}>
                  <Button
                    label="CONFIRM CROP → OCR"
                    onPress={() => rawUri && finalizeCrop(rawUri, cropInsets)}
                    testID="ocr-confirm-crop"
                  />
                </View>
              </View>
            </View>
          ) : null}

          {stage === "ready" && imageUri ? (
            <View>
              <View style={styles.previewBox}>
                <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="cover" />
                <Pressable style={styles.retakeBtn} onPress={reset} testID="ocr-retake">
                  <Ionicons name="close" size={16} color={colors.onBrandPrimary} />
                  <Text style={styles.retakeText}>RETAKE</Text>
                </Pressable>
              </View>
              <View style={{ marginTop: spacing.lg }}>
                <Input
                  label="Extraction hint (optional)"
                  value={hint}
                  onChangeText={setHint}
                  placeholder="e.g. 1/5 ABDG (50) then MM 02 1000"
                  multiline
                  testID="ocr-hint"
                />
              </View>
              {(!keyConfigured && (needKey || geminiKey.length > 0)) ? (
                <View style={styles.keyBox}>
                  <Text style={styles.keyTitle}>
                    {needKey ? "GEMINI API KEY NEEDED" : "GEMINI API KEY (OPTIONAL OVERRIDE)"}
                  </Text>
                  <Input
                    label="Paste free key"
                    value={geminiKey}
                    onChangeText={setGeminiKey}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="AIza… or AQ.… from aistudio.google.com/apikey"
                    testID="ocr-gemini-key"
                  />
                  <Pressable onPress={() => Linking.openURL("https://aistudio.google.com/apikey")} testID="ocr-get-key">
                    <Text style={styles.keyLink}>Get free key → aistudio.google.com/apikey</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          {error ? <Text style={styles.err}>{error}</Text> : null}
        </ScrollView>

        {stage === "ready" && imageUri ? (
          <View style={styles.footer}>
            <Button
              label={processing ? "EXTRACTING…" : "EXTRACT FROM PHOTO"}
              onPress={runOcr}
              loading={processing}
              testID="ocr-extract"
            />
            {processing ? (
              <View style={styles.procHint}>
                <ActivityIndicator size="small" color={colors.brandPrimary} />
                <Text style={styles.procHintText}>Reading diary page… usually 5–20 seconds.</Text>
              </View>
            ) : (
              <Pressable onPress={() => openManualReview()} style={styles.autoLink} testID="ocr-manual">
                <Text style={styles.autoLinkText}>Skip — enter lots manually</Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  headerTitle: { fontSize: 20, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.3 },
  headerSub: { fontSize: 11, color: colors.muted, letterSpacing: 1, fontWeight: "700" },

  captureRow: { flexDirection: "row", gap: spacing.md },
  captureTile: {
    flex: 1, borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.xl,
    alignItems: "center", justifyContent: "center", gap: spacing.sm, minHeight: 140,
    backgroundColor: colors.surface,
  },
  captureLabel: { fontSize: 12, letterSpacing: 1, fontFamily: font.display, fontWeight: "800", color: colors.onSurface, textAlign: "center" },

  tipsBox: {
    marginTop: spacing.lg, borderWidth: 2, borderColor: colors.borderStrong,
    padding: spacing.md, backgroundColor: colors.surfaceSecondary,
  },
  tipsTitle: { fontSize: 10, letterSpacing: 1.5, fontFamily: font.display, fontWeight: "900", color: colors.muted, marginBottom: 6 },
  tipsText: { fontSize: 12, color: colors.onSurface, fontFamily: font.display, lineHeight: 18 },

  pasteToggle: {
    marginTop: spacing.lg, flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md,
  },
  pasteToggleText: { fontFamily: font.display, fontWeight: "800", letterSpacing: 1, fontSize: 12, color: colors.onSurface },

  previewBox: { position: "relative", borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: "#111" },
  preview: { width: "100%", aspectRatio: 3 / 4 },
  cropOverlay: {
    position: "absolute", borderWidth: 2, borderColor: colors.brandPrimary, backgroundColor: "rgba(16,185,129,0.12)",
  },
  cropHint: { marginTop: spacing.sm, fontSize: 12, color: colors.muted, fontFamily: font.display },
  cropRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 8 },
  cropLabel: { flex: 1, fontFamily: font.mono, fontSize: 12, color: colors.onSurface, fontWeight: "700" },
  cropBtn: {
    width: 40, height: 40, borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  cropBtnText: { fontSize: 20, fontWeight: "900", color: colors.onSurface },

  retakeBtn: {
    position: "absolute", top: 8, right: 8, flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.brandPrimary, borderWidth: 2, borderColor: colors.brand,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  retakeText: { color: colors.onBrandPrimary, fontFamily: font.display, fontSize: 10, letterSpacing: 1, fontWeight: "800" },

  footer: {
    borderTopWidth: 2, borderTopColor: colors.borderStrong,
    padding: spacing.lg, backgroundColor: colors.surface, gap: spacing.sm,
  },
  procHint: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  procHintText: { fontSize: 11, color: colors.muted, fontFamily: font.display, flex: 1 },
  autoLink: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 8,
  },
  autoLinkText: {
    fontSize: 12, color: colors.muted, fontFamily: font.display, fontWeight: "800", letterSpacing: 0.5,
  },
  keyBox: {
    marginTop: spacing.md, borderWidth: 2, borderColor: "#F59E0B",
    backgroundColor: "#FEF3C7", padding: spacing.md, gap: spacing.sm,
  },
  keyTitle: {
    fontSize: 10, letterSpacing: 1.2, fontFamily: font.display, fontWeight: "900", color: "#78350F",
  },
  keyLink: {
    fontSize: 12, color: colors.brandPrimary, fontFamily: font.display, fontWeight: "800", textDecorationLine: "underline",
  },
  err: {
    marginTop: spacing.md,
    color: colors.error, backgroundColor: "#FEE2E2", borderWidth: 2, borderColor: colors.error,
    padding: spacing.sm, fontFamily: font.display, fontWeight: "700",
  },
});
