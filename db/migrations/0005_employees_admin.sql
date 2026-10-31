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
