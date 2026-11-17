/**
 * Decode PNG → 1-bit mono packed rows for ESC/POS GS v 0 raster.
 * Uses pako inflate (works in RN + Node). Supports 8-bit Gray/RGB/RGBA.
 */
import { inflate } from "pako";

export type MonoBitmap = {
  width: number;
  height: number;
  /** Row-major, width padded to multiple of 8; 1 = black (print). */
  rows: Uint8Array[];
};

function u32be(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(filter: number, cur: Uint8Array, prev: Uint8Array | null, bpp: number): void {
  const len = cur.length;
  if (filter === 0) return;
  for (let i = 0; i < len; i++) {
    const left = i >= bpp ? cur[i - bpp] : 0;
    const up = prev ? prev[i] : 0;
    const upLeft = prev && i >= bpp ? prev[i - bpp] : 0;
    if (filter === 1) cur[i] = (cur[i] + left) & 0xff;
    else if (filter === 2) cur[i] = (cur[i] + up) & 0xff;
    else if (filter === 3) cur[i] = (cur[i] + Math.floor((left + up) / 2)) & 0xff;
    else if (filter === 4) cur[i] = (cur[i] + paeth(left, up, upLeft)) & 0xff;
  }
}

/** Strip data: URI prefix / whitespace from stored shop QR. */
export function stripImageBase64(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/s);
  return (m ? m[1] : s).replace(/\s+/g, "");
}

export function imageDataUri(raw: string | null | undefined): string {
  const b64 = stripImageBase64(raw);
  if (!b64) return "";
  if (String(raw || "").trim().startsWith("data:")) return String(raw).trim();
  return `data:image/png;base64,${b64}`;
}

function decodePngRgba(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  if (bytes.length < 8) throw new Error("PNG too short");
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error("Not a PNG");

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idats: Uint8Array[] = [];
  let o = 8;
  while (o + 8 <= bytes.length) {
    const len = u32be(bytes, o);
    const type = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
    const data = bytes.subarray(o + 8, o + 8 + len);
    o += 12 + len;
    if (type === "IHDR") {
      width = u32be(data, 0);
      height = u32be(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error("Unsupported PNG compression/filter/interlace");
      }
    } else if (type === "IDAT") {
      idats.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (!width || !height) throw new Error("Missing IHDR");
  if (bitDepth !== 8) throw new Error("Only 8-bit PNG supported");
  if (![0, 2, 4, 6].includes(colorType)) throw new Error(`Unsupported PNG color type ${colorType}`);

  let total = 0;
  for (const c of idats) total += c.length;
  const compressed = new Uint8Array(total);
  let at = 0;
  for (const c of idats) {
    compressed.set(c, at);
    at += c.length;
  }
  const inflated = inflate(compressed);

  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
  const bpp = channels; // 8-bit
  const stride = width * bpp;
  const rgba = new Uint8Array(width * height * 4);
  let prev: Uint8Array | null = null;
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[src++];
    const row = inflated.subarray(src, src + stride);
    src += stride;
    const cur = new Uint8Array(row);
    unfilter(filter, cur, prev, bpp);
    prev = cur;
    for (let x = 0; x < width; x++) {
      const i = x * bpp;
      const di = (y * width + x) * 4;
      if (colorType === 0) {
        const g = cur[i];
        rgba[di] = g;
        rgba[di + 1] = g;
        rgba[di + 2] = g;
        rgba[di + 3] = 255;
      } else if (colorType === 2) {
        rgba[di] = cur[i];
        rgba[di + 1] = cur[i + 1];
        rgba[di + 2] = cur[i + 2];
        rgba[di + 3] = 255;
      } else if (colorType === 4) {
        const g = cur[i];
        rgba[di] = g;
        rgba[di + 1] = g;
        rgba[di + 2] = g;
        rgba[di + 3] = cur[i + 1];
      } else {
        rgba[di] = cur[i];
        rgba[di + 1] = cur[i + 1];
        rgba[di + 2] = cur[i + 2];
        rgba[di + 3] = cur[i + 3];
      }
    }
  }
  return { width, height, rgba };
}

/**
 * Convert PNG base64 (or data URI) to mono bitmap sized to maxDots (content width).
 * Preserves aspect; pads width to multiple of 8. Dark pixels → black (print).
 */
export function pngBase64ToMonoBitmap(
  rawBase64: string | null | undefined,
  maxDots: number,
): MonoBitmap | null {
  const b64 = stripImageBase64(rawBase64);
  if (!b64) return null;
  let bytes: Uint8Array;
  try {
    if (typeof Buffer !== "undefined") {
      bytes = new Uint8Array(Buffer.from(b64, "base64"));
    } else {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    }
  } catch {
    return null;
  }
  let decoded: { width: number; height: number; rgba: Uint8Array };
  try {
    decoded = decodePngRgba(bytes);
  } catch {
    return null;
  }
  const { width: sw, height: sh, rgba } = decoded;
  if (sw < 8 || sh < 8) return null;

  const target = Math.max(64, Math.min(maxDots, Math.min(sw, maxDots)));
  const scale = target / Math.max(sw, sh);
  let dw = Math.max(8, Math.round(sw * scale));
  let dh = Math.max(8, Math.round(sh * scale));
  // Fit inside maxDots (width).
  if (dw > maxDots) {
    const f = maxDots / dw;
    dw = maxDots;
    dh = Math.max(8, Math.round(dh * f));
  }
  // ESC/POS GS v 0 requires width as a multiple of 8 (byte packing).
  dw = Math.min(maxDots, Math.ceil(dw / 8) * 8);
  if (dw < 8) dw = 8;
  const rowBytes = dw / 8;
  const rows: Uint8Array[] = [];
  for (let y = 0; y < dh; y++) {
    const row = new Uint8Array(rowBytes);
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      const i = (sy * sw + sx) * 4;
      const a = rgba[i + 3] / 255;
      const lum = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * a + 255 * (1 - a);
      // Dark → black (print bit 1). Threshold mid-gray.
      if (lum < 180) {
        row[x >> 3] |= 0x80 >> (x & 7);
      }
    }
    rows.push(row);
  }
  return { width: dw, height: dh, rows };
}
