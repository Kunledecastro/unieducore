-- Import past results (e.g. when a university moves to UniEducore) so CGPAs are correct from day one.
-- Imported results are treated as already approved by Senate and released.

alter table public.uni_scores add column if not exists imported boolean not null default false;

create or replace function public.uni_import_results(p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := uni_private.my_tenant();
  v_me uuid := (select auth.uid());
  v_set public.uni_settings;
  r jsonb; i int := 0; v_out jsonb := '[]'::jsonb; n_ok int := 0; n_err int := 0; v_new_sessions text[] := '{}';
  v_matric text; v_ses_name text; v_semtxt text; v_semno int; v_code text; v_ca numeric; v_ex numeric; v_total numeric;
  v_student uuid; v_course uuid; v_ses uuid; v_sem uuid; v_sem_current boolean;
  v_off uuid; v_off_status public.uni_result_status; v_off_regs int;
  v_reg uuid; v_reg_status text; v_rc uuid; v_carry boolean; v_grade text; v_score_total numeric;
begin
  if not uni_private.is_admin() then raise exception 'Only the Registry can import results'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'No rows to import'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'Import at most 500 rows at a time'; end if;
  select * into v_set from public.uni_settings where tenant_id = v_tenant;

  begin -- everything below is undone at the end of a dry run
    for r in select * from jsonb_array_elements(p_rows) loop
      i := i + 1;
      begin -- each row is its own savepoint: a bad row never blocks the others
        v_matric := upper(trim(coalesce(r->>'matric_no', '')));
        v_ses_name := trim(coalesce(r->>'session', ''));
        v_semtxt := lower(trim(coalesce(r->>'semester', '')));
        v_code := upper(replace(coalesce(r->>'course_code', ''), ' ', ''));
        v_semno := case when v_semtxt in ('1', 'first', '1st', 'harmattan') then 1 when v_semtxt in ('2', 'second', '2nd', 'rain') then 2 end;

        if v_matric = '' then raise exception 'Matric number is missing'; end if;
        if v_ses_name !~ '^\d{4}/\d{4}$' or split_part(v_ses_name, '/', 2)::int <> split_part(v_ses_name, '/', 1)::int + 1 then
          raise exception 'Session "%" should look like 2024/2025', v_ses_name; end if;
        if v_semno is null then raise exception 'Semester "%" should be 1 or 2', r->>'semester'; end if;
        if v_code = '' then raise exception 'Course code is missing'; end if;

        begin
          v_ca := nullif(trim(coalesce(r->>'ca', '')), '')::numeric;
          v_ex := nullif(trim(coalesce(r->>'exam', '')), '')::numeric;
          v_total := nullif(trim(coalesce(r->>'total', '')), '')::numeric;
        exception when invalid_text_representation then raise exception 'Scores must be numbers';
        end;
        if v_ca is not null and v_ex is not null then
          if v_ca < 0 or v_ca > v_set.ca_max then raise exception 'CA % is outside 0–%', v_ca, v_set.ca_max; end if;
          if v_ex < 0 or v_ex > v_set.exam_max then raise exception 'Exam % is outside 0–%', v_ex, v_set.exam_max; end if;
          if v_total is not null and v_total <> v_ca + v_ex then raise exception 'Total % does not equal CA + exam (%)', v_total, v_ca + v_ex; end if;
          v_score_total := v_ca + v_ex;
        elsif v_total is not null and v_ca is null and v_ex is null then
          if v_total < 0 or v_total > 100 then raise exception 'Total % is outside 0–100', v_total; end if;
          v_score_total := v_total; v_ex := v_total; -- only the total is known; stored as the exam mark
        else
          raise exception 'Give either CA and exam, or a total score';
        end if;

        select id into v_student from public.uni_students where tenant_id = v_tenant and matric_no = v_matric;
        if v_student is null then raise exception 'No student with matric number %', v_matric; end if;
        select id into v_course from public.uni_courses where tenant_id = v_tenant and code = v_code;
        if v_course is null then raise exception 'Course % is not in the catalogue', v_code; end if;

        -- session and semester (past sessions are created on the fly)
        select id into v_ses from public.uni_sessions where tenant_id = v_tenant and name = v_ses_name;
        if v_ses is null then
          insert into public.uni_sessions (tenant_id, name) values (v_tenant, v_ses_name) returning id into v_ses;
          insert into public.uni_semesters (tenant_id, session_id, number, name) values
            (v_tenant, v_ses, 1, 'First Semester'), (v_tenant, v_ses, 2, 'Second Semester');
          v_new_sessions := array_append(v_new_sessions, v_ses_name);
        end if;
        select id, is_current into v_sem, v_sem_current from public.uni_semesters where session_id = v_ses and number = v_semno;
        if v_sem_current then raise exception 'This is the current semester: its results come from lecturers, not an import'; end if;

        -- course offering for that semester, released
        select o.id, o.result_status, (select count(*) from public.uni_registration_courses rc where rc.offering_id = o.id)
          into v_off, v_off_status, v_off_regs
          from public.uni_course_offerings o where o.course_id = v_course and o.semester_id = v_sem;
        if v_off is null then
          insert into public.uni_course_offerings (tenant_id, course_id, semester_id, result_status, submitted_at, hod_approved_by, hod_approved_at, senate_approved_by, senate_approved_at, released_at)
          values (v_tenant, v_course, v_sem, 'released', now(), v_me, now(), v_me, now(), now()) returning id into v_off;
        elsif v_off_status <> 'released' then
          if v_off_regs > 0 then raise exception '% in % semester % is still going through approval; finish it there instead', v_code, v_ses_name, v_semno; end if;
          update public.uni_course_offerings set result_status = 'released', submitted_at = now(), hod_approved_by = v_me, hod_approved_at = now(),
            senate_approved_by = v_me, senate_approved_at = now(), released_at = now() where id = v_off;
        end if;

        -- the student's registration for that semester
        select id, status into v_reg, v_reg_status from public.uni_registrations where student_id = v_student and semester_id = v_sem;
        if v_reg is null then
          insert into public.uni_registrations (tenant_id, student_id, semester_id, status, decided_by, decided_at)
          values (v_tenant, v_student, v_sem, 'approved', v_me, now()) returning id into v_reg;
        elsif v_reg_status <> 'approved' then
          update public.uni_registrations set status = 'approved', decided_by = v_me, decided_at = now() where id = v_reg;
        end if;

        select id into v_rc from public.uni_registration_courses where registration_id = v_reg and offering_id = v_off;
        if v_rc is not null then raise exception '% already has a result for % in % semester %', v_matric, v_code, v_ses_name, v_semno; end if;

        -- a carry-over is a course the student failed in an earlier semester
        select exists (
          select 1 from public.uni_v_results v
          where v.student_id = v_student and v.course_id = v_course and v.points = 0
            and (v.session_name < v_ses_name or (v.session_name = v_ses_name and v.semester_number < v_semno))
        ) into v_carry;

        insert into public.uni_registration_courses (tenant_id, registration_id, offering_id, is_carryover)
        values (v_tenant, v_reg, v_off, v_carry) returning id into v_rc;
        insert into public.uni_scores (tenant_id, registration_course_id, ca, exam, updated_by, imported)
        values (v_tenant, v_rc, v_ca, v_ex, v_me, true);

        select grade into v_grade from public.uni_grade_bands where tenant_id = v_tenant and v_score_total >= min_score order by min_score desc limit 1;
        v_out := v_out || jsonb_build_object('row', i, 'ok', true, 'matric_no', v_matric, 'course_code', v_code, 'session', v_ses_name,
          'semester', v_semno, 'total', v_score_total, 'grade', v_grade, 'carryover', v_carry);
        n_ok := n_ok + 1;
      exception when others then
        v_out := v_out || jsonb_build_object('row', i, 'ok', false, 'matric_no', r->>'matric_no', 'course_code', r->>'course_code', 'error', sqlerrm);
        n_err := n_err + 1;
      end;
    end loop;

    if p_dry_run then raise exception 'UNI_DRY_RUN'; end if;
    insert into public.uni_audit_log (tenant_id, table_name, record_id, action, new_data, actor)
    values (v_tenant, 'imports', null, 'IMPORT_RESULTS', jsonb_build_object('imported', n_ok, 'failed', n_err, 'new_sessions', v_new_sessions), v_me);
  exception when raise_exception then
    if sqlerrm <> 'UNI_DRY_RUN' then raise; end if;
  end;

  return jsonb_build_object('dry_run', p_dry_run, 'imported', n_ok, 'failed', n_err, 'new_sessions', to_jsonb(v_new_sessions), 'rows', v_out);
end $$;

revoke execute on function public.uni_import_results(jsonb, boolean) from public, anon;
grant execute on function public.uni_import_results(jsonb, boolean) to authenticated;
