import type { CSSProperties, ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

export function Shell({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div style={styles.shell}>
      <aside style={styles.nav}>
        <div style={styles.brand}>LEMON ADMIN</div>
        <NavLink href="/dashboard">Dashboard</NavLink>
        <NavLink href="/merchants">Merchants</NavLink>
        <NavLink href="/operations">Operations</NavLink>
        <NavLink href="/pattis">Pattis</NavLink>
        <NavLink href="/vendor-bills">Vendor Bills</NavLink>
        <NavLink href="/purchases">Purchases</NavLink>
        <NavLink href="/reports">Reports</NavLink>
        <NavLink href="/settings">Settings</NavLink>
        <NavLink href="/audit">Audit</NavLink>
      </aside>
      <main style={styles.main}>
        <header style={styles.header}>
          <h1 style={styles.h1}>{title}</h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{actions}</div>
        </header>
        {children}
      </main>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const loc = useLocation();
  const active = loc.pathname === href || loc.pathname.startsWith(href + "/");
  return (
    <Link to={href} style={{ ...styles.link, ...(active ? styles.linkActive : {}) }}>
      {children}
    </Link>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div style={styles.kpi}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={styles.kpiValue}>{value}</div>
      {hint ? <div style={styles.kpiHint}>{hint}</div> : null}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return <div style={styles.error}>{message}</div>;
}

export function Empty({ message }: { message: string }) {
  return <div style={styles.empty}>{message}</div>;
}

const styles: Record<string, CSSProperties> = {
  shell: { display: "flex", minHeight: "100vh", background: "#f4f4f0", color: "#111", fontFamily: "ui-sans-serif, system-ui, sans-serif" },
  nav: { width: 220, background: "#111", color: "#fff", padding: 16, display: "flex", flexDirection: "column", gap: 6 },
  brand: { fontWeight: 900, letterSpacing: 1, marginBottom: 16, fontSize: 14 },
  link: { color: "#ccc", textDecoration: "none", padding: "8px 10px", border: "1px solid transparent" },
  linkActive: { color: "#fff", borderColor: "#fff", background: "#222" },
  main: { flex: 1, padding: 24 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, borderBottom: "2px solid #111", paddingBottom: 12 },
  h1: { margin: 0, fontSize: 28, fontWeight: 900 },
  kpi: { border: "2px solid #111", padding: 14, background: "#fff", minWidth: 140 },
  kpiLabel: { fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#555", fontWeight: 800 },
  kpiValue: { fontSize: 28, fontWeight: 900, marginTop: 4 },
  kpiHint: { fontSize: 11, color: "#666", marginTop: 4 },
  error: { background: "#fee2e2", border: "2px solid #b91c1c", color: "#b91c1c", padding: 10, marginBottom: 12, fontWeight: 700 },
  empty: { border: "2px dashed #999", padding: 24, textAlign: "center", color: "#666" },
};
