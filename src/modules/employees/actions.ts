"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withUser } from "@/lib/db/server";
import { toActionError, str, opt, type ActionState } from "@/lib/actions";

export async function updateContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await withUser((db) => db.call("update_my_contact", {
      p_mobile: str(fd, "mobile"), p_address_line: str(fd, "address_line"), p_city: str(fd, "city"), p_pin: str(fd, "address_pin"),
      p_state: str(fd, "address_state"), p_ec_name: str(fd, "ec_name"), p_ec_phone: str(fd, "ec_phone"), p_blood_group: opt(fd, "blood_group"),
    }));
    revalidatePath("/profile");
    return { ok: true, message: "Contact details saved." };
  } catch (e) { return toActionError(e); }
}

// Same formats as the database CHECKs; the form shows these messages inline before anything is sent.
const employeeSchema = z.object({
  first_name: z.string().min(1, "Enter the first name"), last_name: z.string().min(1, "Enter the last name"),
  email: z.string().email("Enter a valid email"),
  mobile: z.string().regex(/^[6-9][0-9]{9}$/, "Mobile must be 10 digits starting with 6, 7, 8 or 9"),
  gender: z.enum(["Male", "Female", "Other"], { message: "Choose a gender" }),
  address_line: z.string().min(1, "Enter the address"), city: z.string().min(1, "Enter the city"),
  address_pin: z.string().regex(/^[0-9]{6}$/, "PIN must be 6 digits"), address_state: z.string().min(1, "Choose a state"),
  doj: z.string().min(1, "Enter the joining date"), dob: z.string().min(1, "Enter the date of birth"),
  designation: z.string().min(1, "Enter the designation"), location_id: z.string().uuid("Choose a location"), department_id: z.string().uuid("Choose a department"),
  manager_id: z.string().uuid().optional().or(z.literal("")),
  pan_number: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)"),
  aadhaar_number: z.string().regex(/^[0-9]{12}$/, "Aadhaar must be exactly 12 digits"),
  uan_number: z.string().regex(/^[0-9]{12}$/, "UAN must be 12 digits").optional().or(z.literal("")),
  bank_name: z.string().min(1, "Enter the bank name"), bank_account: z.string().regex(/^[0-9]{9,18}$/, "Account number must be 9 to 18 digits"),
  ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC must be 4 letters, 0, then 6 letters or digits (e.g. SBIN0001234)"),
  blood_group: z.string().optional(), emergency_contact_name: z.string().min(1, "Enter the emergency contact name"),
  emergency_contact_phone: z.string().regex(/^[6-9][0-9]{9}$/, "Emergency phone must be 10 digits starting with 6-9"),
}).refine((d) => { if (!d.doj || !d.dob) return true; const j = new Date(d.doj), b = new Date(d.dob); j.setFullYear(j.getFullYear() - 18); return b <= j; },
  { path: ["dob"], message: "The employee must be at least 18 on the joining date" });

export async function addEmployeeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v).trim()]));
  for (const k of ["pan_number", "ifsc"]) if (raw[k]) raw[k] = raw[k].toUpperCase();
  const parsed = employeeSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, message: "Fix the highlighted fields.", fieldErrors };
  }
  try {
    const r = await withUser((db) => db.call("hr_add_employee", { p: parsed.data }));
    revalidatePath("/employees");
    return { ok: true, message: `${r.employee_code} created. They can sign in with ${parsed.data.email}.`, data: r };
  } catch (e) { return toActionError(e); }
}

export async function updateJobAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await withUser((db) => db.call("hr_update_employee_job", {
      p_emp: str(fd, "id"), p: { designation: str(fd, "designation"), department_id: str(fd, "department_id"), location_id: str(fd, "location_id"), manager_id: str(fd, "manager_id") },
    }));
    revalidatePath("/employees");
    return { ok: true, message: "Job details saved and audited." };
  } catch (e) { return toActionError(e); }
}

export async function deactivateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await withUser((db) => db.call("hr_deactivate_employee", { p_emp: str(fd, "id"), p_last_day: str(fd, "last_day"), p_new_manager: opt(fd, "new_manager") }));
    revalidatePath("/employees");
    return { ok: true, message: "Last working day set. Future leave was cancelled and pending items moved to HR." };
  } catch (e) { return toActionError(e); }
}

export async function revealAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await withUser((db) => db.call<string>("reveal_sensitive", { p_emp: str(fd, "id"), p_field: str(fd, "field") }));
    return { ok: true, message: `${str(fd, "field").replace("_", " ")}: ${v} (this reveal is logged)` };
  } catch (e) { return toActionError(e); }
}
