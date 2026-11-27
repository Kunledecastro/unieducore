-- Two-factor sign-in for the most powerful roles (Registry, Bursary, administrators), switchable per university.
-- When it is on, those roles have no privileges until their session is verified with an authenticator code (aal2):
-- the helpers every policy and workflow function uses return "no role" for them. Turning it off needs an aal2
-- session too, because changing settings needs is_admin().

alter table public.uni_settings add column if not exists require_mfa_for_admins boolean not null default false;
comment on column public.uni_settings.require_mfa_for_admins is 'Registry, Bursary and administrators must sign in with an authenticator code';

-- New universities start with demo payments off (the demo university keeps its own setting)
alter table public.uni_settings alter column allow_demo_payments set default false;

create or replace function uni_private.aal_ok(p_role public.uni_role, p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_role not in ('registrar', 'bursar', 'admin')
      or not coalesce((select s.require_mfa_for_admins from public.uni_settings s where s.tenant_id = p_tenant), false)
      or coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
$$;
revoke execute on function uni_private.aal_ok(public.uni_role, uuid) from public, anon;
grant execute on function uni_private.aal_ok(public.uni_role, uuid) to authenticated;

create or replace function uni_private.my_role() returns public.uni_role
language sql stable security definer set search_path = '' as
$$ select role from public.uni_profiles where id = (select auth.uid()) and is_active and uni_private.aal_ok(role, tenant_id) $$;

create or replace function uni_private.is_staff() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select role not in ('student', 'porter') from public.uni_profiles
                    where id = (select auth.uid()) and is_active and uni_private.aal_ok(role, tenant_id)), false) $$;

create or replace function uni_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select role in ('admin', 'registrar') from public.uni_profiles
                    where id = (select auth.uid()) and is_active and uni_private.aal_ok(role, tenant_id)), false) $$;

create or replace function uni_private.is_hostel_admin() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce((select role in ('hostel_officer', 'admin') from public.uni_profiles
                    where id = (select auth.uid()) and is_active and uni_private.aal_ok(role, tenant_id)), false) $$;

-- Read by the app to decide whether to ask for a code (true when this user's role needs one at this university)
create or replace function public.uni_mfa_required() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role in ('registrar', 'bursar', 'admin') and s.require_mfa_for_admins
                   from public.uni_profiles p join public.uni_settings s on s.tenant_id = p.tenant_id
                   where p.id = (select auth.uid())), false)
$$;
revoke execute on function public.uni_mfa_required() from public, anon;
grant execute on function public.uni_mfa_required() to authenticated;

-- Scores follow the same rule
create or replace function uni_private.can_see_score(p_rc uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with me as (select id, tenant_id, role, department_id from public.uni_profiles
              where id = (select auth.uid()) and is_active and uni_private.aal_ok(role, tenant_id))
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
