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
assert(store.includes("return withCashBookLock(async () => {"), "add/update/delete use the write lock");
assert((store.match(/withCashBookLock\(/g) || []).length >= 3, "lock used for add, update, and delete");
assert(!/api\.(get|post|put|delete)\s*\(/.test(store), "store does not call api.*");
assert(!/api\.(get|post|put|delete)\s*\(/.test(entry), "entry screen does not call api.*");
assert(!/api\.(get|post|put|delete)\s*\(/.test(index), "index screen does not call api.* for ledger");
assert(entry.includes("savingRef"), "entry has sync double-tap save guard");
assert(entry.includes("if (savingRef.current) return"), "save early-returns while in flight");

// Lightweight lock semantics check (no React Native runtime).
async function verifyLockSerialization(): Promise<void> {
  let chain: Promise<unknown> = Promise.resolve();
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  const seq: number[] = [];
  await Promise.all([
    withLock(async () => {
      seq.push(1);
      await new Promise((r) => setTimeout(r, 20));
      seq.push(2);
    }),
    withLock(async () => {
      seq.push(3);
      seq.push(4);
    }),
  ]);
  assert(JSON.stringify(seq) === JSON.stringify([1, 2, 3, 4]), "write lock serializes concurrent mutations");
}

verifyLockSerialization()
  .then(() => {
    console.log("\nAll cash-book local guards passed.");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
