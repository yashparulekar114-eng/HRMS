import "server-only";
import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { withUser, DbError } from "@/lib/db/server";

export type Viewer = {
  id: string;
  firstName: string;
  fullName: string;
  isHr: boolean;
  isManager: boolean;
  locationId: string;
  employeeCode: string;
};
export type ViewerState =
  | { kind: "ok"; viewer: Viewer }
  | { kind: "ended"; lastWorkingDay: string; firstName: string }
  | { kind: "unknown"; message: string };

async function verifiedEmail(): Promise<string | null> {
  const u = await currentUser();
  const e = u?.primaryEmailAddress;
  return e && e.verification?.status === "verified" ? e.emailAddress : null;
}

/** Who is signed in, from the database only: roles never come from Clerk (CLAUDE.md rule 5). One lookup per request. */
export const getViewerState = cache(async (): Promise<ViewerState> => {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const link = async (email?: string) =>
    withUser(async (db) => {
      const r = await db.call<any>("link_my_account");
      if (!r.active) return r;
      const me = await db.one<any>("select employee_code, first_name || ' ' || last_name as full_name from employees where id = me()");
      return { ...r, ...me };
    }, email ? { email } : {});
  try {
    let r: any;
    try { r = await link(); }
    catch (e) {
      if (e instanceof DbError && /no email address/i.test(e.message)) {
        const email = await verifiedEmail();
        if (!email) return { kind: "unknown", message: "Your Clerk account has no verified email address." };
        r = await link(email);
      } else throw e;
    }
    if (!r.active) return { kind: "ended", lastWorkingDay: r.last_working_day, firstName: r.first_name };
    return { kind: "ok", viewer: { id: r.id, firstName: r.first_name, fullName: r.full_name, isHr: r.is_hr_admin, isManager: r.is_manager,
      locationId: r.location_id, employeeCode: r.employee_code } };
  } catch (e) {
    if (e instanceof DbError && e.code === "42501") return { kind: "unknown", message: e.message };
    throw e;
  }
});

export async function requireViewer(): Promise<Viewer> {
  const s = await getViewerState();
  if (s.kind === "ok") return s.viewer;
  redirect("/no-access");
}
export async function requireHr(): Promise<Viewer> {
  const v = await requireViewer();
  if (!v.isHr) redirect("/forbidden");
  return v;
}
export async function requireManagerOrHr(): Promise<Viewer> {
  const v = await requireViewer();
  if (!v.isHr && !v.isManager) redirect("/forbidden");
  return v;
}
