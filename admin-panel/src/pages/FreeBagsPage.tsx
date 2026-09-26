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
  total_available?: number;
  free_remaining?: number;
  purchased_remaining?: number;
  unclaimed_free_bags?: number;
};

type FreeAllocation = {
  id: string;
  shop_id: string;
  shop_name?: string;
  username?: string;
  mobile?: string | null;
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
  allocated_bags?: number;
  claimed_bags?: number;
  unclaimed_bags?: number;
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

function newClientRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function FreeBagsPage() {
  const nav = useNavigate();
  const now = new Date();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<MerchantHit[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

  const selectedMerchants = useMemo(
    () => hits.filter((h) => selectedIds.has(h.shop_id)),
    [hits, selectedIds],
  );

  async function searchMerchants(term: string) {
    try {
      const res = await api<MerchantHit[]>(`/admin/billing/merchant-search${qs({ q: term || undefined, limit: 80 })}`);
      setHits(res);
      // Drop selections that are no longer in the filtered list only when searching empty→keep? Keep IDs that still exist in new hits.
      setSelectedIds((prev) => {
        const next = new Set<string>();
        const ids = new Set(res.map((h) => h.shop_id));
        prev.forEach((id) => {
          if (ids.has(id)) next.add(id);
        });
        return next;
      });
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

  function toggleMerchant(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedIds(new Set(hits.map((h) => h.shop_id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function onGiveClick(e: FormEvent) {
    e.preventDefault();
    setOkMsg(null);
    setError(null);
    if (!selectedIds.size) {
      setError("Select at least one merchant.");
      return;
    }
    if (!bagsN) {
      setError("Enter free bags (> 0).");
      return;
    }
    const y = Number(year);
    const m = Number(month);
    if (!Number.isFinite(y) || y < 2020 || y > 2100) {
      setError("Enter a valid year.");
      return;
    }
    if (!Number.isFinite(m) || m < 1 || m > 12) {
      setError("Select a valid month.");
      return;
    }
    setConfirmOpen(true);
  }

  async function confirmGive() {
    if (!selectedIds.size || !bagsN || busy) return;
    setBusy(true);
    setError(null);
    const client_request_id = newClientRequestId();
    const shop_ids = Array.from(selectedIds);
    try {
      if (shop_ids.length === 1) {
        const created = await api<FreeAllocation>("/admin/billing/free-allocations", {
          method: "POST",
          body: JSON.stringify({
            shop_id: shop_ids[0],
            bags: bagsN,
            year: Number(year),
            month: Number(month),
            reason: reason.trim() || null,
            client_request_id,
          }),
        });
        setOkMsg(
          `Allocated ${created.bags} free bags to ${created.shop_name || created.username} for ${created.period_label}. Status: PENDING (merchant must claim).`,
        );
      } else {
        const res = await api<{ created: FreeAllocation[]; count: number; bags_each: number }>(
          "/admin/billing/free-allocations/bulk",
          {
            method: "POST",
            body: JSON.stringify({
              shop_ids,
              bags: bagsN,
              year: Number(year),
              month: Number(month),
              reason: reason.trim() || null,
              client_request_id,
            }),
          },
        );
        setOkMsg(
          `Allocated ${res.bags_each} free bags to ${res.count} merchants for ${periodLabel}. Status: PENDING (each merchant must claim).`,
        );
      }
      setConfirmOpen(false);
      setReason("");
      setBags("100");
      clearSelection();
      await loadHistory();
      await searchMerchants(q);
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
      {okMsg ? <div style={okBox} data-testid="free-bags-ok">{okMsg}</div> : null}

      <section style={card}>
        <h2 style={h2}>GIVE FREE BAGS</h2>
        <p style={hint}>
          Giving free bags does <strong>not</strong> increase the merchant wallet until they tap CLAIM NOW in the app.
        </p>
        <form onSubmit={onGiveClick} style={{ display: "grid", gap: 12 }}>
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

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" onClick={selectAllFiltered} disabled={!hits.length} data-testid="free-select-all">
              Select all filtered ({hits.length})
            </button>
            <button type="button" onClick={clearSelection} disabled={!selectedIds.size} data-testid="free-clear-selection">
              Clear selection
            </button>
            <span style={{ fontWeight: 700, fontSize: 13 }} data-testid="free-selected-count">
              Selected: {selectedIds.size}
            </span>
          </div>

          {hits.length ? (
            <div style={hitList} data-testid="free-merchant-hits">
              {hits.map((h) => {
                const on = selectedIds.has(h.shop_id);
                return (
                  <label
                    key={h.shop_id}
                    style={{
                      ...hitBtn,
                      ...(on ? hitBtnOn : {}),
                    }}
                    data-testid={`free-merchant-${h.shop_id}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleMerchant(h.shop_id)}
                      style={{ width: 18, height: 18, marginTop: 2 }}
                      data-testid={`free-merchant-check-${h.shop_id}`}
                    />
                    <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                      <strong>{h.shop_name || "—"}</strong>
                      <span style={{ fontSize: 12, color: "#333" }}>
                        @{h.username || "—"}
                        {h.mobile ? ` · ${h.mobile}` : ""}
                      </span>
                      <span style={{ fontSize: 12, color: "#555" }}>
                        Usable balance: {(h.total_available ?? 0).toLocaleString()}
                        {(h.unclaimed_free_bags || 0) > 0
                          ? ` · Unclaimed free: ${h.unclaimed_free_bags!.toLocaleString()}`
                          : ""}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <Empty message="No merchants match this search." />
          )}

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
          <button type="submit" style={primaryBtn} data-testid="free-bags-give-open" disabled={busy}>
            GIVE FREE BAGS
          </button>
        </form>
      </section>

      <section style={{ ...card, marginTop: 20 }}>
        <h2 style={h2}>FREE BAG HISTORY</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <input
            placeholder="Search merchant / mobile"
            value={filterQ}
            onChange={(e) => setFilterQ(e.target.value)}
            style={input}
            data-testid="free-history-search"
          />
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={input} data-testid="free-history-status">
            <option value="">All statuses</option>
            <option value="PENDING">PENDING</option>
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
          <div style={historyCards} data-testid="free-history-cards">
            {rows.map((r) => {
              const allocated = r.allocated_bags ?? r.bags;
              const claimed = r.claimed_bags ?? (r.status === "CLAIMED" ? r.bags : 0);
              const unclaimed = r.unclaimed_bags ?? Math.max(0, allocated - claimed);
              return (
                <article key={r.id} style={historyCard} data-testid={`free-history-${r.id}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div>
                      <Link to={`/merchants/${r.shop_id}`} style={{ fontWeight: 900, color: "#111" }}>
                        {r.shop_name || r.shop_id}
                      </Link>
                      <div style={{ fontSize: 12, color: "#555" }}>
                        @{r.username || "—"}
                        {r.mobile ? ` · ${r.mobile}` : ""}
                      </div>
                    </div>
                    <span style={statusPill(r.status)}>{r.status}</span>
                  </div>
                  <div style={metaGrid}>
                    <div>
                      <div style={metaLabel}>Date</div>
                      <div>{fmt(r.allocated_at)}</div>
                    </div>
                    <div>
                      <div style={metaLabel}>Month</div>
                      <div>{r.period_label}</div>
                    </div>
                    <div>
                      <div style={metaLabel}>Allocated</div>
                      <div>{allocated.toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={metaLabel}>Claimed</div>
                      <div>{claimed.toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={metaLabel}>Unclaimed</div>
                      <div>{unclaimed.toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={metaLabel}>Claim date</div>
                      <div>{fmt(r.claimed_at)}</div>
                    </div>
                    <div>
                      <div style={metaLabel}>Admin</div>
                      <div>{r.created_by_admin_username || "—"}</div>
                    </div>
                    <div>
                      <div style={metaLabel}>Note</div>
                      <div>{r.reason || "—"}</div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {confirmOpen && selectedIds.size ? (
        <div style={modalRoot} data-testid="free-bags-confirm-modal">
          <div style={modalCard}>
            <h3 style={{ marginTop: 0 }}>Confirm Give</h3>
            <p data-testid="free-bags-confirm-text">
              You are giving <strong>{bagsN.toLocaleString()}</strong> free bags to{" "}
              <strong>{selectedIds.size}</strong> merchant{selectedIds.size === 1 ? "" : "s"}.
            </p>
            <p>
              Month: <strong>{periodLabel}</strong>
            </p>
            {selectedMerchants.length <= 8 ? (
              <ul style={{ margin: "8px 0", paddingLeft: 18, fontSize: 13 }}>
                {selectedMerchants.map((m) => (
                  <li key={m.shop_id}>
                    {m.shop_name} (@{m.username})
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ fontSize: 13, color: "#444" }}>
                Including {selectedMerchants.slice(0, 3).map((m) => m.shop_name).join(", ")} and{" "}
                {selectedIds.size - 3} more…
              </p>
            )}
            {reason.trim() ? (
              <p>
                Note: <strong>{reason.trim()}</strong>
              </p>
            ) : null}
            <p style={{ color: "#555", fontSize: 13 }}>
              Merchant usable balance will NOT increase until they claim in the app.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={busy} data-testid="free-bags-cancel">
                Cancel
              </button>
              <button type="button" style={primaryBtn} onClick={confirmGive} disabled={busy} data-testid="free-bags-confirm">
                {busy ? "GIVING…" : "Confirm Give"}
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
const input: CSSProperties = { border: "2px solid #111", padding: 8, fontSize: 14, width: "100%", boxSizing: "border-box" };
const primaryBtn: CSSProperties = {
  background: "#15803d",
  color: "#fff",
  border: "2px solid #166534",
  padding: "10px 14px",
  fontWeight: 900,
  letterSpacing: 1,
  cursor: "pointer",
};
const hitList: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflow: "auto" };
const hitBtn: CSSProperties = {
  textAlign: "left",
  border: "2px solid #111",
  background: "#fff",
  padding: 10,
  display: "flex",
  flexDirection: "row",
  alignItems: "flex-start",
  gap: 10,
  cursor: "pointer",
};
const hitBtnOn: CSSProperties = { background: "#dcfce7" };
const okBox: CSSProperties = {
  background: "#dcfce7",
  border: "2px solid #15803d",
  color: "#14532d",
  padding: 10,
  marginBottom: 12,
  fontWeight: 700,
};
const historyCards: CSSProperties = { display: "grid", gap: 10 };
const historyCard: CSSProperties = {
  border: "2px solid #111",
  padding: 12,
  background: "#fff",
  display: "grid",
  gap: 10,
};
const metaGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: 8,
  fontSize: 13,
};
const metaLabel: CSSProperties = { fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#666", fontWeight: 800 };
function statusPill(status: string): CSSProperties {
  const s = (status || "").toUpperCase();
  const bg = s === "CLAIMED" ? "#dcfce7" : s === "PENDING" || s === "AVAILABLE" ? "#fef9c3" : "#f3f4f6";
  return {
    display: "inline-block",
    padding: "4px 8px",
    border: "2px solid #111",
    background: bg,
    fontWeight: 900,
    fontSize: 11,
    letterSpacing: 1,
    height: "fit-content",
  };
}
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
