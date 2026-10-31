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

create function public.register_certificate(p_path text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if me() is null then raise exception 'Not signed in as an active employee' using errcode = '42501'; end if;
  if p_path is null or p_path not like current_sub() || '/%' then
    raise exception 'The certificate must be in your own folder' using errcode = '42501';
  end if;
  insert into medical_certificates (owner_sub, path) values (current_sub(), p_path)
    on conflict (path) do update set path = excluded.path where medical_certificates.owner_sub = current_sub()
    returning id into v_id;
  if v_id is null then raise exception 'That certificate belongs to someone else' using errcode = '42501'; end if;
  return v_id;
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

grant execute on function public.preview_leave(text,date,date,boolean,text,int), public.register_certificate(text),
  public.apply_leave(text,date,date,boolean,text,text,text,boolean,int), public.process_leave_request(uuid,text,text,int),
  public.cancel_my_leave(uuid), public.hr_shorten_leave(uuid,date,text) to authenticated;
