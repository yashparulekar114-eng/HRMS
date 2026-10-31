import { afterAll, describe, expect, it } from "vitest";
import { KCF, pool, TEST_DB, withTx } from "./helpers";

afterAll(async () => { if (pool) await pool.end(); });
const PRE = (t: string, f: string, to: string, half = false, per: string | null = null, weeks: number | null = null) =>
  ["select preview_leave($1,$2,$3,$4,$5,$6) p", [t, f, to, half, per, weeks]] as const;
const APPLY = "select apply_leave($1,$2,$3,$4,$5,$6,$7,$8,$9) r";
const apply = (t: string, f: string, to: string, o: { half?: boolean; per?: string; reason?: string; cert?: string; lop?: boolean; weeks?: number } = {}) =>
  [APPLY, [t, f, to, o.half ?? false, o.per ?? null, o.reason ?? "Test", o.cert ?? null, o.lop ?? false, o.weeks ?? null]] as const;

describe.skipIf(!TEST_DB)("leave (RESEARCH E-I)", () => {
  it("E2: Fri-Mon EL is 2 days at Panaji (Priya) and 3 days at Verna (Suresh)", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      expect((await s.one(...PRE("EL", "2026-11-13", "2026-11-16"))).p.chargeable_days).toBe(2);
      await s.as(KCF.SURESH);
      expect((await s.one(...PRE("EL", "2026-11-13", "2026-11-16"))).p.chargeable_days).toBe(3);
    });
  });

  it("G1-G3: shortfall is offered as LOP, nothing saved until accepted; paid first then LOP, half day split", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      const first = (await s.one(...apply("CL", "2026-11-09", "2026-11-10"))).r;
      expect(first.status).toBe("needs_lop");
      expect(+first.shortfall).toBe(0.5);
      expect((await s.one("select count(*)::int n from leave_requests where from_date = '2026-11-09'")).n).toBe(0);
      const saved = (await s.one(...apply("CL", "2026-11-09", "2026-11-10", { lop: true }))).r;
      expect(saved.status).toBe("saved");
      const lines = await s.q("select date::text, leave_type, deduction::float from leave_request_days where leave_request_id = $1 order by date, leave_type", [saved.id]);
      expect(lines).toEqual([
        { date: "2026-11-09", leave_type: "CL", deduction: 1 },
        { date: "2026-11-10", leave_type: "CL", deduction: 0.5 },
        { date: "2026-11-10", leave_type: "LOP", deduction: 0.5 },
      ]);
    });
  });

  it("C5/G3: EL is whole days only; the fraction stays in the balance", async () => {
    await withTx(async (s) => {
      await s.owner();
      await s.q(`update leave_opening_balances set opening_balance = 0 where leave_type = 'EL' and employee_id = (select id from employees where employee_code = 'KCF0010')`);
      await s.q(`update employees set doj = '2026-02-10' where employee_code = 'KCF0010'`);   // 7 credits = 8.75
      await s.as("KCF0010");
      const r = (await s.one(...PRE("EL", "2026-11-02", "2026-11-12"))).p;
      expect(r.chargeable_days).toBe(9);
      const el = r.lines.filter((l: any) => l.leave_type === "EL").reduce((a: number, l: any) => a + l.deduction, 0);
      const lop = r.lines.filter((l: any) => l.leave_type === "LOP").reduce((a: number, l: any) => a + l.deduction, 0);
      expect([el, lop]).toEqual([8, 1]);
    });
  });

  it("F4: SL over 2 working days needs a certificate in the caller's own folder", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      expect((await s.one(...PRE("SL", "2026-11-13", "2026-11-16"))).p.needs_certificate).toBe(false);   // Fri + Mon = 2
      expect((await s.one(...PRE("SL", "2026-11-12", "2026-11-16"))).p.needs_certificate).toBe(true);    // Thu, Fri, Mon = 3
      expect(await s.fails(...apply("SL", "2026-11-12", "2026-11-16"))).toMatch(/certificate/i);
      const fid = "11111111-1111-1111-1111-111111111111";
      expect(await s.fails("select upload_certificate($1,'text/html',$2)", [fid, Buffer.from("x")])).toMatch(/check constraint/);
      const path = (await s.one("select upload_certificate($1,'application/pdf',$2) p", [fid, Buffer.from("%PDF-1.4")])).p;
      expect(path).toBe("user_KCF0008/" + fid);
      const r = (await s.one(...apply("SL", "2026-11-12", "2026-11-16", { cert: path }))).r;
      expect(r.status).toBe("saved");
      // someone else's certificate cannot be reused
      await s.as(KCF.SURESH);
      expect(await s.fails(...apply("SL", "2026-11-12", "2026-11-16", { cert: path }))).toMatch(/certificate/i);
      expect((await s.q("select 1 from medical_certificates")).length).toBe(0);       // not even visible to Suresh
      await s.as(KCF.ANITA);
      expect((await s.q("select 1 from medical_certificates")).length).toBe(1);       // visible to the approver of the request that cites it
    });
  });

  it("F2/F3: overlaps blocked; different halves of one date allowed; the same half twice blocked", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);       // seed: pending first-half CL on 6 Nov
      expect(await s.fails(...apply("SL", "2026-11-06", "2026-11-06"))).toMatch(/overlaps/i);
      expect(await s.fails(...apply("SL", "2026-11-06", "2026-11-06", { half: true, per: "First" }))).toMatch(/overlaps/i);
      expect((await s.one(...apply("SL", "2026-11-06", "2026-11-06", { half: true, per: "Second" }))).r.status).toBe("saved");
    });
  });

  it("F1/F5/F6: 30-day back-dating, joining date and zero-day requests", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      expect((await s.one(...PRE("CL", "2026-09-30", "2026-09-30"))).p.error).toMatch(/30 days/);
      expect((await s.one(...PRE("CL", "2026-10-01", "2026-10-01"))).p.ok).toBe(true);
      expect((await s.one(...PRE("CL", "2026-11-07", "2026-11-08"))).p.error).toMatch(/no working days/);   // Sat+Sun
      expect((await s.one(...PRE("CL", "2021-12-01", "2021-12-02"))).p.error).toBeTruthy();
    });
  });

  it("F2: EL, PL, OH and ML cannot be half days; OH only on an Optional holiday", async () => {
    await withTx(async (s) => {
      await s.as(KCF.SURESH);
      expect((await s.one(...PRE("EL", "2026-11-10", "2026-11-10", true, "First"))).p.error).toMatch(/half day/);
      expect((await s.one(...PRE("OH", "2026-11-10", "2026-11-10"))).p.error).toMatch(/Optional/);
      await s.as(KCF.VIKRAM);
      expect((await s.one(...PRE("OH", "2026-10-20", "2026-10-20"))).p.ok).toBe(true);
    });
  });

  it("H3: the MD's leave is auto-approved with a note", async () => {
    await withTx(async (s) => {
      await s.as(KCF.VIKRAM);
      const r = (await s.one(...apply("CL", "2026-11-10", "2026-11-10"))).r;
      expect(r.request_status).toBe("Approved");
      const row = await s.one("select auto_approved, approver_comment from leave_requests where id = $1", [r.id]);
      expect(row).toEqual({ auto_approved: true, approver_comment: "Auto-approved: no reporting manager" });
    });
  });

  it("H1/H5/H6: manager approves own team only; nobody approves their own; HR can approve anyone's", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      const r = (await s.one(...apply("EL", "2026-11-17", "2026-11-17"))).r;
      expect(await s.fails("select process_leave_request($1,'Approved')", [r.id])).toMatch(/own leave/);
      await s.as(KCF.SANJAY);
      expect(await s.fails("select process_leave_request($1,'Approved')", [r.id])).toMatch(/Not allowed|does not report|42501|not found/i);
      await s.as(KCF.ANITA);
      expect(await s.fails("select process_leave_request($1,'Rejected')", [r.id])).toMatch(/reason/);
      expect((await s.one("select process_leave_request($1,'Approved','OK') r", [r.id])).r.request_status).toBe("Approved");
      // HR admin's own leave goes to their manager (H4), and HR cannot approve it
      await s.as(KCF.MEERA);
      const h = (await s.one(...apply("CL", "2026-11-17", "2026-11-17"))).r;
      expect(await s.fails("select process_leave_request($1,'Approved')", [h.id])).toMatch(/own leave/);
      await s.as(KCF.VIKRAM);
      expect((await s.one("select process_leave_request($1,'Approved') r", [h.id])).r.request_status).toBe("Approved");
      // HR approves Suresh (fail-safe)
      await s.as(KCF.SURESH);
      const t = (await s.one(...apply("EL", "2026-11-17", "2026-11-17"))).r;
      await s.as(KCF.MEERA);
      expect((await s.one("select process_leave_request($1,'Approved') r", [t.id])).r.request_status).toBe("Approved");
    });
  });

  it("D3: balance changes only on approval (pending reduces availability)", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      const before = +(await s.one("select available from get_my_balances(2026) where leave_type = 'EL'")).available;
      const r = (await s.one(...apply("EL", "2026-11-17", "2026-11-18"))).r;
      const row = await s.one("select used::float u, pending::float p, available::float a from get_my_balances(2026) where leave_type = 'EL'");
      expect(row).toEqual({ u: 5, p: 2, a: before - 2 });
      await s.as(KCF.ANITA);
      await s.q("select process_leave_request($1,'Approved')", [r.id]);
      await s.as(KCF.PRIYA);
      const after = await s.one("select used::float u, pending::float p, available::float a from get_my_balances(2026) where leave_type = 'EL'");
      expect(after).toEqual({ u: 7, p: 0, a: before - 2 });
    });
  });

  it("E5/H9: ML goes to HR; HR must confirm 12 or 26 weeks, which fixes the end date", async () => {
    await withTx(async (s) => {
      await s.as("KCF0010");
      const r = (await s.one(...apply("ML", "2026-11-02", "2026-11-02", { weeks: 26 }))).r;
      expect(r.routed_to_hr).toBe(true);
      await s.as(KCF.ANITA);
      expect(await s.fails("select process_leave_request($1,'Approved')", [r.id])).toMatch(/Only HR|not found|Not allowed/i);
      await s.as(KCF.MEERA);
      expect(await s.fails("select process_leave_request($1,'Approved')", [r.id])).toMatch(/12 or 26/);
      await s.q("select process_leave_request($1,'Approved','Eligible',12)", [r.id]);
      const row = await s.one("select to_date::text d, confirmed_weeks from leave_requests where id = $1", [r.id]);
      expect(row).toEqual({ d: "2027-01-24", confirmed_weeks: 12 });
      expect((await s.one("select count(*)::int n from leave_request_days where leave_request_id = $1", [r.id])).n).toBe(84);
    });
  });

  it("I1/I2: cancel a pending request; an approved request that has started cannot be cancelled", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      const r = (await s.one(...apply("EL", "2026-11-17", "2026-11-17"))).r;
      expect((await s.one("select cancel_my_leave($1) r", [r.id])).r.request_status).toBe("Cancelled");
      const past = await s.one("select id from leave_requests where leave_type = 'EL' and status = 'Approved' and from_date = '2026-07-06'");
      expect(await s.fails("select cancel_my_leave($1)", [past.id])).toMatch(/already started/);
    });
  });

  it("G4: leave across the year end charges each date to its own year", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      const p = (await s.one(...PRE("CL", "2026-12-30", "2027-01-04"))).p;
      const by = (y: string) => p.lines.filter((l: any) => l.date.startsWith(y) && l.leave_type === "CL").reduce((a: number, l: any) => a + l.deduction, 0);
      expect(by("2026")).toBe(1.5);       // only 1.5 CL left in 2026
      expect(by("2027")).toBe(2);         // Fri 1 Jan and Mon 4 Jan use the fresh 2027 quota
    });
  });

  it("I3: deactivating an employee cancels leave after the last working day", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      const r = (await s.one(...apply("EL", "2026-11-17", "2026-11-19"))).r;
      await s.as(KCF.MEERA);
      await s.q("select hr_deactivate_employee($1,'2026-11-18')", [await s.id(KCF.PRIYA)]);
      await s.owner();
      const row = await s.one("select to_date::text d, status from leave_requests where id = $1", [r.id]);
      expect(row).toEqual({ d: "2026-11-18", status: "Pending" });
      expect((await s.one("select count(*)::int n from leave_request_days where leave_request_id = $1", [r.id])).n).toBe(2);
    });
  });
});
