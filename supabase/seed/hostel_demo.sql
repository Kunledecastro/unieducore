-- Demo data for hostel management (Unity Demo University, short name UDU). Run once as the database owner.
do $$
declare t uuid; ses uuid; amina uuid; awo uuid; r uuid; v_ada uuid; v_alloc uuid; v_officer uuid; v_pa uuid; v_pb uuid; v_bursar uuid;
begin
  select id into t from public.uni_tenants where short_name = 'UDU';
  select session_id into ses from public.uni_semesters where tenant_id = t and is_current;

  update public.uni_students s set gender = g.gender from (values
    ('ada@udu.demo', 'female'), ('chioma@udu.demo', 'female'), ('tunde@udu.demo', 'male'), ('musa@udu.demo', 'male')) g(email, gender)
  where s.id = (select id from public.uni_profiles where email = g.email);

  insert into public.uni_hostels (tenant_id, name, gender, description) values
    (t, 'Queen Amina Hall', 'female', 'Female hall beside the library'),
    (t, 'Obafemi Awolowo Hall', 'male', 'Male hall near the sports complex')
  on conflict (tenant_id, name) do nothing;
  select id into amina from public.uni_hostels where tenant_id = t and name = 'Queen Amina Hall';
  select id into awo from public.uni_hostels where tenant_id = t and name = 'Obafemi Awolowo Hall';

  insert into public.uni_hostel_rooms (tenant_id, hostel_id, name, floor, room_type, capacity, fee) values
    (t, amina, 'A101', 'Ground', 'Standard (4 per room)', 4, 85000), (t, amina, 'A102', 'Ground', 'Standard (4 per room)', 4, 85000),
    (t, amina, 'A103', 'Ground', 'Standard (4 per room)', 4, 85000), (t, amina, 'A201', 'First', 'Premium (2 per room)', 2, 150000),
    (t, amina, 'A202', 'First', 'Premium (2 per room)', 2, 150000),
    (t, awo, 'B101', 'Ground', 'Standard (4 per room)', 4, 85000), (t, awo, 'B102', 'Ground', 'Standard (4 per room)', 4, 85000),
    (t, awo, 'B103', 'Ground', 'Standard (4 per room)', 4, 85000), (t, awo, 'B201', 'First', 'Premium (2 per room)', 2, 150000),
    (t, awo, 'B202', 'First', 'Premium (2 per room)', 2, 150000)
  on conflict (hostel_id, name) do nothing;

  if not exists (select 1 from public.uni_profiles where email = 'hostel@udu.demo') then
    v_officer := uni_private.seed_user(t, 'hostel@udu.demo', 'Mrs. Funke Adebayo', 'hostel_officer', null);
    v_pa := uni_private.seed_user(t, 'porter.amina@udu.demo', 'Mrs. Grace Etim', 'porter', null);
    v_pb := uni_private.seed_user(t, 'porter.awo@udu.demo', 'Mr. Sunday Okon', 'porter', null);
    update public.uni_profiles set hostel_id = amina where id = v_pa;
    update public.uni_profiles set hostel_id = awo where id = v_pb;
  end if;
  select id into v_officer from public.uni_profiles where email = 'hostel@udu.demo';
  select id into v_bursar from public.uni_profiles where email = 'bursar@udu.demo';

  update public.uni_settings set hostel_applications_open = true where tenant_id = t;

  -- Ada: paid and checked in to A101, bed A
  select id into v_ada from public.uni_profiles where email = 'ada@udu.demo';
  if not exists (select 1 from public.uni_hostel_allocations where student_id = v_ada and session_id = ses) then
    select id into r from public.uni_hostel_rooms where hostel_id = amina and name = 'A101';
    insert into public.uni_hostel_allocations (tenant_id, session_id, student_id, hostel_id, bed_id, status, amount, expires_at)
    values (t, ses, v_ada, amina, (select id from public.uni_hostel_beds where room_id = r and label = 'A'), 'reserved', 85000, now() + interval '72 hours')
    returning id into v_alloc;
    insert into public.uni_payments (tenant_id, student_id, session_id, amount, reference, channel, status, paid_at, verified_at, recorded_by, purpose, allocation_id)
    values (t, v_ada, ses, 85000, 'HST-DEMO-0001', 'bank_transfer', 'successful', now() - interval '3 days', now(), v_bursar, 'hostel', v_alloc);
    update public.uni_hostel_allocations set status = 'checked_in', checked_in_at = now() - interval '2 days',
      checked_in_by = (select id from public.uni_profiles where email = 'porter.amina@udu.demo'), condition_in = 'Good. Mattress, wardrobe and reading table in place.'
    where id = v_alloc;
    insert into public.uni_hostel_maintenance (tenant_id, hostel_id, room_id, student_id, reported_by, category, priority, description)
    values (t, amina, r, v_ada, v_ada, 'electrical', 'normal', 'The socket beside bed A does not work.');
  end if;
end $$;
