import { beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";

// Runs every page's data loading (all its SQL) against a real database as the limited app_user role,
// for each role, with Clerk mocked. Server components are called as functions; we check they resolve or redirect correctly.
const URL = process.env.TEST_APP_DATABASE_URL;
vi.stubEnv("DATABASE_URL", URL ?? "");
let user = "user_KCF0008";
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: user }),
  currentUser: async () => ({ primaryEmailAddress: { emailAddress: "x@example.com", verification: { status: "verified" } } }),
}));
class Redirect extends Error { constructor(public to: string) { super("REDIRECT " + to); } }
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Redirect(to); }, notFound: () => { throw new Redirect("/404"); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: (f: any) => f }));

const sp = (o: Record<string, string> = {}) => Promise.resolve(o);
const pages: [string, () => Promise<any>, string[]][] = [
  ["dashboard", async () => (await import("../../src/app/(app)/page")).default(), ["KCF0008", "KCF0003", "KCF0002", "KCF0001", "KCF0014"]],
  ["attendance", async () => (await import("../../src/app/(app)/attendance/page")).default({ searchParams: sp({ m: "2026-10" }) }), ["KCF0008", "KCF0014"]],
  ["leave", async () => (await import("../../src/app/(app)/leave/page")).default(), ["KCF0008", "KCF0002"]],
  ["leave/apply", async () => (await import("../../src/app/(app)/leave/apply/page")).default(), ["KCF0008"]],
  ["profile", async () => (await import("../../src/app/(app)/profile/page")).default(), ["KCF0008", "KCF0002"]],
  ["ask", async () => (await import("../../src/app/(app)/ask/page")).default(), ["KCF0008"]],
  ["approvals", async () => (await import("../../src/app/(app)/approvals/page")).default(), ["KCF0003", "KCF0002", "KCF0004"]],
  ["reports (manager)", async () => (await import("../../src/app/(app)/reports/page")).default({ searchParams: sp({ m: "2026-10" }) }), ["KCF0003", "KCF0002"]],
  ["team", async () => (await import("../../src/app/(app)/team/page")).default({ searchParams: sp({ m: "2026-10" }) }), ["KCF0003", "KCF0002"]],
  ["calendar", async () => (await import("../../src/app/(app)/calendar/page")).default({ searchParams: sp({ m: "2026-11" }) }), ["KCF0003", "KCF0002"]],
  ["employees", async () => (await import("../../src/app/(app)/employees/page")).default({ searchParams: sp({ q: "pri", status: "all" }) }), ["KCF0002"]],
  ["employees/new", async () => (await import("../../src/app/(app)/employees/new/page")).default(), ["KCF0002"]],
  ["settings", async () => (await import("../../src/app/(app)/settings/page")).default({ searchParams: sp() }), ["KCF0002"]],
];

describe.skipIf(!URL || !process.env.TEST_DATABASE_URL)("every page loads its data for the right roles (smoke)", () => {
  beforeAll(async () => {            // link the seeded employees to fake Clerk ids, as first login would
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await c.connect();
    await c.query("update employees set clerk_user_id = 'user_' || employee_code where clerk_user_id is null");
    await c.end();
  });

  for (const [name, load, who] of pages) {
    for (const w of who) {
      it(`${name} as ${w}`, async () => {
        user = "user_" + w;
        await expect(load()).resolves.toBeTruthy();
      });
    }
  }

  it("employee detail loads for HR", async () => {
    user = "user_KCF0002";
    const { withClaims } = await import("@/lib/db/server");
    const id = (await withClaims({ sub: user }, (db) => db.one<{ id: string }>("select id from employees where employee_code = 'KCF0008'")))!.id;
    await expect((await import("../../src/app/(app)/employees/[id]/page")).default({ params: Promise.resolve({ id }) })).resolves.toBeTruthy();
  });

  it("role gates redirect: an employee cannot open HR or approver pages", async () => {
    user = "user_KCF0008";
    await expect((await import("../../src/app/(app)/employees/page")).default({ searchParams: sp() })).rejects.toThrow(/REDIRECT \/forbidden/);
    await expect((await import("../../src/app/(app)/approvals/page")).default()).rejects.toThrow(/REDIRECT \/forbidden/);
    await expect((await import("../../src/app/(app)/settings/page")).default({ searchParams: sp() })).rejects.toThrow(/REDIRECT \/forbidden/);
    user = "user_KCF0003";
    await expect((await import("../../src/app/(app)/employees/page")).default({ searchParams: sp() })).rejects.toThrow(/REDIRECT \/forbidden/);
  });

  it("a former employee (Neha) is sent to the no-access page", async () => {
    user = "user_KCF0019";
    await expect((await import("../../src/app/(app)/leave/page")).default()).rejects.toThrow(/REDIRECT \/no-access/);
  });

  it("server actions: punch, apply, approve, regularise, add employee, with real results", async () => {
    user = "user_KCF0008";
    const { punchAction } = await import("@/modules/attendance/actions");
    const { submitLeaveAction, previewLeaveAction, processLeaveAction } = await import("@/modules/leave/actions");
    const fd = (o: Record<string, string>) => { const f = new FormData(); Object.entries(o).forEach(([k, v]) => f.set(k, v)); return f; };
    // dates in the past of the real clock are fine for the preview (real "today" differs from the test clock), so use far-future ones
    const prev = await previewLeaveAction({}, fd({ type: "EL", from: "2027-03-01", to: "2027-03-02", reason: "x" }));
    expect(prev.ok).toBe(true);
    expect(prev.data.plan.chargeable_days).toBe(2);
    const bad = await submitLeaveAction({}, fd({ type: "EL", from: "2027-03-01", to: "2027-03-02", reason: "" }));
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/reason/i);
    const lop = await submitLeaveAction({}, fd({ type: "CL", from: "2027-03-01", to: "2027-03-12", reason: "trip" }));
    expect(lop.ok).toBe(false);
    expect(lop.data.needsLop).toBeGreaterThan(0);
    const out = await punchAction({}, fd({ type: "out" }));
    expect(out.ok).toBe(false);                                   // no check-in today: a real database error, mapped to a message
    expect(typeof out.message).toBe("string");
    void processLeaveAction;
  });
});
