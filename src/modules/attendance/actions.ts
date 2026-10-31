"use server";
import { revalidatePath } from "next/cache";
import { withUser } from "@/lib/db/server";
import { toActionError, str, opt, type ActionState } from "@/lib/actions";

export async function punchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const type = str(fd, "type");
    const r = await withUser((db) => db.call("punch_clock", { p_type: type, p_is_wfh: fd.get("wfh") === "on" }));
    revalidatePath("/");
    return { ok: true, message: type === "in" ? (r.late ? "Checked in. This is recorded as a Late mark." : "Checked in.") : "Checked out." };
  } catch (e) { return toActionError(e); }
}

const istInstant = (date: string, time: string) => `${date}T${time}:00+05:30`;

export async function requestRegularisationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const date = str(fd, "date"), inT = str(fd, "in"), outT = str(fd, "out");
    if (!date || !inT || !outT) return { ok: false, message: "Enter the date and both times." };
    await withUser((db) => db.call("request_regularisation", {
      p_date: date, p_in: istInstant(date, inT), p_out: istInstant(date, outT), p_reason: str(fd, "reason"), p_employee: opt(fd, "employee"),
    }));
    revalidatePath("/attendance"); revalidatePath("/approvals");
    return { ok: true, message: "Request sent. Your attendance changes only after it is approved." };
  } catch (e) { return toActionError(e); }
}

export async function processRegularisationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const fn = fd.get("hr_admin_own") === "1" ? "approve_hr_admin_own_correction" : "process_regularisation";
    const args = fn === "process_regularisation"
      ? { p_id: str(fd, "id"), p_decision: str(fd, "decision"), p_comment: opt(fd, "comment") }
      : { p_id: str(fd, "id"), p_comment: opt(fd, "comment"), p_decision: str(fd, "decision") };
    await withUser((db) => db.call(fn, args));
    revalidatePath("/approvals");
    return { ok: true, message: str(fd, "decision") === "Approved" ? "Approved." : "Rejected." };
  } catch (e) { return toActionError(e); }
}

export async function hrCorrectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const date = str(fd, "date");
    await withUser((db) => db.call("hr_correct_attendance", {
      p_emp: str(fd, "employee"), p_date: date, p_in: istInstant(date, str(fd, "in")), p_out: istInstant(date, str(fd, "out")), p_reason: str(fd, "reason"),
    }));
    revalidatePath("/employees");
    return { ok: true, message: "Attendance corrected. The old punches are in the audit log." };
  } catch (e) { return toActionError(e); }
}
