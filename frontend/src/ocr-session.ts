/** Persist OCR extraction across navigation / Strict Mode remounts. */

export type OcrExtractedRow = {
  lot_serial_no?: number | null;
  total_bags?: number | null;
  lot_no?: string | null;
  farmer_name?: string | null;
  vendor_name?: string | null;
  bags?: number | null;
  rate_per_bag?: number | null;
  bhada_total?: number | null;
  bhada_per_bag?: number | null;
};

const STORAGE_KEY = "lemon_ocr_session_v1";

type Stored = {
  rows: OcrExtractedRow[];
  model?: string;
  warning?: string;
};

function readStore(): Stored | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    return parsed as Stored;
  } catch {
    return null;
  }
}

function writeStore(data: Stored | null) {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (!data) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota / private mode */
  }
}

/** In-memory mirror so native (no sessionStorage quirks) still works in the same JS realm. */
let memory: Stored | null = null;
/** Photo reference for Review (kept in memory only — too large for sessionStorage). */
let memoryImageUri: string | null = null;

export function setOcrSession(
  rows: OcrExtractedRow[],
  meta?: { model?: string; warning?: string; imageUri?: string | null },
) {
  memory = { rows, model: meta?.model, warning: meta?.warning };
  if (meta && "imageUri" in meta) memoryImageUri = meta.imageUri || null;
  writeStore(memory);
}

export function setOcrImageUri(uri: string | null) {
  memoryImageUri = uri;
}

export function getOcrImageUri(): string | null {
  return memoryImageUri;
}

/** Read without clearing — safe under React Strict Mode double-mount. */
export function getOcrSession(): { rows: OcrExtractedRow[]; model?: string; warning?: string; imageUri?: string | null } {
  const stored = memory || readStore();
  if (!stored) return { rows: [], imageUri: memoryImageUri };
  memory = stored;
  return { rows: stored.rows || [], model: stored.model, warning: stored.warning, imageUri: memoryImageUri };
}

export function clearOcrSession() {
  memory = null;
  memoryImageUri = null;
  writeStore(null);
}

/** @deprecated use getOcrSession — kept for callers; does not clear. */
export function takeOcrSession(): { rows: OcrExtractedRow[]; model?: string; warning?: string } {
  return getOcrSession();
}

/** Demo rows so preview can be opened/tested without a vision API key. */
export const DEMO_OCR_ROWS: OcrExtractedRow[] = [
  { lot_serial_no: 1, total_bags: 5, farmer_name: "ABDG", vendor_name: "MM", bags: 2, rate_per_bag: 1000, bhada_per_bag: 50, bhada_total: 250 },
  { lot_serial_no: 1, total_bags: 5, farmer_name: "ABDG", vendor_name: "AB", bags: 2, rate_per_bag: 1000, bhada_per_bag: 50, bhada_total: 250 },
  { lot_serial_no: 1, total_bags: 5, farmer_name: "ABDG", vendor_name: "MC", bags: 1, rate_per_bag: 1000, bhada_per_bag: 50, bhada_total: 250 },
];

export const BLANK_LOT_ROWS: OcrExtractedRow[] = [
  { lot_serial_no: 1, total_bags: null, farmer_name: "", vendor_name: "", bags: null, rate_per_bag: null, bhada_per_bag: null },
];
