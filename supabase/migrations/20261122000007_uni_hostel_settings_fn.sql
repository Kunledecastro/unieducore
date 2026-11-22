-- The hostel office manages hostel settings without getting write access to the rest of the university's rules.
create or replace function public.uni_hostel_save_settings(p_open boolean, p_hold_hours int, p_require_school_fees boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (uni_private.is_hostel_admin() or uni_private.is_admin()) then raise exception 'Only the hostel office can change hostel settings'; end if;
  if p_hold_hours is null or p_hold_hours < 1 or p_hold_hours > 720 then raise exception 'Hold time must be between 1 and 720 hours'; end if;
  update public.uni_settings set hostel_applications_open = coalesce(p_open, false), hostel_hold_hours = p_hold_hours,
         hostel_require_school_fees = coalesce(p_require_school_fees, false)
   where tenant_id = uni_private.my_tenant();
end $$;
revoke execute on function public.uni_hostel_save_settings(boolean, int, boolean) from public, anon;
grant execute on function public.uni_hostel_save_settings(boolean, int, boolean) to authenticated;
