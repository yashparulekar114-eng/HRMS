import { describe, expect, it, vi } from "vitest";
import prompts from "./prompts.json";

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "u" }) }));

describe("agent guardrails that need no model (ARCHITECTURE section 6)", () => {
  it("exposes exactly the 8 documented tools, and none can write (rule 9)", async () => {
    const { createTools, TOOL_NAMES } = await import("@/modules/agent/tools");
    const tools = createTools({ questionId: "q", viewer: { id: "1", firstName: "A", fullName: "A", isHr: false, isManager: false, locationId: "l", employeeCode: "K" }, cache: new Map(), drafts: [] });
    expect(Object.keys(tools).sort()).toEqual([...TOOL_NAMES].sort());
    expect(TOOL_NAMES).toHaveLength(8);
    for (const n of Object.keys(tools)) expect(n).not.toMatch(/approve|reject|cancel|edit|update|delete|apply_leave|submit/);
  });

  it("an employee calling a manager tool gets an explicit error and the denial is logged, with no model or slot used", async () => {
    const calls: string[] = [];
    vi.resetModules();
    vi.doMock("@/lib/db/server", () => ({ withUser: async (fn: any) => fn({ call: async (name: string) => { calls.push(name); return undefined; }, rows: async () => [], table: async () => [], one: async () => undefined }) }));
    const { createTools } = await import("@/modules/agent/tools");
    const tools: any = createTools({ questionId: "q", viewer: { id: "1", firstName: "A", fullName: "A", isHr: false, isManager: false, locationId: "l", employeeCode: "K" }, cache: new Map(), drafts: [] });
    const out = await tools.get_team_today.execute({});
    expect(out.error).toMatch(/not authorised/);
    expect(calls).toEqual(["agent_log_denied"]);
    const hr = await tools.check_pending_approvals.execute({ month: "2026-10" });
    expect(hr.error).toMatch(/not authorised/);
  });

  it("identical tool calls are served from the per-question cache (provider fallback never re-runs a tool)", async () => {
    const calls: string[] = [];
    vi.doMock("@/lib/db/server", () => ({ withUser: async (fn: any) => fn({ call: async (name: string) => { calls.push(name); return name === "agent_reserve_slot" ? { allowed: true, log_id: "L", slot: 1 } : undefined; }, rows: async () => [{ date: "2026-12-03", name: "St Francis", type: "State" }], table: async () => [], one: async () => undefined }) }));
    vi.resetModules();
    const { createTools } = await import("@/modules/agent/tools");
    const tools: any = createTools({ questionId: "q", viewer: { id: "1", firstName: "A", fullName: "A", isHr: false, isManager: false, locationId: "l", employeeCode: "K" }, cache: new Map(), drafts: [] });
    await tools.get_holidays.execute({ month: "2026-12" });
    await tools.get_holidays.execute({ month: "2026-12" });
    expect(calls.filter((c) => c === "agent_reserve_slot")).toHaveLength(1);
  });

  it("the prompt suite has at least 15 prompts, including Hinglish and the named attack prompts", () => {
    expect(prompts.length).toBeGreaterThanOrEqual(15);
    const all = prompts.map((p) => p.prompt).join("\n");
    for (const needle of ["Aadhaar", "Approve my own leave", "Ignore your rules", "Friday", "kitna", "chahiye"]) expect(all).toContain(needle);
  });
});
