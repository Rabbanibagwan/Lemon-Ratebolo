/**
 * Preflight for Lemon Mandi preview/APK/iOS builds.
 * Confirms critical thermal paths cannot silently use system print.
 * Run: npx --yes tsx scripts/verify-release-preflight.ts
 */
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const root = join(__dirname, "../..");
const sha = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: root }).toString().trim();
const porcelain = execSync("git status --porcelain", { cwd: root }).toString();

console.log(`branch=${branch}`);
console.log(`sha=${sha}`);
console.log(`dirty=${porcelain.trim() ? "yes" : "no"}`);

check("git SHA readable", /^[0-9a-f]{40}$/.test(sha));
check(
  "on recovery or integrate branch (or main after merge)",
  /permanent-feature-recovery|integrate-cash-chart-upi|^main$/.test(branch) || branch === "HEAD",
);

const exportTs = readFileSync(join(__dirname, "../src/utils/reports-export.ts"), "utf8");
const individual = exportTs.match(/export async function thermalPrintDriverReport\([\s\S]*?\n\}/);
check("individual driver print requireBluetooth", !!individual && /requireBluetooth:\s*true/.test(individual[0]));
check("individual driver print no preferHtml", !!individual && !/preferHtml:\s*true/.test(individual[0]));

const list = exportTs.match(/export async function thermalPrintDriverDetailsReport\([\s\S]*?\n\}/);
check("driver list print requireBluetooth", !!list && /requireBluetooth:\s*true/.test(list[0]));

const vendor = exportTs.match(/export async function thermalPrintVendorDetailsReport\([\s\S]*?\n\}/);
check("vendor details print requireBluetooth", !!vendor && /requireBluetooth:\s*true/.test(vendor[0]));

const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));
check("pako declared dependency", typeof pkg.dependencies?.pako === "string");

const inventory = readFileSync(join(root, "docs/FEATURE_INVENTORY.md"), "utf8");
const checklist = readFileSync(join(root, "docs/RELEASE_CHECKLIST.md"), "utf8");
const provenance = readFileSync(join(root, "docs/BUILD_PROVENANCE.md"), "utf8");
const recovery = readFileSync(join(root, "docs/RECOVERY_REPORT.md"), "utf8");
const pkgScripts = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8")).scripts || {};
check("FEATURE_INVENTORY present", inventory.includes("Individual Driver Details PRINT") || inventory.includes("individual driver"));
check("RELEASE_CHECKLIST present", checklist.includes("verify:release") || checklist.includes("Before every preview"));
check("BUILD_PROVENANCE present", provenance.includes("gitCommitHash") || provenance.includes("Full commit SHA"));
check("RECOVERY_REPORT present", recovery.includes("Root cause") || recovery.includes("root cause"));
check("npm verify:release script", typeof pkgScripts["verify:release"] === "string");
check(
  "release gate script present",
  require("fs").existsSync(join(__dirname, "verify-release-gate.sh")),
);
check(
  "CI workflow present",
  require("fs").existsSync(join(root, ".github/workflows/lemon-mandi-verify.yml")),
);

console.log(`\n${pass} passed, ${fail} failed`);
console.log(`PROVENANCE_SHA=${sha}`);
if (fail) process.exit(1);
