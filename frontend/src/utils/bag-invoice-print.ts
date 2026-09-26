/** Bag Balance purchase tax invoice — PDF from real purchase invoice payload. */
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";

import type { BagInvoice } from "@/src/api";
import { showInPageThermalPreview } from "@/src/utils/thermal-print";

function fmt(n: number): string {
  return "₹" + (Number.isFinite(n) ? n : 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(s: string): string {
  return String(s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
    const dd = String(d.getDate()).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${dd}-${months[d.getMonth()]}-${d.getFullYear()}`;
  } catch {
    return String(iso).slice(0, 10);
  }
}

function gstRowsHtml(inv: BagInvoice): string {
  const supply = (inv.gst_supply_type || "").toUpperCase();
  const cgstAmt = Number(inv.cgst_amount) || 0;
  const sgstAmt = Number(inv.sgst_amount) || 0;
  const igstAmt = Number(inv.igst_amount) || 0;
  const cgstPct = Number(inv.cgst_percent) || 0;
  const sgstPct = Number(inv.sgst_percent) || 0;
  const igstPct = Number(inv.igst_percent) || 0;
  const gstPct = Number(inv.gst_percent) || 0;
  const gstAmt = Number(inv.gst_amount) || 0;

  if (supply === "INTER" || igstAmt > 0) {
    return `<div class="trow"><span>IGST (${igstPct || gstPct}%)</span><span class="mono">${fmt(igstAmt || gstAmt)}</span></div>`;
  }
  if (cgstAmt > 0 || sgstAmt > 0 || supply === "INTRA") {
    return (
      `<div class="trow"><span>CGST (${cgstPct || gstPct / 2}%)</span><span class="mono">${fmt(cgstAmt)}</span></div>` +
      `<div class="trow"><span>SGST (${sgstPct || gstPct / 2}%)</span><span class="mono">${fmt(sgstAmt)}</span></div>`
    );
  }
  // Legacy payloads without split fields.
  return `<div class="trow"><span>GST (${gstPct}%)</span><span class="mono">${fmt(gstAmt)}</span></div>`;
}

export function renderBagInvoiceHtml(inv: BagInvoice): string {
  const to = inv.billing_to || ({} as BagInvoice["billing_to"]);
  const seller = inv.seller || {};
  const brand = (seller.brand || seller.name || "LEMON MANDI").trim() || "LEMON MANDI";
  const legal = (seller.legal_name || "").trim();
  const addrLines = Array.isArray(seller.address_lines)
    ? seller.address_lines.map((l) => String(l || "").trim()).filter(Boolean)
    : [];
  const gstin = (seller.gstin || "").trim();
  const bags = Number(inv.bags) || 0;
  const price = Number(inv.price_per_bag) || 0;
  const base = Number(inv.base_amount) || 0;
  const total = Number(inv.total_amount) || 0;
  const hsn = (inv.service_hsn_code || "").trim() || "—";
  const addr = (to.address || "").trim();
  const contact = [to.mobile, to.email].filter(Boolean).join(" · ");

  return `<!doctype html><html><head><meta charset="utf-8"/>
  <title>${escapeHtml(inv.invoice_number || "Invoice")}</title>
  <style>
    @page { margin: 18mm; }
    body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color:#111827; margin:0; }
    .card { border: 2px solid #111827; padding: 18px; max-width: 720px; margin: 0 auto; }
    .brand { font-size: 22px; font-weight: 900; letter-spacing: 0.5px; }
    .legal { font-size: 12px; font-weight: 700; margin-top: 4px; }
    .metaMuted { font-size: 11px; color:#374151; margin-top:2px; }
    .kind { font-size:11px; letter-spacing:2px; color:#6B7280; font-weight:800; margin-top:10px; }
    .hr { border-top: 2px solid #111827; margin: 12px 0; }
    .grid { display:flex; gap:16px; }
    .col { flex:1; }
    .label { font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:#6B7280; font-weight:800; }
    .value { font-size:13px; font-weight:700; margin-top:2px; }
    table { width:100%; border-collapse:collapse; margin-top:10px; }
    thead th { text-align:left; font-size:10px; letter-spacing:1px; color:#6B7280; padding:8px 4px; border-bottom:2px solid #111827; text-transform:uppercase; font-weight:800; }
    tbody td { padding:8px 4px; border-bottom:1px dashed #D1D5DB; font-size:13px; }
    .right { text-align:right; } .mono { font-family: Menlo, Consolas, monospace; }
    .totals { margin-top:12px; }
    .trow { display:flex; justify-content:space-between; padding:3px 0; font-size:13px; font-weight:700; }
    .net { background:#111827; color:#fff; padding:10px 12px; display:flex; justify-content:space-between; margin-top:8px; }
    .netl { font-size:12px; font-weight:900; letter-spacing:1.5px; }
    .netv { font-family: Menlo, Consolas, monospace; font-weight:900; font-size:20px; }
    .foot { margin-top:14px; font-size:10px; color:#6B7280; text-align:center; }
    button, .no-print { display:none !important; }
  </style></head><body>
  <div class="card">
    <div class="brand">${escapeHtml(brand)}</div>
    ${legal ? `<div class="legal">${escapeHtml(legal)}</div>` : ""}
    ${addrLines.map((l) => `<div class="metaMuted">${escapeHtml(l)}</div>`).join("")}
    ${gstin ? `<div class="metaMuted">GSTIN: ${escapeHtml(gstin)}</div>` : ""}
    <div class="kind">TAX INVOICE — BAG BALANCE</div>
    <div class="hr"></div>
    <div class="grid">
      <div class="col">
        <div class="label">Invoice No</div>
        <div class="value mono">${escapeHtml(inv.invoice_number || "—")}</div>
        <div class="label" style="margin-top:8px">Invoice Date</div>
        <div class="value">${escapeHtml(fmtDate(inv.invoice_date))}</div>
        ${inv.payment_ref ? `<div class="label" style="margin-top:8px">Payment Ref</div><div class="value mono">${escapeHtml(inv.payment_ref)}</div>` : ""}
      </div>
      <div class="col">
        <div class="label">Billing To</div>
        <div class="value">${escapeHtml((to.shop_name || "").toUpperCase() || "—")}</div>
        ${to.owner_name ? `<div class="metaMuted">Owner: ${escapeHtml(to.owner_name)}</div>` : ""}
        ${to.username ? `<div class="metaMuted">@${escapeHtml(to.username)}</div>` : ""}
        ${addr ? `<div class="metaMuted">${escapeHtml(addr)}</div>` : ""}
        ${contact ? `<div class="metaMuted">${escapeHtml(contact)}</div>` : ""}
        ${to.gst_number ? `<div class="metaMuted">GSTIN: ${escapeHtml(to.gst_number)}</div>` : ""}
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th>HSN/SAC</th>
          <th class="right">Qty</th>
          <th class="right">Rate</th>
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(inv.line_description || `Prepaid bag balance — ${bags} bags`)}</td>
          <td class="mono">${escapeHtml(hsn)}</td>
          <td class="right mono">${bags.toLocaleString("en-IN")}</td>
          <td class="right mono">${fmt(price)}</td>
          <td class="right mono"><strong>${fmt(base)}</strong></td>
        </tr>
      </tbody>
    </table>
    <div class="totals">
      <div class="trow"><span>Bags × Price</span><span class="mono">${bags.toLocaleString("en-IN")} × ${fmt(price)} = ${fmt(base)}</span></div>
      <div class="trow"><span>Taxable Amount</span><span class="mono">${fmt(base)}</span></div>
      ${gstRowsHtml(inv)}
      <div class="net"><span class="netl">TOTAL AMOUNT</span><span class="netv">${fmt(total)}</span></div>
    </div>
    <div class="foot">Generated from Bag Balance purchase ${escapeHtml(inv.purchase_id || "")}. Status: ${escapeHtml(inv.status || "")}.</div>
  </div>
  </body></html>`;
}

export async function shareBagInvoicePdf(inv: BagInvoice): Promise<void> {
  const html = renderBagInvoiceHtml(inv);
  const filename = `${(inv.invoice_number || "bag-invoice").replace(/[^\w.-]+/g, "_")}.pdf`;

  if (Platform.OS === "web") {
    try {
      const { uri } = await Print.printToFileAsync({ html });
      const res = await fetch(uri);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      return;
    } catch {
      showInPageThermalPreview(html, inv.invoice_number || "Invoice");
      return;
    }
  }

  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      UTI: ".pdf",
      dialogTitle: inv.invoice_number || "Bag Invoice",
    });
  } else {
    await Share.share({ url: uri, message: inv.invoice_number || "Bag Invoice" });
  }
}

export async function previewBagInvoice(inv: BagInvoice): Promise<void> {
  const html = renderBagInvoiceHtml(inv);
  if (Platform.OS === "web") {
    showInPageThermalPreview(html, inv.invoice_number || "Invoice");
    return;
  }
  await Print.printAsync({ html });
}
