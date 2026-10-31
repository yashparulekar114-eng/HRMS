import Link from "next/link";
import { requireManagerOrHr } from "@/lib/auth/viewer";
import { withUser } from "@/lib/db/server";
import { Card, Empty, ErrorBox, PageHeader, btnDanger, btnSecondary, btnPrimary } from "@/components/ui/kit";
import { ActionForm } from "@/components/ui/ActionForm";
import { finaliseMonthAction } from "@/modules/reports/actions";
import { BUCKET_COLUMNS, type SummaryRow } from "@/modules/reports/csv";
import { addMonths, fmtMonth, monthStart } from "@/lib/dates/calendar";
import { istToday } from "@/lib/dates/ist";

export const dynamic = "force-dynamic";
const f = (n: number | null | undefined) => (n ? (Math.round(n * 10) / 10).toFixed(1) : "–");

export default async function Reports({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const v = await requireManagerOrHr();
  const sp = await searchParams;
  const m = monthStart(sp.m && /^\d{4}-\d{2}/.test(sp.m) ? sp.m : addMonths(istToday(), 0));
  let rows: SummaryRow[] = []; let ready: any = null; let failed = false;
  try {
    ({ rows, ready } = await withUser(async (db) => ({
      rows: await db.table<SummaryRow>(v.isHr ? "hr_month_summary" : "get_team_month_summary", { p_month: m }),
      ready: v.isHr ? await db.call<any>("hr_month_readiness", { p_month: m }) : null,
    })));
  } catch { failed = true; }
  const cols = BUCKET_COLUMNS.filter((c) => c !== "Pending" || rows.some((r) => r.buckets.Pending));
  const prov = rows.some((r) => r.provisional);
  return (
    <>
      <PageHeader title="Reports" subtitle={`${fmtMonth(m)} · ${v.isHr ? "everyone" : "your team"} · ${ready?.finalised ? "Finalised" : prov ? "Provisional (month still open)" : "Closed"}`}
        actions={<div className="flex flex-wrap gap-2">
          <Link className={btnSecondary} href={`?m=${addMonths(m, -1).slice(0, 7)}`}>← Previous</Link>
          <Link className={btnSecondary} href={`?m=${addMonths(m, 1).slice(0, 7)}`}>Next →</Link>
          <a className={btnPrimary} href={`/api/reports/csv?month=${m.slice(0, 7)}`}>Download CSV</a>
        </div>} />
      {failed && <ErrorBox>Couldn&apos;t build the {fmtMonth(m)} summary. Nothing was downloaded. Refresh to retry.</ErrorBox>}
      {ready && (
        <Card title="Month-end check" className="mb-4">
          <ul className="grid gap-2 text-sm md:grid-cols-4">
            <li>Pending leave: <b>{ready.pending_leave}</b></li><li>Pending regularisations: <b>{ready.pending_regularisations}</b></li>
            <li>Missing check-outs: <b>{ready.missing_checkouts}</b></li><li>Status: <b>{ready.finalised ? "Finalised" : ready.closed ? "Closed" : "Open"}</b></li>
          </ul>
          {!ready.finalised && (
            <ActionForm action={finaliseMonthAction} submit={`Finalise ${fmtMonth(m)}`} submitClass={btnDanger} className="mt-3"
              confirm="Finalising locks this month. The CSV is saved and never changes; later corrections become adjustments in the next month. Continue?">
              <input type="hidden" name="month" value={m} />
              <p className="text-xs text-slate-600">Available once the month has closed. Unresolved pending days become Absent.</p>
            </ActionForm>
          )}
        </Card>
      )}
      <Card className="overflow-x-auto">
        {rows.length === 0 && !failed ? <Empty>No attendance recorded for {fmtMonth(m)} yet.</Empty> : (
          <table className="w-full min-w-[900px] text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1">Employee</th>{cols.map((c) => <th key={c} className="px-1 text-right">{c.replace("_", " ")}</th>)}<th className="px-1 text-right">Late</th><th className="px-1 text-right">Late LOP</th><th className="px-1 text-right">Total LOP</th><th className="px-1 text-right">Adjustment</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.employee_code} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="py-1.5"><b>{r.name}</b> <span className="text-slate-500">{r.employee_code}</span></td>
                {cols.map((c) => <td key={c} className="px-1 text-right">{f(r.buckets[c])}</td>)}
                <td className="px-1 text-right">{r.late_marks || "–"}</td><td className="px-1 text-right">{f(r.late_lop)}</td><td className="px-1 text-right font-semibold">{f(r.total_lop)}</td>
                <td className="px-1 text-right" title={r.adjustment_detail ?? ""}>{r.adjustment_lop ? f(r.adjustment_lop) : "–"}</td>
              </tr>))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-xs text-slate-500">Day columns add up to the calendar days in the month. Late LOP and prior-month adjustments sit outside that total. PAN, Aadhaar and bank numbers are never in this file.</p>
      </Card>
      <p className="mt-3 text-sm"><Link className="underline" href="/team">Team attendance</Link> · <Link className="underline" href="/calendar">Leave calendar</Link></p>
    </>
  );
}
