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
