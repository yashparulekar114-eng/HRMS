# Plan: move from Supabase to Neon (awaiting approval)

Status: **proposed**. No code changed yet. Logged in ARCHITECTURE.md §10 (31 Oct 2026).

## What stays the same
Clerk sign-in, Next.js on Vercel, all business rules (RESEARCH.md), every rule in CLAUDE.md except where noted below. RLS and SECURITY DEFINER functions remain the enforcement layer.

## What changes

| Area | Supabase today | Neon plan |
| --- | --- | --- |
| Query path | `supabase-js` with the Clerk token (PostgREST) | Neon Data API (PostgREST-compatible) with the Clerk token, so Postgres verifies the JWT itself and RLS applies. Fallback if it does not fit: `@neondatabase/serverless` with a non-owner role. |
| Identity in SQL | `auth.jwt()->>'sub'` | The Neon Data API's JWT helper (to confirm in Neon's docs once neon.com is reachable). A thin `public.current_sub()` wrapper is the only place that names it, so migrations and functions never depend on the vendor call. |
| Clerk link | Third-Party Auth in Supabase | Clerk's JWKS URL (`https://major-goblin-73.clerk.accounts.dev/.well-known/jwks.json`) registered as the JWT provider in Neon |
| Migrations | `supabase/migrations`, `supabase db push` | `db/migrations/*.sql` applied with `psql "$DATABASE_URL_DIRECT" -f` in order (small runner script, with a `schema_migrations` table). `supabase/` folder removed. |
| Certificates (rule 17) | Supabase Storage bucket | **Open question**: Vercel Blob (private) or Cloudflare R2. Ownership rule stays: path `<clerk_user_id>/<file_id>`, checked server-side against the Clerk user. |
| Env vars | `NEXT_PUBLIC_SUPABASE_*` | `NEON_DATA_API_URL`, `DATABASE_URL` (pooled), `DATABASE_URL_DIRECT` (migrations only). No owner connection string in request handlers (replaces rule 3). |

## Rule 3 rewritten
"Never use the database owner connection in request handlers, server actions or agent tools. Every query runs as the signed-in user's Clerk token under a non-owner role, so RLS applies."

## Steps
1. Owner: create the Neon project `hrms` (Asia Pacific region closest to Goa), enable the Data API, add the Clerk JWKS URL, and put the connection strings in `.env.local` and Vercel. Never in chat.
2. Replace `src/lib/supabase/server.ts` with `src/lib/db/server.ts`; update `/debug/whoami`.
3. Port the smoke-test migration (`debug_whoami`, `rls_probe`), run the five live checks from the checkpoint 3 status file against Neon, then close checkpoint 3.
4. Remove all Supabase files, packages and README/CLAUDE.md/runbook references.
5. Checkpoint 4 (HR schema) then proceeds as already designed, with its own plan for approval.

## Risks
- Data API details (JWT helper name, role setup) are unverified; step 3 is the proof.
- Free-tier Neon scales to zero, so the first request after idle is slower.

## Questions for the owner
1. Certificate storage: Vercel Blob or Cloudflare R2?
2. Is the Neon region chosen (Singapore is the nearest to Goa)?
