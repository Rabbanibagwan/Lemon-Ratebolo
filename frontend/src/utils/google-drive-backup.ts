/**
 * Google Drive backup helpers — OAuth token + Drive file upload/download.
 * Backups stay on the user's Drive; our server never receives the Google token.
 */
import { Platform } from "react-native";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

WebBrowser.maybeCompleteAuthSession();

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_KEY = "lm.google.drive.token";
const META_KEY = "lm.google.drive.backup.meta";
const FOLDER_NAME = "Lemon Ratebolo Backups";
const APP_ID = "lemon-ratebolo";

export type BackupKind = "drive_backup" | "restore_point" | "safety_backup";

export type DriveBackupMeta = {
  fileId: string;
  fileName: string;
  modifiedTime?: string;
  size?: string;
  shopId: string;
  kind?: BackupKind | string;
  label?: string;
  version?: number;
  createdBy?: string;
  exportedAt?: string;
  counts?: Record<string, number>;
};

export type LocalBackupStatus = {
  lastBackupAt: string | null;
  lastFileName: string | null;
  lastFileId: string | null;
  googleEmail: string | null;
};

function googleClientIds() {
  return {
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "",
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || "",
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || "",
  };
}

export function googleOAuthConfigured(): boolean {
  const ids = googleClientIds();
  if (Platform.OS === "web") return !!ids.webClientId;
  if (Platform.OS === "android") return !!(ids.androidClientId || ids.webClientId);
  if (Platform.OS === "ios") return !!(ids.iosClientId || ids.webClientId);
  return !!ids.webClientId;
}

export function googleOAuthSetupHint(): string {
  return (
    "Add your Google OAuth client ID as EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID " +
    "(and Android/iOS IDs if needed) in the frontend .env. " +
    "Enable Google Drive API and create an OAuth client in Google Cloud Console. " +
    "Authorized redirect URI must match this app scheme."
  );
}

async function secureSet(key: string, value: string) {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function secureDel(key: string) {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function getStoredGoogleToken(): Promise<string | null> {
  return secureGet(TOKEN_KEY);
}

export async function clearGoogleSession(): Promise<void> {
  await secureDel(TOKEN_KEY);
}

export async function loadLocalBackupStatus(): Promise<LocalBackupStatus> {
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    if (!raw) {
      return { lastBackupAt: null, lastFileName: null, lastFileId: null, googleEmail: null };
    }
    return JSON.parse(raw) as LocalBackupStatus;
  } catch {
    return { lastBackupAt: null, lastFileName: null, lastFileId: null, googleEmail: null };
  }
}

async function saveLocalBackupStatus(patch: Partial<LocalBackupStatus>) {
  const cur = await loadLocalBackupStatus();
  const next = { ...cur, ...patch };
  await AsyncStorage.setItem(META_KEY, JSON.stringify(next));
  return next;
}

export function makeGoogleAuthRequestConfig() {
  const ids = googleClientIds();
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "lemonratebolo",
    path: "redirect",
  });
  return {
    clientId: ids.webClientId || ids.androidClientId || ids.iosClientId,
    redirectUri,
    scopes: [DRIVE_SCOPE, "openid", "profile", "email"],
    extraParams: { prompt: "select_account" },
    // Platform-specific IDs for native Google provider
    webClientId: ids.webClientId || undefined,
    androidClientId: ids.androidClientId || ids.webClientId || undefined,
    iosClientId: ids.iosClientId || ids.webClientId || undefined,
  };
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  codeVerifier?: string,
): Promise<{ accessToken: string; email?: string }> {
  const ids = googleClientIds();
  const clientId = ids.webClientId || ids.androidClientId || ids.iosClientId;
  if (!clientId) throw new Error(googleOAuthSetupHint());

  const body = new URLSearchParams({
    client_id: clientId,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  if (codeVerifier) body.set("code_verifier", codeVerifier);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Google login failed");
  }
  await secureSet(TOKEN_KEY, json.access_token);
  let email: string | undefined;
  try {
    const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${json.access_token}` },
    });
    if (me.ok) {
      const u = await me.json();
      email = u.email;
      await saveLocalBackupStatus({ googleEmail: email || null });
    }
  } catch {
    /* optional */
  }
  return { accessToken: json.access_token, email };
}

export async function storeAccessTokenFromAuthSession(accessToken: string): Promise<void> {
  await secureSet(TOKEN_KEY, accessToken);
  try {
    const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (me.ok) {
      const u = await me.json();
      await saveLocalBackupStatus({ googleEmail: u.email || null });
    }
  } catch {
    /* optional */
  }
}

async function driveFetch(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  let res: Response;
  try {
    res = await fetch(`https://www.googleapis.com${path}`, { ...init, headers });
  } catch {
    throw new Error("No internet connection. Check your network and try again.");
  }
  if (res.status === 401 || res.status === 403) {
    await clearGoogleSession();
    throw new Error(
      res.status === 401
        ? "Google login expired. Please sign in again."
        : "Google Drive permission denied. Sign in again and allow Drive access.",
    );
  }
  return res;
}

async function ensureBackupFolder(token: string): Promise<string> {
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`,
  );
  const list = await driveFetch(`/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`, token);
  const data = await list.json();
  if (!list.ok) throw new Error(data.error?.message || "Could not access Google Drive");
  if (data.files?.length) return data.files[0].id as string;

  const create = await driveFetch(`/drive/v3/files`, token, {
    method: "POST",
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  const created = await create.json();
  if (!create.ok) throw new Error(created.error?.message || "Could not create Drive folder");
  return created.id as string;
}

function latestFileName(shopId: string) {
  return `LemonRatebolo_backup_${shopId}.json`;
}

function datedFileName(shopId: string, iso: string) {
  const stamp = iso.replace(/[:.]/g, "-");
  return `LemonRatebolo_backup_${shopId}_${stamp}.json`;
}

function stampIso(iso: string) {
  return iso.replace(/[:.]/g, "-");
}

export function restorePointFileName(shopId: string, iso: string) {
  return `LemonRatebolo_rp_${shopId}_${stampIso(iso)}.json`;
}

export function safetyBackupFileName(shopId: string, iso: string) {
  return `LemonRatebolo_safety_${shopId}_${stampIso(iso)}.json`;
}

function truncateProp(value: string, max = 120): string {
  const s = String(value || "");
  return s.length <= max ? s : s.slice(0, max);
}

/** Compact counts for Drive appProperties (value length limited). */
function packCounts(counts?: Record<string, number> | null): string {
  if (!counts) return "";
  const keys = ["pattis", "farmers", "vendors", "lots", "staff", "vendor_bills"];
  const parts = keys
    .map((k) => `${k[0]}${Number(counts[k] || 0)}`)
    .join(",");
  return truncateProp(parts, 120);
}

function unpackCounts(packed?: string): Record<string, number> | undefined {
  if (!packed) return undefined;
  const alias: Record<string, string> = {
    p: "pattis",
    f: "farmers",
    v: "vendors",
    l: "lots",
    s: "staff",
    b: "vendor_bills",
  };
  const out: Record<string, number> = {};
  for (const part of packed.split(",")) {
    const m = /^([a-z])(\d+)$/i.exec(part.trim());
    if (!m) continue;
    const key = alias[m[1].toLowerCase()];
    if (key) out[key] = Number(m[2]);
  }
  return Object.keys(out).length ? out : undefined;
}

type DriveAppProps = {
  lemonRatebolo?: string;
  app?: string;
  shopId: string;
  kind?: string;
  version?: string;
  label?: string;
  createdBy?: string;
  exportedAt?: string;
  counts?: string;
};

function metaFromDriveFile(f: any, shopId: string): DriveBackupMeta {
  const props = (f.appProperties || {}) as DriveAppProps;
  const name: string = f.name || "";
  let kind = props.kind;
  if (!kind) {
    if (name.includes("_rp_")) kind = "restore_point";
    else if (name.includes("_safety_")) kind = "safety_backup";
    else kind = "drive_backup";
  }
  const versionRaw = props.version ? Number(props.version) : undefined;
  return {
    fileId: f.id,
    fileName: name,
    modifiedTime: f.modifiedTime,
    size: f.size,
    shopId: props.shopId || shopId,
    kind,
    label: props.label || undefined,
    version: Number.isFinite(versionRaw) ? versionRaw : undefined,
    createdBy: props.createdBy || undefined,
    exportedAt: props.exportedAt || undefined,
    counts: unpackCounts(props.counts),
  };
}

async function findFileInFolder(
  token: string,
  folderId: string,
  name: string,
): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${name}' and '${folderId}' in parents and trashed=false`,
  );
  const res = await driveFetch(
    `/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`,
    token,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Drive list failed");
  return data.files?.[0]?.id || null;
}

async function uploadOrUpdateJson(
  token: string,
  folderId: string,
  fileName: string,
  jsonText: string,
  existingId: string | null,
  shopId: string,
  appProperties?: Omit<DriveAppProps, "shopId" | "lemonRatebolo">,
): Promise<DriveBackupMeta> {
  const props: DriveAppProps = {
    lemonRatebolo: "1",
    app: APP_ID,
    shopId,
    ...(appProperties || {}),
  };
  // Drive appProperty values must be strings
  const stringProps: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === "") continue;
    stringProps[k] = truncateProp(String(v));
  }

  const metadata = {
    name: fileName,
    parents: existingId ? undefined : [folderId],
    appProperties: stringProps,
  };
  const boundary = "lemon_ratebolo_boundary";
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${jsonText}\r\n` +
    `--${boundary}--`;

  const path = existingId
    ? `/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,name,modifiedTime,size,appProperties`
    : `/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size,appProperties`;

  const res = await driveFetch(path, token, {
    method: existingId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Drive upload failed");
  return metaFromDriveFile(data, shopId);
}

function assertBackupSize(jsonText: string) {
  // Soft guard — large shops can fail mid-upload on weak networks.
  const bytes = typeof TextEncoder !== "undefined" ? new TextEncoder().encode(jsonText).length : jsonText.length;
  const mb = bytes / (1024 * 1024);
  if (mb > 25) {
    throw new Error(
      `Backup is too large (${mb.toFixed(1)} MB). Connect to Wi‑Fi and try again, or contact support.`,
    );
  }
}

function propsFromBackupPayload(
  backup: object,
  kind: BackupKind,
  shopId: string,
): Omit<DriveAppProps, "shopId" | "lemonRatebolo"> {
  const b = backup as any;
  const created =
    b.created_by?.display_name ||
    b.created_by?.username ||
    "";
  return {
    app: APP_ID,
    kind,
    version: String(b.version ?? 2),
    label: truncateProp(String(b.label || ""), 60),
    createdBy: truncateProp(String(created), 80),
    exportedAt: String(b.exported_at || new Date().toISOString()),
    counts: packCounts(b.counts || null),
  };
}

/** Upload shop backup JSON to the user's Drive (overwrite latest + keep dated copy). */
export async function uploadShopBackupToDrive(
  token: string,
  shopId: string,
  backup: object,
): Promise<DriveBackupMeta> {
  const folderId = await ensureBackupFolder(token);
  const jsonText = JSON.stringify(backup);
  assertBackupSize(jsonText);
  const exportedAt =
    (backup as any)?.exported_at || new Date().toISOString();
  const props = propsFromBackupPayload(backup, "drive_backup", shopId);

  const latestName = latestFileName(shopId);
  const existingLatest = await findFileInFolder(token, folderId, latestName);
  const latest = await uploadOrUpdateJson(
    token,
    folderId,
    latestName,
    jsonText,
    existingLatest,
    shopId,
    props,
  );

  // Dated snapshot for restore picker
  await uploadOrUpdateJson(
    token,
    folderId,
    datedFileName(shopId, exportedAt),
    jsonText,
    null,
    shopId,
    props,
  );

  await saveLocalBackupStatus({
    lastBackupAt: latest.modifiedTime || exportedAt,
    lastFileName: latest.fileName,
    lastFileId: latest.fileId,
  });
  return latest;
}

/** Upload a labeled Restore Point (never overwrites; unique timestamped file). */
export async function uploadRestorePointToDrive(
  token: string,
  shopId: string,
  backup: object,
): Promise<DriveBackupMeta> {
  const folderId = await ensureBackupFolder(token);
  const jsonText = JSON.stringify(backup);
  assertBackupSize(jsonText);
  const exportedAt =
    (backup as any)?.exported_at || new Date().toISOString();
  const props = propsFromBackupPayload(backup, "restore_point", shopId);
  return uploadOrUpdateJson(
    token,
    folderId,
    restorePointFileName(shopId, exportedAt),
    jsonText,
    null,
    shopId,
    props,
  );
}

/** Upload mandatory safety backup before a Restore Point restore. */
export async function uploadSafetyBackupToDrive(
  token: string,
  shopId: string,
  backup: object,
): Promise<DriveBackupMeta> {
  const folderId = await ensureBackupFolder(token);
  const jsonText = JSON.stringify(backup);
  assertBackupSize(jsonText);
  const exportedAt =
    (backup as any)?.exported_at || new Date().toISOString();
  const props = propsFromBackupPayload(backup, "safety_backup", shopId);
  return uploadOrUpdateJson(
    token,
    folderId,
    safetyBackupFileName(shopId, exportedAt),
    jsonText,
    null,
    shopId,
    props,
  );
}

export async function listShopBackupsOnDrive(
  token: string,
  shopId: string,
): Promise<DriveBackupMeta[]> {
  const folderId = await ensureBackupFolder(token);
  const q = encodeURIComponent(
    `'${folderId}' in parents and trashed=false and name contains 'LemonRatebolo_backup_${shopId}'`,
  );
  const res = await driveFetch(
    `/drive/v3/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&pageSize=50&fields=files(id,name,modifiedTime,size,appProperties)`,
    token,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Could not list Drive backups");
  const files = (data.files || []) as any[];
  return files
    .map((f) => metaFromDriveFile(f, shopId))
    .filter((f) => !f.shopId || f.shopId === shopId)
    .filter((f) => f.kind !== "restore_point" && f.kind !== "safety_backup");
}

/** List Restore Points for this shop (appProperties kind or `_rp_` filename fallback). */
export async function listRestorePointsOnDrive(
  token: string,
  shopId: string,
): Promise<DriveBackupMeta[]> {
  const folderId = await ensureBackupFolder(token);
  // Filename fallback covers Drive clients that strip custom appProperties.
  const q = encodeURIComponent(
    `'${folderId}' in parents and trashed=false and name contains 'LemonRatebolo_rp_${shopId}'`,
  );
  const res = await driveFetch(
    `/drive/v3/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&pageSize=50&fields=files(id,name,modifiedTime,size,appProperties)`,
    token,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Could not list Restore Points");
  const files = (data.files || []) as any[];
  return files
    .map((f) => metaFromDriveFile(f, shopId))
    .filter((f) => !f.shopId || f.shopId === shopId)
    .filter((f) => f.kind === "restore_point" || (f.fileName || "").includes("_rp_"));
}

export async function downloadBackupFromDrive(
  token: string,
  fileId: string,
): Promise<object> {
  const res = await driveFetch(`/drive/v3/files/${fileId}?alt=media`, token);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error?.message || "Could not download backup");
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new Error("Corrupted backup: could not read file");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Corrupted backup: invalid JSON");
  }
}
