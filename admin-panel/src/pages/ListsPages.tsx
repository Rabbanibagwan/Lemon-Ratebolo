import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  const s = useList("/admin/purchases");
  const nav = useNavigate();
  return (
    <Shell title="Purchases" actions={
      <>
        <input type="date" value={s.date} onChange={(e) => { s.setPage(1); s.setDate(e.target.value); }} />
        <input placeholder="Shop ID" value={s.shopId} onChange={(e) => { s.setPage(1); s.setShopId(e.target.value); }} style={{ border: "2px solid #111", padding: 6, width: 160 }} />
        <input placeholder="Search" value={s.q} onChange={(e) => { s.setPage(1); s.setQ(e.target.value); }} style={{ border: "2px solid #111", padding: 6 }} />
      </>
    }>
      {s.error ? <ErrorBanner message={s.error} /> : null}
      {s.loading ? <Empty message="Loading…" /> : !s.items.length ? <Empty message="No rows." /> : (
        <table style={table}>
          <thead>
            <tr>
              {["Event At", "Invoice", "Shop", "Bags", "Rate", "Subtotal", "GST %", "GST", "Total", "Status", ""].map((h) => (
                <th key={h || "act"} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.items.map((row) => (
              <tr key={row.id}>
                <td style={td}>{formatCell(row.event_at)}</td>
                <td style={td}>{formatCell(row.invoice_no)}</td>
                <td style={td}>{formatCell(row.shop_name)}</td>
                <td style={td}>{formatCell(row.bags)}</td>
                <td style={td}>{formatCell(row.price_per_bag)}</td>
                <td style={td}>{formatCell(row.base_amount)}</td>
                <td style={td}>{formatCell(row.gst_percent)}</td>
                <td style={td}>{formatCell(row.gst_amount)}</td>
                <td style={td}>{formatCell(row.total_amount)}</td>
                <td style={td}>{formatCell(row.status)}</td>
                <td style={td}>
                  <button
                    type="button"
                    onClick={() => nav(`/purchases/${row.id}`)}
                    style={{ border: "2px solid #111", padding: "4px 8px", fontWeight: 800, cursor: "pointer" }}
                  >
                    Invoice
                  </button>
                </td>
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

export function PurchaseInvoicePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [inv, setInv] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!id) return;
      setError(null);
      try {
        setInv(await api(`/admin/purchases/${id}/invoice`));
      } catch (err) {
        const e = err as ApiError;
        if (e.status === 401) { setToken(null); nav("/login"); return; }
        setError(e.detail);
      }
    })();
  }, [id, nav]);

  function downloadPdf() {
    if (!inv) return;
    setBusy(true);
    try {
      const html = buildAdminInvoiceHtml(inv);
      const w = window.open("", "_blank");
      if (!w) {
        setError("Popup blocked — allow popups to download/print the invoice PDF.");
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      // Give the document a moment, then open the browser print → Save as PDF flow.
      setTimeout(() => {
        try { w.focus(); w.print(); } catch { /* ignore */ }
      }, 300);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Purchase Invoice" actions={
      <>
        <button type="button" onClick={() => nav(-1)} style={{ border: "2px solid #111", padding: "6px 10px", fontWeight: 700 }}>Back</button>
        <button
          type="button"
          disabled={!inv || busy}
          onClick={downloadPdf}
          style={{ border: "2px solid #111", background: "#111", color: "#fff", padding: "6px 10px", fontWeight: 800 }}
        >
          {busy ? "…" : "Download / Print PDF"}
        </button>
      </>
    }>
      {error ? <ErrorBanner message={error} /> : null}
      {!inv ? <Empty message="Loading…" /> : (
        <div style={{ background: "#fff", border: "2px solid #111", padding: 16, maxWidth: 720 }}>
          <div style={{ fontSize: 20, fontWeight: 900 }}>{inv.seller?.name || "Lemon Mandi"}</div>
          {inv.seller?.address ? <div style={{ color: "#374151", fontSize: 12 }}>{inv.seller.address}</div> : null}
          {inv.seller?.phone ? <div style={{ color: "#374151", fontSize: 12 }}>Phone: {inv.seller.phone}</div> : null}
          {inv.seller?.gstin ? <div style={{ color: "#374151", fontSize: 12 }}>GSTIN: {inv.seller.gstin}</div> : null}
          <div style={{ marginTop: 10, letterSpacing: 2, fontWeight: 800, color: "#6B7280", fontSize: 11 }}>PURCHASE INVOICE</div>
          <hr style={{ border: 0, borderTop: "2px solid #111", margin: "12px 0" }} />
          <div style={{ display: "flex", gap: 24 }}>
            <div style={{ flex: 1 }}>
              <div style={miniLabel}>Invoice No</div>
              <div style={{ fontWeight: 900, fontFamily: "monospace" }}>{inv.invoice_no}</div>
              <div style={{ ...miniLabel, marginTop: 8 }}>Invoice Date</div>
              <div style={{ fontWeight: 700 }}>{String(inv.invoice_date || "").slice(0, 10)}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={miniLabel}>Billing To</div>
              <div style={{ fontWeight: 900 }}>{inv.bill_to?.name}</div>
              {inv.bill_to?.address ? <div style={{ fontSize: 12 }}>{inv.bill_to.address}</div> : null}
              {inv.bill_to?.phone ? <div style={{ fontSize: 12 }}>{inv.bill_to.phone}</div> : null}
              {inv.bill_to?.gstin ? <div style={{ fontSize: 12 }}>GSTIN: {inv.bill_to.gstin}</div> : null}
            </div>
          </div>
          <table style={{ ...table, marginTop: 16 }}>
            <thead>
              <tr>
                {["Description", "HSN/SAC", "Bags", "Rate", "Amount"].map((h) => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={td}>{inv.item?.description}</td>
                <td style={td}>{inv.item?.hsn_sac_code}</td>
                <td style={td}>{inv.item?.bags}</td>
                <td style={td}>{inv.item?.price_per_bag}</td>
                <td style={td}>{inv.item?.amount}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 12, maxWidth: 280, marginLeft: "auto" }}>
            <div style={totRow}><span>Subtotal</span><span>{inv.subtotal}</span></div>
            <div style={totRow}><span>GST ({inv.gst_percent}%)</span><span>{inv.gst_amount}</span></div>
            <div style={{ ...totRow, background: "#111", color: "#fff", padding: 8, fontWeight: 900 }}>
              <span>TOTAL</span><span>{inv.total_amount}</span>
            </div>
          </div>
          <p style={{ fontSize: 12, color: "#6B7280" }}>Purchase {inv.purchase_id} · Shop {inv.shop_id} · {inv.status}</p>
        </div>
      )}
    </Shell>
  );
}

const miniLabel: CSSProperties = { fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#6B7280", fontWeight: 800 };
const totRow: CSSProperties = { display: "flex", justifyContent: "space-between", padding: "4px 0", fontWeight: 700 };

function buildAdminInvoiceHtml(inv: any): string {
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
  const seller = inv.seller || {};
  const bill = inv.bill_to || {};
  const item = inv.item || {};
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Invoice ${esc(inv.invoice_no)}</title>
  <style>
    body{font-family:Arial,sans-serif;color:#111;padding:24px}
    .seller{font-size:22px;font-weight:900}
    .meta{font-size:12px;color:#374151}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left;font-size:13px}
    th{border-bottom:2px solid #111;font-size:11px;text-transform:uppercase}
    .grand{background:#111;color:#fff;padding:10px;display:flex;justify-content:space-between;font-weight:900;margin-top:8px}
  </style></head><body>
  <div class="seller">${esc(seller.name)}</div>
  ${seller.address ? `<div class="meta">${esc(seller.address)}</div>` : ""}
  ${seller.phone ? `<div class="meta">Phone: ${esc(seller.phone)}</div>` : ""}
  ${seller.gstin ? `<div class="meta">GSTIN: ${esc(seller.gstin)}</div>` : ""}
  <h2>PURCHASE INVOICE</h2>
  <p><b>Invoice No:</b> ${esc(inv.invoice_no)}<br/><b>Invoice Date:</b> ${esc(String(inv.invoice_date || "").slice(0, 10))}</p>
  <p><b>Billing To:</b><br/>${esc(bill.name)}<br/>${esc(bill.address || "")}<br/>${esc(bill.phone || "")}<br/>${bill.gstin ? `GSTIN: ${esc(bill.gstin)}` : ""}</p>
  <table><thead><tr><th>Description</th><th>HSN/SAC</th><th>Bags</th><th>Rate</th><th>Amount</th></tr></thead>
  <tbody><tr>
    <td>${esc(item.description)}</td><td>${esc(item.hsn_sac_code)}</td>
    <td>${esc(item.bags)}</td><td>${esc(item.price_per_bag)}</td><td>${esc(item.amount)}</td>
  </tr></tbody></table>
  <p>Subtotal: ${esc(inv.subtotal)}<br/>GST (${esc(inv.gst_percent)}%): ${esc(inv.gst_amount)}</p>
  <div class="grand"><span>TOTAL AMOUNT</span><span>${esc(inv.total_amount)}</span></div>
  </body></html>`;
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

  const numberFields = ["price_per_bag", "new_merchant_free_bags", "gst_percent"] as const;
  const textFields = [
    ["hsn_sac_code", "HSN / SAC code (purchase invoices)"],
    ["invoice_prefix", "Invoice prefix (e.g. INV)"],
    ["invoice_item_description", "Invoice item description"],
    ["seller_name", "Seller / invoice from name"],
    ["seller_address", "Seller address"],
    ["seller_phone", "Seller phone"],
    ["seller_gstin", "Seller GSTIN"],
  ] as const;

  return (
    <Shell title="Settings">
      {error ? <ErrorBanner message={error} /> : null}
      {msg ? <div style={{ background: "#d1fae5", border: "2px solid #059669", padding: 8, marginBottom: 12 }}>{msg}</div> : null}
      {!form ? <Empty message="Loading…" /> : (
        <div style={{ maxWidth: 520, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 12, letterSpacing: 1, color: "#6B7280" }}>BAG BILLING</div>
          {numberFields.map((k) => (
            <label key={k} style={{ fontWeight: 700, fontSize: 12 }}>
              {k === "gst_percent" ? "GST % (default for new purchases)" : k}
              <input
                style={{ display: "block", width: "100%", border: "2px solid #111", padding: 8, marginTop: 4 }}
                value={form[k] ?? ""}
                onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })}
              />
            </label>
          ))}
          <label style={{ fontWeight: 700 }}>
            <input type="checkbox" checked={!!form.allow_test_payments} onChange={(e) => setForm({ ...form, allow_test_payments: e.target.checked })} /> Allow test payments
          </label>
          <label style={{ fontWeight: 700 }}>
            <input type="checkbox" checked={!!form.billing_active} onChange={(e) => setForm({ ...form, billing_active: e.target.checked })} /> Billing active
          </label>

          <div style={{ fontWeight: 800, fontSize: 12, letterSpacing: 1, color: "#6B7280", marginTop: 12 }}>PURCHASE INVOICE</div>
          <p style={{ margin: 0, fontSize: 12, color: "#6B7280" }}>
            GST % and HSN/SAC are configurable. Changing them affects new purchases / newly issued invoice snapshots — existing paid purchase amounts stay as stored.
          </p>
          {textFields.map(([k, label]) => (
            <label key={k} style={{ fontWeight: 700, fontSize: 12 }}>
              {label}
              <input
                style={{ display: "block", width: "100%", border: "2px solid #111", padding: 8, marginTop: 4 }}
                value={form[k] ?? ""}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </label>
          ))}
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

function ListShell({ title, s, columns, hideSearch }: { title: string; s: ReturnType<typeof useList>; columns: [string, string][]; hideSearch?: boolean }) {
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
              <tr key={row.id || row.shop_id || i}>
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

const table: CSSProperties = { width: "100%", borderCollapse: "collapse", background: "#fff", border: "2px solid #111" };
const th: CSSProperties = { textAlign: "left", borderBottom: "2px solid #111", padding: 8, fontSize: 12 };
const td: CSSProperties = { borderBottom: "1px solid #ddd", padding: 8, fontSize: 13 };
