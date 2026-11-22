-- A deactivated account cannot change anything, even with a session token that has not yet expired.
-- (Workflow functions run as the owner, so this check sits on the tables they write to.)
create or replace function uni_private.block_inactive_writer() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is not null and exists (select 1 from public.uni_profiles where id = v_uid and not is_active) then
    raise exception 'This account has been deactivated';
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function uni_private.block_inactive_writer() from public, anon;

do $$
declare t text;
begin
  foreach t in array array['uni_registrations', 'uni_registration_courses', 'uni_scores', 'uni_course_offerings', 'uni_payments', 'uni_students', 'uni_settings'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_block_inactive', t);
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function uni_private.block_inactive_writer()', t || '_block_inactive', t);
  end loop;
end $$;
