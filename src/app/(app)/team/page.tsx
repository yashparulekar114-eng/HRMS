import Link from "next/link";
import { requireManagerOrHr } from "@/lib/auth/viewer";
import { withUser } from "@/lib/db/server";
import { Card, Empty, PageHeader, btnSecondary } from "@/components/ui/kit";
import { DayCell, Legend, type DayInfo } from "@/components/ui/status";
import { addMonths, daysInMonth, fmtMonth, monthStart } from "@/lib/dates/calendar";
import { istToday } from "@/lib/dates/ist";

export const dynamic = "force-dynamic";

export default async function Team({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const v = await requireManagerOrHr();
  const sp = await searchParams;
  const m = monthStart(sp.m && /^\d{4}-\d{2}/.test(sp.m) ? sp.m : istToday());
  const team = await withUser(async (db) => {
    const people = await db.rows<any>(`select id, first_name || ' ' || last_name as name, employee_code from employees
      where id <> me() and (last_working_day is null or last_working_day >= $1::date) and doj <= ($1::date + interval '1 month')::date order by employee_code`, [m]);
    return Promise.all(people.map(async (p: any) => ({ ...p, days: new Map((await db.table<{ date: string; info: DayInfo }>("get_month_days", { p_emp: p.id, p_month: m })).map((d) => [Number(d.date.slice(8)), d.info])) })));
  });
  const n = daysInMonth(m);
  return (
    <>
      <PageHeader title="Team attendance" subtitle={`${fmtMonth(m)} · ${v.isHr ? "everyone" : "your direct reports"}`}
        actions={<div className="flex gap-2"><Link className={btnSecondary} href={`?m=${addMonths(m, -1).slice(0, 7)}`}>← Previous</Link><Link className={btnSecondary} href={`?m=${addMonths(m, 1).slice(0, 7)}`}>Next →</Link></div>} />
      <Card className="overflow-x-auto">
        {team.length === 0 ? <Empty>No one to show for {fmtMonth(m)}.</Empty> : (
          <table className="text-xs"><thead><tr><th className="sticky left-0 bg-white py-1 pr-2 text-left">Employee</th>{Array.from({ length: n }, (_, i) => <th key={i} className="w-9 text-center font-normal text-slate-500">{i + 1}</th>)}</tr></thead>
            <tbody>{team.map((p: any) => (
              <tr key={p.id}><td className="sticky left-0 whitespace-nowrap bg-white py-0.5 pr-2 font-medium">{p.name}</td>
                {Array.from({ length: n }, (_, i) => <td key={i} className="p-0.5"><DayCell day={i + 1} info={p.days.get(i + 1) ?? { status: "Not employed", buckets: {} }} /></td>)}</tr>))}
            </tbody></table>
        )}
        <div className="mt-3"><Legend /></div>
      </Card>
    </>
  );
}
