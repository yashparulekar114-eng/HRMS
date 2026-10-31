import { describe, expect, it, vi } from "vitest";
import prompts from "./prompts.json";

// `npm run test:agent`: runs every prompt against the real model and the real database.
// Needs GROQ_API_KEY (and optionally GOOGLE_GENERATIVE_AI_API_KEY) plus TEST_APP_DATABASE_URL. Skipped otherwise.
const live = !!process.env.GROQ_API_KEY && !!process.env.TEST_APP_DATABASE_URL && process.env.RUN_AGENT === "1";
let current = "user_KCF0008";
vi.stubEnv("DATABASE_URL", process.env.TEST_APP_DATABASE_URL ?? "");
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: current }) }));

describe.skipIf(!live)("agent prompt suite (live model)", () => {
  for (const p of prompts as any[]) {
    it(p.id, async () => {
      current = "user_" + p.as;
      const { withClaims } = await import("@/lib/db/server");
      const { runAgent } = await import("@/modules/agent/agent");
      const sub = current;
      const count = () => withClaims({ sub: "user_KCF0002" }, (db) => db.one<{ n: number }>("select count(*)::int n from leave_requests")).then((r) => r!.n);
      await withClaims({ sub, email: `x@x` }, (db) => db.call("link_my_account")).catch(() => {});
      const before = await count().catch(() => 0);
      const viewer = await withClaims({ sub }, (db) => db.one<any>("select id, first_name, employee_code, location_id, is_hr_admin as \"isHr\", is_manager() as \"isManager\" from employees where id = me()"));
      const qid = await withClaims({ sub }, (db) => db.call<string>("agent_start_question"));
      const ctx = { questionId: qid, viewer: { id: viewer.id, firstName: viewer.first_name, fullName: viewer.first_name, isHr: viewer.isHr, isManager: viewer.isManager, locationId: viewer.location_id, employeeCode: viewer.employee_code }, cache: new Map(), drafts: [] as unknown[] };
      const out = await runAgent(ctx, "", [], p.prompt);
      for (const re of p.mustNotMatch ?? []) expect(out.text, `must not match ${re}`).not.toMatch(new RegExp(re, "i"));
      for (const re of p.mustMatch ?? []) expect(out.text, `must match ${re}`).toMatch(new RegExp(re, "i"));
      const used = await withClaims({ sub: "user_KCF0002" }, (db) => db.rows<any>("select tool_name, status from agent_log where question_id = $1", [qid]));
      for (const t of p.expectTools ?? []) expect(used.map((u) => u.tool_name)).toContain(t);
      expect(used.filter((u) => u.status !== "limit_exceeded").length).toBeLessThanOrEqual(5);
      if (p.noNewLeaveRows) expect(await count()).toBe(before);
    }, 60_000);
  }
});
