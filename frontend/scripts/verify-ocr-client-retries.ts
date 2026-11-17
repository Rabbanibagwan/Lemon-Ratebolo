/**
 * Guard: OCR client retries stay bounded and do not multiply provider load.
 * Also confirms the documented Gemini fallback chain defaults stay referenced
 * in backend ocr_service.py (no live Gemini calls).
 */
import { readFileSync } from "fs";
import { join } from "path";

const root = join(__dirname, "..");
const capture = readFileSync(join(root, "app/ocr/capture.tsx"), "utf8");
const backendOcr = readFileSync(join(root, "../backend/ocr_service.py"), "utf8");

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

assert(/maxClientRetries\s*=\s*1/.test(capture), "client maxClientRetries is 1");
assert(capture.includes("serverAlreadyRetried"), "skips retry when server returned attempts");
assert(capture.includes("transportOnly"), "only transport failures may client-retry");
assert(capture.includes('code !== "TIMEOUT"') || capture.includes("!== \"TIMEOUT\""), "TIMEOUT is not auto-retried");
assert(capture.includes("inFlightRef"), "in-flight guard prevents duplicate OCR submits");

assert(backendOcr.includes('DEFAULT_PRIMARY_MODEL = "gemini-2.5-flash"'), "primary model intact");
assert(backendOcr.includes('DEFAULT_FALLBACK_MODEL = "gemini-2.5-flash-lite"'), "fallback 1 intact");
assert(backendOcr.includes('DEFAULT_FALLBACK_MODEL_2 = "gemini-3.5-flash-lite"'), "fallback 2 intact");
assert(backendOcr.includes("class _ProviderSlot"), "provider slot helper present");
assert(backendOcr.includes("OCR_QUEUE_WAIT_TIMEOUT_SEC"), "queue wait timeout configured");
assert(backendOcr.includes("concurrency_scope"), "metrics declare process scope");
assert(backendOcr.includes("queue_wait_ms"), "queue wait observability present");

console.log("\nAll OCR client/retry/chain guards passed.");
