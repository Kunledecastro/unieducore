# UniEducore — prototype (Phase 0/1)

University management platform for Nigerian universities: course registration with credit-unit rules, lecturer score entry, HOD → Senate → release approval chain, 5-point CGPA, fees, and an audit trail.

## Stack
- Next.js 15 (App Router, client components) + Tailwind CSS 4
- Supabase (Postgres, Auth, Row Level Security) — project `educore-greenfield`, every UniEducore object prefixed `uni_` so it never touches Educore K-12 tables
- Hosted on Vercel (project `unieducore`)

## Run locally
```
npm install
cp .env.example .env.local   # then paste the Supabase publishable key
npm run dev
```

## Repo layout
- `app/` — pages per role: `student/`, `lecturer/`, `hod/`, `registry/`, `bursary/`, `login/`
- `components/` — shared UI (`ui.tsx`), auth/session shell (`auth.tsx`), the score sheet used by lecturer, HOD and Registry
- `lib/` — Supabase client, shared types and queries
- `supabase/migrations/` — the full database schema, security policies and workflow functions, in the order they were applied

Deploys: pushes to `main` deploy to production on Vercel (https://unieducore.vercel.app).

## Demo accounts (password `UniDemo2026!`)
| Email | Role | What to try |
|---|---|---|
| ada@udu.demo | Student, 200L CSC | CGPA history, MTH101 carry-over, pay fees then register |
| tunde@udu.demo | Student, 100L CSC | Registration awaiting HOD |
| chioma@udu.demo / musa@udu.demo | Students | Registered; partial results |
| lecturer@udu.demo | Lecturer | Enter CSC101 scores and submit |
| hod.csc@udu.demo | HOD Computer Science | Approve Tunde's course form; approve CSC103 result |
| registrar@udu.demo | Registry | Senate approval and release (GST101 is waiting) |
| bursar@udu.demo | Bursary | Balances and payments |

## How the rules are enforced
All writes go through Postgres functions, so the browser can't bypass a rule:

| Function | Rules |
|---|---|
| `uni_submit_registration` | registration open, fees paid, compulsory + carry-over courses included, unit limits |
| `uni_decide_registration` | only the student's HOD or Registry |
| `uni_save_scores` | only the course lecturer, only while Draft, CA/Exam within limits |
| `uni_advance_result` | Draft → Submitted (lecturer, all scores complete) → HOD approved (HOD of course's dept) → Senate approved → Released (Registry); HOD/Registry can return to Draft |
| `uni_pay_fees_demo` | simulated payment; replace with Paystack/Remita webhook in Phase 2 |
| `uni_set_current_semester` | Registry only; one current semester/session; closes registration on the old one |
| `uni_generate_offerings` | Registry only; offers every catalogue course for that semester, skips ones already offered |
| `uni_assign_lecturer` | Registry, or HOD for their own department; only active lecturers/HODs |
| Edge function `uni-admin-users` | create staff/students (incl. CSV import, auto matric numbers), reset passwords, deactivate; Registry/admin only; runs server-side with the service role |

Database guards (triggers): a course or offering with student registrations cannot be deleted (protects results); browser edits cannot change a profile's email, university or active flag, promote anyone to admin unless the caller is an admin, or change the caller's own role.

## Admin screens (Registry)
| Page | What it does |
|---|---|
| Students | add one student, import a CSV (template on the page), edit level/programme/status, reset password, deactivate |
| Staff | add lecturers, HODs, Registry and Bursary users; change role/department; reset password; deactivate |
| Calendar | add sessions (two semesters each), make a semester current, open/close registration, offer courses, assign lecturers |
| Courses | course catalogue, and each programme's curriculum by level and semester (compulsory/elective) |
| Structure | faculties, departments (codes feed matric numbers), programmes |
| Rules | unit limits, CA/exam split, probation CGPA, fee gating, grading scale, degree classes |

New accounts get a temporary password shown once to the Registry; users must set their own password at first sign-in.

Row Level Security: everything is scoped by tenant (university); students see only their own records and only *released* scores. Score, result, registration and payment changes are written to `uni_audit_log` by triggers.

## Configurable per university (no code change)
`uni_settings` (unit limits, CA/exam split, probation CGPA, fee gating), `uni_grade_bands`, `uni_degree_classes`, faculties/departments/programmes/courses.

## Known gaps before production (Phase 1 hardening)
- Real payment gateway + reconciliation
- Bulk import of historic results
- Transcripts, probation flagging, PDF course forms and result broadsheets
- Move from the shared `educore-greenfield` project to a dedicated Supabase project (Pro plan)
- Enable leaked-password protection and MFA for staff
