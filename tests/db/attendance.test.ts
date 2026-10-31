import { afterAll, describe, expect, it } from "vitest";
import { KCF, pool, TEST_DB, withTx } from "./helpers";

afterAll(async () => { if (pool) await pool.end(); });

describe.skipIf(!TEST_DB)("attendance (RESEARCH J, K)", () => {
  it("J4: 10:15:59 is within grace, 10:16:00 is Late; WFH is treated the same", async () => {
    await withTx(async (s) => {
      await s.as(KCF.SURESH);
      await s.setNow("2026-11-02 10:15:59+05:30");
      expect((await s.one("select punch_clock('in', false) r")).r.late).toBe(false);
      await s.as(KCF.PRIYA);
      await s.setNow("2026-11-02 10:16:00+05:30");
      expect((await s.one("select punch_clock('in', true) r")).r.late).toBe(true);
    });
  });

  it("J1/section 8: 00:30 IST belongs to the IST date, not the UTC date", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      await s.setNow("2026-11-03 00:30+05:30");
      expect((await s.one("select punch_clock('in') r")).r.date).toBe("2026-11-03");
      expect((await s.one("select ist_today()::text d")).d).toBe("2026-11-03");
    });
  });

  it("punch_clock: one row per day, check-out set once, no check-out before check-in", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      await s.setNow("2026-11-02 09:00+05:30");
      expect(await s.fails("select punch_clock('out')")).toMatch(/Check in first/);
      await s.q("select punch_clock('in')");
      await s.setNow("2026-11-02 09:30+05:30");
      await s.q("select punch_clock('in')");                     // second click returns the existing row
      expect((await s.one("select count(*)::int n from attendance where date = '2026-11-02'")).n).toBe(1);
      await s.setNow("2026-11-02 18:00+05:30");
      await s.q("select punch_clock('out')");
      await s.setNow("2026-11-02 19:00+05:30");
      await s.q("select punch_clock('out')");
      const row = await s.one("select to_char(check_out at time zone 'Asia/Kolkata','HH24:MI') o, to_char(check_in at time zone 'Asia/Kolkata','HH24:MI') i from attendance where date = '2026-11-02'");
      expect(row).toEqual({ o: "18:00", i: "09:00" });
    });
  });

  it("J2/J3: 8h Present, 4-8h Half Day, under 4h Absent (WFH same thresholds)", async () => {
    await withTx(async (s) => {
      await s.owner();
      const p = await s.id(KCF.PRIYA);
      const put = (d: string, i: string, o: string, wfh = false) =>
        s.q("insert into attendance (employee_id,date,check_in,check_out,is_wfh) values ($1,$2,$3,$4,$5) on conflict (employee_id,date) do update set check_in=excluded.check_in, check_out=excluded.check_out, is_wfh=excluded.is_wfh",
          [p, d, `${d} ${i}+05:30`, `${d} ${o}+05:30`, wfh]);
      await put("2026-10-14", "09:00", "17:00");
      await put("2026-10-15", "09:00", "16:59");
      await put("2026-10-16", "09:00", "12:59");
      await put("2026-10-19", "09:00", "17:00", true);
      const st = async (d: string) => (await s.one("select _day_info($1,$2) i", [p, d])).i;
      expect((await st("2026-10-14")).status).toBe("Present");
      const half = await st("2026-10-15");
      expect([half.status, half.buckets]).toEqual(["Half Day", { Present: 0.5, Absent: 0.5 }]);
      expect((await st("2026-10-16")).status).toBe("Absent");
      expect((await st("2026-10-19")).buckets).toEqual({ WFH: 1 });
    });
  });

  it("J8: half-day leave halves the hour thresholds (4h = 0.5 leave + 0.5 Present)", async () => {
    await withTx(async (s) => {
      await s.owner();
      const p = await s.id(KCF.PRIYA);
      expect((await s.one("select _day_info($1,'2026-10-22') i", [p])).i.buckets).toEqual({ CL: 0.5, Present: 0.5 });
    });
  });

  it("K1: a holiday or weekly off wins over a punch; leave wins over a punch; future dates are never Absent", async () => {
    await withTx(async (s) => {
      await s.owner();
      const p = await s.id(KCF.PRIYA);
      await s.q("insert into attendance (employee_id,date,check_in,check_out) values ($1,'2026-10-02','2026-10-02 10:00+05:30','2026-10-02 18:00+05:30')", [p]);
      expect((await s.one("select _day_info($1,'2026-10-02') i", [p])).i.status).toBe("Holiday");
      await s.q("insert into attendance (employee_id,date,check_in,check_out) values ($1,'2026-10-13','2026-10-13 10:00+05:30','2026-10-13 18:00+05:30')", [p]);
      expect((await s.one("select _day_info($1,'2026-10-13') i", [p])).i.status).toBe("On Leave");
      expect((await s.one("select _day_info($1,'2026-11-10') i", [p])).i.buckets).toEqual({});
      expect((await s.one("select _day_info($1,'2026-10-21') i", [p])).i.status).toBe("Absent");   // J11
    });
  });

  it("J6/J7: regularisation changes attendance only on approval; rejection makes the day Absent; one pending per date", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      expect((await s.one("select get_month_days($1,'2026-10-01') r", [await s.id(KCF.PRIYA)])).r).toBeTruthy();
      await s.as(KCF.PRIYA);
      expect(await s.fails("select request_regularisation('2026-10-27','2026-10-27 09:58+05:30','2026-10-27 18:45+05:30','again')")).toMatch(/already pending/);
      const req = await s.one("select id from regularisation_requests where attendance_date = '2026-10-27'");
      expect(await s.fails("select process_regularisation($1,'Approved')", [req.id])).toMatch(/own correction/);
      await s.as(KCF.ANITA);
      await s.q("select process_regularisation($1,'Approved','OK')", [req.id]);
      await s.owner();
      expect((await s.one("select _day_info($1,'2026-10-27') i", [await s.id(KCF.PRIYA)])).i.status).toBe("Present");
      const audit = await s.one("select old_data->>'check_out' co from audit_log where action = 'attendance_corrected' order by created_at desc limit 1");
      expect(audit.co).toBeNull();           // the original punches were written to audit_log (J10)
    });
  });

  it("J7: a rejected regularisation turns the day Absent", async () => {
    await withTx(async (s) => {
      await s.as(KCF.ANITA);
      const req = await s.one("select id from regularisation_requests where attendance_date = '2026-10-27'");
      await s.q("select process_regularisation($1,'Rejected','No')", [req.id]);
      await s.owner();
      expect((await s.one("select _day_info($1,'2026-10-27') i", [await s.id(KCF.PRIYA)])).i.status).toBe("Absent");
    });
  });

  it("J12: after the month closes only HR approves; the manager no longer can", async () => {
    await withTx(async (s) => {
      await s.as(KCF.ANITA);
      const req = await s.one("select id from regularisation_requests where attendance_date = '2026-10-27'");
      await s.setNow("2026-11-02 10:00+05:30");
      expect(await s.fails("select process_regularisation($1,'Approved')", [req.id])).toMatch(/cannot decide/);
      await s.as(KCF.MEERA);
      await s.q("select process_regularisation($1,'Approved','HR')", [req.id]);
    });
  });

  it("J12: the HR Admin's own closed-month correction goes to their manager only", async () => {
    await withTx(async (s) => {
      await s.owner();
      const m = await s.id(KCF.MEERA);
      await s.q("insert into attendance (employee_id,date,check_in) values ($1,'2026-10-14','2026-10-14 09:00+05:30')", [m]);
      await s.setNow("2026-11-02 10:00+05:30");
      await s.as(KCF.MEERA);
      const r = (await s.one("select request_regularisation('2026-10-14','2026-10-14 09:00+05:30','2026-10-14 18:00+05:30','forgot') r")).r;
      expect((await s.one("select approver_id from regularisation_requests where id = $1", [r.id])).approver_id).toBe(await s.id(KCF.VIKRAM));
      expect(await s.fails("select process_regularisation($1,'Approved')", [r.id])).toMatch(/own correction|reporting manager/);
      await s.as(KCF.ANITA);
      expect(await s.fails("select approve_hr_admin_own_correction($1)", [r.id])).toMatch(/Not allowed/);
      await s.as(KCF.VIKRAM);
      await s.q("select approve_hr_admin_own_correction($1,'ok')", [r.id]);
    });
  });

  it("J13: HR corrects directly (reason required, never their own); a manager's request goes to HR", async () => {
    await withTx(async (s) => {
      const priya = await s.id(KCF.PRIYA);
      await s.as(KCF.MEERA);
      expect(await s.fails("select hr_correct_attendance($1,'2026-10-21','2026-10-21 09:00+05:30','2026-10-21 18:00+05:30','')", [priya])).toMatch(/reason/);
      await s.q("select hr_correct_attendance($1,'2026-10-21','2026-10-21 09:00+05:30','2026-10-21 18:00+05:30','Verified with manager')", [priya]);
      expect((await s.one("select _day_info($1,'2026-10-21') i", [priya])).i.status).toBe("Present");
      expect(await s.fails("select hr_correct_attendance($1,'2026-10-21','2026-10-21 09:00+05:30','2026-10-21 18:00+05:30','x')", [await s.id(KCF.MEERA)])).toMatch(/own record/);
      await s.as(KCF.ANITA);
      const r = (await s.one("select request_regularisation('2026-10-21','2026-10-21 09:00+05:30','2026-10-21 18:00+05:30','mgr',$1) r", [await s.id("KCF0010")])).r;
      expect((await s.one("select approver_id, requested_by from regularisation_requests where id = $1", [r.id])).approver_id).toBeNull();
      expect(await s.fails("select process_regularisation($1,'Approved')", [r.id])).toMatch(/cannot decide/);
    });
  });
});
