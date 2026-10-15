/**
 * Helpers for physical / hardware keyboard handling in Lemon Mandi.
 *
 * Android HW keyboards often fire `onKeyPress` for Enter while soft keyboards
 * rely on `onSubmitEditing`. Binding both without a gate double-advances focus.
 */

export function isEnterKey(key: string): boolean {
  return key === "Enter" || key === "NumpadEnter";
}

export function isEscapeKey(key: string): boolean {
  return key === "Escape" || key === "Esc";
}

export function isArrowDownKey(key: string): boolean {
  return key === "ArrowDown" || key === "Down";
}

export function isArrowUpKey(key: string): boolean {
  return key === "ArrowUp" || key === "Up";
}

export function isArrowLeftKey(key: string): boolean {
  return key === "ArrowLeft" || key === "Left";
}

export function isArrowRightKey(key: string): boolean {
  return key === "ArrowRight" || key === "Right";
}

/** Deduplicate Enter across onKeyPress + onSubmitEditing; optional bleed suppress. */
export function createEnterGate(dedupeMs = 140) {
  let lastClaimAt = 0;
  let ignoreUntil = 0;

  return {
    /** Ignore the next Enter claims until `ms` elapses (e.g. after opening create). */
    suppressFor(ms: number) {
      ignoreUntil = Math.max(ignoreUntil, Date.now() + ms);
    },
    shouldIgnore(): boolean {
      return Date.now() < ignoreUntil;
    },
    /** True once per physical Enter press; false for duplicates / suppressed. */
    claim(): boolean {
      const now = Date.now();
      if (now < ignoreUntil) return false;
      if (now - lastClaimAt < dedupeMs) return false;
      lastClaimAt = now;
      return true;
    },
  };
}

export type EnterGate = ReturnType<typeof createEnterGate>;

/** Run `action` on Enter from either onKeyPress or onSubmitEditing (deduped). */
export function handleEnterAdvance(
  gate: EnterGate,
  action: () => void,
): {
  onSubmitEditing: () => void;
  onKeyPress: (e: { nativeEvent: { key: string } }) => void;
} {
  const run = () => {
    if (!gate.claim()) return;
    action();
  };
  return {
    onSubmitEditing: run,
    onKeyPress: (e) => {
      if (!isEnterKey(e.nativeEvent.key)) return;
      run();
    },
  };
}
