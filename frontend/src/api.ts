import { Platform } from "react-native";
import { storage } from "@/src/utils/storage";

export const AUTH_TOKEN_KEY = "lm.auth.token";
export const AUTH_SHOP_KEY = "lm.auth.shop";

const USER_CONNECT_ERROR =
  "Unable to connect to server. Please check your internet connection or try again.";

function stripSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Single API origin for every request.
 * Source of truth: EXPO_PUBLIC_BACKEND_URL (.env for local, eas.json / .env.device for hosted).
 * Web + loopback only: rewrite hostname to the page host so localhost vs 127.0.0.1 does not break fetch.
 */
export function resolveBackendBase(): string {
  const fromEnv = stripSlash(process.env.EXPO_PUBLIC_BACKEND_URL || "");
  if (fromEnv) {
    if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.hostname) {
      try {
        const u = new URL(fromEnv);
        if (isLoopbackHost(u.hostname) && isLoopbackHost(window.location.hostname)) {
          const port = u.port ? `:${u.port}` : "";
          return `${u.protocol}//${window.location.hostname}${port}`;
        }
      } catch {
        /* use env as-is */
      }
    }
    return fromEnv;
  }
  if (Platform.OS === "web" && typeof window !== "undefined" && isLoopbackHost(window.location.hostname)) {
    return `${window.location.protocol}//${window.location.hostname}:8001`;
  }
  return "http://127.0.0.1:8001";
}

export type ApiError = {
  status: number;
  detail: string | Record<string, any>;
  /** Transport-level classification when status === 0 */
  code?: "NETWORK" | "TIMEOUT" | "ABORTED";
};

export type RequestOptions = {
  auth?: boolean;
  /** Abort / fail after this many ms. OCR needs a long window (e.g. 180000). */
  timeoutMs?: number;
  signal?: AbortSignal;
};

async function request<T>(path: string, init: RequestInit = {}, opts: RequestOptions = {}): Promise<T> {
  const auth = opts.auth !== false;
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (auth) {
    const token = await storage.secureGet<string>(AUTH_TOKEN_KEY, "");
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const url = `${resolveBackendBase()}/api${path}`;

  const controller = new AbortController();
  const external = opts.signal || init.signal;
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  }

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, signal: controller.signal });
  } catch (e: any) {
    const name = e?.name || "";
    const msg = String(e?.message || e || "");
    const aborted = name === "AbortError" || /aborted|abort/i.test(msg);
    if (aborted) {
      const timedOut = !!opts.timeoutMs && (!external || !external.aborted);
      if (__DEV__) console.warn(timedOut ? "API timeout" : "API aborted", url, opts.timeoutMs);
      throw {
        status: 0,
        code: timedOut ? "TIMEOUT" : "ABORTED",
        detail: timedOut
          ? "OCR is still running longer than expected. Please try again with a clearer crop, or wait and retry."
          : "Request cancelled.",
      } as ApiError;
    }
    console.warn("API unreachable", resolveBackendBase(), msg);
    throw { status: 0, code: "NETWORK", detail: USER_CONNECT_ERROR } as ApiError;
  } finally {
    if (timer) clearTimeout(timer);
    if (external) external.removeEventListener("abort", onExternalAbort);
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    // Preserve structured error details (dict) as-is so callers can inspect e.detail.code, e.detail.message, etc.
    // Falls back to text or a generic string when detail is not present.
    let detail: string | Record<string, any> = "Request failed";
    if (data && typeof data === "object") {
      if (data.detail !== undefined) {
        detail = data.detail; // may be string or object
      } else if (data.message !== undefined) {
        detail = data.message;
      }
    } else if (text) {
      detail = text;
    }
    throw { status: res.status, detail } as ApiError;
  }
  return data as T;
}

function safeJson(t: string): any {
  try { return JSON.parse(t); } catch { return t; }
}

export function apiErrorMessage(e: unknown, fallback = "Request failed"): string {
  const err = e as ApiError | undefined;
  const status = typeof err?.status === "number" ? err.status : undefined;
  const d = err?.detail;
  const text =
    typeof d === "string"
      ? d
      : d && typeof d === "object" && "message" in d
        ? String((d as { message: unknown }).message)
        : "";

  // Transport failure only (fetch threw). HTTP 4xx/5xx must not be shown as "no internet".
  if (status === 0) {
    if (err?.code === "TIMEOUT") {
      return text || "The extraction is taking longer than expected. Please try again.";
    }
    if (err?.code === "ABORTED") {
      return text || "Request cancelled.";
    }
    return USER_CONNECT_ERROR;
  }

  if (text) {
    if (__DEV__ && status && status >= 400) {
      return `${fallback}: ${text} (${status})`;
    }
    return text;
  }
  if (status && status >= 400) {
    return __DEV__ ? `${fallback} (${status})` : fallback;
  }
  return fallback;
}

/** Default request timeout — short CRUD. OCR uses a longer explicit timeout. */
export const DEFAULT_API_TIMEOUT_MS = 45_000;
/** Action Diary photo OCR: upload + Gemini + parse. Generous wall clock so slow pages don't false-timeout. */
export const OCR_API_TIMEOUT_MS = 360_000;

export const api = {
  get: <T>(p: string, opts?: RequestOptions) =>
    request<T>(p, { method: "GET" }, { timeoutMs: DEFAULT_API_TIMEOUT_MS, ...opts }),
  post: <T>(p: string, body: any, authOrOpts: boolean | RequestOptions = true) => {
    const opts: RequestOptions =
      typeof authOrOpts === "boolean"
        ? { auth: authOrOpts, timeoutMs: DEFAULT_API_TIMEOUT_MS }
        : { timeoutMs: DEFAULT_API_TIMEOUT_MS, ...authOrOpts };
    return request<T>(p, { method: "POST", body: JSON.stringify(body) }, opts);
  },
  put: <T>(p: string, body: any, opts?: RequestOptions) =>
    request<T>(p, { method: "PUT", body: JSON.stringify(body) }, { timeoutMs: DEFAULT_API_TIMEOUT_MS, ...opts }),
  del: <T>(p: string, body?: any, opts?: RequestOptions) =>
    request<T>(
      p,
      body === undefined ? { method: "DELETE" } : { method: "DELETE", body: JSON.stringify(body) },
      { timeoutMs: DEFAULT_API_TIMEOUT_MS, ...opts },
    ),
};

// ---------- Types ----------
export type Role = "owner" | "counter";
export type Session = {
  id: string; shop_id: string; shop_name: string; username: string;
  role: Role; display_name: string;
};

export type Farmer = { id: string; name: string; phone?: string | null; village?: string | null; created_at: string };
export type Vendor = { id: string; name: string; details?: string | null; phone?: string | null; created_at: string };
export type Staff = { id: string; name: string; username: string; role: string; active: boolean; created_at: string };
export type Settings = {
  /** Farmer Patti only — never used for Vendor Bill */
  payment_factor: number;
  hamali_per_bag: number; stationery_flat: number; default_bhada_per_bag: number;
  /** Vendor Bill only — independent of payment_factor */
  vendor_factor: number;
  vendor_margin_per_bag: number; commission_per_bag: number; vendor_hamali_default: number;
  patti_prefix: string; vendor_bill_prefix: string;
  detailed_print_format?: boolean;
  thermal_paper_width_mm?: number;
  /** Optional Gemini key for photo OCR (Action Diary). Prefer env GEMINI_API_KEY. */
  ocr_gemini_api_key?: string | null;
};

export type ShopProfile = {
  id: string; username: string;
  shop_name: string;
  owner_name?: string | null; mobile?: string | null; alt_mobile?: string | null; email?: string | null;
  address?: string | null; village?: string | null; taluk?: string | null; district?: string | null; state?: string | null;
  gst_number?: string | null; pan_number?: string | null; logo_base64?: string | null;
  bank_name?: string | null; bank_account_holder?: string | null; bank_account_number?: string | null;
  bank_ifsc?: string | null; bank_branch?: string | null; upi_id?: string | null; upi_qr_base64?: string | null;
};

export type DriverRange = { range_from: number; range_to: number; name: string; place?: string | null; bhada_per_bag: number };
export type AuctionDay = { id: string; date: string; drivers: DriverRange[]; lot_count: number; farmer_count: number; bag_count: number };

export type Sale = { vendor_id: string; vendor_name: string; bags: number; rate_per_bag: number; gross: number };
export type Lot = {
  id: string; auction_day_id: string; date: string;
  lot_serial_no: number; total_bags: number; lot_no: string; first_num: number | null;
  farmer_id: string; farmer_name: string; driver_name: string | null; driver_place: string | null;
  bhada_per_bag: number; bhada_total: number; sales: Sale[]; sold_bags: number; gross_total: number; created_at: string;
  patti_id?: string | null; patti_no?: number | null;
};

export type PattiLot = {
  lot_serial_no: number; total_bags: number; lot_no: string;
  bhada_per_bag: number; bhada_total: number; sales: Sale[]; sold_bags: number; gross: number; farmer_amount: number;
};
export type Patti = {
  id: string; patti_no: number; qr_token: string; date: string; auction_day_id: string;
  lot_id?: string | null;
  farmer_id: string; farmer_name: string;
  driver_name: string | null; driver_place: string | null;
  lots: PattiLot[];
  total_bags: number; gross_total: number; farmer_gross: number;
  hamali_per_bag: number; stationery_flat: number; payment_factor: number;
  hamali_total: number; stationery_total: number; bhada_total: number;
  deductions_total: number; net_payable: number;
  receiver_name: string; receiver_updated_at: string | null; receiver_updated_by: string | null;
  status: "pending" | "received"; created_at: string;
  printed?: boolean; printed_at?: string | null; print_count?: number;
  /** Staff user ids who have already printed this Patti (one print each). */
  staff_print_user_ids?: string[];
  created_by_user_id?: string | null;
  created_by_role?: string | null;
};

export type Dashboard = {
  today_pattis: number; today_bags: number; today_farmer_payout: number; today_gross: number;
  today_lots: number; today_pending: number; total_farmers: number; total_vendors: number;
};

/** Merchant prepaid bag wallet (owner-only). Staff never uses this. */
export type BagWallet = {
  shop_id: string;
  free_allocated: number;
  free_used: number;
  free_remaining: number;
  purchased_bags: number;
  purchased_used: number;
  purchased_remaining: number;
  total_available: number;
  price_per_bag: number;
  low_balance: boolean;
};

export type BagPurchase = {
  id: string;
  bags: number;
  price_per_bag: number;
  base_amount: number;
  gst_percent: number;
  gst_amount: number;
  total_amount: number;
  status: "PENDING" | "PAID" | string;
  created_at: string;
  paid_at?: string | null;
};

export type BagUsageRow = {
  id: string;
  shop_id: string;
  patti_id: string;
  lot_id?: string | null;
  bags: number;
  free_bags: number;
  purchased_bags: number;
  price_applied: number;
  kind: string;
  status: string;
  at: string;
  note?: string | null;
};
export type ReportRow = { key: string; label: string; pattis: number; bags: number; gross: number; net: number };
export type LotReportRow = { lot_no: string; bags: number; gross: number; farmer_name: string; driver_name: string | null; date: string; patti_no: number | null };

/** Permanent Farmer Patti audit (DELETED / REPRINTED). Merchant/Admin only. */
export type PattiAuditLogEntry = {
  id: string;
  at: string;
  action_date: string;
  by: string;
  by_user_id?: string | null;
  role: string;
  action: "DELETED" | "REPRINTED" | string;
  patti_id: string;
  patti_no: number;
  lot_no: string;
  bags: number;
  farmer_name: string;
  driver_name: string | null;
  remark?: string | null;
  patti: Record<string, unknown>;
};


// ---------- Vendor Billing ----------
export type VendorBillLine = {
  lot_id: string | null; lot_no: string; farmer_name: string;
  bags: number; auction_rate: number; vendor_rate: number; amount: number;
};
export type VendorBill = {
  id: string; bill_no: number; bill_code: string;
  vendor_id: string; vendor_name: string; vendor_details?: string | null; date: string;
  lines: VendorBillLine[];
  total_bags: number; goods_total: number;
  vendor_factor: number;
  margin_per_bag: number; commission_per_bag: number; commission_total: number;
  hamali: number; cess: number; grand_total: number;
  paid: number; balance: number;
  status: "unpaid" | "partial" | "paid" | "deleted";
  notes: string | null; created_at: string; updated_at: string | null;
};
export type VendorPaymentAlloc = { bill_id: string; amount: number };
export type VendorPayment = {
  id: string; vendor_id: string; vendor_name: string; date: string;
  amount: number; mode: string; remarks: string | null;
  allocations: VendorPaymentAlloc[]; created_at: string;
};
export type VendorDashboard = {
  vendor_id: string; vendor_name: string; phone: string | null;
  total_bills: number; total_bags: number;
  total_purchase: number; total_paid: number; outstanding: number;
};
export type VendorDayLine = {
  lot_id: string; lot_no: string; farmer_name: string; bags: number; auction_rate: number;
  date?: string | null;
};
export type PendingVendorLine = {
  lot_id: string; lot_no: string; farmer_name: string; bags: number;
  auction_rate: number; vendor_rate: number; amount: number;
  date?: string | null;
};
export type PendingVendorBill = {
  vendor_id: string; vendor_name: string; vendor_details?: string | null; phone?: string | null;
  total_bags: number; goods_total: number; commission_total: number; hamali: number; grand_total: number;
  lines: PendingVendorLine[];
};

export type LedgerAccountType = "FARMER" | "VENDOR";
export type LedgerTxnType = "CREDIT" | "DEBIT";
export type LedgerSourceType = "MANUAL" | "VENDOR_BILL" | "VENDOR_PAYMENT";
export type LedgerTxn = {
  id: string;
  account_type: LedgerAccountType;
  farmer_id?: string | null;
  vendor_id?: string | null;
  party_name: string;
  date: string;
  transaction_type: LedgerTxnType;
  amount: number;
  credit: number;
  debit: number;
  balance: number;
  description: string;
  remarks?: string | null;
  source_type: LedgerSourceType;
  source_id: string;
  created_at: string;
  updated_at?: string | null;
};
export type LedgerParty = {
  party_id: string;
  party_name: string;
  phone?: string | null;
  details?: string | null;
  day_credit: number;
  day_debit: number;
  balance: number;
  txn_count: number;
};
export type LedgerBillSnap = {
  id: string; bill_code: string; grand_total: number; paid: number; balance: number; status: string;
};
export type LedgerDetail = {
  account_type: LedgerAccountType;
  party_id: string;
  party_name: string;
  date: string;
  rows: LedgerTxn[];
  total_credit: number;
  total_debit: number;
  balance: number;
  bills: LedgerBillSnap[];
};
