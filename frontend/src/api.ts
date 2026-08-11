import { Platform } from "react-native";
import { storage } from "@/src/utils/storage";

export const AUTH_TOKEN_KEY = "lm.auth.token";
export const AUTH_SHOP_KEY = "lm.auth.shop";

/** Prefer env. On web, match the page hostname so localhost ≠ 127.0.0.1 CORS/PNA doesn't break fetch.
 *  On native (Android/iOS), always use EXPO_PUBLIC_BACKEND_URL — never the device's own localhost. */
function resolveBackendBase(): string {
  const fromEnv = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");
  // Backend is currently served on 8001 (8000 had stuck reload zombies returning empty 500 → "Failed to fetch").
  const port = "8001";
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.hostname) {
    const host = window.location.hostname;
    return `${window.location.protocol}//${host}:${port}`;
  }
  return fromEnv || `http://127.0.0.1:${port}`;
}

export type ApiError = { status: number; detail: string | Record<string, any> };

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (auth) {
    const token = await storage.secureGet<string>(AUTH_TOKEN_KEY, "");
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const url = `${resolveBackendBase()}/api${path}`;
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (e: any) {
    const base = resolveBackendBase();
    const raw = e?.message || "Network request failed";
    const tip =
      raw === "Failed to fetch" || raw === "Network request failed"
        ? `Cannot reach API at ${base}. Check Wi‑Fi/tunnel and that the backend is running.`
        : raw;
    throw { status: 0, detail: tip } as ApiError;
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

export const api = {
  get: <T>(p: string) => request<T>(p, { method: "GET" }),
  post: <T>(p: string, body: any, auth = true) => request<T>(p, { method: "POST", body: JSON.stringify(body) }, auth),
  put: <T>(p: string, body: any) => request<T>(p, { method: "PUT", body: JSON.stringify(body) }),
  del: <T>(p: string, body?: any) =>
    request<T>(p, body === undefined ? { method: "DELETE" } : { method: "DELETE", body: JSON.stringify(body) }),
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
};

export type Dashboard = {
  today_pattis: number; today_bags: number; today_farmer_payout: number; today_gross: number;
  today_lots: number; today_pending: number; total_farmers: number; total_vendors: number;
};
export type ReportRow = { key: string; label: string; pattis: number; bags: number; gross: number; net: number };
export type LotReportRow = { lot_no: string; bags: number; gross: number; farmer_name: string; driver_name: string | null; date: string; patti_no: number | null };


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
};
