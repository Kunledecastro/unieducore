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

## Fee payments
- **Online (Paystack):** student clicks "Pay online" → Paystack checkout → returns to `/student/payment`. A payment counts only when Paystack confirms `success` for the exact NGN amount, checked on return and by the signed webhook (`uni-payments` edge function). Mismatches are flagged to the Bursary, never counted.
- **Bank payments:** Bursary → Record bank payment (teller, transfer, POS). Each reference can be recorded once.
- **Receipts:** `/print/receipt/[reference]` for students and the Bursary.
- **Demo payments:** Rules → "Allow demo payments". Must be **off** for real use, otherwise students can mark fees paid.
- **Switching on Paystack:** Supabase → Edge Functions → Secrets → `PAYSTACK_SECRET_KEY`; Paystack webhook URL `https://ghvltgumkwtpdzdgfxio.supabase.co/functions/v1/uni-payments/webhook`.

## Importing past results
Registry → Students → Import past results (`/registry/import`). CSV columns `matric_no, session, semester, course_code` plus `ca, exam` or `total`.
1. **Check file** runs the whole import and rolls it back, listing every problem by CSV line.
2. **Import** saves the valid rows; problem rows are skipped and can be fixed and re-imported (duplicates are never created).
- Past sessions are created automatically; the current semester is refused (lecturers own it).
- Imported results count as Senate-approved and released, so CGPA, transcripts and broadsheets include them immediately.
- A course failed earlier and passed later is marked as a carry-over (rows are processed in date order).
- Database function: `uni_import_results(rows, dry_run)`; Registry/admin only; one savepoint per row.

## Academic standing and graduation
Registry → Standing (HODs see their own department). Computed from **released** results only by `uni_academic_standing()`, the single source used by every screen.
- **Good standing / On probation / Withdrawal recommended**: probation when CGPA is below `probation_cgpa`; withdrawal recommended after `withdraw_after_probation` consecutive semesters on probation (both under Rules).
- **Failed, not yet passed**: courses whose best attempt is still an F (also shown to the student, with the carry-over note).
- **Graduation eligibility** (final-year students): final level reached, every compulsory course in the programme curriculum passed, nothing outstanding, CGPA at or above the lowest class of degree, and the programme's minimum units if set under Structure. Ineligible students show each reason.
- **Confirm graduation** (Registry): `uni_confirm_graduation(ids)` re-checks every student and refuses the whole batch if any is ineligible; sets status Graduated and fixes the final CGPA and class of degree, which later rule changes do not alter. Transcripts show the confirmed class and date.
- CGPA counts every attempt (a failed attempt and its retake both count), the common Nigerian convention.

## Printable documents
Print-ready A4 pages under `/print/…` ("Print / Save PDF" uses the browser's print dialog, so no PDF service is needed).

| Document | Who | Where to find it | Notes |
|---|---|---|---|
| Course registration form | Student (own), HOD, Registry | Student overview; Registry → Students | Signature lines; watermarked until HOD approval |
| Course result sheet | Lecturer, HOD, Registry | "Print result sheet" on any score sheet | Scores, grades, distribution, approval trail; "Provisional" until Senate approval |
| Senate broadsheet | HOD (own department), Registry | Results → Senate broadsheet | Landscape; students × courses, semester GPA, CGPA, remarks (carry-over, probation) |
| Transcript | Registry (official), student (unofficial copy) | Registry → Students; student Results page | Released results only; reference number; grading scale printed from Rules |

Row Level Security: everything is scoped by tenant (university); students see only their own records and only *released* scores. Score, result, registration and payment changes are written to `uni_audit_log` by triggers.

## Configurable per university (no code change)
`uni_settings` (unit limits, CA/exam split, probation CGPA, fee gating), `uni_grade_bands`, `uni_degree_classes`, faculties/departments/programmes/courses.

## Known gaps before production (Phase 1 hardening)
- Real payment gateway + reconciliation
- Bulk import of historic results
- Transcripts, probation flagging, PDF course forms and result broadsheets
- Move from the shared `educore-greenfield` project to a dedicated Supabase project (Pro plan)
- Enable leaked-password protection and MFA for staff
