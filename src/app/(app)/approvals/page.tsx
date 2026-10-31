import { requireManagerOrHr } from "@/lib/auth/viewer";
import { withUser } from "@/lib/db/server";
import { Card, Empty, Field, PageHeader, btnDanger, btnPrimary, btnSecondary, input } from "@/components/ui/kit";
import { ActionForm } from "@/components/ui/ActionForm";
import { processLeaveAction } from "@/modules/leave/actions";
import { processRegularisationAction } from "@/modules/attendance/actions";
import { fmtDay } from "@/lib/dates/calendar";
import { istToday } from "@/lib/dates/ist";

export const dynamic = "force-dynamic";

export default async function Approvals() {
  const v = await requireManagerOrHr();
  const today = istToday();
  const { leave, regs, info } = await withUser(async (db) => {
    const leave = await db.rows<any>(`select r.id, r.leave_type, r.from_date::text, r.to_date::text, r.is_half_day, r.half_day_period, r.applicant_reason, r.routed_to_hr,
        r.requested_weeks, r.approver_id = me() as mine, r.medical_certificate_path,
        e.first_name || ' ' || e.last_name as employee, e.employee_code,
        (select coalesce(sum(deduction), 0) from leave_request_days d where d.leave_request_id = r.id and d.leave_type <> 'LOP')::float as paid_days,
        (select coalesce(sum(deduction), 0) from leave_request_days d where d.leave_request_id = r.id and d.leave_type = 'LOP')::float as lop_days
      from leave_requests r join employees e on e.id = r.employee_id
      where r.status = 'Pending' and r.employee_id <> me() and (r.approver_id = me() or is_hr())
      order by r.from_date`);
    const regs = await db.rows<any>(`select q.id, q.attendance_date::text d, q.requested_in, q.requested_out, q.reason, q.approver_id = me() as mine, q.requested_by <> q.employee_id as by_manager,
        e.first_name || ' ' || e.last_name as employee, e.is_hr_admin as emp_is_hr, a.check_in as old_in, a.check_out as old_out
      from regularisation_requests q join employees e on e.id = q.employee_id
      left join attendance a on a.employee_id = q.employee_id and a.date = q.attendance_date
      where q.status = 'Pending' and q.employee_id <> me() and (q.approver_id = me() or is_hr())
      order by q.attendance_date`);
    const info = new Map<string, any>((await db.call<any[]>("agent_pending_approvals")).map((r) => [r.id, r]));
    return { leave, regs, info };
  });
  const t = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "none");
  const closed = (d: string) => { const [y, m] = d.split("-").map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10) <= today; };
  return (
    <>
      <PageHeader title="Approvals" subtitle="Leave and attendance requests waiting for you" />
      <Card title={`Leave requests (${leave.length})`}>
        {leave.length === 0 ? <Empty>Nothing waiting for you.</Empty> : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {leave.map((r: any) => {
              const i = info.get(r.id);
              return (
                <li key={r.id} className="py-3 text-sm">
                  <p className="font-semibold">{r.employee} <span className="font-normal text-slate-500">({r.employee_code})</span> · {r.leave_type} · {fmtDay(r.from_date)}{r.to_date !== r.from_date && ` – ${fmtDay(r.to_date)}`}{r.is_half_day && ` (${r.half_day_period} half)`}</p>
                  <p className="text-slate-600">“{r.applicant_reason}”</p>
                  <p className="text-xs text-slate-600">
                    {r.paid_days + r.lop_days} day(s){r.lop_days > 0 && ` incl. ${r.lop_days} LOP`}
                    {i && i.available_balance != null && ` · balance before: ${i.available_balance + r.paid_days} ${r.leave_type}`}
                    {i && i.clashes > 0 && ` · ⚠ ${i.clashes} teammate(s) also away`}
                    {!r.mine && v.isHr && !r.routed_to_hr && " · HR override (not in your own queue)"}
                    {r.routed_to_hr && " · routed to HR"}
                  </p>
                  {r.medical_certificate_path && <a className="text-xs underline" href={`/api/certificates/${r.medical_certificate_path}`} target="_blank">View medical certificate</a>}
                  <ActionForm action={processLeaveAction} submit="Approve" className="mt-2">
                    {() => (
                      <>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="decision" value="Approved" />
                        {r.leave_type === "ML" && (
                          <Field label="Confirm weeks (HR checks eligibility first)">
                            <select name="weeks" className={input} defaultValue={r.requested_weeks ?? 26}><option value="26">26 weeks</option><option value="12">12 weeks</option></select>
                          </Field>
                        )}
                        <input className={`${input} mt-2`} name="comment" placeholder="Comment (optional)" />
                      </>
                    )}
                  </ActionForm>
                  <ActionForm action={processLeaveAction} submit="Reject" submitClass={btnDanger} className="mt-2">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="decision" value="Rejected" />
                    <input className={input} name="comment" placeholder="Reason for rejecting (required)" required />
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title={`Attendance corrections (${regs.length})`} className="mt-4">
        {regs.length === 0 ? <Empty>No corrections waiting.</Empty> : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {regs.map((r: any) => (
              <li key={r.id} className="py-3 text-sm">
                <p className="font-semibold">{r.employee} · {fmtDay(r.d, { day: "numeric", month: "short", year: "numeric" })}{r.by_manager && <span className="ml-2 font-normal text-slate-500">(raised by their manager)</span>}</p>
                <p className="text-slate-600">Recorded: {t(r.old_in)} – {t(r.old_out)} → Requested: {t(r.requested_in)} – {t(r.requested_out)}</p>
                <p className="text-slate-600">“{r.reason}”</p>
                {closed(r.d) && <p className="text-xs text-slate-500">This month is closed: only HR can approve{r.emp_is_hr ? " (the HR Admin&apos;s own correction goes to their manager)" : ""}.</p>}
                {["Approved", "Rejected"].map((dec) => (
                  <ActionForm key={dec} action={processRegularisationAction} submit={dec === "Approved" ? "Approve" : "Reject"} submitClass={dec === "Approved" ? btnPrimary : btnDanger} className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="decision" value={dec} />
                    {r.emp_is_hr && closed(r.d) && <input type="hidden" name="hr_admin_own" value="1" />}
                    <input className={`${input} max-w-xs`} name="comment" placeholder={dec === "Rejected" ? "Reason (required)" : "Comment (optional)"} required={dec === "Rejected"} />
                  </ActionForm>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
