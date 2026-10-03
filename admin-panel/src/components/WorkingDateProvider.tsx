import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  WORKING_DATE_KEY,
  WorkingDateContext,
  isIsoDate,
  readStoredWorkingDate,
} from "../lib/workingDate";

export function WorkingDateProvider({ children }: { children: ReactNode }) {
  const [date, setDateState] = useState(readStoredWorkingDate);

  const setDate = useCallback((next: string) => {
    if (!isIsoDate(next)) return;
    setDateState(next);
    try {
      localStorage.setItem(WORKING_DATE_KEY, next);
    } catch {
      /* storage unavailable — keep in-memory value */
    }
  }, []);

  // Keep other open admin tabs on the same date.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === WORKING_DATE_KEY && isIsoDate(e.newValue)) setDateState(e.newValue);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo(() => ({ date, setDate }), [date, setDate]);
  return <WorkingDateContext.Provider value={value}>{children}</WorkingDateContext.Provider>;
}
