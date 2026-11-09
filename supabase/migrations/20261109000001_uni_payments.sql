-- Online payments (Paystack), bank/teller payments recorded by the Bursary, and a switch to turn off demo payments.

alter table public.uni_payments
  add column if not exists gateway_response jsonb,
  add column if not exists verified_at timestamptz,
  add column if not exists recorded_by uuid references public.uni_profiles(id),
  add column if not exists note text;

-- Demo "pay" button: must be switched off before real students use the system,
-- otherwise any student can mark their own fees as paid.
alter table public.uni_settings add column if not exists allow_demo_payments boolean not null default true;

create or replace function public.uni_pay_fees_demo() returns numeric
language plpgsql security definer set search_path = '' as $$
declare v_st public.uni_students; v_ses uuid; v_due numeric; v_paid numeric; v_allowed boolean;
begin
  select * into v_st from public.uni_students where id = (select auth.uid());
  if v_st.id is null then raise exception 'Only students can pay fees'; end if;
  select allow_demo_payments into v_allowed from public.uni_settings where tenant_id = v_st.tenant_id;
  if not coalesce(v_allowed, false) then raise exception 'Demo payments are switched off. Please pay online.'; end if;
  select session_id into v_ses from public.uni_semesters where tenant_id = v_st.tenant_id and is_current;
  v_due := public.uni_fees_due(v_st.id, v_ses);
  select coalesce(sum(amount),0) into v_paid from public.uni_payments where student_id = v_st.id and session_id = v_ses and status = 'successful';
  if v_due - v_paid <= 0 then raise exception 'No outstanding fees for this session'; end if;
  insert into public.uni_payments (tenant_id, student_id, session_id, amount, reference, channel)
  values (v_st.tenant_id, v_st.id, v_ses, v_due - v_paid, 'DEMO-' || upper(substr(md5(random()::text), 1, 10)), 'demo');
  return v_due - v_paid;
end $$;

-- Bursary records a payment made at the bank (teller, transfer, POS)
create or replace function public.uni_record_manual_payment(
  p_student uuid, p_amount numeric, p_reference text, p_channel text, p_paid_on date, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid; v_ses uuid; v_id uuid; v_ref text := upper(trim(p_reference));
begin
  if uni_private.my_role() not in ('bursar', 'registrar', 'admin') then raise exception 'Only the Bursary can record payments'; end if;
  select tenant_id into v_tenant from public.uni_students where id = p_student;
  if v_tenant is distinct from uni_private.my_tenant() then raise exception 'Student not found'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  if coalesce(v_ref, '') = '' then raise exception 'Enter the bank teller or transfer reference'; end if;
  if p_channel not in ('bank_teller', 'bank_transfer', 'pos') then raise exception 'Unknown payment channel'; end if;
  if p_paid_on > current_date then raise exception 'Payment date cannot be in the future'; end if;
  if exists (select 1 from public.uni_payments where reference = v_ref) then raise exception 'Reference % has already been recorded', v_ref; end if;
  select session_id into v_ses from public.uni_semesters where tenant_id = v_tenant and is_current;
  insert into public.uni_payments (tenant_id, student_id, session_id, amount, reference, channel, status, paid_at, verified_at, recorded_by, note)
  values (v_tenant, p_student, v_ses, p_amount, v_ref, p_channel, 'successful', coalesce(p_paid_on, current_date)::timestamptz, now(), (select auth.uid()), nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.uni_record_manual_payment(uuid, numeric, text, text, date, text) from public, anon;
grant execute on function public.uni_record_manual_payment(uuid, numeric, text, text, date, text) to authenticated;

create index if not exists uni_payments_session_status on public.uni_payments (session_id, status);
