-- Guard direct profile edits made from the browser (the server-side admin function uses the service role and is exempt).
create or replace function uni_private.guard_profile_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := (select auth.uid()); v_my_role public.uni_role;
begin
  if v_me is null then return new; end if; -- service role (server-side admin function, migrations)

  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.email <> old.email then
    raise exception 'Account identity (email, university) cannot be changed here';
  end if;
  if new.is_active <> old.is_active then
    raise exception 'Use Deactivate/Reactivate on the Staff or Students page';
  end if;
  if new.must_change_password <> old.must_change_password
     and not (new.id = v_me and new.must_change_password = false) then
    raise exception 'Use Reset password to issue a temporary password';
  end if;

  if new.role <> old.role then
    select role into v_my_role from public.uni_profiles where id = v_me;
    if new.id = v_me then raise exception 'You cannot change your own role'; end if;
    if new.role = 'student' or old.role = 'student' then raise exception 'Students and staff are separate account types'; end if;
    if (new.role = 'admin' or old.role = 'admin') and v_my_role <> 'admin' then
      raise exception 'Only an administrator can grant or remove administrator access';
    end if;
  end if;
  return new;
end $$;

create trigger uni_profiles_guard before update on public.uni_profiles
  for each row execute function uni_private.guard_profile_update();
