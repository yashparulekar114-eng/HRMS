"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { previewLeaveAction, submitLeaveAction } from "@/modules/leave/actions";
import type { ActionState } from "@/lib/actions";
import { Field, input, btnPrimary, btnSecondary } from "@/components/ui/kit";

type Type = { code: string; name: string; half_day_allowed: boolean };
const day = (iso: string) => new Date(iso + "T00:00:00+05:30").toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", weekday: "short" });

export function ApplyWizard({ types, today }: { types: Type[]; today: string }) {
  const [type, setType] = useState("CL");
  const [half, setHalf] = useState(false);
  const [prev, preview, previewing] = useActionState<ActionState, FormData>(previewLeaveAction, {});
  const [sub, submit, submitting] = useActionState<ActionState, FormData>(submitLeaveAction, {});
  const t = types.find((x) => x.code === type);
  const plan = prev.ok ? prev.data.plan : null;
  const bal = prev.ok ? prev.data.balance : null;
  const done = sub.ok;
  const lines: { date: string; leave_type: string; deduction: number }[] = plan?.lines ?? [];
  const needsLop = !!sub.data?.needsLop || (plan?.lop_days ?? 0) > 0;

  if (done) {
    return (
      <div role="status" className="rounded border border-green-200 bg-green-50 p-4">
        <p className="font-semibold text-green-900">{sub.message}</p>
        <Link href="/leave" className={`${btnPrimary} mt-3`}>Back to My Leave</Link>
      </div>
    );
  }
  return (
    <form className="space-y-4">
      <fieldset className="grid gap-3 md:grid-cols-2">
        <legend className="mb-1 font-semibold">1. Dates</legend>
        <Field label="Leave type">
          <select name="type" className={input} value={type} onChange={(e) => { setType(e.target.value); setHalf(false); }}>
            {types.map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}
          </select>
        </Field>
        {type === "ML" ? (
          <Field label="Weeks requested" hint="HR confirms the final duration after checking eligibility.">
            <select name="weeks" className={input} defaultValue="26"><option value="26">26 weeks</option><option value="12">12 weeks</option></select>
          </Field>
        ) : <span />}
        <Field label={type === "ML" ? "Start date" : "From"}><input className={input} type="date" name="from" min={undefined} required /></Field>
        {type !== "ML" && !half && <Field label="To"><input className={input} type="date" name="to" /></Field>}
        {t?.half_day_allowed && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="half" checked={half} onChange={(e) => setHalf(e.target.checked)} /> Half day (single date)</label>
        )}
        {half && (
          <Field label="Which half"><select name="period" className={input}><option value="First">First half</option><option value="Second">Second half</option></select></Field>
        )}
        <div className="md:col-span-2"><Field label="Reason"><textarea className={input} name="reason" rows={2} required /></Field></div>
      </fieldset>
      <p className="text-xs text-slate-500">Today is {day(today)} (IST). Leave can go back up to 30 days. Weekly offs and holidays are never counted as leave.</p>
      <button type="submit" formAction={preview} disabled={previewing} className={btnSecondary}>{previewing ? "Checking…" : "2. Review days and balance"}</button>
      {prev.ok === false && prev.message && <p role="alert" className="text-sm text-red-700">{prev.message}</p>}

      {plan && (
        <section className="rounded border bg-slate-50 p-3 text-sm" style={{ borderColor: "var(--border)" }} aria-live="polite">
          <p className="font-semibold">This request counts {plan.chargeable_days} day(s)</p>
          <ul className="mt-2 grid gap-1 md:grid-cols-2">
            {lines.map((l, i) => (
              <li key={i} className="flex justify-between rounded bg-white px-2 py-1">
                <span>{day(l.date)}</span><span className="font-semibold">{l.deduction} {l.leave_type}</span>
              </li>
            ))}
          </ul>
          {bal && !bal.unlimited && <p className="mt-2">Balance now {bal.available} {type} → after this request {Math.max(bal.available - lines.filter((l) => l.leave_type === type).reduce((a, l) => a + l.deduction, 0), 0)}.</p>}
          {plan.lop_days > 0 && (
            <label className="mt-3 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2">
              <input type="checkbox" name="accept_lop" value="1" required className="mt-1" />
              <span>You are short of balance. Convert <b>{plan.lop_days} day(s)</b> to Loss of Pay (unpaid). The paid balance is used first.</span>
            </label>
          )}
          {plan.needs_certificate && (
            <Field label="Medical certificate (required for sick leave over 2 working days)" hint="PDF, JPG or PNG, up to 2 MB. It is stored privately.">
              <input className={input} type="file" name="certificate" accept="application/pdf,image/jpeg,image/png" required />
            </Field>
          )}
          {plan.routed_to_hr && <p className="mt-2 text-slate-700">This request goes to HR, not your manager.</p>}
          <button type="submit" formAction={submit} disabled={submitting} className={`${btnPrimary} mt-3`}>{submitting ? "Submitting…" : "3. Submit request"}</button>
          {sub.message && !sub.ok && <p role="alert" className="mt-2 text-red-700">{sub.message}</p>}
        </section>
      )}
    </form>
  );
}
