/**
 * Vendor Purchase Chart — per-vendor thermal print (Bluetooth ESC/POS).
 * Native: requireBluetooth — no Android system print dialog.
 */
import { Alert, Platform } from "react-native";

import type { Settings, ShopProfile } from "@/src/api";
import {
  encodeVendorChartEscPos,
  renderVendorChartThermalHtml,
} from "@/src/utils/chart-print-escpos";
import { printThermalDocument } from "@/src/utils/thermal-connection";
import { resolvePrintPaperMm } from "@/src/utils/printer-prefs";
import {
  clampPaperMm,
  fillThermalPreviewAndPrint,
  openThermalPreviewWindow,
  showInPageThermalPreview,
  thermalPrintUserMessage,
} from "@/src/utils/thermal-print";
import type { ChartVendorColumn } from "@/src/utils/vendor-purchase-chart";

export { encodeVendorChartEscPos, renderVendorChartThermalHtml } from "@/src/utils/chart-print-escpos";

/**
 * Print one vendor's Chart column via existing Bluetooth ESC/POS pipeline.
 * Web preview: thermal HTML preview of the same slip (dev only).
 */
export async function thermalPrintVendorChart(
  col: ChartVendorColumn,
  dateISO: string,
  shopName: string,
  settings?: Settings | null,
  profile?: ShopProfile | null,
): Promise<void> {
  const preview =
    Platform.OS === "web"
      ? openThermalPreviewWindow(`Chart ${col.vendor_name || "vendor"}`)
      : null;

  const mm = await resolvePrintPaperMm(settings?.thermal_paper_width_mm);
  const paperMm = clampPaperMm(mm);
  const shop = profile?.shop_name || shopName || "LEMON MANDI";
  const html = renderVendorChartThermalHtml(col, dateISO, shop, paperMm);
  const escposBase64 = encodeVendorChartEscPos(col, dateISO, shop, paperMm, profile);

  if (Platform.OS === "web") {
    if (preview && !preview.closed) {
      await fillThermalPreviewAndPrint(preview, html, paperMm);
      return;
    }
    showInPageThermalPreview(html, `Chart ${col.vendor_name || "vendor"} — Print`);
    return;
  }

  await printThermalDocument({
    html,
    escposBase64,
    paperMm,
    requireBluetooth: true,
  });
}

export async function printVendorChartColumn(
  col: ChartVendorColumn,
  dateISO: string,
  shopName: string,
  settings?: Settings | null,
  profile?: ShopProfile | null,
): Promise<void> {
  try {
    await thermalPrintVendorChart(col, dateISO, shopName, settings, profile);
  } catch (e: any) {
    const msg = thermalPrintUserMessage(e) || e?.message || "Could not print vendor chart";
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.alert(`Print failed\n\n${msg}`);
    } else {
      Alert.alert("Print failed", msg);
    }
    throw e;
  }
}
