-- A room change picked automatically must land in a different room, not another bed in the same room.
drop function if exists uni_private.pick_bed(uuid, uuid, uuid, text, numeric);
create or replace function uni_private.pick_bed(p_student uuid, p_session uuid, p_hostel uuid, p_room_type text, p_max_fee numeric, p_not_room uuid default null)
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
    and (p_not_room is null or r.id <> p_not_room)
    and (r.levels is null or v_st.level = any(r.levels))
    and not exists (select 1 from public.uni_hostel_allocations a where a.bed_id = b.id and a.session_id = p_session
                    and a.status in ('reserved', 'confirmed', 'checked_in'))
  order by h.name, r.name, b.label
  limit 1
  for update of b skip locked;
  return v_bed;
end $$;
revoke execute on function uni_private.pick_bed(uuid, uuid, uuid, text, numeric, uuid) from public, anon;

create or replace function public.uni_hostel_decide_change(p_request uuid, p_approve boolean, p_bed uuid default null, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.uni_hostel_change_requests; a public.uni_hostel_allocations; v_bed uuid := p_bed; v_hostel uuid; v_fee numeric; v_gender text; v_g text; v_room uuid;
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
  select room_id into v_room from public.uni_hostel_beds where id = a.bed_id;
  if v_bed is null then
    v_bed := uni_private.pick_bed(a.student_id, a.session_id, q.preferred_hostel_id, q.preferred_room_type, a.amount, v_room);
    if v_bed is null then raise exception 'No free bed in another room matches the request at the same or lower fee. Pick a bed by hand.'; end if;
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

-- uni_hostel_apply called the old 5-argument pick_bed; recreate it against the new signature
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
  v_bed := uni_private.pick_bed(v_st.id, v_ses, p_hostel, nullif(trim(p_room_type), ''), null, null);
  if v_bed is null then raise exception 'No bed is free for that choice. Try another hall or room type.'; end if;
  select r.fee, r.hostel_id into v_fee, v_hostel from public.uni_hostel_beds b join public.uni_hostel_rooms r on r.id = b.room_id where b.id = v_bed;
  insert into public.uni_hostel_allocations (tenant_id, session_id, student_id, hostel_id, bed_id, status, amount, expires_at, confirmed_at)
  values (v_st.tenant_id, v_ses, v_st.id, v_hostel, v_bed, case when v_fee = 0 then 'confirmed' else 'reserved' end, v_fee,
          now() + make_interval(hours => v_set.hostel_hold_hours), case when v_fee = 0 then now() end)
  returning id into v_id;
  perform uni_private.settle_hostel(v_st.id, v_ses);
  return v_id;
end $$;
