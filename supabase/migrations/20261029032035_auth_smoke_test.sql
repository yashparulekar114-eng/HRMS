-- TEMPORARY (checkpoint 3): proves the Clerk identity reaches Postgres and that RLS works with it.
-- Dropped by the first checkpoint 4 migration.
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
