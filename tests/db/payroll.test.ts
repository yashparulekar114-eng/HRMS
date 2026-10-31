import { afterAll, describe, expect, it } from "vitest";
import { KCF, pool, TEST_DB, withTx } from "./helpers";
import { createHash } from "node:crypto";

afterAll(async () => { if (pool) await pool.end(); });
const NOV = "2026-11-03 10:00+05:30";

const parse = (csv: string) => {
  const [h, ...lines] = csv.trimEnd().split("\n");
  const head = h.split(",");
  return lines.map((l) => { const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "")); return Object.fromEntries(head.map((k, i) => [k, cells[i]])); });
};

describe.skipIf(!TEST_DB)("month end and payroll (RESEARCH J12, L)", () => {
  it("L6a: cannot finalise before the month closes, or as a non-HR user; each month only once", async () => {
    await withTx(async (s) => {
      await s.as(KCF.MEERA);
      expect(await s.fails("select hr_finalise_month('2026-10-01')")).toMatch(/not closed yet/);
      await s.setNow(NOV);
      await s.as(KCF.ANITA);
      expect(await s.fails("select hr_finalise_month('2026-10-01')")).toMatch(/HR only/);
      await s.as(KCF.MEERA);
      await s.q("select hr_finalise_month('2026-10-01')");
      expect(await s.fails("select hr_finalise_month('2026-10-01')")).toMatch(/already finalised.*November/);
    });
  });

  it("L1/L6: every final row adds up to the calendar days; checksum matches; CSV is deterministic and masks nothing it shouldn't contain", async () => {
    await withTx(async (s) => {
      await s.setNow(NOV);
      await s.as(KCF.MEERA);
      const before = (await s.one("select hr_month_csv('2026-10-01') c")).c;
      const r = (await s.one("select hr_finalise_month('2026-10-01') r")).r;
      const stored = await s.one("select csv_content c, checksum k from payroll_exports");
      expect(stored.c).toBe(before);                                   // preview == final
      expect(stored.k).toBe(createHash("sha256").update(stored.c, "utf8").digest("hex"));
      expect(r.checksum).toBe(stored.k);
      expect(stored.c).not.toMatch(/\r/);
      const rows = parse(stored.c);
      expect(rows.length).toBe(19);
      const cols = ["Present", "WFH", "CL", "SL", "EL", "ML", "PL", "OH", "LOP_leave", "Absent", "Holidays", "Weekly_offs"];
      for (const row of rows) {
        const total = cols.reduce((a, c) => a + parseFloat(row[c]), 0);
        expect(total, row.Employee_code).toBe(31);
        expect(parseFloat(row.Pending)).toBe(0);
      }
      const priya = rows.find((x) => x.Employee_code === KCF.PRIYA)!;
      // 1 Late only -> no Late_LOP; Absent: 21 Oct + 27 Oct (pending became Absent) + half of 8 Oct
      expect([priya.Late_marks, priya.Late_LOP, priya.Absent, priya.CL, priya.OH]).toEqual(["1", "0.0", "2.5", "2.5", "1.0"]);
      expect(rows.map((x) => x.Employee_code)).toEqual([...rows.map((x) => x.Employee_code)].sort());
      expect((await s.one("select count(*)::int n from payroll_month_snapshots")).n).toBeGreaterThan(500);
    });
  });

  it("J5/L3: Late_LOP = floor(lates / 3) x 0.5, outside the day total", async () => {
    await withTx(async (s) => {
      await s.owner();
      const p = await s.id(KCF.SURESH);
      for (const d of ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12"]) {
        await s.q("insert into attendance (employee_id,date,check_in,check_out) values ($1,$2,$3,$4)", [p, d, `${d} 10:30+05:30`, `${d} 19:00+05:30`]);
      }
      await s.setNow(NOV);
      await s.as(KCF.MEERA);
      const row = parse((await s.one("select hr_month_csv('2026-10-01') c")).c).find((x) => x.Employee_code === KCF.SURESH)!;
      expect([row.Late_marks, row.Late_LOP]).toEqual(["6", "1.0"]);
    });
  });

  it("L7: a correction to a finalised month becomes one adjustment in the next export; the finalised CSV never changes", async () => {
    await withTx(async (s) => {
      await s.setNow(NOV);
      await s.as(KCF.MEERA);
      await s.q("select hr_finalise_month('2026-10-01')");
      const octCsv = (await s.one("select csv_content c from payroll_exports")).c;
      const req = await s.one("select id from regularisation_requests where attendance_date = '2026-10-27'");
      await s.q("select process_regularisation($1,'Approved','Confirmed worked full day')", [req.id]);
      const adj = await s.one("select payroll_month::text pm, lop_delta::float lop, bucket_deltas from payroll_adjustments");
      expect(adj).toEqual({ pm: "2026-11-01", lop: -1, bucket_deltas: { Absent: -1, Present: 1 } });
      expect((await s.one("select csv_content c from payroll_exports")).c).toBe(octCsv);
      const nov = parse((await s.one("select hr_month_csv('2026-11-01') c")).c).find((x) => x.Employee_code === KCF.PRIYA)!;
      expect(nov.Adjustment_LOP).toBe("-1.0");
      expect(parseFloat(nov.Net_LOP)).toBe(parseFloat(nov.Total_LOP) - 1);
      expect(nov.Adjustment_detail).toMatch(/27 Oct/);
      // a second legitimate correction is measured against the last accounted state (not the original punches)
      await s.q("select hr_correct_attendance($1,'2026-10-27','2026-10-27 09:00+05:30','2026-10-27 13:30+05:30','Left early')", [await s.id(KCF.PRIYA)]);
      const second = await s.one("select bucket_deltas from payroll_adjustments order by seq desc limit 1");
      expect(second.bucket_deltas).toEqual({ Absent: 0.5, Present: -0.5 });
    });
  });

  it("L7/H9: leave touching a finalised month goes to HR only, and its approval writes an adjustment", async () => {
    await withTx(async (s) => {
      await s.setNow(NOV);
      await s.as(KCF.MEERA);
      await s.q("select hr_finalise_month('2026-10-01')");
      await s.as(KCF.SURESH);
      const r = (await s.one("select apply_leave('SL','2026-10-30','2026-10-30',false,null,'Fever',null,false,null) r")).r;
      expect(r.routed_to_hr).toBe(true);
      await s.as(KCF.SANJAY);
      expect(await s.fails("select process_leave_request($1,'Approved')", [r.id])).toMatch(/Only HR|Not allowed/);
      await s.as(KCF.MEERA);
      await s.q("select process_leave_request($1,'Approved')", [r.id]);
      const adj = await s.one("select payroll_month::text pm, bucket_deltas from payroll_adjustments where employee_id = $1", [await s.id(KCF.SURESH)]);
      expect(adj.pm).toBe("2026-11-01");
      expect(adj.bucket_deltas).toEqual({ Absent: -1, SL: 1 });
    });
  });

  it("L8: holidays and leave settings are locked for finalised periods; leave corrections are not blocked", async () => {
    await withTx(async (s) => {
      await s.setNow(NOV);
      await s.as(KCF.MEERA);
      const loc = (await s.one("select id from locations limit 1")).id;
      await s.q("select hr_finalise_month('2026-10-01')");
      expect(await s.fails("select hr_upsert_holiday($1,'2026-10-26','Test','State')", [loc])).toMatch(/finalised/);
      expect(await s.fails("select hr_set_leave_settings('CL',2026,9)")).toMatch(/locked/);
      await s.q("select hr_set_leave_settings('CL',2027,9)");
      await s.q("select hr_upsert_holiday($1,'2026-11-26','Test','State')", [loc]);
      await s.owner();
      expect(await s.fails("delete from holidays where date = '2026-10-02'")).toMatch(/finalised/);
    });
  });

  it("L9: a manager's summary has direct reports only; HR sees everyone; employees get an error", async () => {
    await withTx(async (s) => {
      await s.setNow(NOV);
      await s.as(KCF.ANITA);
      const rows = await s.q("select employee_code from get_team_month_summary('2026-10-01')");
      expect(rows.length).toBe(6);
      expect(rows.map((r) => r.employee_code)).not.toContain(KCF.SURESH);
      await s.as(KCF.PRIYA);
      expect(await s.fails("select * from get_team_month_summary('2026-10-01')")).toMatch(/managers/);
      expect(await s.fails("select hr_month_csv('2026-10-01')")).toMatch(/HR only/);
      await s.as(KCF.ANITA);
      expect(await s.fails("select * from hr_month_summary('2026-10-01')")).toMatch(/HR only/);
      expect((await s.one("select count(*)::int n from payroll_exports")).n).toBe(0);      // RLS: HR only
    });
  });

  it("rule 12/13: payroll rows cannot be changed or deleted, even by the owner", async () => {
    await withTx(async (s) => {
      await s.setNow(NOV);
      await s.as(KCF.MEERA);
      await s.q("select hr_finalise_month('2026-10-01')");
      await s.owner();
      expect(await s.fails("update payroll_exports set csv_content = 'x'")).toMatch(/insert-only/);
      expect(await s.fails("delete from payroll_month_snapshots")).toMatch(/insert-only/);
    });
  });
});
