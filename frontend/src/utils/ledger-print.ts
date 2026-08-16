/** Account Ledger PDF share + dedicated thermal print (never app UI). */
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Alert, Platform, Share } from "react-native";

import { LedgerDetail } from "@/src/api";
import { printThermalDocument } from "@/src/utils/thermal-connection";
import { encodeLedgerEscPos } from "@/src/utils/thermal-escpos-docs";
import { resolvePrintPaperMm } from "@/src/utils/printer-prefs";
import {
  thermalBaseCss,
  thermalMetrics,
} from "@/src/utils/thermal-print";

function escapeHtml(s: string): string {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function fmt(n: number): string {
  return "₹" + (Number.isFinite(n) ? n : 0).toLocaleString("en-IN", { maximumFractionDigits: 0, minimumFractionDigits: 0 });
}

function dashAmt(n: number): string {
  return n > 0.0001 ? fmt(n) : "-";
}

function dayNum(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? String(Number(m[3])) : iso;
}

function thermalDateLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return iso;
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${m[3]} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

function displayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function renderLedgerPdfHtml(d: LedgerDetail): string {
  const kind = d.account_type === "FARMER" ? "FARMER" : "VENDOR";
  const rows = d.rows.map((r) => `
    <tr>
      <td>${escapeHtml(displayDate(r.date))}</td>
      <td>${escapeHtml(r.description)}${r.remarks ? `<div class="muted">${escapeHtml(r.remarks)}</div>` : ""}</td>
      <td class="mono right">${r.credit > 0 ? fmt(r.credit) : "-"}</td>
      <td class="mono right">${r.debit > 0 ? fmt(r.debit) : "-"}</td>
      <td class="mono right strong">${fmt(r.balance)}</td>
    </tr>`).join("");
  const billBlock = d.account_type === "VENDOR" && d.bills.length
    ? d.bills.map((b) => `
      <div class="bill">
        <div class="trow"><span>Vendor Bill</span><span class="mono">${escapeHtml(b.bill_code)}</span></div>
        <div class="trow"><span>Paid Amount</span><span class="mono">${fmt(b.paid)}</span></div>
        <div class="trow"><span>Balance</span><span class="mono">${fmt(b.balance)}</span></div>
        <div class="trow"><span>Status</span><span>${escapeHtml((b.status || "").toUpperCase())}</span></div>
      </div>`).join("")
    : "";
  return `
  <!doctype html><html><head><meta charset="utf-8"/>
  <style>
    @page { margin: 20px; }
    body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color:#111827; }
    .card { border: 2px solid #111827; padding: 18px; }
    .kind { font-size:11px; letter-spacing:2px; color:#6B7280; font-weight:800; }
    .title { font-size:22px; font-weight:900; letter-spacing:-0.4px; }
    .hr { border-top: 2px solid #111827; margin: 12px 0; }
    .meta { display:flex; justify-content:space-between; padding: 3px 0; }
    .mlabel { font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:#6B7280; font-weight:800; }
    .mvalue { font-size:15px; font-weight:800; }
    table { width:100%; border-collapse: collapse; margin-top:6px; }
    thead th { text-align:left; font-size:10px; letter-spacing:1px; color:#6B7280; padding: 6px 0; border-bottom:2px solid #111827; text-transform:uppercase; font-weight:800; }
    tbody td { padding: 6px 4px 6px 0; border-bottom: 1px dashed #D1D5DB; font-size: 12px; vertical-align: top; }
    .right { text-align: right; } .strong { font-weight: 800; } .mono { font-family: Menlo, monospace; }
    .muted { font-size:10px; color:#6B7280; font-weight:600; }
    .trow { display:flex; justify-content:space-between; padding: 2px 0; font-size:12px; }
    .bill { border:2px solid #111827; padding: 8px 10px; margin-top: 8px; }
    .net { background:#111827; color:#fff; padding: 10px 12px; display:flex; justify-content:space-between; margin-top:8px; }
    .netl { font-size:12px; font-weight:900; letter-spacing:1.5px; }
    .netv { font-family: Menlo, monospace; font-weight:900; font-size:20px; }
    button, .no-print { display:none !important; }
  </style></head><body>
  <div class="card">
    <div class="kind">ACCOUNT LEDGER</div>
    <div class="title">${kind}</div>
    <div class="hr"></div>
    <div class="meta"><span class="mlabel">${kind === "FARMER" ? "Farmer Name" : "Vendor Name"}</span><span class="mvalue">${escapeHtml(d.party_name)}</span></div>
    <div class="meta"><span class="mlabel">Date</span><span class="mvalue">${escapeHtml(displayDate(d.date))}</span></div>
    <div class="hr"></div>
    <table>
      <thead><tr><th>Date</th><th>Details</th><th class="right">Credit</th><th class="right">Debit</th><th class="right">Balance</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5">No transactions</td></tr>`}</tbody>
    </table>
    ${billBlock}
    <div class="hr"></div>
    <div class="trow"><span>TOTAL CREDIT</span><span class="mono strong">${fmt(d.total_credit)}</span></div>
    <div class="trow"><span>TOTAL DEBIT</span><span class="mono strong">${fmt(d.total_debit)}</span></div>
    <div class="net"><span class="netl">BALANCE</span><span class="netv">${fmt(d.balance)}</span></div>
  </div>
  </body></html>`;
}

export function renderLedgerThermalHtml(d: LedgerDetail, paperMm: number): string {
  const m = thermalMetrics(paperMm);
  const kind = d.account_type === "FARMER" ? "FARMER" : "VENDOR";
  const rows = d.rows.map((r) => `
    <tr>
      <td>${escapeHtml(dayNum(r.date))}</td>
      <td class="wrap">${escapeHtml(r.description)}</td>
      <td class="r">${dashAmt(r.credit)}</td>
      <td class="r">${dashAmt(r.debit)}</td>
      <td class="r">${fmt(r.balance)}</td>
    </tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=${m.widthPx}, initial-scale=1, maximum-scale=1"/>
  <style>${thermalBaseCss(m)}
    table.led { width:100%; border-collapse:collapse; table-layout:fixed; }
    table.led th, table.led td {
      font-size:${m.rowFs}px; font-weight:800; padding:2px 1px; vertical-align:top;
      word-break:break-word;
    }
    table.led th { text-align:left; }
    table.led td.r, table.led th.r { text-align:right; }
    table.led col.c1 { width:12%; } table.led col.c2 { width:34%; }
    table.led col.c3 { width:18%; } table.led col.c4 { width:18%; } table.led col.c5 { width:18%; }
  </style></head><body>
  <div id="slip">
    <div class="hr"></div>
    <div class="center bold big">ACCOUNT LEDGER</div>
    <div class="center bold">${kind}</div>
    <div class="hr"></div>
    <div class="kv"><span class="k">${kind === "FARMER" ? "Farmer" : "Vendor"}</span><span class="v wrap">${escapeHtml(d.party_name)}</span></div>
    <div class="kv"><span class="k">Date</span><span class="v">${escapeHtml(thermalDateLabel(d.date))}</span></div>
    <div class="hr"></div>
    <table class="led">
      <colgroup><col class="c1"/><col class="c2"/><col class="c3"/><col class="c4"/><col class="c5"/></colgroup>
      <thead><tr><th>DATE</th><th>DETAILS</th><th class="r">CR</th><th class="r">DR</th><th class="r">BAL</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="center">No transactions</td></tr>`}</tbody>
    </table>
    <div class="hr"></div>
    <div class="kv"><span>TOTAL CREDIT</span><span>${fmt(d.total_credit)}</span></div>
    <div class="kv"><span>TOTAL DEBIT</span><span>${fmt(d.total_debit)}</span></div>
    <div class="netbox"><span class="bold">BALANCE</span><span class="huge">${fmt(d.balance)}</span></div>
    <div class="hr"></div>
  </div>
  </body></html>`;
}

export async function thermalPrintLedger(d: LedgerDetail, paperMm?: number): Promise<void> {
  const mm = await resolvePrintPaperMm(paperMm);
  await printThermalDocument({
    html: renderLedgerThermalHtml(d, mm),
    escposBase64: encodeLedgerEscPos(d, mm),
    paperMm: mm,
  });
}

export async function shareLedgerPdf(d: LedgerDetail): Promise<void> {
  const html = renderLedgerPdfHtml(d);
  const { uri } = await Print.printToFileAsync({ html });
  const title = `Ledger ${d.account_type} ${d.party_name}`;
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: ".pdf", dialogTitle: title });
  } else if (Platform.OS !== "web") {
    await Share.share({ url: uri, title });
  } else {
    Alert.alert("PDF ready", uri);
  }
}
