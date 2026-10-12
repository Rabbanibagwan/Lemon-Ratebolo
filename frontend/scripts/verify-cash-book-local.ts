/**
 * Guard: Cash Book is device-local only (no backend API calls in store / entry path).
 * Also sanity-checks the write-lock helper exists for rapid-save races.
 */
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const store = readFileSync(join(root, "src/utils/cash-book-store.ts"), "utf8");
const entry = readFileSync(join(root, "app/cash-book/entry.tsx"), "utf8");
const index = readFileSync(join(root, "app/cash-book/index.tsx"), "utf8");

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

assert(store.includes("No backend Cash Book API"), "store documents local-only persistence");
assert(store.includes("STORAGE_KEY") && store.includes("cash_book_entries_v2"), "uses local storage key");
assert(store.includes("withCashBookLock"), "write lock serializes local mutations");
assert(!/api\.(get|post|put|delete)\s*\(/.test(store), "store does not call api.*");
assert(!/api\.(get|post|put|delete)\s*\(/.test(entry), "entry screen does not call api.*");
assert(!/api\.(get|post|put|delete)\s*\(/.test(index), "index screen does not call api.* for ledger");
assert(entry.includes("savingRef"), "entry has sync double-tap save guard");

console.log("\nAll cash-book local guards passed.");
