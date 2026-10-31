import pg from "pg";

export const TEST_DB = process.env.TEST_DATABASE_URL;
export const pool = TEST_DB ? new pg.Pool({ connectionString: TEST_DB, max: 4 }) : (null as unknown as pg.Pool);

export type Session = {
  q: <T = any>(sql: string, params?: readonly unknown[]) => Promise<T[]>;
  one: <T = any>(sql: string, params?: readonly unknown[]) => Promise<T>;
  fails: (sql: string, params?: readonly unknown[]) => Promise<string>;
  as: (code: string | null, claims?: Record<string, unknown>) => Promise<void>;
  owner: () => Promise<void>;
  setNow: (iso: string) => Promise<void>;
  id: (code: string) => Promise<string>;
};

/** Runs fn in a transaction that is always rolled back. `as(code)` acts as that employee through the real token path. */
export async function withTx(fn: (s: Session) => Promise<void>, now = "2026-10-31 12:00+05:30") {
  const c = await pool.connect();
  let authed = false;
  const exec = async (sql: string, params?: readonly unknown[]) => (await c.query(sql, params as any)).rows;
  const s: Session = {
    q: exec,
    one: async (sql, params) => (await exec(sql, params))[0],
    fails: async (sql, params) => {
      await c.query("savepoint s");
      try { await c.query(sql, params as any); } catch (e: any) { await c.query("rollback to savepoint s"); return e.message as string; }
      await c.query("release savepoint s");
      throw new Error("expected the statement to fail: " + sql);
    },
    owner: async () => { authed = false; await c.query("reset role"); },
    setNow: async (iso) => { await c.query("select set_config('app.now', $1, true)", [iso]); },
    id: async (code) => {
      await c.query("reset role");
      const r = await c.query("select id from employees where employee_code = $1", [code]);
      if (authed) await c.query("set role authenticated");
      return r.rows[0].id;
    },
    as: async (code, claims = {}) => {
      await c.query("reset role");
      authed = true;
      if (code === null) { await c.query("select set_config('request.jwt.claims', '', true)"); }
      else {
        const sub = "user_" + code;
        await c.query("update employees set clerk_user_id = $1 where employee_code = $2 and clerk_user_id is null", [sub, code]);
        const email = (await c.query("select email from employees where employee_code = $1", [code])).rows[0]?.email;
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, email, role: "authenticated", ...claims })]);
      }
      await c.query("set role authenticated");
    },
  };
  try {
    await c.query("begin");
    await s.setNow(now);
    await fn(s);
  } finally {
    await c.query("rollback");
    c.release();
  }
}

export const KCF = { VIKRAM: "KCF0001", MEERA: "KCF0002", ANITA: "KCF0003", SANJAY: "KCF0004", PRIYA: "KCF0008", SURESH: "KCF0014", NEHA: "KCF0019" };
