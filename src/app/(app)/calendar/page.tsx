import Link from "next/link";
import { requireManagerOrHr } from "@/lib/auth/viewer";
import { withUser } from "@/lib/db/server";
import { Card, Empty, PageHeader, btnSecondary } from "@/components/ui/kit";
import { addMonths, daysInMonth, fmtMonth, monthStart } from "@/lib/dates/calendar";
import { istToday } from "@/lib/dates/ist";

export const dynamic = "force-dynamic";

export default async function LeaveCalendar({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requireManagerOrHr();
  const sp = await searchParams;
  const m = monthStart(sp.m && /^\d{4}-\d{2}/.test(sp.m) ? sp.m : istToday());
  const { people, lines } = await withUser(async (db) => ({
    people: await db.rows<any>("select id, first_name || ' ' || last_name as name from employees where id <> me() and (last_working_day is null or last_working_day >= $1::date) order by employee_code", [m]),
    lines: await db.rows<any>(`select r.employee_id, d.date::text, d.leave_type, d.deduction::float, r.status from leave_request_days d join leave_requests r on r.id = d.leave_request_id
      where r.status in ('Pending','Approved') and d.date >= $1::date and d.date < ($1::date + interval '1 month')`, [m]),
  }));
  const at = new Map<string, any[]>();
  const perDay = new Map<number, number>();
  for (const l of lines) { const k = l.employee_id + l.date; at.set(k, [...(at.get(k) ?? []), l]); const d = Number(l.date.slice(8)); perDay.set(d, (perDay.get(d) ?? 0) + 1); }
  const n = daysInMonth(m);
  return (
    <>
      <PageHeader title="Leave calendar" subtitle={`${fmtMonth(m)} · red header = two or more away`}
        actions={<div className="flex gap-2"><Link className={btnSecondary} href={`?m=${addMonths(m, -1).slice(0, 7)}`}>← Previous</Link><Link className={btnSecondary} href={`?m=${addMonths(m, 1).slice(0, 7)}`}>Next →</Link></div>} />
      <Card className="overflow-x-auto">
        {people.length === 0 ? <Empty>No one to show.</Empty> : (
          <table className="text-xs"><thead><tr><th className="sticky left-0 bg-white pr-2 text-left">Employee</th>
            {Array.from({ length: n }, (_, i) => <th key={i} className={`w-8 text-center ${(perDay.get(i + 1) ?? 0) >= 2 ? "bg-red-100 font-bold text-red-800" : "font-normal text-slate-500"}`}>{i + 1}</th>)}</tr></thead>
            <tbody>{people.map((p: any) => (
              <tr key={p.id}><td className="sticky left-0 whitespace-nowrap bg-white pr-2 font-medium">{p.name}</td>
                {Array.from({ length: n }, (_, i) => {
                  const day = `${m.slice(0, 8)}${String(i + 1).padStart(2, "0")}`;
                  const ls = at.get(p.id + day);
                  if (!ls) return <td key={i} className="p-0.5"><span className="block h-7 w-7" /></td>;
                  const pending = ls.every((l) => l.status === "Pending");
                  return <td key={i} className="p-0.5"><span title={ls.map((l) => `${l.leave_type} ${l.deduction}${pending ? " (pending)" : ""}`).join(", ")}
                    className="flex h-7 w-7 items-center justify-center rounded text-[10px] font-semibold" style={{ background: "#DBEAFE", color: "#1E40AF", border: pending ? "1.5px dashed #1E40AF" : "1px solid #BFDBFE" }}>{ls[0].leave_type}</span></td>;
                })}</tr>))}
            </tbody></table>
        )}
        <p className="mt-3 text-xs text-slate-600">Solid = approved, dashed = pending.</p>
      </Card>
    </>
  );
}
