import { requireViewer } from "@/lib/auth/viewer";
import { withUser } from "@/lib/db/server";
import { Card, Field, PageHeader, input } from "@/components/ui/kit";
import { ActionForm } from "@/components/ui/ActionForm";
import { updateContactAction } from "@/modules/employees/actions";
import { fmtDay } from "@/lib/dates/calendar";

export const dynamic = "force-dynamic";

export default async function Profile() {
  const v = await requireViewer();
  const d = await withUser(async (db) => ({
    e: await db.one<any>(`select e.*, e.doj::text doj_s, e.dob::text dob_s, l.name as location, dep.name as department
      from employees e join locations l on l.id = e.location_id join departments dep on dep.id = e.department_id where e.id = me()`),
    s: await db.call<any>("get_sensitive_masked", { p_emp: v.id }),
    em: await db.one<any>("select * from employee_emergency where employee_id = me()"),
    mgr: await db.table<any>("get_my_manager"),
  }));
  const { e, s, em, mgr } = d;
  const row = (k: string, val: string | null | undefined) => <div className="flex justify-between gap-4 py-1"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium">{val || "—"}</dd></div>;
  return (
    <>
      <PageHeader title="My profile" subtitle={`${e.employee_code} · ${e.designation}`} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Job (set by HR, read-only)"><dl className="text-sm">
          {row("Name", `${e.first_name} ${e.last_name}`)}{row("Department", e.department)}{row("Location", e.location)}{row("Joined", fmtDay(e.doj_s, { day: "numeric", month: "long", year: "numeric" }))}
          {row("Reporting manager", mgr[0] ? `${mgr[0].name} (${mgr[0].designation})` : "None")}{row("Email", e.email)}
        </dl></Card>
        <Card title="Statutory and bank (masked)"><dl className="text-sm">
          {row("PAN", s?.pan)}{row("Aadhaar", s?.aadhaar)}{row("UAN", s?.uan)}{row("Bank", s?.bank_name)}{row("Account", s?.bank_account)}{row("IFSC", s?.ifsc)}
        </dl><p className="mt-2 text-xs text-slate-500">Full numbers are never shown here. HR can reveal them, and every reveal is logged.</p></Card>
        <Card title="Contact details (you can edit)" className="md:col-span-2">
          <ActionForm action={updateContactAction} submit="Save contact details" className="grid gap-3 md:grid-cols-2">
            {(st) => (<>
              <Field label="Mobile" error={st.fieldErrors?.mobile}><input className={input} name="mobile" defaultValue={e.mobile} required /></Field>
              <Field label="Address"><input className={input} name="address_line" defaultValue={e.address_line} required /></Field>
              <Field label="City"><input className={input} name="city" defaultValue={e.city} required /></Field>
              <Field label="PIN" error={st.fieldErrors?.address_pin}><input className={input} name="address_pin" defaultValue={e.address_pin} required /></Field>
              <Field label="State"><input className={input} name="address_state" defaultValue={e.address_state} required /></Field>
              <Field label="Blood group"><input className={input} name="blood_group" defaultValue={em?.blood_group ?? ""} placeholder="e.g. B+" /></Field>
              <Field label="Emergency contact name"><input className={input} name="ec_name" defaultValue={em?.emergency_contact_name} required /></Field>
              <Field label="Emergency contact phone" error={st.fieldErrors?.emergency_contact_phone}><input className={input} name="ec_phone" defaultValue={em?.emergency_contact_phone} required /></Field>
            </>)}
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
