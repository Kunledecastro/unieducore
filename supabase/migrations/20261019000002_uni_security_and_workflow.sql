create schema if not exists uni_private;
revoke all on schema uni_private from public, anon;
grant usage on schema uni_private to authenticated;

-- ===== helpers =====
create or replace function uni_private.my_tenant() returns uuid
language sql stable security definer set search_path = '' as
$$ select tenant_id from public.uni_profiles where id = (select auth.uid()) $$;

create or replace function uni_private.my_role() returns public.uni_role
language sql stable security definer set search_path = '' as
$$ select role from public.uni_profiles where id = (select auth.uid()) $$;

create or replace function uni_private.my_department() returns uuid
language sql stable security definer set search_path = '' as
$$ select department_id from public.uni_profiles where id = (select auth.uid()) $$;

create or replace function uni_private.is_staff() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select role <> 'student' from public.uni_profiles where id = (select auth.uid())), false) $$;

create or replace function uni_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select role in ('admin','registrar') from public.uni_profiles where id = (select auth.uid())), false) $$;

grant execute on all functions in schema uni_private to authenticated;

-- ===== policies: reference data readable within tenant, managed by admin/registrar =====
create policy uni_tenants_read on public.uni_tenants for select to authenticated using (id = (select uni_private.my_tenant()));

do $$ declare t text; begin
  foreach t in array array['uni_settings','uni_grade_bands','uni_degree_classes','uni_faculties','uni_departments','uni_programmes','uni_sessions','uni_semesters','uni_courses','uni_programme_courses','uni_fee_items','uni_course_offerings'] loop
    execute format('create policy %I on public.%I for select to authenticated using (tenant_id = (select uni_private.my_tenant()))', t||'_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (tenant_id = (select uni_private.my_tenant()) and (select uni_private.is_admin()))', t||'_admin_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (tenant_id = (select uni_private.my_tenant()) and (select uni_private.is_admin())) with check (tenant_id = (select uni_private.my_tenant()))', t||'_admin_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (tenant_id = (select uni_private.my_tenant()) and (select uni_private.is_admin()))', t||'_admin_del', t);
  end loop;
end $$;

create policy uni_profiles_read on public.uni_profiles for select to authenticated
  using (tenant_id = (select uni_private.my_tenant()) and (id = (select auth.uid()) or (select uni_private.is_staff())));
create policy uni_profiles_admin_upd on public.uni_profiles for update to authenticated
  using (tenant_id = (select uni_private.my_tenant()) and (select uni_private.is_admin()))
  with check (tenant_id = (select uni_private.my_tenant()));

create policy uni_students_read on public.uni_students for select to authenticated
  using (tenant_id = (select uni_private.my_tenant()) and (id = (select auth.uid()) or (select uni_private.is_staff())));
create policy uni_students_admin_upd on public.uni_students for update to authenticated
  using (tenant_id = (select uni_private.my_tenant()) and (select uni_private.is_admin()))
  with check (tenant_id = (select uni_private.my_tenant()));

create policy uni_registrations_read on public.uni_registrations for select to authenticated
  using (tenant_id = (select uni_private.my_tenant()) and (student_id = (select auth.uid()) or (select uni_private.is_staff())));

create policy uni_registration_courses_read on public.uni_registration_courses for select to authenticated
  using (tenant_id = (select uni_private.my_tenant()) and ((select uni_private.is_staff()) or exists (
    select 1 from public.uni_registrations r where r.id = registration_id and r.student_id = (select auth.uid()))));

create policy uni_scores_read on public.uni_scores for select to authenticated
  using (tenant_id = (select uni_private.my_tenant()) and ((select uni_private.is_staff()) or exists (
    select 1 from public.uni_registration_courses rc
    join public.uni_registrations r on r.id = rc.registration_id
    join public.uni_course_offerings o on o.id = rc.offering_id
    where rc.id = registration_course_id and r.student_id = (select auth.uid()) and o.result_status = 'released')));

create policy uni_payments_read on public.uni_payments for select to authenticated
  using (tenant_id = (select uni_private.my_tenant()) and (student_id = (select auth.uid())
    or (select uni_private.my_role()) in ('bursar','registrar','admin')));

create policy uni_audit_read on public.uni_audit_log for select to authenticated
  using (tenant_id = (select uni_private.my_tenant()) and (select uni_private.is_admin()));

-- ===== audit trail =====
create or replace function uni_private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.uni_audit_log (tenant_id, table_name, record_id, action, old_data, new_data)
  values (coalesce(new.tenant_id, old.tenant_id), tg_table_name, coalesce(new.id, old.id), tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger uni_scores_audit after insert or update or delete on public.uni_scores for each row execute function uni_private.audit();
create trigger uni_offerings_audit after update on public.uni_course_offerings for each row execute function uni_private.audit();
create trigger uni_registrations_audit after insert or update or delete on public.uni_registrations for each row execute function uni_private.audit();
create trigger uni_payments_audit after insert or update on public.uni_payments for each row execute function uni_private.audit();

-- ===== results view (respects caller's RLS) =====
create or replace view public.uni_v_results with (security_invoker = true) as
select rc.id as registration_course_id, r.tenant_id, r.student_id, r.semester_id,
       sem.number as semester_number, sem.name as semester_name, ses.id as session_id, ses.name as session_name,
       o.id as offering_id, o.result_status, c.id as course_id, c.code, c.title, c.units,
       rc.is_carryover, s.ca, s.exam, s.total, g.grade, g.points
from public.uni_registration_courses rc
join public.uni_registrations r on r.id = rc.registration_id and r.status = 'approved'
join public.uni_course_offerings o on o.id = rc.offering_id
join public.uni_courses c on c.id = o.course_id
join public.uni_semesters sem on sem.id = r.semester_id
join public.uni_sessions ses on ses.id = sem.session_id
left join public.uni_scores s on s.registration_course_id = rc.id
left join lateral (
  select b.grade, b.points from public.uni_grade_bands b
  where b.tenant_id = r.tenant_id and s.total is not null and s.total >= b.min_score
  order by b.min_score desc limit 1) g on true;

create or replace function public.uni_semester_gpas(p_student uuid)
returns table (semester_id uuid, session_name text, semester_name text, semester_number int,
               units bigint, quality_points numeric, gpa numeric, cum_units numeric, cum_quality_points numeric, cgpa numeric)
language sql stable security invoker set search_path = '' as $$
  with per as (
    select v.semester_id, v.session_name, v.semester_name, v.semester_number,
           sum(v.units) as units, sum(v.units * v.points) as qp
    from public.uni_v_results v
    where v.student_id = p_student and v.result_status = 'released' and v.grade is not null
    group by 1,2,3,4)
  select semester_id, session_name, semester_name, semester_number, units, qp,
         round(qp / nullif(units,0), 2),
         sum(units) over w, sum(qp) over w,
         round(sum(qp) over w / nullif(sum(units) over w, 0), 2)
  from per window w as (order by session_name, semester_number rows between unbounded preceding and current row)
  order by session_name, semester_number;
$$;

create or replace function public.uni_fees_due(p_student uuid, p_session uuid) returns numeric
language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(f.amount),0) from public.uni_fee_items f
  join public.uni_students s on s.id = p_student
  where f.session_id = p_session and f.tenant_id = s.tenant_id
    and (f.programme_id is null or f.programme_id = s.programme_id)
    and (f.level is null or f.level = s.level);
$$;

create or replace function public.uni_available_courses()
returns table (offering_id uuid, course_id uuid, code text, title text, units int, is_compulsory boolean, is_carryover boolean, selected boolean)
language sql stable security definer set search_path = '' as $$
  with me as (select s.* from public.uni_students s where s.id = (select auth.uid())),
  sem as (select x.* from public.uni_semesters x join me on x.tenant_id = me.tenant_id where x.is_current),
  myreg as (select r.id from public.uni_registrations r join sem on r.semester_id = sem.id where r.student_id = (select auth.uid())),
  failed as (
    select v.course_id from public.uni_v_results v
    where v.student_id = (select auth.uid()) and v.result_status = 'released' and v.grade is not null
    group by v.course_id having max(v.points) = 0),
  candidates as (
    select o.id as offering_id, c.id as course_id, c.code, c.title, c.units, pc.is_compulsory, false as is_carryover
    from me join public.uni_programme_courses pc on pc.programme_id = me.programme_id
    join public.uni_courses c on c.id = pc.course_id and c.level = me.level
    join sem on c.semester_number = sem.number
    join public.uni_course_offerings o on o.course_id = c.id and o.semester_id = sem.id
    union
    select o.id, c.id, c.code, c.title, c.units, true, true
    from failed f join public.uni_courses c on c.id = f.course_id
    join sem on c.semester_number = sem.number
    join public.uni_course_offerings o on o.course_id = c.id and o.semester_id = sem.id)
  select cd.*, exists (select 1 from public.uni_registration_courses rc join myreg on rc.registration_id = myreg.id where rc.offering_id = cd.offering_id)
  from candidates cd order by cd.is_carryover desc, cd.code;
$$;

-- ===== workflow functions (the only write path; each checks role + tenant) =====
create or replace function public.uni_pay_fees_demo() returns numeric
language plpgsql security definer set search_path = '' as $$
declare v_st public.uni_students; v_ses uuid; v_due numeric; v_paid numeric;
begin
  select * into v_st from public.uni_students where id = (select auth.uid());
  if v_st.id is null then raise exception 'Only students can pay fees'; end if;
  select session_id into v_ses from public.uni_semesters where tenant_id = v_st.tenant_id and is_current;
  v_due := public.uni_fees_due(v_st.id, v_ses);
  select coalesce(sum(amount),0) into v_paid from public.uni_payments where student_id = v_st.id and session_id = v_ses and status = 'successful';
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
    select coalesce(sum(amount),0) into v_paid from public.uni_payments where student_id = v_st.id and session_id = v_sem.session_id and status = 'successful';
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

create or replace function public.uni_decide_registration(p_registration uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_dept uuid; v_tenant uuid; v_status text;
begin
  select p.department_id, r.tenant_id, r.status into v_dept, v_tenant, v_status
  from public.uni_registrations r join public.uni_students s on s.id = r.student_id
  join public.uni_programmes p on p.id = s.programme_id where r.id = p_registration;
  if v_tenant is distinct from uni_private.my_tenant() then raise exception 'Registration not found'; end if;
  if not (uni_private.is_admin() or (uni_private.my_role() = 'hod' and uni_private.my_department() = v_dept)) then
    raise exception 'Only the HOD of the student''s department or the Registry can decide registrations'; end if;
  if v_status <> 'submitted' then raise exception 'Only submitted registrations can be decided'; end if;
  update public.uni_registrations set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = (select auth.uid()), decided_at = now() where id = p_registration;
end $$;

create or replace function public.uni_save_scores(p_offering uuid, p_scores jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_o public.uni_course_offerings; v_set public.uni_settings; e jsonb; v_rc uuid; v_ca numeric; v_ex numeric; n int := 0;
begin
  select * into v_o from public.uni_course_offerings where id = p_offering;
  if v_o.tenant_id is distinct from uni_private.my_tenant() then raise exception 'Course not found'; end if;
  if not (v_o.lecturer_id = (select auth.uid()) or uni_private.is_admin()) then raise exception 'Only the course lecturer can enter scores'; end if;
  if v_o.result_status <> 'draft' then raise exception 'Scores are locked: result is %', v_o.result_status; end if;
  select * into v_set from public.uni_settings where tenant_id = v_o.tenant_id;
  for e in select * from jsonb_array_elements(p_scores) loop
    v_rc := (e->>'registration_course_id')::uuid;
    v_ca := nullif(e->>'ca','')::numeric; v_ex := nullif(e->>'exam','')::numeric;
    if not exists (select 1 from public.uni_registration_courses rc join public.uni_registrations r on r.id = rc.registration_id
                   where rc.id = v_rc and rc.offering_id = p_offering and r.status = 'approved') then
      raise exception 'Student is not registered on this course'; end if;
    if v_ca < 0 or v_ca > v_set.ca_max then raise exception 'CA must be between 0 and %', v_set.ca_max; end if;
    if v_ex < 0 or v_ex > v_set.exam_max then raise exception 'Exam must be between 0 and %', v_set.exam_max; end if;
    insert into public.uni_scores (tenant_id, registration_course_id, ca, exam, updated_by)
    values (v_o.tenant_id, v_rc, v_ca, v_ex, (select auth.uid()))
    on conflict (registration_course_id) do update set ca = excluded.ca, exam = excluded.exam, updated_by = excluded.updated_by, updated_at = now()
    where public.uni_scores.ca is distinct from excluded.ca or public.uni_scores.exam is distinct from excluded.exam;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.uni_advance_result(p_offering uuid, p_action text) returns public.uni_result_status
language plpgsql security definer set search_path = '' as $$
declare v_o public.uni_course_offerings; v_dept uuid; v_missing int; v_new public.uni_result_status;
        v_is_hod boolean; v_is_admin boolean;
begin
  select * into v_o from public.uni_course_offerings where id = p_offering for update;
  if v_o.tenant_id is distinct from uni_private.my_tenant() then raise exception 'Course not found'; end if;
  select department_id into v_dept from public.uni_courses where id = v_o.course_id;
  v_is_admin := uni_private.is_admin();
  v_is_hod := uni_private.my_role() = 'hod' and uni_private.my_department() = v_dept;

  if p_action = 'submit' then
    if not (v_o.lecturer_id = (select auth.uid()) or v_is_admin) then raise exception 'Only the course lecturer can submit'; end if;
    if v_o.result_status <> 'draft' then raise exception 'Result is already %', v_o.result_status; end if;
    select count(*) into v_missing from public.uni_registration_courses rc
      join public.uni_registrations r on r.id = rc.registration_id and r.status = 'approved'
      left join public.uni_scores s on s.registration_course_id = rc.id
      where rc.offering_id = p_offering and (s.ca is null or s.exam is null);
    if v_missing > 0 then raise exception '% student(s) still have missing CA or exam scores', v_missing; end if;
    update public.uni_course_offerings set result_status = 'submitted', submitted_at = now() where id = p_offering;
    v_new := 'submitted';
  elsif p_action = 'hod_approve' then
    if not (v_is_hod or v_is_admin) then raise exception 'Only the HOD of the course''s department can approve'; end if;
    if v_o.result_status <> 'submitted' then raise exception 'Result must be submitted first (now %)', v_o.result_status; end if;
    update public.uni_course_offerings set result_status = 'hod_approved', hod_approved_by = (select auth.uid()), hod_approved_at = now() where id = p_offering;
    v_new := 'hod_approved';
  elsif p_action = 'return' then
    if not (v_is_hod or v_is_admin) then raise exception 'Only the HOD or Registry can return a result'; end if;
    if v_o.result_status not in ('submitted','hod_approved') then raise exception 'Result cannot be returned at status %', v_o.result_status; end if;
    update public.uni_course_offerings set result_status = 'draft', submitted_at = null, hod_approved_by = null, hod_approved_at = null where id = p_offering;
    v_new := 'draft';
  elsif p_action = 'senate_approve' then
    if not v_is_admin then raise exception 'Only the Registry can record Senate approval'; end if;
    if v_o.result_status <> 'hod_approved' then raise exception 'Result must be HOD-approved first (now %)', v_o.result_status; end if;
    update public.uni_course_offerings set result_status = 'senate_approved', senate_approved_by = (select auth.uid()), senate_approved_at = now() where id = p_offering;
    v_new := 'senate_approved';
  elsif p_action = 'release' then
    if not v_is_admin then raise exception 'Only the Registry can release results'; end if;
    if v_o.result_status <> 'senate_approved' then raise exception 'Result must be Senate-approved first (now %)', v_o.result_status; end if;
    update public.uni_course_offerings set result_status = 'released', released_at = now() where id = p_offering;
    v_new := 'released';
  else
    raise exception 'Unknown action %', p_action;
  end if;
  return v_new;
end $$;

revoke execute on function public.uni_semester_gpas(uuid), public.uni_fees_due(uuid, uuid), public.uni_available_courses(),
  public.uni_pay_fees_demo(), public.uni_submit_registration(uuid[]), public.uni_decide_registration(uuid, boolean),
  public.uni_save_scores(uuid, jsonb), public.uni_advance_result(uuid, text) from public, anon;
grant execute on function public.uni_semester_gpas(uuid), public.uni_fees_due(uuid, uuid), public.uni_available_courses(),
  public.uni_pay_fees_demo(), public.uni_submit_registration(uuid[]), public.uni_decide_registration(uuid, boolean),
  public.uni_save_scores(uuid, jsonb), public.uni_advance_result(uuid, text) to authenticated;
revoke all on public.uni_v_results from anon;
