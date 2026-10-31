# CLAUDE.md — Konkan People (Konkan Coastal Foods HRMS)

## What this is

A three-module HRMS (Employee Master, Attendance, Leave) plus an AI assistant, for a 180-person Goa food company with two sites:

- Panaji head office: Mon–Fri, with Saturday and Sunday off
- Verna plant: Mon–Sat, with Sunday off

Read these before planning any change:

- **RESEARCH.md**: business rules, numbered A1–L6 (the source of truth for behaviour)
- **ARCHITECTURE.md**: stack, data model, permissions, agent, risks, traceability
- **DESIGN.md**: screens, status colours, flows, sample data

Follow DESIGN.md for every screen. If a change departs from ARCHITECTURE.md, stop and ask; the decision log is updated before the code changes.

## Stack

Next.js (App Router) on Vercel · Neon Postgres · Clerk · Resend · Vercel AI SDK with Groq `openai/gpt-oss-120b` (fallback: Gemini Flash-Lite) · Zod · Vitest.

## Folder rules

- `src/app/`: routing only, no business logic.
- `src/modules/<module>/`: `service.ts`, `repository.ts`, `schemas.ts`, `components/`. Modules: employees, attendance, leave, holidays, reports, agent.
- `src/lib/`: `auth` (viewer), `db` (per-request database access), `dates` (IST helpers), `actions` (error mapping).
- `db/migrations/`: all tables, RLS policies, functions and triggers, applied by `npm run db:migrate`. The schema is never edited by hand in the Neon console. `db/seed.sql` is the sample data.
- `tests/db/` (SQL, real Postgres), `tests/lib`, `tests/reports`, `tests/agent`: one test per checklist item (see the ARCHITECTURE.md traceability table).

## Rules you must never break

1. **All times are in IST.**
   - In SQL, use `(now() AT TIME ZONE 'Asia/Kolkata')::date`, never `CURRENT_DATE`.
   - In TypeScript, format with `timeZone: 'Asia/Kolkata'`.
   - Never derive a date from the browser clock.
2. **Never commit secrets.**
   - Keys go in `.env.local` (git-ignored) and in Vercel's environment variables.
   - `.env.example` has blank values only.
   - Never print keys in logs.
3. **Never use the database owner connection** in request handlers, server actions or agent tools. The app connects as the limited role `app_user` and, per request, runs `SET LOCAL ROLE authenticated` with the verified Clerk claims in `request.jwt.claims` (`src/lib/db/server.ts`), so RLS applies. `DATABASE_URL_DIRECT` (owner) is for `npm run db:migrate` only.
4. **Identify the user with `current_sub()`** (reads `request.jwt.claims`->>'sub'), matched to `employees.clerk_user_id`. Tables join on `employees.id` (a UUID).
5. **Roles come from the database only:** `is_hr_admin`, and Manager = the reporting manager of at least one active employee. Never read roles from Clerk metadata.
6. **Writes to core tables go only through Postgres functions.** Every function:
   - is `SECURITY DEFINER`
   - has `SET search_path = public`
   - takes the caller from the token, never from an `employee_id` parameter
   - re-checks role and record state itself
7. **Never store "available balance".**
   - Store only `leave_opening_balances`.
   - Accrued, used, pending and available are always calculated (rule D4).
8. **Anything a write depends on is calculated in SQL:** working days, balance, the LOP split. TypeScript must not reimplement these; call the SQL functions.
9. **Agent tools:**
   - Never select `employee_sensitive`, and never `SELECT *`.
   - Never add an approve, reject, cancel or edit tool.
   - Check the role in code and return an explicit error, not empty data.
   - Log every call to `agent_log`.
   - Allow at most 5 tool calls per question.
10. **Never show Aadhaar, PAN or bank numbers unmasked**, in any screen, CSV or log. Only HR's Reveal shows them, and every reveal is logged.
11. **Every new table gets RLS in the same migration.**
12. **`audit_log`, `payroll_adjustments`, `payroll_exports` and `payroll_month_snapshots` are insert-only.** An `agent_log` row is inserted when its slot is reserved and filled in once with the result, through one function; nothing else may change it.
13. **Never change a finalised month's CSV.**
    - A month is closed once its last day has passed in IST. After that, only HR approves corrections; for the HR Admin's own correction, only their reporting manager, through `approve_hr_admin_own_correction`.
    - *Closed* (date-based) and *finalised* (HR-locked) are different states; never confuse them. Corrections to a closed but unfinalised month flow into its first final CSV.
    - HR then finalises the month with `hr_finalise_month`, a single transaction: the CSV text, checksum and all snapshots are saved together or not at all. It takes an advisory lock on the payroll month first, and the CSV is deterministic: rows by `employee_code`, a fixed column order, one-decimal numbers and `\n` line endings. After that, every correction (regularisation, leave approval or change, HR correction) creates one `payroll_adjustments` row, measured against the last payroll-accounted state and shown in the next month's CSV outside the day total (rules J12, J13, L6a, L7).
14. **The agent and the UI never report an action as done without a trusted result.**
    - Success means the database returned a saved request ID.
    - Never show "approved" or "updated" based on the model's text.
15. **Whether a date is a working day comes only from `location_calendar` in SQL.** TypeScript day-status code reads it; never reimplement weekly-off or holiday logic in TypeScript.
16. **No self-approval anywhere:** leave, regularisation or correction. ML is approved only by HR, and only HR sets `confirmed_weeks`.
17. **Certificates:** stored in the private `medical_certificates` table (RLS: owner, HR, and the approver of a request that cites the file), path `<clerk_user_id>/<file_id>`. `upload_certificate` takes the owner from the token, accepts PDF/JPG/PNG up to 2 MB, and `apply_leave` accepts only a path whose owner is the caller. Files are served by `/api/certificates/...` under the caller's RLS.
18. **Agent limits:**
    - Create the question (30 per IST day) before any model call.
    - Reserve a numbered slot (1–5) atomically before every tool call, including parallel ones.
19. **Leave rules in code:** EL is consumed in whole days only. Two half days on the same date are allowed only for different halves, with the day's total at most 1.0.

## Rules added in the pre-sign-off review

20. **Late:** A Late mark is recorded when the employee's IST check-in time is 10:16:00 or later. Check-ins up to 10:15:59 are within the permitted grace period. This applies equally to office and WFH attendance.
21. **Leave dates:** `apply_leave` rejects dates before joining or after the last working day, and any request that comes to 0 chargeable days.
22. **Finalised periods:** refuse holiday changes dated in a finalised month, and leave-settings changes for a year with a finalised month. Never block attendance or leave corrections; they become adjustments.
23. **Manager's name:** use `get_my_manager()` (name and designation only). Never widen RLS on `employees` for this.
24. **Manager CSV:** build it on the server from `get_team_month_summary` (direct reports and their adjustments only). Never send the company-wide export to a manager's browser and filter it there.

## How to work

- **Plan before code.** For each build checkpoint, propose a plan, check it against ARCHITECTURE.md, and wait for approval.
- **Tests first.** Turn the checklist item into a failing test in `tests/`, then implement until it passes. Run `npm test` before saying a task is done.
- **Run tests in another time zone too:** `TZ=America/New_York npm test`.
- **Run the agent prompts** after any agent change: `npm run test:agent`.
- **Never reset the database, drop tables, or delete data without asking.** Never commit `.env*` files except `.env.example`.
- **One checkpoint per commit,** with a clear message. Push only when asked.
- **Explain the rule after implementing it.** For example, after writing `count_working_days`, explain how it treats weekly offs, holidays and ML.

## Seed data

`db/seed.sql` must match DESIGN.md "Sample data" exactly:

- 2 locations, 4 departments
- 20 employees: 1 HR Admin, and 3 managers (worked out from reporting lines)
- 2026 holidays, including the Verna-only 14 Dec shutdown and Dussehra (Tue 20 Oct) as the Optional holiday
- Priya Desai's October 2026 attendance and leave history

## Commands

`npm run dev` · `npm test` · `npm run test:db` (needs `TEST_DATABASE_URL`) · `npm run test:agent` (needs model keys) · `npm run db:migrate` · `npm run db:seed` · new migration: add `db/migrations/NNNN_name.sql`
