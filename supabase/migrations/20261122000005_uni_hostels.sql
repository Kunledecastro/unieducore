-- Hostel management: halls, rooms, beds; apply → pay → auto-allocate; check-in/out by porters;
-- room changes, maintenance, exeats and visitors. Every write goes through a function below.

-- ===== people =====
alter table public.uni_students add column if not exists gender text check (gender in ('male', 'female'));

-- Porters can see student names only through hostel functions, not the whole student directory.
create or replace function uni_private.is_staff() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select role not in ('student', 'porter') from public.uni_profiles where id = (select auth.uid()) and is_active), false) $$;

create or replace function uni_private.is_hostel_admin() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select role in ('hostel_officer', 'admin') from public.uni_profiles where id = (select auth.uid()) and is_active), false) $$;

-- ===== settings =====
alter table public.uni_settings
  add column if not exists hostel_applications_open boolean not null default false,
  add column if not exists hostel_hold_hours int not null default 72 check (hostel_hold_hours between 1 and 720),
  add column if not exists hostel_require_school_fees boolean not null default false;
comment on column public.uni_settings.hostel_hold_hours is 'Hours a reserved bed is held for payment before it is released';

-- ===== halls, rooms, beds =====
create table if not exists public.uni_hostels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id),
  name text not null,
  gender text not null check (gender in ('male', 'female')),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

alter table public.uni_profiles add column if not exists hostel_id uuid references public.uni_hostels(id);

create table if not exists public.uni_hostel_rooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id),
  hostel_id uuid not null references public.uni_hostels(id) on delete cascade,
  name text not null,
  floor text,
  room_type text not null default 'Standard',
  capacity int not null check (capacity between 1 and 12),
  fee numeric(12, 2) not null default 0 check (fee >= 0),
  levels int[],                       -- null = every level
  is_active boolean not null default true,
  unique (hostel_id, name)
);

create table if not exists public.uni_hostel_beds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id),
  room_id uuid not null references public.uni_hostel_rooms(id) on delete cascade,
  label text not null,
  is_active boolean not null default true,
  unique (room_id, label)
);

-- ===== allocations =====
create table if not exists public.uni_hostel_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id),
  session_id uuid not null references public.uni_sessions(id),
  student_id uuid not null references public.uni_students(id),
  hostel_id uuid not null references public.uni_hostels(id),
  bed_id uuid not null references public.uni_hostel_beds(id) on delete restrict,
  status text not null check (status in ('reserved', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'expired')),
  amount numeric(12, 2) not null check (amount >= 0),
  reserved_at timestamptz not null default now(),
  expires_at timestamptz,
  confirmed_at timestamptz,
  checked_in_at timestamptz, checked_in_by uuid references public.uni_profiles(id), condition_in text,
  checked_out_at timestamptz, checked_out_by uuid references public.uni_profiles(id), condition_out text,
  cancelled_reason text,
  allocated_by uuid references public.uni_profiles(id)  -- set when the hostel officer places a student by hand
);
create unique index if not exists uni_hostel_alloc_one_per_student on public.uni_hostel_allocations (session_id, student_id)
  where status in ('reserved', 'confirmed', 'checked_in');
create unique index if not exists uni_hostel_alloc_one_per_bed on public.uni_hostel_allocations (session_id, bed_id)
  where status in ('reserved', 'confirmed', 'checked_in');
create index if not exists uni_hostel_alloc_hostel on public.uni_hostel_allocations (hostel_id, session_id);
create index if not exists uni_hostel_alloc_student on public.uni_hostel_allocations (student_id);

-- ===== payments carry a purpose =====
alter table public.uni_payments
  add column if not exists purpose text not null default 'school_fees' check (purpose in ('school_fees', 'hostel')),
  add column if not exists allocation_id uuid references public.uni_hostel_allocations(id);

-- ===== requests and logs =====
create table if not exists public.uni_hostel_change_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id),
  allocation_id uuid not null references public.uni_hostel_allocations(id),
  student_id uuid not null references public.uni_students(id),
  hostel_id uuid not null references public.uni_hostels(id),
  reason text not null,
  preferred_hostel_id uuid references public.uni_hostels(id),
  preferred_room_type text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decision_note text, decided_by uuid references public.uni_profiles(id), decided_at timestamptz,
  from_bed_id uuid references public.uni_hostel_beds(id), to_bed_id uuid references public.uni_hostel_beds(id),
  created_at timestamptz not null default now()
);
create unique index if not exists uni_hostel_change_one_pending on public.uni_hostel_change_requests (allocation_id) where status = 'pending';

create table if not exists public.uni_hostel_maintenance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id),
  hostel_id uuid not null references public.uni_hostels(id),
  room_id uuid references public.uni_hostel_rooms(id),
  student_id uuid references public.uni_students(id),
  reported_by uuid not null references public.uni_profiles(id),
  category text not null check (category in ('plumbing', 'electrical', 'carpentry', 'cleaning', 'furniture', 'security', 'other')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'urgent')),
  description text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  assigned_to text, resolution_note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), resolved_at timestamptz
);
create index if not exists uni_hostel_maint_hostel on public.uni_hostel_maintenance (hostel_id, status);

create table if not exists public.uni_hostel_exeats (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id),
  student_id uuid not null references public.uni_students(id),
  allocation_id uuid not null references public.uni_hostel_allocations(id),
  hostel_id uuid not null references public.uni_hostels(id),
  destination text not null, reason text not null, contact_phone text not null,
  leave_at timestamptz not null, return_by timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled', 'out', 'returned')),
  decision_note text, decided_by uuid references public.uni_profiles(id), decided_at timestamptz,
  out_at timestamptz, out_by uuid references public.uni_profiles(id),
  returned_at timestamptz, returned_by uuid references public.uni_profiles(id),
  created_at timestamptz not null default now(),
  check (return_by > leave_at)
);
create index if not exists uni_hostel_exeat_hostel on public.uni_hostel_exeats (hostel_id, status);

create table if not exists public.uni_hostel_visitors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id),
  hostel_id uuid not null references public.uni_hostels(id),
  student_id uuid not null references public.uni_students(id),
  visitor_name text not null, visitor_phone text, relationship text, purpose text,
  time_in timestamptz not null default now(), time_out timestamptz,
  logged_by uuid not null references public.uni_profiles(id), signed_out_by uuid references public.uni_profiles(id)
);
create index if not exists uni_hostel_visitors_hostel on public.uni_hostel_visitors (hostel_id, time_in desc);

-- ===== helpers =====
create or replace function uni_private.my_hostel() returns uuid
language sql stable security definer set search_path = '' as
$$ select hostel_id from public.uni_profiles where id = (select auth.uid()) and is_active and role = 'porter' $$;

-- Hostel officer / admin for any hall; a porter for their own hall
create or replace function uni_private.can_run_hostel(p_hostel uuid) returns boolean
language sql stable security definer set search_path = '' as
$$ select uni_private.is_hostel_admin() or (p_hostel is not null and p_hostel = uni_private.my_hostel()) $$;

create or replace function uni_private.current_session(p_tenant uuid) returns uuid
language sql stable security definer set search_path = '' as
$$ select session_id from public.uni_semesters where tenant_id = p_tenant and is_current limit 1 $$;

create or replace function uni_private.hostel_paid(p_student uuid, p_session uuid) returns numeric
language sql stable security definer set search_path = '' as
$$ select coalesce(sum(amount), 0) from public.uni_payments
   where student_id = p_student and session_id = p_session and purpose = 'hostel' and status = 'successful' $$;

-- Release beds whose payment hold has run out
create or replace function uni_private.expire_hostel_holds(p_tenant uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.uni_hostel_allocations set status = 'expired'
   where tenant_id = p_tenant and status = 'reserved' and expires_at < now()
     and uni_private.hostel_paid(student_id, session_id) < amount;
  get diagnostics n = row_count;
  return n;
end $$;

-- Confirm a reservation once hostel payments for the session cover it.
-- A payment that lands after the hold lapsed reinstates the same bed if nobody has taken it.
create or replace function uni_private.settle_hostel(p_student uuid, p_session uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare a public.uni_hostel_allocations; v_paid numeric := uni_private.hostel_paid(p_student, p_session);
begin
  select * into a from public.uni_hostel_allocations
   where student_id = p_student and session_id = p_session and status in ('reserved', 'confirmed', 'checked_in')
   order by reserved_at desc limit 1;
  if a.id is null then
    select * into a from public.uni_hostel_allocations
     where student_id = p_student and session_id = p_session and status = 'expired'
     order by reserved_at desc limit 1;
    if a.id is null or v_paid < a.amount then return 'none'; end if;
    if exists (select 1 from public.uni_hostel_allocations x where x.bed_id = a.bed_id and x.session_id = p_session
               and x.status in ('reserved', 'confirmed', 'checked_in')) then
      return 'paid_bed_taken';  -- the hostel officer places the student by hand (Allocations → Paid, no bed)
    end if;
    update public.uni_hostel_allocations set status = 'confirmed', confirmed_at = now() where id = a.id;
    return 'reinstated';
  end if;
  if a.status = 'reserved' and v_paid >= a.amount then
    update public.uni_hostel_allocations set status = 'confirmed', confirmed_at = now() where id = a.id;
    return 'confirmed';
  end if;
  return a.status;
end $$;

create or replace function uni_private.on_hostel_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.purpose = 'hostel' and new.status = 'successful' and (tg_op = 'INSERT' or old.status is distinct from 'successful') then
    perform uni_private.settle_hostel(new.student_id, new.session_id);
  end if;
  return new;
end $$;
drop trigger if exists uni_payments_settle_hostel on public.uni_payments;
create trigger uni_payments_settle_hostel after insert or update of status on public.uni_payments
  for each row execute function uni_private.on_hostel_payment();

-- Keep one bed per unit of capacity (A, B, C…). Shrinking a room is refused while the extra beds are occupied.
create or replace function uni_private.sync_room_beds() returns trigger
language plpgsql security definer set search_path = '' as $$
declare i int;
begin
  for i in 1..new.capacity loop
    insert into public.uni_hostel_beds (tenant_id, room_id, label) values (new.tenant_id, new.id, chr(64 + i))
    on conflict (room_id, label) do update set is_active = true;
  end loop;
  if exists (select 1 from public.uni_hostel_beds b join public.uni_hostel_allocations a on a.bed_id = b.id
             where b.room_id = new.id and b.label > chr(64 + new.capacity) and a.status in ('reserved', 'confirmed', 'checked_in')) then
    raise exception 'Room % has students in the beds you are removing. Move them first.', new.name;
  end if;
  update public.uni_hostel_beds set is_active = false where room_id = new.id and label > chr(64 + new.capacity);
  return new;
end $$;
drop trigger if exists uni_hostel_rooms_sync_beds on public.uni_hostel_rooms;
create trigger uni_hostel_rooms_sync_beds after insert or update of capacity on public.uni_hostel_rooms
  for each row execute function uni_private.sync_room_beds();

-- Fields a student can see about their own room-mates (names only)
create or replace function public.uni_hostel_my_room()
returns table (allocation_id uuid, status text, hostel text, room text, floor text, room_type text, bed text, amount numeric, paid numeric,
               expires_at timestamptz, session_name text, roommates text[])
language sql stable security definer set search_path = '' as $$
  select a.id, a.status, h.name, r.name, r.floor, r.room_type, b.label, a.amount, uni_private.hostel_paid(a.student_id, a.session_id),
         a.expires_at, ses.name,
         array(select p.full_name || ' (' || b2.label || ')' from public.uni_hostel_allocations a2
               join public.uni_hostel_beds b2 on b2.id = a2.bed_id join public.uni_profiles p on p.id = a2.student_id
               where b2.room_id = r.id and a2.session_id = a.session_id and a2.student_id <> a.student_id
                 and a2.status in ('confirmed', 'checked_in') order by b2.label)
  from public.uni_hostel_allocations a
  join public.uni_hostel_beds b on b.id = a.bed_id
  join public.uni_hostel_rooms r on r.id = b.room_id
  join public.uni_hostels h on h.id = a.hostel_id
  join public.uni_sessions ses on ses.id = a.session_id
  where a.student_id = (select auth.uid()) and a.session_id = uni_private.current_session(a.tenant_id)
  order by (a.status in ('reserved', 'confirmed', 'checked_in')) desc, a.reserved_at desc
  limit 1
$$;

-- What a student can apply for: halls for their gender, grouped by room type, with free beds
create or replace function public.uni_hostel_options()
returns table (hostel_id uuid, hostel text, room_type text, fee numeric, free_beds bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_st public.uni_students; v_ses uuid;
begin
  select * into v_st from public.uni_students where id = (select auth.uid());
  if v_st.id is null then return; end if;
  v_ses := uni_private.current_session(v_st.tenant_id);
  return query
    select h.id, h.name, r.room_type, r.fee, count(b.id)
    from public.uni_hostels h
    join public.uni_hostel_rooms r on r.hostel_id = h.id and r.is_active and (r.levels is null or v_st.level = any(r.levels))
    join public.uni_hostel_beds b on b.room_id = r.id and b.is_active
    where h.tenant_id = v_st.tenant_id and h.is_active and h.gender = v_st.gender
      and not exists (select 1 from public.uni_hostel_allocations a where a.bed_id = b.id and a.session_id = v_ses
                      and (a.status in ('confirmed', 'checked_in') or (a.status = 'reserved' and a.expires_at > now())))
    group by h.id, h.name, r.room_type, r.fee
    order by h.name, r.fee, r.room_type;
end $$;

-- Picks a free bed matching the student; locks it so two students cannot get the same bed
create or replace function uni_private.pick_bed(p_student uuid, p_session uuid, p_hostel uuid, p_room_type text, p_max_fee numeric)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_st public.uni_students; v_bed uuid;
begin
  select * into v_st from public.uni_students where id = p_student;
  select b.id into v_bed
  from public.uni_hostel_beds b
  join public.uni_hostel_rooms r on r.id = b.room_id
  join public.uni_hostels h on h.id = r.hostel_id
  where h.tenant_id = v_st.tenant_id and h.is_active and r.is_active and b.is_active and h.gender = v_st.gender
    and (p_hostel is null or h.id = p_hostel)
    and (p_room_type is null or r.room_type = p_room_type)
    and (p_max_fee is null or r.fee <= p_max_fee)
    and (r.levels is null or v_st.level = any(r.levels))
    and not exists (select 1 from public.uni_hostel_allocations a where a.bed_id = b.id and a.session_id = p_session
                    and a.status in ('reserved', 'confirmed', 'checked_in'))
  order by h.name, r.name, b.label
  limit 1
  for update of b skip locked;
  return v_bed;
end $$;

-- ===== student actions =====
create or replace function public.uni_hostel_apply(p_hostel uuid default null, p_room_type text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_st public.uni_students; v_set public.uni_settings; v_ses uuid; v_bed uuid; v_fee numeric; v_hostel uuid; v_id uuid;
        v_due numeric; v_paid numeric;
begin
  select * into v_st from public.uni_students where id = (select auth.uid());
  if v_st.id is null then raise exception 'Only students can apply for a hostel'; end if;
  if v_st.status <> 'active' then raise exception 'Only active students can apply for a hostel'; end if;
  if v_st.gender is null then raise exception 'Your record has no gender, which decides your hall. Ask the Registry to update it.'; end if;
  select * into v_set from public.uni_settings where tenant_id = v_st.tenant_id;
  if not v_set.hostel_applications_open then raise exception 'Hostel applications are closed'; end if;
  v_ses := uni_private.current_session(v_st.tenant_id);
  if v_ses is null then raise exception 'There is no current session'; end if;
  if v_set.hostel_require_school_fees then
    v_due := public.uni_fees_due(v_st.id, v_ses);
    select coalesce(sum(amount), 0) into v_paid from public.uni_payments
     where student_id = v_st.id and session_id = v_ses and purpose = 'school_fees' and status = 'successful';
    if v_paid < v_due then raise exception 'Pay your school fees before applying for a hostel'; end if;
  end if;

  perform uni_private.expire_hostel_holds(v_st.tenant_id);
  if exists (select 1 from public.uni_hostel_allocations where student_id = v_st.id and session_id = v_ses
             and status in ('reserved', 'confirmed', 'checked_in')) then
    raise exception 'You already have a hostel space this session';
  end if;

  v_bed := uni_private.pick_bed(v_st.id, v_ses, p_hostel, nullif(trim(p_room_type), ''), null);
  if v_bed is null then raise exception 'No bed is free for that choice. Try another hall or room type.'; end if;
  select r.fee, r.hostel_id into v_fee, v_hostel from public.uni_hostel_beds b join public.uni_hostel_rooms r on r.id = b.room_id where b.id = v_bed;

  insert into public.uni_hostel_allocations (tenant_id, session_id, student_id, hostel_id, bed_id, status, amount, expires_at, confirmed_at)
  values (v_st.tenant_id, v_ses, v_st.id, v_hostel, v_bed, case when v_fee = 0 then 'confirmed' else 'reserved' end, v_fee,
          now() + make_interval(hours => v_set.hostel_hold_hours), case when v_fee = 0 then now() end)
  returning id into v_id;
  perform uni_private.settle_hostel(v_st.id, v_ses);  -- money already paid this session (e.g. after a cancellation) counts
  return v_id;
end $$;

-- Student cancels an unpaid reservation; the hostel officer can cancel any allocation that is not checked in
create or replace function public.uni_hostel_cancel(p_allocation uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.uni_hostel_allocations;
begin
  select * into a from public.uni_hostel_allocations where id = p_allocation;
  if a.id is null or a.tenant_id is distinct from uni_private.my_tenant() then raise exception 'Allocation not found'; end if;
  if a.student_id = (select auth.uid()) then
    if a.status <> 'reserved' then raise exception 'Only an unpaid reservation can be cancelled. Contact the hostel office.'; end if;
  elsif not uni_private.is_hostel_admin() then raise exception 'Only the hostel office can cancel allocations';
  end if;
  if a.status not in ('reserved', 'confirmed') then raise exception 'This allocation cannot be cancelled (it is %)', a.status; end if;
  update public.uni_hostel_allocations set status = 'cancelled', cancelled_reason = nullif(trim(p_reason), '') where id = a.id;
  update public.uni_hostel_change_requests set status = 'cancelled' where allocation_id = a.id and status = 'pending';
end $$;

create or replace function public.uni_hostel_request_change(p_reason text, p_hostel uuid default null, p_room_type text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.uni_hostel_allocations; v_id uuid;
begin
  select * into a from public.uni_hostel_allocations where student_id = (select auth.uid()) and status in ('confirmed', 'checked_in')
    and session_id = uni_private.current_session(tenant_id);
  if a.id is null then raise exception 'You need a confirmed hostel space to ask for a room change'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the room change'; end if;
  if exists (select 1 from public.uni_hostel_change_requests where allocation_id = a.id and status = 'pending') then
    raise exception 'You already have a room change request waiting';
  end if;
  insert into public.uni_hostel_change_requests (tenant_id, allocation_id, student_id, hostel_id, reason, preferred_hostel_id, preferred_room_type, from_bed_id)
  values (a.tenant_id, a.id, a.student_id, a.hostel_id, trim(p_reason), p_hostel, nullif(trim(p_room_type), ''), a.bed_id)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.uni_hostel_cancel_change(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.uni_hostel_change_requests set status = 'cancelled'
   where id = p_request and student_id = (select auth.uid()) and status = 'pending';
  if not found then raise exception 'Request not found or already decided'; end if;
end $$;

create or replace function public.uni_hostel_report_fault(p_category text, p_description text, p_priority text default 'normal', p_room uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := (select auth.uid()); a public.uni_hostel_allocations; v_hostel uuid; v_room uuid; v_id uuid;
begin
  if coalesce(trim(p_description), '') = '' then raise exception 'Describe the fault'; end if;
  select * into a from public.uni_hostel_allocations where student_id = v_me and status in ('confirmed', 'checked_in')
    and session_id = uni_private.current_session(tenant_id);
  if a.id is not null then
    v_hostel := a.hostel_id;
    select room_id into v_room from public.uni_hostel_beds where id = a.bed_id;
  elsif p_room is not null then
    select r.hostel_id, r.id into v_hostel, v_room from public.uni_hostel_rooms r where r.id = p_room and r.tenant_id = uni_private.my_tenant();
    if v_hostel is null or not uni_private.can_run_hostel(v_hostel) then raise exception 'Room not found'; end if;
  else
    raise exception 'Only residents, porters and the hostel office can report faults';
  end if;
  insert into public.uni_hostel_maintenance (tenant_id, hostel_id, room_id, student_id, reported_by, category, priority, description)
  values (uni_private.my_tenant(), v_hostel, v_room, a.student_id, v_me, p_category, coalesce(p_priority, 'normal'), trim(p_description))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.uni_hostel_request_exeat(p_destination text, p_reason text, p_phone text, p_leave timestamptz, p_return timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.uni_hostel_allocations; v_id uuid;
begin
  select * into a from public.uni_hostel_allocations where student_id = (select auth.uid()) and status = 'checked_in'
    and session_id = uni_private.current_session(tenant_id);
  if a.id is null then raise exception 'Only students checked in to a hostel can request an exeat'; end if;
  if coalesce(trim(p_destination), '') = '' or coalesce(trim(p_reason), '') = '' or coalesce(trim(p_phone), '') = '' then
    raise exception 'Destination, reason and a contact phone number are required';
  end if;
  if p_leave < now() - interval '1 hour' then raise exception 'The leaving time is in the past'; end if;
  if p_return <= p_leave then raise exception 'The return time must be after the leaving time'; end if;
  if exists (select 1 from public.uni_hostel_exeats where student_id = a.student_id and status in ('pending', 'approved', 'out')) then
    raise exception 'You already have an exeat that is pending, approved or in progress';
  end if;
  insert into public.uni_hostel_exeats (tenant_id, student_id, allocation_id, hostel_id, destination, reason, contact_phone, leave_at, return_by)
  values (a.tenant_id, a.student_id, a.id, a.hostel_id, trim(p_destination), trim(p_reason), trim(p_phone), p_leave, p_return)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.uni_hostel_cancel_exeat(p_exeat uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.uni_hostel_exeats set status = 'cancelled'
   where id = p_exeat and student_id = (select auth.uid()) and status in ('pending', 'approved');
  if not found then raise exception 'Exeat not found, or you have already left'; end if;
end $$;

-- Demo payment for the hostel fee (only while demo payments are allowed)
create or replace function public.uni_hostel_pay_demo() returns numeric
language plpgsql security definer set search_path = '' as $$
declare v_st public.uni_students; a public.uni_hostel_allocations; v_out numeric;
begin
  select * into v_st from public.uni_students where id = (select auth.uid());
  if v_st.id is null then raise exception 'Only students can pay'; end if;
  if not coalesce((select allow_demo_payments from public.uni_settings where tenant_id = v_st.tenant_id), false) then
    raise exception 'Demo payments are switched off. Please pay online.';
  end if;
  perform uni_private.expire_hostel_holds(v_st.tenant_id);
  select * into a from public.uni_hostel_allocations where student_id = v_st.id and status = 'reserved'
    and session_id = uni_private.current_session(v_st.tenant_id);
  if a.id is null then raise exception 'You have no hostel reservation waiting for payment'; end if;
  v_out := a.amount - uni_private.hostel_paid(v_st.id, a.session_id);
  if v_out <= 0 then raise exception 'Nothing to pay'; end if;
  insert into public.uni_payments (tenant_id, student_id, session_id, amount, reference, channel, purpose, allocation_id)
  values (v_st.tenant_id, v_st.id, a.session_id, v_out, 'DEMO-H-' || upper(substr(md5(random()::text), 1, 8)), 'demo', 'hostel', a.id);
  return v_out;
end $$;

-- ===== hostel office actions =====
create or replace function public.uni_hostel_allocate(p_student uuid, p_bed uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_st public.uni_students; v_ses uuid; v_fee numeric; v_hostel uuid; v_gender text; v_id uuid; v_hold int;
begin
  if not uni_private.is_hostel_admin() then raise exception 'Only the hostel office can allocate beds'; end if;
  select * into v_st from public.uni_students where id = p_student;
  if v_st.id is null or v_st.tenant_id is distinct from uni_private.my_tenant() then raise exception 'Student not found'; end if;
  if v_st.gender is null then raise exception 'This student has no gender on record; the Registry must add it first'; end if;
  v_ses := uni_private.current_session(v_st.tenant_id);
  perform uni_private.expire_hostel_holds(v_st.tenant_id);
  select r.fee, h.id, h.gender into v_fee, v_hostel, v_gender
    from public.uni_hostel_beds b join public.uni_hostel_rooms r on r.id = b.room_id join public.uni_hostels h on h.id = r.hostel_id
   where b.id = p_bed and b.is_active and r.is_active and h.is_active and h.tenant_id = v_st.tenant_id
   for update of b;
  if v_hostel is null then raise exception 'Bed not found or not in use'; end if;
  if v_gender <> v_st.gender then raise exception 'This hall is for % students', v_gender; end if;
  if exists (select 1 from public.uni_hostel_allocations where bed_id = p_bed and session_id = v_ses and status in ('reserved', 'confirmed', 'checked_in')) then
    raise exception 'That bed is already taken';
  end if;
  if exists (select 1 from public.uni_hostel_allocations where student_id = p_student and session_id = v_ses and status in ('reserved', 'confirmed', 'checked_in')) then
    raise exception 'This student already has a hostel space this session';
  end if;
  select hostel_hold_hours into v_hold from public.uni_settings where tenant_id = v_st.tenant_id;
  insert into public.uni_hostel_allocations (tenant_id, session_id, student_id, hostel_id, bed_id, status, amount, expires_at, confirmed_at, allocated_by)
  values (v_st.tenant_id, v_ses, p_student, v_hostel, p_bed, case when v_fee = 0 then 'confirmed' else 'reserved' end, v_fee,
          now() + make_interval(hours => v_hold), case when v_fee = 0 then now() end, (select auth.uid()))
  returning id into v_id;
  perform uni_private.settle_hostel(p_student, v_ses);
  return v_id;
end $$;

-- Approve moves the student to p_bed, or to the first free bed matching their preference.
-- The new room may not cost more than what the student was charged (fee differences are handled by the Bursary).
create or replace function public.uni_hostel_decide_change(p_request uuid, p_approve boolean, p_bed uuid default null, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.uni_hostel_change_requests; a public.uni_hostel_allocations; v_bed uuid := p_bed; v_hostel uuid; v_fee numeric; v_gender text; v_g text;
begin
  if not uni_private.is_hostel_admin() then raise exception 'Only the hostel office can decide room changes'; end if;
  select * into q from public.uni_hostel_change_requests where id = p_request for update;
  if q.id is null or q.tenant_id is distinct from uni_private.my_tenant() then raise exception 'Request not found'; end if;
  if q.status <> 'pending' then raise exception 'This request has already been decided'; end if;
  select * into a from public.uni_hostel_allocations where id = q.allocation_id for update;
  if a.status not in ('confirmed', 'checked_in') then raise exception 'The student no longer holds this space'; end if;
  if not p_approve then
    update public.uni_hostel_change_requests set status = 'rejected', decision_note = nullif(trim(p_note), ''), decided_by = (select auth.uid()), decided_at = now() where id = q.id;
    return;
  end if;
  if v_bed is null then
    v_bed := uni_private.pick_bed(a.student_id, a.session_id, q.preferred_hostel_id, q.preferred_room_type, a.amount);
    if v_bed is null then raise exception 'No free bed matches the request at the same or lower fee. Pick a bed by hand.'; end if;
  end if;
  select r.fee, h.id, h.gender into v_fee, v_hostel, v_gender
    from public.uni_hostel_beds b join public.uni_hostel_rooms r on r.id = b.room_id join public.uni_hostels h on h.id = r.hostel_id
   where b.id = v_bed and b.is_active and r.is_active and h.is_active and h.tenant_id = a.tenant_id for update of b;
  if v_hostel is null then raise exception 'Bed not found or not in use'; end if;
  select gender into v_g from public.uni_students where id = a.student_id;
  if v_gender <> v_g then raise exception 'That hall is for % students', v_gender; end if;
  if v_fee > a.amount then raise exception 'That room costs more than the student paid'; end if;
  if v_bed = a.bed_id then raise exception 'The student is already in that bed'; end if;
  if exists (select 1 from public.uni_hostel_allocations where bed_id = v_bed and session_id = a.session_id and status in ('reserved', 'confirmed', 'checked_in')) then
    raise exception 'That bed is already taken';
  end if;
  update public.uni_hostel_allocations set bed_id = v_bed, hostel_id = v_hostel where id = a.id;
  update public.uni_hostel_change_requests set status = 'approved', to_bed_id = v_bed, decision_note = nullif(trim(p_note), ''),
    decided_by = (select auth.uid()), decided_at = now() where id = q.id;
end $$;

create or replace function public.uni_hostel_decide_exeat(p_exeat uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not uni_private.is_hostel_admin() then raise exception 'Only the hostel office can approve exeats'; end if;
  update public.uni_hostel_exeats set status = case when p_approve then 'approved' else 'rejected' end,
         decision_note = nullif(trim(p_note), ''), decided_by = (select auth.uid()), decided_at = now()
   where id = p_exeat and tenant_id = uni_private.my_tenant() and status = 'pending';
  if not found then raise exception 'Exeat not found or already decided'; end if;
end $$;

create or replace function public.uni_hostel_update_fault(p_fault uuid, p_status text, p_assigned_to text default null, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare f public.uni_hostel_maintenance;
begin
  select * into f from public.uni_hostel_maintenance where id = p_fault;
  if f.id is null or f.tenant_id is distinct from uni_private.my_tenant() or not uni_private.can_run_hostel(f.hostel_id) then raise exception 'Fault not found'; end if;
  if p_status not in ('open', 'in_progress', 'resolved', 'closed') then raise exception 'Unknown status'; end if;
  if p_status = 'closed' and not uni_private.is_hostel_admin() then raise exception 'Only the hostel office can close a fault'; end if;
  update public.uni_hostel_maintenance set status = p_status,
         assigned_to = coalesce(nullif(trim(p_assigned_to), ''), assigned_to),
         resolution_note = coalesce(nullif(trim(p_note), ''), resolution_note),
         resolved_at = case when p_status in ('resolved', 'closed') then coalesce(resolved_at, now()) else null end,
         updated_at = now()
   where id = f.id;
end $$;

-- ===== porter actions (own hall) =====
create or replace function public.uni_hostel_check_in(p_allocation uuid, p_condition text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.uni_hostel_allocations;
begin
  select * into a from public.uni_hostel_allocations where id = p_allocation for update;
  if a.id is null or a.tenant_id is distinct from uni_private.my_tenant() or not uni_private.can_run_hostel(a.hostel_id) then raise exception 'Allocation not found'; end if;
  if a.status = 'reserved' then raise exception 'This bed is not paid for yet. The student must pay the hostel fee first.'; end if;
  if a.status <> 'confirmed' then raise exception 'Only a confirmed allocation can be checked in (this one is %)', a.status; end if;
  if a.session_id is distinct from uni_private.current_session(a.tenant_id) then raise exception 'This allocation is for a past session'; end if;
  update public.uni_hostel_allocations set status = 'checked_in', checked_in_at = now(), checked_in_by = (select auth.uid()),
         condition_in = nullif(trim(p_condition), '') where id = a.id;
end $$;

create or replace function public.uni_hostel_check_out(p_allocation uuid, p_condition text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.uni_hostel_allocations;
begin
  select * into a from public.uni_hostel_allocations where id = p_allocation for update;
  if a.id is null or a.tenant_id is distinct from uni_private.my_tenant() or not uni_private.can_run_hostel(a.hostel_id) then raise exception 'Allocation not found'; end if;
  if a.status <> 'checked_in' then raise exception 'Only a checked-in student can be checked out'; end if;
  if exists (select 1 from public.uni_hostel_exeats where allocation_id = a.id and status = 'out') then
    raise exception 'The student is away on exeat. Mark them returned first.';
  end if;
  update public.uni_hostel_allocations set status = 'checked_out', checked_out_at = now(), checked_out_by = (select auth.uid()),
         condition_out = nullif(trim(p_condition), '') where id = a.id;
  update public.uni_hostel_change_requests set status = 'cancelled' where allocation_id = a.id and status = 'pending';
end $$;

create or replace function public.uni_hostel_exeat_gate(p_exeat uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.uni_hostel_exeats;
begin
  select * into e from public.uni_hostel_exeats where id = p_exeat for update;
  if e.id is null or e.tenant_id is distinct from uni_private.my_tenant() or not uni_private.can_run_hostel(e.hostel_id) then raise exception 'Exeat not found'; end if;
  if p_action = 'out' then
    if e.status <> 'approved' then raise exception 'Only an approved exeat can be used to leave'; end if;
    update public.uni_hostel_exeats set status = 'out', out_at = now(), out_by = (select auth.uid()) where id = e.id;
  elsif p_action = 'returned' then
    if e.status <> 'out' then raise exception 'The student has not been signed out'; end if;
    update public.uni_hostel_exeats set status = 'returned', returned_at = now(), returned_by = (select auth.uid()) where id = e.id;
  else raise exception 'Unknown action';
  end if;
end $$;

create or replace function public.uni_hostel_visitor_in(p_student uuid, p_name text, p_phone text default null, p_relationship text default null, p_purpose text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a public.uni_hostel_allocations; v_id uuid;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter the visitor''s name'; end if;
  select * into a from public.uni_hostel_allocations where student_id = p_student and status = 'checked_in'
    and session_id = uni_private.current_session(tenant_id);
  if a.id is null or a.tenant_id is distinct from uni_private.my_tenant() or not uni_private.can_run_hostel(a.hostel_id) then
    raise exception 'That student is not checked in to this hall';
  end if;
  insert into public.uni_hostel_visitors (tenant_id, hostel_id, student_id, visitor_name, visitor_phone, relationship, purpose, logged_by)
  values (a.tenant_id, a.hostel_id, p_student, trim(p_name), nullif(trim(p_phone), ''), nullif(trim(p_relationship), ''), nullif(trim(p_purpose), ''), (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.uni_hostel_visitor_out(p_visit uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.uni_hostel_visitors;
begin
  select * into v from public.uni_hostel_visitors where id = p_visit for update;
  if v.id is null or v.tenant_id is distinct from uni_private.my_tenant() or not uni_private.can_run_hostel(v.hostel_id) then raise exception 'Visit not found'; end if;
  if v.time_out is not null then raise exception 'This visitor has already signed out'; end if;
  update public.uni_hostel_visitors set time_out = now(), signed_out_by = (select auth.uid()) where id = v.id;
end $$;

-- Residents of a hall (names for porters, who cannot read the student directory)
create or replace function public.uni_hostel_residents(p_hostel uuid)
returns table (allocation_id uuid, student_id uuid, full_name text, matric_no text, level int, programme text,
               room text, bed text, status text, amount numeric, paid numeric, reserved_at timestamptz, expires_at timestamptz,
               checked_in_at timestamptz, checked_out_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not uni_private.can_run_hostel(p_hostel) and not coalesce(uni_private.my_role() in ('registrar', 'bursar'), false) then
    raise exception 'Not allowed';
  end if;
  return query
    select a.id, a.student_id, p.full_name, s.matric_no, s.level, pr.name, r.name, b.label, a.status, a.amount,
           uni_private.hostel_paid(a.student_id, a.session_id), a.reserved_at, a.expires_at, a.checked_in_at, a.checked_out_at
    from public.uni_hostel_allocations a
    join public.uni_students s on s.id = a.student_id
    join public.uni_profiles p on p.id = a.student_id
    join public.uni_programmes pr on pr.id = s.programme_id
    join public.uni_hostel_beds b on b.id = a.bed_id
    join public.uni_hostel_rooms r on r.id = b.room_id
    where a.hostel_id = p_hostel and a.tenant_id = uni_private.my_tenant()
      and a.session_id = uni_private.current_session(a.tenant_id)
      and a.status in ('reserved', 'confirmed', 'checked_in', 'checked_out')
    order by r.name, b.label, a.reserved_at;
end $$;

-- Occupancy per hall for the current session (also releases lapsed holds)
create or replace function public.uni_hostel_occupancy()
returns table (hostel_id uuid, hostel text, gender text, is_active boolean, beds bigint, reserved bigint, confirmed bigint, checked_in bigint, free bigint)
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid := uni_private.my_tenant(); v_ses uuid;
begin
  if not (uni_private.is_hostel_admin() or uni_private.my_hostel() is not null or uni_private.is_admin() or uni_private.my_role() = 'bursar') then
    raise exception 'Not allowed';
  end if;
  perform uni_private.expire_hostel_holds(v_tenant);
  v_ses := uni_private.current_session(v_tenant);
  return query
    select h.id, h.name, h.gender, h.is_active,
           count(b.id) filter (where b.is_active and r.is_active),
           count(a.id) filter (where a.status = 'reserved'),
           count(a.id) filter (where a.status = 'confirmed'),
           count(a.id) filter (where a.status = 'checked_in'),
           count(b.id) filter (where b.is_active and r.is_active and a.id is null)
    from public.uni_hostels h
    left join public.uni_hostel_rooms r on r.hostel_id = h.id
    left join public.uni_hostel_beds b on b.room_id = r.id
    left join public.uni_hostel_allocations a on a.bed_id = b.id and a.session_id = v_ses and a.status in ('reserved', 'confirmed', 'checked_in')
    where h.tenant_id = v_tenant
    group by h.id, h.name, h.gender, h.is_active
    order by h.name;
end $$;

-- ===== school-fee sums now ignore hostel payments =====
create or replace function public.uni_pay_fees_demo() returns numeric
language plpgsql security definer set search_path = '' as $$
declare v_st public.uni_students; v_ses uuid; v_due numeric; v_paid numeric; v_allowed boolean;
begin
  select * into v_st from public.uni_students where id = (select auth.uid());
  if v_st.id is null then raise exception 'Only students can pay fees'; end if;
  select allow_demo_payments into v_allowed from public.uni_settings where tenant_id = v_st.tenant_id;
  if not coalesce(v_allowed, false) then raise exception 'Demo payments are switched off. Please pay online.'; end if;
  select session_id into v_ses from public.uni_semesters where tenant_id = v_st.tenant_id and is_current;
  v_due := public.uni_fees_due(v_st.id, v_ses);
  select coalesce(sum(amount),0) into v_paid from public.uni_payments
   where student_id = v_st.id and session_id = v_ses and status = 'successful' and purpose = 'school_fees';
  if v_due - v_paid <= 0 then raise exception 'No outstanding fees for this session'; end if;
  insert into public.uni_payments (tenant_id, student_id, session_id, amount, reference, channel)
  values (v_st.tenant_id, v_st.id, v_ses, v_due - v_paid, 'DEMO-' || upper(substr(md5(random()::text), 1, 10)), 'demo');
  return v_due - v_paid;
end $$;

create or replace function public.uni_submit_registration(p_offering_ids uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_st public.uni_students; v_sem public.uni_semesters; v_set public.uni_settings;
        v_reg uuid; v_status text; v_units int; v_missing text; v_bad int; v_due numeric; v_paid numeric;
begin
  select * into v_st from public.uni_students where id = (select auth.uid());
  if v_st.id is null then raise exception 'Only students can register courses'; end if;
  select * into v_sem from public.uni_semesters where tenant_id = v_st.tenant_id and is_current;
  if not v_sem.registration_open then raise exception 'Course registration is closed for this semester'; end if;
  select * into v_set from public.uni_settings where tenant_id = v_st.tenant_id;

  select count(*) into v_bad from unnest(p_offering_ids) x(id)
    where x.id not in (select a.offering_id from public.uni_available_courses() a);
  if v_bad > 0 then raise exception 'One or more selected courses are not available to you'; end if;

  select string_agg(a.code, ', ') into v_missing from public.uni_available_courses() a
    where (a.is_compulsory or a.is_carryover) and a.offering_id <> all(p_offering_ids);
  if v_missing is not null then raise exception 'You must register these compulsory/carry-over courses: %', v_missing; end if;

  select coalesce(sum(c.units),0) into v_units from public.uni_course_offerings o join public.uni_courses c on c.id = o.course_id
    where o.id = any(p_offering_ids);
  if v_units < v_set.min_units or v_units > v_set.max_units then
    raise exception 'Total units must be between % and %; you selected %', v_set.min_units, v_set.max_units, v_units; end if;

  if v_set.require_fees_for_registration then
    v_due := public.uni_fees_due(v_st.id, v_sem.session_id);
    select coalesce(sum(amount),0) into v_paid from public.uni_payments
     where student_id = v_st.id and session_id = v_sem.session_id and status = 'successful' and purpose = 'school_fees';
    if v_paid < v_due then raise exception 'Pay your session fees before registering (outstanding: %)', v_due - v_paid; end if;
  end if;

  select id, status into v_reg, v_status from public.uni_registrations where student_id = v_st.id and semester_id = v_sem.id;
  if v_status = 'approved' then raise exception 'Your registration is already approved'; end if;
  if v_reg is null then
    insert into public.uni_registrations (tenant_id, student_id, semester_id) values (v_st.tenant_id, v_st.id, v_sem.id) returning id into v_reg;
  else
    update public.uni_registrations set status = 'submitted', submitted_at = now(), decided_by = null, decided_at = null where id = v_reg;
    delete from public.uni_registration_courses where registration_id = v_reg;
  end if;
  insert into public.uni_registration_courses (tenant_id, registration_id, offering_id, is_carryover)
  select v_st.tenant_id, v_reg, a.offering_id, a.is_carryover from public.uni_available_courses() a where a.offering_id = any(p_offering_ids);
  return v_reg;
end $$;

-- Bursary bank payments name what they are for
drop function if exists public.uni_record_manual_payment(uuid, numeric, text, text, date, text);
create or replace function public.uni_record_manual_payment(
  p_student uuid, p_amount numeric, p_reference text, p_channel text, p_paid_on date, p_note text default null, p_purpose text default 'school_fees'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_ses uuid; v_id uuid; v_ref text := upper(trim(p_reference)); v_alloc uuid;
begin
  if uni_private.my_role() not in ('bursar', 'registrar', 'admin') then raise exception 'Only the Bursary can record payments'; end if;
  select tenant_id into v_tenant from public.uni_students where id = p_student;
  if v_tenant is distinct from uni_private.my_tenant() then raise exception 'Student not found'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  if coalesce(v_ref, '') = '' then raise exception 'Enter the bank teller or transfer reference'; end if;
  if p_channel not in ('bank_teller', 'bank_transfer', 'pos') then raise exception 'Unknown payment channel'; end if;
  if p_purpose not in ('school_fees', 'hostel') then raise exception 'Unknown payment purpose'; end if;
  if p_paid_on > current_date then raise exception 'Payment date cannot be in the future'; end if;
  if exists (select 1 from public.uni_payments where reference = v_ref) then raise exception 'Reference % has already been recorded', v_ref; end if;
  select session_id into v_ses from public.uni_semesters where tenant_id = v_tenant and is_current;
  if p_purpose = 'hostel' then
    select id into v_alloc from public.uni_hostel_allocations where student_id = p_student and session_id = v_ses
     order by (status in ('reserved', 'confirmed', 'checked_in')) desc, reserved_at desc limit 1;
    if v_alloc is null then raise exception 'This student has not applied for a hostel this session'; end if;
  end if;
  insert into public.uni_payments (tenant_id, student_id, session_id, amount, reference, channel, status, paid_at, verified_at, recorded_by, note, purpose, allocation_id)
  values (v_tenant, p_student, v_ses, p_amount, v_ref, p_channel, 'successful', coalesce(p_paid_on, current_date)::timestamptz, now(), (select auth.uid()),
          nullif(trim(p_note), ''), p_purpose, v_alloc)
  returning id into v_id;
  return v_id;
end $$;

-- ===== row level security =====
alter table public.uni_hostels enable row level security;
alter table public.uni_hostel_rooms enable row level security;
alter table public.uni_hostel_beds enable row level security;
alter table public.uni_hostel_allocations enable row level security;
alter table public.uni_hostel_change_requests enable row level security;
alter table public.uni_hostel_maintenance enable row level security;
alter table public.uni_hostel_exeats enable row level security;
alter table public.uni_hostel_visitors enable row level security;

-- Halls, rooms and beds: everyone in the university can read; the hostel office manages them
do $$
declare t text;
begin
  foreach t in array array['uni_hostels', 'uni_hostel_rooms'] loop
    execute format('create policy %I on public.%I for select to authenticated using (tenant_id = (select uni_private.my_tenant()))', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (tenant_id = (select uni_private.my_tenant()) and (select uni_private.is_hostel_admin()))', t || '_admin_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (tenant_id = (select uni_private.my_tenant()) and (select uni_private.is_hostel_admin())) with check (tenant_id = (select uni_private.my_tenant()))', t || '_admin_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (tenant_id = (select uni_private.my_tenant()) and (select uni_private.is_hostel_admin()))', t || '_admin_del', t);
  end loop;
end $$;
create policy uni_hostel_beds_read on public.uni_hostel_beds for select to authenticated using (tenant_id = (select uni_private.my_tenant()));
create policy uni_hostel_beds_admin_upd on public.uni_hostel_beds for update to authenticated
  using (tenant_id = (select uni_private.my_tenant()) and (select uni_private.is_hostel_admin())) with check (tenant_id = (select uni_private.my_tenant()));

create policy uni_hostel_allocations_read on public.uni_hostel_allocations for select to authenticated using (
  tenant_id = (select uni_private.my_tenant()) and (
    student_id = (select auth.uid()) or (select uni_private.is_hostel_admin()) or hostel_id = (select uni_private.my_hostel())
    or (select uni_private.my_role()) in ('registrar', 'bursar')));
create policy uni_hostel_change_read on public.uni_hostel_change_requests for select to authenticated using (
  tenant_id = (select uni_private.my_tenant()) and (student_id = (select auth.uid()) or (select uni_private.is_hostel_admin())));
create policy uni_hostel_maint_read on public.uni_hostel_maintenance for select to authenticated using (
  tenant_id = (select uni_private.my_tenant()) and (
    reported_by = (select auth.uid()) or student_id = (select auth.uid()) or (select uni_private.is_hostel_admin()) or hostel_id = (select uni_private.my_hostel())));
create policy uni_hostel_exeats_read on public.uni_hostel_exeats for select to authenticated using (
  tenant_id = (select uni_private.my_tenant()) and (
    student_id = (select auth.uid()) or (select uni_private.is_hostel_admin()) or hostel_id = (select uni_private.my_hostel())));
create policy uni_hostel_visitors_read on public.uni_hostel_visitors for select to authenticated using (
  tenant_id = (select uni_private.my_tenant()) and (
    student_id = (select auth.uid()) or (select uni_private.is_hostel_admin()) or hostel_id = (select uni_private.my_hostel())));

-- Porters (and the hostel office) can read their own profile and the hall's room list; nothing else changes for them.
-- Payments: the hostel office sees hostel payments.
drop policy if exists uni_payments_read on public.uni_payments;
create policy uni_payments_read on public.uni_payments for select to authenticated using (
  tenant_id = (select uni_private.my_tenant()) and (
    student_id = (select auth.uid()) or (select uni_private.my_role()) in ('bursar', 'registrar', 'admin')
    or (purpose = 'hostel' and (select uni_private.is_hostel_admin()))));

-- grants: reads only for signed-in users, nothing for anonymous; writes only where a policy allows
do $$
declare t text;
begin
  foreach t in array array['uni_hostels', 'uni_hostel_rooms', 'uni_hostel_beds', 'uni_hostel_allocations', 'uni_hostel_change_requests',
                           'uni_hostel_maintenance', 'uni_hostel_exeats', 'uni_hostel_visitors'] loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
  foreach t in array array['uni_hostel_allocations', 'uni_hostel_change_requests', 'uni_hostel_maintenance', 'uni_hostel_exeats', 'uni_hostel_visitors'] loop
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;
revoke insert, delete, truncate on public.uni_hostel_beds from authenticated;

-- audit and deactivated-account guards
do $$
declare t text;
begin
  foreach t in array array['uni_hostels', 'uni_hostel_rooms', 'uni_hostel_allocations', 'uni_hostel_change_requests', 'uni_hostel_maintenance', 'uni_hostel_exeats', 'uni_hostel_visitors'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function uni_private.audit()', t || '_audit', t);
    execute format('drop trigger if exists %I on public.%I', t || '_block_inactive', t);
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function uni_private.block_inactive_writer()', t || '_block_inactive', t);
  end loop;
end $$;

-- function grants
revoke execute on function uni_private.is_hostel_admin(), uni_private.my_hostel(), uni_private.can_run_hostel(uuid),
  uni_private.current_session(uuid), uni_private.hostel_paid(uuid, uuid), uni_private.expire_hostel_holds(uuid),
  uni_private.settle_hostel(uuid, uuid), uni_private.pick_bed(uuid, uuid, uuid, text, numeric) from public, anon;
grant execute on function uni_private.is_hostel_admin(), uni_private.my_hostel(), uni_private.is_staff() to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'uni_hostel_my_room()', 'uni_hostel_options()', 'uni_hostel_apply(uuid, text)', 'uni_hostel_cancel(uuid, text)',
    'uni_hostel_request_change(text, uuid, text)', 'uni_hostel_cancel_change(uuid)', 'uni_hostel_report_fault(text, text, text, uuid)',
    'uni_hostel_request_exeat(text, text, text, timestamptz, timestamptz)', 'uni_hostel_cancel_exeat(uuid)', 'uni_hostel_pay_demo()',
    'uni_hostel_allocate(uuid, uuid)', 'uni_hostel_decide_change(uuid, boolean, uuid, text)', 'uni_hostel_decide_exeat(uuid, boolean, text)',
    'uni_hostel_update_fault(uuid, text, text, text)', 'uni_hostel_check_in(uuid, text)', 'uni_hostel_check_out(uuid, text)',
    'uni_hostel_exeat_gate(uuid, text)', 'uni_hostel_visitor_in(uuid, text, text, text, text)', 'uni_hostel_visitor_out(uuid)',
    'uni_hostel_residents(uuid)', 'uni_hostel_occupancy()',
    'uni_record_manual_payment(uuid, numeric, text, text, date, text, text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

create index if not exists uni_hostel_rooms_hostel on public.uni_hostel_rooms (hostel_id);
create index if not exists uni_hostel_beds_room on public.uni_hostel_beds (room_id);
create index if not exists uni_payments_allocation on public.uni_payments (allocation_id);
create index if not exists uni_profiles_hostel on public.uni_profiles (hostel_id);
