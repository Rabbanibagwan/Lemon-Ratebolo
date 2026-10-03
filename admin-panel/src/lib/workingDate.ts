import { createContext, useContext } from "react";
import { istToday } from "./dates";

/** Single source of truth for the Admin Panel date; persisted like the admin token. */
export const WORKING_DATE_KEY = "lm.admin.workingDate";

export type WorkingDateState = {
  date: string;
  setDate: (date: string) => void;
};

export const WorkingDateContext = createContext<WorkingDateState | null>(null);

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function readStoredWorkingDate(): string {
  try {
    const stored = localStorage.getItem(WORKING_DATE_KEY);
    if (isIsoDate(stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  return istToday();
}

export function useWorkingDate(): WorkingDateState {
  const ctx = useContext(WorkingDateContext);
  if (!ctx) throw new Error("useWorkingDate must be used inside <WorkingDateProvider>");
  return ctx;
}
