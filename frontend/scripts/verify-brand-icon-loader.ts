/**
 * Brand icon + sign-in logo guards (circular ActivityIndicator restored).
 * Run: npx --yes tsx scripts/verify-brand-icon-loader.ts
 */
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

const assets = [
  "assets/images/icon.png",
  "assets/images/adaptive-icon.png",
  "assets/images/lemon-mandi-logo.png",
  "assets/images/splash-image.png",
  "assets/images/favicon.png",
];
for (const a of assets) {
  const p = join(root, a);
  assert(existsSync(p), `${a} exists`);
  assert(statSync(p).size > 5_000, `${a} has content`);
}

assert(!existsSync(join(root, "src/components/LemonLoader.tsx")), "LemonLoader component removed");
assert(!existsSync(join(root, "assets/images/lemon-loader.png")), "lemon-loader asset removed");

const appJson = readFileSync(join(root, "app.json"), "utf8");
assert(appJson.includes('"./assets/images/icon.png"'), "app.json icon path");
assert(appJson.includes('"./assets/images/adaptive-icon.png"'), "app.json adaptive icon");
assert(appJson.includes('"backgroundColor": "#FFFFFF"'), "adaptive icon cream/white background");
assert(!appJson.includes('"backgroundColor": "#000000"'), "adaptive/splash not black");

const login = readFileSync(join(root, "app/login.tsx"), "utf8");
assert(login.includes("BrandLogo"), "login uses BrandLogo");
assert(login.includes("login-brand-logo"), "login brand testID");
assert(!login.includes("brandGlyph"), "old triangle glyph removed");

const brand = readFileSync(join(root, "src/components/BrandLogo.tsx"), "utf8");
assert(brand.includes("lemon-mandi-logo.png"), "BrandLogo uses official logo asset");
assert(brand.includes("withRepeat"), "BrandLogo breathing animation");
assert(brand.includes("isReduceMotionEnabled"), "BrandLogo respects reduced motion");
assert(brand.includes("0.95") && brand.includes("1.03"), "BrandLogo zoom range ~95–103%");

const ui = readFileSync(join(root, "src/components/ui.tsx"), "utf8");
assert(ui.includes("ActivityIndicator"), "Button loading uses ActivityIndicator");
assert(!ui.includes("LemonLoader"), "ui.tsx has no LemonLoader");

const screens: Array<{ path: string; expectIndicator?: boolean }> = [
  { path: "app/index.tsx" },
  { path: "app/search.tsx" },
  { path: "app/(tabs)/reports.tsx" },
  { path: "app/ocr/capture.tsx" },
  { path: "app/patti/[id].tsx" },
  { path: "app/vendor-bill/[id].tsx" },
  { path: "app/chart.tsx" },
  { path: "app/scan.tsx" },
  { path: "app/backup.tsx" },
  { path: "app/edit-patti.tsx" },
  { path: "app/account-ledger/[kind]/[id].tsx" },
];
for (const s of screens) {
  const src = readFileSync(join(root, s.path), "utf8");
  assert(src.includes("ActivityIndicator"), `${s.path} uses ActivityIndicator`);
  assert(!src.includes("LemonLoader"), `${s.path} has no LemonLoader`);
}

const cashEntry = readFileSync(join(root, "app/cash-book/entry.tsx"), "utf8");
assert(!cashEntry.includes("LemonLoader"), "cash-book/entry has no LemonLoader");

console.log("\nAll brand icon + circular loader guards passed.");
