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
