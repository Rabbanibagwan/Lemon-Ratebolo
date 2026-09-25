/**
 * Purchase Invoice PDF — A4 document for a single bag purchase.
 * Uses expo-print HTML → real PDF (not a screenshot / not system thermal print).
 */
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";

export type PurchaseInvoiceParty = {
  name: string;
  address?: string;
  phone?: string;
  gstin?: string;
};

export type PurchaseInvoice = {
  purchase_id: string;
  shop_id: string;
  invoice_no: string;
  invoice_date: string;
  status: string;
  seller: PurchaseInvoiceParty;
  bill_to: PurchaseInvoiceParty;
  item: {
    description: string;
    hsn_sac_code: string;
    bags: number;
    price_per_bag: number;
    amount: number;
  };
  subtotal: number;
  gst_percent: number;
  gst_amount: number;
  total_amount: number;
  bags: number;
  price_per_bag: number;
  paid_at?: string | null;
  created_at?: string | null;
};

function esc(s: string): string {
  return String(s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

function money(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return String(iso).slice(0, 10);
  }
}

/** Professional A4 purchase invoice HTML (seller = platform, bill-to = merchant). */
export function renderPurchaseInvoiceHtml(inv: PurchaseInvoice): string {
  const seller = inv.seller || { name: "Lemon Mandi" };
  const billTo = inv.bill_to || { name: "Merchant" };
  const item = inv.item || {
    description: "Prepaid Mandi Bags",
    hsn_sac_code: "",
    bags: inv.bags,
    price_per_bag: inv.price_per_bag,
    amount: inv.subtotal,
  };
  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>Invoice ${esc(inv.invoice_no)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color:#111827; font-size:12px; }
  .wrap { border: 2px solid #111827; padding: 18px 20px; }
  .seller { font-size: 22px; font-weight: 900; letter-spacing: -0.3px; }
  .meta { font-size: 11px; color: #374151; margin-top: 2px; line-height: 1.4; }
  .kind { margin-top: 10px; font-size: 11px; letter-spacing: 2px; font-weight: 900; color: #6B7280; }
  .hr { border-top: 2px solid #111827; margin: 12px 0; }
  .row { display: flex; justify-content: space-between; gap: 24px; }
  .col { flex: 1; min-width: 0; }
  .label { font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: #6B7280; font-weight: 800; }
  .value { font-size: 13px; font-weight: 700; margin-top: 2px; }
  .value.big { font-size: 15px; font-weight: 900; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  thead th {
    text-align: left; font-size: 10px; letter-spacing: 1px; text-transform: uppercase;
    color: #6B7280; font-weight: 800; padding: 8px 4px; border-bottom: 2px solid #111827;
  }
  thead th.r, tbody td.r { text-align: right; }
  tbody td { padding: 8px 4px; border-bottom: 1px solid #D1D5DB; font-size: 12px; font-weight: 600; }
  .mono { font-family: Menlo, Consolas, monospace; }
  .totals { margin-top: 12px; margin-left: auto; width: 280px; }
  .trow { display: flex; justify-content: space-between; padding: 3px 0; font-size: 13px; font-weight: 700; }
  .grand {
    margin-top: 8px; background: #111827; color: #fff; padding: 10px 12px;
    display: flex; justify-content: space-between; align-items: center; font-weight: 900;
  }
  .grand .amt { font-family: Menlo, Consolas, monospace; font-size: 18px; }
  .foot { margin-top: 16px; font-size: 10px; color: #6B7280; text-align: center; }
  button, .no-print { display: none !important; }
</style></head><body>
<div class="wrap">
  <div class="seller">${esc((seller.name || "LEMON MANDI").toUpperCase())}</div>
  ${seller.address ? `<div class="meta">${esc(seller.address)}</div>` : ""}
  ${seller.phone ? `<div class="meta">Phone: ${esc(seller.phone)}</div>` : ""}
  ${seller.gstin ? `<div class="meta">GSTIN: ${esc(seller.gstin)}</div>` : ""}
  <div class="kind">PURCHASE INVOICE</div>
  <div class="hr"></div>
  <div class="row">
    <div class="col">
      <div class="label">Invoice No</div>
      <div class="value big mono">${esc(inv.invoice_no)}</div>
      <div class="label" style="margin-top:8px">Invoice Date</div>
      <div class="value">${esc(fmtDate(inv.invoice_date))}</div>
    </div>
    <div class="col">
      <div class="label">Billing To</div>
      <div class="value big">${esc(billTo.name || "—")}</div>
      ${billTo.address ? `<div class="meta">${esc(billTo.address)}</div>` : ""}
      ${billTo.phone ? `<div class="meta">${esc(billTo.phone)}</div>` : ""}
      ${billTo.gstin ? `<div class="meta">GSTIN: ${esc(billTo.gstin)}</div>` : ""}
    </div>
  </div>
  <div class="hr"></div>
  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>HSN/SAC</th>
        <th class="r">Bags/Qty</th>
        <th class="r">Price / Bag</th>
        <th class="r">Total</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${esc(item.description)}</td>
        <td class="mono">${esc(item.hsn_sac_code || "—")}</td>
        <td class="r mono">${Number(item.bags || 0).toLocaleString("en-IN")}</td>
        <td class="r mono">${money(item.price_per_bag)}</td>
        <td class="r mono">${money(item.amount)}</td>
      </tr>
    </tbody>
  </table>
  <div class="totals">
    <div class="trow"><span>Subtotal</span><span class="mono">${money(inv.subtotal)}</span></div>
    <div class="trow"><span>GST (${Number(inv.gst_percent || 0)}%)</span><span class="mono">${money(inv.gst_amount)}</span></div>
    <div class="grand"><span>TOTAL AMOUNT</span><span class="amt">${money(inv.total_amount)}</span></div>
  </div>
  <div class="foot">Linked to purchase ${esc(inv.purchase_id)} · Status ${esc(inv.status)}</div>
</div>
</body></html>`;
}

export async function sharePurchaseInvoicePdf(inv: PurchaseInvoice): Promise<"shared" | "downloaded"> {
  const html = renderPurchaseInvoiceHtml(inv);
  const { uri } = await Print.printToFileAsync({
    html,
    width: 595, // A4 pt
    height: 842,
  });
  if (!uri) throw new Error("Could not generate invoice PDF");
  const filename = `${(inv.invoice_no || "invoice").replace(/[^\w.\-]+/g, "_")}.pdf`;

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
      dialogTitle: `Invoice ${inv.invoice_no}`,
    });
    return "shared";
  }
  if (Platform.OS !== "web") {
    await Share.share({ url: uri, title: `Invoice ${inv.invoice_no}` });
    return "shared";
  }
  const res = await fetch(uri);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return "downloaded";
}
