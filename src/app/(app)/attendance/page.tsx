import Link from "next/link";
import { requireViewer } from "@/lib/auth/viewer";
import { withUser } from "@/lib/db/server";
import { Card, Empty, Field, PageHeader, btnSecondary, input } from "@/components/ui/kit";
import { DayCell, Legend, RequestBadge, type DayInfo } from "@/components/ui/status";
import { ActionForm } from "@/components/ui/ActionForm";
import { requestRegularisationAction } from "@/modules/attendance/actions";
import { WEEKDAYS, addMonths, daysInMonth, firstWeekdayMon, fmtDay, fmtMonth, monthStart } from "@/lib/dates/calendar";
import { istToday } from "@/lib/dates/ist";

export const dynamic = "force-dynamic";

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const m = monthStart(sp.m && /^\d{4}-\d{2}/.test(sp.m) ? sp.m : istToday());
  const { days, regs } = await withUser(async (db) => ({
    days: await db.table<{ date: string; info: DayInfo }>("get_month_days", { p_emp: v.id, p_month: m }),
    regs: await db.rows<any>("select attendance_date::text d, status, reason, approver_comment from regularisation_requests where employee_id = me() order by attendance_date desc limit 10"),
  }));
  const byDay = new Map(days.map((d) => [Number(d.date.slice(8)), d.info]));
  const count = (k: string) => days.reduce((a, d) => a + (d.info.buckets[k] ?? 0), 0);
  const lates = days.filter((d) => d.info.late).length;
  const blanks = firstWeekdayMon(m);
  return (
    <>
      <PageHeader title="My attendance" subtitle={fmtMonth(m)} actions={
        <div className="flex gap-2">
          <Link className={btnSecondary} href={`?m=${addMonths(m, -1).slice(0, 7)}`}>← Previous</Link>
          <Link className={btnSecondary} href={`?m=${addMonths(m, 1).slice(0, 7)}`}>Next →</Link>
        </div>} />
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-500">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: blanks }).map((_, i) => <span key={"b" + i} />)}
            {Array.from({ length: daysInMonth(m) }, (_, i) => i + 1).map((d) => {
              const info = byDay.get(d) ?? { status: "Not employed", buckets: {} };
              return <div key={d} className="flex justify-center"><DayCell day={d} info={info} wide /></div>;
            })}
          </div>
          <div className="mt-3"><Legend /></div>
          <p className="mt-3 text-sm text-slate-600">
            Present {count("Present") + count("WFH")} (WFH {count("WFH")}) · Absent {count("Absent")} · Late marks {lates} · Pending {count("Pending")}
          </p>
        </Card>
        <div className="space-y-4">
          <Card title="Regularise a day">
            <p className="mb-2 text-xs text-slate-600">For a missed check-out or a day with no punch. Your attendance changes only after approval.</p>
            <ActionForm action={requestRegularisationAction} submit="Send request" resetOnSuccess className="space-y-2">
              <Field label="Date"><input className={input} type="date" name="date" max={istToday()} required /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="In (IST)"><input className={input} type="time" name="in" required /></Field>
                <Field label="Out (IST)"><input className={input} type="time" name="out" required /></Field>
              </div>
              <Field label="Reason"><textarea className={input} name="reason" required rows={2} /></Field>
            </ActionForm>
          </Card>
          <Card title="My requests">
            {regs.length === 0 ? <Empty>No regularisation requests.</Empty> : (
              <ul className="space-y-2 text-sm">
                {regs.map((r: any) => (
                  <li key={r.d} className="flex items-start justify-between gap-2">
                    <span>{fmtDay(r.d)} · {r.reason}{r.approver_comment && <span className="block text-xs text-slate-500">“{r.approver_comment}”</span>}</span>
                    <RequestBadge status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
