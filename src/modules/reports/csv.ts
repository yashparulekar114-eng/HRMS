// Manager CSV: built on the server from get_team_month_summary rows (direct reports only). Same columns and
// formatting as the SQL company-wide export: fixed column order, one decimal, "\n" line endings, rows by code.
export type SummaryRow = {
  employee_code: string; name: string; location: string; buckets: Record<string, number>; late_marks: number; late_lop: number;
  total_lop: number; adjustment_lop: number | null; adjustment_detail: string | null; provisional: boolean;
};
export const BUCKET_COLUMNS = ["Present", "WFH", "CL", "SL", "EL", "ML", "PL", "OH", "LOP_leave", "Absent", "Holidays", "Weekly_offs", "Pending"] as const;
const fmt = (n: number | null | undefined) => (Math.round((n ?? 0) * 10) / 10).toFixed(1);
const cell = (t: string) => (/[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);

export function buildTeamCsv(rows: SummaryRow[]): string {
  const head = ["Employee_code", "Name", "Location", ...BUCKET_COLUMNS, "Late_marks", "Late_LOP", "Total_LOP", "Adjustment_LOP", "Adjustment_detail", "Net_LOP", "Status"].join(",");
  const lines = [...rows].sort((a, b) => (a.employee_code < b.employee_code ? -1 : 1)).map((r) =>
    [cell(r.employee_code), cell(r.name), cell(r.location), ...BUCKET_COLUMNS.map((c) => fmt(r.buckets[c])), String(r.late_marks), fmt(r.late_lop), fmt(r.total_lop),
      fmt(r.adjustment_lop), cell(r.adjustment_detail ?? ""), fmt(r.total_lop + (r.adjustment_lop ?? 0)), r.provisional ? "Provisional" : "Final"].join(","));
  return [head, ...lines].join("\n") + "\n";
}
