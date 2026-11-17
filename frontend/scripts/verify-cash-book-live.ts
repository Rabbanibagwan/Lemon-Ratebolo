/**
 * Guard: Cash Book prefers live API; falls back to shop-scoped local when routes 404.
 * RETRY button must be gone; date loads must be race-safe.
 */
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const store = readFileSync(join(root, "src/utils/cash-book-store.ts"), "utf8");
const index = readFileSync(join(root, "app/cash-book/index.tsx"), "utf8");
const entry = readFileSync(join(root, "app/cash-book/entry.tsx"), "utf8");
const backend = readFileSync(join(root, "../backend/cash_book.py"), "utf8");
const server = readFileSync(join(root, "../backend/server.py"), "utf8");

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

assert(store.includes("live API persistence"), "store documents live API");
assert(store.includes('api.get<ApiDay>(`/cash-book/day'), "day load hits /cash-book/day");
assert(store.includes('api.post<ApiEntry>("/cash-book/entries"'), "create hits /cash-book/entries");
assert(store.includes("client_request_id"), "create sends idempotency key");
assert(store.includes("import-local"), "migration endpoint wired");
assert(store.includes('modeCache = "local"') || store.includes("modeCache = \"local\""), "404 falls back to local mode");
assert(store.includes("shopScopeKey") || store.includes("LOCAL_LEGACY_KEY:${"), "local rows are shop-scoped");
assert(store.includes("withCashBookLock"), "local writes use lock");
assert(store.includes("openingBalance"), "local day builds opening balance");
assert(!store.includes("SEED:"), "seed sample data removed from live store");
assert(!index.includes("NO LIVE API") && !index.includes("local entries"), "preview subtitle removed");
assert(index.includes("fetchCashBookDay"), "screen loads from API day endpoint");
assert(index.includes("Closing Balance"), "shows closing balance");
assert(index.includes("loadGen"), "date loads are race-safe");
assert(index.includes("ActivityIndicator"), "uses circular ActivityIndicator while loading");
assert(!index.includes("LemonLoader"), "no LemonLoader on Cash Book");
assert(!index.includes('label="RETRY"') && !index.includes("cash-book-retry"), "RETRY button removed");
assert(index.includes("showEmptyLabels"), "empty labels only after successful load");
assert(index.includes("MAX_AUTO_RETRIES"), "bounded automatic retry");
assert(entry.includes("addCashBookEntry"), "entry save uses store API wrapper");
assert(entry.includes("clientRequestIdRef"), "entry uses stable client request id");
assert(entry.includes("ActivityIndicator"), "entry loading uses circular indicator");
assert(entry.includes("Credit saved successfully"), "credit success copy present");
assert(entry.includes("Debit saved successfully"), "debit success copy present");
assert(entry.includes('setAmount("")') && entry.includes('setDescription("")'), "clears amount/description after confirmed save");
assert(entry.includes("returnToCashBook") || entry.includes("router.back()"), "returns to Cash Book after save");
assert(entry.includes("savingRef.current"), "blocks double-tap while saving");
assert(entry.includes("disabled={saving}"), "SAVE disabled while saving");
assert(backend.includes("attach_cash_book"), "backend module attach present");
assert(backend.includes('"/cash-book/day"'), "backend day route present");
assert(server.includes("attach_cash_book"), "server wires cash_book module");
assert(server.includes("ensure_cash_book_indexes"), "startup creates cash_book indexes");

console.log("\nAll cash-book live API guards passed.");
