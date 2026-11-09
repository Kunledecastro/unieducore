-- Academic standing (good / probation / withdrawal) and graduation eligibility, from released results only.

alter table public.uni_settings
  add column if not exists withdraw_after_probation int not null default 2 check (withdraw_after_probation between 1 and 6);
comment on column public.uni_settings.withdraw_after_probation is
  'Recommend withdrawal when CGPA has been below probation_cgpa for this many consecutive semesters';

alter table public.uni_programmes
  add column if not exists min_graduation_units int check (min_graduation_units is null or min_graduation_units between 1 and 600);

alter table public.uni_students
  add column if not exists graduated_at timestamptz,
  add column if not exists final_cgpa numeric(4,2),
  add column if not exists degree_class text;

-- One row per student. Security invoker: staff see every student in their university, a student sees only themself.
create or replace function public.uni_academic_standing(p_student uuid default null)
returns table (
  student_id uuid, matric_no text, full_name text, programme_id uuid, programme text, department_id uuid,
  level int, status text, final_level int, cgpa numeric, earned_units bigint, min_units int,
  standing text, probation_semesters int, outstanding text[], missing_compulsory text[],
  eligible boolean, reasons text[], degree_class text, graduated_at timestamptz
)
language sql stable security invoker set search_path = '' as $$
  with cfg as (
    select s.probation_cgpa, s.withdraw_after_probation,
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
  cum as (
    select student_id,
           round(sum(qp) over w / nullif(sum(u) over w, 0), 2) as cgpa,
           row_number() over (partition by student_id order by session_name desc, semester_number desc) as rn
    from sem
    window w as (partition by student_id order by session_name, semester_number rows between unbounded preceding and current row)
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

-- Registry confirms graduation for students who meet every requirement; class of degree and CGPA are fixed at that moment.
create or replace function public.uni_confirm_graduation(p_students uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  if not uni_private.is_admin() then raise exception 'Only the Registry can confirm graduation'; end if;
  for r in select * from public.uni_academic_standing() a where a.student_id = any(p_students) loop
    if not r.eligible then raise exception '% is not eligible: %', r.matric_no, array_to_string(r.reasons, '; '); end if;
    update public.uni_students set status = 'graduated', graduated_at = now(), final_cgpa = r.cgpa, degree_class = r.degree_class
      where id = r.student_id and tenant_id = uni_private.my_tenant();
    n := n + 1;
  end loop;
  if n <> coalesce(array_length(p_students, 1), 0) then raise exception 'Some students were not found'; end if;
  insert into public.uni_audit_log (tenant_id, table_name, action, new_data, actor)
  values (uni_private.my_tenant(), 'graduation', 'CONFIRM_GRADUATION', jsonb_build_object('count', n), (select auth.uid()));
  return n;
end $$;

revoke execute on function public.uni_academic_standing(uuid), public.uni_confirm_graduation(uuid[]) from public, anon;
grant execute on function public.uni_academic_standing(uuid), public.uni_confirm_graduation(uuid[]) to authenticated;
