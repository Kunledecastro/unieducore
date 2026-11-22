-- New roles for hostel management (enum values must be committed before use, so this is its own migration).
alter type public.uni_role add value if not exists 'hostel_officer';
alter type public.uni_role add value if not exists 'porter';
