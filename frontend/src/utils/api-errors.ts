/**
 * Transport / auth / OCR user-facing error helpers (no React Native imports).
 * Safe for Node verify scripts.
 */

export type ApiErrorLike = {
  status?: number;
  detail?: string | Record<string, any>;
  code?: "NETWORK" | "TIMEOUT" | "ABORTED";
};

export const USER_CONNECT_ERROR =
  "Unable to connect to server. Please check your internet connection or try again.";

/** Generic transport timeout — never OCR-specific (login must not show OCR copy). */
export const GENERIC_TIMEOUT_USER_MESSAGE =
  "The server is taking too long to respond. Please try again.";

/** OCR-only timeout copy — used solely by Action Diary OCR requests. */
export const OCR_TIMEOUT_USER_MESSAGE =
  "OCR is still running longer than expected. Please try again with a clearer crop, or wait and retry.";

function detailText(err: ApiErrorLike | undefined): string {
  const d = err?.detail;
  if (typeof d === "string") return d;
  if (d && typeof d === "object" && "message" in d) return String((d as { message: unknown }).message);
  return "";
}

export function apiErrorMessage(e: unknown, fallback = "Request failed"): string {
  const err = e as ApiErrorLike | undefined;
  const status = typeof err?.status === "number" ? err.status : undefined;
  const text = detailText(err);

  if (status === 0) {
    if (err?.code === "TIMEOUT") {
      return text || GENERIC_TIMEOUT_USER_MESSAGE;
    }
    if (err?.code === "ABORTED") {
      return text || "Request cancelled.";
    }
    return USER_CONNECT_ERROR;
  }

  if (text) {
    if (typeof __DEV__ !== "undefined" && __DEV__ && status && status >= 400) {
      return `${fallback}: ${text} (${status})`;
    }
    return text;
  }
  if (status && status >= 400) {
    return typeof __DEV__ !== "undefined" && __DEV__ ? `${fallback} (${status})` : fallback;
  }
  return fallback;
}

/**
 * Login/signup error mapping — never surfaces OCR/extraction copy on auth screens.
 */
export function authErrorMessage(e: unknown, fallback = "Login failed"): string {
  const err = e as ApiErrorLike | undefined;
  const status = typeof err?.status === "number" ? err.status : undefined;
  const text = detailText(err);

  if (status === 0) {
    if (err?.code === "TIMEOUT") {
      return "Sign-in is taking longer than expected. The server may be waking up — please try again.";
    }
    if (err?.code === "ABORTED") {
      return "Sign-in was cancelled. Please try again.";
    }
    return USER_CONNECT_ERROR;
  }

  if (text && /OCR|extraction|clearer crop/i.test(text)) {
    return fallback;
  }

  if (status === 401 || status === 403) {
    return text || "Incorrect username or password";
  }
  if (text) {
    if (typeof __DEV__ !== "undefined" && __DEV__ && status && status >= 400) {
      return `${fallback}: ${text} (${status})`;
    }
    return text;
  }
  if (status && status >= 400) {
    return typeof __DEV__ !== "undefined" && __DEV__ ? `${fallback} (${status})` : fallback;
  }
  return fallback;
}
