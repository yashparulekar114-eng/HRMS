import { describe, expect, it } from "vitest";
import { buildTeamCsv, type SummaryRow } from "@/modules/reports/csv";

const row = (code: string, over: Partial<SummaryRow> = {}): SummaryRow => ({
  employee_code: code, name: "A, B", location: "Panaji HO", buckets: { Present: 20, CL: 2.5, Absent: 0.5 }, late_marks: 3, late_lop: 0.5, total_lop: 1, adjustment_lop: -1,
  adjustment_detail: "27 Oct x (Absent -1.0)", provisional: false, ...over,
});

describe("manager CSV (L9, CLAUDE.md rule 24)", () => {
  it("is deterministic: rows by code, fixed columns, one decimal, \\n endings, quoted commas", () => {
    const a = buildTeamCsv([row("KCF0009"), row("KCF0005")]);
    const b = buildTeamCsv([row("KCF0005"), row("KCF0009")]);
    expect(a).toBe(b);
    expect(a.split("\n")[1].startsWith('KCF0005,"A, B",Panaji HO,20.0,0.0,2.5')).toBe(true);
    expect(a).not.toContain("\r");
    expect(a.endsWith("\n")).toBe(true);
  });
  it("carries adjustments outside the day total and nets them in Net_LOP", () => {
    const line = buildTeamCsv([row("KCF0005")]).split("\n")[1];
    expect(line.endsWith(",3,0.5,1.0,-1.0,27 Oct x (Absent -1.0),0.0,Final")).toBe(true);
  });
  it("marks open months Provisional", () => {
    expect(buildTeamCsv([row("KCF0005", { provisional: true })])).toMatch(/Provisional\n$/);
  });
});
