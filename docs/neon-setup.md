# Neon + Clerk + Vercel setup (manual steps, about 15 minutes)

Everything the code needs is in the repo. These steps are the ones only you can do, because they involve your accounts and secrets. **Never paste a connection string or key into chat or commit it.**

## 1. Neon: roles and connection strings

1. Neon console → project **hrms** → **Roles** → **New role** → name `app_user`. Copy its password once.
   This role is *not* the owner and cannot bypass row-level security. The app uses only this role.
2. **Connect** (project dashboard) shows the strings. You need two:
   - **Direct**, owner role (untick "Connection pooling"): this is `DATABASE_URL_DIRECT`. Used only to run migrations from your laptop or CI.
   - **Pooled**, role `app_user`: host contains `-pooler`. This is `DATABASE_URL`. Used by the app on Vercel.
3. Create the roles **before** the next step. Migration `0008` grants `app_user` the right to act as `authenticated`.

## 2. Create the tables and sample data

```bash
cp .env.example .env.local        # then fill DATABASE_URL_DIRECT in .env.local (git-ignored)
npm install
npm run db:migrate                # applies db/migrations/*.sql once each; never drops anything
npm run db:seed                   # loads db/seed.sql only into an EMPTY database
```

Seeded sample data matches DESIGN.md: 2 sites, 4 departments, 20 employees (HR Admin Meera Kamat, managers Vikram, Anita, Sanjay), 2026 holidays, and Priya Desai's October 2026.

## 3. Clerk

1. Clerk dashboard → your **Konkan People** development app → keep email-code sign-in.
2. Put `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in `.env.local`. The secret key is shown once at creation.
3. Clerk → Users → create these test users (development instance; the email code is always `424242` for `+clerk_test` addresses):

| Role | Email (matches the seed) |
| --- | --- |
| HR Admin (Meera Kamat) | `meera.kamat+clerk_test@example.com` |
| Manager (Anita Naik) | `anita.naik+clerk_test@example.com` |
| Manager (Sanjay Prabhu, Verna) | `sanjay.prabhu+clerk_test@example.com` |
| MD, leave auto-approved (Vikram Sardesai) | `vikram.sardesai+clerk_test@example.com` |
| Employee (Priya Desai, demo persona) | `priya.desai+clerk_test@example.com` |
| Employee (Suresh Gawas, Verna) | `suresh.gawas+clerk_test@example.com` |

On first sign-in the app links the Clerk account to the employee row **by the verified email**. Roles are never read from Clerk.

## 4. Run it

```bash
npm run dev      # http://localhost:3000
```

## 5. Vercel

Project → Settings → Environment Variables: `DATABASE_URL` (pooled, `app_user`), the two Clerk keys, `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, and for Ask HR `GROQ_API_KEY` (+ `GOOGLE_GENERATIVE_AI_API_KEY` for the fallback). Do **not** add `DATABASE_URL_DIRECT` to Vercel.

## 6. Checks

- Sign in as Priya: the dashboard shows CL 1.5, SL 5, EL 19.5, OH 1 and "Late marks this month: 1 of 3".
- Sign in as Suresh in a private window: he must not see Priya's data anywhere.
- `npm run db:migrate` a second time prints nothing to apply.

## Notes

- Neon free projects scale to zero; the first request after idle is slower.
- To run the SQL tests you need any Postgres 16 with `app.env = 'test'` set on the database:
  `ALTER DATABASE yourtestdb SET app.env = 'test';` then `TEST_DATABASE_URL=... npm run test:db`. **Never** set `app.env` on the real database: it enables the test clock.
