/**
 * Guard: Cash Book uses live API persistence (not AsyncStorage as source of truth).
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
assert(!store.includes("SEED:"), "seed sample data removed from live store");
assert(!index.includes("NO LIVE API") && !index.includes("local entries"), "preview subtitle removed");
assert(index.includes("fetchCashBookDay"), "screen loads from API day endpoint");
assert(index.includes("Closing Balance"), "shows closing balance");
assert(entry.includes("addCashBookEntry"), "entry save uses store API wrapper");
assert(entry.includes("clientRequestId"), "entry creates with client request id");
assert(backend.includes("attach_cash_book"), "backend module attach present");
assert(backend.includes('"/cash-book/day"'), "backend day route present");
assert(server.includes("attach_cash_book"), "server wires cash_book module");
assert(server.includes("ensure_cash_book_indexes"), "startup creates cash_book indexes");

console.log("\nAll cash-book live API guards passed.");
