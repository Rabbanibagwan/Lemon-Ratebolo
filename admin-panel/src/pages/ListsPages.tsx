import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Empty, ErrorBanner, Shell } from "../components/ui";
import { api, setToken, type ApiError } from "../lib/api";
import { istToday, qs } from "../lib/dates";

function useList(path: string) {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const initialDate = params.get("date") || istToday();
  const initialShop = params.get("shop_id") || "";
  const [date, setDate] = useState(initialDate);
  const [shopId, setShopId] = useState(initialShop);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const query = useMemo(
    () => qs({ date, shop_id: shopId || undefined, q: q || undefined, page, page_size: 50 }),
    [date, shopId, q, page],
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api<{ items: any[]; total_count: number }>(`${path}${query}`);
        setItems(res.items);
        setTotal(res.total_count);
      } catch (err) {
        const e = err as ApiError;
        if (e.status === 401) { setToken(null); nav("/login"); return; }
        setError(e.detail);
      } finally {
        setLoading(false);
      }
    })();
  }, [path, query, nav]);

  return { date, setDate, shopId, setShopId, q, setQ, page, setPage, items, total, error, loading };
}

export function PattisPage() {
  const s = useList("/admin/pattis");
  return (
    <ListShell title="Pattis" s={s} columns={[
      ["date", "Date"], ["shop_name", "Shop"], ["patti_no", "No"], ["farmer_name", "Farmer"], ["total_bags", "Bags"], ["net_payable", "Net"], ["status", "Status"],
    ]} />
  );
}

export function VendorBillsPage() {
  const s = useList("/admin/vendor-bills");
  return (
    <ListShell title="Vendor Bills" s={s} columns={[
      ["date", "Date"], ["shop_name", "Shop"], ["bill_code", "Bill"], ["vendor_name", "Vendor"], ["total_bags", "Bags"], ["grand_total", "Total"], ["status", "Status"],
    ]} />
  );
}

export function PurchasesPage() {
  const nav = useNavigate();
  const s = useList("/admin/purchases");
  const [detail, setDetail] = useState<any | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  async function openInvoice(id: string) {
    setDetailError(null);
    try {
      setDetail(await api(`/admin/purchases/${id}`));
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 401) { setToken(null); nav("/login"); return; }
      setDetailError(e.detail);
    }
  }

  return (
    <>
      <ListShell
        title="Purchases"
        s={s}
        columns={[
          ["event_at", "Event At"],
          ["shop_name", "Shop"],
          ["invoice_number", "Invoice"],
          ["bags", "Bags"],
          ["total_amount", "Amount"],
          ["status", "Status"],
        ]}
        onRowClick={(row) => row?.id && openInvoice(String(row.id))}
      />
      {detailError ? <div style={{ padding: 12 }}><ErrorBanner message={detailError} /></div> : null}
      {detail ? (
        <div style={modalOverlay} onClick={() => setDetail(null)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()} data-testid="admin-purchase-invoice">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <strong>Bag Balance Invoice</strong>
              <button onClick={() => setDetail(null)} style={{ border: "2px solid #111", padding: "4px 10px", fontWeight: 700 }}>Close</button>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              <div><b>Invoice:</b> {detail.invoice_number || "—"}</div>
              <div><b>Status:</b> {detail.status}</div>
              <div style={{ marginTop: 8 }}><b>Billing To</b></div>
              <div>{detail.billing_to?.shop_name || "—"} {detail.billing_to?.username ? `(@${detail.billing_to.username})` : ""}</div>
              {detail.billing_to?.owner_name ? <div>Owner: {detail.billing_to.owner_name}</div> : null}
              {detail.billing_to?.address ? <div>{detail.billing_to.address}</div> : null}
              {detail.billing_to?.mobile ? <div>{detail.billing_to.mobile}</div> : null}
              {detail.billing_to?.gst_number ? <div>GSTIN: {detail.billing_to.gst_number}</div> : null}
              <div style={{ marginTop: 8 }}><b>Service HSN:</b> {detail.service_hsn_code || "—"}</div>
              <div><b>Bags × Price:</b> {detail.calculation?.bags ?? detail.bags} × ₹{detail.calculation?.price_per_bag ?? detail.price_per_bag} = ₹{detail.calculation?.base_amount ?? detail.base_amount}</div>
              <div><b>GST ({detail.calculation?.gst_percent ?? detail.gst_percent}%):</b> ₹{detail.calculation?.gst_amount ?? detail.gst_amount}</div>
              <div><b>Total Amount:</b> ₹{detail.calculation?.total_amount ?? detail.total_amount}</div>
              <div style={{ marginTop: 8, color: "#666" }}>Purchase ID: {detail.id} · Shop: {detail.shop_id}</div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function OperationsPage() {
  const s = useList("/admin/operations/summary");
  return (
    <ListShell title="Operations" s={s} columns={[
      ["shop_name", "Shop"], ["farmer_pattis", "Pattis"], ["farmer_bags", "Bags"], ["vendor_bills", "Bills"], ["purchased_bags", "Purchased"],
    ]} hideSearch />
  );
}

export function ReportsPage() {
  const nav = useNavigate();
  const [date, setDate] = useState(istToday());
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await api<{ items: any[] }>(`/admin/reports/merchant-wise${qs({ date })}`);
      setRows(res.items);
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 401) { setToken(null); nav("/login"); return; }
      setError(e.detail);
    }
  }

  useEffect(() => { load(); }, [date]);

  function downloadCsv() {
    const header = ["shop_id", "shop_name", "farmer_pattis", "farmer_bags", "vendor_bills", "purchased_bags"];
    const lines = [header.join(",")].concat(
      rows.map((r) => header.map((h) => JSON.stringify(r[h] ?? "")).join(",")),
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `merchant-wise-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Shell title="Reports" actions={
      <>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button onClick={downloadCsv} style={{ border: "2px solid #111", padding: "6px 10px", fontWeight: 700 }}>Export CSV</button>
      </>
    }>
      {error ? <ErrorBanner message={error} /> : null}
      {!rows.length ? <Empty message="No rows." /> : (
        <table style={table}>
          <thead>
            <tr>{["Shop", "Pattis", "Bags", "Bills", "Purchased"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.shop_id}>
                <td style={td}>{r.shop_name}</td>
                <td style={td}>{r.farmer_pattis}</td>
                <td style={td}>{r.farmer_bags}</td>
                <td style={td}>{r.vendor_bills}</td>
                <td style={td}>{r.purchased_bags}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}

export function SettingsPage() {
  const nav = useNavigate();
  const [form, setForm] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setForm(await api("/admin/billing/settings"));
      } catch (err) {
        const e = err as ApiError;
        if (e.status === 401) { setToken(null); nav("/login"); return; }
        setError(e.detail);
      }
    })();
  }, [nav]);

  async function save() {
    setMsg(null); setError(null);
    try {
      const res = await api("/admin/billing/settings", { method: "PUT", body: JSON.stringify(form) });
      setForm(res);
      setMsg("Saved");
    } catch (err) {
      setError((err as ApiError).detail);
    }
  }

  return (
    <Shell title="Settings">
      {error ? <ErrorBanner message={error} /> : null}
      {msg ? <div style={{ background: "#d1fae5", border: "2px solid #059669", padding: 8, marginBottom: 12 }}>{msg}</div> : null}
      {!form ? <Empty message="Loading…" /> : (
        <div style={{ maxWidth: 420, display: "flex", flexDirection: "column", gap: 10 }}>
          {(["price_per_bag", "new_merchant_free_bags", "gst_percent"] as const).map((k) => (
            <label key={k} style={{ fontWeight: 700, fontSize: 12 }}>
              {k}
              <input
                style={{ display: "block", width: "100%", border: "2px solid #111", padding: 8, marginTop: 4 }}
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })}
              />
            </label>
          ))}
          <label style={{ fontWeight: 700, fontSize: 12 }}>
            service_hsn_code
            <input
              style={{ display: "block", width: "100%", border: "2px solid #111", padding: 8, marginTop: 4 }}
              value={form.service_hsn_code ?? "998399"}
              onChange={(e) => setForm({ ...form, service_hsn_code: e.target.value })}
            />
          </label>
          <label style={{ fontWeight: 700 }}>
            <input type="checkbox" checked={!!form.allow_test_payments} onChange={(e) => setForm({ ...form, allow_test_payments: e.target.checked })} /> Allow test payments
          </label>
          <label style={{ fontWeight: 700 }}>
            <input type="checkbox" checked={!!form.billing_active} onChange={(e) => setForm({ ...form, billing_active: e.target.checked })} /> Billing active
          </label>
          <button onClick={save} style={{ border: "2px solid #111", background: "#111", color: "#fff", padding: 10, fontWeight: 800 }}>Save</button>
        </div>
      )}
    </Shell>
  );
}

export function AuditPage() {
  const nav = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api<{ items: any[] }>("/admin/audit-log?page=1&page_size=100");
        setItems(res.items);
      } catch (err) {
        const e = err as ApiError;
        if (e.status === 401) { setToken(null); nav("/login"); return; }
        setError(e.detail);
      }
    })();
  }, [nav]);

  return (
    <Shell title="Audit Log">
      {error ? <ErrorBanner message={error} /> : null}
      {!items.length ? <Empty message="No audit entries yet." /> : (
        <table style={table}>
          <thead>
            <tr>{["When", "Admin", "Action", "Resource"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td style={td}>{r.created_at}</td>
                <td style={td}>{r.admin_username}</td>
                <td style={td}>{r.action}</td>
                <td style={td}>{r.resource_type}{r.resource_id ? `:${r.resource_id}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Shell>
  );
}

function ListShell({
  title,
  s,
  columns,
  hideSearch,
  onRowClick,
}: {
  title: string;
  s: ReturnType<typeof useList>;
  columns: [string, string][];
  hideSearch?: boolean;
  onRowClick?: (row: any) => void;
}) {
  return (
    <Shell title={title} actions={
      <>
        <input type="date" value={s.date} onChange={(e) => { s.setPage(1); s.setDate(e.target.value); }} />
        <input placeholder="Shop ID" value={s.shopId} onChange={(e) => { s.setPage(1); s.setShopId(e.target.value); }} style={{ border: "2px solid #111", padding: 6, width: 160 }} />
        {!hideSearch ? <input placeholder="Search" value={s.q} onChange={(e) => { s.setPage(1); s.setQ(e.target.value); }} style={{ border: "2px solid #111", padding: 6 }} /> : null}
      </>
    }>
      {s.error ? <ErrorBanner message={s.error} /> : null}
      {s.loading ? <Empty message="Loading…" /> : !s.items.length ? <Empty message="No rows." /> : (
        <table style={table}>
          <thead>
            <tr>{columns.map(([, label]) => <th key={label} style={th}>{label}</th>)}</tr>
          </thead>
          <tbody>
            {s.items.map((row, i) => (
              <tr
                key={row.id || row.shop_id || i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: "pointer" } : undefined}
              >
                {columns.map(([key]) => <td key={key} style={td}>{formatCell(row[key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ marginTop: 12 }}>
        <button disabled={s.page <= 1} onClick={() => s.setPage(s.page - 1)}>Prev</button>
        <span style={{ margin: "0 8px" }}>Page {s.page} · {s.total} total</span>
        <button disabled={s.page * 50 >= s.total} onClick={() => s.setPage(s.page + 1)}>Next</button>
      </div>
    </Shell>
  );
}

function formatCell(v: unknown) {
  if (v == null) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", background: "#fff", border: "2px solid #111" };
const th: React.CSSProperties = { textAlign: "left", borderBottom: "2px solid #111", padding: 8, fontSize: 12 };
const td: React.CSSProperties = { borderBottom: "1px solid #ddd", padding: 8, fontSize: 13 };
const modalOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 50,
};
const modalCard: React.CSSProperties = {
  background: "#fff",
  border: "2px solid #111",
  padding: 16,
  width: "min(520px, 100%)",
  maxHeight: "80vh",
  overflow: "auto",
};
