/**
 * Clear device-local data after successful server-side account deletion.
 * Does not delete Google Drive files (user-owned; server has no Drive token).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { AUTH_SHOP_KEY, AUTH_TOKEN_KEY } from "@/src/api";
import { WORKING_DATE_KEY } from "@/src/utils/date";
import { clearGoogleSession } from "@/src/utils/google-drive-backup";
import { storage } from "@/src/utils/storage";

const PRINTER_KEYS = [
  "lm.printer.connectionType",
  "lm.printer.printerId",
  "lm.printer.printerName",
  "lm.printer.paperWidth",
];

/** Local Cash Book key used on branches that ship cash-book-store (device-only). */
const CASH_BOOK_KEY = "cash_book_entries_v2";

export async function clearAccountLocalData(): Promise<void> {
  await storage.secureRemove(AUTH_TOKEN_KEY);
  await storage.removeItem(AUTH_SHOP_KEY);
  await storage.removeItem(WORKING_DATE_KEY);
  await clearGoogleSession();
  for (const k of PRINTER_KEYS) {
    try {
      await storage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
  try {
    await AsyncStorage.removeItem(CASH_BOOK_KEY);
  } catch {
    /* ignore */
  }
}
