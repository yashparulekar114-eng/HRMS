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
