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
