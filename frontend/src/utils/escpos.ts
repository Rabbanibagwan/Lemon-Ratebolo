/**
 * Generic ESC/POS command builder. Not tied to any printer brand.
 * Column count follows paper width (58 / 80 / 100 mm).
 */
import { clampPaperMm } from "@/src/utils/thermal-print";

export function escposCols(paperMm: number): number {
  const w = clampPaperMm(paperMm);
  if (w <= 58) return 32;
  if (w <= 80) return 48;
  return 64;
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
  const t = s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
  return t;
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

  /** Column widths (lot / mid / amount) that always sum to this.cols. */
  lineWidths(): [number, number, number] {
    const lot = Math.max(5, Math.floor(this.cols * 0.18));
    const amt = Math.max(8, Math.floor(this.cols * 0.3));
    const mid = Math.max(8, this.cols - lot - amt);
    return [lot, mid, amt];
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
    if (l.length > maxL) l = l.slice(0, Math.max(0, maxL - 1)) + (maxL > 0 ? "..." : "");
    const gap = Math.max(1, this.cols - l.length - r.length);
    return this.align("left").line(l + " ".repeat(gap) + r);
  }

  /**
   * Draw a visible box around a key/value row (Preview Net Payable / TOTAL).
   * Uses ASCII borders so generic Bluetooth thermal printers render reliably.
   */
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

  /**
   * Preview-style emphasized total: double rule + tall boxed row + double rule.
   * Closest ESC/POS stand-in for the HTML black NET PAYABLE / TOTAL box.
   */
  emphasizedTotalBox(left: string, right: string): this {
    this.align("left").feed(1);
    this.line("=".repeat(this.cols));
    this.bold(true).size("tall");
    this.boxedKv(left, right);
    this.size("normal").bold(false);
    this.line("=".repeat(this.cols));
    return this.feed(1);
  }

  /** White-on-black line where the printer supports GS B reverse mode (optional emphasis). */
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

  /** Lot / detail / amount row sized to the selected paper columns. */
  itemRow(lot: string, mid: string, amount: string): this {
    const [lw, mw, aw] = this.lineWidths();
    return this.columns([lot || "", mid || "", amount || ""], [lw, mw, aw]);
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
    // Tear-off feed only. GS V A n feeds extra units before cut and on many
    // printers (incl. generic 80 mm) dumps a long blank tail.
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
