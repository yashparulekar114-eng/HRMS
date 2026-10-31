import { describe, expect, it } from "vitest";
import { istToday, formatIST } from "@/lib/dates/ist";

// Run with `npm run test:ist` (TZ=America/New_York) as well as `npm test`.
describe("IST helpers", () => {
  it("00:30 IST on 30 Oct is already 30 Oct, although it is 29 Oct in UTC", () => {
    expect(istToday(new Date("2026-10-29T19:00:00Z"))).toBe("2026-10-30");
  });
  it("23:59 IST stays on the same IST date", () => {
    expect(istToday(new Date("2026-10-29T18:29:00Z"))).toBe("2026-10-29");
  });
  it("formats a check-in at 10:16 IST", () => {
    expect(formatIST(new Date("2026-10-29T04:46:00Z"), { hour: "2-digit", minute: "2-digit", hour12: false })).toBe("10:16");
  });
});
