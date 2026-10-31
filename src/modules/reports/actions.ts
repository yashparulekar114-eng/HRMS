"use server";
import { revalidatePath } from "next/cache";
import { withUser } from "@/lib/db/server";
import { toActionError, str, type ActionState } from "@/lib/actions";

export async function finaliseMonthAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const month = str(fd, "month");
    const r = await withUser((db) => db.call("hr_finalise_month", { p_month: month }));
    revalidatePath("/reports");
    return { ok: true, message: `Finalised. Checksum ${String(r.checksum).slice(0, 12)}…` };
  } catch (e) { return toActionError(e); }
}
