import { requireHr } from "@/lib/auth/viewer";
import { withUser } from "@/lib/db/server";
import { Card, Field, PageHeader, input } from "@/components/ui/kit";
import { ActionForm } from "@/components/ui/ActionForm";
import { addEmployeeAction } from "@/modules/employees/actions";

export const dynamic = "force-dynamic";
const STATES = ["Goa", "Maharashtra", "Karnataka", "Kerala", "Tamil Nadu", "Gujarat", "Delhi", "Telangana", "Andhra Pradesh", "Madhya Pradesh", "Rajasthan", "Uttar Pradesh", "West Bengal", "Other"];

export default async function NewEmployee() {
  await requireHr();
  const { locs, deps, mgrs } = await withUser(async (db) => ({
    locs: await db.rows<any>("select id, name from locations order by name"),
    deps: await db.rows<any>("select id, name from departments order by name"),
    mgrs: await db.rows<any>("select id, first_name || ' ' || last_name as name, employee_code from employees where last_working_day is null or last_working_day >= ist_today() order by first_name"),
  }));
  const T = (name: string, label: string, e?: string, extra: Record<string, any> = {}) => <Field label={label} error={e}><input className={input} name={name} {...extra} /></Field>;
  return (
    <>
      <PageHeader title="Add employee" subtitle="The employee code is generated automatically" />
      <Card>
        <ActionForm action={addEmployeeAction} submit="Create employee" className="space-y-6">
          {(s) => {
            const e = s.fieldErrors ?? {};
            return (
              <>
                <fieldset className="grid gap-3 md:grid-cols-2"><legend className="mb-2 font-semibold">1. Personal</legend>
                  {T("first_name", "First name", e.first_name)}{T("last_name", "Last name", e.last_name)}
                  {T("email", "Email (used to match their login)", e.email, { type: "email" })}{T("mobile", "Mobile", e.mobile, { inputMode: "numeric", maxLength: 10 })}
                  <Field label="Gender" error={e.gender}><select className={input} name="gender" defaultValue=""><option value="" disabled>Choose</option><option>Female</option><option>Male</option><option>Other</option></select></Field>
                  {T("dob", "Date of birth", e.dob, { type: "date" })}
                  {T("address_line", "Address", e.address_line)}{T("city", "City", e.city)}{T("address_pin", "PIN code", e.address_pin, { inputMode: "numeric", maxLength: 6 })}
                  <Field label="State" error={e.address_state}><select className={input} name="address_state" defaultValue="Goa">{STATES.map((x) => <option key={x}>{x}</option>)}</select></Field>
                </fieldset>
                <fieldset className="grid gap-3 md:grid-cols-2"><legend className="mb-2 font-semibold">2. Job</legend>
                  {T("doj", "Date of joining", e.doj, { type: "date" })}{T("designation", "Designation", e.designation)}
                  <Field label="Location (sets weekly offs and holidays)" error={e.location_id}><select className={input} name="location_id" defaultValue=""><option value="" disabled>Choose</option>{locs.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
                  <Field label="Department" error={e.department_id}><select className={input} name="department_id" defaultValue=""><option value="" disabled>Choose</option>{deps.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
                  <Field label="Reporting manager" hint="Leave empty only for the top of the company (leave is then auto-approved)."><select className={input} name="manager_id" defaultValue=""><option value="">No manager</option>{mgrs.map((m: any) => <option key={m.id} value={m.id}>{m.name} ({m.employee_code})</option>)}</select></Field>
                </fieldset>
                <fieldset className="grid gap-3 md:grid-cols-2"><legend className="mb-2 font-semibold">3. Statutory</legend>
                  {T("pan_number", "PAN", e.pan_number, { maxLength: 10, placeholder: "ABCDE1234F", autoCapitalize: "characters" })}{T("aadhaar_number", "Aadhaar (12 digits)", e.aadhaar_number, { inputMode: "numeric", maxLength: 12 })}
                  {T("uan_number", "UAN (optional)", e.uan_number, { inputMode: "numeric", maxLength: 12 })}
                </fieldset>
                <fieldset className="grid gap-3 md:grid-cols-2"><legend className="mb-2 font-semibold">4. Bank</legend>
                  {T("bank_name", "Bank name", e.bank_name)}{T("bank_account", "Account number", e.bank_account, { inputMode: "numeric" })}{T("ifsc", "IFSC", e.ifsc, { maxLength: 11, placeholder: "SBIN0001234" })}
                </fieldset>
                <fieldset className="grid gap-3 md:grid-cols-2"><legend className="mb-2 font-semibold">5. Emergency</legend>
                  {T("blood_group", "Blood group", e.blood_group, { placeholder: "e.g. B+" })}{T("emergency_contact_name", "Contact name", e.emergency_contact_name)}{T("emergency_contact_phone", "Contact phone", e.emergency_contact_phone, { inputMode: "numeric", maxLength: 10 })}
                </fieldset>
              </>
            );
          }}
        </ActionForm>
      </Card>
    </>
  );
}
