/**
 * Farmer Report must load the full day (raised limit) and match Dashboard eligibility.
 * Layout must not crush columns on mobile (fixed widths + horizontal scroll).
 *
 * Run: npx --yes tsx scripts/verify-farmer-report-totals.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

const root = join(__dirname, "..");
const reports = readFileSync(join(root, "app/(tabs)/reports.tsx"), "utf8");
const auction = readFileSync(join(root, "app/(tabs)/auction.tsx"), "utf8");
const history = readFileSync(join(root, "app/(tabs)/history.tsx"), "utf8");
const exportTs = readFileSync(join(root, "src/utils/reports-export.ts"), "utf8");
const server = readFileSync(join(root, "../backend/server.py"), "utf8");
const gate = readFileSync(join(root, "scripts/verify-release-gate.sh"), "utf8");

assert(reports.includes("limit=10000"), "Reports requests date-scoped pattis with limit=10000");
assert(auction.includes("limit=10000"), "Auction Book requests limit=10000");
assert(history.includes("limit=10000"), "History date filter requests limit=10000");
assert(reports.includes("farmWMoney"), "Farmer Details uses fixed money column widths");
assert(reports.includes("farmThRow"), "Farmer Details header uses fixed-width row");
assert(reports.includes("ScrollView horizontal"), "Farmer Details allows horizontal scroll");
assert(reports.includes("useFocusEffect"), "Reports auto-refreshes on focus");
assert(reports.includes("ActivityIndicator"), "Reports uses circular ActivityIndicator");
assert(!reports.includes("LemonLoader"), "Reports has no LemonLoader");

assert(exportTs.includes("export function farmerTotals"), "farmerTotals helper exists");
assert(
  exportTs.includes("driverDetailTotals(pattis") && exportTs.includes("net_payable"),
  "farmerTotals sums net_payable via shared helper (same field as dashboard payout)",
);
assert(exportTs.includes("total_bags += p.total_bags"), "farmerTotals sums total_bags");

assert(server.includes("10000 if date else 500"), "Backend defaults to 10000 when date is set");
assert(server.includes("/reports/reconcile-day"), "Backend exposes reconcile-day diagnostic");
assert(server.includes("_dashboard_patti_agg"), "Dashboard aggregation is shared helper");

assert(gate.includes("farmer-report-totals"), "Release gate includes farmer-report-totals");

console.log("\nAll farmer-report-totals guards passed.");
