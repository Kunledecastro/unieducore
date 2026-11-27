-- Examinations: an exam timetable per semester (paper, date, time, venues and seats, invigilators),
-- exam eligibility (approved registration, school fees, course bars), seat numbers, and clash checks.

alter table public.uni_semesters add column if not exists exam_timetable_published boolean not null default false;
alter table public.uni_settings add column if not exists require_fees_for_exams boolean not null default true;
comment on column public.uni_settings.require_fees_for_exams is 'Students must have paid the session''s school fees to sit exams (exam card)';

create table if not exists public.uni_exams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id),
  semester_id uuid not null references public.uni_semesters(id),
  offering_id uuid not null unique references public.uni_course_offerings(id) on delete cascade,
  exam_date date not null,
  start_time time not null,
  duration_minutes int not null check (duration_minutes between 30 and 360),
  note text,
  check (start_time >= '07:00' and start_time <= '19:00')
);
create index if not exists uni_exams_sem on public.uni_exams (semester_id, exam_date);

create table if not exists public.uni_exam_venues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id),
  exam_id uuid not null references public.uni_exams(id) on delete cascade,
  venue_id uuid not null references public.uni_venues(id),
  seats int not null check (seats > 0),
  position int not null default 1,          -- order students are seated in (by matric number)
  unique (exam_id, venue_id)
);

create table if not exists public.uni_exam_invigilators (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id),
  exam_id uuid not null references public.uni_exams(id) on delete cascade,
  venue_id uuid not null references public.uni_venues(id),
  staff_id uuid not null references public.uni_profiles(id),
  is_chief boolean not null default false,
  unique (exam_id, staff_id)
);

create table if not exists public.uni_exam_bars (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id),
  student_id uuid not null references public.uni_students(id),
  offering_id uuid not null references public.uni_course_offerings(id) on delete cascade,
  reason text not null,
  barred_by uuid not null references public.uni_profiles(id),
  created_at timestamptz not null default now(),
  unique (student_id, offering_id)
);

create or replace function uni_private.exam_time(p_date date, p_start time, p_minutes int)
returns tstzrange language sql immutable as $$
  select tstzrange((p_date + p_start)::timestamp at time zone 'Africa/Lagos', ((p_date + p_start)::timestamp + make_interval(mins => p_minutes)) at time zone 'Africa/Lagos')
$$;

-- Keep tenant/semester in step with the offering
create or replace function uni_private.fill_exam() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select semester_id, tenant_id into new.semester_id, new.tenant_id from public.uni_course_offerings where id = new.offering_id;
  return new;
end $$;
create trigger uni_exams_fill before insert or update of offering_id on public.uni_exams for each row execute function uni_private.fill_exam();

create or replace function uni_private.fill_exam_child() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select tenant_id into new.tenant_id from public.uni_exams where id = new.exam_id;
  if not exists (select 1 from public.uni_venues where id = new.venue_id and tenant_id = new.tenant_id) then raise exception 'Venue not found'; end if;
  if tg_table_name = 'uni_exam_invigilators' then
    if not exists (select 1 from public.uni_profiles where id = new.staff_id and tenant_id = new.tenant_id and is_active and role in ('lecturer', 'hod', 'registrar', 'admin')) then
      raise exception 'Invigilators must be active academic or Registry staff';
    end if;
    if not exists (select 1 from public.uni_exam_venues where exam_id = new.exam_id and venue_id = new.venue_id) then
      raise exception 'Add the venue to this exam first';
    end if;
  end if;
  return new;
end $$;
create trigger uni_exam_venues_fill before insert or update on public.uni_exam_venues for each row execute function uni_private.fill_exam_child();
create trigger uni_exam_invigilators_fill before insert or update on public.uni_exam_invigilators for each row execute function uni_private.fill_exam_child();

-- ===== eligibility and seating =====
-- One row per student registered for the paper (registration not rejected), in matric order, with seat and eligibility.
create or replace function public.uni_exam_candidates(p_exam uuid)
returns table (student_id uuid, matric_no text, full_name text, programme text, level int,
               venue_id uuid, venue text, seat_no int, eligible boolean, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare e public.uni_exams; v_set public.uni_settings; v_ses uuid;
begin
  select * into e from public.uni_exams where id = p_exam;
  if e.id is null or e.tenant_id is distinct from uni_private.my_tenant() then raise exception 'Exam not found'; end if;
  if not uni_private.is_staff() then
    if not exists (select 1 from public.uni_semesters where id = e.semester_id and exam_timetable_published) then raise exception 'Exam not found'; end if;
  end if;
  select * into v_set from public.uni_settings where tenant_id = e.tenant_id;
  select session_id into v_ses from public.uni_semesters where id = e.semester_id;
  return query
  with c as (
    select s.id, s.matric_no, p.full_name, pr.name as programme, s.level, r.status as reg_status,
           (select b.reason from public.uni_exam_bars b where b.student_id = s.id and b.offering_id = e.offering_id) as bar,
           coalesce((select sum(amount) from public.uni_payments py where py.student_id = s.id and py.session_id = v_ses and py.status = 'successful' and py.purpose = 'school_fees'), 0) as paid,
           public.uni_fees_due(s.id, v_ses) as due,
           row_number() over (order by s.matric_no) as n
    from public.uni_registration_courses rc
    join public.uni_registrations r on r.id = rc.registration_id and r.status <> 'rejected'
    join public.uni_students s on s.id = r.student_id
    join public.uni_profiles p on p.id = s.id
    join public.uni_programmes pr on pr.id = s.programme_id
    where rc.offering_id = e.offering_id
  ),
  v as (
    select ev.venue_id, vn.name, ev.seats,
           coalesce(sum(ev.seats) over (order by ev.position, vn.name rows between unbounded preceding and 1 preceding), 0) as before
    from public.uni_exam_venues ev join public.uni_venues vn on vn.id = ev.venue_id
    where ev.exam_id = e.id
  )
  select c.id, c.matric_no, c.full_name, c.programme, c.level, v.venue_id, v.name, (c.n - v.before)::int,
         (c.reg_status = 'approved' and c.bar is null and (not v_set.require_fees_for_exams or c.paid >= c.due)),
         case when c.reg_status <> 'approved' then 'Course registration not approved'
              when c.bar is not null then 'Barred: ' || c.bar
              when v_set.require_fees_for_exams and c.paid < c.due then 'School fees outstanding' end
  from c left join v on c.n > v.before and c.n <= v.before + v.seats
  where uni_private.is_staff() or c.id = (select auth.uid())
  order by c.matric_no;
end $$;

-- A student's own exam timetable (published semesters only), with venue, seat and eligibility
create or replace function public.uni_my_exams(p_semester uuid default null)
returns table (exam_id uuid, code text, title text, units int, exam_date date, start_time time, duration_minutes int,
               venue text, seat_no int, eligible boolean, reason text, semester text, session text)
language plpgsql stable security definer set search_path = '' as $$
declare v_sem uuid;
begin
  v_sem := coalesce(p_semester, (select id from public.uni_semesters where tenant_id = uni_private.my_tenant() and is_current));
  return query
    select e.id, c.code, c.title, c.units, e.exam_date, e.start_time, e.duration_minutes, x.venue, x.seat_no, x.eligible, x.reason, sem.name, ses.name
    from public.uni_exams e
    join public.uni_semesters sem on sem.id = e.semester_id and sem.exam_timetable_published
    join public.uni_sessions ses on ses.id = sem.session_id
    join public.uni_course_offerings o on o.id = e.offering_id
    join public.uni_courses c on c.id = o.course_id
    cross join lateral (select * from public.uni_exam_candidates(e.id) k where k.student_id = (select auth.uid())) x
    where e.semester_id = v_sem and e.tenant_id = uni_private.my_tenant()
    order by e.exam_date, e.start_time;
end $$;

-- Problems with a semester's exam timetable
create or replace function public.uni_exam_clashes(p_semester uuid)
returns table (kind text, exam_a uuid, exam_b uuid, detail text)
language sql stable security definer set search_path = '' as $$
  with e as (
    select x.id, x.offering_id, c.code, uni_private.exam_time(x.exam_date, x.start_time, x.duration_minutes) as t,
           (select count(*) from public.uni_registration_courses rc join public.uni_registrations r on r.id = rc.registration_id and r.status <> 'rejected'
            where rc.offering_id = x.offering_id) as candidates,
           (select coalesce(sum(seats), 0) from public.uni_exam_venues ev where ev.exam_id = x.id) as seats
    from public.uni_exams x join public.uni_course_offerings o on o.id = x.offering_id join public.uni_courses c on c.id = o.course_id
    where x.semester_id = p_semester and x.tenant_id = uni_private.my_tenant() and uni_private.is_staff()
  )
  -- students with two papers at once
  select 'students', a.id, b.id, n || ' student' || case when n = 1 then '' else 's' end || ' would sit ' || a.code || ' and ' || b.code || ' at the same time'
  from (select a.id, a.code, b.id as bid, b.code as bcode,
               (select count(*) from public.uni_registration_courses ra
                join public.uni_registrations r on r.id = ra.registration_id and r.status <> 'rejected'
                join public.uni_registration_courses rb on rb.registration_id = ra.registration_id and rb.offering_id = b.offering_id
                where ra.offering_id = a.offering_id) as n
        from e a join e b on a.id < b.id and a.t && b.t) a
  join e b on b.id = a.bid
  where n > 0
  union all
  -- not enough seats allocated
  select 'seats', e.id, null, e.code || ': ' || e.candidates || ' candidates, ' || e.seats || ' seats allocated'
  from e where e.seats < e.candidates
  union all
  -- a venue holding more candidates than it seats across papers that overlap
  select 'venue', a.id, b.id, v.name || ' is over capacity when ' || a.code || ' and ' || b.code || ' overlap (' || (va.seats + vb.seats) || ' of ' || v.capacity || ' seats)'
  from e a join e b on a.id < b.id and a.t && b.t
  join public.uni_exam_venues va on va.exam_id = a.id
  join public.uni_exam_venues vb on vb.exam_id = b.id and vb.venue_id = va.venue_id
  join public.uni_venues v on v.id = va.venue_id
  where va.seats + vb.seats > v.capacity
  union all
  -- seats allocated beyond a venue's capacity on one paper
  select 'venue', e.id, null, v.name || ' has ' || ev.seats || ' seats allocated for ' || e.code || ' but holds ' || v.capacity
  from e join public.uni_exam_venues ev on ev.exam_id = e.id join public.uni_venues v on v.id = ev.venue_id
  where ev.seats > v.capacity
  union all
  -- an invigilator in two places at once
  select 'invigilator', a.id, b.id, p.full_name || ' invigilates ' || a.code || ' and ' || b.code || ' at the same time'
  from e a join e b on a.id < b.id and a.t && b.t
  join public.uni_exam_invigilators ia on ia.exam_id = a.id
  join public.uni_exam_invigilators ib on ib.exam_id = b.id and ib.staff_id = ia.staff_id
  join public.uni_profiles p on p.id = ia.staff_id
  union all
  -- papers with candidates but no exam scheduled
  select 'unscheduled', null, null, c.code || ' has ' || n || ' registered student' || case when n = 1 then '' else 's' end || ' but no exam'
  from (select o.id, o.course_id, (select count(*) from public.uni_registration_courses rc join public.uni_registrations r on r.id = rc.registration_id and r.status <> 'rejected' where rc.offering_id = o.id) as n
        from public.uni_course_offerings o where o.semester_id = p_semester and o.tenant_id = uni_private.my_tenant() and uni_private.is_staff()
          and not exists (select 1 from public.uni_exams x where x.offering_id = o.id)) o
  join public.uni_courses c on c.id = o.course_id
  where n > 0
$$;

-- Bar or unbar a student from one paper (Registry, or the HOD of the course's department)
create or replace function public.uni_exam_bar(p_student uuid, p_offering uuid, p_reason text, p_bar boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not uni_private.can_edit_offering_schedule(p_offering) then raise exception 'Only the Registry or the course''s HOD can bar students'; end if;
  if not exists (select 1 from public.uni_registration_courses rc join public.uni_registrations r on r.id = rc.registration_id
                 where rc.offering_id = p_offering and r.student_id = p_student) then
    raise exception 'That student is not registered for this course';
  end if;
  if p_bar then
    if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason (for example, attendance below 75%%)'; end if;
    insert into public.uni_exam_bars (tenant_id, student_id, offering_id, reason, barred_by)
    values (uni_private.my_tenant(), p_student, p_offering, trim(p_reason), (select auth.uid()))
    on conflict (student_id, offering_id) do update set reason = excluded.reason, barred_by = excluded.barred_by, created_at = now();
  else
    delete from public.uni_exam_bars where student_id = p_student and offering_id = p_offering;
  end if;
end $$;

-- ===== access =====
alter table public.uni_exams enable row level security;
alter table public.uni_exam_venues enable row level security;
alter table public.uni_exam_invigilators enable row level security;
alter table public.uni_exam_bars enable row level security;

-- Staff see the exam timetable while it is drafted; students once it is published
create policy uni_exams_read on public.uni_exams for select to authenticated using (
  tenant_id = (select uni_private.my_tenant()) and ((select uni_private.is_staff())
    or exists (select 1 from public.uni_semesters s where s.id = semester_id and s.exam_timetable_published)));
create policy uni_exam_venues_read on public.uni_exam_venues for select to authenticated using (
  tenant_id = (select uni_private.my_tenant()) and ((select uni_private.is_staff())
    or exists (select 1 from public.uni_exams x join public.uni_semesters s on s.id = x.semester_id where x.id = exam_id and s.exam_timetable_published)));
create policy uni_exam_invig_read on public.uni_exam_invigilators for select to authenticated using (
  tenant_id = (select uni_private.my_tenant()) and (select uni_private.is_staff()));
create policy uni_exam_bars_read on public.uni_exam_bars for select to authenticated using (
  tenant_id = (select uni_private.my_tenant()) and ((select uni_private.is_staff()) or student_id = (select auth.uid())));

-- The Registry (exams office) builds the exam timetable
do $$
declare t text;
begin
  foreach t in array array['uni_exams', 'uni_exam_venues', 'uni_exam_invigilators'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (tenant_id = (select uni_private.my_tenant()) and (select uni_private.is_admin()))', t || '_admin_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (tenant_id = (select uni_private.my_tenant()) and (select uni_private.is_admin())) with check (tenant_id = (select uni_private.my_tenant()))', t || '_admin_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (tenant_id = (select uni_private.my_tenant()) and (select uni_private.is_admin()))', t || '_admin_del', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function uni_private.audit()', t || '_audit', t);
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function uni_private.block_inactive_writer()', t || '_block_inactive', t);
  end loop;
end $$;
create trigger uni_exam_bars_audit after insert or update or delete on public.uni_exam_bars for each row execute function uni_private.audit();
create trigger uni_exam_bars_block_inactive before insert or update or delete on public.uni_exam_bars for each row execute function uni_private.block_inactive_writer();

-- The insert check runs after the fill trigger, so tenant_id there is the offering's/exam's own
revoke all on public.uni_exams, public.uni_exam_venues, public.uni_exam_invigilators, public.uni_exam_bars from anon;
revoke insert, update, delete, truncate on public.uni_exam_bars from authenticated;

revoke execute on function public.uni_exam_candidates(uuid), public.uni_my_exams(uuid), public.uni_exam_clashes(uuid),
  public.uni_exam_bar(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.uni_exam_candidates(uuid), public.uni_my_exams(uuid), public.uni_exam_clashes(uuid),
  public.uni_exam_bar(uuid, uuid, text, boolean) to authenticated;

create index if not exists uni_exam_venues_exam on public.uni_exam_venues (exam_id);
create index if not exists uni_exam_invig_exam on public.uni_exam_invigilators (exam_id);
create index if not exists uni_exam_invig_staff on public.uni_exam_invigilators (staff_id);
create index if not exists uni_exam_bars_offering on public.uni_exam_bars (offering_id);
