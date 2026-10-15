/**
 * Cash Book store — live API persistence via Lemon Mandi backend.
 * Local AsyncStorage is only used for optional one-time migration of prior
 * device-only draft rows (never treated as the live source of truth).
 */

import { api, apiErrorMessage, type ApiError } from "@/src/api";
import { storage } from "@/src/utils/storage";

export type CashBookSide = "CREDIT" | "DEBIT";

export type CashBookEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  side: CashBookSide;
  amount: number;
  description: string;
  created_at?: string;
  updated_at?: string;
};

export type CashBookDay = {
  date: string;
  credits: CashBookEntry[];
  debits: CashBookEntry[];
  totalCredit: number;
  totalDebit: number;
  net: number;
  openingBalance: number;
  closingBalance: number;
};

const LOCAL_LEGACY_KEY = "cash_book_entries_v2";
const LOCAL_MIGRATED_FLAG = "cash_book_local_migrated_v1";

type ApiEntry = {
  id: string;
  shop_id?: string;
  side: string;
  amount: number;
  description: string;
  date: string;
  created_at?: string;
  updated_at?: string;
};

type ApiDay = {
  date: string;
  credits: ApiEntry[];
  debits: ApiEntry[];
  total_credit: number;
  total_debit: number;
  net: number;
  opening_balance: number;
  closing_balance: number;
};

function mapEntry(r: ApiEntry): CashBookEntry {
  return {
    id: String(r.id),
    date: String(r.date || "").trim(),
    side: r.side === "DEBIT" ? "DEBIT" : "CREDIT",
    amount: Number(r.amount) || 0,
    description: String(r.description || "").trim(),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function mapDay(d: ApiDay): CashBookDay {
  return {
    date: d.date,
    credits: (d.credits || []).map(mapEntry),
    debits: (d.debits || []).map(mapEntry),
    totalCredit: Number(d.total_credit) || 0,
    totalDebit: Number(d.total_debit) || 0,
    net: Number(d.net) || 0,
    openingBalance: Number(d.opening_balance) || 0,
    closingBalance: Number(d.closing_balance) || 0,
  };
}

function throwApi(e: unknown, fallback: string): never {
  const msg = apiErrorMessage(e, fallback);
  const err = new Error(msg) as Error & { status?: number; cause?: unknown };
  err.status = (e as ApiError)?.status;
  err.cause = e;
  throw err;
}

/** Load one calendar day's Cash Book from the live backend. */
export async function fetchCashBookDay(isoDate: string): Promise<CashBookDay> {
  const date = (isoDate || "").trim();
  if (!date) throw new Error("Date is required");
  try {
    const day = await api.get<ApiDay>(`/cash-book/day?date=${encodeURIComponent(date)}`);
    return mapDay(day);
  } catch (e) {
    throwApi(e, "Could not load Cash Book from server");
  }
}

export async function getCashBookEntryById(id: string): Promise<CashBookEntry | null> {
  try {
    const row = await api.get<ApiEntry>(`/cash-book/entries/${encodeURIComponent(id)}`);
    return mapEntry(row);
  } catch (e) {
    const status = (e as ApiError)?.status;
    if (status === 404) return null;
    throwApi(e, "Could not load Cash Book entry");
  }
}

export async function addCashBookEntry(input: {
  side: CashBookSide;
  amount: number;
  description: string;
  date: string;
  clientRequestId?: string;
}): Promise<CashBookEntry> {
  const date = (input.date || "").trim();
  const description = (input.description || "").trim();
  const amount = Number(input.amount);
  if (!date) throw new Error("Date is required");
  if (!(amount > 0)) throw new Error("Amount is required");
  if (!description) throw new Error("Description is required");

  const client_request_id =
    (input.clientRequestId || "").trim() ||
    `cb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  try {
    const row = await api.post<ApiEntry>("/cash-book/entries", {
      side: input.side,
      amount,
      description,
      date,
      client_request_id,
    });
    return mapEntry(row);
  } catch (e) {
    throwApi(e, "Could not save Cash Book entry");
  }
}

/**
 * Update amount/description only. Date and side stay unchanged so the entry
 * remains on its original calendar day.
 */
export async function updateCashBookEntry(
  id: string,
  input: { amount: number; description: string },
): Promise<CashBookEntry> {
  const description = (input.description || "").trim();
  const amount = Number(input.amount);
  if (!(amount > 0)) throw new Error("Amount is required");
  if (!description) throw new Error("Description is required");

  try {
    const row = await api.put<ApiEntry>(`/cash-book/entries/${encodeURIComponent(id)}`, {
      amount,
      description,
    });
    return mapEntry(row);
  } catch (e) {
    throwApi(e, "Could not update Cash Book entry");
  }
}

export async function deleteCashBookEntry(id: string): Promise<void> {
  try {
    await api.del(`/cash-book/entries/${encodeURIComponent(id)}`);
  } catch (e) {
    throwApi(e, "Could not delete Cash Book entry");
  }
}

// ---------- Optional one-time local → server migration ----------

type LegacyLocal = {
  id: string;
  date: string;
  side: CashBookSide;
  amount: number;
  description: string;
};

function parseLegacyLocal(saved: unknown): LegacyLocal[] {
  if (saved == null || saved === "") return [];
  let value: unknown = saved;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((r: any) => ({
      id: String(r?.id || ""),
      date: String(r?.date || "").trim(),
      side: (r?.side === "DEBIT" ? "DEBIT" : "CREDIT") as CashBookSide,
      amount: Number(r?.amount) || 0,
      description: String(r?.description || "").trim(),
    }))
    .filter((r) => r.id && !r.id.startsWith("seed-") && r.date && r.amount > 0 && r.description);
}

/** Peek at legacy local rows that are candidates for server import (never seed samples). */
export async function peekLegacyLocalCashBookEntries(): Promise<LegacyLocal[]> {
  const saved = await storage.getItem<string>(LOCAL_LEGACY_KEY, "");
  return parseLegacyLocal(saved);
}

export async function wasLocalCashBookMigrated(): Promise<boolean> {
  const flag = await storage.getItem<string>(LOCAL_MIGRATED_FLAG, "");
  return flag === "1";
}

/**
 * Import non-seed local rows into the live backend (idempotent by local_id).
 * Leaves the original AsyncStorage payload intact until the caller confirms.
 */
export async function migrateLegacyLocalCashBook(): Promise<{ imported: number; skipped: number }> {
  const rows = await peekLegacyLocalCashBookEntries();
  if (!rows.length) {
    await storage.setItem(LOCAL_MIGRATED_FLAG, "1");
    return { imported: 0, skipped: 0 };
  }
  try {
    const res = await api.post<{ imported: number; skipped: number }>("/cash-book/import-local", {
      entries: rows.map((r) => ({
        local_id: r.id,
        side: r.side,
        amount: r.amount,
        description: r.description,
        date: r.date,
      })),
    });
    await storage.setItem(LOCAL_MIGRATED_FLAG, "1");
    return { imported: Number(res.imported) || 0, skipped: Number(res.skipped) || 0 };
  } catch (e) {
    throwApi(e, "Could not migrate local Cash Book entries");
  }
}
