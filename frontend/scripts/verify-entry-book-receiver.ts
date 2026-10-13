/**
 * Guard: Entry Book Patti rows open focused receiver entry (same as Scan),
 * not the full Farmer Patti details screen first.
 */
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const reports = readFileSync(join(root, "app/(tabs)/reports.tsx"), "utf8");
const patti = readFileSync(join(root, "app/patti/[id].tsx"), "utf8");

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

assert(
  /pathname:\s*["']\/patti\/\[id\]["']/.test(reports) && /from:\s*["']entry["']/.test(reports),
  "Entry Book navigates to /patti/[id] with from=entry",
);
assert(patti.includes('fromScreen === "entry"') || patti.includes("fromEntryBook"), "Patti detail recognizes from=entry");
assert(patti.includes("openReceiverDirect"), "direct receiver path shared by Scan + Entry Book");
assert(patti.includes("leaveDirectReceiver"), "direct receiver leave handler present");
assert(/fromScan\s*\|\|\s*fromEntryBook/.test(patti) || /fromEntryBook\s*\|\|\s*fromScan/.test(patti), "Entry Book included in direct-open gate");

console.log("\nAll Entry Book receiver-focus guards passed.");
