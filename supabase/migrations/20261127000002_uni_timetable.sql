-- Lecture timetable: venues and weekly slots per course offering, with clash reporting.
-- A venue can never be double-booked (enforced here); lecturer and student clashes are reported for the Registry to resolve.

create table if not exists public.uni_venues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id),
  name text not null,
  building text,
  capacity int not null check (capacity between 1 and 5000),
  kind text not null default 'lecture' check (kind in ('lecture', 'lab', 'hall')),
  usable_for_exams boolean not null default true,
  is_active boolean not null default true,
  unique (tenant_id, name)
);

create table if not exists public.uni_timetable_slots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id),
  semester_id uuid not null references public.uni_semesters(id),
  offering_id uuid not null references public.uni_course_offerings(id) on delete cascade,
  day smallint not null check (day between 1 and 6),          -- 1 Monday … 6 Saturday
  start_time time not null,
  end_time time not null,
  venue_id uuid references public.uni_venues(id),
  kind text not null default 'lecture' check (kind in ('lecture', 'practical', 'tutorial')),
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  check (start_time >= '07:00' and end_time <= '21:00')
);
create index if not exists uni_timetable_slots_sem on public.uni_timetable_slots (semester_id, day);
create index if not exists uni_timetable_slots_offering on public.uni_timetable_slots (offering_id);
create index if not exists uni_timetable_slots_venue on public.uni_timetable_slots (venue_id);

-- Keep semester and tenant in step with the offering, and refuse a double-booked venue
create or replace function uni_private.check_timetable_slot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_sem uuid; v_tenant uuid; v_clash text;
begin
  select semester_id, tenant_id into v_sem, v_tenant from public.uni_course_offerings where id = new.offering_id;
  new.semester_id := v_sem; new.tenant_id := v_tenant;
  if new.venue_id is not null then
    if not exists (select 1 from public.uni_venues where id = new.venue_id and tenant_id = v_tenant and is_active) then
      raise exception 'Venue not found or not in use';
    end if;
    select c.code into v_clash
      from public.uni_timetable_slots s join public.uni_course_offerings o on o.id = s.offering_id join public.uni_courses c on c.id = o.course_id
     where s.venue_id = new.venue_id and s.semester_id = v_sem and s.day = new.day and s.id <> new.id
       and s.start_time < new.end_time and new.start_time < s.end_time
     limit 1;
    if v_clash is not null then raise exception 'That venue is already booked for % at that time', v_clash; end if;
  end if;
  return new;
end $$;
drop trigger if exists uni_timetable_slots_check on public.uni_timetable_slots;
create trigger uni_timetable_slots_check before insert or update on public.uni_timetable_slots
  for each row execute function uni_private.check_timetable_slot();

-- HODs manage their own department's courses; the Registry manages everything
create or replace function uni_private.can_edit_offering_schedule(p_offering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select uni_private.is_admin() or exists (
    select 1 from public.uni_course_offerings o join public.uni_courses c on c.id = o.course_id
    where o.id = p_offering and o.tenant_id = uni_private.my_tenant()
      and uni_private.my_role() = 'hod' and c.department_id = uni_private.my_department())
$$;

alter table public.uni_venues enable row level security;
alter table public.uni_timetable_slots enable row level security;
create policy uni_venues_read on public.uni_venues for select to authenticated using (tenant_id = (select uni_private.my_tenant()));
create policy uni_venues_admin_ins on public.uni_venues for insert to authenticated with check (tenant_id = (select uni_private.my_tenant()) and (select uni_private.is_admin()));
create policy uni_venues_admin_upd on public.uni_venues for update to authenticated using (tenant_id = (select uni_private.my_tenant()) and (select uni_private.is_admin())) with check (tenant_id = (select uni_private.my_tenant()));
create policy uni_slots_read on public.uni_timetable_slots for select to authenticated using (tenant_id = (select uni_private.my_tenant()));
create policy uni_slots_ins on public.uni_timetable_slots for insert to authenticated with check (uni_private.can_edit_offering_schedule(offering_id));
create policy uni_slots_upd on public.uni_timetable_slots for update to authenticated using (uni_private.can_edit_offering_schedule(offering_id)) with check (uni_private.can_edit_offering_schedule(offering_id));
create policy uni_slots_del on public.uni_timetable_slots for delete to authenticated using (uni_private.can_edit_offering_schedule(offering_id));
revoke all on public.uni_venues, public.uni_timetable_slots from anon;
revoke delete, truncate on public.uni_venues from authenticated;

-- Clashes in a semester's timetable:
--   lecturer  - the same lecturer teaching two classes at once
--   cohort    - two compulsory courses of the same programme and level at once
--   students  - students actually registered for both classes (count)
--   capacity  - more students registered than the venue holds
create or replace function public.uni_timetable_clashes(p_semester uuid)
returns table (kind text, slot_a uuid, slot_b uuid, detail text)
language sql stable security definer set search_path = '' as $$
  with s as (
    select t.id, t.offering_id, t.day, t.start_time, t.end_time, t.venue_id, o.lecturer_id, c.id as course_id, c.code, c.level
    from public.uni_timetable_slots t
    join public.uni_course_offerings o on o.id = t.offering_id
    join public.uni_courses c on c.id = o.course_id
    where t.semester_id = p_semester and t.tenant_id = uni_private.my_tenant()
  ),
  pairs as (
    select a.*, b.id as b_id, b.offering_id as b_offering, b.lecturer_id as b_lecturer, b.course_id as b_course, b.code as b_code, b.level as b_level
    from s a join s b on a.id < b.id and a.day = b.day and a.start_time < b.end_time and b.start_time < a.end_time
  ),
  days as (select * from (values (1, 'Mon'), (2, 'Tue'), (3, 'Wed'), (4, 'Thu'), (5, 'Fri'), (6, 'Sat')) d(n, label))
  select 'lecturer', p.id, p.b_id,
         (select full_name from public.uni_profiles where id = p.lecturer_id) || ' teaches ' || p.code || ' and ' || p.b_code || ' at the same time (' ||
         (select label from days where n = p.day) || ' ' || to_char(greatest(p.start_time, (select start_time from s where id = p.b_id)), 'HH24:MI') || ')'
  from pairs p where p.lecturer_id is not null and p.lecturer_id = p.b_lecturer and p.offering_id <> p.b_offering
  union all
  select 'cohort', p.id, p.b_id,
         string_agg(distinct pr.name || ' ' || p.level || 'L', ', ') || ': ' || p.code || ' and ' || p.b_code || ' are both compulsory (' || (select label from days where n = p.day) || ')'
  from pairs p
  join public.uni_programme_courses pa on pa.course_id = p.course_id and pa.is_compulsory
  join public.uni_programme_courses pb on pb.course_id = p.b_course and pb.is_compulsory and pb.programme_id = pa.programme_id
  join public.uni_programmes pr on pr.id = pa.programme_id
  where p.level = p.b_level and p.offering_id <> p.b_offering
  group by p.id, p.b_id, p.level, p.code, p.b_code, p.day
  union all
  select 'students', p.id, p.b_id, n || ' student' || case when n = 1 then '' else 's' end || ' registered for both ' || p.code || ' and ' || p.b_code
  from (
    select p.*, (select count(*) from public.uni_registration_courses ra
                 join public.uni_registrations r on r.id = ra.registration_id and r.status <> 'rejected'
                 join public.uni_registration_courses rb on rb.registration_id = ra.registration_id and rb.offering_id = p.b_offering
                 where ra.offering_id = p.offering_id) as n
    from pairs p where p.offering_id <> p.b_offering
  ) p where n > 0
  union all
  select 'capacity', s.id, null::uuid, s.code || ': ' || n || ' registered, ' || v.name || ' holds ' || v.capacity
  from (select s.*, (select count(*) from public.uni_registration_courses rc join public.uni_registrations r on r.id = rc.registration_id and r.status <> 'rejected'
                     where rc.offering_id = s.offering_id) as n from s) s
  join public.uni_venues v on v.id = s.venue_id
  where n > v.capacity
$$;
revoke execute on function public.uni_timetable_clashes(uuid) from public, anon;
grant execute on function public.uni_timetable_clashes(uuid) to authenticated;
revoke execute on function uni_private.can_edit_offering_schedule(uuid) from public, anon;
grant execute on function uni_private.can_edit_offering_schedule(uuid) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['uni_venues', 'uni_timetable_slots'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function uni_private.audit()', t || '_audit', t);
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function uni_private.block_inactive_writer()', t || '_block_inactive', t);
  end loop;
end $$;
