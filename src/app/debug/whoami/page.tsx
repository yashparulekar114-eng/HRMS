import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { istToday } from "@/lib/dates/ist";

// TEMPORARY (checkpoint 3 only). Removed in checkpoint 4 together with
// public.debug_whoami() and public.rls_probe.
// Shows only sub, role, iss, IST date and safe error details. Never the raw
// JWT, tokens, keys or full error objects.
export const dynamic = "force-dynamic";

type WhoAmI = { sub?: string | null; role?: string | null; iss?: string | null; ist_today?: string | null };
type SafeError = { code: string | null; message: string } | null;

function safeError(e: { code?: string; message?: string } | null | undefined): SafeError {
  return e ? { code: e.code ?? null, message: (e.message ?? "Unknown error").slice(0, 200) } : null;
}

async function addProbeRow() {
  "use server";
  const supabase = await createServerSupabase();
  await supabase.from("rls_probe").insert({ note: `probe at ${new Date().toISOString()}` });
  revalidatePath("/debug/whoami");
}

export default async function WhoAmIPage() {
  const { userId } = await auth();
  const supabase = await createServerSupabase();

  const who = await supabase.rpc("debug_whoami");
  const raw = (who.data ?? null) as WhoAmI | null;
  const db: WhoAmI | null = raw
    ? { sub: raw.sub ?? null, role: raw.role ?? null, iss: raw.iss ?? null, ist_today: raw.ist_today ?? null }
    : null;

  const probes = await supabase
    .from("rls_probe")
    .select("id, owner_sub, note, created_at")
    .order("created_at", { ascending: true });
  const rows = probes.data ?? [];
  const otherOwners = rows.filter((r) => r.owner_sub !== db?.sub).length;

  const appToday = istToday();
  const checks = [
    { label: "Postgres sees the Clerk user ID (sub = Clerk userId)", ok: !!db?.sub && db.sub === userId },
    { label: "Postgres role is 'authenticated'", ok: db?.role === "authenticated" },
    { label: "Database IST date = app IST date", ok: !!db?.ist_today && db.ist_today === appToday },
    { label: "Every visible probe row belongs to me (RLS)", ok: probes.error == null && otherOwners === 0 },
  ];

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-sm">
      <h1 className="text-xl font-bold" style={{ color: "var(--primary)" }}>/debug/whoami</h1>
      <p className="mt-1 text-slate-600">Temporary checkpoint 3 check. Shows no tokens, keys or raw errors.</p>

      <section className="mt-5 rounded-lg border bg-white p-4" style={{ borderColor: "var(--border)" }}>
        <h2 className="font-semibold">What Postgres sees</h2>
        <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1">
          <dt>sub</dt><dd data-testid="sub">{db?.sub ?? "—"}</dd>
          <dt>role</dt><dd data-testid="role">{db?.role ?? "—"}</dd>
          <dt>iss</dt><dd data-testid="iss">{db?.iss ?? "—"}</dd>
          <dt>IST date (DB)</dt><dd data-testid="ist-db">{db?.ist_today ?? "—"}</dd>
          <dt>IST date (app)</dt><dd data-testid="ist-app">{appToday}</dd>
        </dl>
        {who.error && <p className="mt-2 text-red-700" data-testid="rpc-error">Error {safeError(who.error)?.code}: {safeError(who.error)?.message}</p>}
      </section>

      <section className="mt-4 rounded-lg border bg-white p-4" style={{ borderColor: "var(--border)" }}>
        <h2 className="font-semibold">Checks</h2>
        <ul className="mt-2 space-y-1">
          {checks.map((c) => (
            <li key={c.label} data-testid="check">{c.ok ? "✅" : "❌"} {c.label}</li>
          ))}
        </ul>
      </section>

      <section className="mt-4 rounded-lg border bg-white p-4" style={{ borderColor: "var(--border)" }}>
        <h2 className="font-semibold">RLS probe rows visible to me ({rows.length})</h2>
        {probes.error && <p className="mt-2 text-red-700">Error {safeError(probes.error)?.code}: {safeError(probes.error)?.message}</p>}
        <ul className="mt-2 space-y-1" data-testid="probe-rows">
          {rows.map((r) => (
            <li key={r.id}>{r.note} · {r.owner_sub === db?.sub ? "mine" : "NOT MINE"}</li>
          ))}
        </ul>
        <form action={addProbeRow} className="mt-3">
          <button type="submit" className="rounded px-3 py-2 font-semibold text-white" style={{ background: "var(--interactive)" }}>
            Add a probe row as me
          </button>
        </form>
        <p className="mt-2 text-slate-600">Sign in as a second user: they must not see these rows.</p>
      </section>
    </main>
  );
}
