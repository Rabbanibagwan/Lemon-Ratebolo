/**
 * Dynamic sheet/list heights so PartyPicker search stays above the soft keyboard.
 * Pure helpers — no RN imports — so they can be verified in Node.
 */

export const SEARCH_SHEET_CHROME = 210;
export const SEARCH_LIST_MIN_HEIGHT = 128;

/**
 * Viewport height available for the picker sheet.
 * Android (Expo `softwareKeyboardLayoutMode: "resize"`): window height already
 * excludes the IME — do not subtract keyboard again.
 * iOS / web: window stays full-screen; subtract keyboard height.
 */
export function partyPickerAvailableHeight(
  windowHeight: number,
  keyboardHeight: number,
  platform: string = "android",
): number {
  if (keyboardHeight <= 0) return windowHeight;
  if (platform === "android") return windowHeight;
  return Math.max(280, windowHeight - keyboardHeight);
}

export function partyPickerSearchSheetMaxHeight(
  windowHeight: number,
  keyboardHeight: number,
  platform: string = "android",
): number {
  const usable = partyPickerAvailableHeight(windowHeight, keyboardHeight, platform);
  return Math.round(usable * (keyboardHeight > 0 ? 0.98 : 0.82));
}

export function partyPickerSearchListMaxHeight(
  windowHeight: number,
  keyboardHeight: number,
  sheetMaxHeight?: number,
  platform: string = "android",
): number {
  const sheet =
    sheetMaxHeight
    ?? partyPickerSearchSheetMaxHeight(windowHeight, keyboardHeight, platform);
  const room = sheet - SEARCH_SHEET_CHROME;
  const closedCap = Math.min(
    360,
    Math.round(partyPickerAvailableHeight(windowHeight, 0, platform) * 0.42),
  );
  if (keyboardHeight <= 0) return closedCap;
  return Math.max(SEARCH_LIST_MIN_HEIGHT, Math.min(closedCap, room));
}
