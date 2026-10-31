// All dates and times in Konkan People are IST (Asia/Kolkata), whatever the
// server's or browser's time zone. See ARCHITECTURE.md §8 and CLAUDE.md rule 1.
export const IST_TIME_ZONE = "Asia/Kolkata";

/** Today's calendar date in IST as YYYY-MM-DD. */
export function istToday(now: Date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Human-readable IST date and time, e.g. "29 Oct 2026, 10:16 am". */
export function formatIST(
  instant: Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST_TIME_ZONE, ...options }).format(instant);
}
