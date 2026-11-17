/**
 * Physical keyboard helpers — Enter gate + key classifiers.
 * Run: npx --yes tsx scripts/verify-physical-keyboard.ts
 */
import {
  createEnterGate,
  handleEnterAdvance,
  isArrowDownKey,
  isArrowUpKey,
  isEnterKey,
  isEscapeKey,
} from "../src/utils/physical-keyboard";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(isEnterKey("Enter"), "Enter key");
assert(isEnterKey("NumpadEnter"), "NumpadEnter key");
assert(!isEnterKey("e"), "letter is not Enter");
assert(isEscapeKey("Escape") && isEscapeKey("Esc"), "Escape aliases");
assert(isArrowDownKey("ArrowDown") && isArrowUpKey("ArrowUp"), "arrow keys");

const gate = createEnterGate(100);
assert(gate.claim() === true, "first claim succeeds");
assert(gate.claim() === false, "dedupe blocks second claim");

const gate2 = createEnterGate(50);
gate2.suppressFor(200);
assert(gate2.claim() === false, "suppress blocks claim");
assert(gate2.shouldIgnore() === true, "shouldIgnore while suppressed");

let advanced = 0;
const handlers = handleEnterAdvance(createEnterGate(80), () => {
  advanced += 1;
});
handlers.onKeyPress({ nativeEvent: { key: "Enter" } });
handlers.onSubmitEditing();
assert(advanced === 1, "onKeyPress + onSubmitEditing dedupe to one advance");

handlers.onKeyPress({ nativeEvent: { key: "a" } });
assert(advanced === 1, "non-Enter keypress ignored");

console.log("OK: physical-keyboard helpers");
