import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Empty, ErrorBanner, Kpi, Shell } from "../components/ui";
import { api, setToken, type ApiError } from "../lib/api";
import { qs } from "../lib/dates";
import { useWorkingDate } from "../lib/workingDate";

type Merchant = {
  shop_id: string;
  shop_name?: string;
  username?: string;
  active?: boolean;
  owner_name?: string;
  mobile?: string;
  village?: string;
  district?: string;
  state?: string;
};

export function MerchantsPage() {
  const nav = useNavigate();
  const { date } = useWorkingDate();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageDate, setPageDate] = useState(date);
  const [error, setError] = useState<string | null>(null);

  if (pageDate !== date) {
    setPageDate(date);
    setPage(1);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const res = await api<{ items: any[]; total_count: number }>(
          `/admin/merchants${qs({ q, page, page_size: 50, date })}`,
        );
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total_count);
      } catch (err) {
        if (cancelled) return;
        const e = err as ApiError;
        if (e.status === 401) { setToken(null); nav("/login"); return; }
        setError(e.detail);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [q, page, date, nav]);

  return (
    <Shell title="Merchants" actions={
      <>
        <input placeholder="Search" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} style={{ border: "2px solid #111", padding: 6 }} />
      </>
    }>
      {error ? <ErrorBanner message={error} /> : null}
      {!items.length ? <Empty message="No merchants." /> : (
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Shop</th>
              <th style={th}>Username</th>
              <th style={th}>Active</th>
              <th style={th}>Pattis</th>
              <th style={th}>Bags</th>
              <th style={th}>Bills</th>
              <th style={th}>Purchased</th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.shop_id}>
                <td style={td}><Link to={`/merchants/${m.shop_id}`}>{m.shop_name}</Link></td>
                <td style={td}>{m.username}</td>
                <td style={td}>{m.active ? "Yes" : "No"}</td>
                <td style={td}>{m.farmer_pattis ?? "—"}</td>
                <td style={td}>{m.farmer_bags ?? "—"}</td>
                <td style={td}>{m.vendor_bills ?? "—"}</td>
                <td style={td}>{m.purchased_bags ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pager page={page} total={total} pageSize={50} onChange={setPage} />
    </Shell>
  );
}

type FreeSummary = {
  shop_id: string;
  allocated: number;
  claimed: number;
  used: number;
  remaining: number;
  available_to_claim: number;
};

export function MerchantDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { date } = useWorkingDate();
  const [data, setData] = useState<any>(null);
  const [freeSummary, setFreeSummary] = useState<FreeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const res = await api(`/admin/merchants/${id}${qs({ date })}`);
        if (cancelled) return;
        setData(res);
        try {
          const fs = await api<FreeSummary>(`/admin/billing/merchants/${id}/free-summary`);
          if (!cancelled) setFreeSummary(fs);
        } catch {
          if (!cancelled) setFreeSummary(null);
        }
      } catch (err) {
        if (cancelled) return;
        const e = err as ApiError;
        if (e.status === 401) { setToken(null); nav("/login"); return; }
        setError(e.detail);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, date, nav]);

  const d = data?.dashboard;
  const m = data as Merchant & { dashboard?: any };

  return (
    <Shell title={m?.shop_name || "Merchant"}>
      {error ? <ErrorBanner message={error} /> : null}
      {!data ? <Empty message="Loading…" /> : (
        <>
          <p style={{ marginTop: 0 }}>
            @{m.username} · {m.active ? "Active" : "Inactive"}
            {m.owner_name ? ` · Owner: ${m.owner_name}` : ""}
            {m.mobile ? ` · ${m.mobile}` : ""}
            <br />
            {[m.village, m.district, m.state].filter(Boolean).join(", ") || "—"}
          </p>
          {d ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <Kpi label="Farmers (directory)" value={d.farmers_directory} />
              <Kpi label="Farmers with Patti" value={d.farmers_with_patti} />
              <Kpi label="Farmer Bags" value={d.farmer_bags} />
              <Kpi label="Farmer Patti" value={d.farmer_pattis} />
              <Kpi label="Vendors (directory)" value={d.vendors_directory} />
              <Kpi label="Vendor Bills" value={d.vendor_bills} />
              <Kpi label="Purchased Bags" value={d.purchased_bags} />
            </div>
          ) : null}
          {freeSummary ? (
            <>
              <h3 style={{ marginTop: 20, marginBottom: 8, letterSpacing: 1 }}>FREE BAG SUMMARY</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }} data-testid="merchant-free-summary">
                <Kpi label="Allocated Free Bags" value={freeSummary.allocated} />
                <Kpi label="Claimed Free Bags" value={freeSummary.claimed} />
                <Kpi label="Unclaimed Free Bags" value={freeSummary.available_to_claim} />
                <Kpi label="Used Free Bags" value={freeSummary.used} />
                <Kpi label="Remaining Free Bags" value={freeSummary.remaining} />
              </div>
            </>
          ) : null}
          <p style={{ marginTop: 16 }}>
            <Link to={`/pattis?shop_id=${id}`}>View Pattis</Link>
            {" · "}
            <Link to={`/vendor-bills?shop_id=${id}`}>View Bills</Link>
            {" · "}
            <Link to={`/purchases?shop_id=${id}`}>View Purchases</Link>
            {" · "}
            <Link to="/free-bags">Give Free Bags</Link>
          </p>
        </>
      )}
    </Shell>
  );
}

function Pager({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
      <span>Page {page} / {pages} · {total} total</span>
      <button disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
    </div>
  );
}

const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", background: "#fff", border: "2px solid #111" };
const th: React.CSSProperties = { textAlign: "left", borderBottom: "2px solid #111", padding: 8, fontSize: 12 };
const td: React.CSSProperties = { borderBottom: "1px solid #ddd", padding: 8 };
