-- Konkan People: full database setup for the Neon SQL Editor. Run ONCE on an empty database.
-- 1) Change the password below. 2) Paste this whole file into Neon -> SQL Editor -> Run.
create role app_user login password 'CHANGE_ME_TO_A_LONG_RANDOM_PASSWORD' nobypassrls noinherit;

-- ===== db/migrations/0001_schema.sql =====
-- Konkan People: schema, RLS and grants (Neon Postgres).
-- Identity: the Clerk JWT reaches Postgres through the Neon Data API as the
-- `request.jwt.claims` setting; current_sub() is the only place that reads it.

do $$ begin
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

alter default privileges in schema public revoke execute on functions from public;
grant usage on schema public to authenticated;

-- ---------- identity and clock helpers ----------
create function public.current_sub() returns text language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')
$$;
create function public.jwt_claim(k text) returns text language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> k, '')
$$;
-- The clock. Only a database whose app.env is 'test' honours app.now (used by the SQL tests).
create function public.app_now() returns timestamptz language sql stable as $$
  select case when current_setting('app.env', true) = 'test' and nullif(current_setting('app.now', true), '') is not null
              then current_setting('app.now')::timestamptz else now() end
$$;
create function public.ist_today() returns date language sql stable as $$
  select (public.app_now() at time zone 'Asia/Kolkata')::date
$$;

-- ---------- reference tables ----------
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  city text not null,
  state text not null,
  weekly_off_days smallint[] not null            -- Sunday = 0
);
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);
create table public.leave_types (
  code text primary key,
  name text not null,
  accrual_method text not null check (accrual_method in ('lump_sum','monthly','on_request','none')),
  carry_forward_max numeric,
  half_day_allowed boolean not null default false,
  prorate_for_joiners boolean not null default false,
  count_calendar_days boolean not null default false,
  certificate_after_days int,
  is_active boolean not null default true
);
create table public.leave_type_year_settings (
  leave_type_code text not null references public.leave_types(code),
  year int not null,
  annual_quota numeric check (annual_quota is null or annual_quota >= 0),
  primary key (leave_type_code, year)
);

-- ---------- employees ----------
create sequence public.employee_code_seq start 1;
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text unique,
  employee_code text not null unique default ('KCF' || lpad(nextval('public.employee_code_seq')::text, 4, '0')),
  first_name text not null,
  last_name text not null,
  email text not null,
  mobile text not null check (mobile ~ '^[6-9][0-9]{9}$'),
  gender text not null check (gender in ('Male','Female','Other')),
  address_line text not null,
  city text not null,
  address_pin text not null check (address_pin ~ '^[0-9]{6}$'),
  address_state text not null,
  doj date not null,
  dob date not null,
  last_working_day date,
  designation text not null,
  is_hr_admin boolean not null default false,
  location_id uuid not null references public.locations(id),
  department_id uuid not null references public.departments(id),
  manager_id uuid references public.employees(id),
  created_at timestamptz not null default now(),
  constraint employees_age_18 check (dob <= (doj - interval '18 years')::date),
  constraint employees_not_own_manager check (manager_id <> id),
  constraint employees_lwd_after_doj check (last_working_day is null or last_working_day >= doj)
);
create unique index employees_email_key on public.employees (lower(email));
create index employees_manager_idx on public.employees (manager_id);

create table public.employee_sensitive (
  employee_id uuid primary key references public.employees(id),
  pan_number text not null check (pan_number ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  aadhaar_number text not null check (aadhaar_number ~ '^[0-9]{12}$'),
  uan_number text check (uan_number is null or uan_number ~ '^[0-9]{12}$'),
  bank_name text not null,
  bank_account text not null check (bank_account ~ '^[0-9]{9,18}$'),
  ifsc text not null check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$')
);
create table public.employee_emergency (
  employee_id uuid primary key references public.employees(id),
  blood_group text check (blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  emergency_contact_name text not null,
  emergency_contact_phone text not null check (emergency_contact_phone ~ '^[6-9][0-9]{9}$')
);

-- A manager loop (A -> B -> A) cannot be a CHECK: it needs a recursive walk.
create function public._no_manager_loop() returns trigger language plpgsql set search_path = public as $$
begin
  if new.manager_id is not null and exists (
    with recursive up as (
      select id, manager_id from employees where id = new.manager_id
      union all
      select e.id, e.manager_id from employees e join up on e.id = up.manager_id and up.id <> new.id
    ) select 1 from up where up.id = new.id
  ) then
    raise exception 'Reporting line would form a loop' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger employees_no_loop before insert or update of manager_id on public.employees
  for each row execute function public._no_manager_loop();

-- ---------- role helpers (SECURITY DEFINER so policies never recurse) ----------
create function public.me() returns uuid language sql stable security definer set search_path = public as $$
  select id from employees where clerk_user_id = current_sub()
    and (last_working_day is null or last_working_day >= ist_today())
$$;
create function public.is_hr() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_hr_admin from employees where id = me()), false)
$$;
create function public.is_manager_of(target uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from employees where id = target and manager_id = me())
$$;
create function public.is_manager() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from employees e where e.manager_id = me()
                 and (e.last_working_day is null or e.last_working_day >= ist_today()))
$$;

-- ---------- holidays ----------
create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  date date not null,
  name text not null,
  type text not null check (type in ('National','State','Optional')),
  unique (location_id, date)
);

-- ---------- leave ----------
create table public.leave_opening_balances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  year int not null,
  leave_type text not null references public.leave_types(code),
  opening_balance numeric not null check (opening_balance >= 0),
  unique (employee_id, year, leave_type)
);
create table public.medical_certificates (
  id uuid primary key default gen_random_uuid(),
  owner_sub text not null,
  path text not null unique,
  content_type text not null check (content_type in ('application/pdf','image/jpeg','image/png')),
  content bytea not null check (octet_length(content) between 1 and 2097152),   -- 2 MB
  created_at timestamptz not null default now(),
  check (path like owner_sub || '/%')
);
create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  approver_id uuid references public.employees(id),
  routed_to_hr boolean not null default false,
  leave_type text not null references public.leave_types(code),
  from_date date not null,
  to_date date not null,
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected','Cancelled')),
  is_half_day boolean not null default false,
  half_day_period text check (half_day_period in ('First','Second')),
  applicant_reason text not null,
  approver_comment text,
  medical_certificate_path text,
  auto_approved boolean not null default false,
  requested_weeks int check (requested_weeks in (12, 26)),
  confirmed_weeks int check (confirmed_weeks in (12, 26)),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (to_date >= from_date),
  check (not is_half_day or from_date = to_date),
  check ((half_day_period is not null) = is_half_day),
  check (approver_id is distinct from employee_id)
);
create index leave_requests_emp_idx on public.leave_requests (employee_id, from_date);
create index leave_requests_approver_idx on public.leave_requests (approver_id, status);
create table public.leave_request_days (
  id uuid primary key default gen_random_uuid(),
  leave_request_id uuid not null references public.leave_requests(id),
  date date not null,
  leave_type text not null references public.leave_types(code),
  deduction numeric not null check (deduction in (0.5, 1.0)),
  unique (leave_request_id, date, leave_type)
);
create index leave_request_days_date_idx on public.leave_request_days (date);

-- ---------- attendance ----------
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  date date not null,
  check_in timestamptz,
  check_out timestamptz,
  is_wfh boolean not null default false,
  unique (employee_id, date),
  check (check_out is null or check_in is null or check_out >= check_in)
);
create table public.regularisation_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  attendance_date date not null,
  requested_by uuid not null references public.employees(id),
  requested_in timestamptz not null,
  requested_out timestamptz not null,
  reason text not null,
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected')),
  approver_id uuid references public.employees(id),
  approver_comment text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (requested_out > requested_in),
  check (approver_id is distinct from employee_id)
);
create unique index regularisation_one_pending on public.regularisation_requests (employee_id, attendance_date) where status = 'Pending';

-- ---------- logs, policies, payroll ----------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.employees(id),
  action text not null,
  target_employee_id uuid references public.employees(id),
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create table public.company_policies (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  content_markdown text not null,
  last_updated_at timestamptz not null default now(),
  last_updated_by uuid references public.employees(id)
);
create table public.payroll_exports (
  id uuid primary key default gen_random_uuid(),
  payroll_month date not null unique check (payroll_month = date_trunc('month', payroll_month)::date),
  csv_content text not null,
  checksum text not null,
  finalised_by uuid not null references public.employees(id),
  finalised_at timestamptz not null default now()
);
create table public.payroll_month_snapshots (
  employee_id uuid not null references public.employees(id),
  date date not null,
  export_id uuid not null references public.payroll_exports(id),
  buckets jsonb not null,
  primary key (employee_id, date)
);
create table public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  employee_id uuid not null references public.employees(id),
  attendance_date date not null,
  payroll_month date not null,
  source_type text not null check (source_type in ('regularisation','leave_request','leave_change','hr_correction')),
  source_id uuid not null,
  previous_buckets jsonb not null,
  new_buckets jsonb not null,
  bucket_deltas jsonb not null,
  lop_delta numeric not null,
  reason text not null,
  approved_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  unique (source_type, source_id, attendance_date)
);
create table public.agent_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.employees(id),
  ist_date date not null,
  seq int not null check (seq between 1 and 30),
  created_at timestamptz not null default now(),
  unique (user_id, ist_date, seq)
);
create table public.agent_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.employees(id),
  question_id uuid not null references public.agent_questions(id),
  slot int check (slot between 1 and 5),
  tool_name text not null,
  inputs jsonb,
  result jsonb,
  status text not null default 'running' check (status in ('running','ok','denied','error','limit_exceeded')),
  created_at timestamptz not null default now(),
  unique (question_id, slot)
);

-- insert-only tables (rule 12)
create function public._insert_only() returns trigger language plpgsql as $$
begin raise exception '% is insert-only', tg_table_name using errcode = '42501'; end $$;
create trigger audit_log_ro before update or delete on public.audit_log for each row execute function public._insert_only();
create trigger payroll_adjustments_ro before update or delete on public.payroll_adjustments for each row execute function public._insert_only();
create trigger payroll_exports_ro before update or delete on public.payroll_exports for each row execute function public._insert_only();
create trigger payroll_snapshots_ro before update or delete on public.payroll_month_snapshots for each row execute function public._insert_only();
-- agent_log: filled in once (running -> final) through one function; nothing else
create function public._agent_log_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.status <> 'running' or current_setting('app.agent_fill', true) is distinct from 'on' then
    raise exception 'agent_log rows can only be completed once, through agent_finish_call' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger agent_log_guard before update or delete on public.agent_log for each row execute function public._agent_log_guard();

-- ---------- row-level security ----------
do $$
declare t text;
begin
  foreach t in array array['locations','departments','leave_types','leave_type_year_settings','employees','employee_sensitive',
    'employee_emergency','holidays','leave_opening_balances','medical_certificates','leave_requests','leave_request_days',
    'attendance','regularisation_requests','audit_log','company_policies','payroll_exports','payroll_month_snapshots',
    'payroll_adjustments','agent_questions','agent_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
-- Raw statutory rows are only ever read through get_sensitive_masked / reveal_sensitive.
revoke select on public.employee_sensitive from authenticated;

create policy ref_read on public.locations for select to authenticated using (true);
create policy ref_read on public.departments for select to authenticated using (true);
create policy ref_read on public.leave_types for select to authenticated using (true);
create policy ref_read on public.leave_type_year_settings for select to authenticated using (true);
create policy ref_read on public.holidays for select to authenticated using (true);
create policy ref_read on public.company_policies for select to authenticated using (true);

create policy emp_read on public.employees for select to authenticated
  using (id = me() or manager_id = me() or is_hr());
create policy sens_read on public.employee_sensitive for select to authenticated
  using (employee_id = me() or is_hr());
create policy emerg_read on public.employee_emergency for select to authenticated
  using (employee_id = me() or is_manager_of(employee_id) or is_hr());
create policy bal_read on public.leave_opening_balances for select to authenticated
  using (employee_id = me() or is_manager_of(employee_id) or is_hr());
create policy cert_read on public.medical_certificates for select to authenticated
  using (owner_sub = current_sub() or is_hr()
         or exists (select 1 from public.leave_requests r where r.medical_certificate_path = path));
create policy lr_read on public.leave_requests for select to authenticated
  using (employee_id = me() or approver_id = me() or is_manager_of(employee_id) or is_hr());
create policy lrd_read on public.leave_request_days for select to authenticated
  using (exists (select 1 from public.leave_requests r where r.id = leave_request_id));
create policy att_read on public.attendance for select to authenticated
  using (employee_id = me() or is_manager_of(employee_id) or is_hr());
create policy reg_read on public.regularisation_requests for select to authenticated
  using (employee_id = me() or approver_id = me() or is_manager_of(employee_id) or is_hr());
create policy audit_read on public.audit_log for select to authenticated using (is_hr());
create policy exports_read on public.payroll_exports for select to authenticated using (is_hr());
create policy snap_read on public.payroll_month_snapshots for select to authenticated
  using (employee_id = me() or is_manager_of(employee_id) or is_hr());
create policy adj_read on public.payroll_adjustments for select to authenticated
  using (employee_id = me() or is_manager_of(employee_id) or is_hr());
create policy aq_read on public.agent_questions for select to authenticated using (user_id = me() or is_hr());
create policy al_read on public.agent_log for select to authenticated using (is_hr());

grant execute on function public.current_sub(), public.jwt_claim(text), public.ist_today(), public.me(),
  public.is_hr(), public.is_manager_of(uuid), public.is_manager(), public.app_now() to authenticated;

-- ===== db/migrations/0002_calendar_balance.sql =====
-- Calendar, working days, balances and day status. All derived values are calculated, never stored (rule D4).

-- One row per date: working day, weekly off or holiday (rules E1, K1, K2). Optional holidays are working days.
create function public.location_calendar(p_location uuid, p_from date, p_to date)
returns table (date date, is_weekly_off boolean, holiday_name text, holiday_type text, kind text, is_working_day boolean)
language sql stable security definer set search_path = public as $$
  select d::date,
         extract(dow from d)::smallint = any (l.weekly_off_days),
         h.name, h.type,
         case when h.type in ('National','State') then 'holiday'
              when extract(dow from d)::smallint = any (l.weekly_off_days) then 'weekly_off'
              else 'working' end,
         not (coalesce(h.type in ('National','State'), false) or extract(dow from d)::smallint = any (l.weekly_off_days))
  from generate_series(p_from, p_to, interval '1 day') d
  join locations l on l.id = p_location
  left join holidays h on h.location_id = p_location and h.date = d::date
$$;

create function public.count_working_days(p_location uuid, p_from date, p_to date, p_calendar boolean default false)
returns integer language sql stable security definer set search_path = public as $$
  select case when p_calendar then (p_to - p_from + 1)
              else (select count(*)::int from location_calendar(p_location, p_from, p_to) c where c.is_working_day) end
$$;

create function public._quota(p_type text, p_year int) returns numeric language sql stable security definer set search_path = public as $$
  select annual_quota from leave_type_year_settings
  where leave_type_code = p_type and year <= p_year order by year desc limit 1
$$;

-- Entitlement credited for the year: CL/SL pro-rated for joiners (rules B1-B4), OH/PL lump sum.
create function public._entitlement(p_emp uuid, p_type text, p_year int) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare e employees; lt leave_types; q numeric; months numeric; raw numeric;
begin
  select * into e from employees where id = p_emp;
  select * into lt from leave_types where code = p_type;
  q := _quota(p_type, p_year);
  if lt.accrual_method <> 'lump_sum' or q is null then return 0; end if;
  if e.doj > make_date(p_year, 12, 31) then return 0; end if;
  if lt.prorate_for_joiners and extract(year from e.doj) = p_year then
    months := (12 - extract(month from e.doj)) + case when extract(day from e.doj) <= 15 then 1 else 0.5 end;
    raw := q * months / 12;
    return round(raw * 2) / 2;                       -- nearest 0.5, rounded once (B3, B4)
  end if;
  return q;
end $$;

-- EL: 1.25 on the 1st of the month after each completed month (C1-C3, C6).
create function public._el_accrued(p_emp uuid, p_year int, p_as_of date) returns numeric
language sql stable security definer set search_path = public as $$
  select 1.25 * count(*) from employees e, generate_series(1, 12) k
  where e.id = p_emp
    and make_date(p_year, k, 1) <= p_as_of
    and e.doj <= (make_date(p_year, k, 1) - interval '1 month')::date
    and (e.last_working_day is null or e.last_working_day >= make_date(p_year, k, 1) - 1)
$$;

create function public._as_of(p_year int) returns date language sql stable as $$
  select case when p_year < extract(year from ist_today())::int then make_date(p_year, 12, 31)
              when p_year = extract(year from ist_today())::int then ist_today()
              else make_date(p_year, 1, 1) end
$$;

create function public._leave_used(p_emp uuid, p_type text, p_year int, p_status text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(d.deduction), 0)
  from leave_request_days d
  join leave_requests r on r.id = d.leave_request_id
  join employees e on e.id = r.employee_id
  join leave_types lt on lt.code = d.leave_type
  where r.employee_id = p_emp and d.leave_type = p_type and r.status = p_status
    and extract(year from d.date) = p_year
    and (lt.count_calendar_days
         or not exists (select 1 from location_calendar(e.location_id, d.date, d.date) c where c.kind <> 'working'))
$$;

create function public._opening(p_emp uuid, p_type text, p_year int) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v numeric; cap numeric; doj_year int; prev numeric;
begin
  select opening_balance into v from leave_opening_balances where employee_id = p_emp and year = p_year and leave_type = p_type;
  if found then return v; end if;
  select carry_forward_max into cap from leave_types where code = p_type;
  if cap is null then return 0; end if;
  select extract(year from doj)::int into doj_year from employees where id = p_emp;
  if p_year <= doj_year then return 0; end if;
  prev := _opening(p_emp, p_type, p_year - 1) + _el_accrued(p_emp, p_year - 1, make_date(p_year - 1, 12, 31))
          - _leave_used(p_emp, p_type, p_year - 1, 'Approved');       -- C4: min(balance at 31 Dec, cap)
  return greatest(least(prev, cap), 0);
end $$;

create function public._leave_balance(p_emp uuid, p_type text, p_year int)
returns table (opening numeric, accrued numeric, used numeric, pending numeric, available numeric, unlimited boolean)
language plpgsql stable security definer set search_path = public as $$
declare lt leave_types; q numeric; o numeric; a numeric; u numeric; p numeric;
begin
  select * into lt from leave_types where code = p_type;
  o := _opening(p_emp, p_type, p_year);
  a := case when lt.accrual_method = 'monthly' then _el_accrued(p_emp, p_year, _as_of(p_year))
            else _entitlement(p_emp, p_type, p_year) end;
  u := _leave_used(p_emp, p_type, p_year, 'Approved');
  p := _leave_used(p_emp, p_type, p_year, 'Pending');
  q := _quota(p_type, p_year);
  return query select o, a, u, p, o + a - u - p, (lt.accrual_method in ('on_request','none') and q is null);
end $$;

create function public.get_my_balances(p_year int default null)
returns table (leave_type text, name text, opening numeric, accrued numeric, used numeric, pending numeric, available numeric, unlimited boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := me(); y int := coalesce(p_year, extract(year from ist_today())::int);
begin
  if v_me is null then raise exception 'Not signed in as an active employee' using errcode = '42501'; end if;
  return query select lt.code, lt.name, b.opening, b.accrued, b.used, b.pending, b.available, b.unlimited
    from leave_types lt cross join lateral _leave_balance(v_me, lt.code, y) b
    where lt.is_active and lt.code <> 'LOP' order by lt.code;
end $$;

create function public.get_balances_for(p_emp uuid, p_year int default null)
returns table (leave_type text, opening numeric, accrued numeric, used numeric, pending numeric, available numeric, unlimited boolean)
language plpgsql stable security definer set search_path = public as $$
declare y int := coalesce(p_year, extract(year from ist_today())::int);
begin
  if not (is_hr() or is_manager_of(p_emp) or p_emp = me()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query select lt.code, b.opening, b.accrued, b.used, b.pending, b.available, b.unlimited
    from leave_types lt cross join lateral _leave_balance(p_emp, lt.code, y) b where lt.is_active and lt.code <> 'LOP' order by lt.code;
end $$;

-- ---------- day status (rules J2-J12, K1) ----------
-- buckets: Present WFH CL SL EL ML PL OH LOP_leave Absent Holidays Weekly_offs Pending.
create function public._month_closed(d date) returns boolean language sql stable as $$
  select (date_trunc('month', d) + interval '1 month')::date <= ist_today()
$$;

create function public._day_info(p_emp uuid, d date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e employees; today date := ist_today(); cal record; a attendance; b jsonb := '{}'::jsonb;
  leave_total numeric := 0; w numeric := 1; r record; hrs numeric; status text; codes text[] := '{}';
  is_late boolean := false; pres text; rej boolean;
begin
  select * into e from employees where id = p_emp;
  if e.id is null or d < e.doj or (e.last_working_day is not null and d > e.last_working_day) then
    return jsonb_build_object('status','Not employed','buckets','{}'::jsonb,'late',false,'leave','[]'::jsonb);
  end if;

  if exists (select 1 from leave_request_days x join leave_requests q on q.id = x.leave_request_id
             where q.employee_id = p_emp and q.status = 'Approved' and x.date = d and x.leave_type = 'ML') then
    return jsonb_build_object('status','On Leave','buckets',jsonb_build_object('ML',1),'late',false,'leave','["ML"]'::jsonb);
  end if;

  select * into cal from location_calendar(e.location_id, d, d);
  if cal.kind = 'holiday' then
    return jsonb_build_object('status','Holiday','buckets',jsonb_build_object('Holidays',1),'late',false,'leave','[]'::jsonb,'label',cal.holiday_name);
  elsif cal.kind = 'weekly_off' then
    return jsonb_build_object('status','Weekly Off','buckets',jsonb_build_object('Weekly_offs',1),'late',false,'leave','[]'::jsonb);
  end if;

  for r in select x.leave_type, sum(x.deduction) as ded from leave_request_days x join leave_requests q on q.id = x.leave_request_id
           where q.employee_id = p_emp and q.status = 'Approved' and x.date = d group by x.leave_type order by x.leave_type loop
    b := b || jsonb_build_object(case when r.leave_type = 'LOP' then 'LOP_leave' else r.leave_type end, r.ded);
    leave_total := leave_total + r.ded;
    codes := codes || r.leave_type;
  end loop;
  if leave_total >= 1 then
    return jsonb_build_object('status','On Leave','buckets',b,'late',false,'leave',to_jsonb(codes));
  end if;
  w := 1 - leave_total;                                   -- weight left for attendance (J8)

  if d > today then
    return jsonb_build_object('status', case when leave_total > 0 then 'On Leave' else 'Upcoming' end,
                              'buckets', b, 'late', false, 'leave', to_jsonb(codes));
  end if;

  select * into a from attendance where employee_id = p_emp and date = d;
  if a.id is null or a.check_in is null then
    if d = today then
      return jsonb_build_object('status', case when leave_total > 0 then 'On Leave' else 'Not checked in' end,
                                'buckets', b, 'late', false, 'leave', to_jsonb(codes));
    end if;
    b := b || jsonb_build_object('Absent', w);
    return jsonb_build_object('status', case when leave_total > 0 then 'On Leave' else 'Absent' end,
                              'buckets', b, 'late', false, 'leave', to_jsonb(codes));
  end if;

  pres := case when a.is_wfh then 'WFH' else 'Present' end;
  is_late := (a.check_in at time zone 'Asia/Kolkata')::time >= time '10:16:00';
  if a.check_out is null then
    if d = today then
      return jsonb_build_object('status','In progress','buckets',b,'late',false,'leave',to_jsonb(codes),'check_in',a.check_in,'is_wfh',a.is_wfh);
    end if;
    select exists (select 1 from regularisation_requests q where q.employee_id = p_emp and q.attendance_date = d and q.status = 'Rejected')
           and not exists (select 1 from regularisation_requests q where q.employee_id = p_emp and q.attendance_date = d and q.status = 'Pending')
      into rej;
    if _month_closed(d) or rej then
      b := b || jsonb_build_object('Absent', w);
      return jsonb_build_object('status','Absent','buckets',b,'late',false,'leave',to_jsonb(codes),'check_in',a.check_in,'is_wfh',a.is_wfh);
    end if;
    b := b || jsonb_build_object('Pending', w);
    return jsonb_build_object('status','Pending Regularisation','buckets',b,'late',false,'leave',to_jsonb(codes),'check_in',a.check_in,'is_wfh',a.is_wfh);
  end if;

  hrs := extract(epoch from (a.check_out - a.check_in)) / 3600;
  if leave_total > 0 then                                  -- half-day leave: thresholds halve (J8)
    if hrs >= 4 then b := b || jsonb_build_object(pres, w);
    else b := b || jsonb_build_object('Absent', w); is_late := false; end if;
    status := 'On Leave';
  elsif hrs >= 8 then b := b || jsonb_build_object(pres, 1); status := case when a.is_wfh then 'WFH' else 'Present' end;
  elsif hrs >= 4 then b := b || jsonb_build_object(pres, 0.5, 'Absent', 0.5); status := 'Half Day';
  else b := b || jsonb_build_object('Absent', 1); status := 'Absent'; is_late := false;
  end if;
  return jsonb_build_object('status', status, 'buckets', b, 'late', is_late, 'leave', to_jsonb(codes),
    'check_in', a.check_in, 'check_out', a.check_out, 'is_wfh', a.is_wfh, 'hours', round(hrs, 2));
end $$;

create function public.get_month_days(p_emp uuid, p_month date)
returns table (date date, info jsonb) language plpgsql stable security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date;
begin
  if not (p_emp = me() or is_manager_of(p_emp) or is_hr()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query select d::date, _day_info(p_emp, d::date)
    from generate_series(m, (m + interval '1 month - 1 day')::date, interval '1 day') d;
end $$;

create function public.get_my_late_marks(p_month date default null)
returns integer language plpgsql stable security definer set search_path = public as $$
declare m date := date_trunc('month', coalesce(p_month, ist_today()))::date; n int;
begin
  select count(*) into n from generate_series(m, (m + interval '1 month - 1 day')::date, interval '1 day') d
    where coalesce((_day_info(me(), d::date)->>'late')::boolean, false);
  return n;
end $$;

grant execute on function public.location_calendar(uuid,date,date), public.count_working_days(uuid,date,date,boolean),
  public.get_my_balances(int), public.get_balances_for(uuid,int), public.get_month_days(uuid,date),
  public.get_my_late_marks(date) to authenticated;

-- ===== db/migrations/0003_leave.sql =====
-- Leave: one checking/planning function used by preview, apply and the agent's draft (rule: preview == submit).

create function public._leave_check(
  p_emp uuid, p_type text, p_from date, p_to date, p_half boolean, p_period text, p_weeks int,
  p_skip_date_rules boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  e employees; lt leave_types; v_to date := p_to; r numeric; d date; today date := ist_today();
  avail jsonb := '{}'::jsonb; y text; av numeric; unl boolean; unit numeric; paid numeric;
  lines jsonb := '[]'::jsonb; lop numeric := 0; chargeable numeric := 0; ex numeric; wd int;
  need_cert boolean := false; routed boolean := false; n_dates int := 0;
begin
  select * into e from employees where id = p_emp;
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'Employee not found'); end if;
  select * into lt from leave_types where code = p_type;
  if lt.code is null or not lt.is_active then return jsonb_build_object('ok', false, 'error', 'Unknown or inactive leave type'); end if;
  if p_from is null then return jsonb_build_object('ok', false, 'error', 'Choose a start date'); end if;

  if p_type = 'ML' then
    if coalesce(p_weeks, 0) not in (12, 26) then return jsonb_build_object('ok', false, 'error', 'Maternity leave: request 12 or 26 weeks'); end if;
    if p_half then return jsonb_build_object('ok', false, 'error', 'Maternity leave cannot be a half day'); end if;
    v_to := p_from + p_weeks * 7 - 1;
  else
    if p_to is null then return jsonb_build_object('ok', false, 'error', 'Choose an end date'); end if;
    if p_weeks is not null then return jsonb_build_object('ok', false, 'error', 'Weeks apply to maternity leave only'); end if;
  end if;
  if v_to < p_from then return jsonb_build_object('ok', false, 'error', 'The end date is before the start date'); end if;

  if p_half then
    if not lt.half_day_allowed then return jsonb_build_object('ok', false, 'error', lt.name || ' cannot be taken as a half day'); end if;
    if p_from <> v_to then return jsonb_build_object('ok', false, 'error', 'A half day must be a single date'); end if;
    if coalesce(p_period, '') not in ('First','Second') then return jsonb_build_object('ok', false, 'error', 'Choose First half or Second half'); end if;
  elsif p_period is not null then
    return jsonb_build_object('ok', false, 'error', 'A half-day period needs a half day');
  end if;
  r := case when p_half then 0.5 else 1 end;

  if not p_skip_date_rules and p_from < today - 30 then
    return jsonb_build_object('ok', false, 'error', 'Leave cannot be applied for more than 30 days in the past');
  end if;
  if p_from < e.doj then return jsonb_build_object('ok', false, 'error', 'Leave cannot start before your joining date'); end if;
  if e.last_working_day is not null and v_to > e.last_working_day then
    return jsonb_build_object('ok', false, 'error', 'Leave cannot end after your last working day');
  end if;

  if p_type = 'OH' then
    if p_from <> v_to or not exists (select 1 from location_calendar(e.location_id, p_from, p_from) c where c.holiday_type = 'Optional') then
      return jsonb_build_object('ok', false, 'error', 'Optional holiday leave is only for a date marked Optional in your location''s calendar');
    end if;
  end if;

  for d in select x.date from location_calendar(e.location_id, p_from, v_to) x
           where lt.count_calendar_days or x.is_working_day order by x.date loop
    n_dates := n_dates + 1;
    -- overlap (F3): the day's total across pending/approved requests must stay <= 1.0
    select coalesce(sum(l.deduction), 0) into ex from leave_request_days l join leave_requests q on q.id = l.leave_request_id
      where q.employee_id = p_emp and q.status in ('Pending','Approved') and l.date = d;
    if ex + r > 1 or (p_half and exists (select 1 from leave_requests q where q.employee_id = p_emp and q.status in ('Pending','Approved')
                       and q.is_half_day and q.from_date = d and q.half_day_period = p_period)) then
      return jsonb_build_object('ok', false, 'error', 'This overlaps your existing leave on ' || to_char(d, 'DD Mon YYYY'));
    end if;

    if p_type = 'LOP' then
      paid := 0;
    else
      y := extract(year from d)::text;
      if avail ? y then av := (avail->>y)::numeric; unl := false;
      else select b.available, b.unlimited into av, unl from _leave_balance(p_emp, p_type, y::int) b;
           if unl then av := 1e6; end if;
      end if;
      av := greatest(av, 0);
      unit := case when lt.half_day_allowed then floor(av * 2) / 2 else floor(av) end;
      paid := least(r, unit);
      avail := avail || jsonb_build_object(y, av - paid);
    end if;
    if paid > 0 then lines := lines || jsonb_build_object('date', d, 'leave_type', p_type, 'deduction', paid); end if;
    if r - paid > 0 then
      lines := lines || jsonb_build_object('date', d, 'leave_type', 'LOP', 'deduction', r - paid);
      lop := lop + (r - paid);
    end if;
    chargeable := chargeable + r;
  end loop;

  if n_dates = 0 or chargeable = 0 then
    return jsonb_build_object('ok', false, 'error', 'Those dates have no working days to charge (weekly offs and holidays are not leave)');
  end if;

  if lt.certificate_after_days is not null and not p_half then
    wd := count_working_days(e.location_id, p_from, v_to);
    need_cert := wd > lt.certificate_after_days;
  end if;
  routed := p_type = 'ML' or exists (select 1 from payroll_exports x where x.payroll_month between date_trunc('month', p_from)::date and v_to);

  return jsonb_build_object('ok', true, 'to_date', v_to, 'chargeable_days', chargeable, 'lop_days', case when p_type = 'LOP' then 0 else lop end,
    'lines', lines, 'needs_certificate', need_cert, 'routed_to_hr', routed);
end $$;

-- Read-only preview: the same function the submit uses.
create function public.preview_leave(p_type text, p_from date, p_to date, p_half boolean default false, p_period text default null, p_weeks int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if me() is null then raise exception 'Not signed in as an active employee' using errcode = '42501'; end if;
  return _leave_check(me(), p_type, p_from, p_to, p_half, p_period, p_weeks);
end $$;

-- Certificates live in a private table (RLS: owner, HR, and whoever can see the request that cites the file).
-- The path is <clerk_user_id>/<file_id>; the caller is taken from the token, never from the path (CLAUDE.md rule 17).
create function public.upload_certificate(p_file_id uuid, p_content_type text, p_content bytea) returns text
language plpgsql security definer set search_path = public as $$
declare v_path text;
begin
  if me() is null then raise exception 'Not signed in as an active employee' using errcode = '42501'; end if;
  v_path := current_sub() || '/' || p_file_id::text;
  insert into medical_certificates (owner_sub, path, content_type, content) values (current_sub(), v_path, p_content_type, p_content);
  return v_path;
end $$;

create function public.apply_leave(
  p_type text, p_from date, p_to date, p_half boolean default false, p_period text default null,
  p_reason text default null, p_certificate_path text default null, p_accept_lop boolean default false,
  p_requested_weeks int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := me(); e employees; chk jsonb; v_id uuid; v_approver uuid; v_routed boolean; v_auto boolean := false;
  v_status text := 'Pending'; v_comment text; l jsonb; mgr employees;
begin
  if v_me is null then raise exception 'Not signed in as an active employee' using errcode = '42501'; end if;
  select * into e from employees where id = v_me for update;            -- serialises concurrent applications
  if coalesce(trim(p_reason), '') = '' then raise exception 'Please give a reason'; end if;
  chk := _leave_check(v_me, p_type, p_from, p_to, p_half, p_period, p_requested_weeks);
  if not (chk->>'ok')::boolean then raise exception '%', chk->>'error'; end if;

  if (chk->>'lop_days')::numeric > 0 and not p_accept_lop then
    return jsonb_build_object('status', 'needs_lop', 'shortfall', (chk->>'lop_days')::numeric, 'plan', chk);
  end if;
  if (chk->>'needs_certificate')::boolean then
    if p_certificate_path is null or not exists (select 1 from medical_certificates c
        where c.path = p_certificate_path and c.owner_sub = current_sub() and c.path like current_sub() || '/%') then
      raise exception 'A medical certificate is required for sick leave over 2 working days. Upload it first.';
    end if;
  end if;

  v_routed := (chk->>'routed_to_hr')::boolean;
  select * into mgr from employees where id = e.manager_id;
  if v_routed then
    if e.is_hr_admin then v_approver := e.manager_id; v_routed := false;   -- H4: HR's own leave goes to their manager
    else v_approver := null; end if;
  else
    v_approver := e.manager_id;
    if v_approver is not null and mgr.last_working_day is not null and mgr.last_working_day < ist_today() then
      v_approver := null; v_routed := true;                                -- manager has left: HR queue (H8)
    end if;
  end if;
  if v_approver is null and not v_routed then                              -- H3: nobody above: auto-approve
    v_auto := true; v_status := 'Approved'; v_comment := 'Auto-approved: no reporting manager';
  end if;
  if v_routed and e.is_hr_admin then raise exception 'No one can approve this request'; end if;

  insert into leave_requests (employee_id, approver_id, routed_to_hr, leave_type, from_date, to_date, status, is_half_day,
      half_day_period, applicant_reason, approver_comment, medical_certificate_path, auto_approved, requested_weeks, decided_at)
    values (v_me, v_approver, v_routed, p_type, p_from, (chk->>'to_date')::date, v_status, p_half, p_period,
      trim(p_reason), v_comment, p_certificate_path, v_auto, p_requested_weeks, case when v_auto then app_now() end)
    returning id into v_id;
  for l in select * from jsonb_array_elements(chk->'lines') loop
    insert into leave_request_days (leave_request_id, date, leave_type, deduction)
      values (v_id, (l->>'date')::date, l->>'leave_type', (l->>'deduction')::numeric);
  end loop;
  return jsonb_build_object('status', 'saved', 'id', v_id, 'request_status', v_status, 'routed_to_hr', v_routed,
    'approver_id', v_approver, 'lop_days', (chk->>'lop_days')::numeric);
end $$;

create function public.process_leave_request(p_id uuid, p_decision text, p_comment text default null, p_confirmed_weeks int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := me(); r leave_requests; chk jsonb; l jsonb; v_to date; touches_final boolean; d date;
begin
  if v_me is null then raise exception 'Not signed in as an active employee' using errcode = '42501'; end if;
  if p_decision not in ('Approved','Rejected') then raise exception 'Decision must be Approved or Rejected'; end if;
  select * into r from leave_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found' using errcode = '42501'; end if;
  if r.status <> 'Pending' then raise exception 'This request is no longer pending'; end if;
  if r.employee_id = v_me then raise exception 'You cannot decide your own leave' using errcode = '42501'; end if;
  touches_final := exists (select 1 from payroll_exports x where x.payroll_month between date_trunc('month', r.from_date)::date and r.to_date);
  if r.leave_type = 'ML' or r.routed_to_hr or touches_final then
    if not is_hr() then raise exception 'Only HR can decide this request' using errcode = '42501'; end if;
  elsif not (r.approver_id = v_me or is_hr()) then
    raise exception 'This request does not report to you' using errcode = '42501';
  end if;
  if p_decision = 'Rejected' and coalesce(trim(p_comment), '') = '' then raise exception 'Please give a reason for rejecting'; end if;

  if p_decision = 'Approved' and r.leave_type = 'ML' then
    if coalesce(p_confirmed_weeks, 0) not in (12, 26) then raise exception 'HR must confirm 12 or 26 weeks'; end if;
    delete from leave_request_days where leave_request_id = r.id;
    chk := _leave_check(r.employee_id, 'ML', r.from_date, r.from_date, false, null, p_confirmed_weeks, true);
    if not (chk->>'ok')::boolean then raise exception '%', chk->>'error'; end if;
    for l in select * from jsonb_array_elements(chk->'lines') loop
      insert into leave_request_days (leave_request_id, date, leave_type, deduction)
        values (r.id, (l->>'date')::date, l->>'leave_type', (l->>'deduction')::numeric);
    end loop;
    update leave_requests set confirmed_weeks = p_confirmed_weeks, to_date = (chk->>'to_date')::date where id = r.id;
  end if;

  update leave_requests set status = p_decision, approver_comment = nullif(trim(p_comment), ''), decided_at = app_now(),
    approver_id = coalesce(approver_id, v_me) where id = r.id;
  insert into audit_log (actor_id, action, target_employee_id, new_data)
    values (v_me, 'leave_' || lower(p_decision), r.employee_id, jsonb_build_object('request_id', r.id, 'comment', p_comment));

  if p_decision = 'Approved' then                                         -- L7: finalised dates become adjustments
    for d in select distinct l2.date from leave_request_days l2 where l2.leave_request_id = r.id loop
      perform _write_adjustment(r.employee_id, d, 'leave_request', r.id, 'Leave approved: ' || r.leave_type, v_me);
    end loop;
  end if;
  return jsonb_build_object('status', 'saved', 'id', r.id, 'request_status', p_decision);
end $$;

create function public.cancel_my_leave(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := me(); r leave_requests;
begin
  select * into r from leave_requests where id = p_id and employee_id = v_me for update;
  if r.id is null then raise exception 'Request not found' using errcode = '42501'; end if;
  if r.status = 'Pending' or (r.status = 'Approved' and r.from_date >= ist_today()) then
    update leave_requests set status = 'Cancelled', decided_at = app_now() where id = r.id;
    insert into audit_log (actor_id, action, target_employee_id, new_data)
      values (v_me, 'leave_cancelled', v_me, jsonb_build_object('request_id', r.id));
    return jsonb_build_object('status', 'saved', 'id', r.id, 'request_status', 'Cancelled');
  end if;
  raise exception 'This leave has already started or is closed; ask HR to shorten it';
end $$;

-- I2: HR shortens an approved request whose first day has passed. Audited; finalised dates become adjustments.
create function public.hr_shorten_leave(p_id uuid, p_new_to date, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := me(); r leave_requests; d date; dropped date[];
begin
  if not is_hr() then raise exception 'HR only' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  select * into r from leave_requests where id = p_id for update;
  if r.id is null or r.status <> 'Approved' then raise exception 'Only an approved request can be shortened'; end if;
  if r.employee_id = v_me then raise exception 'You cannot change your own leave' using errcode = '42501'; end if;
  if p_new_to < r.from_date or p_new_to >= r.to_date then raise exception 'The new end date must be inside the leave'; end if;
  select array_agg(date) into dropped from leave_request_days where leave_request_id = r.id and date > p_new_to;
  delete from leave_request_days where leave_request_id = r.id and date > p_new_to;
  update leave_requests set to_date = p_new_to where id = r.id;
  insert into audit_log (actor_id, action, target_employee_id, old_data, new_data)
    values (v_me, 'leave_shortened', r.employee_id, jsonb_build_object('to_date', r.to_date), jsonb_build_object('to_date', p_new_to, 'reason', p_reason));
  foreach d in array coalesce(dropped, '{}') loop
    perform _write_adjustment(r.employee_id, d, 'leave_change', r.id, 'Leave shortened: ' || p_reason, v_me);
  end loop;
  return jsonb_build_object('status', 'saved', 'id', r.id);
end $$;

grant execute on function public.preview_leave(text,date,date,boolean,text,int), public.upload_certificate(uuid,text,bytea),
  public.apply_leave(text,date,date,boolean,text,text,text,boolean,int), public.process_leave_request(uuid,text,text,int),
  public.cancel_my_leave(uuid), public.hr_shorten_leave(uuid,date,text) to authenticated;

-- ===== db/migrations/0004_attendance.sql =====
-- Attendance: punches use the server clock and the IST date only (CLAUDE.md rule 1).

create function public.punch_clock(p_type text, p_is_wfh boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := me(); today date := ist_today(); a attendance;
begin
  if v_me is null then raise exception 'Not signed in as an active employee' using errcode = '42501'; end if;
  if p_type = 'in' then
    insert into attendance (employee_id, date, check_in, is_wfh) values (v_me, today, app_now(), coalesce(p_is_wfh, false))
      on conflict (employee_id, date) do nothing;
  elsif p_type = 'out' then
    update attendance set check_out = app_now() where employee_id = v_me and date = today and check_out is null and check_in is not null;
    if not exists (select 1 from attendance where employee_id = v_me and date = today and check_in is not null) then
      raise exception 'Check in first';
    end if;
  else
    raise exception 'type must be in or out';
  end if;
  select * into a from attendance where employee_id = v_me and date = today;
  return jsonb_build_object('status', 'saved', 'date', a.date, 'check_in', a.check_in, 'check_out', a.check_out, 'is_wfh', a.is_wfh,
    'late', (a.check_in at time zone 'Asia/Kolkata')::time >= time '10:16:00');
end $$;

create function public.request_regularisation(p_date date, p_in timestamptz, p_out timestamptz, p_reason text, p_employee uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me uuid := me(); v_emp uuid := coalesce(p_employee, me()); t employees; v_approver uuid; v_id uuid;
begin
  if v_me is null then raise exception 'Not signed in as an active employee' using errcode = '42501'; end if;
  select * into t from employees where id = v_emp;
  if t.id is null then raise exception 'Employee not found'; end if;
  if v_emp <> v_me and not is_manager_of(v_emp) then raise exception 'Only the employee or their manager can raise this' using errcode = '42501'; end if;
  if p_date > ist_today() then raise exception 'You cannot regularise a future date'; end if;
  if p_date < t.doj or (t.last_working_day is not null and p_date > t.last_working_day) then raise exception 'That date is outside the employment period'; end if;
  if p_out is null or p_in is null or p_out <= p_in then raise exception 'Check-out must be after check-in'; end if;
  if (p_in at time zone 'Asia/Kolkata')::date <> p_date then raise exception 'Check-in must be on %', to_char(p_date, 'DD Mon YYYY'); end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Please give a reason'; end if;
  if exists (select 1 from regularisation_requests where employee_id = v_emp and attendance_date = p_date and status = 'Pending') then
    raise exception 'A request for % is already pending', to_char(p_date, 'DD Mon YYYY');
  end if;

  if v_emp <> v_me then v_approver := null;                      -- manager-raised: HR approves (J13)
  elsif _month_closed(p_date) then
    if t.is_hr_admin then
      v_approver := t.manager_id;                                 -- J12 narrow exception
      if v_approver is null then raise exception 'The HR Admin has no reporting manager to approve this'; end if;
    else v_approver := null; end if;                              -- closed month: HR only
  else v_approver := t.manager_id; end if;                        -- null manager (MD): HR queue

  insert into regularisation_requests (employee_id, attendance_date, requested_by, requested_in, requested_out, reason, approver_id)
    values (v_emp, p_date, v_me, p_in, p_out, trim(p_reason), v_approver) returning id into v_id;
  return jsonb_build_object('status', 'saved', 'id', v_id);
end $$;

-- Writes the corrected punches; old punches go to audit_log in the same transaction (J10).
create function public._apply_punches(p_emp uuid, p_date date, p_in timestamptz, p_out timestamptz, p_actor uuid,
  p_source_type text, p_source_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare old attendance;
begin
  select * into old from attendance where employee_id = p_emp and date = p_date;
  insert into audit_log (actor_id, action, target_employee_id, old_data, new_data)
    values (p_actor, 'attendance_corrected', p_emp,
      jsonb_build_object('date', p_date, 'check_in', old.check_in, 'check_out', old.check_out),
      jsonb_build_object('date', p_date, 'check_in', p_in, 'check_out', p_out, 'reason', p_reason, 'source', p_source_type));
  insert into attendance (employee_id, date, check_in, check_out) values (p_emp, p_date, p_in, p_out)
    on conflict (employee_id, date) do update set check_in = excluded.check_in, check_out = excluded.check_out;
  perform _write_adjustment(p_emp, p_date, p_source_type, p_source_id, p_reason, p_actor);
end $$;

create function public.process_regularisation(p_id uuid, p_decision text, p_comment text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := me(); r regularisation_requests; t employees; closed boolean;
begin
  if v_me is null then raise exception 'Not signed in as an active employee' using errcode = '42501'; end if;
  if p_decision not in ('Approved','Rejected') then raise exception 'Decision must be Approved or Rejected'; end if;
  select * into r from regularisation_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found' using errcode = '42501'; end if;
  if r.status <> 'Pending' then raise exception 'This request is no longer pending'; end if;
  if r.employee_id = v_me then raise exception 'You cannot decide your own correction' using errcode = '42501'; end if;
  select * into t from employees where id = r.employee_id;
  closed := _month_closed(r.attendance_date);
  if closed and t.is_hr_admin then
    raise exception 'The HR Admin''s own correction for a closed month is approved by their reporting manager' using errcode = '42501';
  end if;
  if not (is_hr() or (r.approver_id = v_me and r.requested_by = r.employee_id and not closed)) then
    raise exception 'You cannot decide this request' using errcode = '42501';
  end if;
  if p_decision = 'Rejected' and coalesce(trim(p_comment), '') = '' then raise exception 'Please give a reason for rejecting'; end if;

  update regularisation_requests set status = p_decision, approver_comment = nullif(trim(p_comment), ''),
    approver_id = coalesce(approver_id, v_me), decided_at = app_now() where id = r.id;
  if p_decision = 'Approved' then
    perform _apply_punches(r.employee_id, r.attendance_date, r.requested_in, r.requested_out, v_me, 'regularisation', r.id, r.reason);
  end if;
  return jsonb_build_object('status', 'saved', 'id', r.id, 'request_status', p_decision);
end $$;

create function public.approve_hr_admin_own_correction(p_id uuid, p_comment text default null, p_decision text default 'Approved') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := me(); r regularisation_requests; t employees;
begin
  if v_me is null then raise exception 'Not signed in as an active employee' using errcode = '42501'; end if;
  select * into r from regularisation_requests where id = p_id for update;
  if r.id is null or r.status <> 'Pending' then raise exception 'Request not found or no longer pending'; end if;
  select * into t from employees where id = r.employee_id;
  if not t.is_hr_admin or not _month_closed(r.attendance_date) or t.manager_id is distinct from v_me or v_me = t.id then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update regularisation_requests set status = p_decision, approver_comment = nullif(trim(p_comment), ''), approver_id = v_me, decided_at = app_now()
    where id = r.id;
  insert into audit_log (actor_id, action, target_employee_id, new_data)
    values (v_me, 'hr_admin_own_correction_' || lower(p_decision), t.id, jsonb_build_object('request_id', r.id, 'date', r.attendance_date));
  if p_decision = 'Approved' then
    perform _apply_punches(r.employee_id, r.attendance_date, r.requested_in, r.requested_out, v_me, 'regularisation', r.id, r.reason);
  end if;
  return jsonb_build_object('status', 'saved', 'id', r.id, 'request_status', p_decision);
end $$;

create function public.hr_correct_attendance(p_emp uuid, p_date date, p_in timestamptz, p_out timestamptz, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := me();
begin
  if not is_hr() then raise exception 'HR only' using errcode = '42501'; end if;
  if p_emp = v_me then raise exception 'You cannot correct your own record; raise a regularisation' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  if p_out is null or p_in is null or p_out <= p_in then raise exception 'Check-out must be after check-in'; end if;
  if p_date > ist_today() then raise exception 'You cannot correct a future date'; end if;
  perform _apply_punches(p_emp, p_date, p_in, p_out, v_me, 'hr_correction', gen_random_uuid(), trim(p_reason));
  return jsonb_build_object('status', 'saved');
end $$;

grant execute on function public.punch_clock(text,boolean), public.request_regularisation(date,timestamptz,timestamptz,text,uuid),
  public.process_regularisation(uuid,text,text), public.approve_hr_admin_own_correction(uuid,text,text),
  public.hr_correct_attendance(uuid,date,timestamptz,timestamptz,text) to authenticated;

-- ===== db/migrations/0005_employees_admin.sql =====
-- Employees, statutory data, holidays, settings. All writes go through these functions (CLAUDE.md rule 6).

create function public.link_my_account() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sub text := current_sub(); v_email text := jwt_claim('email'); e employees;
begin
  if v_sub is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into e from employees where clerk_user_id = v_sub;
  if e.id is null then
    if v_email is null then raise exception 'Your sign-in token has no email address' using errcode = '42501'; end if;
    update employees set clerk_user_id = v_sub where lower(email) = lower(v_email) and clerk_user_id is null returning * into e;
    if e.id is null then raise exception 'No employee record matches this email. Ask HR to add you.' using errcode = '42501'; end if;
    insert into audit_log (actor_id, action, target_employee_id, new_data) values (e.id, 'account_linked', e.id, '{}');
  end if;
  if e.last_working_day is not null and e.last_working_day < ist_today() then
    return jsonb_build_object('active', false, 'last_working_day', e.last_working_day, 'first_name', e.first_name);
  end if;
  return jsonb_build_object('active', true, 'id', e.id, 'first_name', e.first_name, 'is_hr_admin', e.is_hr_admin,
    'is_manager', is_manager(), 'location_id', e.location_id);
end $$;

create function public.get_my_manager() returns table (name text, designation text)
language sql stable security definer set search_path = public as $$
  select m.first_name || ' ' || m.last_name, m.designation from employees e join employees m on m.id = e.manager_id where e.id = me()
$$;

create function public._mask(v text, keep int default 4) returns text language sql immutable as $$
  select case when v is null then null else repeat('X', greatest(length(v) - keep, 0)) || right(v, keep) end
$$;

create function public.get_sensitive_masked(p_emp uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s employee_sensitive;
begin
  if not (p_emp = me() or is_hr()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into s from employee_sensitive where employee_id = p_emp;
  if s.employee_id is null then return null; end if;
  return jsonb_build_object('pan', _mask(s.pan_number), 'aadhaar', _mask(s.aadhaar_number), 'uan', _mask(s.uan_number),
    'bank_name', s.bank_name, 'bank_account', _mask(s.bank_account), 'ifsc', _mask(s.ifsc, 4));
end $$;

create function public.reveal_sensitive(p_emp uuid, p_field text) returns text
language plpgsql security definer set search_path = public as $$
declare v text; v_me uuid := me();
begin
  if not is_hr() then raise exception 'HR only' using errcode = '42501'; end if;
  if p_field not in ('pan_number','aadhaar_number','uan_number','bank_account','ifsc') then raise exception 'Unknown field'; end if;
  execute format('select %I from employee_sensitive where employee_id = $1', p_field) into v using p_emp;
  insert into audit_log (actor_id, action, target_employee_id, new_data) values (v_me, 'reveal', p_emp, jsonb_build_object('field', p_field));
  return v;
end $$;

create function public.hr_add_employee(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := me(); v_id uuid; v_code text; mgr employees;
begin
  if not is_hr() then raise exception 'HR only' using errcode = '42501'; end if;
  if nullif(p->>'manager_id', '') is not null then
    select * into mgr from employees where id = (p->>'manager_id')::uuid;
    if mgr.id is null or (mgr.last_working_day is not null and mgr.last_working_day < ist_today()) then
      raise exception 'The reporting manager must be an active employee';
    end if;
  end if;
  insert into employees (first_name, last_name, email, mobile, gender, address_line, city, address_pin, address_state, doj, dob,
      designation, location_id, department_id, manager_id)
    values (p->>'first_name', p->>'last_name', p->>'email', p->>'mobile', p->>'gender', p->>'address_line', p->>'city',
      p->>'address_pin', p->>'address_state', (p->>'doj')::date, (p->>'dob')::date, p->>'designation',
      (p->>'location_id')::uuid, (p->>'department_id')::uuid, nullif(p->>'manager_id', '')::uuid)
    returning id, employee_code into v_id, v_code;
  insert into employee_sensitive (employee_id, pan_number, aadhaar_number, uan_number, bank_name, bank_account, ifsc)
    values (v_id, p->>'pan_number', p->>'aadhaar_number', nullif(p->>'uan_number', ''), p->>'bank_name', p->>'bank_account', p->>'ifsc');
  insert into employee_emergency (employee_id, blood_group, emergency_contact_name, emergency_contact_phone)
    values (v_id, nullif(p->>'blood_group', ''), p->>'emergency_contact_name', p->>'emergency_contact_phone');
  insert into audit_log (actor_id, action, target_employee_id, new_data)
    values (v_me, 'employee_added', v_id, jsonb_build_object('employee_code', v_code));
  return jsonb_build_object('status', 'saved', 'id', v_id, 'employee_code', v_code);
end $$;

create function public.hr_update_employee_job(p_emp uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := me(); o employees; n employees; mgr employees;
begin
  if not is_hr() then raise exception 'HR only' using errcode = '42501'; end if;
  select * into o from employees where id = p_emp for update;
  if o.id is null then raise exception 'Employee not found'; end if;
  if p ? 'manager_id' and p_emp = v_me then raise exception 'You cannot change your own reporting line' using errcode = '42501'; end if;
  if nullif(p->>'manager_id', '') is not null then
    select * into mgr from employees where id = (p->>'manager_id')::uuid;
    if mgr.id is null or (mgr.last_working_day is not null and mgr.last_working_day < ist_today()) then
      raise exception 'The reporting manager must be an active employee';
    end if;
  end if;
  update employees set
    designation = coalesce(p->>'designation', designation),
    department_id = coalesce((p->>'department_id')::uuid, department_id),
    location_id = coalesce((p->>'location_id')::uuid, location_id),
    manager_id = case when p ? 'manager_id' then nullif(p->>'manager_id', '')::uuid else manager_id end
    where id = p_emp returning * into n;
  insert into audit_log (actor_id, action, target_employee_id, old_data, new_data) values (v_me, 'job_edit', p_emp,
    jsonb_build_object('designation', o.designation, 'department_id', o.department_id, 'location_id', o.location_id, 'manager_id', o.manager_id),
    jsonb_build_object('designation', n.designation, 'department_id', n.department_id, 'location_id', n.location_id, 'manager_id', n.manager_id));
  return jsonb_build_object('status', 'saved');
end $$;

create function public.hr_deactivate_employee(p_emp uuid, p_last_day date, p_new_manager uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := me(); e employees; r leave_requests; n_reports int;
begin
  if not is_hr() then raise exception 'HR only' using errcode = '42501'; end if;
  if p_emp = v_me then raise exception 'You cannot deactivate yourself' using errcode = '42501'; end if;
  select * into e from employees where id = p_emp for update;
  if e.id is null then raise exception 'Employee not found'; end if;
  if p_last_day < e.doj then raise exception 'The last working day is before the joining date'; end if;
  select count(*) into n_reports from employees x where x.manager_id = p_emp and (x.last_working_day is null or x.last_working_day >= ist_today());
  if n_reports > 0 then
    if p_new_manager is null or p_new_manager = p_emp then raise exception 'Choose a new manager for % direct report(s) first', n_reports; end if;
    update employees set manager_id = p_new_manager where manager_id = p_emp and (last_working_day is null or last_working_day >= ist_today());
  end if;
  update employees set last_working_day = p_last_day where id = p_emp;
  -- I3: leave after the last working day is cancelled automatically
  for r in select * from leave_requests where employee_id = p_emp and status in ('Pending','Approved') and to_date > p_last_day loop
    delete from leave_request_days where leave_request_id = r.id and date > p_last_day;
    if r.from_date > p_last_day then update leave_requests set status = 'Cancelled', decided_at = app_now() where id = r.id;
    else update leave_requests set to_date = p_last_day where id = r.id; end if;
  end loop;
  -- pending items that waited on this person move to HR (H8)
  update leave_requests set approver_id = null, routed_to_hr = true where approver_id = p_emp and status = 'Pending';
  update regularisation_requests set approver_id = null where approver_id = p_emp and status = 'Pending';
  insert into audit_log (actor_id, action, target_employee_id, old_data, new_data) values (v_me, 'deactivate', p_emp,
    jsonb_build_object('last_working_day', e.last_working_day), jsonb_build_object('last_working_day', p_last_day, 'new_manager', p_new_manager));
  return jsonb_build_object('status', 'saved');
end $$;

create function public.update_my_contact(p_mobile text, p_address_line text, p_city text, p_pin text, p_state text,
  p_ec_name text, p_ec_phone text, p_blood_group text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := me();
begin
  if v_me is null then raise exception 'Not signed in as an active employee' using errcode = '42501'; end if;
  update employees set mobile = p_mobile, address_line = p_address_line, city = p_city, address_pin = p_pin, address_state = p_state where id = v_me;
  update employee_emergency set emergency_contact_name = p_ec_name, emergency_contact_phone = p_ec_phone, blood_group = nullif(p_blood_group, '')
    where employee_id = v_me;
  insert into audit_log (actor_id, action, target_employee_id, new_data) values (v_me, 'contact_edit', v_me, '{}');
  return jsonb_build_object('status', 'saved');
end $$;

-- ---------- holidays and settings (L8: locked for finalised payroll months) ----------
create function public._holiday_lock() returns trigger language plpgsql as $$
declare dts date[] := array[]::date[];
begin
  if tg_op in ('UPDATE','DELETE') then dts := dts || old.date; end if;
  if tg_op in ('UPDATE','INSERT') then dts := dts || new.date; end if;
  if exists (select 1 from payroll_exports x where x.payroll_month = any (select date_trunc('month', d)::date from unnest(dts) d)) then
    raise exception 'That month is already finalised; holidays in it cannot change' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger holidays_lock before insert or update or delete on public.holidays for each row execute function public._holiday_lock();

create function public.hr_upsert_holiday(p_location uuid, p_date date, p_name text, p_type text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_hr() then raise exception 'HR only' using errcode = '42501'; end if;
  insert into holidays (location_id, date, name, type) values (p_location, p_date, p_name, p_type)
    on conflict (location_id, date) do update set name = excluded.name, type = excluded.type;
  insert into audit_log (actor_id, action, new_data) values (me(), 'holiday_upsert', jsonb_build_object('location_id', p_location, 'date', p_date, 'name', p_name, 'type', p_type));
  return jsonb_build_object('status', 'saved');
end $$;

create function public.hr_delete_holiday(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_hr() then raise exception 'HR only' using errcode = '42501'; end if;
  delete from holidays where id = p_id;
  insert into audit_log (actor_id, action, new_data) values (me(), 'holiday_delete', jsonb_build_object('id', p_id));
  return jsonb_build_object('status', 'saved');
end $$;

create function public.hr_set_leave_settings(p_code text, p_year int, p_quota numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_hr() then raise exception 'HR only' using errcode = '42501'; end if;
  if exists (select 1 from payroll_exports x where extract(year from x.payroll_month) = p_year) then
    raise exception 'A month of % is already finalised; leave settings for that year are locked', p_year using errcode = '42501';
  end if;
  insert into leave_type_year_settings (leave_type_code, year, annual_quota) values (p_code, p_year, p_quota)
    on conflict (leave_type_code, year) do update set annual_quota = excluded.annual_quota;
  insert into audit_log (actor_id, action, new_data) values (me(), 'leave_settings', jsonb_build_object('code', p_code, 'year', p_year, 'quota', p_quota));
  return jsonb_build_object('status', 'saved');
end $$;

create function public.hr_set_opening_balance(p_emp uuid, p_year int, p_type text, p_balance numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_hr() then raise exception 'HR only' using errcode = '42501'; end if;
  insert into leave_opening_balances (employee_id, year, leave_type, opening_balance) values (p_emp, p_year, p_type, p_balance)
    on conflict (employee_id, year, leave_type) do update set opening_balance = excluded.opening_balance;
  insert into audit_log (actor_id, action, target_employee_id, new_data) values (me(), 'opening_balance', p_emp, jsonb_build_object('year', p_year, 'type', p_type, 'balance', p_balance));
  return jsonb_build_object('status', 'saved');
end $$;

create function public.hr_upsert_policy(p_title text, p_content text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_hr() then raise exception 'HR only' using errcode = '42501'; end if;
  insert into company_policies (title, content_markdown, last_updated_by) values (p_title, p_content, me())
    on conflict (title) do update set content_markdown = excluded.content_markdown, last_updated_at = app_now(), last_updated_by = me();
  insert into audit_log (actor_id, action, new_data) values (me(), 'policy_edit', jsonb_build_object('title', p_title));
  return jsonb_build_object('status', 'saved');
end $$;

grant execute on function public.link_my_account(), public.get_my_manager(), public.get_sensitive_masked(uuid), public.reveal_sensitive(uuid,text),
  public.hr_add_employee(jsonb), public.hr_update_employee_job(uuid,jsonb), public.hr_deactivate_employee(uuid,date,uuid),
  public.update_my_contact(text,text,text,text,text,text,text,text), public.hr_upsert_holiday(uuid,date,text,text),
  public.hr_delete_holiday(uuid), public.hr_set_leave_settings(text,int,numeric), public.hr_set_opening_balance(uuid,int,text,numeric),
  public.hr_upsert_policy(text,text) to authenticated;

-- ===== db/migrations/0006_payroll.sql =====
-- Month-end summary, finalising and payroll adjustments (rules L1-L9). Insert-only tables, one transaction.

-- Day buckets plus the Late marker, as stored in snapshots.
create function public._day_buckets(p_emp uuid, d date) returns jsonb
language sql stable security definer set search_path = public as $$
  select i->'buckets' || case when (i->>'late')::boolean then '{"Late":1}'::jsonb else '{}'::jsonb end
  from (select _day_info(p_emp, d) as i) x
$$;

create function public._next_open_month(m date) returns date
language plpgsql stable security definer set search_path = public as $$
declare n date := (date_trunc('month', m) + interval '1 month')::date;
begin
  while exists (select 1 from payroll_exports where payroll_month = n) loop n := (n + interval '1 month')::date; end loop;
  return n;
end $$;

-- L7: a correction to a finalised month becomes one adjustment measured against the last payroll-accounted state.
create function public._write_adjustment(p_emp uuid, d date, p_source_type text, p_source_id uuid, p_reason text, p_by uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', d)::date; prev jsonb; nw jsonb; deltas jsonb := '{}'::jsonb; k text; dv numeric; lop numeric;
begin
  if not exists (select 1 from payroll_exports where payroll_month = m) then return; end if;
  select new_buckets into prev from payroll_adjustments where employee_id = p_emp and attendance_date = d order by seq desc limit 1;
  if prev is null then select buckets into prev from payroll_month_snapshots where employee_id = p_emp and date = d; end if;
  prev := coalesce(prev, '{}'::jsonb);
  nw := _day_buckets(p_emp, d);
  for k in select distinct key from (select jsonb_object_keys(prev) key union select jsonb_object_keys(nw)) s loop
    dv := coalesce((nw->>k)::numeric, 0) - coalesce((prev->>k)::numeric, 0);
    if dv <> 0 then deltas := deltas || jsonb_build_object(k, dv); end if;
  end loop;
  if deltas = '{}'::jsonb then return; end if;
  lop := coalesce((deltas->>'Absent')::numeric, 0) + coalesce((deltas->>'LOP_leave')::numeric, 0);
  insert into payroll_adjustments (employee_id, attendance_date, payroll_month, source_type, source_id, previous_buckets, new_buckets,
      bucket_deltas, lop_delta, reason, approved_by)
    values (p_emp, d, _next_open_month(m), p_source_type, p_source_id, prev, nw, deltas, lop, p_reason, p_by)
    on conflict (source_type, source_id, attendance_date) do nothing;
end $$;

create function public._fmt(n numeric) returns text language sql immutable as $$ select to_char(coalesce(n, 0), 'FM9999990.0') $$;
create function public._csv(t text) returns text language sql immutable as $$
  select case when t ~ '[",\n]' then '"' || replace(t, '"', '""') || '"' else coalesce(t, '') end
$$;

create function public._month_rows(p_month date, p_ids uuid[])
returns table (employee_id uuid, employee_code text, name text, location text, buckets jsonb, late_marks int, late_lop numeric,
               total_lop numeric, adjustment_lop numeric, adjustment_detail text, provisional boolean)
language plpgsql stable security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; mend date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
        fin boolean := exists (select 1 from payroll_exports where payroll_month = date_trunc('month', p_month)::date);
        e record; b jsonb; lates int; adj numeric; det text;
begin
  for e in select x.id, x.employee_code, x.first_name || ' ' || x.last_name as nm, l.name as loc from employees x join locations l on l.id = x.location_id
           where x.id = any (p_ids) and x.doj <= mend and (x.last_working_day is null or x.last_working_day >= m) order by x.employee_code loop
    if fin then
      select coalesce(jsonb_object_agg(k, s), '{}'::jsonb) into b from (
        select kv.key k, sum(kv.value::numeric) s from payroll_month_snapshots sn, jsonb_each_text(sn.buckets) kv
        where sn.employee_id = e.id and sn.date between m and mend group by kv.key) q;
    else
      select coalesce(jsonb_object_agg(k, s), '{}'::jsonb) into b from (
        select kv.key k, sum(kv.value::numeric) s from generate_series(m, mend, interval '1 day') g,
          lateral jsonb_each_text(_day_buckets(e.id, g::date)) kv group by kv.key) q;
    end if;
    lates := coalesce((b->>'Late')::numeric, 0)::int;
    select coalesce(sum(a.lop_delta), 0),
           string_agg(to_char(a.attendance_date, 'DD Mon') || ' ' || a.reason || ' (' || (
             select string_agg(kv.key || ' ' || case when kv.value::numeric > 0 then '+' else '' end || _fmt(kv.value::numeric), ', ' order by kv.key)
             from jsonb_each_text(a.bucket_deltas) kv) || ')', '; ' order by a.attendance_date, a.seq)
      into adj, det from payroll_adjustments a where a.employee_id = e.id and a.payroll_month = m;
    employee_id := e.id; employee_code := e.employee_code; name := e.nm; location := e.loc; buckets := b;
    late_marks := lates; late_lop := floor(lates / 3.0) * 0.5;
    total_lop := coalesce((b->>'Absent')::numeric, 0) + coalesce((b->>'LOP_leave')::numeric, 0) + late_lop;
    adjustment_lop := adj; adjustment_detail := det; provisional := not fin and not _month_closed(m);
    return next;
  end loop;
end $$;

create function public._build_csv(p_month date, p_ids uuid[]) returns text
language plpgsql stable security definer set search_path = public as $$
declare r record; out text; cols text[] := array['Present','WFH','CL','SL','EL','ML','PL','OH','LOP_leave','Absent','Holidays','Weekly_offs','Pending'];
        c text; line text; st text;
begin
  out := 'Employee_code,Name,Location,' || array_to_string(cols, ',') || ',Late_marks,Late_LOP,Total_LOP,Adjustment_LOP,Adjustment_detail,Net_LOP,Status' || E'\n';
  for r in select * from _month_rows(p_month, p_ids) order by employee_code loop
    line := _csv(r.employee_code) || ',' || _csv(r.name) || ',' || _csv(r.location);
    foreach c in array cols loop line := line || ',' || _fmt((r.buckets->>c)::numeric); end loop;
    st := case when r.provisional then 'Provisional' else 'Final' end;
    line := line || ',' || r.late_marks || ',' || _fmt(r.late_lop) || ',' || _fmt(r.total_lop) || ',' || _fmt(r.adjustment_lop) || ','
            || _csv(coalesce(r.adjustment_detail, '')) || ',' || _fmt(r.total_lop + coalesce(r.adjustment_lop, 0)) || ',' || st;
    out := out || line || E'\n';
  end loop;
  return out;
end $$;

-- L9: managers get direct reports only, built from authorised rows.
create function public.get_team_month_summary(p_month date)
returns table (employee_id uuid, employee_code text, name text, location text, buckets jsonb, late_marks int, late_lop numeric,
               total_lop numeric, adjustment_lop numeric, adjustment_detail text, provisional boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if me() is null then raise exception 'Not signed in as an active employee' using errcode = '42501'; end if;
  if not is_manager() then raise exception 'Only managers have a team summary' using errcode = '42501'; end if;
  return query select * from _month_rows(p_month, (select coalesce(array_agg(id), '{}') from employees where manager_id = me()));
end $$;

create function public.hr_month_summary(p_month date)
returns table (employee_id uuid, employee_code text, name text, location text, buckets jsonb, late_marks int, late_lop numeric,
               total_lop numeric, adjustment_lop numeric, adjustment_detail text, provisional boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_hr() then raise exception 'HR only' using errcode = '42501'; end if;
  return query select * from _month_rows(p_month, (select coalesce(array_agg(id), '{}') from employees));
end $$;

-- HR's provisional or final CSV text (the stored export is returned for a finalised month).
create function public.hr_month_csv(p_month date) returns text
language plpgsql stable security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; t text;
begin
  if not is_hr() then raise exception 'HR only' using errcode = '42501'; end if;
  select csv_content into t from payroll_exports where payroll_month = m;
  if t is not null then return t; end if;
  return _build_csv(m, (select array_agg(id) from employees));
end $$;

-- Month-end readiness for the HR dashboard.
create function public.hr_month_readiness(p_month date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; mend date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
begin
  if not is_hr() then raise exception 'HR only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'month', m, 'closed', _month_closed(m), 'finalised', exists (select 1 from payroll_exports where payroll_month = m),
    'pending_leave', (select count(*) from leave_requests where status = 'Pending' and from_date <= mend and to_date >= m),
    'pending_regularisations', (select count(*) from regularisation_requests where status = 'Pending' and attendance_date between m and mend),
    'missing_checkouts', (select count(*) from attendance where date between m and mend and check_in is not null and check_out is null and date < ist_today()));
end $$;

create function public.hr_finalise_month(p_month date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; mend date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
        v_me uuid := me(); v_csv text; v_id uuid; v_sum text;
begin
  if not is_hr() then raise exception 'HR only' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('payroll_month:' || m::text));
  if not _month_closed(m) then raise exception '% has not closed yet', to_char(m, 'FMMonth YYYY'); end if;
  if exists (select 1 from payroll_exports where payroll_month = m) then
    raise exception '% is already finalised; corrections now appear as adjustments in %', to_char(m, 'FMMonth'), to_char(_next_open_month(m), 'FMMonth');
  end if;
  v_csv := _build_csv(m, (select array_agg(id) from employees));
  v_sum := encode(sha256(convert_to(v_csv, 'UTF8')), 'hex');
  insert into payroll_exports (payroll_month, csv_content, checksum, finalised_by) values (m, v_csv, v_sum, v_me) returning id into v_id;
  insert into payroll_month_snapshots (employee_id, date, export_id, buckets)
    select e.id, g::date, v_id, _day_buckets(e.id, g::date)
    from employees e, generate_series(m, mend, interval '1 day') g
    where e.doj <= g::date and (e.last_working_day is null or e.last_working_day >= g::date);
  insert into audit_log (actor_id, action, new_data) values (v_me, 'month_finalised', jsonb_build_object('month', m, 'checksum', v_sum));
  return jsonb_build_object('status', 'saved', 'export_id', v_id, 'checksum', v_sum);
end $$;

grant execute on function public.get_team_month_summary(date), public.hr_month_summary(date), public.hr_month_csv(date),
  public.hr_month_readiness(date), public.hr_finalise_month(date) to authenticated;

-- ===== db/migrations/0007_agent.sql =====
-- Agent: question cap (30 per IST day), atomic tool-slot reservation (5 per question), read-only tool queries.

create function public.agent_start_question() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := me(); today date := ist_today(); n int; v_id uuid;
begin
  if v_me is null then raise exception 'Not signed in as an active employee' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('agent_q:' || v_me::text));
  select coalesce(max(seq), 0) into n from agent_questions where user_id = v_me and ist_date = today;
  if n >= 30 then raise exception 'You have used all 30 questions for today. The count resets at midnight IST.' using errcode = 'P0429'; end if;
  insert into agent_questions (user_id, ist_date, seq) values (v_me, today, n + 1) returning id into v_id;
  return v_id;
end $$;

create function public.agent_reserve_slot(p_question uuid, p_tool text, p_inputs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := me(); q agent_questions; n int; v_id uuid;
begin
  select * into q from agent_questions where id = p_question and user_id = v_me for update;     -- serialises parallel calls
  if q.id is null then raise exception 'Unknown question' using errcode = '42501'; end if;
  select count(*) into n from agent_log where question_id = p_question and slot is not null;
  if n >= 5 then
    insert into agent_log (user_id, question_id, slot, tool_name, inputs, status) values (v_me, p_question, null, p_tool, p_inputs, 'limit_exceeded')
      returning id into v_id;
    return jsonb_build_object('allowed', false, 'log_id', v_id);
  end if;
  insert into agent_log (user_id, question_id, slot, tool_name, inputs) values (v_me, p_question, n + 1, p_tool, p_inputs) returning id into v_id;
  return jsonb_build_object('allowed', true, 'log_id', v_id, 'slot', n + 1);
end $$;

create function public.agent_log_denied(p_question uuid, p_tool text, p_inputs jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from agent_questions where id = p_question and user_id = me()) then raise exception 'Unknown question' using errcode = '42501'; end if;
  insert into agent_log (user_id, question_id, slot, tool_name, inputs, result, status)
    values (me(), p_question, null, p_tool, p_inputs, jsonb_build_object('error', p_reason), 'denied');
end $$;

create function public.agent_finish_call(p_log uuid, p_status text, p_result jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('ok','denied','error') then raise exception 'Bad status'; end if;
  perform set_config('app.agent_fill', 'on', true);
  update agent_log set status = p_status, result = p_result where id = p_log and user_id = me() and status = 'running';
  perform set_config('app.agent_fill', 'off', true);
end $$;

create function public.agent_team_today(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_date, ist_today());
begin
  if not (is_hr() or is_manager()) then raise exception 'Only managers and HR can see team attendance' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', e.first_name || ' ' || e.last_name, 'code', e.employee_code,
            'status', i->>'status', 'leave', i->'leave') order by e.employee_code)
    from employees e, lateral (select _day_info(e.id, d) i) x
    where e.id <> me() and (is_hr() or e.manager_id = me()) and (e.last_working_day is null or e.last_working_day >= d) and e.doj <= d), '[]'::jsonb);
end $$;

create function public.agent_pending_approvals() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_hr() or is_manager()) then raise exception 'Only managers and HR can see approvals' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'employee', e.first_name || ' ' || e.last_name, 'type', r.leave_type,
      'from', r.from_date, 'to', r.to_date, 'half_day', r.is_half_day,
      'available_balance', (select b.available from _leave_balance(r.employee_id, r.leave_type, extract(year from r.from_date)::int) b),
      'clashes', (select count(*) from leave_requests o join employees oe on oe.id = o.employee_id
                  where o.id <> r.id and o.status in ('Pending','Approved') and oe.manager_id = e.manager_id
                    and o.from_date <= r.to_date and o.to_date >= r.from_date)) order by r.from_date)
    from leave_requests r join employees e on e.id = r.employee_id
    where r.status = 'Pending' and (r.approver_id = me() or (is_hr() and (r.routed_to_hr or r.approver_id is not null)))
      and r.employee_id <> me()), '[]'::jsonb);
end $$;

grant execute on function public.agent_start_question(), public.agent_reserve_slot(uuid,text,jsonb), public.agent_log_denied(uuid,text,jsonb,text),
  public.agent_finish_call(uuid,text,jsonb), public.agent_team_today(date), public.agent_pending_approvals() to authenticated;

-- ===== db/migrations/0008_app_role.sql =====
-- The web app connects as `app_user`, a login role that is NOT the owner and cannot bypass RLS.
-- Create the role itself in the Neon console (it sets the password), then this migration wires it up.
-- Per request the app runs: BEGIN; SET LOCAL ROLE authenticated; set_config('request.jwt.claims', ..., true).
do $$ begin
  if exists (select from pg_roles where rolname = 'app_user') then
    grant authenticated to app_user;
    alter role app_user nobypassrls noinherit;
  end if;
end $$;

-- ===== db/seed.sql =====
-- Seed data matching DESIGN.md "Sample data" exactly. Run once on an empty database (as the owner).
-- 20 employees; managers worked out from reporting lines: Vikram, Anita, Sanjay.
insert into locations (id, name, city, state, weekly_off_days) values
  ('a0000000-0000-0000-0000-000000000001', 'Panaji HO', 'Panaji', 'Goa', '{0,6}'),
  ('a0000000-0000-0000-0000-000000000002', 'Verna plant', 'Verna', 'Goa', '{0}');
insert into departments (id, name) values
  ('b0000000-0000-0000-0000-000000000001', 'Management'), ('b0000000-0000-0000-0000-000000000002', 'Finance'),
  ('b0000000-0000-0000-0000-000000000003', 'Production'), ('b0000000-0000-0000-0000-000000000004', 'Quality');

insert into leave_types (code, name, accrual_method, carry_forward_max, half_day_allowed, prorate_for_joiners, count_calendar_days, certificate_after_days) values
  ('CL','Casual Leave','lump_sum',null,true,true,false,null),
  ('SL','Sick Leave','lump_sum',null,true,true,false,2),
  ('EL','Earned Leave','monthly',30,false,false,false,null),
  ('ML','Maternity Leave','on_request',null,false,false,true,null),
  ('PL','Paternity Leave','lump_sum',null,false,false,false,null),
  ('LOP','Loss of Pay','none',null,true,false,false,null),
  ('OH','Optional Holiday','lump_sum',null,false,false,false,null);
insert into leave_type_year_settings (leave_type_code, year, annual_quota) values
  ('CL',2026,8),('SL',2026,7),('EL',2026,15),('PL',2026,5),('OH',2026,2),('CL',2027,8),('SL',2027,7),('EL',2027,15),('PL',2027,5),('OH',2027,2);

insert into holidays (location_id, date, name, type)
select l, d, n, t from (values
  ('2026-01-26'::date,'Republic Day','National'),('2026-03-04','Holi','National'),('2026-08-15','Independence Day','National'),
  ('2026-10-02','Gandhi Jayanti','National'),('2026-10-20','Dussehra','Optional'),('2026-11-08','Diwali','National'),
  ('2026-12-03','Feast of St Francis Xavier','State'),('2026-12-19','Goa Liberation Day','State'),('2026-12-25','Christmas','National')
) h(d, n, t), (select id l from locations) ls;
insert into holidays (location_id, date, name, type) values
  ('a0000000-0000-0000-0000-000000000002', '2026-12-14', 'Plant maintenance shutdown', 'State');

-- people: id suffix = order number
insert into employees (id, employee_code, first_name, last_name, email, mobile, gender, address_line, city, address_pin, address_state, doj, dob,
    last_working_day, designation, is_hr_admin, location_id, department_id, manager_id)
select ('c0000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'KCF' || lpad(n::text, 4, '0'), fn, ln,
  lower(fn) || '.' || lower(ln) || case when n in (1,2,3,4,8,14) then '+clerk_test@example.com' else '@konkancoastal.example' end, '9' || lpad((876540000 + n)::text, 9, '0'), g,
  'House ' || n || ', Main Road', city, '4030' || lpad((n % 90 + 10)::text, 2, '0'), 'Goa', doj::date, dob::date,
  lwd::date, des, hr, loc, dep, case when mgr is null then null else ('c0000000-0000-0000-0000-0000000000' || lpad(mgr::text, 2, '0'))::uuid end
from (values
  (1,'Vikram','Sardesai','Male','Panaji','2015-04-01','1972-05-14',null,'Managing Director',false,'a0000000-0000-0000-0000-000000000001'::uuid,'b0000000-0000-0000-0000-000000000001'::uuid,null::int),
  (2,'Meera','Kamat','Female','Panaji','2017-06-01','1984-09-02',null,'HR Admin',true,'a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',1),
  (3,'Anita','Naik','Female','Panaji','2018-02-01','1981-03-21',null,'Finance Manager',false,'a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',1),
  (4,'Sanjay','Prabhu','Male','Verna','2016-08-16','1979-11-30',null,'Plant Manager',false,'a0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000003',1),
  (5,'Rohan','Fernandes','Male','Panaji','2019-01-07','1990-01-12',null,'Accountant',false,'a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',3),
  (6,'Divya','Shet','Female','Panaji','2020-03-02','1993-07-08',null,'Accounts Executive',false,'a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',3),
  (7,'Karan','Borkar','Male','Panaji','2021-09-01','1991-12-19',null,'Payroll Analyst',false,'a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',3),
  (8,'Priya','Desai','Female','Panaji','2022-01-03','1995-04-25',null,'Senior Accountant',false,'a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',3),
  (9,'Amit','Dessai','Male','Panaji','2022-11-14','1992-10-03',null,'Finance Executive',false,'a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',3),
  (10,'Sneha','Gaonkar','Female','Panaji','2023-04-10','1996-02-17',null,'Accounts Assistant',false,'a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',3),
  (11,'Rahul','Shirodkar','Male','Verna','2018-05-21','1988-06-27',null,'Production Supervisor',false,'a0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000003',4),
  (12,'Maria','D''Souza','Female','Verna','2019-07-08','1990-08-15',null,'Quality Lead',false,'a0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000004',4),
  (13,'Joaquim','Pereira','Male','Verna','2020-10-05','1987-01-09',null,'Machine Operator',false,'a0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000003',4),
  (14,'Suresh','Gawas','Male','Verna','2021-02-01','1989-12-02',null,'Machine Operator',false,'a0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000003',4),
  (15,'Lata','Parab','Female','Verna','2021-06-14','1994-05-22',null,'Packing Associate',false,'a0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000003',4),
  (16,'Nilesh','Chari','Male','Verna','2022-03-07','1991-09-11',null,'QC Analyst',false,'a0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000004',4),
  (17,'Fatima','Sheikh','Female','Verna','2023-08-21','1997-03-30',null,'QC Analyst',false,'a0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000004',4),
  (18,'Diogo','Rodrigues','Male','Verna','2024-01-15','1998-11-06',null,'Packing Associate',false,'a0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000003',4),
  (19,'Neha','Kerkar','Female','Panaji','2019-05-06','1992-02-14','2026-09-30','Accounts Executive',false,'a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',3),
  (20,'Tanvi','Mhamal','Female','Panaji','2025-11-03','1999-06-18',null,'Management Trainee',false,'a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',1)
) v(n, fn, ln, g, city, doj, dob, lwd, des, hr, loc, dep, mgr);
-- Anita and Sanjay report to Vikram (rule H2: a manager's leave goes to their own manager).
select setval('employee_code_seq', 20);

insert into employee_sensitive (employee_id, pan_number, aadhaar_number, uan_number, bank_name, bank_account, ifsc)
select id, 'ABCDE' || lpad((1000 + row_number() over (order by employee_code))::text, 4, '0') || 'F',
  lpad((234500000000 + row_number() over (order by employee_code))::text, 12, '0'), null, 'State Bank of India',
  lpad((30000000000 + row_number() over (order by employee_code))::text, 11, '0'), 'SBIN0001234' from employees;
insert into employee_emergency (employee_id, blood_group, emergency_contact_name, emergency_contact_phone)
select id, 'B+', 'Family contact', '9812345678' from employees;

-- Priya: 12 EL opening for 2026 (RESEARCH/DESIGN: 12 opening + 12.5 accrued - 5 used = 19.5)
insert into leave_opening_balances (employee_id, year, leave_type, opening_balance)
select id, 2026, 'EL', case when employee_code = 'KCF0008' then 12 else 6 end from employees;

insert into company_policies (title, content_markdown) values
  ('Working hours', 'Office hours are 10:00 to 19:00. A check-in at 10:16 or later is recorded as Late. Panaji works Monday to Friday; Verna works Monday to Saturday.'),
  ('Late marks', 'Every 3 Late marks in a calendar month cost 0.5 day of Loss of Pay.'),
  ('Leave', 'CL 8, SL 7 and OH 2 days are credited each 1 January. EL accrues at 1.25 days per completed month and up to 30 days carry forward. Sick leave over 2 working days needs a medical certificate. Leave can be applied up to 30 days in the past.'),
  ('Maternity and paternity leave', 'Maternity leave is 12 or 26 weeks, confirmed by HR. Paternity leave is 5 working days.');

-- ---- Priya Desai (KCF0008), October 2026, as on wireframe 01a ----
do $$
declare p uuid := 'c0000000-0000-0000-0000-000000000008'; anita uuid := 'c0000000-0000-0000-0000-000000000003'; d date; rid uuid;
begin
  for d in select g::date from generate_series('2026-10-01'::date, '2026-10-30', interval '1 day') g
           where extract(dow from g) between 1 and 5
             and g::date not in ('2026-10-02','2026-10-12','2026-10-13','2026-10-20','2026-10-21','2026-10-27') loop
    insert into attendance (employee_id, date, check_in, check_out, is_wfh)
    values (p, d,
      (d || case when d = '2026-10-06' then ' 10:20' when d = '2026-10-08' then ' 10:00' when d in ('2026-10-09','2026-10-22') then ' 10:00' else ' 09:55' end || '+05:30')::timestamptz,
      (d || case when d = '2026-10-06' then ' 19:10' when d = '2026-10-08' then ' 15:00' when d = '2026-10-09' then ' 18:30' when d = '2026-10-22' then ' 14:30' else ' 18:50' end || '+05:30')::timestamptz,
      d = '2026-10-09');
  end loop;
  insert into attendance (employee_id, date, check_in) values (p, '2026-10-27', '2026-10-27 09:58+05:30');
  insert into regularisation_requests (employee_id, attendance_date, requested_by, requested_in, requested_out, reason, approver_id)
    values (p, '2026-10-27', p, '2026-10-27 09:58+05:30', '2026-10-27 18:45+05:30', 'Forgot to check out', anita);
end $$;

create function pg_temp.seed_leave(p_type text, p_from date, p_to date, p_half boolean, p_period text, p_status text, p_days date[], p_ded numeric default 1)
returns void language plpgsql as $$
declare rid uuid; d date;
begin
  insert into leave_requests (employee_id, approver_id, leave_type, from_date, to_date, status, is_half_day, half_day_period, applicant_reason, decided_at)
    values ('c0000000-0000-0000-0000-000000000008', 'c0000000-0000-0000-0000-000000000003', p_type, p_from, p_to, p_status, p_half, p_period,
            'Seeded', case when p_status = 'Approved' then p_from::timestamptz - interval '3 days' end) returning id into rid;
  foreach d in array p_days loop insert into leave_request_days (leave_request_id, date, leave_type, deduction) values (rid, d, p_type, p_ded); end loop;
end $$;
select pg_temp.seed_leave('CL','2026-03-02','2026-03-03',false,null,'Approved','{2026-03-02,2026-03-03}');
select pg_temp.seed_leave('CL','2026-03-09','2026-03-09',false,null,'Approved','{2026-03-09}');
select pg_temp.seed_leave('CL','2026-06-10','2026-06-10',true,'First','Approved','{2026-06-10}', 0.5);
select pg_temp.seed_leave('CL','2026-10-12','2026-10-13',false,null,'Approved','{2026-10-12,2026-10-13}');
select pg_temp.seed_leave('CL','2026-10-22','2026-10-22',true,'First','Approved','{2026-10-22}', 0.5);
select pg_temp.seed_leave('CL','2026-11-06','2026-11-06',true,'First','Pending','{2026-11-06}', 0.5);
select pg_temp.seed_leave('SL','2026-04-13','2026-04-14',false,null,'Approved','{2026-04-13,2026-04-14}');
select pg_temp.seed_leave('EL','2026-07-06','2026-07-10',false,null,'Approved','{2026-07-06,2026-07-07,2026-07-08,2026-07-09,2026-07-10}');
select pg_temp.seed_leave('OH','2026-10-20','2026-10-20',false,null,'Approved','{2026-10-20}');
