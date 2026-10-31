import Link from "next/link";
import { requireViewer } from "@/lib/auth/viewer";
import { withUser } from "@/lib/db/server";
import { Card, Empty, PageHeader, btnPrimary, btnSecondary } from "@/components/ui/kit";
import { RequestBadge } from "@/components/ui/status";
import { ActionForm } from "@/components/ui/ActionForm";
import { cancelLeaveAction } from "@/modules/leave/actions";
import { fmtDay } from "@/lib/dates/calendar";
import { istToday } from "@/lib/dates/ist";

export const dynamic = "force-dynamic";

export default async function MyLeave() {
  await requireViewer();
  const today = istToday();
  const year = Number(today.slice(0, 4));
  const { balances, requests } = await withUser(async (db) => ({
    balances: await db.table<any>("get_my_balances", { p_year: year }),
    requests: await db.rows<any>(`select r.id, r.leave_type, r.from_date::text, r.to_date::text, r.status, r.is_half_day, r.half_day_period, r.applicant_reason,
        r.approver_comment, r.routed_to_hr, r.auto_approved,
        (select coalesce(sum(deduction), 0) from leave_request_days d where d.leave_request_id = r.id and d.leave_type <> 'LOP')::float as paid_days,
        (select coalesce(sum(deduction), 0) from leave_request_days d where d.leave_request_id = r.id and d.leave_type = 'LOP')::float as lop_days
      from leave_requests r where r.employee_id = me() order by r.from_date desc limit 50`),
  }));
  return (
    <>
      <PageHeader title="My leave" subtitle={`Leave year ${year} (1 Jan to 31 Dec)`} actions={<Link href="/leave/apply" className={btnPrimary}>Apply for leave</Link>} />
      <Card title="Balances" className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1">Type</th><th>Opening</th><th>Accrued</th><th>Used</th><th>Pending</th><th>Available</th></tr></thead>
          <tbody>
            {balances.map((b: any) => (
              <tr key={b.leave_type} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="py-2 font-medium">{b.name} ({b.leave_type})</td><td>{b.opening}</td><td>{b.accrued}</td><td>{b.used}</td><td>{b.pending}</td>
                <td className="font-bold">{b.unlimited ? "On request" : b.available}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Available = opening + accrued − used − pending. Calculated each time, never stored.</p>
      </Card>
      <Card title="My requests" className="mt-4">
        {requests.length === 0 ? <Empty>You haven&apos;t applied for any leave yet.</Empty> : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {requests.map((r: any) => {
              const canCancel = r.status === "Pending" || (r.status === "Approved" && r.from_date >= today);
              return (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                  <div>
                    <p className="font-semibold">{r.leave_type} · {fmtDay(r.from_date)}{r.to_date !== r.from_date && ` – ${fmtDay(r.to_date)}`}{r.is_half_day && ` (${r.half_day_period} half)`}
                      <span className="ml-2 font-normal text-slate-600">{r.paid_days + r.lop_days} day(s){r.lop_days > 0 && `, of which ${r.lop_days} LOP`}</span></p>
                    <p className="text-slate-600">{r.applicant_reason}</p>
                    {r.approver_comment && <p className="text-xs text-slate-500">“{r.approver_comment}”</p>}
                    {r.routed_to_hr && r.status === "Pending" && <p className="text-xs text-slate-500">Waiting for HR</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <RequestBadge status={r.status} />
                    {canCancel && (
                      <ActionForm action={cancelLeaveAction} submit="Cancel" submitClass={btnSecondary} confirm="Cancel this leave request?">
                        <input type="hidden" name="id" value={r.id} />
                      </ActionForm>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
