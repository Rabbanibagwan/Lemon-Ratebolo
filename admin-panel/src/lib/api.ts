const API_BASE = (import.meta.env.VITE_API_BASE_URL || "https://lemon-ratebolo.onrender.com").replace(/\/$/, "");

export type ApiError = { status: number; detail: string };

function getToken(): string {
  return localStorage.getItem("lm.admin.token") || "";
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("lm.admin.token", token);
  else localStorage.removeItem("lm.admin.token");
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
  if (!res.ok) {
    let detail = "Request failed";
    try {
      const data = await res.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      detail = await res.text();
    }
    throw { status: res.status, detail } as ApiError;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Authenticated GET of a file (PDF/XLSX) saved under `filename`. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const headers = new Headers();
  const t = getToken();
  if (t) headers.set("Authorization", `Bearer ${t}`);
  const res = await fetch(`${API_BASE}/api${path}`, { headers });
  if (!res.ok) {
    let detail = "Download failed";
    try {
      const data = await res.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      /* non-JSON error body */
    }
    throw { status: res.status, detail } as ApiError;
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export { API_BASE };
