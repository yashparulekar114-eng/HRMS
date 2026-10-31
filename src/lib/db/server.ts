import "server-only";
import { Pool, types, type PoolClient } from "pg";
import { auth } from "@clerk/nextjs/server";

// Dates stay as 'YYYY-MM-DD' strings (never a browser/server-local Date), numerics become numbers.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(20, (v) => parseInt(v, 10));

let pool: Pool | undefined;
function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured.");
  // `app_user` is a limited role (not the owner); RLS applies to everything it does (CLAUDE.md rule 3).
  return (pool ??= new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 10_000 }));
}

export class DbError extends Error {
  constructor(message: string, public code?: string, public constraint?: string) { super(message); }
}

export type Db = {
  /** SELECT / any SQL with positional params. */
  rows<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** Calls a Postgres function with named arguments and returns its single value (jsonb, scalar). */
  call<T = any>(fn: string, args?: Record<string, unknown>): Promise<T>;
  /** Calls a set-returning Postgres function. */
  table<T = Record<string, any>>(fn: string, args?: Record<string, unknown>): Promise<T[]>;
};

const IDENT = /^[a-z_][a-z0-9_]*$/;
function namedCall(fn: string, args: Record<string, unknown> = {}) {
  if (!IDENT.test(fn)) throw new Error("bad function name");
  const keys = Object.keys(args);
  keys.forEach((k) => { if (!IDENT.test(k)) throw new Error("bad argument name"); });
  const params = keys.map((k) => {
    const v = args[k];
    return v !== null && typeof v === "object" && !(v instanceof Buffer) && !(v instanceof Date) ? JSON.stringify(v) : v;
  });
  return { text: `public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, params };
}

function wrap(c: PoolClient): Db {
  const run = async (sql: string, params?: unknown[]) => {
    try { return (await c.query(sql, params as any[])).rows; }
    catch (e: any) { throw new DbError(e.message, e.code, e.constraint); }
  };
  return {
    rows: run as Db["rows"],
    one: (async (sql: string, params?: unknown[]) => (await run(sql, params))[0]) as Db["one"],
    call: async (fn, args) => {
      const { text, params } = namedCall(fn, args);
      const rows = await run(`select ${text} as v`, params);
      return rows[0]?.v;
    },
    table: async (fn, args) => {
      const { text, params } = namedCall(fn, args);
      return run(`select * from ${text}`, params);
    },
  };
}

/**
 * Runs fn as the signed-in Clerk user: one transaction, `SET LOCAL ROLE authenticated`, and the verified
 * token claims in `request.jwt.claims`. Postgres RLS and the SQL functions take the caller from there.
 */
export async function withUser<T>(fn: (db: Db) => Promise<T>, extraClaims: Record<string, string> = {}): Promise<T> {
  const { userId } = await auth();
  if (!userId) throw new DbError("Not signed in", "42501");
  return withClaims({ sub: userId, role: "authenticated", ...extraClaims }, fn);
}

export async function withClaims<T>(claims: Record<string, string>, fn: (db: Db) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const out = await fn(wrap(c));
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
