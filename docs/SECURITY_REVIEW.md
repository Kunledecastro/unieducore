# UniEducore security review — 22 Nov 2026

Scope: the database (Row Level Security, workflow functions, grants, triggers), both edge functions, and the web app's response headers. Method: Supabase security and performance advisors, a read of every policy and SECURITY DEFINER function, and attack tests run as each demo role (anonymous, student, lecturer, HOD of another department, bursar, Registry, deactivated user) inside rolled-back transactions.

## Fixed in this change

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | The Registry could release results that were still Draft by editing `uni_course_offerings` directly through the API, skipping lecturer submission, HOD and Senate approval. | Trigger `uni_offerings_guard_workflow`: approval columns can only change inside `uni_advance_result` / `uni_import_results`. |
| 2 | High | The Registry could set a student's class of degree, final CGPA or Graduated status directly, without the eligibility check. | Trigger `uni_students_guard_graduation`: only `uni_confirm_graduation` can set these. Ordinary edits (level, programme, active/deferred/withdrawn) still work. |
| 3 | Medium | Every lecturer and the Bursary could read every score in the university, including Draft scores of other lecturers' courses. | `uni_scores` now visible only to: Registry (all), the course lecturer, the HOD (their department's courses and all results of their department's students), and the student (own released results). |
| 4 | Medium | A deactivated user kept access until their session token expired (up to an hour). | Role helpers ignore inactive profiles, and trigger `*_block_inactive` refuses any write by an inactive account. |
| 5 | Medium | Audit entries did not record who made the change; settings, degree classes, fees and curricula were not audited at all (so turning on demo payments left no trace). | Audit now records the actor; those four tables are audited. |
| 6 | Low | The Registry could delete the university's settings row, breaking registration and grading. | Delete and insert policies removed; delete privilege revoked. |
| 7 | Low | Anonymous role held table privileges on all `uni_` tables (blocked by RLS, but one mistake away from exposure); signed-in users held write privileges on tables they can never write. | Revoked. Helper functions no longer executable by anonymous users. |
| 8 | Low | No browser security headers. | HSTS, X-Frame-Options DENY, `frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy; `X-Powered-By` removed. |
| 9 | Info | Missing indexes on tenant and foreign-key columns. | 12 indexes added. |

## Confirmed working (no change needed)
- Anonymous users can read nothing and call no function.
- Students see only their own profile, registrations, payments and released results; cannot promote themselves, insert payments, enter scores, import, graduate, or record payments.
- Lecturers cannot enter scores for another lecturer's course; HODs cannot approve another department's results.
- Every SECURITY DEFINER function sets `search_path = ''` and checks the caller's role and university before acting.
- Edge functions verify the caller's token, active status and role server-side; the service-role key never reaches the browser; the Paystack webhook checks the HMAC-SHA512 signature and the exact amount.

## Still to do before real students (needs Kunle)
1. **Supabase → Authentication → turn on leaked-password protection** (advisor warning) and **turn off public sign-ups** (accounts are created only by the Registry).
2. **Rules → switch off "Allow demo payments"** at the pilot university.
3. **Move to a dedicated Supabase project (Pro plan).** The shared `educore-greenfield` project also holds Educore K-12 tables; the advisor flags 16 of those with RLS on but no policies and 3 functions with a mutable search path. None are UniEducore's, but a separate project removes the shared blast radius and gives daily backups and point-in-time recovery.
4. **MFA for Registry and Bursary accounts** (Supabase Auth MFA; needs a small sign-in screen change).
5. Consider a shorter JWT expiry (for example 15 minutes) under Auth settings.

## Accepted for now
- The advisor's "signed-in users can execute SECURITY DEFINER function" warnings (13) are by design: these functions are the only write path and each checks the caller.
- Edge functions allow any CORS origin; they use bearer tokens, not cookies, so this does not enable cross-site requests on a user's behalf. Restrict to the production domain once it is fixed.
- No full Content Security Policy for scripts yet (Next.js inline scripts need nonces); revisit at hardening.

## How to re-run
The attack tests are SQL blocks that `begin`, switch role with `set local role authenticated` plus JWT claims for a demo user, attempt each action, and `rollback`. Re-run them after any migration touching policies or functions, and run the Supabase security advisor.
