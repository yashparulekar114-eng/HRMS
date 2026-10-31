import { notFound } from "next/navigation";
import { requireHr } from "@/lib/auth/viewer";
import { withUser } from "@/lib/db/server";
import { Card, Field, PageHeader, btnDanger, btnSecondary, input } from "@/components/ui/kit";
import { ActionForm } from "@/components/ui/ActionForm";
import { RequestBadge } from "@/components/ui/status";
import { deactivateAction, revealAction, updateJobAction } from "@/modules/employees/actions";
import { hrCorrectAction } from "@/modules/attendance/actions";
import { shortenLeaveAction } from "@/modules/leave/actions";
import { fmtDay } from "@/lib/dates/calendar";
import { istToday } from "@/lib/dates/ist";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/;

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireHr();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await withUser(async (db) => {
    const e = await db.one<any>(`select e.*, e.doj::text doj_s, e.last_working_day::text lwd, l.name location, d.name department from employees e
      join locations l on l.id = e.location_id join departments d on d.id = e.department_id where e.id = $1`, [id]);
    if (!e) return null;
    return {
      e,
      s: await db.call<any>("get_sensitive_masked", { p_emp: id }),
      locs: await db.rows<any>("select id, name from locations order by name"),
      deps: await db.rows<any>("select id, name from departments order by name"),
      mgrs: await db.rows<any>("select id, first_name || ' ' || last_name as name from employees where id <> $1 and (last_working_day is null or last_working_day >= ist_today()) order by first_name", [id]),
      bal: await db.table<any>("get_balances_for", { p_emp: id }),
      leave: await db.rows<any>("select id, leave_type, from_date::text, to_date::text, status from leave_requests where employee_id = $1 order by from_date desc limit 8", [id]),
    };
  });
  if (!data) notFound();
  const { e, s, locs, deps, mgrs, bal, leave } = data;
  const today = istToday();
  const inactive = e.lwd && e.lwd < today;
  const self = e.id === me.id;
  return (
    <>
      <PageHeader title={`${e.first_name} ${e.last_name}`} subtitle={`${e.employee_code} · ${e.designation} · ${e.location}${inactive ? " · INACTIVE" : ""}`} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Job details">
          <ActionForm action={updateJobAction} submit="Save job details" className="space-y-2">
            <input type="hidden" name="id" value={e.id} />
            <Field label="Designation"><input className={input} name="designation" defaultValue={e.designation} required /></Field>
            <Field label="Department"><select className={input} name="department_id" defaultValue={e.department_id}>{deps.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            <Field label="Location"><select className={input} name="location_id" defaultValue={e.location_id}>{locs.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
            <Field label="Reporting manager" hint={self ? "You cannot change your own reporting line." : undefined}>
              <select className={input} name="manager_id" defaultValue={e.manager_id ?? ""} disabled={self}><option value="">No manager</option>{mgrs.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            </Field>
          </ActionForm>
        </Card>
        <Card title="Statutory and bank">
          <dl className="text-sm">{[["PAN", s?.pan], ["Aadhaar", s?.aadhaar], ["UAN", s?.uan], ["Bank", s?.bank_name], ["Account", s?.bank_account], ["IFSC", s?.ifsc]].map(([k, v]) => (
            <div key={k} className="flex justify-between py-1"><dt className="text-slate-500">{k}</dt><dd className="font-mono">{v ?? "—"}</dd></div>))}</dl>
          <p className="mt-2 text-xs text-slate-500">Masked everywhere. Each reveal below is written to the audit log.</p>
          <div className="mt-2 space-y-1">
            {[["pan_number", "Reveal PAN"], ["aadhaar_number", "Reveal Aadhaar"], ["bank_account", "Reveal account"]].map(([f, label]) => (
              <ActionForm key={f} action={revealAction} submit={label} submitClass={btnSecondary} confirm="This reveal will be logged. Continue?">
                <input type="hidden" name="id" value={e.id} /><input type="hidden" name="field" value={f} />
              </ActionForm>
            ))}
          </div>
        </Card>
        <Card title="Leave balances">
          <table className="w-full text-sm"><tbody>{bal.map((b: any) => (
            <tr key={b.leave_type} className="border-t" style={{ borderColor: "var(--border)" }}><td className="py-1">{b.leave_type}</td><td>{b.unlimited ? "On request" : b.available}</td><td className="text-xs text-slate-500">{b.used} used · {b.pending} pending</td></tr>))}</tbody></table>
          <h3 className="mb-1 mt-3 text-sm font-semibold">Recent requests</h3>
          <ul className="space-y-2 text-sm">{leave.map((r: any) => (
            <li key={r.id} className="flex items-center justify-between gap-2"><span>{r.leave_type} · {fmtDay(r.from_date)}{r.to_date !== r.from_date && ` – ${fmtDay(r.to_date)}`}</span><RequestBadge status={r.status} /></li>))}
          </ul>
          {!self && leave.filter((r: any) => r.status === "Approved" && r.from_date < today && r.to_date > r.from_date && r.to_date >= today).map((r: any) => (
            <ActionForm key={r.id} action={shortenLeaveAction} submit="Shorten leave" submitClass={btnSecondary} className="mt-2 space-y-1">
              <input type="hidden" name="id" value={r.id} />
              <input className={input} type="date" name="to" max={r.to_date} min={r.from_date} required aria-label="New end date" />
              <input className={input} name="reason" placeholder="Reason (audited)" required />
            </ActionForm>
          ))}
        </Card>
        {!self && !inactive && (
          <Card title="Correct attendance (HR)">
            <ActionForm action={hrCorrectAction} submit="Save correction" className="space-y-2">
              <input type="hidden" name="employee" value={e.id} />
              <Field label="Date"><input className={input} type="date" name="date" max={today} required /></Field>
              <div className="grid grid-cols-2 gap-2"><Field label="In (IST)"><input className={input} type="time" name="in" required /></Field><Field label="Out (IST)"><input className={input} type="time" name="out" required /></Field></div>
              <Field label="Reason (required)"><input className={input} name="reason" required /></Field>
            </ActionForm>
          </Card>
        )}
        {!self && (
          <Card title="Deactivate / set last working day">
            <ActionForm action={deactivateAction} submit="Set last working day" submitClass={btnDanger} confirm="Set the last working day? Future leave will be cancelled." className="space-y-2">
              <input type="hidden" name="id" value={e.id} />
              <Field label="Last working day"><input className={input} type="date" name="last_day" defaultValue={e.lwd ?? ""} min={e.doj_s} required /></Field>
              <Field label="New manager for their direct reports (if any)"><select className={input} name="new_manager" defaultValue=""><option value="">Not needed</option>{mgrs.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
