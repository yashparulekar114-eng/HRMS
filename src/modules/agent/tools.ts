import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { withUser } from "@/lib/db/server";
import type { Viewer } from "@/lib/auth/viewer";
import { istToday } from "@/lib/dates/ist";

// The tool list is the first guard: there is no approve, reject, cancel, edit or apply tool (CLAUDE.md rule 9).
export const TOOL_NAMES = [
  "get_my_leave_balance", "get_holidays", "count_working_days", "explain_policy", "draft_leave_request",
  "get_team_today", "summarise_pending_approvals", "check_pending_approvals",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export type AgentContext = {
  questionId: string;
  viewer: Viewer;
  /** Results already produced for this question, so a provider fallback never re-runs a tool or uses another slot. */
  cache: Map<string, unknown>;
  drafts: unknown[];
};

const ROLE: Record<ToolName, "everyone" | "manager_or_hr" | "hr"> = {
  get_my_leave_balance: "everyone", get_holidays: "everyone", count_working_days: "everyone", explain_policy: "everyone",
  draft_leave_request: "everyone", get_team_today: "manager_or_hr", summarise_pending_approvals: "manager_or_hr", check_pending_approvals: "hr",
};

function allowed(name: ToolName, v: Viewer) {
  const r = ROLE[name];
  return r === "everyone" || (r === "manager_or_hr" && (v.isManager || v.isHr)) || (r === "hr" && v.isHr);
}

/** Role check in code (explicit error, not empty data) -> reserve a numbered slot atomically -> run -> fill the log once. */
async function guarded<T>(ctx: AgentContext, name: ToolName, inputs: unknown, run: (db: Parameters<Parameters<typeof withUser>[0]>[0]) => Promise<T>) {
  const key = name + JSON.stringify(inputs);
  if (ctx.cache.has(key)) return ctx.cache.get(key) as T | { error: string };
  if (!allowed(name, ctx.viewer)) {
    await withUser((db) => db.call("agent_log_denied", { p_question: ctx.questionId, p_tool: name, p_inputs: inputs ?? {}, p_reason: "not authorised" }));
    const denied = { error: "You are not authorised to use this tool. Tell the user plainly that their role does not allow it." };
    ctx.cache.set(key, denied);
    return denied;
  }
  const slot = await withUser((db) => db.call<{ allowed: boolean; log_id: string }>("agent_reserve_slot", { p_question: ctx.questionId, p_tool: name, p_inputs: inputs ?? {} }));
  if (!slot.allowed) {
    return { error: "Tool call limit reached (5 per question). Answer from what you already have and say what you could not verify." };
  }
  try {
    const out = await withUser(run);
    await withUser((db) => db.call("agent_finish_call", { p_log: slot.log_id, p_status: "ok", p_result: summarise(out) }));
    ctx.cache.set(key, out);
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed";
    await withUser((db) => db.call("agent_finish_call", { p_log: slot.log_id, p_status: "error", p_result: { error: msg } })).catch(() => {});
    return { error: msg };
  }
}

// Logged results are trimmed so the log never becomes a copy of personal data.
const summarise = (o: unknown) => { const s = JSON.stringify(o); return s.length > 4000 ? { truncated: true, preview: s.slice(0, 4000) } : o; };

export function createTools(ctx: AgentContext) {
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
  return {
    get_my_leave_balance: tool({
      description: "The signed-in user's leave balance (opening, accrued, used, pending, available) for a leave year. Always use this for balance numbers.",
      inputSchema: z.object({ leave_type: z.enum(["CL", "SL", "EL", "PL", "OH", "ML"]).optional(), year: z.number().int().min(2020).max(2100).optional() }),
      execute: (a) => guarded(ctx, "get_my_leave_balance", a, async (db) => {
        const rows = await db.table<any>("get_my_balances", { p_year: a.year ?? Number(istToday().slice(0, 4)) });
        return a.leave_type ? rows.filter((r) => r.leave_type === a.leave_type) : rows;
      }),
    }),
    get_holidays: tool({
      description: "Holidays and optional holidays for the user's own location in a month.",
      inputSchema: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM") }),
      execute: (a) => guarded(ctx, "get_holidays", a, (db) => db.rows(
        `select h.date::text, h.name, h.type from holidays h join employees e on e.location_id = h.location_id
         where e.id = me() and to_char(h.date, 'YYYY-MM') = $1 order by h.date`, [a.month])),
    }),
    count_working_days: tool({
      description: "Counts the leave days between two dates for the user's location (weekly offs and holidays excluded; ML counts calendar days). Lists the dates counted and excluded.",
      inputSchema: z.object({ from: date, to: date, leave_type: z.enum(["CL", "SL", "EL", "PL", "OH", "ML", "LOP"]).default("CL") }),
      execute: (a) => guarded(ctx, "count_working_days", a, async (db) => {
        const cal = await db.rows<any>(`select c.date::text, c.kind, c.holiday_name from employees e, location_calendar(e.location_id, $1, $2) c where e.id = me() order by c.date`, [a.from, a.to]);
        const ml = a.leave_type === "ML";
        return {
          counted: cal.filter((c) => ml || c.kind === "working").map((c) => c.date),
          excluded: cal.filter((c) => !ml && c.kind !== "working").map((c) => ({ date: c.date, reason: c.kind === "holiday" ? c.holiday_name : "weekly off" })),
          total: cal.filter((c) => ml || c.kind === "working").length,
        };
      }),
    }),
    explain_policy: tool({
      description: "Looks up the company's stored policy text. Policy answers come only from this text; if nothing matches, say you do not know.",
      inputSchema: z.object({ question: z.string().min(2).max(300) }),
      execute: (a) => guarded(ctx, "explain_policy", a, async (db) => {
        const words = [...new Set(a.question.toLowerCase().match(/[a-z]{3,}/g) ?? [])].slice(0, 8);
        const rows = await db.rows<any>(
          `select title, content_markdown from company_policies
           where exists (select 1 from unnest($1::text[]) w where lower(title || ' ' || content_markdown) like '%' || w || '%') limit 3`, [words]);
        return rows.length ? rows : { result: "no policy text found" };
      }),
    }),
    draft_leave_request: tool({
      description: "Prepares a leave request draft with the day count, balance and any Loss-of-Pay split. SAVES NOTHING: the user must press Confirm on the card. Never say a request was submitted.",
      inputSchema: z.object({ leave_type: z.enum(["CL", "SL", "EL", "PL", "OH", "ML"]), from: date, to: date, reason: z.string().min(2).max(300), half_day: z.boolean().default(false), half_period: z.enum(["First", "Second"]).optional(), weeks: z.number().int().optional() }),
      execute: (a) => guarded(ctx, "draft_leave_request", a, async (db) => {
        const plan = await db.call<any>("preview_leave", { p_type: a.leave_type, p_from: a.from, p_to: a.to, p_half: a.half_day, p_period: a.half_day ? a.half_period ?? "First" : null, p_weeks: a.weeks ?? null });
        if (!plan.ok) return { drafted: false, problem: plan.error };
        const draft = { type: a.leave_type, from: a.from, to: plan.to_date, reason: a.reason, half: a.half_day, period: a.half_day ? a.half_period ?? "First" : null, weeks: a.weeks ?? null,
          days: plan.chargeable_days, lop_days: plan.lop_days, needs_certificate: plan.needs_certificate, routed_to_hr: plan.routed_to_hr, lines: plan.lines };
        ctx.drafts.push(draft);        // the UI shows this card from server data, never from the model's words
        return { drafted: true, saved: false, draft };
      }),
    }),
    get_team_today: tool({
      description: "Managers and HR only: who in the team is present, on leave or absent on a date (default today).",
      inputSchema: z.object({ date: date.optional() }),
      execute: (a) => guarded(ctx, "get_team_today", a, (db) => db.call("agent_team_today", { p_date: a.date ?? null })),
    }),
    summarise_pending_approvals: tool({
      description: "Managers and HR only: pending leave requests with each employee's balance and date clashes.",
      inputSchema: z.object({}),
      execute: (a) => guarded(ctx, "summarise_pending_approvals", a, (db) => db.call("agent_pending_approvals")),
    }),
    check_pending_approvals: tool({
      description: "HR only: unresolved approvals and missing check-outs for a month, before month-end. It does not send reminders.",
      inputSchema: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }),
      execute: (a) => guarded(ctx, "check_pending_approvals", a, (db) => db.call("hr_month_readiness", { p_month: a.month + "-01" })),
    }),
  };
}
