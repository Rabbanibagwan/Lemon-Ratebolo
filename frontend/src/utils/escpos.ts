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

/** Single width config for an entire thermal document (Patti / Vendor Bill). */
export type ThermalWidthConfig = {
  paperMm: number;
  /** Max printable dots at 203 DPI (GS W). */
  dots: number;
  /** Font-A / 12-dot columns — all sections must stay within this. */
  columns: number;
  /** Left margin in dots (GS L). */
  leftMarginDots: number;
  /** Right margin in dots (implicit: dots - left - content). */
  rightMarginDots: number;
  /** Usable content dots after margins. */
  contentDots: number;
};

/**
 * Canonical printable widths (paper → printable area at 203 DPI):
 *  58mm → 384 dots / 32 cols  (~48 mm printable)
 *  80mm → 576 dots / 48 cols  (~72 mm printable)
 * 100mm → 720 dots / 60 cols  (~90 mm printable)
 *
 * `dots` is MAX_PRINTABLE for the roll. Left margin is forced to 0 so every
 * section shares one fixed content width (= dots / columns).
 */
export function thermalWidthConfig(paperMm: number): ThermalWidthConfig {
  const w = clampPaperMm(paperMm);
  const dots = w <= 58 ? 384 : w <= 80 ? 576 : 720;
  const columns = w <= 58 ? 32 : w <= 80 ? 48 : 60;
  const leftMarginDots = 0;
  const rightMarginDots = 0;
  return {
    paperMm: w,
    dots,
    columns,
    leftMarginDots,
    rightMarginDots,
    contentDots: dots - leftMarginDots - rightMarginDots,
  };
}

export function escposCols(paperMm: number): number {
  return thermalWidthConfig(paperMm).columns;
}

/**
 * Printable width in dots at 203 DPI (8 dots/mm) — equals ThermalWidthConfig.contentDots.
 */
export function escposPrintDots(paperMm: number): number {
  return thermalWidthConfig(paperMm).contentDots;
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
  readonly width: ThermalWidthConfig;

  constructor(paperMm: number) {
    this.width = thermalWidthConfig(paperMm);
    this.paperMm = this.width.paperMm;
    this.cols = this.width.columns;
    this.printDots = this.width.contentDots;
  }

  /** 3-col widths (lot / mid / amount) that always sum to this.cols. */
  lineWidths(): [number, number, number] {
    const lot = Math.max(5, Math.floor(this.cols * 0.18));
    const amt = Math.max(9, Math.floor(this.cols * 0.3));
    const mid = Math.max(8, this.cols - lot - amt);
    return [lot, mid, amt];
  }

  /** 4-col widths (lot / farmer / bags×rate / amount) — always sum to this.cols. */
  lineWidths4(): [number, number, number, number] {
    // Amount flush to the right content boundary; bags×rate readable; farmer flexes.
    const lot = Math.max(4, Math.floor(this.cols * 0.1));
    const amt = Math.max(10, Math.floor(this.cols * 0.26));
    const bags = Math.max(10, Math.floor(this.cols * 0.32));
    const farm = Math.max(5, this.cols - lot - bags - amt);
    return [lot, farm, bags, amt];
  }

  raw(bytes: Uint8Array): this {
    this.chunks.push(bytes);
    return this;
  }

  init(): this {
    const n = this.printDots;
    const lm = this.width.leftMarginDots;
    // ESC @ reset → left margin → print area width → clear sticky styles.
    return this.raw(u8(0x1b, 0x40))
      .raw(u8(0x1d, 0x4c, lm & 0xff, (lm >> 8) & 0xff))
      .raw(u8(0x1d, 0x57, n & 0xff, (n >> 8) & 0xff))
      .normalState();
  }

  /**
   * Explicitly clear styles that can leak across sections / print jobs:
   * inverse, bold, underline, character size, left alignment, Font A.
   */
  normalState(): this {
    return this.raw(u8(0x1d, 0x42, 0x00)) // reverse OFF
      .raw(u8(0x1b, 0x45, 0x00)) // bold OFF
      .raw(u8(0x1b, 0x2d, 0x00)) // underline OFF
      .raw(u8(0x1d, 0x21, 0x00)) // normal size
      .raw(u8(0x1b, 0x4d, 0x00)) // Font A
      .raw(u8(0x1b, 0x61, 0x00)); // left align
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
   * Merchant shop header — CENTER aligned (name, address, mobile only).
   * Restores left alignment afterward so Patti body layout is unchanged.
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
    this.init().align("center").bold(true).size("big").line(shop).size("normal").bold(false);
    const addr = [profile?.address, profile?.village, profile?.taluk, profile?.district, profile?.state]
      .filter(Boolean)
      .join(", ");
    if (addr) {
      this.align("center").bold(false).size("normal");
      for (const row of this.wrap(slipText(addr))) this.line(row);
    }
    if (profile?.mobile) {
      this.align("center").bold(false).size("normal").line(`Mobile: ${slipText(profile.mobile)}`);
    }
    // Body sections (title/NO., farmer, table, totals) stay left/right as designed.
    this.align("left");
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
   * Major total (NET PAYABLE / GRAND TOTAL).
   * WHITE background, BOLD BLACK text — never inverse/reverse fill.
   */
  majorTotalBox(left: string, right: string): this {
    const lab = String(left || "").toUpperCase();
    const amt = slipText(right || "");
    // Hard-disable reverse — white paper + bold black (no tall: keeps ~6" length).
    this.normalState().align("left").bold(true).size("normal");
    this.kv(lab, amt);
    this.bold(false).normalState();
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

  /**
   * QR module size that stays inside contentDots and keeps total slip ~6".
   * Model-2 ~ version 5–6 ≈ 37–41 modules (+ quiet zone ≈ 8) → ~49 modules worst case.
   */
  qrModuleSize(paperMm?: number): number {
    const w = paperMm != null ? clampPaperMm(paperMm) : this.paperMm;
    // Slightly compact vs prior 3/4/5 so content + QR + feed ≈ 6 inches.
    const preferred = w <= 58 ? 3 : w <= 80 ? 3 : 4;
    const maxModules = 49;
    const maxByWidth = Math.max(2, Math.floor(this.printDots / maxModules));
    return Math.max(2, Math.min(8, preferred, maxByWidth));
  }

  /** Lines to advance after QR so the full symbol clears the head before CUT. */
  qrClearanceFeed(): number {
    // Enough for head→cutter (~12–18 mm), without a long blank tail past ~6".
    if (this.paperMm <= 58) return 4;
    if (this.paperMm <= 80) return 5;
    return 5;
  }

  /**
   * Lines after the last text content (e.g. Bank Details) so the cutter does not
   * slice mid-section. Content-driven docs call this before cut(); not a fixed page height.
   */
  contentClearanceFeed(): number {
    if (this.paperMm <= 58) return 5;
    if (this.paperMm <= 80) return 6;
    return 6;
  }

  /**
   * Bank Details block — every line is emitted before the caller finalizes/cuts.
   * Does not cut. Caller must feed + cut after this returns.
   */
  bankDetailsSection(lines: string[]): this {
    const rows = (lines || []).map((x) => slipText(x)).filter((x) => x.trim());
    if (!rows.length) return this;
    this.normalState().align("left");
    this.hr().bold(true).size("normal").line("BANK DETAILS").bold(false);
    for (const row of rows) {
      this.align("left").size("normal").wrapped(row);
    }
    this.normalState();
    return this;
  }

  /** Compact QR section: QR → SCAN label → hint → clearance feed (before finalize/cut). */
  qrSection(token: string, paperMm?: number): this {
    const t = (token || "").trim();
    if (!t) return this;
    const module = this.qrModuleSize(paperMm ?? this.paperMm);
    this.normalState().align("center").qr(t, module);
    // Reset after QR — some firmwares leave alignment/size sticky after GS ( k.
    this.normalState().align("center").bold(true).line("SCAN AT COUNTER").bold(false);
    this.align("center").size("normal").wrapped("Scan to open this Patti and enter/update the receiver name.");
    this.normalState();
    // Advance paper so the entire QR + footer text clears the cutter zone.
    this.feed(this.qrClearanceFeed());
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

  /**
   * End of document: restore normal state → short final feed → full cut.
   * Uses GS V 65 n (feed-and-cut). Keeps total slip near ~6" (no huge blank tail).
   */
  cut(): this {
    this.normalState();
    this.feed(2);
    // GS V 65 n — feed n motion units then full cut (~6–8 mm cutter clearance).
    const n = this.paperMm <= 58 ? 48 : this.paperMm <= 80 ? 56 : 64;
    return this.raw(u8(0x1d, 0x56, 0x41, n & 0xff));
  }

  /**
   * Estimate printed length in mm for a finished buffer (Font-A lines + QR).
   * Target for a typical 1-lot Farmer Patti is ~6 inches (152 mm).
   */
  estimateLengthMm(opts?: { qrModules?: number }): number {
    const bytes = this.toBytes();
    let lf = 0;
    let qrModule = 0;
    let i = 0;
    while (i < bytes.length) {
      if (bytes[i] === 0x0a) {
        lf++;
        i++;
        continue;
      }
      // GS ( k … 31 43 n  → QR module size
      if (
        bytes[i] === 0x1d &&
        bytes[i + 1] === 0x28 &&
        bytes[i + 2] === 0x6b &&
        bytes[i + 3] === 0x03 &&
        bytes[i + 4] === 0x00 &&
        bytes[i + 5] === 0x31 &&
        bytes[i + 6] === 0x43
      ) {
        qrModule = bytes[i + 7] || 0;
        i += 8;
        continue;
      }
      if (bytes[i] === 0x1d && bytes[i + 1] === 0x28 && bytes[i + 2] === 0x6b) {
        const plen = bytes[i + 3] + (bytes[i + 4] << 8);
        i += 5 + plen;
        continue;
      }
      if (bytes[i] === 0x1d && bytes[i + 1] === 0x56) {
        // feed-and-cut adds n vertical units (~1/180" or firmware-dependent); count ~n/8 mm
        if (bytes[i + 2] >= 65) {
          lf += Math.max(1, Math.round((bytes[i + 3] || 0) / 24));
          i += 4;
        } else {
          i += 3;
        }
        continue;
      }
      i++;
    }
    const lineMm = 3.2; // Font-A ~24 dots @ 203 DPI
    const modules = opts?.qrModules ?? 45;
    const qrMm = qrModule > 0 ? (modules * qrModule) / 8 : 0;
    return lf * lineMm + qrMm;
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
