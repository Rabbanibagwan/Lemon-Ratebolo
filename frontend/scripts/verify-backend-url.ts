/**
 * Public HTTPS web previews must resolve the production API — never 127.0.0.1.
 * Run: npx --yes tsx scripts/verify-backend-url.ts
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
const apiSrc = readFileSync(join(root, "src/api.ts"), "utf8");
const eas = JSON.parse(readFileSync(join(root, "eas.json"), "utf8"));
const envExample = readFileSync(join(root, ".env.example"), "utf8");

const PROD = "https://lemon-ratebolo.onrender.com";

assert(
  apiSrc.includes(`PRODUCTION_BACKEND_URL = "${PROD}"`) ||
    apiSrc.includes(`PRODUCTION_BACKEND_URL="${PROD}"`),
  "api.ts exports PRODUCTION_BACKEND_URL pointing at production",
);
assert(
  /return\s+PRODUCTION_BACKEND_URL/.test(apiSrc),
  "resolveBackendBase falls back to PRODUCTION_BACKEND_URL for public web hosts",
);
assert(
  /Public web preview|public host|Cloudflare|trycloudflare|hosted SPA/i.test(apiSrc),
  "api.ts documents public-web fallback rationale",
);
assert(
  !/trycloudflare\.com/.test(apiSrc),
  "api.ts does not hardcode temporary Cloudflare tunnel URLs",
);

const previewEnv = eas?.build?.preview?.env?.EXPO_PUBLIC_BACKEND_URL;
const prodEnv = eas?.build?.production?.env?.EXPO_PUBLIC_BACKEND_URL;
assert(previewEnv === PROD, "eas.json preview EXPO_PUBLIC_BACKEND_URL is production");
assert(prodEnv === PROD, "eas.json production EXPO_PUBLIC_BACKEND_URL is production");

assert(
  envExample.includes("EXPO_PUBLIC_BACKEND_URL") && envExample.includes(PROD),
  ".env.example documents production EXPO_PUBLIC_BACKEND_URL",
);

console.log("verify-backend-url: OK");
