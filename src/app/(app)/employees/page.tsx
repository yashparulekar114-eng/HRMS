import Link from "next/link";
import { requireHr } from "@/lib/auth/viewer";
import { withUser } from "@/lib/db/server";
import { Card, Empty, PageHeader, btnPrimary, btnSecondary, input } from "@/components/ui/kit";
import { istToday } from "@/lib/dates/ist";

export const dynamic = "force-dynamic";

export default async function Directory({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireHr();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim(), loc = sp.loc ?? "", dep = sp.dep ?? "", status = sp.status ?? "active";
  const { rows, locs, deps } = await withUser(async (db) => ({
    rows: await db.rows<any>(`select e.id, e.employee_code, e.first_name || ' ' || e.last_name as name, e.designation, e.email, e.last_working_day::text lwd,
        l.name as location, d.name as department, m.first_name || ' ' || m.last_name as manager
      from employees e join locations l on l.id = e.location_id join departments d on d.id = e.department_id left join employees m on m.id = e.manager_id
      where ($1 = '' or e.first_name || ' ' || e.last_name || ' ' || e.employee_code || ' ' || e.email ilike '%' || $1 || '%')
        and ($2 = '' or e.location_id::text = $2) and ($3 = '' or e.department_id::text = $3)
        and ($4 = 'all' or ($4 = 'active') = (e.last_working_day is null or e.last_working_day >= ist_today()))
      order by e.employee_code`, [q, loc, dep, status]),
    locs: await db.rows<any>("select id, name from locations order by name"),
    deps: await db.rows<any>("select id, name from departments order by name"),
  }));
  const today = istToday();
  return (
    <>
      <PageHeader title="Employees" subtitle={`${rows.length} shown`} actions={<Link href="/employees/new" className={btnPrimary}>Add employee</Link>} />
      <Card>
        <form className="mb-4 grid gap-2 md:grid-cols-5">
          <input className={`${input} md:col-span-2`} name="q" defaultValue={q} placeholder="Search name, code or email" aria-label="Search" />
          <select className={input} name="loc" defaultValue={loc} aria-label="Location"><option value="">All locations</option>{locs.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          <select className={input} name="dep" defaultValue={dep} aria-label="Department"><option value="">All departments</option>{deps.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <div className="flex gap-2">
            <select className={input} name="status" defaultValue={status} aria-label="Status"><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option></select>
            <button className={btnSecondary}>Filter</button>
          </div>
        </form>
        {rows.length === 0 ? <Empty>No employees match these filters.</Empty> : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {rows.map((r: any) => (
              <li key={r.id}>
                <Link href={`/employees/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm hover:bg-slate-50">
                  <span><b>{r.name}</b> <span className="text-slate-500">{r.employee_code}</span><span className="block text-slate-600">{r.designation} · {r.department} · {r.location}</span></span>
                  <span className="text-xs text-slate-600">{r.manager ? `Reports to ${r.manager}` : "No manager"}
                    {r.lwd && r.lwd < today && <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 font-semibold">Inactive</span>}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
