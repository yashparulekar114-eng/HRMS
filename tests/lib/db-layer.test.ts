import { afterAll, describe, expect, it, vi } from "vitest";

// The app connects as the limited role app_user (not the owner). Skipped unless TEST_APP_DATABASE_URL is set.
const URL = process.env.TEST_APP_DATABASE_URL;
vi.stubEnv("DATABASE_URL", URL ?? "");
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "user_KCF0008" }) }));

describe.skipIf(!URL)("app database layer (src/lib/db/server.ts)", () => {
  afterAll(async () => { /* pool closes with the process */ });

  it("runs as the signed-in user: RLS applies even though the connection role is app_user", async () => {
    const { withClaims } = await import("@/lib/db/server");
    const link = await withClaims({ sub: "user_KCF0008", email: "priya.desai+clerk_test@example.com" }, (db) => db.call<any>("link_my_account"));
    expect(link).toMatchObject({ active: true, first_name: "Priya" });
    const rows = await withClaims({ sub: "user_KCF0008" }, (db) => db.rows("select employee_code from employees"));
    expect(rows).toEqual([{ employee_code: "KCF0008" }]);
  });

  it("named-argument calls bind dates, booleans, nulls and jsonb correctly; dates come back as strings", async () => {
    const { withClaims } = await import("@/lib/db/server");
    await withClaims({ sub: "user_KCF0008" }, async (db) => {
      const plan = await db.call<any>("preview_leave", { p_type: "EL", p_from: "2026-11-13", p_to: "2026-11-16", p_half: false, p_period: null, p_weeks: null });
      expect(plan.chargeable_days).toBe(2);
      const bal = await db.table<any>("get_my_balances", { p_year: 2026 });
      expect(bal.find((b) => b.leave_type === "CL")).toMatchObject({ opening: 0, accrued: 8 });
      const day = await db.one<{ d: string }>("select date::text d, date from attendance where employee_id = me() order by date limit 1");
      expect(day!.d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((await db.rows<any>("select date from attendance where employee_id = me() limit 1"))[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it("cannot become another user or touch data directly; the request transaction is isolated", async () => {
    const { withClaims } = await import("@/lib/db/server");
    await expect(withClaims({ sub: "user_KCF0008" }, (db) => db.rows("update employees set is_hr_admin = true"))).rejects.toThrow(/permission denied/);
    await expect(withClaims({ sub: "user_KCF0008" }, (db) => db.rows("select * from employee_sensitive"))).rejects.toThrow(/permission denied/);
    // a second request with no matching employee sees nothing
    const none = await withClaims({ sub: "user_unknown" }, (db) => db.rows("select 1 from employees"));
    expect(none).toEqual([]);
    // SET ROLE back to the owner is not possible for app_user
    await expect(withClaims({ sub: "user_KCF0008" }, (db) => db.rows("set role postgres"))).rejects.toThrow();
  });

  it("rejects bad function or argument names (no SQL injection through names)", async () => {
    const { withClaims } = await import("@/lib/db/server");
    await expect(withClaims({ sub: "x" }, (db) => db.call("me(); drop table employees; --"))).rejects.toThrow(/bad function name/);
    await expect(withClaims({ sub: "x" }, (db) => db.call("me", { "a) as v; drop table employees; --": 1 }))).rejects.toThrow(/bad argument name/);
  });
});
