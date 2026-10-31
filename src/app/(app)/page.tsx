import Link from "next/link";
import { requireViewer } from "@/lib/auth/viewer";
import { withUser } from "@/lib/db/server";
import { Card, Empty, PageHeader, Stat, btnPrimary, btnSecondary } from "@/components/ui/kit";
import { RequestBadge } from "@/components/ui/status";
import { ActionForm } from "@/components/ui/ActionForm";
import { punchAction } from "@/modules/attendance/actions";
import { formatIST, istToday } from "@/lib/dates/ist";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const v = await requireViewer();
  const today = istToday();
  const month = today.slice(0, 7) + "-01";
  const data = await withUser(async (db) => {
    const [att, balances, lates, pending, regs, openPunches] = await Promise.all([
      db.one<any>("select check_in, check_out, is_wfh from attendance where employee_id = me() and date = ist_today()"),
      db.table<any>("get_my_balances"),
      db.call<number>("get_my_late_marks"),
      db.rows<any>("select id, leave_type, from_date::text, to_date::text, status, is_half_day, half_day_period from leave_requests where employee_id = me() and status = 'Pending' order by from_date"),
      db.rows<any>("select attendance_date::text d from regularisation_requests where employee_id = me() and status = 'Pending'"),
      db.rows<any>("select date::text d from attendance where employee_id = me() and check_in is not null and check_out is null and date < ist_today() and date >= (ist_today() - 45) order by date"),
    ]);
    const team = v.isManager || v.isHr ? await db.call<any[]>("agent_team_today") : null;
    const toApprove = v.isManager || v.isHr
      ? await db.one<any>(`select (select count(*)::int from leave_requests where status = 'Pending' and employee_id <> me() and (approver_id = me() or (is_hr() and routed_to_hr))) as leave,
                                  (select count(*)::int from regularisation_requests where status = 'Pending' and employee_id <> me() and (approver_id = me() or (is_hr() and approver_id is null))) as regs`)
      : null;
    const ready = v.isHr ? await db.call<any>("hr_month_readiness", { p_month: month }) : null;
    return { att, balances, lates, pending, regs, openPunches, team, toApprove, ready };
  });
  const { att } = data;
  const hr = (iso: string) => formatIST(new Date(iso), { hour: "2-digit", minute: "2-digit", hour12: true });
  const unresolved = data.openPunches.filter((p: any) => p.d !== today);
  const teamCount = (st: (s: string) => boolean) => (data.team ?? []).filter((t: any) => st(t.status)).length;

  return (
    <>
      <PageHeader title={`Hello, ${v.firstName}`} subtitle={`${formatIST(new Date(), { dateStyle: "full" })}`} />
      {unresolved.length > 0 && (
        <p role="status" className="mb-4 rounded border p-3 text-sm" style={{ background: "#FCE7F3", color: "#9D174D", borderColor: "#9D174D" }}>
          You haven&apos;t checked out on {unresolved.map((p: any) => formatIST(new Date(p.d + "T00:00:00+05:30"), { day: "numeric", month: "short" })).join(", ")}.{" "}
          <Link href="/attendance" className="font-semibold underline">Regularise</Link>
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Today" className="md:col-span-2">
          <p className="text-sm text-slate-600">Hours 10:00–19:00. Late from 10:16:00 IST (office and WFH alike).</p>
          {!att?.check_in ? (
            <ActionForm action={punchAction} submit="Check in" className="mt-3">
              <input type="hidden" name="type" value="in" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="wfh" /> Working from home</label>
            </ActionForm>
          ) : !att.check_out ? (
            <>
              <p className="mt-3 text-sm">Checked in at <b>{hr(att.check_in)}</b>{att.is_wfh ? " (WFH)" : ""}.</p>
              <ActionForm action={punchAction} submit="Check out" className="mt-2"><input type="hidden" name="type" value="out" /></ActionForm>
            </>
          ) : (
            <p className="mt-3 text-sm">In <b>{hr(att.check_in)}</b> · Out <b>{hr(att.check_out)}</b>. Have a good evening.</p>
          )}
          <p className="mt-3 text-sm">Late marks this month: <b>{data.lates} of 3</b>{data.lates >= 3 && " (0.5 day Loss of Pay applies)"}</p>
        </Card>
        <Card title="Waiting" action={<Link href="/leave/apply" className={btnPrimary}>Apply leave</Link>}>
          {data.pending.length === 0 && data.regs.length === 0 ? <Empty>No pending requests.</Empty> : (
            <ul className="space-y-2 text-sm">
              {data.pending.map((r: any) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span>{r.leave_type} · {formatIST(new Date(r.from_date + "T00:00:00+05:30"), { day: "numeric", month: "short" })}{r.to_date !== r.from_date && ` – ${formatIST(new Date(r.to_date + "T00:00:00+05:30"), { day: "numeric", month: "short" })}`}{r.is_half_day && ` (${r.half_day_period} half)`}</span>
                  <RequestBadge status="Pending" />
                </li>
              ))}
              {data.regs.map((r: any) => <li key={r.d} className="flex justify-between"><span>Regularisation · {r.d}</span><RequestBadge status="Pending" /></li>)}
            </ul>
          )}
        </Card>
      </div>

      <h2 className="mb-2 mt-6 text-lg font-semibold" style={{ color: "var(--primary)" }}>Leave balances ({today.slice(0, 4)})</h2>
      {data.balances.length === 0 ? <Empty>We couldn&apos;t load your balances. Check-in still works.</Empty> : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {data.balances.filter((b: any) => ["CL", "SL", "EL", "OH", "PL"].includes(b.leave_type)).map((b: any) => (
            <Stat key={b.leave_type} label={b.name} value={b.available} sub={`${b.used} used · ${b.pending} pending`} />
          ))}
        </div>
      )}

      {data.team && (
        <>
          <h2 className="mb-2 mt-6 text-lg font-semibold" style={{ color: "var(--primary)" }}>{v.isHr ? "Everyone today" : "Your team today"}</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Present / checked in" value={teamCount((s) => ["Present", "WFH", "In progress", "Half Day"].includes(s))} />
            <Stat label="On leave" value={teamCount((s) => s === "On Leave")} />
            <Stat label="Not in yet" value={teamCount((s) => ["Not checked in", "Absent"].includes(s))} />
            <Stat label="Waiting for you" value={(data.toApprove?.leave ?? 0) + (data.toApprove?.regs ?? 0)} sub={<Link href="/approvals" className="underline">Open approvals</Link>} />
          </div>
        </>
      )}
      {data.ready && (
        <Card title="Month-end readiness" className="mt-6" action={<Link href="/reports" className={btnSecondary}>Reports</Link>}>
          <p className="text-sm text-slate-600">{formatIST(new Date(month + "T00:00:00+05:30"), { month: "long", year: "numeric" })}: {data.ready.finalised ? "finalised" : data.ready.closed ? "closed, ready to finalise" : "still open"}</p>
          <ul className="mt-2 grid gap-2 text-sm md:grid-cols-3">
            <li>Pending leave: <b>{data.ready.pending_leave}</b></li>
            <li>Pending regularisations: <b>{data.ready.pending_regularisations}</b></li>
            <li>Missing check-outs: <b>{data.ready.missing_checkouts}</b></li>
          </ul>
        </Card>
      )}
    </>
  );
}
