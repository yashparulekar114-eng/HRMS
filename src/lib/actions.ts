import { DbError } from "@/lib/db/server";

export type ActionState = { ok?: boolean; message?: string; fieldErrors?: Record<string, string>; data?: any };

const CONSTRAINTS: Record<string, [string, string]> = {
  employee_sensitive_pan_number_check: ["pan_number", "PAN must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)"],
  employee_sensitive_aadhaar_number_check: ["aadhaar_number", "Aadhaar must be exactly 12 digits"],
  employee_sensitive_uan_number_check: ["uan_number", "UAN must be 12 digits"],
  employee_sensitive_ifsc_check: ["ifsc", "IFSC must be 4 letters, 0, then 6 letters or digits (e.g. SBIN0001234)"],
  employee_sensitive_bank_account_check: ["bank_account", "Account number must be 9 to 18 digits"],
  employees_mobile_check: ["mobile", "Mobile must be 10 digits starting with 6, 7, 8 or 9"],
  employees_address_pin_check: ["address_pin", "PIN must be 6 digits"],
  employees_age_18: ["dob", "The employee must be at least 18 on the joining date"],
  employee_emergency_emergency_contact_phone_check: ["emergency_contact_phone", "Emergency phone must be 10 digits starting with 6-9"],
  employees_email_key: ["email", "An employee with this email already exists"],
  employees_lwd_after_doj: ["last_working_day", "The last working day is before the joining date"],
};

/** Turns a database error into a message that says what happened and what to do next. */
export function toActionError(e: unknown): ActionState {
  if (e instanceof DbError) {
    if (e.constraint && CONSTRAINTS[e.constraint]) {
      const [field, msg] = CONSTRAINTS[e.constraint];
      return { ok: false, message: msg, fieldErrors: { [field]: msg } };
    }
    if (e.code === "42501") return { ok: false, message: e.message.replace(/^permission denied.*/, "You are not allowed to do this.") };
    if (e.code === "P0001" || e.code === "23514" || e.code === "23505") return { ok: false, message: e.message };
    return { ok: false, message: e.message };
  }
  return { ok: false, message: "Something went wrong. Please try again." };
}

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
export const opt = (fd: FormData, k: string) => { const v = str(fd, k); return v === "" ? null : v; };
