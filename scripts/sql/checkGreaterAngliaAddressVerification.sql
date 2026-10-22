-- Read-only. Run after the new deployment and a new safety-locked preparation.
select
  a.id as attempt_id,
  a.started_at,
  a.submission_source,
  a.debug_payload #>> '{runContext,executorVersion}' as executor_version,
  a.debug_payload #>> '{runContext,checkpoint}' as checkpoint,
  a.reason,
  a.final_submit_enabled,
  a.submitted,
  a.operator_reference,
  a.screenshot_count,
  (
    select jsonb_agg(step order by ordinal)
    from jsonb_array_elements(
      coalesce(a.debug_payload #> '{runContext,steps}', '[]'::jsonb)
    ) with ordinality as entries(step, ordinal)
    where step ->> 'name' in ('Select postcode address', 'Verify final review address')
  ) as verification_steps
from public.operator_submission_attempts a
where a.claim_id = 'af1e72d0-6652-4a76-be72-434ba7c64a59'::uuid
order by a.started_at desc
limit 1;
