// Applies db/migrations/*.sql in order, once each, to DATABASE_URL_DIRECT (the direct, non-pooled Neon string).
// Never drops or resets anything. `--seed` loads db/seed.sql only into an empty employees table.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.DATABASE_URL_DIRECT;
if (!url) { console.error("DATABASE_URL_DIRECT is not set (use .env.local; never commit it)."); process.exit(1); }
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())");
const done = new Set((await client.query("select name from public.schema_migrations")).rows.map((r) => r.name));
for (const f of readdirSync(join(root, "db/migrations")).filter((n) => n.endsWith(".sql")).sort()) {
  if (done.has(f)) continue;
  console.log("applying", f);
  await client.query("begin");
  try {
    await client.query(readFileSync(join(root, "db/migrations", f), "utf8"));
    await client.query("insert into public.schema_migrations (name) values ($1)", [f]);
    await client.query("commit");
  } catch (e) { await client.query("rollback"); console.error("FAILED", f, e.message); process.exit(1); }
}
if (process.argv.includes("--seed")) {
  const n = (await client.query("select count(*)::int n from public.employees")).rows[0].n;
  if (n > 0) console.log("employees is not empty; seed skipped");
  else { await client.query(readFileSync(join(root, "db/seed.sql"), "utf8")); console.log("seeded"); }
}
await client.end();
console.log("done");
