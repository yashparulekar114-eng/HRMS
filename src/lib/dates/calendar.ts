import { formatIST } from "./ist";

/** 'YYYY-MM' (or any date in the month) -> first day 'YYYY-MM-01'. Pure string work, never the local clock. */
export const monthStart = (m: string) => m.slice(0, 7) + "-01";
export function addMonths(m: string, n: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7) + "-01";
}
export const daysInMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
/** Weekday of the 1st with Monday = 0. */
export const firstWeekdayMon = (m: string) => { const [y, mo] = m.split("-").map(Number); return (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7; };
export const fmtDay = (iso: string, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => formatIST(new Date(iso + "T00:00:00+05:30"), o);
export const fmtMonth = (m: string) => formatIST(new Date(monthStart(m) + "T00:00:00+05:30"), { month: "long", year: "numeric" });
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
