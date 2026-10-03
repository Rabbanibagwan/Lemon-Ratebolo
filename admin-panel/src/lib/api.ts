const API_BASE = (import.meta.env.VITE_API_BASE_URL || "https://lemon-ratebolo.onrender.com").replace(/\/$/, "");

export type ApiError = { status: number; detail: string };

function getToken(): string {
  return localStorage.getItem("lm.admin.token") || "";
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("lm.admin.token", token);
  else localStorage.removeItem("lm.admin.token");
}

async function parseError(res: Response): Promise<ApiError> {
  let detail = "Request failed";
  try {
    const data = await res.json();
    detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
  } catch {
    detail = await res.text();
  }
  return { status: res.status, detail };
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
  auth = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (auth) {
    const t = getToken();
    if (t) headers.set("Authorization", `Bearer ${t}`);
  }
  const res = await fetch(`${API_BASE}/api${path}`, { ...init, headers });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Multipart / binary upload — do not set Content-Type (browser sets boundary). */
export async function apiForm<T>(path: string, form: FormData, auth = true): Promise<T> {
  const headers = new Headers();
  if (auth) {
    const t = getToken();
    if (t) headers.set("Authorization", `Bearer ${t}`);
  }
  const res = await fetch(`${API_BASE}/api${path}`, { method: "POST", body: form, headers });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Authenticated download of a blob (Excel templates, etc.). */
export async function apiBlob(path: string, auth = true): Promise<Blob> {
  const headers = new Headers();
  if (auth) {
    const t = getToken();
    if (t) headers.set("Authorization", `Bearer ${t}`);
  }
  const res = await fetch(`${API_BASE}/api${path}`, { headers });
  if (!res.ok) throw await parseError(res);
  return res.blob();
}

/** Authenticated GET of a file (PDF/XLSX) saved under `filename`. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const blob = await apiBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export { API_BASE };
