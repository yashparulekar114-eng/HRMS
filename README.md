# Konkan People: HRMS for Konkan Coastal Foods

Employee Master, Attendance and Leave for a 180-person company in Goa (Panaji head office, Verna plant), plus the **Ask HR** assistant. Design documents: [RESEARCH.md](RESEARCH.md) (business rules), [ARCHITECTURE.md](ARCHITECTURE.md), [DESIGN.md](DESIGN.md), [CLAUDE.md](CLAUDE.md).

## Stack

Next.js (App Router) on Vercel · **Neon Postgres** · Clerk · Vercel AI SDK with Groq `openai/gpt-oss-120b` (Gemini Flash-Lite fallback) · Zod · Vitest.

## What is built

- **Database** (`db/migrations`): schema, row-level security on every table, and all business rules in `SECURITY DEFINER` functions: working days and balances, leave preview/apply/approve/cancel (LOP split, EL whole days, ML via HR), attendance and regularisation (closed-month rules), employee admin with masked statutory data, holidays and settings, month-end CSV with finalise and payroll adjustments, agent limits and logging.
- **Screens:** Dashboard (employee / manager / HR), My attendance, My leave, Apply leave (3 steps), Approvals, Employees (directory, add, profile), My profile, Reports (+ CSV), Team attendance, Leave calendar, Settings, Ask HR.
- **Ask HR:** 8 read-only tools, 30 questions a day and 5 tool calls per question enforced in the database, Confirm-button drafts only.

## Setup

See **[docs/neon-setup.md](docs/neon-setup.md)** (Neon roles and connection strings, migrations, Clerk users, Vercel).

```bash
npm install
cp .env.example .env.local     # fill in the values; never commit this file
npm run db:migrate && npm run db:seed
npm run dev
```

## Tests

| Command | What |
| --- | --- |
| `npm test` | Everything that can run without a database or keys (IST helpers, CSV, agent guardrails) |
| `TEST_DATABASE_URL=... npm run test:db` | 60 SQL tests on a real Postgres: every rule in RESEARCH.md that the database enforces |
| `TEST_APP_DATABASE_URL=... npm test` | Also runs the app's database layer as the limited `app_user` role |
| `npm run test:ist` | Same suite under `TZ=America/New_York` |
| `npm run test:agent` | 17 prompts against the live model (needs `GROQ_API_KEY`, `TEST_APP_DATABASE_URL`) |

## Test logins

Development Clerk users, email-code sign-in (code `424242`): see the table in [docs/neon-setup.md](docs/neon-setup.md).
