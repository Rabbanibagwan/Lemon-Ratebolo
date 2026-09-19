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

export { API_BASE };
