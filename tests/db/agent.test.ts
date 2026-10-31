import { afterAll, describe, expect, it } from "vitest";
import { KCF, pool, TEST_DB, withTx } from "./helpers";

afterAll(async () => { if (pool) await pool.end(); });

describe.skipIf(!TEST_DB)("agent limits and logging (ARCHITECTURE section 6)", () => {
  it("30 questions per IST day; the 31st is refused; the count resets at midnight IST", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      for (let i = 0; i < 30; i++) await s.q("select agent_start_question()");
      expect(await s.fails("select agent_start_question()")).toMatch(/30 questions/);
      await s.setNow("2026-11-01 00:05+05:30");
      await s.q("select agent_start_question()");
    });
  });

  it("5 tool slots per question, reserved in order; the 6th call is logged as limit_exceeded", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      const q = (await s.one("select agent_start_question() q")).q;
      for (let i = 1; i <= 5; i++) expect((await s.one("select agent_reserve_slot($1,'get_holidays','{}') r", [q])).r.slot).toBe(i);
      const sixth = (await s.one("select agent_reserve_slot($1,'get_holidays','{}') r", [q])).r;
      expect(sixth.allowed).toBe(false);
      await s.owner();
      expect((await s.one("select status from agent_log where id = $1", [sixth.log_id])).status).toBe("limit_exceeded");
    });
  });

  it("agent_log rows are filled in once through agent_finish_call, and nothing else can change them", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      const q = (await s.one("select agent_start_question() q")).q;
      const slot = (await s.one("select agent_reserve_slot($1,'get_my_leave_balance','{}') r", [q])).r;
      await s.q("select agent_finish_call($1,'ok','{\"n\":1}')", [slot.log_id]);
      await s.q("select agent_finish_call($1,'error','{\"n\":2}')", [slot.log_id]);        // second fill is a no-op
      await s.owner();
      expect(await s.one("select status, result from agent_log where id = $1", [slot.log_id])).toEqual({ status: "ok", result: { n: 1 } });
      expect(await s.fails("update agent_log set result = '{}' where id = $1", [slot.log_id])).toMatch(/completed once/);
      expect(await s.fails("delete from agent_log")).toMatch(/completed once/);
    });
  });

  it("tools check the role in code: an employee gets an explicit error, not empty data", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      expect(await s.fails("select agent_team_today()")).toMatch(/Only managers and HR/);
      expect(await s.fails("select agent_pending_approvals()")).toMatch(/Only managers and HR/);
      await s.as(KCF.ANITA);
      expect((await s.one("select jsonb_array_length(agent_team_today()) n")).n).toBeGreaterThan(0);
      const rows = (await s.one("select agent_pending_approvals() r")).r;
      expect(rows.length).toBe(1);        // Priya's pending half-day CL (6 Nov)
      expect(rows[0].employee).toBe("Priya Desai");
    });
  });

  it("only HR reads agent_log; an employee cannot read another's questions", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      await s.q("select agent_start_question()");
      expect((await s.one("select count(*)::int n from agent_questions")).n).toBe(1);
      await s.as(KCF.SURESH);
      expect((await s.one("select count(*)::int n from agent_questions")).n).toBe(0);
      await s.as(KCF.MEERA);
      expect((await s.one("select count(*)::int n from agent_questions")).n).toBe(1);
    });
  });
});
