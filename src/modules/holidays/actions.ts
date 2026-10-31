"use server";
import { revalidatePath } from "next/cache";
import { withUser } from "@/lib/db/server";
import { toActionError, str, type ActionState } from "@/lib/actions";

const done = (message: string): ActionState => { revalidatePath("/settings"); return { ok: true, message }; };

export async function upsertHolidayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const locs = fd.get("all_locations") === "on"
      ? (await withUser((db) => db.rows<{ id: string }>("select id from locations"))).map((l) => l.id) : [str(fd, "location")];
    for (const l of locs) await withUser((db) => db.call("hr_upsert_holiday", { p_location: l, p_date: str(fd, "date"), p_name: str(fd, "name"), p_type: str(fd, "type") }));
    return done("Holiday saved.");
  } catch (e) { return toActionError(e); }
}
export async function deleteHolidayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { await withUser((db) => db.call("hr_delete_holiday", { p_id: str(fd, "id") })); return done("Holiday removed. Any leave on that date stops counting that day."); }
  catch (e) { return toActionError(e); }
}
export async function setQuotaAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const q = str(fd, "quota");
    await withUser((db) => db.call("hr_set_leave_settings", { p_code: str(fd, "code"), p_year: Number(str(fd, "year")), p_quota: q === "" ? null : Number(q) }));
    return done("Quota saved. It applies from that year only; earlier years never change.");
  } catch (e) { return toActionError(e); }
}
export async function savePolicyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { await withUser((db) => db.call("hr_upsert_policy", { p_title: str(fd, "title"), p_content: str(fd, "content") })); return done("Policy text saved. Ask HR answers from this text."); }
  catch (e) { return toActionError(e); }
}
