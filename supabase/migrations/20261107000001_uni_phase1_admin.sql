-- Phase 1: account lifecycle flags, admin helper functions, wider audit trail

alter table public.uni_profiles
  add column if not exists must_change_password boolean not null default false,
  add column if not exists is_active boolean not null default true;

-- A user clears their own "change password" flag after setting a new password
create or replace function public.uni_password_changed() returns void
language sql security definer set search_path = '' as $$
  update public.uni_profiles set must_change_password = false where id = (select auth.uid());
$$;

-- Make one semester current (and its session), atomically
create or replace function public.uni_set_current_semester(p_semester uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_session uuid;
begin
  select tenant_id, session_id into v_tenant, v_session from public.uni_semesters where id = p_semester;
  if v_tenant is distinct from uni_private.my_tenant() then raise exception 'Semester not found'; end if;
  if not uni_private.is_admin() then raise exception 'Only the Registry can change the current semester'; end if;
  update public.uni_semesters set is_current = (id = p_semester), registration_open = case when id = p_semester then registration_open else false end
    where tenant_id = v_tenant;
  update public.uni_sessions set is_current = (id = v_session) where tenant_id = v_tenant;
end $$;

-- Create a course offering for every catalogue course that belongs to this semester (1st/2nd)
create or replace function public.uni_generate_offerings(p_semester uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_num int; n int;
begin
  select tenant_id, number into v_tenant, v_num from public.uni_semesters where id = p_semester;
  if v_tenant is distinct from uni_private.my_tenant() then raise exception 'Semester not found'; end if;
  if not uni_private.is_admin() then raise exception 'Only the Registry can create course offerings'; end if;
  insert into public.uni_course_offerings (tenant_id, course_id, semester_id)
  select v_tenant, c.id, p_semester from public.uni_courses c
  where c.tenant_id = v_tenant and c.semester_number = v_num
  on conflict (course_id, semester_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Assign a lecturer to an offering (Registry for any course, HOD for own department)
create or replace function public.uni_assign_lecturer(p_offering uuid, p_lecturer uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_dept uuid; v_lrole public.uni_role; v_ltenant uuid;
begin
  select o.tenant_id, c.department_id into v_tenant, v_dept
  from public.uni_course_offerings o join public.uni_courses c on c.id = o.course_id where o.id = p_offering;
  if v_tenant is distinct from uni_private.my_tenant() then raise exception 'Course not found'; end if;
  if not (uni_private.is_admin() or (uni_private.my_role() = 'hod' and uni_private.my_department() = v_dept)) then
    raise exception 'Only the Registry or the HOD of the course''s department can assign lecturers'; end if;
  if p_lecturer is not null then
    select role, tenant_id into v_lrole, v_ltenant from public.uni_profiles where id = p_lecturer and is_active;
    if v_ltenant is distinct from v_tenant or v_lrole not in ('lecturer','hod') then
      raise exception 'Choose an active lecturer or HOD'; end if;
  end if;
  update public.uni_course_offerings set lecturer_id = p_lecturer where id = p_offering;
end $$;

revoke execute on function public.uni_password_changed(), public.uni_set_current_semester(uuid),
  public.uni_generate_offerings(uuid), public.uni_assign_lecturer(uuid, uuid) from public, anon;
grant execute on function public.uni_password_changed(), public.uni_set_current_semester(uuid),
  public.uni_generate_offerings(uuid), public.uni_assign_lecturer(uuid, uuid) to authenticated;

-- Wider audit trail: who changed people, student records and the grading scale
create trigger uni_profiles_audit after insert or update or delete on public.uni_profiles for each row execute function uni_private.audit();
create trigger uni_students_audit after insert or update or delete on public.uni_students for each row execute function uni_private.audit();
create trigger uni_grade_bands_audit after insert or update or delete on public.uni_grade_bands for each row execute function uni_private.audit();
create trigger uni_courses_audit after insert or update or delete on public.uni_courses for each row execute function uni_private.audit();
