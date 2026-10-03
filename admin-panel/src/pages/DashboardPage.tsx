import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Empty, ErrorBanner, Kpi, Shell } from "../components/ui";
import { api, setToken, type ApiError } from "../lib/api";
import { istToday, qs } from "../lib/dates";

type Dashboard = {
  from: string;
  to: string;
  merchants_total: number;
  merchants_active: number;
  farmers_directory: number;
  farmers_with_patti: number;
  farmer_bags: number;
  farmer_pattis: number;
  vendors_directory: number;
  vendors_with_bills: number;
  vendor_bills: number;
  purchased_bags: number;
};

type Activity = {
  items: Array<{
    shop_id: string;
    shop_name?: string;
    farmer_pattis: number;
    farmer_bags: number;
    vendor_bills: number;
    purchased_bags: number;
  }>;
  total_count: number;
};

export default function DashboardPage() {
  const nav = useNavigate();
  const [date, setDate] = useState(istToday());
  const [shopId, setShopId] = useState("");
  const [data, setData] = useState<Dashboard | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await api<Dashboard>(`/admin/dashboard${qs({ date, shop_id: shopId || undefined })}`);
      setData(d);
      const a = await api<Activity>(`/admin/operations/summary${qs({ date, page: 1, page_size: 50 })}`);
      setActivity(a);
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 401) {
        setToken(null);
        nav("/login");
        return;
      }
      setError(e.detail || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, shopId]);

  return (
    <Shell
      title="Dashboard"
      actions={
        <>
          <label style={{ fontSize: 12, fontWeight: 700 }}>
            Date (IST){" "}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ marginLeft: 6 }} />
          </label>
          <input
            placeholder="Shop ID filter (optional)"
            value={shopId}
            onChange={(e) => setShopId(e.target.value)}
            style={{ border: "2px solid #111", padding: 6, width: 200 }}
          />
          <button onClick={() => { setToken(null); nav("/login"); }} style={{ border: "2px solid #111", padding: "6px 10px", background: "#fff", fontWeight: 700 }}>
            Logout
          </button>
        </>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      {loading && !data ? <Empty message="Loading…" /> : null}
      {data ? (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
            <Kpi label="Merchants (active / total)" value={`${data.merchants_active} / ${data.merchants_total}`} />
            <Kpi label="Farmers (directory)" value={data.farmers_directory} hint="All farmers on file" />
            <Kpi label="Farmers with Patti (day)" value={data.farmers_with_patti} hint="Distinct on selected date" />
            <Kpi label="Farmer Bags (day)" value={data.farmer_bags} hint="sum(pattis.total_bags)" />
            <Kpi label="Farmer Patti (day)" value={data.farmer_pattis} hint="non-deleted pattis" />
            <Kpi label="Vendors (directory)" value={data.vendors_directory} />
            <Kpi label="Vendors with Bills (day)" value={data.vendors_with_bills} />
            <Kpi label="Vendor Bills (day)" value={data.vendor_bills} />
            <Kpi label="Purchased Bags (day)" value={data.purchased_bags} hint="PAID · paid_at IST window" />
          </div>

          <h2 style={{ fontSize: 16, fontWeight: 900 }}>Merchant activity · {date}</h2>
          {!activity?.items?.length ? (
            <Empty message="No merchant activity for this date." />
          ) : (
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Shop</th>
                  <th style={th}>Pattis</th>
                  <th style={th}>Bags</th>
                  <th style={th}>Bills</th>
                  <th style={th}>Purchased</th>
                </tr>
              </thead>
              <tbody>
                {activity.items.map((r) => (
                  <tr key={r.shop_id}>
                    <td style={td}>
                      <a href={`/merchants/${r.shop_id}`}>{r.shop_name || r.shop_id}</a>
                    </td>
                    <td style={td}>{r.farmer_pattis}</td>
                    <td style={td}>{r.farmer_bags}</td>
                    <td style={td}>{r.vendor_bills}</td>
                    <td style={td}>{r.purchased_bags}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </Shell>
  );
}

const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", background: "#fff", border: "2px solid #111" };
const th: React.CSSProperties = { textAlign: "left", borderBottom: "2px solid #111", padding: 8, fontSize: 12 };
const td: React.CSSProperties = { borderBottom: "1px solid #ddd", padding: 8 };
