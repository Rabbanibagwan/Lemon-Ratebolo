/**
 * Gate for auto-opening Driver Day Setup on the Auction tab.
 *
 * Dashboard → SET DRIVER must pass editDrivers=1&source=dashboard.
 * Normal Auction navigation (no params / stale editDrivers alone) must NOT open setup.
 */
export function shouldAutoOpenDriverDaySetup(editDrivers: string, source: string): boolean {
  if (editDrivers !== "1") return false;
  return source === "dashboard" || source === "reports";
}
