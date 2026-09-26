import { FormEvent, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Empty, ErrorBanner, Shell } from "../components/ui";
import { api, setToken, type ApiError } from "../lib/api";
import { qs } from "../lib/dates";

type MerchantHit = {
  shop_id: string;
  shop_name?: string;
  username?: string;
  owner_name?: string;
  mobile?: string;
};

type FreeAllocation = {
  id: string;
  shop_id: string;
  shop_name?: string;
  username?: string;
  bags: number;
  year: number;
  month: number;
  period_label: string;
  status: string;
  reason?: string | null;
  allocated_at: string;
  claimed_at?: string | null;
  claim_ref?: string | null;
  created_by_admin_username?: string | null;
};

const MONTHS = [
  { v: 1, l: "January" },
  { v: 2, l: "February" },
  { v: 3, l: "March" },
  { v: 4, l: "April" },
  { v: 5, l: "May" },
  { v: 6, l: "June" },
  { v: 7, l: "July" },
  { v: 8, l: "August" },
  { v: 9, l: "September" },
  { v: 10, l: "October" },
  { v: 11, l: "November" },
  { v: 12, l: "December" },
];

function fmt(iso?: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

export default function FreeBagsPage() {
  const nav = useNavigate();
  const now = new Date();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<MerchantHit[]>([]);
  const [selected, setSelected] = useState<MerchantHit | null>(null);
  const [bags, setBags] = useState("100");
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [filterStatus, setFilterStatus] = useState("");
  const [filterQ, setFilterQ] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [rows, setRows] = useState<FreeAllocation[]>([]);

  async function searchMerchants(term: string) {
    try {
      const res = await api<MerchantHit[]>(`/admin/billing/merchant-search${qs({ q: term || undefined, limit: 30 })}`);
      setHits(res);
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 401) {
        setToken(null);
        nav("/login");
      }
    }
  }

  async function loadHistory() {
    setError(null);
    try {
      const res = await api<FreeAllocation[]>(
        `/admin/billing/free-allocations${qs({
          status: filterStatus || undefined,
          q: filterQ || undefined,
          year: filterYear || undefined,
          month: filterMonth || undefined,
          limit: 200,
        })}`,
      );
      setRows(res);
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 401) {
        setToken(null);
        nav("/login");
        return;
      }
      setError(e.detail);
    }
  }

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterQ, filterYear, filterMonth]);

  useEffect(() => {
    const t = setTimeout(() => searchMerchants(q), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const bagsN = useMemo(() => {
    const n = Math.floor(Number(bags));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [bags]);

  const periodLabel = useMemo(() => {
    const m = MONTHS.find((x) => x.v === Number(month));
    return `${m?.l || "—"} ${year}`;
  }, [month, year]);

  function onGiveClick(e: FormEvent) {
    e.preventDefault();
    setOkMsg(null);
    setError(null);
    if (!selected) {
      setError("Select a merchant first.");
      return;
    }
    if (!bagsN) {
      setError("Enter free bags (> 0).");
      return;
    }
    setConfirmOpen(true);
  }

  async function confirmGive() {
    if (!selected || !bagsN) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api<FreeAllocation>("/admin/billing/free-allocations", {
        method: "POST",
        body: JSON.stringify({
          shop_id: selected.shop_id,
          bags: bagsN,
          year: Number(year),
          month: Number(month),
          reason: reason.trim() || null,
        }),
      });
      setOkMsg(
        `Allocated ${created.bags} free bags to ${created.shop_name || created.username} for ${created.period_label}. Status: AVAILABLE (merchant must claim).`,
      );
      setConfirmOpen(false);
      setReason("");
      setBags("100");
      await loadHistory();
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 401) {
        setToken(null);
        nav("/login");
        return;
      }
      setError(e.detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Free Bags">
      {error ? <ErrorBanner message={error} /> : null}
      {okMsg ? <div style={okBox}>{okMsg}</div> : null}

      <section style={card}>
        <h2 style={h2}>FREE BAG ALLOCATION</h2>
        <p style={hint}>
          Giving free bags does <strong>not</strong> increase the merchant wallet until they tap CLAIM NOW in the app.
        </p>
        <form onSubmit={onGiveClick} style={{ display: "grid", gap: 12, maxWidth: 640 }}>
          <label style={label}>
            Search merchant
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Shop name, username, owner, mobile"
              style={input}
              data-testid="free-merchant-search"
            />
          </label>
          {hits.length ? (
            <div style={hitList} data-testid="free-merchant-hits">
              {hits.map((h) => (
                <button
                  key={h.shop_id}
                  type="button"
                  onClick={() => setSelected(h)}
                  style={{
                    ...hitBtn,
                    ...(selected?.shop_id === h.shop_id ? hitBtnOn : {}),
                  }}
                  data-testid={`free-merchant-${h.shop_id}`}
                >
                  <strong>{h.shop_name || "—"}</strong>
                  <span>
                    @{h.username || "—"}
                    {h.owner_name ? ` · ${h.owner_name}` : ""}
                    {h.mobile ? ` · ${h.mobile}` : ""}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {selected ? (
            <div style={selectedBox} data-testid="free-merchant-selected">
              Selected: <strong>{selected.shop_name}</strong> (@{selected.username})
              <button type="button" onClick={() => setSelected(null)} style={{ marginLeft: 8 }}>
                Clear
              </button>
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ ...label, flex: 1, minWidth: 140 }}>
              Free bags
              <input
                value={bags}
                onChange={(e) => setBags(e.target.value)}
                inputMode="numeric"
                style={input}
                data-testid="free-bags-qty"
              />
            </label>
            <label style={{ ...label, flex: 1, minWidth: 140 }}>
              Month
              <select value={month} onChange={(e) => setMonth(e.target.value)} style={input} data-testid="free-bags-month">
                {MONTHS.map((m) => (
                  <option key={m.v} value={m.v}>
                    {m.l}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ ...label, flex: 1, minWidth: 120 }}>
              Year
              <input value={year} onChange={(e) => setYear(e.target.value)} style={input} data-testid="free-bags-year" />
            </label>
          </div>
          <label style={label}>
            Reason / note (optional)
            <input value={reason} onChange={(e) => setReason(e.target.value)} style={input} data-testid="free-bags-reason" />
          </label>
          <button type="submit" style={primaryBtn} data-testid="free-bags-give-open">
            GIVE FREE BAGS
          </button>
        </form>
      </section>

      <section style={{ ...card, marginTop: 20 }}>
        <h2 style={h2}>ALLOCATION HISTORY</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <input placeholder="Merchant search" value={filterQ} onChange={(e) => setFilterQ(e.target.value)} style={input} />
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={input}>
            <option value="">All statuses</option>
            <option value="AVAILABLE">AVAILABLE</option>
            <option value="CLAIMED">CLAIMED</option>
            <option value="EXPIRED">EXPIRED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
          <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} style={input}>
            <option value="">All months</option>
            {MONTHS.map((m) => (
              <option key={m.v} value={m.v}>
                {m.l}
              </option>
            ))}
          </select>
          <input placeholder="Year" value={filterYear} onChange={(e) => setFilterYear(e.target.value)} style={{ ...input, width: 90 }} />
        </div>
        {!rows.length ? (
          <Empty message="No free bag allocations." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Merchant</th>
                  <th style={th}>Month</th>
                  <th style={th}>Bags</th>
                  <th style={th}>Allocated</th>
                  <th style={th}>Status</th>
                  <th style={th}>Claimed</th>
                  <th style={th}>Claim Ref</th>
                  <th style={th}>Admin</th>
                  <th style={th}>Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>
                      <Link to={`/merchants/${r.shop_id}`}>{r.shop_name || r.shop_id}</Link>
                      <div style={{ fontSize: 12, color: "#555" }}>@{r.username}</div>
                    </td>
                    <td style={td}>{r.period_label}</td>
                    <td style={td}>{r.bags}</td>
                    <td style={td}>{fmt(r.allocated_at)}</td>
                    <td style={td}>{r.status}</td>
                    <td style={td}>{fmt(r.claimed_at)}</td>
                    <td style={td}>{r.claim_ref || "—"}</td>
                    <td style={td}>{r.created_by_admin_username || "—"}</td>
                    <td style={td}>{r.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirmOpen && selected ? (
        <div style={modalRoot} data-testid="free-bags-confirm-modal">
          <div style={modalCard}>
            <h3 style={{ marginTop: 0 }}>Confirm free bag allocation</h3>
            <p>
              Merchant: <strong>{selected.shop_name}</strong> (@{selected.username})
            </p>
            <p>
              Free Bags: <strong>{bagsN.toLocaleString()}</strong>
            </p>
            <p>
              Month: <strong>{periodLabel}</strong>
            </p>
            {reason.trim() ? (
              <p>
                Note: <strong>{reason.trim()}</strong>
              </p>
            ) : null}
            <p style={{ color: "#555", fontSize: 13 }}>
              Merchant usable balance will NOT increase until they claim in the app.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={busy}>
                CANCEL
              </button>
              <button type="button" style={primaryBtn} onClick={confirmGive} disabled={busy} data-testid="free-bags-confirm">
                {busy ? "GIVING…" : "GIVE FREE BAGS"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}

const card: CSSProperties = { border: "2px solid #111", background: "#fff", padding: 16 };
const h2: CSSProperties = { margin: "0 0 8px", fontSize: 16, letterSpacing: 1 };
const hint: CSSProperties = { marginTop: 0, color: "#444", fontSize: 13 };
const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontWeight: 700, fontSize: 12 };
const input: CSSProperties = { border: "2px solid #111", padding: 8, fontSize: 14 };
const primaryBtn: CSSProperties = {
  background: "#15803d",
  color: "#fff",
  border: "2px solid #166534",
  padding: "10px 14px",
  fontWeight: 900,
  letterSpacing: 1,
  cursor: "pointer",
};
const hitList: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflow: "auto" };
const hitBtn: CSSProperties = {
  textAlign: "left",
  border: "2px solid #111",
  background: "#fff",
  padding: 10,
  display: "flex",
  flexDirection: "column",
  gap: 2,
  cursor: "pointer",
};
const hitBtnOn: CSSProperties = { background: "#dcfce7" };
const selectedBox: CSSProperties = { border: "2px solid #15803d", background: "#f0fdf4", padding: 10 };
const okBox: CSSProperties = {
  background: "#dcfce7",
  border: "2px solid #15803d",
  color: "#14532d",
  padding: 10,
  marginBottom: 12,
  fontWeight: 700,
};
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", background: "#fff" };
const th: CSSProperties = { border: "1px solid #111", padding: 8, textAlign: "left", fontSize: 11, letterSpacing: 1 };
const td: CSSProperties = { border: "1px solid #ccc", padding: 8, verticalAlign: "top", fontSize: 13 };
const modalRoot: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 50,
};
const modalCard: CSSProperties = { background: "#fff", border: "2px solid #111", padding: 20, width: "min(480px, 100%)" };
