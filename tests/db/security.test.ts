import { afterAll, describe, expect, it } from "vitest";
import { KCF, pool, TEST_DB, withTx } from "./helpers";

afterAll(async () => { if (pool) await pool.end(); });

const LOC = "a0000000-0000-0000-0000-000000000001", DEP = "b0000000-0000-0000-0000-000000000002";
const NEW_EMP = (o: Record<string, unknown> = {}) => ({
  location_id: LOC, department_id: DEP,
  first_name: "Asha", last_name: "Naik", email: "asha.naik@konkancoastal.example", mobile: "9876500099", gender: "Female",
  address_line: "12 Beach Road", city: "Panaji", address_pin: "403001", address_state: "Goa", doj: "2026-11-02", dob: "1998-05-05",
  designation: "Executive", pan_number: "ABCDE1234F", aadhaar_number: "123456789012", bank_name: "SBI", bank_account: "123456789012",
  ifsc: "SBIN0001234", emergency_contact_name: "Ravi", emergency_contact_phone: "9876500098", ...o,
});

describe.skipIf(!TEST_DB)("security (ARCHITECTURE section 4, CLAUDE.md rules)", () => {
  it("RLS: an employee sees only their own row; a manager sees self + direct reports; HR sees all", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      expect((await s.q("select employee_code from employees")).map((r) => r.employee_code)).toEqual([KCF.PRIYA]);
      await s.as(KCF.ANITA);
      expect((await s.q("select employee_code from employees")).length).toBe(8);        // herself + 7 reports (incl. inactive Neha)
      await s.as(KCF.MEERA);
      expect((await s.one("select count(*)::int n from employees")).n).toBe(20);
      await s.as(null);
      expect((await s.one("select count(*)::int n from employees")).n).toBe(0);
    });
  });

  it("writes: no direct INSERT/UPDATE/DELETE on core tables, so is_hr_admin cannot be self-granted", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      expect(await s.fails("update employees set is_hr_admin = true")).toMatch(/permission denied/);
      expect(await s.fails("insert into attendance (employee_id,date) values (me(),'2026-11-02')")).toMatch(/permission denied/);
      expect(await s.fails("update leave_requests set status = 'Approved'")).toMatch(/permission denied/);
      expect(await s.fails("delete from audit_log")).toMatch(/permission denied/);
      await s.as(KCF.MEERA);
      expect(await s.fails("update employees set is_hr_admin = true where employee_code = 'KCF0008'")).toMatch(/permission denied/);
      expect(await s.fails("delete from audit_log")).toMatch(/permission denied/);
    });
  });

  it("rule 12: audit_log, payroll tables are insert-only even for the table owner", async () => {
    await withTx(async (s) => {
      await s.owner();
      await s.q("insert into audit_log (action) values ('x')");
      expect(await s.fails("delete from audit_log")).toMatch(/insert-only/);
      expect(await s.fails("update audit_log set action = 'y'")).toMatch(/insert-only/);
    });
  });

  it("rule 10: statutory data is masked for the employee; raw rows are not readable; only HR reveals, and it is logged", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      expect(await s.fails("select * from employee_sensitive")).toMatch(/permission denied/);
      const m = (await s.one("select get_sensitive_masked(me()) m")).m;
      expect(m.pan).toMatch(/^X+\d{3}[A-Z]$/);
      expect(m.aadhaar).toMatch(/^X{8}\d{4}$/);
      expect(await s.fails("select get_sensitive_masked($1)", [await s.id(KCF.SURESH)])).toMatch(/Not allowed/);
      expect(await s.fails("select reveal_sensitive(me(), 'pan_number')")).toMatch(/HR only/);
      await s.as(KCF.ANITA);
      expect(await s.fails("select get_sensitive_masked($1)", [await s.id(KCF.PRIYA)])).toMatch(/Not allowed/);
      await s.as(KCF.MEERA);
      const v = (await s.one("select reveal_sensitive($1,'aadhaar_number') v", [await s.id(KCF.PRIYA)])).v;
      expect(v).toMatch(/^\d{12}$/);
      expect((await s.one("select count(*)::int n from audit_log where action = 'reveal'")).n).toBe(1);
    });
  });

  it("emergency details: the direct manager can read them, another manager cannot", async () => {
    await withTx(async (s) => {
      await s.as(KCF.ANITA);
      expect((await s.one("select count(*)::int n from employee_emergency")).n).toBe(8);
      await s.as(KCF.SANJAY);
      expect((await s.q("select employee_id from employee_emergency where employee_id = $1", [await s.id(KCF.PRIYA)])).length).toBe(0);
    });
  });

  it("section 4: an employee past their last working day is not signed in to anything", async () => {
    await withTx(async (s) => {
      await s.as(KCF.NEHA);
      expect((await s.one("select me() m")).m).toBeNull();
      expect(await s.fails("select apply_leave('CL','2026-11-10','2026-11-10',false,null,'x',null,false,null)")).toMatch(/active employee/);
      expect((await s.one("select link_my_account() r")).r).toEqual(expect.objectContaining({ active: false }));
    });
  });

  it("first login links the account by the token's email; unknown emails are refused", async () => {
    await withTx(async (s) => {
      await s.as(KCF.MEERA);
      const r = (await s.one("select hr_add_employee($1::jsonb) r", [JSON.stringify(NEW_EMP())])).r;
      expect(r.employee_code).toMatch(/^KCF00(2\d|[3-9]\d)$/);      // from the sequence; never reused
      await s.owner();
      await s.q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: "user_new", email: "ASHA.NAIK@konkancoastal.example" })]);
      await s.q("set role authenticated");
      expect((await s.one("select link_my_account() r")).r.active).toBe(true);
      await s.owner();
      await s.q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: "user_stranger", email: "nobody@example.com" })]);
      await s.q("set role authenticated");
      expect(await s.fails("select link_my_account()")).toMatch(/No employee record/);
    });
  });

  it("E1: invalid PAN, Aadhaar, IFSC, mobile and age under 18 are rejected; HR only", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      expect(await s.fails("select hr_add_employee($1::jsonb)", [JSON.stringify(NEW_EMP())])).toMatch(/HR only/);
      await s.as(KCF.MEERA);
      for (const bad of [{ pan_number: "ABC123" }, { aadhaar_number: "1234" }, { ifsc: "SBIN123" }, { mobile: "987650009" }, { dob: "2008-12-01" }, { address_pin: "4030" }]) {
        const msg = await s.fails("select hr_add_employee($1::jsonb)", [JSON.stringify(NEW_EMP(bad))]);
        expect(msg, JSON.stringify(bad)).toMatch(/violates check constraint/);
      }
      expect(await s.fails("select hr_add_employee($1::jsonb)", [JSON.stringify(NEW_EMP({ email: "PRIYA.DESAI+clerk_test@example.com" }))])).toMatch(/unique|duplicate/);
    });
  });

  it("manager loops (A -> B -> A) are rejected", async () => {
    await withTx(async (s) => {
      await s.as(KCF.MEERA);
      // Anita reports to Vikram; Priya reports to Anita. Making Anita report to Priya forms a loop.
      expect(await s.fails("select hr_update_employee_job($1, jsonb_build_object('manager_id', $2::uuid))", [await s.id(KCF.ANITA), await s.id(KCF.PRIYA)])).toMatch(/loop/);
      expect(await s.fails("select hr_update_employee_job($1, jsonb_build_object('manager_id', $1::uuid))", [await s.id(KCF.PRIYA)])).toMatch(/check constraint|loop/);
    });
  });

  it("deactivating a manager requires a new manager for the direct reports, then pending items move to HR", async () => {
    await withTx(async (s) => {
      await s.as(KCF.PRIYA);
      const r = (await s.one("select apply_leave('EL','2026-11-17','2026-11-17',false,null,'x',null,false,null) r")).r;
      await s.as(KCF.MEERA);
      const anita = await s.id(KCF.ANITA);
      expect(await s.fails("select hr_deactivate_employee($1,'2026-11-30')", [anita])).toMatch(/new manager/);
      await s.q("select hr_deactivate_employee($1,'2026-11-30',$2)", [anita, await s.id(KCF.VIKRAM)]);
      const row = await s.one("select approver_id, routed_to_hr from leave_requests where id = $1", [r.id]);
      expect(row).toEqual({ approver_id: null, routed_to_hr: true });
      expect((await s.one("select count(*)::int n from employees where manager_id = $1 and last_working_day is null", [anita])).n).toBe(0);
    });
  });

  it("every table has RLS enabled, and anonymous (no token) callers get nothing", async () => {
    await withTx(async (s) => {
      await s.owner();
      const off = await s.q("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity and relname <> 'schema_migrations'");
      expect(off).toEqual([]);
      await s.as(null);
      expect(await s.fails("select get_my_balances()")).toMatch(/active employee/);
      expect((await s.one("select count(*)::int n from leave_requests")).n).toBe(0);
    });
  });

  it("SECURITY DEFINER functions all pin search_path (rule 6)", async () => {
    await withTx(async (s) => {
      await s.owner();
      const rows = await s.q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and not coalesce(p.proconfig::text like '%search_path=public%', false)`);
      expect(rows).toEqual([]);
    });
  });
});
