import { useState } from "react";
import type { FormEvent, CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken, type ApiError } from "../lib/api";

export default function LoginPage() {
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ access_token: string }>(
        "/admin/auth/login",
        { method: "POST", body: JSON.stringify({ username, password }) },
        false,
      );
      setToken(res.access_token);
      nav("/dashboard");
    } catch (err) {
      const e = err as ApiError;
      setError(e.detail || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f4f4f0" }}>
      <form onSubmit={onSubmit} style={{ border: "2px solid #111", background: "#fff", padding: 28, width: 360 }}>
        <h1 style={{ marginTop: 0, fontWeight: 900 }}>Admin Login</h1>
        <p style={{ color: "#555", fontSize: 13 }}>Lemon Mandi platform console</p>
        {error ? <div style={{ background: "#fee2e2", border: "2px solid #b91c1c", padding: 8, marginBottom: 12 }}>{error}</div> : null}
        <label style={{ display: "block", fontWeight: 700, fontSize: 12 }}>Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} style={input} autoComplete="username" required />
        <label style={{ display: "block", fontWeight: 700, fontSize: 12, marginTop: 12 }}>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={input} autoComplete="current-password" required />
        <button disabled={loading} style={btn} type="submit">{loading ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}

const input: CSSProperties = { width: "100%", border: "2px solid #111", padding: 10, marginTop: 4, boxSizing: "border-box" };
const btn: CSSProperties = { marginTop: 16, width: "100%", border: "2px solid #111", background: "#111", color: "#fff", padding: 12, fontWeight: 800, cursor: "pointer" };
