import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";

import { api, apiErrorMessage } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { Button } from "@/src/components/ui";
import { colors, font, spacing } from "@/src/theme";
import {
  clearGoogleSession,
  downloadBackupFromDrive,
  getStoredGoogleToken,
  googleOAuthConfigured,
  googleOAuthSetupHint,
  listShopBackupsOnDrive,
  loadLocalBackupStatus,
  storeAccessTokenFromAuthSession,
  uploadShopBackupToDrive,
  type DriveBackupMeta,
  type LocalBackupStatus,
} from "@/src/utils/google-drive-backup";

WebBrowser.maybeCompleteAuthSession();

type BusyKind = "idle" | "signin" | "backup" | "list" | "restore" | "validate";

function formatWhen(iso?: string | null) {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function BackupScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const shopId = session?.shop_id || "";
  const isOwner = session?.role === "owner";

  const oauthOk = googleOAuthConfigured();
  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || undefined,
    androidClientId:
      process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ||
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
      undefined,
    iosClientId:
      process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
      undefined,
    scopes: [
      "openid",
      "profile",
      "email",
      "https://www.googleapis.com/auth/drive.file",
    ],
  });

  const [status, setStatus] = useState<LocalBackupStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyKind>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [backups, setBackups] = useState<DriveBackupMeta[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const refreshStatus = useCallback(async () => {
    setStatus(await loadLocalBackupStatus());
    setToken(await getStoredGoogleToken());
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!response) return;
    (async () => {
      try {
        if (response.type === "success") {
          const access = response.authentication?.accessToken;
          if (!access) throw new Error("Google login failed — no access token");
          await storeAccessTokenFromAuthSession(access);
          setToken(access);
          setMsg(`Signed in${status?.googleEmail ? ` as ${status.googleEmail}` : ""}`);
          await refreshStatus();
        } else if (response.type === "error") {
          setError(response.error?.message || "Google login failed");
        } else if (response.type === "dismiss") {
          setError("Google sign-in was cancelled");
        }
      } catch (e: any) {
        setError(e?.message || "Google login failed");
      } finally {
        setBusy("idle");
        setProgress("");
      }
    })();
  }, [response, refreshStatus, status?.googleEmail]);

  const ensureToken = async (): Promise<string> => {
    const existing = token || (await getStoredGoogleToken());
    if (existing) {
      setToken(existing);
      return existing;
    }
    if (!oauthOk) throw new Error(googleOAuthSetupHint());
    setBusy("signin");
    setProgress("Opening Google sign-in…");
    const result = await promptAsync();
    if (result.type !== "success" || !result.authentication?.accessToken) {
      throw new Error(
        result.type === "dismiss"
          ? "Google sign-in was cancelled"
          : "Google login failed",
      );
    }
    await storeAccessTokenFromAuthSession(result.authentication.accessToken);
    setToken(result.authentication.accessToken);
    await refreshStatus();
    return result.authentication.accessToken;
  };

  const runBackup = async () => {
    if (!isOwner || !shopId) return;
    setError(null);
    setMsg(null);
    try {
      setBusy("backup");
      setProgress("Signing in to Google…");
      const access = await ensureToken();
      setProgress("Exporting shop data from server…");
      const payload = await api.get<object>("/backup/export", { timeoutMs: 120_000 });
      setProgress("Uploading backup to your Google Drive…");
      const meta = await uploadShopBackupToDrive(access, shopId, payload);
      await refreshStatus();
      setMsg(
        `Backup saved to Google Drive.\n${meta.fileName}\n${formatWhen(meta.modifiedTime)}`,
      );
    } catch (e: any) {
      setError(apiErrorMessage(e, e?.message || "Backup failed"));
    } finally {
      setBusy("idle");
      setProgress("");
    }
  };

  const openRestorePicker = async () => {
    if (!isOwner || !shopId) return;
    setError(null);
    setMsg(null);
    try {
      setBusy("list");
      setProgress("Loading backups from Google Drive…");
      const access = await ensureToken();
      const list = await listShopBackupsOnDrive(access, shopId);
      setBackups(list);
      if (!list.length) {
        setError("No backups found on your Google Drive for this shop.");
        return;
      }
      setPickerOpen(true);
    } catch (e: any) {
      setError(apiErrorMessage(e, e?.message || "Could not list backups"));
    } finally {
      setBusy("idle");
      setProgress("");
    }
  };

  const confirmRestore = (file: DriveBackupMeta) => {
    Alert.alert(
      "Restore backup?",
      `This will replace your current shop data with:\n\n${file.fileName}\n${formatWhen(file.modifiedTime)}\n\nYour existing data is kept until the backup is validated. Continue?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          style: "destructive",
          onPress: () => void runRestore(file),
        },
      ],
    );
  };

  const runRestore = async (file: DriveBackupMeta) => {
    if (!isOwner || !shopId) return;
    setPickerOpen(false);
    setError(null);
    setMsg(null);
    try {
      setBusy("restore");
      setProgress("Downloading backup from Google Drive…");
      const access = await ensureToken();
      const backup = await downloadBackupFromDrive(access, file.fileId);

      setBusy("validate");
      setProgress("Validating backup (local data not deleted yet)…");
      await api.post("/backup/validate", { backup }, { timeoutMs: 60_000 });

      setProgress("Restoring data on server…");
      const result = await api.post<{
        ok: boolean;
        restored_at: string;
        exported_at?: string;
        counts?: Record<string, number>;
      }>("/backup/restore", { backup }, { timeoutMs: 180_000 });

      const countSummary = result.counts
        ? Object.entries(result.counts)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${k}: ${n}`)
            .slice(0, 8)
            .join(", ")
        : "";
      setMsg(
        `Restore complete.\nBackup from ${formatWhen(result.exported_at)}\n${countSummary}`,
      );
      Alert.alert(
        "Restored",
        "Shop data was restored successfully. Pull to refresh lists or reopen screens to see updated data.",
      );
    } catch (e: any) {
      setError(apiErrorMessage(e, e?.message || "Restore failed"));
    } finally {
      setBusy("idle");
      setProgress("");
    }
  };

  const signOutGoogle = async () => {
    await clearGoogleSession();
    setToken(null);
    await refreshStatus();
    setMsg("Signed out of Google Drive");
  };

  if (!isOwner) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>BACKUP & RESTORE</Text>
        </View>
        <View style={styles.roleNote}>
          <Text style={styles.roleNoteText}>Only the shop owner can back up or restore data.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const working = busy !== "idle";

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="backup-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>BACKUP & RESTORE</Text>
          <Text style={styles.sub}>Google Drive · your account only</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>BACKUP STATUS</Text>
          <Text style={styles.cardValue}>
            Last backup: {formatWhen(status?.lastBackupAt)}
          </Text>
          {status?.lastFileName ? (
            <Text style={styles.cardMeta} numberOfLines={2}>{status.lastFileName}</Text>
          ) : null}
          <Text style={styles.cardMeta}>
            Google: {status?.googleEmail || (token ? "Signed in" : "Not signed in")}
          </Text>
        </View>

        {!oauthOk ? (
          <View style={styles.warnBox}>
            <Ionicons name="warning-outline" size={16} color="#78350F" />
            <Text style={styles.warnText}>{googleOAuthSetupHint()}</Text>
          </View>
        ) : null}

        <Text style={styles.section}>Backup</Text>
        <Text style={styles.hint}>
          Exports all shop data (masters, auction days, lots, pattis, vendor bills, ledger, settings)
          and saves it to your Google Drive. One shop’s backup cannot be restored into another shop.
        </Text>
        <Button
          label={working && busy === "backup" ? "BACKING UP…" : "BACKUP TO GOOGLE DRIVE"}
          onPress={runBackup}
          loading={busy === "backup"}
          disabled={working || !request}
          testID="backup-to-drive"
        />

        <Text style={[styles.section, { marginTop: spacing.xl }]}>Restore</Text>
        <Text style={styles.hint}>
          Choose a previous backup from your Drive. Current data is not deleted until the backup
          passes validation.
        </Text>
        <Button
          label={working && busy === "list" ? "LOADING…" : "RESTORE FROM GOOGLE DRIVE"}
          variant="secondary"
          onPress={openRestorePicker}
          loading={busy === "list"}
          disabled={working || !request}
          testID="restore-from-drive"
        />

        {token ? (
          <Pressable style={styles.linkBtn} onPress={signOutGoogle} disabled={working} testID="backup-google-signout">
            <Text style={styles.linkText}>Sign out of Google Drive</Text>
          </Pressable>
        ) : null}

        {error ? <Text style={styles.err} testID="backup-error">{error}</Text> : null}
        {msg ? <Text style={styles.ok} testID="backup-ok">{msg}</Text> : null}
      </ScrollView>

      <Modal visible={working && !!progress} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <ActivityIndicator size="large" color={colors.brandPrimary} />
            <Text style={styles.overlayTitle}>
              {busy === "backup"
                ? "BACKING UP"
                : busy === "restore" || busy === "validate"
                  ? "RESTORING"
                  : busy === "signin"
                    ? "SIGNING IN"
                    : "PLEASE WAIT"}
            </Text>
            <Text style={styles.overlayBody}>{progress}</Text>
          </View>
        </View>
      </Modal>

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.pickerRoot}>
          <Pressable style={styles.pickerBackdrop} onPress={() => setPickerOpen(false)} />
          <View style={styles.pickerSheet}>
            <Text style={styles.pickerTitle}>SELECT BACKUP</Text>
            <FlatList
              data={backups}
              keyExtractor={(x) => x.fileId}
              contentContainerStyle={{ paddingBottom: spacing.xl }}
              ListEmptyComponent={<Text style={styles.hint}>No backups found.</Text>}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.backupRow}
                  onPress={() => confirmRestore(item)}
                  testID={`backup-file-${item.fileId}`}
                >
                  <Ionicons name="cloud-download-outline" size={18} color={colors.onSurface} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.backupName} numberOfLines={2}>{item.fileName}</Text>
                    <Text style={styles.backupMeta}>{formatWhen(item.modifiedTime)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                </Pressable>
              )}
            />
            <Button label="CANCEL" variant="secondary" onPress={() => setPickerOpen(false)} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: colors.borderStrong,
  },
  title: {
    fontSize: 18,
    fontWeight: "900",
    color: colors.onSurface,
    fontFamily: font.display,
    letterSpacing: 0.5,
  },
  sub: { fontSize: 11, color: colors.muted, fontFamily: font.display, fontWeight: "700", marginTop: 2 },
  card: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: spacing.md,
    marginBottom: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
  },
  cardLabel: {
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: "900",
    color: colors.muted,
    fontFamily: font.display,
    marginBottom: 6,
  },
  cardValue: { fontSize: 15, fontWeight: "800", color: colors.onSurface, fontFamily: font.display },
  cardMeta: { fontSize: 12, color: colors.muted, fontFamily: font.mono, marginTop: 4 },
  section: {
    fontSize: 11,
    letterSpacing: 2,
    color: colors.muted,
    textTransform: "uppercase",
    fontFamily: font.display,
    fontWeight: "800",
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  hint: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: font.display,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  err: {
    marginTop: spacing.md,
    color: colors.error,
    backgroundColor: "#FEE2E2",
    borderWidth: 2,
    borderColor: colors.error,
    padding: spacing.sm,
    fontFamily: font.display,
    fontWeight: "700",
  },
  ok: {
    marginTop: spacing.md,
    color: colors.success,
    backgroundColor: "#D1FAE5",
    borderWidth: 2,
    borderColor: colors.success,
    padding: spacing.sm,
    fontFamily: font.display,
    fontWeight: "700",
  },
  warnBox: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    padding: spacing.md,
    borderWidth: 2,
    borderColor: colors.warning,
    backgroundColor: "#FFFBEB",
    marginBottom: spacing.md,
  },
  warnText: { flex: 1, fontSize: 12, color: "#78350F", fontFamily: font.display, fontWeight: "700" },
  linkBtn: { marginTop: spacing.md, alignItems: "center", padding: spacing.sm },
  linkText: { color: colors.muted, fontFamily: font.display, fontWeight: "800", letterSpacing: 0.5 },
  roleNote: { padding: spacing.lg },
  roleNoteText: { color: colors.muted, fontFamily: font.display },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  overlayCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.md,
  },
  overlayTitle: {
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1.5,
    fontFamily: font.display,
    color: colors.onSurface,
  },
  overlayBody: {
    fontSize: 13,
    textAlign: "center",
    color: colors.muted,
    fontFamily: font.display,
    fontWeight: "700",
  },
  pickerRoot: { flex: 1, justifyContent: "flex-end" },
  pickerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  pickerSheet: {
    backgroundColor: colors.surface,
    borderTopWidth: 2,
    borderColor: colors.borderStrong,
    maxHeight: "70%",
    padding: spacing.lg,
  },
  pickerTitle: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.5,
    fontFamily: font.display,
    marginBottom: spacing.md,
  },
  backupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  backupName: { fontSize: 13, fontWeight: "800", fontFamily: font.display, color: colors.onSurface },
  backupMeta: { fontSize: 11, color: colors.muted, fontFamily: font.mono, marginTop: 2 },
});
