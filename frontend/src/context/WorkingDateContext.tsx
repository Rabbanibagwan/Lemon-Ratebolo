import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { storage } from "@/src/utils/storage";
import {
  WORKING_DATE_KEY,
  formatDisplayDate,
  isToday,
  parseISODate,
  startOfDay,
  toISODate,
} from "@/src/utils/date";

type WorkingDateState = {
  /** Selected working calendar day (local midnight). */
  workingDate: Date;
  /** YYYY-MM-DD for API calls. */
  workingDateISO: string;
  displayDate: string;
  isWorkingToday: boolean;
  setWorkingDate: (d: Date) => void;
};

const Ctx = createContext<WorkingDateState | null>(null);

export function WorkingDateProvider({ children }: { children: React.ReactNode }) {
  const [workingDate, setWorkingDateState] = useState<Date>(() => startOfDay(new Date()));

  useEffect(() => {
    (async () => {
      const saved = await storage.getItem<string>(WORKING_DATE_KEY, "");
      if (saved) {
        setWorkingDateState(startOfDay(parseISODate(saved)));
      }
    })();
  }, []);

  const setWorkingDate = useCallback((d: Date) => {
    const next = startOfDay(d);
    setWorkingDateState(next);
    void storage.setItem(WORKING_DATE_KEY, toISODate(next));
  }, []);

  const value = useMemo<WorkingDateState>(() => ({
    workingDate,
    workingDateISO: toISODate(workingDate),
    displayDate: formatDisplayDate(workingDate),
    isWorkingToday: isToday(workingDate),
    setWorkingDate,
  }), [workingDate, setWorkingDate]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkingDate(): WorkingDateState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkingDate must be used within WorkingDateProvider");
  return ctx;
}
