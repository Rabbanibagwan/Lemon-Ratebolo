import QRCode from "qrcode";

/**
 * QR helpers that NEVER use HTML canvas.
 * The `qrcode` browser renderer calls document.createElement("canvas") and throws
 * "You need to specify a canvas element" on Android (no DOM canvas).
 * We encode a PNG from the QR matrix in JS so print, PDF, and on-screen Image all work.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(buf: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(n: number): Uint8Array {
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type, (ch) => ch.charCodeAt(0));
  const crcInput = concat([typeBytes, data]);
  return concat([u32(data.length), crcInput, u32(crc32(crcInput))]);
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += alphabet[(triple >> 18) & 63];
    out += alphabet[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? alphabet[triple & 63] : "=";
  }
  return out;
}

/** zlib-wrapped uncompressed DEFLATE stored blocks (no native zlib / canvas). */
function zlibStore(raw: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [Uint8Array.of(0x78, 0x01)];
  const max = 65535;
  for (let off = 0; off < raw.length; off += max) {
    const slice = raw.subarray(off, Math.min(off + max, raw.length));
    const last = off + slice.length >= raw.length ? 1 : 0;
    const nlen = (~slice.length) & 0xffff;
    blocks.push(
      Uint8Array.of(
        last,
        slice.length & 0xff,
        (slice.length >> 8) & 0xff,
        nlen & 0xff,
        (nlen >> 8) & 0xff,
      ),
      slice,
    );
  }
  const body = concat(blocks);
  const sum = adler32(raw);
  return concat([body, u32(sum)]);
}

function matrixPngDataUri(
  text: string,
  pixelSize: number,
  marginModules: number,
  darkRgb: [number, number, number],
  lightRgb: [number, number, number],
): string {
  const qr = QRCode.create(text || " ", { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const dim = (n + marginModules * 2) * Math.max(1, Math.round(pixelSize / (n + marginModules * 2)));
  const scale = dim / (n + marginModules * 2);
  const w = dim;
  const h = dim;

  const stride = 1 + w * 3;
  const raw = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    raw[row] = 0;
    const my = Math.floor(y / scale) - marginModules;
    for (let x = 0; x < w; x++) {
      const mx = Math.floor(x / scale) - marginModules;
      const on = mx >= 0 && my >= 0 && mx < n && my < n && qr.modules.get(mx, my);
      const rgb = on ? darkRgb : lightRgb;
      const i = row + 1 + x * 3;
      raw[i] = rgb[0];
      raw[i + 1] = rgb[1];
      raw[i + 2] = rgb[2];
    }
  }

  const ihdr = concat([
    u32(w),
    u32(h),
    Uint8Array.of(8, 2, 0, 0, 0),
  ]);
  const png = concat([
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibStore(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
  return `data:image/png;base64,${bytesToBase64(png)}`;
}

export async function qrDataUri(text: string, size = 240): Promise<string> {
  return matrixPngDataUri(text, size, 1, [17, 24, 39], [255, 255, 255]);
}

/** High-contrast QR for thermal printers (pure black modules, quieter zone). */
export async function qrDataUriThermal(text: string, size = 280): Promise<string> {
  return matrixPngDataUri(text, size, 2, [0, 0, 0], [255, 255, 255]);
}
