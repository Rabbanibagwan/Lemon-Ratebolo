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
  TextInput,
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
  listRestorePointsOnDrive,
  listShopBackupsOnDrive,
  loadLocalBackupStatus,
  storeAccessTokenFromAuthSession,
  uploadRestorePointToDrive,
  uploadSafetyBackupToDrive,
  uploadShopBackupToDrive,
  type DriveBackupMeta,
  type LocalBackupStatus,
} from "@/src/utils/google-drive-backup";

WebBrowser.maybeCompleteAuthSession();

type BusyKind =
  | "idle"
  | "signin"
  | "backup"
  | "list"
  | "restore"
  | "validate"
  | "rp_create"
  | "rp_list"
  | "rp_download"
  | "rp_validate"
  | "rp_safety"
  | "rp_restore";

const LABEL_MAX = 60;

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

function countLine(counts?: Record<string, number> | null): string {
  if (!counts) return "";
  const parts: string[] = [];
  const order: [string, string][] = [
    ["pattis", "Pattis"],
    ["farmers", "Farmers"],
    ["vendors", "Vendors"],
    ["lots", "Lots"],
    ["staff", "Staff"],
    ["vendor_bills", "Vendor bills"],
  ];
  for (const [k, label] of order) {
    const n = counts[k];
    if (typeof n === "number") parts.push(`${label}: ${n}`);
  }
  return parts.join(" · ");
}

function stampPayload(
  exportPayload: any,
  opts: {
    kind: "restore_point" | "safety_backup";
    label: string;
    created_by: {
      user_id: string;
      username: string;
      display_name: string;
      role: string;
    };
  },
) {
  return {
    ...exportPayload,
    kind: opts.kind,
    label: opts.label,
    created_by: opts.created_by,
  };
}

export default function BackupScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const shopId = session?.shop_id || "";
  const isOwner = session?.role === "owner";

  const oauthOk = googleOAuthConfigured();
  // expo-auth-session throws if webClientId is undefined on web — use a stub when unset.
  const googleWebClientId =
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
    "000000000000-stub.apps.googleusercontent.com";
  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: googleWebClientId,
    androidClientId:
      process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ||
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
      googleWebClientId,
    iosClientId:
      process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
      googleWebClientId,
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

  const [rpLabel, setRpLabel] = useState("");
  const [restorePoints, setRestorePoints] = useState<DriveBackupMeta[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingRp, setPendingRp] = useState<DriveBackupMeta | null>(null);
  const [pendingBackup, setPendingBackup] = useState<any | null>(null);
  const [confirmPhrase, setConfirmPhrase] = useState("");

  const refreshStatus = useCallback(async () => {
    setStatus(await loadLocalBackupStatus());
    setToken(await getStoredGoogleToken());
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Preview-only sample when Google OAuth is not configured (no Drive calls).
  useEffect(() => {
    if (oauthOk || !isOwner) return;
    setRestorePoints((cur) => {
      if (cur.length) return cur;
      return [
        {
          fileId: "preview-sample",
          fileName: "LemonRatebolo_rp_preview_sample.json",
          shopId,
          kind: "restore_point",
          label: "Before Rate Update",
          version: 2,
          createdBy: session?.display_name || session?.shop_name || "Owner",
          exportedAt: new Date().toISOString(),
          modifiedTime: new Date().toISOString(),
          counts: { pattis: 120, farmers: 40, vendors: 25, lots: 10 },
        },
      ];
    });
  }, [oauthOk, isOwner, shopId, session?.display_name, session?.shop_name]);

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

  const createdBy = () => ({
    user_id: session?.id || session?.shop_id || shopId,
    username: session?.username || "",
    display_name: session?.display_name || session?.shop_name || "",
    role: session?.role || "owner",
  });

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

  const refreshRestorePoints = async (accessToken?: string) => {
    const access = accessToken || (await ensureToken());
    setBusy("rp_list");
    setProgress("Loading Restore Points…");
    const list = await listRestorePointsOnDrive(access, shopId);
    setRestorePoints(list);
    return list;
  };

  const createRestorePoint = async () => {
    if (!isOwner || !shopId) return;
    const label = rpLabel.trim();
    if (!label) {
      setError("Restore Point name is required.");
      return;
    }
    if (label.length > LABEL_MAX) {
      setError(`Name must be ${LABEL_MAX} characters or fewer.`);
      return;
    }
    setError(null);
    setMsg(null);
    setCreateOpen(false);
    try {
      setBusy("rp_create");
      setProgress("Creating Restore Point…");
      const access = await ensureToken();
      setProgress("Exporting shop data…");
      const exported = await api.get<any>("/backup/export", { timeoutMs: 120_000 });
      const payload = stampPayload(exported, {
        kind: "restore_point",
        label,
        created_by: createdBy(),
      });
      setBusy("rp_validate");
      setProgress("Validating backup…");
      await api.post("/backup/validate", { backup: payload }, { timeoutMs: 60_000 });
      setProgress("Uploading to Google Drive…");
      const meta = await uploadRestorePointToDrive(access, shopId, payload);
      setProgress("Refreshing Restore Points…");
      await refreshRestorePoints(access);
      setRpLabel("");
      setMsg(
        `Restore Point saved.\n${meta.label || label}\n${meta.fileName}\n${formatWhen(meta.modifiedTime || meta.exportedAt)}`,
      );
    } catch (e: any) {
      setError(apiErrorMessage(e, e?.message || "Could not create Restore Point"));
    } finally {
      setBusy("idle");
      setProgress("");
    }
  };

  const beginRestorePointFlow = async (item: DriveBackupMeta) => {
    if (!isOwner || !shopId || busy !== "idle") return;
    setError(null);
    setMsg(null);
    setConfirmPhrase("");

    // Preview sample (no Drive) — open confirmation UI only.
    if (item.fileId === "preview-sample") {
      const backup = {
        version: 2,
        app: "lemon-ratebolo",
        kind: "restore_point",
        label: item.label || "Before Rate Update",
        exported_at: item.exportedAt,
        created_by: createdBy(),
        shop_id: shopId,
        shop: { id: shopId, shop_name: session?.shop_name || "Shop" },
        counts: item.counts || {},
      };
      setPendingRp(item);
      setPendingBackup(backup);
      setConfirmOpen(true);
      return;
    }

    try {
      setBusy("rp_download");
      setProgress("Downloading Restore Point…");
      const access = await ensureToken();
      const backup = await downloadBackupFromDrive(access, item.fileId);

      setBusy("rp_validate");
      setProgress("Validating backup…");
      await api.post("/backup/validate", { backup }, { timeoutMs: 60_000 });

      // Enrich list meta from payload when Drive props were sparse
      const enriched: DriveBackupMeta = {
        ...item,
        label: (backup as any).label || item.label,
        version: (backup as any).version ?? item.version,
        exportedAt: (backup as any).exported_at || item.exportedAt,
        createdBy:
          (backup as any).created_by?.display_name ||
          (backup as any).created_by?.username ||
          item.createdBy,
        counts: (backup as any).counts || item.counts,
      };
      setPendingRp(enriched);
      setPendingBackup(backup);
      setConfirmOpen(true);
    } catch (e: any) {
      setPendingRp(null);
      setPendingBackup(null);
      setError(apiErrorMessage(e, e?.message || "Validation failed — restore cancelled"));
    } finally {
      setBusy("idle");
      setProgress("");
    }
  };

  const cancelConfirm = () => {
    if (working) return;
    setConfirmOpen(false);
    setPendingRp(null);
    setPendingBackup(null);
    setConfirmPhrase("");
  };

  const executeRestorePoint = async () => {
    if (!isOwner || !shopId || !pendingRp || !pendingBackup) return;
    if (confirmPhrase.trim().toUpperCase() !== "RESTORE") {
      setError("Type RESTORE to confirm.");
      return;
    }
    if (pendingRp.fileId === "preview-sample") {
      setError(
        "This is a Preview sample only. Configure Google OAuth to create and restore real Restore Points.",
      );
      setConfirmOpen(false);
      setPendingRp(null);
      setPendingBackup(null);
      setConfirmPhrase("");
      return;
    }
    const rpLabelName = pendingRp.label || pendingRp.fileName;
    setConfirmOpen(false);
    setError(null);
    setMsg(null);
    try {
      setBusy("rp_safety");
      setProgress("Preparing restore…");
      const access = await ensureToken();

      setProgress("Creating safety backup…");
      const liveExport = await api.get<any>("/backup/export", { timeoutMs: 120_000 });
      const safetyPayload = stampPayload(liveExport, {
        kind: "safety_backup",
        label: `Safety before restore: ${rpLabelName}`.slice(0, LABEL_MAX + 40),
        created_by: createdBy(),
      });
      setProgress("Validating safety backup…");
      await api.post("/backup/validate", { backup: safetyPayload }, { timeoutMs: 60_000 });
      setProgress("Uploading safety backup to Google Drive…");
      let safetyMeta: DriveBackupMeta;
      try {
        safetyMeta = await uploadSafetyBackupToDrive(access, shopId, safetyPayload);
      } catch (uploadErr: any) {
        throw new Error(
          `Safety backup failed — restore aborted. Current data was NOT changed. (${uploadErr?.message || "upload failed"})`,
        );
      }

      setBusy("rp_restore");
      setProgress("Restoring data…");
      const result = await api.post<{
        ok: boolean;
        restored_at: string;
        exported_at?: string;
        counts?: Record<string, number>;
      }>("/backup/restore", { backup: pendingBackup }, { timeoutMs: 180_000 });

      if (!result?.ok) {
        throw new Error("Restore failed on server.");
      }

      setMsg(
        `Restore completed.\nRestored: ${rpLabelName}\nSafety backup: ${safetyMeta.fileName}\n${formatWhen(result.exported_at)}`,
      );
      Alert.alert(
        "Restore completed",
        `Shop data was replaced from “${rpLabelName}”.\n\nSafety backup saved as:\n${safetyMeta.fileName}\n\nReopen screens or pull to refresh to see updated data.`,
      );
      try {
        await refreshRestorePoints(access);
      } catch {
        /* list refresh optional after success */
      }
    } catch (e: any) {
      setError(apiErrorMessage(e, e?.message || "Restore failed"));
    } finally {
      setPendingRp(null);
      setPendingBackup(null);
      setConfirmPhrase("");
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

  const loadRpList = async () => {
    if (!isOwner || !shopId) return;
    setError(null);
    try {
      const access = await ensureToken();
      await refreshRestorePoints(access);
    } catch (e: any) {
      setError(apiErrorMessage(e, e?.message || "Could not list Restore Points"));
    } finally {
      setBusy("idle");
      setProgress("");
    }
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
  const overlayTitle =
    busy === "backup"
      ? "BACKING UP"
      : busy === "restore" || busy === "validate"
        ? "RESTORING"
        : busy === "signin"
          ? "SIGNING IN"
          : busy === "rp_create" || busy === "rp_validate"
            ? "RESTORE POINT"
            : busy === "rp_safety"
              ? "SAFETY BACKUP"
              : busy === "rp_restore"
                ? "RESTORING"
                : busy === "rp_download" || busy === "rp_list"
                  ? "PLEASE WAIT"
                  : "PLEASE WAIT";

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

        <Text style={styles.section}>Google Drive Backup</Text>
        <Text style={styles.hint}>
          Exports all shop data (masters, auction days, lots, pattis, vendor bills, ledger, settings,
          audit, bag wallet) and saves it to your Google Drive. One shop’s backup cannot be restored
          into another shop.
        </Text>
        <Button
          label={working && busy === "backup" ? "BACKING UP…" : "BACKUP TO GOOGLE DRIVE"}
          onPress={runBackup}
          loading={busy === "backup"}
          disabled={working || !request}
          testID="backup-to-drive"
        />

        <Text style={[styles.section, { marginTop: spacing.xl }]}>Google Drive Restore</Text>
        <Text style={styles.hint}>
          Choose a previous Drive backup. Current data is not deleted until the backup passes
          validation.
        </Text>
        <Button
          label={working && busy === "list" ? "LOADING…" : "RESTORE FROM GOOGLE DRIVE"}
          variant="secondary"
          onPress={openRestorePicker}
          loading={busy === "list"}
          disabled={working || !request}
          testID="restore-from-drive"
        />

        <Text style={[styles.section, { marginTop: spacing.xl }]} testID="restore-points-section">
          Restore Points
        </Text>
        <Text style={styles.hint}>
          Named snapshots of this shop. Restoring a point replaces current data after a safety
          backup is saved to Drive.
        </Text>
        <Button
          label={working && busy === "rp_create" ? "CREATING…" : "CREATE RESTORE POINT"}
          onPress={() => {
            setError(null);
            setCreateOpen(true);
          }}
          loading={busy === "rp_create"}
          disabled={working || !request}
          testID="create-restore-point"
        />
        <View style={{ height: spacing.sm }} />
        <Button
          label={working && busy === "rp_list" ? "LOADING…" : "REFRESH RESTORE POINTS"}
          variant="secondary"
          onPress={() => void loadRpList()}
          loading={busy === "rp_list"}
          disabled={working || !request}
          testID="refresh-restore-points"
        />

        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          {restorePoints.length === 0 ? (
            <Text style={styles.hint}>No Restore Points listed yet. Create one or refresh.</Text>
          ) : (
            restorePoints.map((item) => (
              <View key={item.fileId} style={styles.rpCard} testID={`restore-point-${item.fileId}`}>
                <Text style={styles.rpTitle} numberOfLines={2}>
                  {item.label || item.fileName}
                </Text>
                <Text style={styles.rpMeta}>
                  {formatWhen(item.exportedAt || item.modifiedTime)}
                </Text>
                <Text style={styles.rpMeta}>
                  Created by: {item.createdBy || "—"}
                </Text>
                <Text style={styles.rpMeta}>
                  Version: {item.version ?? "—"}
                </Text>
                {countLine(item.counts) ? (
                  <Text style={styles.rpMeta}>{countLine(item.counts)}</Text>
                ) : null}
                <Button
                  label="RESTORE"
                  variant="secondary"
                  onPress={() => void beginRestorePointFlow(item)}
                  disabled={working}
                  testID={`restore-point-btn-${item.fileId}`}
                />
              </View>
            ))
          )}
        </View>

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
            <Text style={styles.overlayTitle}>{overlayTitle}</Text>
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

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <Text style={styles.overlayTitle}>CREATE RESTORE POINT</Text>
            <Text style={styles.overlayBody}>Name this snapshot (required, max {LABEL_MAX} characters).</Text>
            <TextInput
              style={styles.input}
              value={rpLabel}
              onChangeText={(t) => setRpLabel(t.slice(0, LABEL_MAX))}
              placeholder="e.g. Before rate update"
              placeholderTextColor={colors.muted}
              maxLength={LABEL_MAX}
              editable={!working}
              testID="restore-point-label"
            />
            <Text style={styles.cardMeta}>{rpLabel.length}/{LABEL_MAX}</Text>
            <Button
              label="CREATE"
              onPress={() => void createRestorePoint()}
              disabled={working || !rpLabel.trim()}
              testID="restore-point-create-confirm"
            />
            <Button label="CANCEL" variant="secondary" onPress={() => setCreateOpen(false)} disabled={working} />
          </View>
        </View>
      </Modal>

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={cancelConfirm}>
        <View style={styles.overlay}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: spacing.lg }}>
            <View style={[styles.overlayCard, { maxWidth: 400 }]}>
              <Text style={[styles.overlayTitle, { color: colors.error }]}>
                RESTORE WILL REPLACE CURRENT SHOP DATA
              </Text>
              <Text style={styles.overlayBody}>
                This permanently replaces live shop data with the selected Restore Point. A safety
                backup of current data is uploaded to Drive first. If that fails, restore is aborted.
              </Text>
              <View style={styles.confirmBox}>
                <Text style={styles.rpTitle}>{pendingRp?.label || pendingRp?.fileName}</Text>
                <Text style={styles.rpMeta}>
                  {formatWhen(pendingRp?.exportedAt || pendingRp?.modifiedTime)}
                </Text>
                <Text style={styles.rpMeta}>Shop: {session?.shop_name || "—"}</Text>
                <Text style={styles.rpMeta}>Version: {pendingRp?.version ?? "—"}</Text>
                {countLine(pendingRp?.counts) ? (
                  <Text style={styles.rpMeta}>{countLine(pendingRp?.counts)}</Text>
                ) : null}
              </View>
              <Text style={styles.overlayBody}>Type RESTORE to confirm</Text>
              <TextInput
                style={styles.input}
                value={confirmPhrase}
                onChangeText={setConfirmPhrase}
                autoCapitalize="characters"
                placeholder="RESTORE"
                placeholderTextColor={colors.muted}
                editable={!working}
                testID="restore-point-confirm-phrase"
              />
              <Button
                label="CONFIRM RESTORE"
                onPress={() => void executeRestorePoint()}
                disabled={working || confirmPhrase.trim().toUpperCase() !== "RESTORE"}
                testID="restore-point-confirm"
              />
              <Button label="CANCEL" variant="secondary" onPress={cancelConfirm} disabled={working} />
            </View>
          </ScrollView>
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
    textAlign: "center",
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
  rpCard: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    gap: 4,
  },
  rpTitle: {
    fontSize: 15,
    fontWeight: "900",
    fontFamily: font.display,
    color: colors.onSurface,
  },
  rpMeta: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: font.display,
    fontWeight: "700",
  },
  input: {
    width: "100%",
    borderWidth: 2,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontFamily: font.display,
    fontWeight: "700",
    fontSize: 14,
    color: colors.onSurface,
    backgroundColor: colors.surface,
  },
  confirmBox: {
    width: "100%",
    borderWidth: 2,
    borderColor: colors.error,
    padding: spacing.md,
    backgroundColor: "#FEF2F2",
    gap: 4,
  },
});
