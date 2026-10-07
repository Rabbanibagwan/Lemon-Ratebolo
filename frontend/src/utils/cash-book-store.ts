/**
 * Local Cash Book store for UI preview.
 * No backend Cash Book API exists yet — entries persist in device storage only.
 * Replace with GET/POST /cash-book when the backend is ready.
 */

import { storage } from "@/src/utils/storage";

export type CashBookSide = "CREDIT" | "DEBIT";

export type CashBookEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  side: CashBookSide;
  amount: number;
  description: string;
};

export type CashBookDay = {
  date: string;
  credits: CashBookEntry[];
  debits: CashBookEntry[];
  totalCredit: number;
  totalDebit: number;
  net: number;
};

const STORAGE_KEY = "cash_book_entries_v2";

/** Seed samples so design review has day-wise data on first open. */
const SEED: CashBookEntry[] = [
  { id: "seed-c1", date: "2026-09-17", side: "CREDIT", amount: 5000, description: "Cash Sale" },
  { id: "seed-c2", date: "2026-09-17", side: "CREDIT", amount: 2000, description: "Other Income" },
  { id: "seed-d1", date: "2026-09-17", side: "DEBIT", amount: 1000, description: "Hamali" },
  { id: "seed-d2", date: "2026-09-17", side: "DEBIT", amount: 500, description: "Transport" },
  { id: "seed-c3", date: "2026-09-18", side: "CREDIT", amount: 8500, description: "Vendor cash receipt" },
  { id: "seed-c4", date: "2026-09-18", side: "CREDIT", amount: 1200, description: "Cash Sale" },
  { id: "seed-d3", date: "2026-09-18", side: "DEBIT", amount: 3200, description: "Farmer payout" },
  { id: "seed-d4", date: "2026-09-18", side: "DEBIT", amount: 400, description: "Stationery" },
  { id: "seed-c5", date: "2026-09-19", side: "CREDIT", amount: 3100, description: "Cash Sale" },
  { id: "seed-d5", date: "2026-09-19", side: "DEBIT", amount: 900, description: "Hamali" },
  { id: "seed-d6", date: "2026-09-19", side: "DEBIT", amount: 150, description: "Tea / Misc" },
];

function sum(rows: CashBookEntry[]): number {
  return rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
}

function normalize(rows: unknown): CashBookEntry[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r: any) => ({
      id: String(r?.id || ""),
      date: String(r?.date || "").trim(),
      side: r?.side === "DEBIT" ? ("DEBIT" as const) : ("CREDIT" as const),
      amount: Number(r?.amount) || 0,
      description: String(r?.description || "").trim(),
    }))
    .filter((r) => r.id && r.date && r.amount > 0 && r.description);
}

function parseStored(saved: unknown): CashBookEntry[] {
  if (saved == null || saved === "") return [];
  let value: unknown = saved;
  // storage.setItem JSON-stringifies values; we also stringify the array once.
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
  return normalize(value);
}

async function persistEntries(entries: CashBookEntry[]): Promise<void> {
  const ok = await storage.setItem(STORAGE_KEY, JSON.stringify(entries));
  if (!ok) throw new Error("Could not save cash book entries");
}

export async function loadCashBookEntries(): Promise<CashBookEntry[]> {
  const saved = await storage.getItem<string>(STORAGE_KEY, "");
  if (!saved) {
    await persistEntries(SEED);
    return SEED.map((r) => ({ ...r }));
  }
  const rows = parseStored(saved);
  if (!rows.length) {
    await persistEntries(SEED);
    return SEED.map((r) => ({ ...r }));
  }
  return rows;
}

export async function addCashBookEntry(input: {
  side: CashBookSide;
  amount: number;
  description: string;
  date: string;
}): Promise<CashBookEntry> {
  const date = (input.date || "").trim();
  const description = (input.description || "").trim();
  const amount = Number(input.amount);
  if (!date) throw new Error("Date is required");
  if (!(amount > 0)) throw new Error("Amount is required");
  if (!description) throw new Error("Description is required");

  const entry: CashBookEntry = {
    id: `cb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date,
    side: input.side,
    amount,
    description,
  };
  const all = await loadCashBookEntries();
  const next = [...all, entry];
  await persistEntries(next);
  return entry;
}

export async function getCashBookEntryById(id: string): Promise<CashBookEntry | null> {
  const all = await loadCashBookEntries();
  return all.find((r) => r.id === id) || null;
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

  const all = await loadCashBookEntries();
  const idx = all.findIndex((r) => r.id === id);
  if (idx < 0) throw new Error("Entry not found");

  const prev = all[idx];
  const updated: CashBookEntry = {
    ...prev,
    amount,
    description,
  };
  const next = all.slice();
  next[idx] = updated;
  await persistEntries(next);
  return updated;
}

/** Remove one entry by id. Optionally pass the current in-memory list to avoid a stale reload race. */
export async function deleteCashBookEntry(
  id: string,
  current?: CashBookEntry[],
): Promise<CashBookEntry[]> {
  const all = current ? current.slice() : await loadCashBookEntries();
  const next = all.filter((r) => r.id !== id);
  if (next.length === all.length) throw new Error("Entry not found");
  await persistEntries(next);
  return next;
}

/**
 * Day-wise Cash Book: only rows whose `date` equals `isoDate`.
 * Other calendar days are never mixed in.
 */
export function getCashBookForDate(all: CashBookEntry[], isoDate: string): CashBookDay {
  const day = (isoDate || "").trim();
  const credits = all.filter((r) => r.date === day && r.side === "CREDIT");
  const debits = all.filter((r) => r.date === day && r.side === "DEBIT");
  const totalCredit = sum(credits);
  const totalDebit = sum(debits);
  return {
    date: day,
    credits,
    debits,
    totalCredit,
    totalDebit,
    net: totalCredit - totalDebit,
  };
}
