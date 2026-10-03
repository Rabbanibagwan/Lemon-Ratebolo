/**
 * Generic ESC/POS command builder. Not tied to any printer brand.
 * Column count follows paper width (58 / 80 / 100 mm) — Font-A / 12-dot planning.
 *
 * Shared layout primitives for Farmer Patti + Vendor Bill so both documents
 * follow the same hierarchy as the on-screen thermal HTML preview.
 */

function clampPaperMm(n: unknown, fallback = 80): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(40, Math.min(120, Math.round(v)));
}

export function escposCols(paperMm: number): number {
  const w = clampPaperMm(paperMm);
  if (w <= 58) return 32;
  if (w <= 80) return 48;
  return 60; // 100 mm Font-A/12-dot planning (not 64)
}

/**
 * Printable width in dots at 203 DPI (8 dots/mm).
 * Uses the full printable area for each roll so content spans the selected paper.
 */
export function escposPrintDots(paperMm: number): number {
  const w = clampPaperMm(paperMm);
  if (w <= 58) return 384; // ~48 mm printable on 58 mm roll
  if (w <= 80) return 576; // ~72 mm printable on 80 mm roll
  return 720; // ~90 mm printable on 100 mm roll
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function u8(...n: number[]): Uint8Array {
  return Uint8Array.from(n);
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s.replace(/\r/g, ""));
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

/** ASCII-safe slip text — thermal printers often cannot render × / · / ₹ / em-dash. */
export function slipText(s: string): string {
  return String(s || "")
    .replace(/₹/g, "Rs ")
    .replace(/×/g, "x")
    .replace(/·/g, " - ")
    .replace(/…/g, "...")
    .replace(/—/g, "-")
    .replace(/–/g, "-");
}

export class EscPosBuilder {
  private chunks: Uint8Array[] = [];
  readonly cols: number;
  readonly printDots: number;
  readonly paperMm: number;

  constructor(paperMm: number) {
    this.paperMm = clampPaperMm(paperMm);
    this.cols = escposCols(this.paperMm);
    this.printDots = escposPrintDots(this.paperMm);
  }

  /** 3-col widths (lot / mid / amount) that always sum to this.cols. */
  lineWidths(): [number, number, number] {
    const lot = Math.max(5, Math.floor(this.cols * 0.18));
    const amt = Math.max(9, Math.floor(this.cols * 0.3));
    const mid = Math.max(8, this.cols - lot - amt);
    return [lot, mid, amt];
  }

  /** 4-col widths (lot / farmer / bags×rate / amount) — Vendor Bill table geometry. */
  lineWidths4(): [number, number, number, number] {
    // Prefer bags×rate + amount readability; farmer truncates with ellipsis.
    const lot = Math.max(4, Math.floor(this.cols * 0.12));
    const amt = Math.max(10, Math.floor(this.cols * 0.28));
    const bags = Math.max(10, Math.floor(this.cols * 0.34));
    const farm = Math.max(5, this.cols - lot - bags - amt);
    return [lot, farm, bags, amt];
  }

  raw(bytes: Uint8Array): this {
    this.chunks.push(bytes);
    return this;
  }

  init(): this {
    const n = this.printDots;
    return this.raw(u8(0x1b, 0x40)).raw(u8(0x1d, 0x57, n & 0xff, (n >> 8) & 0xff));
  }

  align(dir: "left" | "center" | "right"): this {
    const n = dir === "center" ? 1 : dir === "right" ? 2 : 0;
    return this.raw(u8(0x1b, 0x61, n));
  }

  bold(on: boolean): this {
    return this.raw(u8(0x1b, 0x45, on ? 1 : 0));
  }

  size(kind: "normal" | "tall" | "wide" | "big"): this {
    const n = kind === "tall" ? 0x01 : kind === "wide" ? 0x10 : kind === "big" ? 0x11 : 0x00;
    return this.raw(u8(0x1d, 0x21, n));
  }

  text(s: string): this {
    return this.raw(utf8(s));
  }

  line(s = ""): this {
    return this.text(s).raw(u8(0x0a));
  }

  feed(n = 1): this {
    for (let i = 0; i < n; i++) this.raw(u8(0x0a));
    return this;
  }

  hr(ch = "-"): this {
    return this.align("left").line(ch.repeat(this.cols));
  }

  wrap(s: string): string[] {
    const t = (s || "").trim();
    if (!t) return [""];
    const out: string[] = [];
    let rest = t;
    while (rest.length > this.cols) {
      let cut = rest.lastIndexOf(" ", this.cols);
      if (cut < 8) cut = this.cols;
      out.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    if (rest) out.push(rest);
    return out;
  }

  wrapped(s: string): this {
    for (const row of this.wrap(s)) this.line(row);
    return this;
  }

  kv(left: string, right: string): this {
    const r = right || "";
    const maxL = Math.max(0, this.cols - r.length - 1);
    let l = left || "";
    if (l.length > maxL) l = l.slice(0, Math.max(0, maxL - 1)) + (maxL > 0 ? "." : "");
    const gap = Math.max(1, this.cols - l.length - r.length);
    return this.align("left").line(l + " ".repeat(gap) + r);
  }

  /**
   * Same-line label/value like kv(), but prefers value width and wraps long
   * values onto following right-aligned lines instead of clipping.
   */
  kvPreferValue(left: string, right: string): this {
    const label = left || "";
    const value = right || "";
    if (!value) return this.kv(label, value);
    const minValueCols = Math.min(value.length, Math.max(12, Math.floor(this.cols * 0.45)));
    const maxLabel = Math.max(4, this.cols - minValueCols - 1);
    let l = label;
    if (l.length > maxLabel) l = l.slice(0, Math.max(0, maxLabel - 1)) + (maxLabel > 0 ? "." : "");
    const firstAvail = Math.max(1, this.cols - l.length - 1);
    if (value.length <= firstAvail) {
      const gap = Math.max(1, this.cols - l.length - value.length);
      return this.align("left").line(l + " ".repeat(gap) + value);
    }
    const first = value.slice(0, firstAvail);
    this.align("left").line(l + " ".repeat(Math.max(1, this.cols - l.length - first.length)) + first);
    let rest = value.slice(firstAvail);
    while (rest.length > 0) {
      const chunk = rest.slice(0, this.cols);
      rest = rest.slice(this.cols);
      this.align("left").line(chunk.padStart(this.cols, " "));
    }
    return this;
  }

  /** Preview info row: uppercase label left, bold value right. */
  infoRow(label: string, value: string, opts?: { valueBold?: boolean }): this {
    const lab = String(label || "").toUpperCase();
    const val = slipText(value || "-");
    if (opts?.valueBold !== false) this.bold(true);
    this.kvPreferValue(lab, val);
    if (opts?.valueBold !== false) this.bold(false);
    return this;
  }

  /**
   * Shared shop header matching on-screen / thermal HTML preview:
   * SHOP (uppercase, large, bold, full width) → address → mobile.
   */
  shopHeader(profile: {
    shop_name?: string | null;
    address?: string | null;
    village?: string | null;
    taluk?: string | null;
    district?: string | null;
    state?: string | null;
    mobile?: string | null;
  } | null): this {
    const shop = slipText((profile?.shop_name || "").trim()).toUpperCase() || "LEMON MANDI";
    this.init().align("left").bold(true).size("big").line(shop).size("normal").bold(false);
    const addr = [profile?.address, profile?.village, profile?.taluk, profile?.district, profile?.state]
      .filter(Boolean)
      .join(", ");
    if (addr) this.align("left").bold(false).size("normal").wrapped(slipText(addr));
    if (profile?.mobile) this.align("left").bold(false).size("normal").line(`Mobile: ${slipText(profile.mobile)}`);
    return this;
  }

  /**
   * Document title + NO. block (Preview patti-head / numBox).
   * numLabel defaults to "NO." — Vendor Bill uses "BILL".
   * Wider paper: title left, number right. Narrow: stacked.
   */
  docTitleAndNo(title: string, no: string | number, numLabel = "NO."): this {
    const t = String(title || "").toUpperCase();
    const label = String(numLabel || "NO.").toUpperCase();
    const num = String(no ?? "");
    const right = `${label} ${num}`;
    this.align("left");
    if (this.cols >= 40 && t.length + right.length + 2 <= this.cols) {
      this.bold(true).kv(t, right).bold(false);
    } else {
      if (t) this.bold(true).line(t).bold(false);
      this.bold(true).align("right").line(right).bold(false).align("left");
    }
    return this;
  }

  /**
   * Preview-style major total (NET PAYABLE / GRAND TOTAL).
   * Reverse + tall when supported — no ASCII box, no extra blank feeds.
   */
  majorTotalBox(left: string, right: string): this {
    const lab = String(left || "").toUpperCase();
    const amt = slipText(right || "");
    this.align("left");
    this.reverse(true).bold(true).size("tall");
    this.kv(lab, amt);
    this.size("normal").bold(false).reverse(false);
    return this;
  }

  /** @deprecated Prefer majorTotalBox — kept for ledger/cashbook callers. */
  boxedKv(left: string, right: string): this {
    const inner = Math.max(8, this.cols - 2);
    const r = (right || "").slice(0, Math.max(0, inner - 1));
    let l = left || "";
    const maxL = Math.max(0, inner - r.length - 1);
    if (l.length > maxL) l = l.slice(0, Math.max(0, maxL - 1)) + (maxL > 0 ? "." : "");
    const gap = Math.max(1, inner - l.length - r.length);
    const row = (l + " ".repeat(gap) + r).slice(0, inner).padEnd(inner, " ");
    this.align("left").line("+" + "-".repeat(inner) + "+");
    this.line("|" + row + "|");
    this.line("+" + "-".repeat(inner) + "+");
    return this;
  }

  /** @deprecated Prefer majorTotalBox for Patti/Vendor Bill. */
  emphasizedTotalBox(left: string, right: string): this {
    return this.majorTotalBox(left, right);
  }

  reverse(on: boolean): this {
    return this.raw(u8(0x1d, 0x42, on ? 1 : 0));
  }

  columns(parts: string[], widths: number[]): this {
    let row = "";
    for (let i = 0; i < parts.length; i++) {
      const w = widths[i] || 8;
      const last = i === parts.length - 1;
      const cell = last ? pad(parts[i] || "", w).trimEnd() : pad(parts[i] || "", w);
      row += last ? (parts[i] || "").slice(0, w).padStart(w) : cell;
    }
    if (row.length > this.cols) row = row.slice(0, this.cols);
    return this.line(row);
  }

  itemRowLotEmph(lot: string, mid: string, amount: string): this {
    const [lw, mw, aw] = this.lineWidths();
    this.align("left");
    const lotCell = pad(lot || "", lw).slice(0, lw);
    const midCell = this.fitBagsRate(slipText(mid || ""), mw).slice(0, mw).padEnd(mw, " ");
    const amtCell = this.fitAmount(amount || "", aw).slice(0, aw).padStart(aw);
    if ((lot || "").trim()) this.bold(true).text(lotCell).bold(false);
    else this.text(lotCell);
    this.text(midCell).text(amtCell).raw(u8(0x0a));
    return this;
  }

  itemRow(lot: string, mid: string, amount: string): this {
    const [lw, mw, aw] = this.lineWidths();
    const midCell = this.fitBagsRate(slipText(mid || ""), mw);
    const amtCell = this.fitAmount(amount || "", aw);
    return this.columns([lot || "", midCell, amtCell], [lw, mw, aw]);
  }

  /** Prefer amount text that fits the amount column. */
  fitAmount(s: string, width: number): string {
    const t = slipText(s || "");
    const candidates = [t, t.replace(/\.00\b/g, ""), t.replace(/^Rs\s+/, ""), t.replace(/^Rs\s+/, "").replace(/\.00\b/g, "")];
    for (const c of candidates) {
      if (c.length <= width) return c;
    }
    return t.slice(0, width);
  }

  /** Vendor Bill 4-col: LOT | FARMER | BAGS x RATE | AMOUNT */
  itemRow4(lot: string, farmer: string, bagsRate: string, amount: string): this {
    const [lw, fw, bw, aw] = this.lineWidths4();
    this.align("left");
    const lotCell = pad(lot || "", lw).slice(0, lw);
    let farmCell = slipText(farmer || "");
    if (farmCell.length > fw) farmCell = farmCell.slice(0, Math.max(0, fw - 1)) + ".";
    farmCell = pad(farmCell, fw).slice(0, fw);
    // Prefer compact bags×rate that fits; right-align within column.
    const bagsCell = this.fitBagsRate(slipText(bagsRate || ""), bw).slice(0, bw).padStart(bw, " ");
    const amtCell = this.fitAmount(amount || "", aw).slice(0, aw).padStart(aw);
    if ((lot || "").trim()) this.bold(true).text(lotCell).bold(false);
    else this.text(lotCell);
    this.text(farmCell).text(bagsCell).text(amtCell).raw(u8(0x0a));
    return this;
  }

  /** Shrink bags×rate text to fit column without colliding into amount. */
  fitBagsRate(s: string, width: number): string {
    const candidates = [
      s,
      s.replace(/\.00\b/g, ""),
      s.replace(/Rs\s+/g, ""),
      s.replace(/Rs\s+/g, "").replace(/\.00\b/g, ""),
      s.replace(/\s+x\s+/g, "x").replace(/Rs\s+/g, "").replace(/\.00\b/g, ""),
    ];
    for (const c of candidates) {
      if (c.length <= width) return c;
    }
    return s.slice(0, width);
  }

  tableHeader3(): this {
    return this.bold(true).itemRow("LOT", "BAGS x RATE", "AMOUNT").bold(false);
  }

  tableHeader4(): this {
    const [lw, fw, bw, aw] = this.lineWidths4();
    this.align("left").bold(true);
    const lotCell = pad("LOT", lw).slice(0, lw);
    const farmCell = pad("FARMER", fw).slice(0, fw);
    const bagsCell = "BAGS x RATE".slice(0, bw).padStart(bw, " ");
    const amtCell = "AMOUNT".slice(0, aw).padStart(aw);
    this.text(lotCell).text(farmCell).text(bagsCell).text(amtCell).raw(u8(0x0a));
    this.bold(false);
    return this;
  }

  /** Compact QR section matching Preview qrbox. */
  qrSection(token: string, paperMm: number): this {
    const t = (token || "").trim();
    if (!t) return this;
    const module = paperMm <= 58 ? 3 : paperMm <= 80 ? 4 : 5;
    this.align("center").qr(t, module);
    this.size("normal").bold(true).line("SCAN AT COUNTER").bold(false);
    this.size("normal").wrapped("Scan to open this Patti and enter/update the receiver name.");
    this.align("left");
    return this;
  }

  qr(data: string, moduleSize = 4): this {
    const payload = utf8(data || "");
    const storeLen = payload.length + 3;
    const pL = storeLen & 0xff;
    const pH = (storeLen >> 8) & 0xff;
    const size = Math.max(2, Math.min(8, moduleSize));
    this.raw(u8(0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00));
    this.raw(u8(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size));
    this.raw(u8(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30));
    this.raw(u8(0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30));
    this.raw(payload);
    this.raw(u8(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30));
    return this;
  }

  cut(): this {
    return this.feed(2).raw(u8(0x1d, 0x56, 0x00));
  }

  toBytes(): Uint8Array {
    return concat(this.chunks);
  }

  toBase64(): string {
    const bytes = this.toBytes();
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    if (typeof btoa === "function") return btoa(bin);
    return Buffer.from(bytes).toString("base64");
  }
}

export function rupees(n: number): string {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return "Rs " + v.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}
