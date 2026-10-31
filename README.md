# Konkan People: HRMS for Konkan Coastal Foods

Employee Master, Attendance and Leave for a 180-person company in Goa (Panaji head office, Verna plant), plus an HR assistant agent. Design documents: [RESEARCH.md](RESEARCH.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DESIGN.md](DESIGN.md), [CLAUDE.md](CLAUDE.md).

**Status:** checkpoint 3: setup and authentication check. HR features start at checkpoint 4.

Live URL: _added after first deployment_

## Stack

Next.js (App Router) on Vercel · Supabase Postgres (ap-south-1) · Clerk (Supabase third-party auth) · Resend · Vercel AI SDK with Groq.

## Setup

1. `npm install`
2. `cp .env.example .env.local` and fill in the values. Never commit `.env.local`.
3. Supabase dashboard → Authentication → Third-Party Auth → add **Clerk** with domain `major-goblin-73.clerk.accounts.dev`.
4. Database: `supabase link --project-ref sezbfnxbplgvalkudcdq`, then `supabase db push`. Never run `db reset` against the linked project.
5. `npm run dev`, then sign in and open `/debug/whoami`.

## Tests

- `npm test`
- `npm run test:ist`: the same suite with `TZ=America/New_York`

## Test logins

Development-only Clerk test users (email-code sign-in; the code is always `424242`):

| Role | Email |
| --- | --- |
| Test user A | `priya.desai+clerk_test@example.com` |
| Test user B | `suresh.gawas+clerk_test@example.com` |

Role-specific logins (HR Admin, Manager, Employee) are added with the seed data in checkpoint 4.
