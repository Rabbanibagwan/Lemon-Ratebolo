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
  /** Physical roll width in dots at 203 DPI (paperMm × 8). */
  paperDots: number;
  /**
   * ESC/POS print-area width (GS W) = document content width.
   * Canonical: 58→384, 80→576, 100→720.
   */
  dots: number;
  /** Font-A / 12-dot columns — always contentDots / 12 (32 / 48 / 60). */
  columns: number;
  /**
   * Left margin in dots (GS L) — centers the content block on the physical
   * roll when the addressable paper width is wider than content (100mm).
   */
  leftMarginDots: number;
  /** Right residual on the roll: paperDots - leftMargin - contentDots. */
  rightMarginDots: number;
  /** Usable content dots (= dots / GS W). */
  contentDots: number;
};

/** Font-A character cell width used for column planning (203 DPI). */
const FONT_A_DOTS = 12;

/**
 * Canonical content widths (selected paper → ESC/POS content at 203 DPI):
 *  58mm → 384 dots / 32 cols
 *  80mm → 576 dots / 48 cols
 * 100mm → 720 dots / 60 cols
 *
 * Document positioning (not text-align):
 *  Physical roll dots = paperMm × 8 (58→464, 80→640, 100→800).
 *  On 100mm rolls the content block (720) is narrower than the roll (800),
 *  so leftMarginDots = ⌊(paperDots − contentDots) / 2⌋ centers the Patti
 *  horizontally (GS L) — no space-padding of text rows.
 *  58/80 keep leftMargin=0 because the print head ≈ content width; offsetting
 *  would clip.
 */
export function thermalWidthConfig(paperMm: number): ThermalWidthConfig {
  const w = clampPaperMm(paperMm);
  // Explicit mapping — never reuse 58/80 values for 100mm.
  const contentDots = w <= 58 ? 384 : w <= 80 ? 576 : 720;
  const columns = Math.floor(contentDots / FONT_A_DOTS);
  const paperDots = Math.round(w * 8);
  let leftMarginDots = 0;
  if (w >= 100 && paperDots > contentDots) {
    leftMarginDots = Math.floor((paperDots - contentDots) / 2);
  }
  const rightMarginDots = Math.max(0, paperDots - leftMarginDots - contentDots);
  return {
    paperMm: w,
    paperDots,
    dots: contentDots,
    columns,
    leftMarginDots,
    rightMarginDots,
    contentDots,
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

  /**
   * Apply GS L (left margin) + GS W (content / print-area width).
   * Call after ESC @ and again after commands that some firmwares use to
   * reset the print area (e.g. character-size changes in the shop header).
   */
  applyPrintArea(): this {
    const lm = this.width.leftMarginDots;
    const n = this.width.contentDots;
    return this.raw(u8(0x1d, 0x4c, lm & 0xff, (lm >> 8) & 0xff)).raw(
      u8(0x1d, 0x57, n & 0xff, (n >> 8) & 0xff),
    );
  }

  init(): this {
    // ESC @ reset → centered print area for this paper → clear sticky styles.
    return this.raw(u8(0x1b, 0x40)).applyPrintArea().normalState();
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

  /**
   * ESC/POS built-in face (ESC M n). Font A = 12-dot (column planning).
   * Font B = 9-dot condensed — not Times Roman; do not use for width-planned rows.
   * Physical printers have no TrueType/Times — preview/HTML may use serif CSS.
   */
  font(kind: "A" | "B" = "A"): this {
    return this.raw(u8(0x1b, 0x4d, kind === "B" ? 1 : 0));
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
   * Party name value (FARMER / VENDOR) — merchant-class size (big when it fits, else tall).
   * Label stays normal width; name is bold + large. Long names wrap safely.
   * Does not change shopHeader / merchant size.
   */
  partyNameRow(label: string, name: string): this {
    const lab = String(label || "").toUpperCase() || "NAME";
    const val = slipText(name || "-") || "-";
    this.normalState().align("left").font("A").bold(false).size("normal");
    // big = double-width chars → effective columns = floor(cols/2)
    const bigCols = Math.floor(this.cols / 2);
    if (lab.length + 1 + val.length <= bigCols) {
      // Label at normal size (1× width), then big name — pad in normal columns
      // so the big glyphs land on the right edge: normalPad = cols - lab - 2*val
      const normalGap = Math.max(1, this.cols - lab.length - val.length * 2);
      this.text(lab + " ".repeat(normalGap));
      this.bold(true).size("big").text(val).size("normal").bold(false).raw(u8(0x0a));
      this.applyPrintArea().align("left");
      return this;
    }
    // tall = double-height, same column width (readable, fits long names)
    if (lab.length + 1 + val.length <= this.cols) {
      const gap = Math.max(1, this.cols - lab.length - val.length);
      this.text(lab + " ".repeat(gap));
      this.bold(true).size("tall").text(val).size("normal").bold(false).raw(u8(0x0a));
      this.applyPrintArea().align("left");
      return this;
    }
    this.line(lab);
    this.bold(true).size("tall");
    for (const row of this.wrap(val)) {
      this.align("right").line(row);
    }
    this.size("normal").bold(false).normalState().applyPrintArea().align("left");
    return this;
  }

  /**
   * Farmer Patti FARMER value — merchant-class size (big when it fits, else tall).
   * Does not change shopHeader / merchant size.
   */
  farmerNameRow(name: string): this {
    return this.partyNameRow("FARMER", name);
  }

  /**
   * Vendor Bill VENDOR value — merchant-class BIG (GS ! 0x11), same as shopHeader.
   * Label stays normal; VALUE is bold + large. Prefers same-row big; if the name is
   * too long for same-row big, stacks: VENDOR then big right-aligned name (never
   * falls back to body-size text). Long names wrap with tall only as last resort.
   * Does not change shopHeader / merchant size.
   */
  vendorNameRow(name: string): this {
    const lab = "VENDOR";
    const val = slipText(name || "-") || "-";
    this.normalState().align("left").font("A").bold(false).size("normal");
    const bigCols = Math.floor(this.cols / 2);
    // 1) Same-row: normal label + big value (identical size command as merchant name).
    if (lab.length + 1 + val.length <= bigCols) {
      const normalGap = Math.max(1, this.cols - lab.length - val.length * 2);
      this.text(lab + " ".repeat(normalGap));
      this.bold(true).size("big").text(val).size("normal").bold(false).raw(u8(0x0a));
      this.applyPrintArea().align("left");
      return this;
    }
    // 2) Stacked big — merchant-class 2×2 value when same-row big would not fit.
    if (val.length <= bigCols) {
      this.line(lab);
      this.bold(true).size("big").align("right").line(val).size("normal").bold(false);
      this.normalState().applyPrintArea().align("left");
      return this;
    }
    // 3) Same-row tall (double-height) when name is longer than bigCols.
    if (lab.length + 1 + val.length <= this.cols) {
      const gap = Math.max(1, this.cols - lab.length - val.length);
      this.text(lab + " ".repeat(gap));
      this.bold(true).size("tall").text(val).size("normal").bold(false).raw(u8(0x0a));
      this.applyPrintArea().align("left");
      return this;
    }
    // 4) Wrap tall — never clip / never body-size.
    this.line(lab);
    this.bold(true).size("tall");
    for (const row of this.wrap(val)) this.align("right").line(row);
    this.size("normal").bold(false).normalState().applyPrintArea().align("left");
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
    // Re-assert GS L / GS W after size("big") — some firmwares drop print-area
    // settings on character-size changes, which left-aligns a narrow body on 100mm.
    this.applyPrintArea();
    // Body sections (title/NO., farmer, table, totals) stay left/right *within* the
    // centered content area (document positioning ≠ per-row ALIGN_CENTER).
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
   * Major total (legacy compact row).
   * WHITE background, BOLD BLACK text — never inverse/reverse fill.
   * Prefer farmerNetPayableBox / vendorGrandTotalBox for framed totals.
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

  /**
   * Framed major total with continuous full-width rules (this.cols → 58/80/100):
   *   -------------------------------
   *   LABEL                    Rs …
   *   -------------------------------
   * WHITE background, bold black. Merchant-class size (big when it fits, else tall).
   * Never inverse/reverse. ESC/POS Font A + bold + big/tall only (no image).
   */
  framedMajorTotal(label: string, amount: string): this {
    const lab = String(label || "").toUpperCase();
    this.normalState().align("left").font("A");
    // Continuous top rule — left printable edge → right printable edge.
    this.hr("-");
    // Prefer merchant-class big (2×2). Effective cols = floor(cols/2) while big.
    const bigCols = Math.floor(this.cols / 2);
    let amt = this.fitAmount(slipText(amount || ""), Math.max(6, bigCols - lab.length - 1));
    let sizeKind: "big" | "tall" = "tall";
    let unitCols = this.cols;
    if (lab.length + 1 + amt.length <= bigCols) {
      sizeKind = "big";
      unitCols = bigCols;
    } else {
      amt = this.fitAmount(slipText(amount || ""), Math.max(10, this.cols - lab.length - 1));
      unitCols = this.cols;
    }
    // Bold black on white (GS B stays OFF via normalState). Amount never wraps.
    this.normalState().align("left").font("A").bold(true).size(sizeKind);
    const maxL = Math.max(0, unitCols - amt.length - 1);
    let l = lab;
    if (l.length > maxL) l = l.slice(0, Math.max(0, maxL - 1)) + (maxL > 0 ? "." : "");
    const gap = Math.max(1, unitCols - l.length - amt.length);
    const row = (l + " ".repeat(gap) + amt).slice(0, unitCols);
    this.line(row);
    // Reset size/bold before the bottom rule so separators stay normal weight.
    this.size("normal").bold(false).normalState().applyPrintArea().align("left");
    // Continuous bottom rule — same full printable width.
    this.hr("-");
    this.normalState();
    return this;
  }

  /**
   * Farmer Patti NET PAYABLE — framed merchant-class total.
   */
  farmerNetPayableBox(amount: string): this {
    return this.framedMajorTotal("NET PAYABLE", amount);
  }

  /**
   * Vendor Bill GRAND TOTAL — continuous full-width rules + merchant-class BIG
   * (GS ! 0x11 / bold), same size hierarchy as shopHeader ("MKB LEMON CO.").
   * WHITE background, black text, no inverse. Amount stays on one line.
   * Rules use this.cols (58→32 / 80→48 / 100→60) — never a fixed dash count.
   */
  vendorGrandTotalBox(amount: string): this {
    const lab = "GRAND TOTAL";
    this.normalState().align("left").font("A");
    // Continuous top rule — left printable edge → right printable edge.
    this.hr("-");
    const bigCols = Math.floor(this.cols / 2);
    // Compact amount first so same-row BIG is preferred (matches merchant 2×2).
    let amt = this.fitAmount(slipText(amount || ""), Math.max(6, bigCols - lab.length - 1));
    if (lab.length + 1 + amt.length <= bigCols) {
      this.normalState().align("left").font("A").bold(true).size("big");
      const gap = Math.max(1, bigCols - lab.length - amt.length);
      this.line((lab + " ".repeat(gap) + amt).slice(0, bigCols));
    } else {
      // Stacked BIG lines when label+amount cannot share one double-width row (e.g. 58mm).
      amt = this.fitAmount(slipText(amount || ""), Math.max(6, bigCols));
      this.normalState().align("left").font("A").bold(true).size("big");
      this.line(lab.slice(0, bigCols));
      this.align("right").line(amt.slice(0, bigCols));
    }
    this.size("normal").bold(false).normalState().applyPrintArea().align("left");
    // Continuous bottom rule — same full printable width.
    this.hr("-");
    this.normalState();
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
    this.align("left").font("A");
    const lotCell = pad(lot || "", lw).slice(0, lw);
    const midCell = this.fitBagsRate(slipText(mid || ""), mw).slice(0, mw).padEnd(mw, " ");
    const amtCell = this.fitAmount(amount || "", aw).slice(0, aw).padStart(aw);
    // Lot bold (existing); Bags × Rate + Amount bold for Farmer Patti readability.
    if ((lot || "").trim()) this.bold(true).text(lotCell).bold(false);
    else this.text(lotCell);
    this.bold(true).text(midCell).text(amtCell).bold(false).raw(u8(0x0a));
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
