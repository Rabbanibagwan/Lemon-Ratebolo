/**
 * Cash Book store — live API persistence via Lemon Mandi backend when available.
 *
 * If the deployed backend does not yet expose /cash-book (HTTP 404), fall back to
 * shop-scoped AsyncStorage so Credit/Debit keep working. Local rows are migrated
 * to the server (idempotent by local_id) the first time the live API is reachable.
 * Never treat seed samples as live data; never delete local rows until migration succeeds.
 */

import { api, apiErrorMessage, AUTH_SHOP_KEY, type ApiError } from "@/src/api";
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

/** "live" | "local" | null (unknown / probing) */
let modeCache: "live" | "local" | null = null;
let probeInflight: Promise<"live" | "local"> | null = null;

/** Serialize local read-modify-write so rapid saves cannot drop or duplicate via races. */
let writeChain: Promise<unknown> = Promise.resolve();

function withCashBookLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

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

function isNotFound(e: unknown): boolean {
  return (e as ApiError)?.status === 404;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100 + 1e-9) / 100;
}

function sum(rows: CashBookEntry[]): number {
  return round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
}

function emptyDay(date: string, opening = 0): CashBookDay {
  return {
    date,
    credits: [],
    debits: [],
    totalCredit: 0,
    totalDebit: 0,
    net: 0,
    openingBalance: opening,
    closingBalance: opening,
  };
}

function buildDay(date: string, all: CashBookEntry[]): CashBookDay {
  const credits = all.filter((r) => r.date === date && r.side === "CREDIT");
  const debits = all.filter((r) => r.date === date && r.side === "DEBIT");
  const totalCredit = sum(credits);
  const totalDebit = sum(debits);
  const net = round2(totalCredit - totalDebit);
  let opening = 0;
  for (const r of all) {
    if (r.date < date) {
      opening += r.side === "DEBIT" ? -Number(r.amount) : Number(r.amount);
    }
  }
  opening = round2(opening);
  return {
    date,
    credits,
    debits,
    totalCredit,
    totalDebit,
    net,
    openingBalance: opening,
    closingBalance: round2(opening + net),
  };
}

async function shopScopeKey(): Promise<string> {
  const raw = await storage.getItem<string>(AUTH_SHOP_KEY, "");
  let shop: { id?: string; shop_id?: string } | null = null;
  if (raw) {
    try {
      shop = typeof raw === "string" ? JSON.parse(raw) : (raw as any);
    } catch {
      shop = null;
    }
  }
  const sid = String(shop?.shop_id || shop?.id || "").trim() || "unknown";
  return `${LOCAL_LEGACY_KEY}:${sid}`;
}

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

async function readLocalEntries(): Promise<CashBookEntry[]> {
  const scoped = await shopScopeKey();
  let saved = await storage.getItem<string>(scoped, "");
  if (!saved) {
    // One-time absorb of pre-shop-scoped local rows (never seed samples).
    const legacy = await storage.getItem<string>(LOCAL_LEGACY_KEY, "");
    const rows = parseLegacyLocal(legacy);
    if (rows.length) {
      await storage.setItem(scoped, JSON.stringify(rows));
      saved = JSON.stringify(rows);
    }
  }
  return parseLegacyLocal(saved).map((r) => ({ ...r }));
}

async function writeLocalEntries(entries: CashBookEntry[]): Promise<void> {
  const scoped = await shopScopeKey();
  const ok = await storage.setItem(scoped, JSON.stringify(entries));
  if (!ok) throw new Error("Could not save Cash Book entries");
}

/**
 * Probe once whether the backend exposes Cash Book routes.
 * 404 → local fallback. Network/auth errors rethrow (caller shows error, not empty day).
 */
export async function resolveCashBookMode(force = false): Promise<"live" | "local"> {
  if (!force && modeCache) return modeCache;
  if (!force && probeInflight) return probeInflight;

  probeInflight = (async () => {
    try {
      await api.get<ApiDay>(`/cash-book/day?date=${encodeURIComponent("1970-01-01")}`);
      modeCache = "live";
      return "live";
    } catch (e) {
      if (isNotFound(e)) {
        modeCache = "local";
        return "local";
      }
      // Auth/network — do not cache as local; surface to caller.
      throw e;
    } finally {
      probeInflight = null;
    }
  })();

  return probeInflight;
}

/** Test helper — reset mode cache between isolated checks. */
export function __resetCashBookModeCacheForTests() {
  modeCache = null;
  probeInflight = null;
}

/** Load one calendar day's Cash Book (live API or local fallback). */
export async function fetchCashBookDay(isoDate: string): Promise<CashBookDay> {
  const date = (isoDate || "").trim();
  if (!date) throw new Error("Date is required");

  const mode = await resolveCashBookMode();
  if (mode === "live") {
    try {
      const day = await api.get<ApiDay>(`/cash-book/day?date=${encodeURIComponent(date)}`);
      return mapDay(day);
    } catch (e) {
      if (isNotFound(e)) {
        modeCache = "local";
        const all = await readLocalEntries();
        return buildDay(date, all);
      }
      throwApi(e, "Could not load Cash Book from server");
    }
  }

  const all = await readLocalEntries();
  return buildDay(date, all);
}

export async function getCashBookEntryById(id: string): Promise<CashBookEntry | null> {
  const mode = await resolveCashBookMode();
  if (mode === "live") {
    try {
      const row = await api.get<ApiEntry>(`/cash-book/entries/${encodeURIComponent(id)}`);
      return mapEntry(row);
    } catch (e) {
      const status = (e as ApiError)?.status;
      if (status === 404) {
        // Might be a still-local id while API just came online.
        const all = await readLocalEntries();
        return all.find((r) => r.id === id) || null;
      }
      throwApi(e, "Could not load Cash Book entry");
    }
  }
  const all = await readLocalEntries();
  return all.find((r) => r.id === id) || null;
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

  const mode = await resolveCashBookMode();
  if (mode === "live") {
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
      if (!isNotFound(e)) throwApi(e, "Could not save Cash Book entry");
      modeCache = "local";
    }
  }

  return withCashBookLock(async () => {
    const all = await readLocalEntries();
    // Idempotent local create by client_request_id encoded into id prefix when provided.
    const existing = all.find((r) => r.id === client_request_id);
    if (existing) return existing;
    const entry: CashBookEntry = {
      id: client_request_id,
      date,
      side: input.side,
      amount: round2(amount),
      description,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    all.push(entry);
    await writeLocalEntries(all);
    return entry;
  });
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

  const mode = await resolveCashBookMode();
  if (mode === "live") {
    try {
      const row = await api.put<ApiEntry>(`/cash-book/entries/${encodeURIComponent(id)}`, {
        amount,
        description,
      });
      return mapEntry(row);
    } catch (e) {
      if (!isNotFound(e)) throwApi(e, "Could not update Cash Book entry");
      modeCache = "local";
    }
  }

  return withCashBookLock(async () => {
    const all = await readLocalEntries();
    const idx = all.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error("Cash Book entry not found");
    const next = {
      ...all[idx],
      amount: round2(amount),
      description,
      updated_at: new Date().toISOString(),
    };
    all[idx] = next;
    await writeLocalEntries(all);
    return next;
  });
}

export async function deleteCashBookEntry(id: string): Promise<void> {
  const mode = await resolveCashBookMode();
  if (mode === "live") {
    try {
      await api.del(`/cash-book/entries/${encodeURIComponent(id)}`);
      return;
    } catch (e) {
      if (!isNotFound(e)) throwApi(e, "Could not delete Cash Book entry");
      modeCache = "local";
    }
  }

  await withCashBookLock(async () => {
    const all = await readLocalEntries();
    const next = all.filter((r) => r.id !== id);
    if (next.length === all.length) throw new Error("Cash Book entry not found");
    await writeLocalEntries(next);
  });
}

// ---------- Optional one-time local → server migration ----------

/** Peek at legacy local rows that are candidates for server import (never seed samples). */
export async function peekLegacyLocalCashBookEntries(): Promise<LegacyLocal[]> {
  const scoped = await readLocalEntries();
  if (scoped.length) return scoped;
  const saved = await storage.getItem<string>(LOCAL_LEGACY_KEY, "");
  return parseLegacyLocal(saved);
}

export async function wasLocalCashBookMigrated(): Promise<boolean> {
  const flag = await storage.getItem<string>(LOCAL_MIGRATED_FLAG, "");
  return flag === "1";
}

/**
 * Import non-seed local rows into the live backend (idempotent by local_id).
 * Leaves the original AsyncStorage payload intact until import succeeds.
 */
export async function migrateLegacyLocalCashBook(): Promise<{ imported: number; skipped: number }> {
  const rows = await peekLegacyLocalCashBookEntries();
  if (!rows.length) {
    await storage.setItem(LOCAL_MIGRATED_FLAG, "1");
    return { imported: 0, skipped: 0 };
  }

  let mode: "live" | "local";
  try {
    mode = await resolveCashBookMode(true);
  } catch {
    // Network error — do not mark migrated; try again later.
    return { imported: 0, skipped: rows.length };
  }
  if (mode !== "live") {
    return { imported: 0, skipped: rows.length };
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
    if (isNotFound(e)) {
      modeCache = "local";
      return { imported: 0, skipped: rows.length };
    }
    throwApi(e, "Could not migrate local Cash Book entries");
  }
}
