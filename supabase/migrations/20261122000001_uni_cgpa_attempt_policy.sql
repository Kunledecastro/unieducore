-- CGPA attempt policy: count every attempt at a course (default, common Nigerian convention)
-- or only the best attempt. Applies to CGPA everywhere; semester GPA always counts the courses taken that semester.

alter table public.uni_settings
  add column if not exists cgpa_attempt_policy text not null default 'all' check (cgpa_attempt_policy in ('all', 'best'));
comment on column public.uni_settings.cgpa_attempt_policy is
  'all = every attempt at a course counts towards CGPA; best = only the best attempt at each course counts';

create or replace function public.uni_semester_gpas(p_student uuid)
returns table (semester_id uuid, session_name text, semester_name text, semester_number int,
               units bigint, quality_points numeric, gpa numeric, cum_units numeric, cum_quality_points numeric, cgpa numeric)
language sql stable security invoker set search_path = '' as $$
  with res as (
    select v.semester_id, v.session_name, v.semester_name, v.semester_number, v.course_id, v.units, v.points
    from public.uni_v_results v
    where v.student_id = p_student and v.result_status = 'released' and v.grade is not null
  ),
  pol as (
    select coalesce((select s.cgpa_attempt_policy from public.uni_settings s
                     join public.uni_students st on st.tenant_id = s.tenant_id where st.id = p_student), 'all') as p
  ),
  per as (
    select semester_id, session_name, semester_name, semester_number, sum(units) as u, sum(units * points) as qp
    from res group by 1, 2, 3, 4
  )
  select per.semester_id, per.session_name, per.semester_name, per.semester_number,
         per.u, per.qp, round(per.qp / nullif(per.u, 0), 2),
         c.cu::numeric, c.cqp::numeric, round(c.cqp / nullif(c.cu, 0), 2)
  from per cross join pol
  cross join lateral (
    select sum(x.units) as cu, sum(x.units * x.points) as cqp
    from (
      select r.units, r.points,
             row_number() over (partition by r.course_id order by r.points desc, r.session_name desc, r.semester_number desc) as rk
      from res r
      where r.session_name < per.session_name or (r.session_name = per.session_name and r.semester_number <= per.semester_number)
    ) x
    where pol.p = 'all' or x.rk = 1
  ) c
  order by per.session_name, per.semester_number;
$$;

create or replace function public.uni_academic_standing(p_student uuid default null)
returns table (
  student_id uuid, matric_no text, full_name text, programme_id uuid, programme text, department_id uuid,
  level int, status text, final_level int, cgpa numeric, earned_units bigint, min_units int,
  standing text, probation_semesters int, outstanding text[], missing_compulsory text[],
  eligible boolean, reasons text[], degree_class text, graduated_at timestamptz
)
language sql stable security invoker set search_path = '' as $$
  with cfg as (
    select s.probation_cgpa, s.withdraw_after_probation, s.cgpa_attempt_policy,
           (select min(min_cgpa) from public.uni_degree_classes d where d.tenant_id = s.tenant_id) as pass_cgpa
    from public.uni_settings s
    where s.tenant_id = (select tenant_id from public.uni_profiles where id = (select auth.uid()))
  ),
  st as (
    select s.id, s.matric_no, s.level, s.status, s.programme_id, s.tenant_id, s.graduated_at, s.degree_class as fixed_class,
           p.full_name, pr.name as programme, pr.department_id, pr.duration_years * 100 as final_level, pr.min_graduation_units
    from public.uni_students s
    join public.uni_profiles p on p.id = s.id
    join public.uni_programmes pr on pr.id = s.programme_id
    where s.tenant_id = (select tenant_id from public.uni_profiles where id = (select auth.uid()))
      and (p_student is null or s.id = p_student)
  ),
  res as (
    select v.student_id, v.session_name, v.semester_number, v.course_id, v.code, v.units, v.points
    from public.uni_v_results v join st on st.id = v.student_id
    where v.result_status = 'released' and v.grade is not null
  ),
  sem as (
    select student_id, session_name, semester_number, sum(units) as u, sum(units * points) as qp
    from res group by 1, 2, 3
  ),
  -- CGPA after each semester: every attempt counts, or (best-attempt policy) only the best attempt so far at each course
  cum as (
    select s.student_id,
           round(c.cqp / nullif(c.cu, 0), 2) as cgpa,
           row_number() over (partition by s.student_id order by s.session_name desc, s.semester_number desc) as rn
    from sem s cross join cfg
    cross join lateral (
      select sum(x.units) as cu, sum(x.units * x.points) as cqp
      from (
        select r.units, r.points,
               row_number() over (partition by r.course_id order by r.points desc, r.session_name desc, r.semester_number desc) as rk
        from res r
        where r.student_id = s.student_id
          and (r.session_name < s.session_name or (r.session_name = s.session_name and r.semester_number <= s.semester_number))
      ) x
      where cfg.cgpa_attempt_policy = 'all' or x.rk = 1
    ) c
  ),
  -- consecutive semesters, counting back from the latest, with CGPA under the probation line
  trail as (
    select c.student_id,
           coalesce(min(c.rn) filter (where c.cgpa >= cfg.probation_cgpa) - 1, max(c.rn))::int as cnt,
           max(c.cgpa) filter (where c.rn = 1) as latest_cgpa
    from cum c cross join cfg group by c.student_id
  ),
  best as (
    select student_id, course_id, max(code) as code, max(units) as units, max(points) as best
    from res group by 1, 2
  ),
  agg as (
    select student_id,
           coalesce(sum(units) filter (where best > 0), 0)::bigint as earned,
           coalesce(array_agg(code order by code) filter (where best = 0), '{}') as outstanding
    from best group by 1
  ),
  missing as (
    select st.id as student_id, array_agg(c.code order by c.code) as codes
    from st
    join public.uni_programme_courses pc on pc.programme_id = st.programme_id and pc.is_compulsory
    join public.uni_courses c on c.id = pc.course_id
    where not exists (select 1 from best b where b.student_id = st.id and b.course_id = c.id and b.best > 0)
    group by st.id
  ),
  base as (
    select st.*, t.cnt, t.latest_cgpa, coalesce(a.earned, 0) as earned, coalesce(a.outstanding, '{}') as outstanding,
           coalesce(m.codes, '{}') as missing, cfg.*
    from st cross join cfg
    left join trail t on t.student_id = st.id
    left join agg a on a.student_id = st.id
    left join missing m on m.student_id = st.id
  )
  select
    b.id, b.matric_no, b.full_name, b.programme_id, b.programme, b.department_id,
    b.level, b.status, b.final_level, b.latest_cgpa, b.earned, b.min_graduation_units,
    case
      when b.status = 'graduated' then 'graduated'
      when b.latest_cgpa is null then 'no_results'
      when b.cnt = 0 then 'good'
      when b.cnt >= b.withdraw_after_probation then 'withdrawal'
      else 'probation'
    end,
    coalesce(b.cnt, 0), b.outstanding, b.missing,
    (b.status = 'active' and b.level >= b.final_level and b.latest_cgpa is not null
      and b.latest_cgpa >= coalesce(b.pass_cgpa, 0) and cardinality(b.outstanding) = 0 and cardinality(b.missing) = 0
      and (b.min_graduation_units is null or b.earned >= b.min_graduation_units)),
    array_remove(array[
      case when b.status <> 'active' then 'Student status is ' || b.status end,
      case when b.level < b.final_level then 'Not yet in final year (' || b.level || 'L of ' || b.final_level || 'L)' end,
      case when b.latest_cgpa is null then 'No released results' end,
      case when b.latest_cgpa < coalesce(b.pass_cgpa, 0) then 'CGPA ' || b.latest_cgpa || ' is below the minimum ' || b.pass_cgpa end,
      case when cardinality(b.outstanding) > 0 then 'Failed courses not yet passed: ' || array_to_string(b.outstanding, ', ') end,
      case when cardinality(b.missing) > 0 then 'Compulsory courses not passed: ' || array_to_string(b.missing, ', ') end,
      case when b.min_graduation_units is not null and b.earned < b.min_graduation_units
           then 'Earned ' || b.earned || ' of ' || b.min_graduation_units || ' required units' end
    ], null),
    coalesce(b.fixed_class, (select d.name from public.uni_degree_classes d where d.tenant_id = b.tenant_id and b.latest_cgpa >= d.min_cgpa order by d.min_cgpa desc limit 1)),
    b.graduated_at
  from base b
  order by b.matric_no;
$$;
