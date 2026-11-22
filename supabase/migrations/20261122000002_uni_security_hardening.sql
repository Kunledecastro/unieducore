-- Security review hardening (Phase 3 pilot preparation).

-- 1. Deactivated accounts lose access at once, not when their session token expires.
create or replace function uni_private.my_tenant() returns uuid
language sql stable security definer set search_path = '' as
$$ select tenant_id from public.uni_profiles where id = (select auth.uid()) and is_active $$;

create or replace function uni_private.my_role() returns public.uni_role
language sql stable security definer set search_path = '' as
$$ select role from public.uni_profiles where id = (select auth.uid()) and is_active $$;

create or replace function uni_private.my_department() returns uuid
language sql stable security definer set search_path = '' as
$$ select department_id from public.uni_profiles where id = (select auth.uid()) and is_active $$;

create or replace function uni_private.is_staff() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select role <> 'student' from public.uni_profiles where id = (select auth.uid()) and is_active), false) $$;

create or replace function uni_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select role in ('admin','registrar') from public.uni_profiles where id = (select auth.uid()) and is_active), false) $$;

-- 2. Scores: only the people who need them.
--    Registry: all. Lecturer: own courses. HOD: courses of their department and every result of their department's students.
--    Student: own released results. Bursary and other lecturers: none.
create or replace function uni_private.can_see_score(p_rc uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with me as (select id, tenant_id, role, department_id from public.uni_profiles where id = (select auth.uid()) and is_active)
  select exists (
    select 1
    from me
    join public.uni_registration_courses rc on rc.id = p_rc and rc.tenant_id = me.tenant_id
    join public.uni_registrations r on r.id = rc.registration_id
    join public.uni_course_offerings o on o.id = rc.offering_id
    join public.uni_courses c on c.id = o.course_id
    join public.uni_students st on st.id = r.student_id
    join public.uni_programmes pr on pr.id = st.programme_id
    where me.role in ('admin', 'registrar')
       or o.lecturer_id = me.id
       or (me.role = 'hod' and (c.department_id = me.department_id or pr.department_id = me.department_id))
       or (r.student_id = me.id and o.result_status = 'released')
  )
$$;
revoke execute on function uni_private.can_see_score(uuid) from public, anon;
grant execute on function uni_private.can_see_score(uuid) to authenticated;

drop policy if exists uni_scores_read on public.uni_scores;
create policy uni_scores_read on public.uni_scores for select to authenticated
  using (tenant_id = (select uni_private.my_tenant()) and uni_private.can_see_score(registration_course_id));

-- 3. Result approvals can only move through uni_advance_result / uni_import_results (which run as the function owner),
--    never by editing the table directly, even by the Registry.
create or replace function uni_private.guard_offering_workflow() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if new.result_status <> 'draft' or new.submitted_at is not null or new.hod_approved_by is not null or new.hod_approved_at is not null
       or new.senate_approved_by is not null or new.senate_approved_at is not null or new.released_at is not null then
      raise exception 'New course offerings start as Draft';
    end if;
  elsif (new.result_status, new.submitted_at, new.hod_approved_by, new.hod_approved_at, new.senate_approved_by, new.senate_approved_at, new.released_at)
        is distinct from (old.result_status, old.submitted_at, old.hod_approved_by, old.hod_approved_at, old.senate_approved_by, old.senate_approved_at, old.released_at) then
    raise exception 'Result status can only change through the approval workflow';
  end if;
  return new;
end $$;
drop trigger if exists uni_offerings_guard_workflow on public.uni_course_offerings;
create trigger uni_offerings_guard_workflow before insert or update on public.uni_course_offerings
  for each row execute function uni_private.guard_offering_workflow();

-- 4. Graduation (status, date, final CGPA, class of degree) can only be set by uni_confirm_graduation.
create or replace function uni_private.guard_student_graduation() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if new.status = 'graduated' or new.graduated_at is not null or new.final_cgpa is not null or new.degree_class is not null then
      raise exception 'Students can only be graduated through Confirm graduation';
    end if;
  elsif (new.graduated_at, new.final_cgpa, new.degree_class) is distinct from (old.graduated_at, old.final_cgpa, old.degree_class)
        or ((new.status = 'graduated') <> (old.status = 'graduated')) then
    raise exception 'Graduation can only be set through Confirm graduation and cannot be edited here';
  end if;
  return new;
end $$;
drop trigger if exists uni_students_guard_graduation on public.uni_students;
create trigger uni_students_guard_graduation before insert or update on public.uni_students
  for each row execute function uni_private.guard_student_graduation();

-- 5. Audit: record who made each change, and cover settings, degree classes, fees and curricula.
create or replace function uni_private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.uni_audit_log (tenant_id, table_name, record_id, action, old_data, new_data, actor)
  values ((v->>'tenant_id')::uuid, tg_table_name, coalesce((v->>'id')::uuid, (v->>'tenant_id')::uuid), tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          (select auth.uid()));
  return coalesce(new, old);
end $$;

drop trigger if exists uni_settings_audit on public.uni_settings;
create trigger uni_settings_audit after insert or update or delete on public.uni_settings for each row execute function uni_private.audit();
drop trigger if exists uni_degree_classes_audit on public.uni_degree_classes;
create trigger uni_degree_classes_audit after insert or update or delete on public.uni_degree_classes for each row execute function uni_private.audit();
drop trigger if exists uni_fee_items_audit on public.uni_fee_items;
create trigger uni_fee_items_audit after insert or update or delete on public.uni_fee_items for each row execute function uni_private.audit();
drop trigger if exists uni_programme_courses_audit on public.uni_programme_courses;
create trigger uni_programme_courses_audit after insert or update or delete on public.uni_programme_courses for each row execute function uni_private.audit();

-- 6. A university's settings row cannot be deleted from the app.
drop policy if exists uni_settings_admin_del on public.uni_settings;
drop policy if exists uni_settings_admin_ins on public.uni_settings;

-- 7. Least privilege at the grant level (RLS already blocks these; this is a second lock).
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname like 'uni\_%' and c.relkind in ('r', 'v') loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
  foreach t in array array['uni_audit_log', 'uni_payments', 'uni_registrations', 'uni_registration_courses', 'uni_scores', 'uni_tenants', 'uni_v_results'] loop
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;
revoke delete, truncate on public.uni_settings from authenticated;
revoke execute on all functions in schema uni_private from public, anon;
grant execute on function uni_private.my_tenant(), uni_private.my_role(), uni_private.my_department(),
  uni_private.is_staff(), uni_private.is_admin() to authenticated;

-- 8. Indexes for tenant scoping and foreign keys flagged by the performance advisor.
create index if not exists uni_course_offerings_tenant_idx on public.uni_course_offerings (tenant_id);
create index if not exists uni_degree_classes_tenant_idx on public.uni_degree_classes (tenant_id);
create index if not exists uni_fee_items_tenant_idx on public.uni_fee_items (tenant_id);
create index if not exists uni_fee_items_programme_idx on public.uni_fee_items (programme_id);
create index if not exists uni_payments_tenant_idx on public.uni_payments (tenant_id);
create index if not exists uni_programme_courses_tenant_idx on public.uni_programme_courses (tenant_id);
create index if not exists uni_programmes_tenant_idx on public.uni_programmes (tenant_id);
create index if not exists uni_registration_courses_tenant_idx on public.uni_registration_courses (tenant_id);
create index if not exists uni_registrations_tenant_idx on public.uni_registrations (tenant_id);
create index if not exists uni_scores_tenant_idx on public.uni_scores (tenant_id);
create index if not exists uni_semesters_tenant_idx on public.uni_semesters (tenant_id);
create index if not exists uni_students_entry_session_idx on public.uni_students (entry_session_id);
