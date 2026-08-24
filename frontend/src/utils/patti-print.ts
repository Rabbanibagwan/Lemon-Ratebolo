// Patti print utilities — dedicated thermal receipt HTML (never app UI).
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Alert, Platform, Share } from "react-native";

import { api, Patti, Session, ShopProfile } from "@/src/api";
import { qrDataUri, qrDataUriThermal } from "@/src/utils/qr";
import { printThermalDocument } from "@/src/utils/thermal-connection";
import { encodeFarmerPattiEscPos } from "@/src/utils/thermal-escpos-docs";
import { resolvePrintPaperMm } from "@/src/utils/printer-prefs";
import {
  thermalBaseCss,
  thermalMetrics,
} from "@/src/utils/thermal-print";

/** True when this staff user has already printed this Patti (server-tracked). */
export function staffHasPrintedPatti(p: Patti | null | undefined, session: Session | null | undefined): boolean {
  if (!p || !session || session.role !== "counter") return false;
  const uid = (session.id || "").trim();
  if (!uid) return false;
  return (p.staff_print_user_ids || []).includes(uid);
}

/** Merchant: always. Staff: only if they have not printed this Patti yet. */
export function canUserPrintPatti(p: Patti | null | undefined, session: Session | null | undefined): boolean {
  if (!p || !session) return false;
  if (session.role === "owner") return true;
  if (session.role !== "counter") return false;
  return !staffHasPrintedPatti(p, session);
}

/**
 * Entry Book / reports view: staff may only view. Create flows (Save & Print) still
 * use canUserPrintPatti for the single allowed print.
 */
export function canUserPrintPattiOnScreen(
  p: Patti | null | undefined,
  session: Session | null | undefined,
  screen?: string | null,
): boolean {
  if (!canUserPrintPatti(p, session)) return false;
  if (session?.role === "counter" && (screen || "").trim().toLowerCase() === "entry") return false;
  return true;
}

/** Merchant may share. Staff must never share a Farmer Patti. */
export function canUserSharePatti(session: Session | null | undefined): boolean {
  return session?.role === "owner";
}

export function staffPrintBlockedMessage(): string {
  return "This Patti was already printed. Staff may print each Patti only once.";
}

export function staffShareBlockedMessage(): string {
  return "Staff cannot share Farmer Pattis.";
}

export function fmt(n: number): string {
  return "₹" + (Number.isFinite(n) ? n : 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/** A4-style PDF for digital share only (no app buttons). */
export function renderPattiHtml(p: Patti, profile: ShopProfile, qrUri: string, userName: string, detailed: boolean = false): string {
  const date = new Date(p.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  const rows = p.lots.map((lot) =>
    lot.sales.map((s, i) => `
      <tr>
        <td class="mono lotEmph">${i === 0 ? escapeHtml(lot.lot_no) : ""}</td>
        <td class="mono right"><span class="bagsEmph">${s.bags}</span> × ${fmt(s.rate_per_bag * p.payment_factor)}</td>
        <td class="mono right strong">${fmt(s.bags * s.rate_per_bag * p.payment_factor)}</td>
      </tr>`).join("")
  ).join("");
  const addr = [profile.address, profile.village, profile.taluk, profile.district, profile.state]
    .filter(Boolean).join(", ");
  const mobile = (profile.mobile || "").trim();
  const email = (profile.email || "").trim();
  return `
  <!doctype html><html><head><meta charset="utf-8"/>
  <style>
    @page { margin: 20px; }
    body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color:#111827; }
    .card { border: 2px solid #111827; padding: 18px; }
    .head { display:flex; justify-content:space-between; align-items:flex-start; }
    .shop { font-size:22px; font-weight:900; letter-spacing:-0.5px; }
    .shopMeta { font-size:11px; color:#374151; margin-top:2px; line-height:1.4; }
    .kind { font-size:11px; letter-spacing:2px; color:#6B7280; font-weight:800; margin-top:2px; }
    .numBox { border:2px solid #111827; padding: 6px 12px; text-align:right; }
    .numLabel { font-size:9px; letter-spacing:1px; color:#6B7280; font-weight:800; }
    .num { font-family: Menlo, monospace; font-size:20px; font-weight:800; }
    .hr { border-top: 2px solid #111827; margin: 12px 0; }
    .meta { display:flex; justify-content: space-between; align-items:center; padding: 3px 0; }
    .meta.farmer { flex-direction: row; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; padding: 6px 0; }
    .meta.farmer .mvalue.farmer { text-align: right; flex: 1; min-width: 0; word-break: break-word; }
    .mlabel { font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:#6B7280; font-weight:800; }
    .mvalue { font-size:13px; font-weight:700; }
    .mvalue.farmer {
      font-size:22px; font-weight:900; letter-spacing:-0.3px; line-height:1.15;
      flex: 1; min-width: 0; word-break: break-word; overflow-wrap: anywhere;
    }
    table { width:100%; border-collapse: collapse; margin-top:6px; }
    thead th { text-align:left; font-size:10px; letter-spacing:1px; color:#6B7280; padding: 6px 0; border-bottom:2px solid #111827; text-transform:uppercase; font-weight:800; }
    tbody td { padding: 4px 0; border-bottom: 1px dashed #D1D5DB; font-size: 12px; }
    .right { text-align: right; } .strong { font-weight: 800; } .mono { font-family: Menlo, monospace; }
    .lotEmph { font-size: 15px; font-weight: 900; }
    .bagsEmph { font-size: 15px; font-weight: 900; }
    .trow { display:flex; justify-content:space-between; padding: 2px 0; font-size:12px; }
    .net { background:#111827; color:#fff; padding: 10px 12px; display:flex; justify-content:space-between; align-items:center; margin-top:8px; }
    .netl { font-size:12px; font-weight:900; letter-spacing:1.5px; }
    .netv { font-family: Menlo, monospace; font-weight:900; font-size:22px; }
    .qr { display:flex; align-items:center; gap:12px; border:2px solid #111827; padding: 10px; margin-top:14px; }
    .qr img { width:110px; height:110px; }
    .qrLbl { font-size:10px; letter-spacing:1.5px; color:#6B7280; font-weight:800; }
    .qrHint { font-size:11px; color:#374151; margin-top:2px; }
    .rec { display:flex; justify-content:space-between; align-items:center; padding: 6px 10px; border:2px solid #111827; margin-top: 8px; }
    .recL { font-size:10px; letter-spacing:1.5px; color:#6B7280; font-weight:800; }
    .recV { font-size:14px; font-weight:800; }
    .foot { margin-top:10px; font-size:10px; color:#6B7280; text-align:center; }
    button, .no-print { display:none !important; }
  </style></head><body>
  <div class="card">
    <div class="head">
      <div>
        <div class="shop">${escapeHtml((profile.shop_name || "").toUpperCase())}</div>
        ${addr ? `<div class="shopMeta">${escapeHtml(addr)}</div>` : ""}
        ${mobile ? `<div class="shopMeta">Mobile: ${escapeHtml(mobile)}</div>` : ""}
        ${email ? `<div class="shopMeta">${escapeHtml(email)}</div>` : ""}
        ${profile.gst_number ? `<div class="shopMeta">GSTIN: ${escapeHtml(profile.gst_number)}</div>` : ""}
        <div class="kind">PATTI / BILL</div>
      </div>
      <div class="numBox"><div class="numLabel">NO.</div><div class="num">${p.patti_no}</div></div>
    </div>
    <div class="hr"></div>
    <div class="meta farmer"><span class="mlabel">FARMER</span><span class="mvalue farmer">${escapeHtml(p.farmer_name)}</span></div>
    <div class="meta"><span class="mlabel">DATE</span><span class="mvalue">${date}</span></div>
    ${p.driver_name ? `<div class="meta"><span class="mlabel">DRIVER</span><span class="mvalue">${escapeHtml(p.driver_name)}${p.driver_place ? " · " + escapeHtml(p.driver_place) : ""}</span></div>` : ""}
    <div class="hr"></div>
    <table>
      <thead><tr><th>LOT</th><th class="right">BAGS × RATE</th><th class="right">AMOUNT</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:10px">
      <div class="trow"><span>Gross total</span><span class="mono strong">${fmt(p.farmer_gross)}</span></div>
      <div class="trow"><span>${detailed ? `Hamali (${p.total_bags} × ${fmt(p.hamali_per_bag)})` : "Hamali"}</span><span class="mono">− ${fmt(p.hamali_total)}</span></div>
      <div class="trow"><span>Bhada</span><span class="mono">− ${fmt(p.bhada_total)}</span></div>
      <div class="trow"><span>Stationery</span><span class="mono">− ${fmt(p.stationery_total)}</span></div>
      <div class="trow"><span class="strong">Total deduction</span><span class="mono strong">− ${fmt(p.deductions_total)}</span></div>
    </div>
    <div class="net"><div class="netl">NET PAYABLE</div><div class="netv">${fmt(p.net_payable)}</div></div>
    <div class="rec"><div><div class="recL">RECEIVER</div><div class="recV">${escapeHtml(p.receiver_name || "—")}</div></div></div>
    <div class="qr">
      <img src="${qrUri}"/>
      <div><div class="qrLbl">SCAN AT PAYMENT COUNTER</div><div class="qrHint">Scan this QR to open Patti #${p.patti_no} and update receiver name.</div></div>
    </div>
  </div>
  <div class="foot">Generated by ${escapeHtml(userName)} · ${new Date().toLocaleString("en-IN")} · Patti #${p.patti_no}</div>
  </body></html>`;
}

/** 58 / 80 / 100 mm thermal receipt — bill data only (no Print/Share UI). */
export function renderThermalPattiHtml(
  p: Patti,
  profile: ShopProfile,
  qrUri: string,
  paperMm: number = 80,
  detailed: boolean = false,
): string {
  const m = thermalMetrics(paperMm);
  const date = new Date(p.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const lines = p.lots.map((lot) =>
    lot.sales.map((s, i) => `
      <div class="row">
        <span class="lot">${i === 0 ? escapeHtml(String(lot.lot_no || `${lot.lot_serial_no}/${lot.total_bags}`)) : ""}</span>
        <span class="mid"><span class="bags">${s.bags}</span> × ${fmt(s.rate_per_bag * p.payment_factor)}</span>
        <span class="right">${fmt(s.bags * s.rate_per_bag * p.payment_factor)}</span>
      </div>`).join(""),
  ).join("");
  const addr = [profile.address, profile.village, profile.taluk, profile.district, profile.state].filter(Boolean).join(", ");
  // Preserve merchant shop name casing exactly as entered (do not force UPPERCASE).
  const shop = (profile.shop_name || "").trim();
  const mobile = (profile.mobile || "").trim();
  return `
  <!doctype html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=${m.widthPx}, initial-scale=1, maximum-scale=1"/>
  <title>Patti #${p.patti_no}</title>
  <style>${thermalBaseCss(m)}</style></head><body>
  <div id="slip" class="patti">
    ${shop ? `<div class="center shop wrap">${escapeHtml(shop)}</div>` : ""}
    ${addr ? `<div class="center addr wrap">${escapeHtml(addr)}</div>` : ""}
    ${mobile ? `<div class="center addr">Mobile: ${escapeHtml(mobile)}</div>` : ""}
    <div class="hr"></div>
    <div class="kv"><span class="k">Patti / Bill</span><span class="bold patti-no">No. ${p.patti_no}</span></div>
    <div class="hr"></div>
    <div class="kv farmer"><span class="k">Farmer</span><span class="bold v wrap">${escapeHtml(p.farmer_name)}</span></div>
    <div class="kv"><span class="k">Date</span><span class="v">${date}</span></div>
    ${p.driver_name
      ? `<div class="kv driver"><span class="k">Driver</span><span class="v wrap">${escapeHtml(p.driver_name)}${p.driver_place ? " · " + escapeHtml(p.driver_place) : ""}</span></div>`
      : ""}
    <div class="hr"></div>
    <div class="row th"><span class="lot">Lot</span><span class="mid">Bags × Rate</span><span class="right">Amount</span></div>
    ${lines}
    <div class="hr"></div>
    <div class="kv"><span>Gross total</span><span>${fmt(p.farmer_gross)}</span></div>
    <div class="kv deduct"><span>${detailed ? `Hamali (${p.total_bags} × ${fmt(p.hamali_per_bag)})` : "Hamali"}</span><span>- ${fmt(p.hamali_total)}</span></div>
    <div class="kv deduct"><span>Bhada</span><span>- ${fmt(p.bhada_total)}</span></div>
    <div class="kv deduct"><span>Stationery</span><span>- ${fmt(p.stationery_total)}</span></div>
    <div class="kv deduct-total"><span>Total deduction</span><span>- ${fmt(p.deductions_total)}</span></div>
    <div class="netbox"><span class="bold">Net payable</span><span class="huge">${fmt(p.net_payable)}</span></div>
    <div class="kv"><span class="k">Receiver</span><span class="bold wrap">${escapeHtml(p.receiver_name || "—")}</span></div>
    ${qrUri
      ? `<img class="qr" src="${qrUri}" alt="QR"/><div class="center addr">Scan at counter</div>`
      : ""}
  </div>
  </body></html>`;
}

export async function thermalPrintPatti(
  p: Patti,
  profile: ShopProfile,
  paperMm?: number,
  detailed: boolean = false,
): Promise<void> {
  const mm = await resolvePrintPaperMm(paperMm);
  const m = thermalMetrics(mm);
  // Always generate QR — previous working format required it on the slip.
  const qrUri = await qrDataUriThermal(p.qr_token, Math.max(220, m.qrPx * 2));
  const html = renderThermalPattiHtml(p, profile, qrUri, mm, detailed);
  await printThermalDocument({
    html,
    escposBase64: encodeFarmerPattiEscPos(p, profile, mm, p.qr_token, detailed),
    paperMm: mm,
  });
}

export async function markPattiPrinted(pattiId: string): Promise<Patti> {
  return api.post<Patti>(`/pattis/${pattiId}/mark-printed`, {});
}

export async function thermalPrintAndMark(
  p: Patti,
  profile: ShopProfile,
  paperMm: number = 80,
  session?: Session | null,
  detailed: boolean = false,
): Promise<Patti> {
  if (session && !canUserPrintPatti(p, session)) {
    throw new Error(staffPrintBlockedMessage());
  }
  await thermalPrintPatti(p, profile, paperMm, detailed);
  // Only mark after the print path returned without throwing.
  return markPattiPrinted(p.id);
}

export async function sharePattiPdf(
  p: Patti,
  profile: ShopProfile,
  userName: string,
  detailed: boolean = false,
  session?: Session | null,
): Promise<void> {
  if (session && !canUserSharePatti(session)) {
    throw new Error(staffShareBlockedMessage());
  }
  const qrUri = await qrDataUri(p.qr_token, 260);
  const html = renderPattiHtml(p, profile, qrUri, userName, detailed);
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: ".pdf", dialogTitle: `Patti #${p.patti_no}` });
  } else if (Platform.OS !== "web") {
    await Share.share({ url: uri, title: `Patti #${p.patti_no}` });
  } else {
    const res = await fetch(uri);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Patti_${p.patti_no}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}
