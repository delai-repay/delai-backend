-- Read-only: run in Supabase SQL Editor. All six results should be true.
-- This checks the existing Release 2A approval schema; it creates no approvals.
select
  to_regclass('public.claim_submission_approvals') is not null as approval_table_exists,
  to_regprocedure('public.approve_claim_final_submission(uuid,uuid,text,integer)') is not null as approve_rpc_exists,
  to_regprocedure('public.consume_claim_final_submission_approval(uuid,uuid,text,text)') is not null as consume_rpc_exists,
  to_regprocedure('public.revoke_claim_final_submission_approval(uuid,uuid)') is not null as revoke_rpc_exists,
  to_regclass('public.automation_jobs_one_active_claim_job_idx') is not null as active_job_unique_index_exists,
  coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.claim_submission_approvals')),false) as approval_rls_enabled;
