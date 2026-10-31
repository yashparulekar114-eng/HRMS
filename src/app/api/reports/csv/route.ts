import { NextResponse } from "next/server";
import { getViewerState } from "@/lib/auth/viewer";
import { withUser } from "@/lib/db/server";
import { buildTeamCsv } from "@/modules/reports/csv";

export async function GET(req: Request) {
  const s = await getViewerState();
  if (s.kind !== "ok") return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const m = new URL(req.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(m)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  const month = m + "-01";
  try {
    // HR: the stored (or provisional) company-wide CSV. Managers: built here from their direct reports only; the company file never reaches them.
    const csv = s.viewer.isHr
      ? await withUser((db) => db.call<string>("hr_month_csv", { p_month: month }))
      : buildTeamCsv(await withUser((db) => db.table<any>("get_team_month_summary", { p_month: month })));
    const name = `${s.viewer.isHr ? "konkan-people" : "team"}-${m}.csv`;
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't build the summary. Nothing was downloaded." }, { status: 500 });
  }
}
