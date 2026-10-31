# Checkpoint 3: Fresh setup (runbook)

Goal: a new GitHub repo, a deployed Next.js app on Vercel, connected to the new Supabase database, with a Clerk-signed-in user's identity proven **inside Postgres** before any HR table exists.

## 0. Already done for you

| Service | What exists | Public values (safe to share; go in `.env.local` and Vercel) |
| --- | --- | --- |
| Supabase | Project `konkan-people`, region ap-south-1 (Mumbai), free plan, separate from PMS and ATS | `NEXT_PUBLIC_SUPABASE_URL=https://sezbfnxbplgvalkudcdq.supabase.co`<br>`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_fWZAUfs04uWSb0M-UftAPg_CWy2eDwm` |
| Clerk | App `Konkan People` (development instance), separate from your other app. Session tokens already carry `role: authenticated`, which Supabase requires. | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_bWFqb3ItZ29ibGluLTczLmNsZXJrLmFjY291bnRzLmRldiQ`<br>Clerk domain: `major-goblin-73.clerk.accounts.dev` |

**Secret values you must copy yourself, and never commit:**

- `CLERK_SECRET_KEY`: Clerk dashboard → Konkan People → API keys.
- Supabase database password: only needed for `supabase link`.

No Supabase service-role key is used anywhere in this app (CLAUDE.md rule 3).

## 1. Connect Clerk to Supabase (dashboard, 2 minutes)

1. Supabase dashboard → project **konkan-people** → Authentication → Sign In / Providers → **Third-Party Auth** → Add provider → **Clerk**.
2. Domain: `major-goblin-73.clerk.accounts.dev` → Save.

This tells Supabase to trust Clerk-signed tokens. There is no API for it in this session, so it's a dashboard click.

## 2. New GitHub repo

1. On github.com, create a **new, empty, private** repo called `konkan-people`. Do not reuse the ATS or PMS repo.
2. On your laptop:

```bash
git clone https://github.com/<you>/konkan-people.git && cd konkan-people
# copy in RESEARCH.md, ARCHITECTURE.md, DESIGN.md, CLAUDE.md and docs/ from the zip
cat > .gitignore <<'EOF'
node_modules/
.next/
.vercel/
.env*
!.env.example
supabase/.temp/
coverage/
EOF
git add . && git commit -m "Checkpoint 2: research, architecture and design (faculty signed off)"
git push -u origin main
```

The `.gitignore` is committed **before** any key exists on disk.

## 3. Scaffold in Claude Code (plan mode first)

Open Claude Code in the repo, press Shift+Tab for plan mode, and paste:

```
Read CLAUDE.md and ARCHITECTURE.md §1, §7 and §8. Do not write code yet.
Plan checkpoint 3 only: a fresh setup, with no HR tables or features.
1. Next.js (App Router, TypeScript, Tailwind) in this repo root, with the folder structure from ARCHITECTURE.md §7 (empty module folders are fine).
2. Install @clerk/nextjs, @supabase/supabase-js, zod, vitest. Clerk middleware protects every route except sign-in.
3. src/lib/supabase/server.ts: create a Supabase client that passes the Clerk session token via the accessToken option. No service-role key anywhere.
4. src/lib/dates/ist.ts: an IST formatter and an "IST today" helper, with a Vitest test that passes under TZ=America/New_York.
5. supabase init; config.toml with [auth.third_party.clerk] enabled, domain major-goblin-73.clerk.accounts.dev.
6. Migration 0001_auth_smoke_test.sql exactly as in docs/checkpoint-3-runbook.md §4.
7. A page /debug/whoami that calls rpc('debug_whoami') and inserts and reads one rls_probe row. It shows only sub, role, iss, ist_today and the probe rows, never the raw JWT, token, keys or the full error object (only error.code and error.message).
8. .env.example with blank values for every variable; README with setup steps.
List the files you will create and how each one maps to the architecture. Flag anything that departs from ARCHITECTURE.md.
```

Check the plan against ARCHITECTURE.md, then approve it.

## 4. Migration `0001_auth_smoke_test.sql` (temporary; removed in checkpoint 4)

```sql
-- Proves the Clerk identity reaches Postgres and that RLS works with it.
create or replace function public.debug_whoami()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'sub',       auth.jwt()->>'sub',
    'role',      auth.jwt()->>'role',
    'iss',       auth.jwt()->>'iss',
    'ist_today', (now() at time zone 'Asia/Kolkata')::date
  );
$$;
revoke execute on function public.debug_whoami() from public, anon;
grant  execute on function public.debug_whoami() to authenticated;

create table public.rls_probe (
  id         uuid primary key default gen_random_uuid(),
  owner_sub  text not null default (auth.jwt()->>'sub'),
  note       text not null,
  created_at timestamptz not null default now()
);
alter table public.rls_probe enable row level security;
revoke all on public.rls_probe from anon;
grant select, insert on public.rls_probe to authenticated;

create policy "probe: read own rows" on public.rls_probe
  for select to authenticated
  using (owner_sub = (select auth.jwt()->>'sub'));

create policy "probe: insert own rows" on public.rls_probe
  for insert to authenticated
  with check (owner_sub = (select auth.jwt()->>'sub'));
```

Apply it with `supabase link --project-ref sezbfnxbplgvalkudcdq`, then `supabase db push`. Never run `supabase db reset` against the linked project.

## 5. Deploy on Vercel

1. Vercel → Add New → Project → import the `konkan-people` GitHub repo.
2. Environment variables: the three `NEXT_PUBLIC_*` values above, plus `CLERK_SECRET_KEY`.
3. Deploy, and note the `*.vercel.app` URL for the README.

## 6. Done when (test these on the live URL, not just localhost)

- [ ] **Sign in.** You can sign in with Clerk on the live URL.
- [ ] **Identity reaches Postgres.** `/debug/whoami` shows `sub` = your Clerk user ID (`user_…`), `role` = `authenticated`, and `ist_today` = today's date in India.
- [ ] **RLS works.** Two different Clerk users each insert a probe row. Each sees only their own.
- [ ] **Anonymous calls are refused.** Signed out, `rpc('debug_whoami')` with only the publishable key returns a permission error.
- [ ] **No sensitive data on screen.** `/debug/whoami` shows no full JWT, secret or key.
- [ ] **Test objects listed for removal.** `debug_whoami`, `rls_probe` and the `/debug/whoami` route are noted for deletion in checkpoint 4's first migration and commit.
- [ ] **No secrets in git.** `git log -p | grep -i secret` finds no keys, and `.env.example` has only blank values.
- [ ] **Time zone test.** `TZ=America/New_York npm test` passes.
- [ ] **Committed:** "Checkpoint 3: Next.js + Clerk + Supabase setup, JWT identity verified in Postgres", and pushed.

Only after every box is ticked: checkpoint 4 (database and seed). Its first migration drops `debug_whoami` and `rls_probe`.
