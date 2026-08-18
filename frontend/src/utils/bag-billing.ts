import { Alert } from "react-native";

import type { ApiError } from "@/src/api";

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
