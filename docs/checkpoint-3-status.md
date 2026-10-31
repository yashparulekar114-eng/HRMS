# Checkpoint 3: status (as of 31 Oct 2026)

Checkpoint 3 is **not complete**. Checkpoint 4 stays on hold until all five live checks pass.

## Live checks

| # | Check | Status | Evidence |
|---|---|---|---|
| 1 | Clerk accepts `CLERK_SECRET_KEY` | **Passed** | `/debug/key-check`: 50 characters, starts with `sk_test_`, no hidden characters; Clerk API answered 200; instance `ins_…YUYR61` (Konkan People, development) |
| 2 | Live sign-in with Clerk | **Passed** | Priya signed in on konkan-people.vercel.app; Supabase logs show her token (issuer `major-goblin-73.clerk.accounts.dev`, `role: authenticated`, RS256) |
| 3 | `/debug/whoami` shows sub, role, IST date | **Open** | Blocked by check 4 |
| 4 | Supabase accepts the Clerk JWT | **Open** | Every request returns 401 `PGRST301` "No suitable key or wrong key type" |
| 5 | Priya and Suresh see only their own probe rows | **Open** | `rls_probe` is empty; RLS policies were verified only by simulated SQL so far |

Already verified before this: Vercel build passes, signed-out visitors are blocked, no secrets in pages or git, anonymous RPC and select refused (42501), Supabase security advisor clean.

## What went wrong, and what fixed it

1. **The secret key was the dashboard's masked preview** (`sk_test_e…C0hC`, 14 characters with a "…"), because Clerk no longer reveals an existing key. Fixed by creating a new secret key and copying it once at creation.
2. **One attempt pasted the publishable key** into `CLERK_SECRET_KEY`. Found by `/debug/key-check`.
3. **Clerk was not registered as a Third-Party Auth provider** in the new Supabase project after the account move. Added, with domain `https://major-goblin-73.clerk.accounts.dev` (a retry with an extra `clerk.` prefix failed and was corrected).
4. **Still open:** PostgREST has not loaded Clerk's signing key. A `NOTIFY pgrst, 'reload config'` was sent on 29 Oct at 12:26 IST; no request has been tried since.

## Next steps (in order)

1. Refresh `/debug/whoami` signed in as Priya.
2. If it still shows `PGRST301`: Supabase → Project Settings → General → **Restart project**, wait about 2 minutes, refresh again.
3. If it still fails: delete the Clerk Third-Party Auth integration, open https://dashboard.clerk.com/setup/supabase and activate it for Konkan People → Development, then add the integration again with `https://major-goblin-73.clerk.accounts.dev`.
4. With 4 green ticks: click **Add a probe row as me** as Priya, then as Suresh in an incognito window (`suresh.gawas+clerk_test@example.com`, code `424242`). Each must see only their own row.
5. Push the repo to a new GitHub repo, then mark checkpoint 3 done.

## Temporary objects to remove in checkpoint 4's first migration and commit

- `public.debug_whoami()` and `public.rls_probe`
- `src/app/debug/whoami/` and `src/app/debug/key-check/`
- the `debug/key-check` exclusion in `src/middleware.ts`
- the old "default" Clerk secret key (dashboard), once the new key is confirmed
