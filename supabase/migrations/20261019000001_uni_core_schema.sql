-- UniEducore core schema (all objects prefixed uni_ to stay separate from Educore K-12)
create type public.uni_role as enum ('admin','registrar','hod','lecturer','student','bursar');
create type public.uni_result_status as enum ('draft','submitted','hod_approved','senate_approved','released');

create table public.uni_tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text not null unique,
  created_at timestamptz not null default now()
);

create table public.uni_settings (
  tenant_id uuid primary key references public.uni_tenants(id) on delete cascade,
  min_units int not null default 15,
  max_units int not null default 24,
  ca_max numeric(5,2) not null default 30,
  exam_max numeric(5,2) not null default 70,
  probation_cgpa numeric(4,2) not null default 1.00,
  require_fees_for_registration boolean not null default true
);

create table public.uni_grade_bands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id) on delete cascade,
  grade text not null,
  min_score numeric(5,2) not null,
  points numeric(3,1) not null,
  unique (tenant_id, grade)
);

create table public.uni_degree_classes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id) on delete cascade,
  name text not null,
  min_cgpa numeric(4,2) not null
);

create table public.uni_faculties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id) on delete cascade,
  name text not null,
  code text not null,
  unique (tenant_id, code)
);

create table public.uni_departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id) on delete cascade,
  faculty_id uuid not null references public.uni_faculties(id) on delete cascade,
  name text not null,
  code text not null,
  unique (tenant_id, code)
);

create table public.uni_programmes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id) on delete cascade,
  department_id uuid not null references public.uni_departments(id) on delete cascade,
  name text not null,
  award text not null default 'B.Sc.',
  duration_years int not null default 4
);

create table public.uni_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id) on delete cascade,
  name text not null,
  is_current boolean not null default false,
  unique (tenant_id, name)
);

create table public.uni_semesters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id) on delete cascade,
  session_id uuid not null references public.uni_sessions(id) on delete cascade,
  number int not null check (number in (1,2)),
  name text not null,
  is_current boolean not null default false,
  registration_open boolean not null default false,
  starts_on date,
  unique (session_id, number)
);

create table public.uni_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.uni_tenants(id) on delete cascade,
  full_name text not null,
  email text not null,
  role public.uni_role not null,
  department_id uuid references public.uni_departments(id),
  created_at timestamptz not null default now()
);

create table public.uni_students (
  id uuid primary key references public.uni_profiles(id) on delete cascade,
  tenant_id uuid not null references public.uni_tenants(id) on delete cascade,
  matric_no text not null,
  programme_id uuid not null references public.uni_programmes(id),
  level int not null check (level between 100 and 700),
  entry_session_id uuid references public.uni_sessions(id),
  status text not null default 'active' check (status in ('active','deferred','withdrawn','graduated')),
  unique (tenant_id, matric_no)
);

create table public.uni_courses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id) on delete cascade,
  department_id uuid not null references public.uni_departments(id),
  code text not null,
  title text not null,
  units int not null check (units between 0 and 12),
  level int not null,
  semester_number int not null check (semester_number in (1,2)),
  unique (tenant_id, code)
);

create table public.uni_programme_courses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id) on delete cascade,
  programme_id uuid not null references public.uni_programmes(id) on delete cascade,
  course_id uuid not null references public.uni_courses(id) on delete cascade,
  is_compulsory boolean not null default true,
  unique (programme_id, course_id)
);

create table public.uni_course_offerings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id) on delete cascade,
  course_id uuid not null references public.uni_courses(id) on delete cascade,
  semester_id uuid not null references public.uni_semesters(id) on delete cascade,
  lecturer_id uuid references public.uni_profiles(id),
  result_status public.uni_result_status not null default 'draft',
  submitted_at timestamptz,
  hod_approved_by uuid references public.uni_profiles(id),
  hod_approved_at timestamptz,
  senate_approved_by uuid references public.uni_profiles(id),
  senate_approved_at timestamptz,
  released_at timestamptz,
  unique (course_id, semester_id)
);

create table public.uni_registrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id) on delete cascade,
  student_id uuid not null references public.uni_students(id) on delete cascade,
  semester_id uuid not null references public.uni_semesters(id) on delete cascade,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  submitted_at timestamptz not null default now(),
  decided_by uuid references public.uni_profiles(id),
  decided_at timestamptz,
  unique (student_id, semester_id)
);

create table public.uni_registration_courses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id) on delete cascade,
  registration_id uuid not null references public.uni_registrations(id) on delete cascade,
  offering_id uuid not null references public.uni_course_offerings(id) on delete cascade,
  is_carryover boolean not null default false,
  unique (registration_id, offering_id)
);

create table public.uni_scores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id) on delete cascade,
  registration_course_id uuid not null unique references public.uni_registration_courses(id) on delete cascade,
  ca numeric(5,2),
  exam numeric(5,2),
  total numeric(5,2) generated always as (coalesce(ca,0) + coalesce(exam,0)) stored,
  updated_by uuid references public.uni_profiles(id),
  updated_at timestamptz not null default now()
);

create table public.uni_fee_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id) on delete cascade,
  session_id uuid not null references public.uni_sessions(id) on delete cascade,
  programme_id uuid references public.uni_programmes(id) on delete cascade,
  level int,
  name text not null,
  amount numeric(12,2) not null check (amount >= 0)
);

create table public.uni_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.uni_tenants(id) on delete cascade,
  student_id uuid not null references public.uni_students(id) on delete cascade,
  session_id uuid not null references public.uni_sessions(id),
  amount numeric(12,2) not null check (amount > 0),
  reference text not null unique,
  channel text not null default 'demo',
  status text not null default 'successful' check (status in ('pending','successful','failed')),
  paid_at timestamptz not null default now()
);

create table public.uni_audit_log (
  id bigserial primary key,
  tenant_id uuid,
  table_name text not null,
  record_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  actor uuid default auth.uid(),
  at timestamptz not null default now()
);

create index on public.uni_departments (faculty_id);
create index on public.uni_programmes (department_id);
create index on public.uni_semesters (session_id);
create index on public.uni_profiles (tenant_id);
create index on public.uni_profiles (department_id);
create index on public.uni_students (programme_id);
create index on public.uni_courses (department_id);
create index on public.uni_programme_courses (course_id);
create index on public.uni_course_offerings (semester_id);
create index on public.uni_course_offerings (lecturer_id);
create index on public.uni_registrations (semester_id);
create index on public.uni_registration_courses (offering_id);
create index on public.uni_fee_items (session_id);
create index on public.uni_payments (student_id);
create index on public.uni_audit_log (tenant_id, at desc);

do $$ declare t text; begin
  foreach t in array array['uni_tenants','uni_settings','uni_grade_bands','uni_degree_classes','uni_faculties','uni_departments','uni_programmes','uni_sessions','uni_semesters','uni_profiles','uni_students','uni_courses','uni_programme_courses','uni_course_offerings','uni_registrations','uni_registration_courses','uni_scores','uni_fee_items','uni_payments','uni_audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
