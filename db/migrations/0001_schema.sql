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
