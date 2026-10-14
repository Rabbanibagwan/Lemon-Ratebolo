/**
 * Brand icon + sign-in logo + LemonLoader wiring guards.
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
  "assets/images/lemon-loader.png",
  "assets/images/splash-image.png",
  "assets/images/favicon.png",
];
for (const a of assets) {
  const p = join(root, a);
  assert(existsSync(p), `${a} exists`);
  assert(statSync(p).size > 5_000, `${a} has content`);
}

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

const loader = readFileSync(join(root, "src/components/LemonLoader.tsx"), "utf8");
assert(loader.includes("lemon-loader.png"), "LemonLoader uses lemon asset");
assert(loader.includes("withRepeat"), "LemonLoader animated");
assert(loader.includes("isReduceMotionEnabled"), "LemonLoader respects reduced motion");
assert(loader.includes('"small"') && loader.includes('"medium"') && loader.includes('"large"'), "size variants");

const ui = readFileSync(join(root, "src/components/ui.tsx"), "utf8");
assert(ui.includes("LemonLoader"), "Button loading uses LemonLoader");
assert(!ui.includes("ActivityIndicator"), "ui.tsx has no ActivityIndicator");

const screens = [
  "app/index.tsx",
  "app/search.tsx",
  "app/(tabs)/reports.tsx",
  "app/ocr/capture.tsx",
  "app/patti/[id].tsx",
  "app/vendor-bill/[id].tsx",
  "app/chart.tsx",
  "app/scan.tsx",
  "app/backup.tsx",
  "app/edit-patti.tsx",
];
for (const s of screens) {
  const src = readFileSync(join(root, s), "utf8");
  assert(src.includes("LemonLoader"), `${s} uses LemonLoader`);
  assert(!src.includes("ActivityIndicator"), `${s} has no ActivityIndicator`);
}

console.log("\nAll brand icon/loader guards passed.");
