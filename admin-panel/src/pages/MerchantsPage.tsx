import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Empty, ErrorBanner, Kpi, Shell } from "../components/ui";
import { api, setToken, type ApiError } from "../lib/api";
import { istToday, qs } from "../lib/dates";

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
  const [q, setQ] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setError(null);
      try {
        // Merchants directory is shops-based — never pass operational date here.
        const res = await api<{ items: any[]; total_count: number }>(
          `/admin/merchants${qs({ q, page, page_size: 50 })}`,
        );
        setItems(res.items);
        setTotal(res.total_count);
      } catch (err) {
        const e = err as ApiError;
        if (e.status === 401) { setToken(null); nav("/login"); return; }
        setError(e.detail);
      }
    })();
  }, [q, page, nav]);

  return (
    <Shell title="Merchants" actions={
      <input placeholder="Search" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} style={{ border: "2px solid #111", padding: 6 }} />
    }>
      {error ? <ErrorBanner message={error} /> : null}
      {!items.length ? <Empty message="No merchants." /> : (
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Shop</th>
              <th style={th}>Username</th>
              <th style={th}>Active</th>
              <th style={th}>Wallet free</th>
              <th style={th}>Wallet purchased</th>
              <th style={th}>Lifetime purchased bags</th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.shop_id}>
                <td style={td}><Link to={`/merchants/${m.shop_id}`}>{m.shop_name}</Link></td>
                <td style={td}>{m.username}</td>
                <td style={td}>{m.active ? "Yes" : "No"}</td>
                <td style={td}>{m.wallet_free_allocated ?? "—"}</td>
                <td style={td}>{m.wallet_purchased_total ?? "—"}</td>
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

export function MerchantDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [date, setDate] = useState(istToday());
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setData(await api(`/admin/merchants/${id}${qs({ date })}`));
      } catch (err) {
        const e = err as ApiError;
        if (e.status === 401) { setToken(null); nav("/login"); return; }
        setError(e.detail);
      }
    })();
  }, [id, date, nav]);

  const d = data?.dashboard;
  const m = data as Merchant & { dashboard?: any };

  return (
    <Shell title={m?.shop_name || "Merchant"} actions={<input type="date" value={date} onChange={(e) => setDate(e.target.value)} />}>
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
          <p style={{ marginTop: 16 }}>
            <Link to={`/pattis?shop_id=${id}&date=${date}`}>View Pattis</Link>
            {" · "}
            <Link to={`/vendor-bills?shop_id=${id}&date=${date}`}>View Bills</Link>
            {" · "}
            <Link to={`/purchases?shop_id=${id}&date=${date}`}>View Purchases</Link>
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
