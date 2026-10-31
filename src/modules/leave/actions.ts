"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { withUser } from "@/lib/db/server";
import { toActionError, str, opt, type ActionState } from "@/lib/actions";

const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png"]);

function leaveArgs(fd: FormData) {
  const half = fd.get("half") === "on";
  return {
    p_type: str(fd, "type"), p_from: str(fd, "from"), p_to: str(fd, "to") || str(fd, "from"),
    p_half: half, p_period: half ? opt(fd, "period") : null,
    p_weeks: str(fd, "type") === "ML" ? Number(str(fd, "weeks") || 0) || null : null,
  };
}

/** Step 2 of the wizard: the SQL preview, the same function the submit uses. Saves nothing. */
export async function previewLeaveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const a = leaveArgs(fd);
    const plan = await withUser((db) => db.call("preview_leave", a));
    if (!plan.ok) return { ok: false, message: plan.error };
    const balances = await withUser((db) => db.table("get_my_balances", {}));
    return { ok: true, data: { plan, balance: balances.find((b: any) => b.leave_type === a.p_type) ?? null } };
  } catch (e) { return toActionError(e); }
}

/** Step 3: submit. Success is reported only when the database returns a saved request id. */
export async function submitLeaveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const a = leaveArgs(fd);
    const file = fd.get("certificate");
    const result = await withUser(async (db) => {
      let path: string | null = null;
      if (file instanceof File && file.size > 0) {
        if (!ALLOWED.has(file.type)) throw new Error("Upload a PDF, JPG or PNG file.");
        if (file.size > 2 * 1024 * 1024) throw new Error("The certificate must be under 2 MB.");
        path = await db.call<string>("upload_certificate", { p_file_id: randomUUID(), p_content_type: file.type, p_content: Buffer.from(await file.arrayBuffer()) });
      }
      return db.call("apply_leave", {
        p_type: a.p_type, p_from: a.p_from, p_to: a.p_to, p_half: a.p_half, p_period: a.p_period, p_reason: str(fd, "reason"),
        p_certificate_path: path, p_accept_lop: fd.get("accept_lop") === "1", p_requested_weeks: a.p_weeks,
      });
    });
    if (result.status === "needs_lop") return { ok: false, message: `You are ${result.shortfall} day(s) short. Tick the box to convert them to Loss of Pay.`, data: { needsLop: result.shortfall } };
    revalidatePath("/leave"); revalidatePath("/"); revalidatePath("/approvals");
    return { ok: true, message: result.request_status === "Approved" ? "Saved and approved automatically (no reporting manager)." : result.routed_to_hr ? "Sent to HR for approval." : "Sent to your manager for approval.", data: { id: result.id } };
  } catch (e) { return e instanceof Error && !("code" in e) ? { ok: false, message: e.message } : toActionError(e); }
}

export async function cancelLeaveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await withUser((db) => db.call("cancel_my_leave", { p_id: str(fd, "id") }));
    revalidatePath("/leave"); revalidatePath("/");
    return { ok: true, message: "Cancelled. Your balance is restored." };
  } catch (e) { return toActionError(e); }
}

export async function processLeaveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const weeks = Number(str(fd, "weeks")) || null;
    await withUser((db) => db.call("process_leave_request", { p_id: str(fd, "id"), p_decision: str(fd, "decision"), p_comment: opt(fd, "comment"), p_confirmed_weeks: weeks }));
    revalidatePath("/approvals"); revalidatePath("/");
    return { ok: true, message: str(fd, "decision") === "Approved" ? "Approved. The employee is notified." : "Rejected." };
  } catch (e) { return toActionError(e); }
}

export async function shortenLeaveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await withUser((db) => db.call("hr_shorten_leave", { p_id: str(fd, "id"), p_new_to: str(fd, "to"), p_reason: str(fd, "reason") }));
    revalidatePath("/approvals");
    return { ok: true, message: "Leave shortened and recorded in the audit log." };
  } catch (e) { return toActionError(e); }
}
