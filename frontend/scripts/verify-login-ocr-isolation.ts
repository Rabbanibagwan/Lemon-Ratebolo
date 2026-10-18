/**
 * Login must never display OCR timeout/extraction copy.
 * OCR must still receive OCR-specific timeout messaging.
 *
 * Run: npx --yes tsx scripts/verify-login-ocr-isolation.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

import {
  apiErrorMessage,
  authErrorMessage,
  GENERIC_TIMEOUT_USER_MESSAGE,
  OCR_TIMEOUT_USER_MESSAGE,
  type ApiErrorLike,
} from "../src/utils/api-errors";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

const ocrTimeoutErr: ApiErrorLike = {
  status: 0,
  code: "TIMEOUT",
  detail: OCR_TIMEOUT_USER_MESSAGE,
};

const genericTimeoutErr: ApiErrorLike = {
  status: 0,
  code: "TIMEOUT",
  detail: GENERIC_TIMEOUT_USER_MESSAGE,
};

const networkErr: ApiErrorLike = {
  status: 0,
  code: "NETWORK",
  detail: "Unable to connect to server. Please check your internet connection or try again.",
};

const badCreds: ApiErrorLike = {
  status: 401,
  detail: "Incorrect username or password",
};

// --- authErrorMessage never surfaces OCR copy ---
assert(
  !/OCR|clearer crop|extraction/i.test(authErrorMessage(ocrTimeoutErr, "Login failed")),
  "authErrorMessage strips OCR timeout copy",
);
assert(
  /sign-in|try again|server/i.test(authErrorMessage(genericTimeoutErr, "Login failed")),
  "authErrorMessage timeout is login-specific",
);
assert(
  authErrorMessage(badCreds, "Login failed") === "Incorrect username or password",
  "authErrorMessage preserves invalid credentials",
);
assert(
  /internet|connect/i.test(authErrorMessage(networkErr, "Login failed")),
  "authErrorMessage network is connection-oriented",
);

// --- apiErrorMessage still returns OCR copy when detail is OCR ---
assert(
  apiErrorMessage(ocrTimeoutErr, "OCR failed") === OCR_TIMEOUT_USER_MESSAGE,
  "apiErrorMessage preserves OCR timeout detail for OCR callers",
);
assert(
  apiErrorMessage(genericTimeoutErr, "Request failed") === GENERIC_TIMEOUT_USER_MESSAGE,
  "apiErrorMessage preserves generic timeout detail",
);

// --- Source wiring ---
const root = join(__dirname, "..");
const apiSrc = readFileSync(join(root, "src/api.ts"), "utf8");
const loginSrc = readFileSync(join(root, "app/login.tsx"), "utf8");
const signupSrc = readFileSync(join(root, "app/signup.tsx"), "utf8");
const authSrc = readFileSync(join(root, "src/context/AuthContext.tsx"), "utf8");
const captureSrc = readFileSync(join(root, "app/ocr/capture.tsx"), "utf8");

assert(
  !apiSrc.includes('"OCR is still running longer than expected') ||
    apiSrc.includes("OCR_TIMEOUT_USER_MESSAGE"),
  "OCR timeout string is a named constant, not hardcoded only in request()",
);
assert(
  /detail:\s*timedOut\s*\?\s*\(opts\.timeoutDetail\s*\|\|\s*GENERIC_TIMEOUT_USER_MESSAGE\)/.test(
    apiSrc.replace(/\s+/g, " "),
  ) || apiSrc.includes("opts.timeoutDetail || GENERIC_TIMEOUT_USER_MESSAGE"),
  "request() default timeout detail is generic (not OCR)",
);
assert(loginSrc.includes("authErrorMessage"), "login uses authErrorMessage");
assert(!loginSrc.includes("apiErrorMessage"), "login does not use apiErrorMessage");
assert(signupSrc.includes("authErrorMessage"), "signup uses authErrorMessage");
assert(loginSrc.includes("submittingRef"), "login has duplicate-submit guard");
assert(authSrc.includes("AUTH_API_TIMEOUT_MS"), "AuthContext uses AUTH_API_TIMEOUT_MS");
assert(/\/auth\/login[\s\S]*?AUTH_API_TIMEOUT_MS/.test(authSrc), "login path uses AUTH timeout");
assert(/AUTH_API_TIMEOUT_MS\s*=\s*120_000/.test(apiSrc), "auth timeout allows Render cold start");
assert(captureSrc.includes("OCR_TIMEOUT_USER_MESSAGE"), "OCR capture passes OCR timeout detail");
assert(
  /timeoutDetail:\s*OCR_TIMEOUT_USER_MESSAGE/.test(captureSrc),
  "OCR post sets timeoutDetail to OCR message",
);
assert(
  !loginSrc.includes("OCR is still running"),
  "login.tsx has no OCR timeout string",
);
assert(apiSrc.includes('from "@/src/utils/api-errors"'), "api.ts re-exports pure error helpers");

console.log("\nAll login/OCR isolation checks passed.");
