import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
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

type FreeSummary = {
  shop_id: string;
  allocated: number;
  claimed: number;
  used: number;
  remaining: number;
  available_to_claim: number;
  unclaimed?: number;
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

function monthOptionsAround(now = new Date()) {
  const out: { key: string; year: number; month: number; label: string }[] = [];
  // Past 18 months + next 6 months for admin allocation.
  for (let i = -18; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const label = `${MONTHS[month - 1].l} ${year}`;
    out.push({ key: `${year}-${month}`, year, month, label });
  }
  return out;
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
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
  const periodOpts = useMemo(() => monthOptionsAround(now), []);
  const defaultPeriod = `${now.getFullYear()}-${now.getMonth() + 1}`;

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<MerchantHit[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bags, setBags] = useState("100");
  const [periodKey, setPeriodKey] = useState(defaultPeriod);
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [summary, setSummary] = useState<FreeSummary | null>(null);

  const [filterStatus, setFilterStatus] = useState("");
  const [filterQ, setFilterQ] = useState("");
  const [filterPeriod, setFilterPeriod] = useState("");
  const [rows, setRows] = useState<FreeAllocation[]>([]);

  const selectedPeriod = useMemo(() => {
    const found = periodOpts.find((p) => p.key === periodKey);
    if (found) return found;
    return {
      key: defaultPeriod,
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      label: `${MONTHS[now.getMonth()].l} ${now.getFullYear()}`,
    };
  }, [periodKey, periodOpts, defaultPeriod, now]);

  const selectedMerchants = useMemo(
    () => hits.filter((h) => selectedIds.has(h.shop_id)),
    [hits, selectedIds],
  );

  async function searchMerchants(term: string) {
    try {
      const res = await api<MerchantHit[]>(`/admin/billing/merchant-search${qs({ q: term || undefined, limit: 80 })}`);
      setHits(res);
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
      let year: string | undefined;
      let month: string | undefined;
      if (filterPeriod) {
        const [y, m] = filterPeriod.split("-");
        year = y;
        month = m;
      }
      const res = await api<FreeAllocation[]>(
        `/admin/billing/free-allocations${qs({
          status: filterStatus || undefined,
          q: filterQ || undefined,
          year: year || undefined,
          month: month || undefined,
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

  async function loadSummary(shopId: string) {
    try {
      const res = await api<FreeSummary>(`/admin/billing/merchants/${shopId}/free-summary`);
      setSummary(res);
    } catch {
      setSummary(null);
    }
  }

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterQ, filterPeriod]);

  useEffect(() => {
    const t = setTimeout(() => searchMerchants(q), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    if (selectedIds.size === 1) {
      const id = Array.from(selectedIds)[0];
      loadSummary(id);
    } else {
      setSummary(null);
    }
  }, [selectedIds]);

  const bagsN = useMemo(() => {
    const n = Math.floor(Number(bags));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [bags]);

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

  function onBagsChange(raw: string) {
    // Integers only — strip non-digits.
    const digits = raw.replace(/\D/g, "");
    setBags(digits);
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
      setError("Enter free bags as a whole number greater than 0.");
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
    const year = selectedPeriod.year;
    const month = selectedPeriod.month;
    try {
      if (shop_ids.length === 1) {
        const created = await api<FreeAllocation>("/admin/billing/free-allocations", {
          method: "POST",
          body: JSON.stringify({
            shop_id: shop_ids[0],
            bags: bagsN,
            year,
            month,
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
              year,
              month,
              reason: reason.trim() || null,
              client_request_id,
            }),
          },
        );
        setOkMsg(
          `Allocated ${res.bags_each} free bags to ${res.count} merchants for ${selectedPeriod.label}. Status: PENDING (each merchant must claim).`,
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

  const singleMerchant = selectedMerchants.length === 1 ? selectedMerchants[0] : null;

  return (
    <Shell title="FREE BAGS">
      {error ? <ErrorBanner message={error} /> : null}
      {okMsg ? <div style={okBox} data-testid="free-bags-ok">{okMsg}</div> : null}

      <section style={card}>
        <h2 style={h2}>GIVE FREE BAGS</h2>
        <p style={hint}>
          Giving free bags does <strong>not</strong> increase the merchant wallet until they tap{" "}
          <strong>CLAIM NOW</strong> in the Lemon Mandi app.
        </p>
        <form onSubmit={onGiveClick} style={{ display: "grid", gap: 12 }}>
          <label style={label}>
            Merchant
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search merchant..."
              style={input}
              data-testid="free-merchant-search"
              autoComplete="off"
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
                      style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
                      data-testid={`free-merchant-check-${h.shop_id}`}
                    />
                    <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                      <strong style={{ wordBreak: "break-word" }}>{h.shop_name || "—"}</strong>
                      <span style={{ fontSize: 12, color: "#333" }}>
                        Shop ID: {h.shop_id}
                        {h.mobile ? ` · Mobile: ${h.mobile}` : ""}
                      </span>
                      <span style={{ fontSize: 12, color: "#555" }}>
                        @{h.username || "—"}
                        {h.owner_name ? ` · ${h.owner_name}` : ""}
                      </span>
                      <span style={{ fontSize: 12, color: "#555" }}>
                        Usable balance: {(h.total_available ?? 0).toLocaleString()}
                        {(h.unclaimed_free_bags || 0) > 0
                          ? ` · Available to claim: ${h.unclaimed_free_bags!.toLocaleString()}`
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

          {singleMerchant && summary ? (
            <div style={summaryBox} data-testid="free-bag-summary">
              <h3 style={{ margin: "0 0 8px", fontSize: 13, letterSpacing: 1 }}>FREE BAG SUMMARY</h3>
              <div style={summaryGrid}>
                <div>
                  <div style={metaLabel}>Allocated</div>
                  <div style={summaryVal}>{summary.allocated.toLocaleString()}</div>
                </div>
                <div>
                  <div style={metaLabel}>Claimed</div>
                  <div style={summaryVal}>{summary.claimed.toLocaleString()}</div>
                </div>
                <div>
                  <div style={metaLabel}>Available to Claim</div>
                  <div style={summaryVal}>{(summary.available_to_claim ?? summary.unclaimed ?? 0).toLocaleString()}</div>
                </div>
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "#555" }}>
                Separate from paid purchased bags. Usable wallet: {(singleMerchant.total_available ?? 0).toLocaleString()}.
              </p>
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ ...label, flex: 1, minWidth: 140 }}>
              Free Bags
              <input
                value={bags}
                onChange={(e) => onBagsChange(e.target.value)}
                inputMode="numeric"
                pattern="[0-9]*"
                style={input}
                data-testid="free-bags-qty"
                placeholder="100"
              />
            </label>
            <label style={{ ...label, flex: 1, minWidth: 180 }}>
              Month
              <select
                value={periodKey}
                onChange={(e) => setPeriodKey(e.target.value)}
                style={input}
                data-testid="free-bags-month"
              >
                {periodOpts.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label style={label}>
            Note / Reason (optional)
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={input}
              data-testid="free-bags-reason"
              placeholder="Optional note"
            />
          </label>
          <button type="submit" style={primaryBtn} data-testid="free-bags-give-open" disabled={busy}>
            GIVE / APPROVE FREE BAGS
          </button>
        </form>
      </section>

      <section style={{ ...card, marginTop: 20 }}>
        <h2 style={h2}>FREE BAG HISTORY</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <input
            placeholder="Search merchant"
            value={filterQ}
            onChange={(e) => setFilterQ(e.target.value)}
            style={{ ...input, flex: "1 1 160px", minWidth: 140 }}
            data-testid="free-history-search"
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{ ...input, flex: "1 1 120px" }}
            data-testid="free-history-status"
          >
            <option value="">All statuses</option>
            <option value="PENDING">PENDING</option>
            <option value="CLAIMED">CLAIMED</option>
          </select>
          <select
            value={filterPeriod}
            onChange={(e) => setFilterPeriod(e.target.value)}
            style={{ ...input, flex: "1 1 160px" }}
            data-testid="free-history-month"
          >
            <option value="">All months</option>
            {periodOpts.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {!rows.length ? (
          <Empty message="No free bag allocations." />
        ) : (
          <div style={historyCards} data-testid="free-history-cards">
            {rows.map((r) => {
              const allocated = r.allocated_bags ?? r.bags;
              const claimed = r.claimed_bags ?? (r.status === "CLAIMED" ? r.bags : 0);
              const remaining = r.unclaimed_bags ?? Math.max(0, allocated - claimed);
              return (
                <article key={r.id} style={historyCard} data-testid={`free-history-${r.id}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Link to={`/merchants/${r.shop_id}`} style={{ fontWeight: 900, color: "#111", wordBreak: "break-word" }}>
                        {r.shop_name || r.shop_id}
                      </Link>
                      <div style={{ fontSize: 12, color: "#555" }}>
                        Shop ID: {r.shop_id}
                        {r.mobile ? ` · ${r.mobile}` : ""}
                      </div>
                    </div>
                    <span style={statusPill(r.status)}>{r.status === "AVAILABLE" ? "PENDING" : r.status}</span>
                  </div>
                  <div style={metaGrid}>
                    <div>
                      <div style={metaLabel}>Date</div>
                      <div>{fmtDate(r.allocated_at)}</div>
                    </div>
                    <div>
                      <div style={metaLabel}>Month</div>
                      <div>{r.period_label}</div>
                    </div>
                    <div>
                      <div style={metaLabel}>Free Bags</div>
                      <div>{allocated.toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={metaLabel}>Claimed</div>
                      <div>{claimed.toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={metaLabel}>Remaining</div>
                      <div>{remaining.toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={metaLabel}>Status</div>
                      <div>{r.status === "AVAILABLE" ? "PENDING" : r.status}</div>
                    </div>
                  </div>
                  {r.reason ? (
                    <div style={{ fontSize: 12, color: "#444" }}>
                      Note: {r.reason}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {confirmOpen && selectedIds.size ? (
        <div style={modalRoot} data-testid="free-bags-confirm-modal">
          <div style={modalCard}>
            <h3 style={{ marginTop: 0 }}>Confirm Free Bags</h3>
            {selectedIds.size === 1 && singleMerchant ? (
              <>
                <p style={confirmRow}>
                  <span style={metaLabel}>Merchant</span>
                  <strong data-testid="free-bags-confirm-merchant">{singleMerchant.shop_name || singleMerchant.shop_id}</strong>
                </p>
                <p style={confirmRow}>
                  <span style={metaLabel}>Free Bags</span>
                  <strong data-testid="free-bags-confirm-bags">{bagsN.toLocaleString()}</strong>
                </p>
                <p style={confirmRow}>
                  <span style={metaLabel}>Month</span>
                  <strong data-testid="free-bags-confirm-month">{selectedPeriod.label}</strong>
                </p>
              </>
            ) : (
              <>
                <p data-testid="free-bags-confirm-text">
                  You are giving <strong>{bagsN.toLocaleString()}</strong> free bags to{" "}
                  <strong>{selectedIds.size}</strong> merchants.
                </p>
                <p style={confirmRow}>
                  <span style={metaLabel}>Month</span>
                  <strong>{selectedPeriod.label}</strong>
                </p>
                {selectedMerchants.length <= 8 ? (
                  <ul style={{ margin: "8px 0", paddingLeft: 18, fontSize: 13 }}>
                    {selectedMerchants.map((m) => (
                      <li key={m.shop_id}>
                        {m.shop_name} (Shop ID: {m.shop_id})
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ fontSize: 13, color: "#444" }}>
                    Including {selectedMerchants.slice(0, 3).map((m) => m.shop_name).join(", ")} and{" "}
                    {selectedIds.size - 3} more…
                  </p>
                )}
              </>
            )}
            {reason.trim() ? (
              <p style={confirmRow}>
                <span style={metaLabel}>Note</span>
                <strong>{reason.trim()}</strong>
              </p>
            ) : null}
            <p style={{ color: "#555", fontSize: 13 }}>
              Merchant usable balance will NOT increase until they claim in the app. Status will be PENDING.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={busy} data-testid="free-bags-cancel">
                CANCEL
              </button>
              <button type="button" style={primaryBtn} onClick={confirmGive} disabled={busy} data-testid="free-bags-confirm">
                {busy ? "APPROVING…" : "CONFIRM"}
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
const input: CSSProperties = { border: "2px solid #111", padding: 8, fontSize: 16, width: "100%", boxSizing: "border-box" };
const primaryBtn: CSSProperties = {
  background: "#15803d",
  color: "#fff",
  border: "2px solid #166534",
  padding: "12px 14px",
  fontWeight: 900,
  letterSpacing: 1,
  cursor: "pointer",
  width: "100%",
  maxWidth: "100%",
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
const summaryBox: CSSProperties = {
  border: "2px solid #111",
  background: "#f8faf8",
  padding: 12,
};
const summaryGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
  gap: 10,
};
const summaryVal: CSSProperties = { fontSize: 20, fontWeight: 900 };
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
  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
  gap: 8,
  fontSize: 13,
};
const metaLabel: CSSProperties = { fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#666", fontWeight: 800 };
const confirmRow: CSSProperties = { display: "flex", flexDirection: "column", gap: 2, margin: "8px 0" };
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
    flexShrink: 0,
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
const modalCard: CSSProperties = {
  background: "#fff",
  border: "2px solid #111",
  padding: 20,
  width: "min(480px, 100%)",
  maxHeight: "90vh",
  overflow: "auto",
};
