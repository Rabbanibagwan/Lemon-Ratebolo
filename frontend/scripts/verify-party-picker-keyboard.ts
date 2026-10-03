/**
 * PartyPicker keyboard-overlap sizing.
 * Run: npx --yes tsx scripts/verify-party-picker-keyboard.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  partyPickerAvailableHeight,
  partyPickerSearchListMaxHeight,
  partyPickerSearchSheetMaxHeight,
  SEARCH_LIST_MIN_HEIGHT,
} from "../src/utils/party-picker-keyboard";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// Android resize: window already shrunk — do not subtract keyboard again.
assert(
  partyPickerAvailableHeight(480, 320, "android") === 480,
  "android resize uses window height as-is",
);
assert(
  partyPickerAvailableHeight(800, 320, "ios") === 480,
  "ios subtracts keyboard from window",
);

// Phone-ish Android after resize (window already excludes IME)
const phoneWin = 480;
const phoneKb = 320;
const sheetOpen = partyPickerSearchSheetMaxHeight(phoneWin, phoneKb, "android");
const listOpen = partyPickerSearchListMaxHeight(phoneWin, phoneKb, sheetOpen, "android");
assert(sheetOpen <= phoneWin, "sheet fits resized android window");
assert(listOpen >= SEARCH_LIST_MIN_HEIGHT, "list keeps min height with keyboard");
assert(listOpen + 210 <= sheetOpen + 4, "list fits inside sheet chrome");

const sheetClosed = partyPickerSearchSheetMaxHeight(800, 0, "android");
const listClosed = partyPickerSearchListMaxHeight(800, 0, sheetClosed, "android");
assert(listClosed <= 360, "closed list capped");

// iOS full window + keyboard
const iosSheet = partyPickerSearchSheetMaxHeight(800, 320, "ios");
const iosList = partyPickerSearchListMaxHeight(800, 320, iosSheet, "ios");
assert(iosSheet <= 480 + 8, "ios sheet fits above keyboard");
assert(iosList >= SEARCH_LIST_MIN_HEIGHT, "ios list visible");

const src = readFileSync(join(__dirname, "../src/components/PartyPicker.tsx"), "utf8");
assert(src.includes('KeyboardFormAvoid style={styles.modalRoot} behavior="padding"'), "search modal uses KeyboardFormAvoid");
assert(src.includes("useKeyboardState"), "search modal tracks keyboard height");
assert(src.includes("searchListMaxHeight"), "FlatList uses dynamic maxHeight");
assert(!/style=\{\{\s*maxHeight:\s*360\s*\}\}/.test(src), "fixed 360 list height removed");
assert(src.includes("handleSearchKeyPress"), "physical keyboard handlers preserved");
assert(src.includes("isArrowDownKey") && src.includes("isArrowUpKey"), "arrow navigation preserved");

console.log("OK: party-picker keyboard sizing");
console.log(`  android open sheet=${sheetOpen} list=${listOpen}`);
console.log(`  android closed sheet=${sheetClosed} list=${listClosed}`);
console.log(`  ios open sheet=${iosSheet} list=${iosList}`);
