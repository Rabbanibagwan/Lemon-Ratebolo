import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

export function Shell({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    setNavOpen(false);
  }, [loc.pathname]);

  return (
    <div className="admin-shell" style={styles.shell}>
      <button
        type="button"
        className="admin-menu-btn"
        style={styles.menuBtn}
        onClick={() => setNavOpen((v) => !v)}
        aria-label="Open menu"
        data-testid="admin-menu-toggle"
      >
        ☰
      </button>
      {navOpen ? (
        <div className="admin-nav-backdrop" style={styles.backdrop} onClick={() => setNavOpen(false)} data-testid="admin-nav-backdrop" />
      ) : null}
      <aside
        className={`admin-sidebar${navOpen ? " is-open" : ""}`}
        style={styles.nav}
        data-testid="admin-sidebar"
      >
        <div style={styles.brand}>LEMON ADMIN</div>
        <NavLink href="/dashboard" onNavigate={() => setNavOpen(false)}>
          Dashboard
        </NavLink>
        <NavLink href="/merchants" onNavigate={() => setNavOpen(false)}>
          Merchants
        </NavLink>
        <NavLink href="/operations" onNavigate={() => setNavOpen(false)}>
          Operations
        </NavLink>
        <NavLink href="/pattis" onNavigate={() => setNavOpen(false)}>
          Pattis
        </NavLink>
        <NavLink href="/vendor-bills" onNavigate={() => setNavOpen(false)}>
          Vendor Bills
        </NavLink>
        <NavLink href="/purchases" onNavigate={() => setNavOpen(false)}>
          Purchases
        </NavLink>
        <NavLink href="/free-bags" onNavigate={() => setNavOpen(false)}>
          FREE BAGS
        </NavLink>
        <NavLink href="/reports" onNavigate={() => setNavOpen(false)}>
          Reports
        </NavLink>
        <NavLink href="/settings" onNavigate={() => setNavOpen(false)}>
          Settings
        </NavLink>
        <NavLink href="/audit" onNavigate={() => setNavOpen(false)}>
          Audit
        </NavLink>
      </aside>
      <main className="admin-main" style={styles.main}>
        <header style={styles.header}>
          <h1 style={styles.h1}>{title}</h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{actions}</div>
        </header>
        {children}
      </main>
    </div>
  );
}

function NavLink({ href, children, onNavigate }: { href: string; children: ReactNode; onNavigate?: () => void }) {
  const loc = useLocation();
  const active = loc.pathname === href || loc.pathname.startsWith(href + "/");
  return (
    <Link
      to={href}
      onClick={onNavigate}
      style={{ ...styles.link, ...(active ? styles.linkActive : {}) }}
      data-testid={`nav-${href.replace(/^\//, "") || "home"}`}
    >
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
  menuBtn: {
    display: "none",
    position: "fixed",
    top: 10,
    left: 10,
    zIndex: 60,
    background: "#111",
    color: "#fff",
    border: "2px solid #fff",
    width: 40,
    height: 40,
    fontSize: 18,
    fontWeight: 900,
  },
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.4)",
    zIndex: 40,
  },
  nav: {
    width: 220,
    background: "#111",
    color: "#fff",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    flexShrink: 0,
  },
  brand: { fontWeight: 900, letterSpacing: 1, marginBottom: 16, fontSize: 14 },
  link: { color: "#ccc", textDecoration: "none", padding: "8px 10px", border: "1px solid transparent" },
  linkActive: { color: "#fff", borderColor: "#fff", background: "#222" },
  main: { flex: 1, padding: 24, minWidth: 0 },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    borderBottom: "2px solid #111",
    paddingBottom: 12,
    gap: 12,
    flexWrap: "wrap",
  },
  h1: { margin: 0, fontSize: 28, fontWeight: 900 },
  kpi: { border: "2px solid #111", padding: 14, background: "#fff", minWidth: 140 },
  kpiLabel: { fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#555", fontWeight: 800 },
  kpiValue: { fontSize: 28, fontWeight: 900, marginTop: 4 },
  kpiHint: { fontSize: 11, color: "#666", marginTop: 4 },
  error: { background: "#fee2e2", border: "2px solid #b91c1c", color: "#b91c1c", padding: 10, marginBottom: 12, fontWeight: 700 },
  empty: { border: "2px dashed #999", padding: 24, textAlign: "center", color: "#666" },
};
