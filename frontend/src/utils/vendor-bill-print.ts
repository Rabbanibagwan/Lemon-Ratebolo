/** Vendor Bill thermal + PDF print — bill data only, never app UI buttons. */
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Alert, Platform, Share } from "react-native";

import { ShopProfile, VendorBill } from "@/src/api";
import { printThermalDocument } from "@/src/utils/thermal-connection";
import { encodeVendorBillEscPos } from "@/src/utils/thermal-escpos-docs";
import { resolvePrintPaperMm } from "@/src/utils/printer-prefs";
import {
  thermalBaseCss,
  thermalMetrics,
} from "@/src/utils/thermal-print";

function fmt(n: number): string {
  return "₹" + (Number.isFinite(n) ? n : 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escapeHtml(s: string): string {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/** Shop Profile bank block — same fields as Vendor Bill screen. */
function bankLines(profile: ShopProfile): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (profile.bank_account_holder) rows.push({ label: "A/c Name", value: profile.bank_account_holder });
  if (profile.bank_account_number) rows.push({ label: "A/c No", value: profile.bank_account_number });
  if (profile.bank_ifsc) rows.push({ label: "IFSC", value: profile.bank_ifsc });
  if (profile.bank_name) rows.push({ label: "Bank", value: profile.bank_name });
  return rows;
}

function renderBankPdfHtml(profile: ShopProfile): string {
  const rows = bankLines(profile);
  if (!rows.length) return "";
  return `
    <div class="bank">
      <div class="bankTitle">BANK DETAILS</div>
      ${rows.map((r) => `<div class="bankRow"><span class="bk">${escapeHtml(r.label)}:</span> ${escapeHtml(r.value)}</div>`).join("")}
    </div>`;
}

function renderBankThermalHtml(profile: ShopProfile): string {
  const rows = bankLines(profile);
  if (!rows.length) return "";
  return `
    <div class="hr"></div>
    <div class="center bold">BANK DETAILS</div>
    ${rows.map((r) => `<div class="kv"><span class="k">${escapeHtml(r.label)}</span><span class="v wrap">${escapeHtml(r.value)}</span></div>`).join("")}
  `;
}

/** Digital PDF share layout (no Print/Share buttons). */
export function renderVendorBillPdfHtml(b: VendorBill, profile: ShopProfile, userName: string): string {
  const rows = b.lines.map((l) => `
    <tr>
      <td class="mono">${escapeHtml(l.lot_no)}</td>
      <td>${escapeHtml(l.farmer_name)}</td>
      <td class="mono right">${l.bags} × ${fmt(l.vendor_rate)}</td>
      <td class="mono right strong">${fmt(l.amount)}</td>
    </tr>`).join("");
  const addr = [profile.address, profile.village, profile.taluk, profile.district, profile.state].filter(Boolean).join(", ");
  const contact = [profile.mobile, profile.email].filter(Boolean).join(" · ");
  return `
  <!doctype html><html><head><meta charset="utf-8"/>
  <style>
    @page { margin: 20px; }
    body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color:#111827; }
    .card { border: 2px solid #111827; padding: 18px; }
    .shop { font-size:22px; font-weight:900; }
    .shopMeta { font-size:11px; color:#374151; margin-top:2px; }
    .kind { font-size:11px; letter-spacing:2px; color:#6B7280; font-weight:800; margin-top:2px; }
    .hr { border-top: 2px solid #111827; margin: 12px 0; }
    .meta { display:flex; justify-content: space-between; padding: 3px 0; }
    .mlabel { font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:#6B7280; font-weight:800; }
    .mvalue { font-size:13px; font-weight:700; }
    table { width:100%; border-collapse: collapse; margin-top:6px; }
    thead th { text-align:left; font-size:10px; letter-spacing:1px; color:#6B7280; padding: 6px 0; border-bottom:2px solid #111827; text-transform:uppercase; font-weight:800; }
    tbody td { padding: 4px 0; border-bottom: 1px dashed #D1D5DB; font-size: 12px; }
    .right { text-align: right; } .strong { font-weight: 800; } .mono { font-family: Menlo, monospace; }
    .trow { display:flex; justify-content:space-between; padding: 2px 0; font-size:12px; }
    .net { background:#111827; color:#fff; padding: 10px 12px; display:flex; justify-content:space-between; margin-top:8px; }
    .netl { font-size:12px; font-weight:900; letter-spacing:1.5px; }
    .netv { font-family: Menlo, monospace; font-weight:900; font-size:22px; }
    .bank { border:2px solid #111827; padding:8px 10px; margin-top:10px; font-size:12px; color:#111827; }
    .bankTitle { font-size:10px; letter-spacing:1.5px; font-weight:900; margin-bottom:6px; }
    .bankRow { padding: 2px 0; font-weight:700; }
    .bk { font-weight:800; }
    .notes { border:2px solid #111827; padding:8px 10px; margin-top:8px; font-size:11px; }
    .foot { margin-top:10px; font-size:10px; color:#6B7280; text-align:center; }
    button, .no-print { display:none !important; }
  </style></head><body>
  <div class="card">
    <div class="shop">${escapeHtml((profile.shop_name || "").toUpperCase())}</div>
    ${addr ? `<div class="shopMeta">${escapeHtml(addr)}</div>` : ""}
    ${contact ? `<div class="shopMeta">${escapeHtml(contact)}</div>` : ""}
    ${profile.gst_number ? `<div class="shopMeta">GSTIN: ${escapeHtml(profile.gst_number)}</div>` : ""}
    <div class="kind">VENDOR BILL</div>
    <div class="hr"></div>
    <div class="meta"><span class="mlabel">Bill</span><span class="mvalue">${escapeHtml(b.bill_code)}</span></div>
    <div class="meta"><span class="mlabel">Vendor</span><span class="mvalue">${escapeHtml(b.vendor_name)}</span></div>
    ${b.vendor_details ? `<div class="meta"><span class="mlabel">Details</span><span class="mvalue">${escapeHtml(b.vendor_details)}</span></div>` : ""}
    <div class="meta"><span class="mlabel">Date</span><span class="mvalue">${escapeHtml(b.date)}</span></div>
    <div class="hr"></div>
    <table>
      <thead><tr><th>LOT</th><th>FARMER</th><th class="right">BAGS × RATE</th><th class="right">AMOUNT</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:10px">
      <div class="trow"><span>Goods</span><span class="mono">${fmt(b.goods_total)}</span></div>
      <div class="trow"><span>Commission</span><span class="mono">${fmt(b.commission_total)}</span></div>
      <div class="trow"><span>Hamali</span><span class="mono">${fmt(b.hamali)}</span></div>
      ${b.cess > 0 ? `<div class="trow"><span>Cess / Other</span><span class="mono">${fmt(b.cess)}</span></div>` : ""}
    </div>
    <div class="net"><div class="netl">GRAND TOTAL</div><div class="netv">${fmt(b.grand_total)}</div></div>
    <div class="trow" style="margin-top:8px"><span>Paid</span><span class="mono">${fmt(b.paid)}</span></div>
    <div class="trow"><span class="strong">Balance Due</span><span class="mono strong">${fmt(b.balance)}</span></div>
    ${renderBankPdfHtml(profile)}
    ${b.notes ? `<div class="notes">Notes: ${escapeHtml(b.notes)}</div>` : ""}
  </div>
  <div class="foot">Generated by ${escapeHtml(userName)} · ${new Date().toLocaleString("en-IN")} · ${escapeHtml(b.bill_code)}</div>
  </body></html>`;
}

/** Thermal Vendor Bill for 58 / 80 / 100 mm — no app UI. */
export function renderThermalVendorBillHtml(b: VendorBill, profile: ShopProfile, paperMm: number = 80): string {
  const m = thermalMetrics(paperMm);
  const addr = [profile.address, profile.village, profile.taluk, profile.district, profile.state].filter(Boolean).join(", ");
  const lines = b.lines.map((l) => `
    <div class="row">
      <span class="lot">${escapeHtml(l.lot_no)}</span>
      <span class="mid wrap">${escapeHtml(l.farmer_name)} · ${l.bags}×${fmt(l.vendor_rate)}</span>
      <span class="right">${fmt(l.amount)}</span>
    </div>`).join("");
  return `
  <!doctype html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=${m.widthPx}, initial-scale=1, maximum-scale=1"/>
  <title>${escapeHtml(b.bill_code)}</title>
  <style>${thermalBaseCss(m)}</style></head><body>
  <div id="slip">
    <div class="center big bold wrap">${escapeHtml((profile.shop_name || "").toUpperCase())}</div>
    ${addr ? `<div class="center wrap">${escapeHtml(addr)}</div>` : ""}
    ${profile.mobile ? `<div class="center">${escapeHtml(profile.mobile)}</div>` : ""}
    <div class="center bold">VENDOR BILL</div>
    <div class="hr"></div>
    <div class="kv"><span class="k">Bill</span><span class="bold">${escapeHtml(b.bill_code)}</span></div>
    <div class="kv"><span class="k">Date</span><span>${escapeHtml(b.date)}</span></div>
    <div class="kv vendor"><span class="k">Vendor</span><span class="bold v wrap">${escapeHtml(b.vendor_name)}</span></div>
    ${b.vendor_details ? `<div class="kv"><span class="k">Details</span><span class="wrap">${escapeHtml(b.vendor_details)}</span></div>` : ""}
    <div class="hr"></div>
    <div class="row th"><span class="lot">LOT</span><span class="mid">DETAIL</span><span class="right">AMOUNT</span></div>
    ${lines}
    <div class="hr"></div>
    <div class="kv"><span>Bags</span><span>${b.total_bags}</span></div>
    <div class="kv"><span>Goods</span><span>${fmt(b.goods_total)}</span></div>
    <div class="kv"><span>Commission</span><span>${fmt(b.commission_total)}</span></div>
    <div class="kv"><span>Hamali</span><span>${fmt(b.hamali)}</span></div>
    ${b.cess > 0 ? `<div class="kv"><span>Cess</span><span>${fmt(b.cess)}</span></div>` : ""}
    <div class="netbox"><span class="bold">TOTAL</span><span class="huge">${fmt(b.grand_total)}</span></div>
    <div class="kv"><span>Paid</span><span>${fmt(b.paid)}</span></div>
    <div class="kv bold"><span>Balance</span><span>${fmt(b.balance)}</span></div>
    ${renderBankThermalHtml(profile)}
    ${b.notes ? `<div class="center wrap" style="margin-top:4px">${escapeHtml(b.notes)}</div>` : ""}
  </div>
  </body></html>`;
}

export async function thermalPrintVendorBill(
  b: VendorBill,
  profile: ShopProfile,
  paperMm?: number,
): Promise<void> {
  const mm = await resolvePrintPaperMm(paperMm);
  const html = renderThermalVendorBillHtml(b, profile, mm);
  await printThermalDocument({
    html,
    escposBase64: encodeVendorBillEscPos(b, profile, mm),
    paperMm: mm,
  });
}

export async function shareVendorBillPdf(
  b: VendorBill,
  profile: ShopProfile,
  userName: string,
): Promise<void> {
  const html = renderVendorBillPdfHtml(b, profile, userName);
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: ".pdf", dialogTitle: `Bill ${b.bill_code}` });
  } else if (Platform.OS !== "web") {
    await Share.share({ url: uri, title: `Bill ${b.bill_code}` });
  } else {
    Alert.alert("PDF ready", uri);
  }
}
