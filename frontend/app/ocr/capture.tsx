import { useEffect, useRef, useState } from "react";
import {
  Alert, Image, Linking, Modal, Platform, Pressable,
  StyleSheet, Text, View, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

import { api, apiErrorMessage, OCR_API_TIMEOUT_MS, type ApiError } from "@/src/api";
import { setOcrSession, OcrExtractedRow, BLANK_LOT_ROWS, DEMO_OCR_ROWS } from "@/src/ocr-session";
import { KeyboardFormScroll } from "@/src/components/KeyboardForm";
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
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [cropInsets, setCropInsets] = useState({ top: 0, bottom: 0, left: 0, right: 0 });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Env / Settings key → Extract works without the yellow paste box.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const st = await api.get<{ configured: boolean }>("/ocr/status");
        if (!cancelled && st?.configured) {
          setKeyConfigured(true);
        }
      } catch {
        // ignore — extract will surface missing-key if needed
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Do NOT abort OCR on unmount — Strict Mode remounts / brief focus loss must not cancel a valid extract.
  // User can leave the screen; the in-flight guard still prevents duplicate submits while mounted.

  const reset = () => {
    if (processing) return;
    setStage("pick");
    setRawUri(null);
    setImageUri(null);
    setImageBase64(null);
    setCropInsets({ top: 0, bottom: 0, left: 0, right: 0 });
    setError(null);
  };

  const pickImage = async (source: "camera" | "gallery") => {
    if (processing) return;
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
      let actions: ImageManipulator.Action[] = [];
      const hasInsets = insets.top > 0 || insets.bottom > 0 || insets.left > 0 || insets.right > 0;

      const size = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        Image.getSize(
          uri,
          (w, h) => resolve({ w, h }),
          (err) => reject(err),
        );
      });

      if (hasInsets) {
        const left = Math.round((insets.left / 100) * size.w);
        const top = Math.round((insets.top / 100) * size.h);
        const width = Math.max(40, size.w - left - Math.round((insets.right / 100) * size.w));
        const height = Math.max(40, size.h - top - Math.round((insets.bottom / 100) * size.h));
        actions = [{ crop: { originX: left, originY: top, width, height } }];
      } else if (Platform.OS === "web" && (size.w > 1600 || size.h > 1600)) {
        // No manual trim: light center crop of margins to drop empty page edges before OCR.
        const mx = Math.round(size.w * 0.03);
        const my = Math.round(size.h * 0.03);
        actions = [{
          crop: {
            originX: mx,
            originY: my,
            width: Math.max(40, size.w - mx * 2),
            height: Math.max(40, size.h - my * 2),
          },
        }];
      }

      // Cap longest side for faster upload while keeping handwriting/numbers readable.
      const cropW = hasInsets
        ? Math.max(40, size.w - Math.round((insets.left / 100) * size.w) - Math.round((insets.right / 100) * size.w))
        : size.w;
      const cropH = hasInsets
        ? Math.max(40, size.h - Math.round((insets.top / 100) * size.h) - Math.round((insets.bottom / 100) * size.h))
        : size.h;
      const maxSide = 1200;
      if (cropW >= cropH && cropW > maxSide) {
        actions.push({ resize: { width: maxSide } });
      } else if (cropH > cropW && cropH > maxSide) {
        actions.push({ resize: { height: maxSide } });
      } else if (cropW > maxSide) {
        actions.push({ resize: { width: maxSide } });
      }

      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        actions,
        { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (__DEV__) {
        const kb = Math.round(((manipulated.base64 || "").length * 0.75) / 1024);
        console.log("[ocr] image ready", { kb, uri: manipulated.uri?.slice?.(0, 48) });
      }
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
    if (processing) return;
    goToPreview(
      BLANK_LOT_ROWS,
      "manual",
      warning || "Enter Lot / Farmer / Vendors from the photo below.",
    );
  };

  const OCR_QUOTA_MSG = "OCR limit temporarily reached. Please wait a moment and try again.";
  const OCR_CONFIG_MSG = "OCR is not configured correctly on the server. Please contact your administrator.";
  const OCR_UPSTREAM_TEMP_MSG = "OCR provider is temporarily unavailable. Please try again shortly.";

  /** True only for real missing/invalid-key configuration failures — not quota text that mentions "API key". */
  const isGenuineOcrConfigError = (e: unknown): boolean => {
    const err = e as ApiError | undefined;
    const detailObj = err?.detail && typeof err.detail === "object" ? err.detail as Record<string, unknown> : null;
    const detailStr = typeof err?.detail === "string" ? err.detail : "";
    const upstreamStatus = typeof detailObj?.status_code === "number" ? detailObj.status_code : null;
    const upstreamMessage = typeof detailObj?.message === "string" ? detailObj.message : "";
    const upstreamBody = typeof detailObj?.upstream_body === "string" ? detailObj.upstream_body : "";
    const code = typeof detailObj?.code === "string" ? detailObj.code : "";
    const combined = `${detailStr} ${upstreamMessage} ${upstreamBody} ${code}`.toLowerCase();

    // Quota / rate-limit must never be treated as configuration failure.
    if (
      upstreamStatus === 429 ||
      /resource_exhausted|quota|rate limit|too many requests|exceeded your current quota/i.test(combined)
    ) {
      return false;
    }

    if (code === "NO_CLOUD_OCR_KEY" || /no_cloud_ocr_key/i.test(combined)) return true;
    if (/api key not valid|gemini api key not valid|invalid.*api.?key|api.?key.*invalid/i.test(combined)) return true;
    if ((upstreamStatus === 401 || upstreamStatus === 403) && /api.?key|unauthorized|forbidden|permission|credential/i.test(combined)) {
      return true;
    }
    return false;
  };

  const classifyOcrError = (e: unknown): string => {
    const err = e as ApiError | undefined;
    const detailObj = err?.detail && typeof err.detail === "object" ? err.detail as Record<string, unknown> : null;
    const upstreamStatus = typeof detailObj?.status_code === "number" ? detailObj.status_code : null;
    const upstreamMessage = typeof detailObj?.message === "string" ? detailObj.message : "";
    const upstreamBody = typeof detailObj?.upstream_body === "string" ? detailObj.upstream_body : "";
    const detailCode = typeof detailObj?.code === "string" ? detailObj.code : "";
    const combinedUpstream = `${upstreamMessage} ${upstreamBody}`.toLowerCase();

    if (err?.code === "TIMEOUT" || /timed out|taking longer|longer than expected/i.test(String(err?.detail || ""))) {
      return "OCR is taking longer than usual. Please keep the app open and try again — do not assume it failed mid-extract.";
    }
    if (err?.code === "NETWORK" || err?.status === 0) {
      return apiErrorMessage(e, "Unable to connect to the server. Please check your internet connection and try again.");
    }
    if (
      upstreamStatus === 429 ||
      /resource_exhausted|quota|rate limit|too many requests|exceeded your current quota/i.test(combinedUpstream)
    ) {
      return OCR_QUOTA_MSG;
    }
    if (isGenuineOcrConfigError(e)) {
      return OCR_CONFIG_MSG;
    }
    if (
      detailCode === "OCR_UPSTREAM" ||
      detailCode === "OCR_INTERNAL" ||
      (upstreamStatus != null && upstreamStatus >= 500) ||
      err?.status === 502 ||
      err?.status === 503 ||
      err?.status === 504
    ) {
      return OCR_UPSTREAM_TEMP_MSG;
    }
    const text = apiErrorMessage(e, "We could not extract the information from this image. Please try again.");
    if (/blurry|unreadable|no rows|nothing extracted|select a clear/i.test(text)) {
      return text.includes("clear") ? text : "Please select a clear Action Diary image.";
    }
    return text;
  };

  /** Primary path: extract lots from the diary photo via Gemini. */
  const runOcr = async () => {
    if (!imageBase64 || inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    setProcessing(true);
    const ac = new AbortController();
    abortRef.current = ac;
    if (__DEV__) console.log("[ocr] started", { bytesApprox: Math.round(imageBase64.length * 0.75), timeoutMs: OCR_API_TIMEOUT_MS });
    try {
      const payload: Record<string, unknown> = {
        image_base64: imageBase64,
        mime_type: "image/jpeg",
        hint: hint.trim() || "1/5 ABDG (50) then MM 02 1000. Bhada in () is LOT TOTAL.",
      };
      if (__DEV__) console.log("[ocr] upload / request started");
      const resp = await api.post<{ rows: OcrExtractedRow[]; model: string; warning?: string }>(
        "/ocr/action-diary",
        payload,
        { timeoutMs: OCR_API_TIMEOUT_MS, signal: ac.signal },
      );
      if (__DEV__) console.log("[ocr] response received", { rows: resp.rows?.length, model: resp.model, warning: resp.warning });
      if (resp.warning === "NO_CLOUD_OCR_KEY") {
        setKeyConfigured(false);
        setError(OCR_CONFIG_MSG);
        return;
      }
      setKeyConfigured(true);
      if (!resp.rows?.length) {
        setError(resp.warning || "We could not extract the information from this image. Please try again.");
        return;
      }
      goToPreview(resp.rows, resp.model, resp.warning);
    } catch (e: any) {
      if (__DEV__) {
        const detail = e?.detail;
        if (detail && typeof detail === "object") {
          console.warn("[ocr] failed", {
            code: e?.code,
            status: e?.status,
            detail,
          });
        } else {
          console.warn("[ocr] failed", e?.code, e?.status, detail || e?.message);
        }
      }
      if ((e as ApiError)?.code === "ABORTED" && ac.signal.aborted && !inFlightRef.current) {
        return;
      }
      const text = classifyOcrError(e);
      if (isGenuineOcrConfigError(e)) {
        setKeyConfigured(false);
      }
      setError(text);
    } finally {
      inFlightRef.current = false;
      abortRef.current = null;
      setProcessing(false);
    }
  };

  const runTextParse = async () => {
    if (!pasteText.trim() || inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    setProcessing(true);
    try {
      const resp = await api.post<{ rows: OcrExtractedRow[]; model: string; warning?: string }>(
        "/ocr/action-diary-text",
        { text: pasteText },
        { timeoutMs: 60_000 },
      );
      if (!resp.rows?.length) {
        setError(resp.warning || "Could not parse text. Example:\n1/5 ABDG (50)\nMM 2 1000\nAB 2 1000");
        return;
      }
      goToPreview(resp.rows, resp.model, resp.warning);
    } catch (e: any) {
      setError(classifyOcrError(e));
    } finally {
      inFlightRef.current = false;
      setProcessing(false);
    }
  };

  const bumpInset = (key: keyof typeof cropInsets, delta: number) => {
    setCropInsets((c) => ({ ...c, [key]: Math.max(0, Math.min(40, c[key] + delta)) }));
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => !processing && router.back()} hitSlop={12} testID="ocr-back" disabled={processing}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>SCAN ACTION DIARY</Text>
          <Text style={styles.headerSub}>
            {stage === "pick" ? "Capture or choose a page" : stage === "crop" ? "Crop relevant portion" : "Confirm & extract"}
          </Text>
        </View>
      </View>

      <KeyboardFormScroll contentContainerStyle={{ padding: spacing.lg, paddingBottom: 220 }}>
          {stage === "pick" ? (
            <>
              <View style={styles.captureRow}>
                <Pressable style={styles.captureTile} onPress={() => pickImage("camera")} testID="ocr-camera" disabled={processing}>
                  <Ionicons name="camera-outline" size={32} color={colors.onSurface} />
                  <Text style={styles.captureLabel}>CAPTURE PHOTO</Text>
                </Pressable>
                <Pressable style={styles.captureTile} onPress={() => pickImage("gallery")} testID="ocr-gallery" disabled={processing}>
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

              <Pressable style={styles.pasteToggle} onPress={() => setShowPaste((v) => !v)} testID="ocr-paste-toggle" disabled={processing}>
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
                  <Button label={processing ? "PARSING…" : "PARSE TEXT → REVIEW"} onPress={runTextParse} loading={processing} disabled={processing} testID="ocr-parse-text" />
                </View>
              ) : null}

              <Pressable
                style={[styles.pasteToggle, { marginTop: spacing.sm }]}
                onPress={() => !processing && goToPreview(DEMO_OCR_ROWS, "demo", "Sample extraction — edit every field before saving.")}
                testID="ocr-open-sample-preview"
                disabled={processing}
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
                  <Button label="RETAKE" variant="secondary" onPress={reset} disabled={processing} testID="ocr-retake-crop" />
                </View>
                <View style={{ flex: 1.4 }}>
                  <Button
                    label="CONFIRM CROP → OCR"
                    onPress={() => rawUri && finalizeCrop(rawUri, cropInsets)}
                    disabled={processing}
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
                <Pressable style={styles.retakeBtn} onPress={reset} disabled={processing} testID="ocr-retake">
                  <Ionicons name="close" size={16} color={colors.onBrandPrimary} />
                  <Text style={styles.retakeText}>CHANGE IMAGE</Text>
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
            </View>
          ) : null}

          {error && !processing ? (
            <View style={styles.errBox} testID="ocr-error">
              <Text style={styles.err}>{error}</Text>
              {stage === "ready" && imageBase64 ? (
                <View style={styles.errActions}>
                  <View style={{ flex: 1 }}>
                    <Button label="TRY AGAIN" onPress={runOcr} testID="ocr-try-again" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label="CHANGE IMAGE" variant="secondary" onPress={reset} testID="ocr-change-image" />
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}
        </KeyboardFormScroll>

        {stage === "ready" && imageUri ? (
          <View style={styles.footer}>
            <Button
              label={processing ? "EXTRACTING…" : "EXTRACT FROM PHOTO"}
              onPress={runOcr}
              loading={processing}
              disabled={processing}
              testID="ocr-extract"
            />
            {!processing ? (
              <Pressable onPress={() => openManualReview()} style={styles.autoLink} testID="ocr-manual">
                <Text style={styles.autoLinkText}>Skip — enter lots manually</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

      <Modal visible={processing} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.overlay} testID="ocr-extracting-overlay">
          <View style={styles.overlayCard}>
            <ActivityIndicator size="large" color={colors.brandPrimary} style={{ marginVertical: spacing.md }} />
            <Text style={styles.overlayWait} testID="ocr-extract-wait">
              Extracting data...
            </Text>
            <Text style={styles.overlayHint}>Please keep this screen open until extraction finishes.</Text>
          </View>
        </View>
      </Modal>
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
  autoLink: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 8,
  },
  autoLinkText: {
    fontSize: 12, color: colors.muted, fontFamily: font.display, fontWeight: "800", letterSpacing: 0.5,
  },
  errBox: { marginTop: spacing.md, gap: spacing.sm },
  err: {
    color: colors.error, backgroundColor: "#FEE2E2", borderWidth: 2, borderColor: colors.error,
    padding: spacing.sm, fontFamily: font.display, fontWeight: "700",
  },
  errActions: { flexDirection: "row", gap: spacing.sm },

  overlay: {
    flex: 1, backgroundColor: "rgba(17,24,39,0.72)",
    alignItems: "center", justifyContent: "center", padding: spacing.xl,
  },
  overlayCard: {
    width: "100%", maxWidth: 360, backgroundColor: colors.surface,
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.xl, alignItems: "center",
  },
  overlayWait: {
    fontSize: 16, letterSpacing: 0.3, fontWeight: "800",
    color: colors.onSurface, fontFamily: font.display, textAlign: "center",
  },
  overlayHint: {
    marginTop: spacing.sm, fontSize: 12, color: colors.muted, fontFamily: font.display, textAlign: "center", lineHeight: 18,
  },
});
