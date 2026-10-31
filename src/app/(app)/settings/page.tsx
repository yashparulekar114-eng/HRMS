import { requireHr } from "@/lib/auth/viewer";
import { withUser } from "@/lib/db/server";
import { Card, Field, PageHeader, btnDanger, btnSecondary, input } from "@/components/ui/kit";
import { ActionForm } from "@/components/ui/ActionForm";
import { deleteHolidayAction, savePolicyAction, setQuotaAction, upsertHolidayAction } from "@/modules/holidays/actions";
import { fmtDay } from "@/lib/dates/calendar";
import { istToday } from "@/lib/dates/ist";

export const dynamic = "force-dynamic";

export default async function Settings({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  await requireHr();
  const sp = await searchParams;
  const year = Number(sp.y) || Number(istToday().slice(0, 4));
  const d = await withUser(async (db) => ({
    locs: await db.rows<any>("select id, name, city, weekly_off_days from locations order by name"),
    deps: await db.rows<any>("select name from departments order by name"),
    hol: await db.rows<any>("select h.id, h.date::text, h.name, h.type, l.name as location from holidays h join locations l on l.id = h.location_id where extract(year from h.date) = $1 order by h.date, l.name", [year]),
    types: await db.rows<any>("select t.code, t.name, t.accrual_method, (select annual_quota from leave_type_year_settings s where s.leave_type_code = t.code and s.year <= $1 order by s.year desc limit 1) as quota from leave_types t where t.is_active order by t.code", [year]),
    pol: await db.rows<any>("select title, content_markdown from company_policies order by title"),
  }));
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <>
      <PageHeader title="Settings" subtitle={`Year ${year}`} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Locations and departments">
          <ul className="space-y-1 text-sm">{d.locs.map((l: any) => <li key={l.id}><b>{l.name}</b>, {l.city} · weekly off: {l.weekly_off_days.map((x: number) => DOW[x]).join(" + ")}</li>)}</ul>
          <p className="mt-2 text-sm text-slate-600">Departments: {d.deps.map((x: any) => x.name).join(", ")}</p>
        </Card>
        <Card title="Leave quotas">
          <ul className="space-y-2 text-sm">{d.types.filter((t: any) => t.accrual_method === "lump_sum" || t.code === "EL").map((t: any) => (
            <li key={t.code}><ActionForm action={setQuotaAction} submit="Save" submitClass={btnSecondary} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="code" value={t.code} /><input type="hidden" name="year" value={year} />
              <span className="w-40">{t.name} ({t.code})</span>
              <input className={`${input} w-20`} name="quota" defaultValue={t.quota ?? ""} aria-label={`${t.code} quota`} />
            </ActionForm></li>))}</ul>
          <p className="mt-2 text-xs text-slate-500">A change applies to the chosen year only. It is refused once a month of that year is finalised.</p>
        </Card>
        <Card title="Add a holiday" className="md:col-span-2">
          <ActionForm action={upsertHolidayAction} submit="Save holiday" resetOnSuccess className="grid gap-2 md:grid-cols-5">
            <Field label="Date"><input className={input} type="date" name="date" required /></Field>
            <Field label="Name"><input className={input} name="name" required /></Field>
            <Field label="Type"><select className={input} name="type"><option>National</option><option>State</option><option>Optional</option></select></Field>
            <Field label="Location"><select className={input} name="location">{d.locs.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="all_locations" /> Both sites</label>
          </ActionForm>
          <h3 className="mb-1 mt-4 text-sm font-semibold">Holidays in {year}</h3>
          <ul className="divide-y text-sm" style={{ borderColor: "var(--border)" }}>{d.hol.map((h: any) => (
            <li key={h.id} className="flex items-center justify-between gap-2 py-1.5">
              <span>{fmtDay(h.date, { day: "numeric", month: "short", weekday: "short" })} · {h.name} <span className="text-slate-500">({h.type}, {h.location})</span></span>
              <ActionForm action={deleteHolidayAction} submit="Remove" submitClass={btnDanger} confirm="Remove this holiday?"><input type="hidden" name="id" value={h.id} /></ActionForm>
            </li>))}</ul>
        </Card>
        <Card title="Policy text (what Ask HR may quote)" className="md:col-span-2">
          {d.pol.map((p: any) => (
            <ActionForm key={p.title} action={savePolicyAction} submit={`Save “${p.title}”`} submitClass={btnSecondary} className="mb-4">
              <input type="hidden" name="title" value={p.title} />
              <Field label={p.title}><textarea className={input} name="content" rows={3} defaultValue={p.content_markdown} /></Field>
            </ActionForm>))}
        </Card>
      </div>
    </>
  );
}
