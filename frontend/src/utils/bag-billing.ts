import { Alert } from "react-native";

import type { ApiError } from "@/src/api";

/** Store V1: false in production eas.json hides in-app bag purchase UI. Defaults to enabled for local dev. */
export function isBagPurchaseEnabled(): boolean {
  const v = (process.env.EXPO_PUBLIC_BAG_PURCHASE_ENABLED || "").trim().toLowerCase();
  if (v === "false" || v === "0" || v === "no") return false;
  return true;
}

export function insufficientBagMessage(): string {
  return isBagPurchaseEnabled()
    ? "Insufficient bag balance. Please purchase additional bags to continue."
    : "Bag balance is insufficient. Please contact the shop owner/support.";
}

export function isInsufficientBagBalance(e: unknown): boolean {
  const err = e as ApiError | undefined;
  if (err?.status !== 402) return false;
  const d = err.detail;
  if (d && typeof d === "object" && (d as { code?: string }).code === "INSUFFICIENT_BAG_BALANCE") {
    return true;
  }
  const msg = typeof d === "string" ? d : (d as { message?: string })?.message || "";
  return /insufficient bag/i.test(msg);
}

type BillingRouter = { push: (href: "/billing") => void };

/** Alert for blocked Patti save — app stays open; only this save is blocked. */
export function alertInsufficientBags(router: BillingRouter): void {
  if (!isBagPurchaseEnabled()) {
    Alert.alert("Insufficient bag balance", insufficientBagMessage());
    return;
  }
  Alert.alert(
    "Insufficient bag balance",
    "Please purchase additional bags to continue.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "PURCHASE BAGS", onPress: () => router.push("/billing") },
    ],
  );
}

export function handleBagBillingError(
  e: unknown,
  router: BillingRouter,
): boolean {
  if (isInsufficientBagBalance(e)) {
    alertInsufficientBags(router);
    return true;
  }
  return false;
}
