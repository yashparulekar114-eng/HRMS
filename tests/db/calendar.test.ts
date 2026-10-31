import { afterAll, describe, expect, it } from "vitest";
import { KCF, pool, TEST_DB, withTx } from "./helpers";

afterAll(async () => { if (pool) await pool.end(); });

describe.skipIf(!TEST_DB)("calendar, balances (RESEARCH A-D, E, K)", () => {
  it("E2: Fri-Mon is 2 days at Panaji and 3 days at Verna", async () => {
    await withTx(async (s) => {
      const loc = await s.q("select id, name from locations");
      const panaji = loc.find((l) => l.name.startsWith("Panaji")).id, verna = loc.find((l) => l.name.startsWith("Verna")).id;
      // Fri 6 Nov 2026 to Mon 9 Nov 2026
      expect((await s.one("select count_working_days($1,'2026-11-06','2026-11-09') n", [panaji])).n).toBe(2);
      expect((await s.one("select count_working_days($1,'2026-11-06','2026-11-09') n", [verna])).n).toBe(3);
    });
  });

  it("E3: ML counts calendar days; 26 weeks = 182", async () => {
    await withTx(async (s) => {
      const l = (await s.one("select id from locations limit 1")).id;
      expect((await s.one("select count_working_days($1,'2026-11-02','2027-05-02', true) n", [l])).n).toBe(182);
    });
  });

  it("K2: a Saturday holiday is a Holiday at both sites; Verna-only shutdown stays at Verna", async () => {
    await withTx(async (s) => {
      const rows = await s.q("select l.name, c.kind from locations l, location_calendar(l.id,'2026-12-19','2026-12-19') c");
      expect(rows.every((r) => r.kind === "holiday")).toBe(true);
      const shut = await s.q("select l.name, c.kind from locations l, location_calendar(l.id,'2026-12-14','2026-12-14') c");
      expect(shut.find((r) => r.name.startsWith("Verna")).kind).toBe("holiday");
      expect(shut.find((r) => r.name.startsWith("Panaji")).kind).toBe("working");
    });
  });

  it("DESIGN sample data: Priya's balances", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      const b = Object.fromEntries((await s.q("select * from get_my_balances(2026)")).map((r) => [r.leave_type, r]));
      expect([+b.CL.accrued, +b.CL.used, +b.CL.pending, +b.CL.available]).toEqual([8, 6, 0.5, 1.5]);
      expect(+b.SL.available).toBe(5);
      expect(+b.EL.available).toBe(19.5);
      expect(+b.OH.available).toBe(1);
      expect((await s.one("select get_my_late_marks('2026-10-01') n")).n).toBe(1);
    });
  });

  it("B5: pro-rated CL/SL for 1 July, 15 July and 20 July joiners", async () => {
    await withTx(async (s) => {
      const ent = async (doj: string, t: string) => {
        await s.owner();
        const r = await s.one(`update employees set doj = $1 where employee_code = 'KCF0010' returning id`, [doj]);
        return +(await s.one("select _entitlement($1,$2,2026) v", [r.id, t])).v;
      };
      expect(await ent("2026-07-01", "CL")).toBe(4);
      expect(await ent("2026-07-01", "SL")).toBe(3.5);
      expect(await ent("2026-07-15", "CL")).toBe(4);
      expect(await ent("2026-07-20", "CL")).toBe(3.5);
      expect(await ent("2026-07-20", "SL")).toBe(3);
      expect(await ent("2026-07-20", "OH")).toBe(2);      // OH is not pro-rated (A3)
    });
  });

  it("C2/C7: a 20 July joiner has 5.0 EL on 31 December", async () => {
    await withTx(async (s) => {
      const r = await s.one(`update employees set doj = '2026-07-20' where employee_code = 'KCF0010' returning id`);
      await s.setNow("2026-12-31 12:00+05:30");
      expect(+(await s.one("select _el_accrued($1,2026,'2026-12-31') v", [r.id])).v).toBe(5);
    });
  });

  it("C4/C6: EL carries forward at most 30, then the 1 January credit is added", async () => {
    await withTx(async (s) => {
      const id = await s.id(KCF.PRIYA);
      await s.owner();
      await s.q("update leave_opening_balances set opening_balance = 29 where employee_id = $1 and leave_type = 'EL'", [id]);
      await s.setNow("2027-01-02 10:00+05:30");
      const b = await s.one("select * from _leave_balance($1,'EL',2027)", [id]);
      expect(+b.opening).toBe(30);        // 29 + 12.5.. capped at 30
      expect(+b.accrued).toBe(1.25);
    });
  });
});
