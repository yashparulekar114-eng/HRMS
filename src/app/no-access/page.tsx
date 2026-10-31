import { SignOutButton } from "@clerk/nextjs";
import { getViewerState } from "@/lib/auth/viewer";
import { formatIST } from "@/lib/dates/ist";

export const dynamic = "force-dynamic";

export default async function NoAccess() {
  const s = await getViewerState();
  let title = "Access denied";
  let body = "";
  if (s.kind === "ended") {
    title = "Your access has ended";
    body = `Your access ended on ${formatIST(new Date(s.lastWorkingDay + "T00:00:00+05:30"), { dateStyle: "long" })}. Contact HR if you think this is a mistake.`;
  } else if (s.kind === "unknown") {
    title = "You are not set up as an employee";
    body = `${s.message} Ask HR to add you with the same email you signed in with.`;
  } else body = "Nothing to show here.";
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-bold" style={{ color: "var(--primary)" }}>{title}</h1>
      <p className="mt-2 text-slate-600">{body}</p>
      <div className="mt-6"><SignOutButton><button className="rounded border bg-white px-3 py-2 text-sm font-semibold">Sign out</button></SignOutButton></div>
    </main>
  );
}
