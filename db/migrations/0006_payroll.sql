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
