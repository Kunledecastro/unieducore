-- Never let a catalogue edit silently delete student results.
-- Courses and offerings cascade to registrations and scores, so block deletes once anyone has registered.
create or replace function uni_private.block_delete_with_registrations() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'uni_courses' and exists (
    select 1 from public.uni_course_offerings o join public.uni_registration_courses rc on rc.offering_id = o.id where o.course_id = old.id) then
    raise exception 'This course has student registrations and results, so it cannot be deleted';
  end if;
  if tg_table_name = 'uni_course_offerings' and exists (
    select 1 from public.uni_registration_courses rc where rc.offering_id = old.id) then
    raise exception 'This course offering has registered students, so it cannot be deleted';
  end if;
  return old;
end $$;

create trigger uni_courses_block_delete before delete on public.uni_courses
  for each row execute function uni_private.block_delete_with_registrations();
create trigger uni_offerings_block_delete before delete on public.uni_course_offerings
  for each row execute function uni_private.block_delete_with_registrations();
