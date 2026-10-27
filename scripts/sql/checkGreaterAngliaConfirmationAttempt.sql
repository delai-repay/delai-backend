-- Read-only investigation of the existing attempt. No approval is changed.
with latest as (
  select * from public.operator_submission_attempts
  where claim_id = 'af1e72d0-6652-4a76-be72-434ba7c64a59'::uuid
  order by started_at desc limit 1
)
select
  a.started_at,
  a.reason,
  a.debug_payload #>> '{runContext,executorVersion}' as executor_version,
  a.debug_payload #>> '{runContext,checkpoint}' as checkpoint,
  a.submitted,
  a.operator_reference,
  p.status as approval_status,
  p.consumed_at,
  (
    select jsonb_agg(jsonb_build_object(
      'name', step ->> 'name',
      'at', step ->> 'at',
      'tag', step ->> 'tag',
      'text', step ->> 'text',
      'checked', step -> 'checked',
      'method', step ->> 'method'
    ) order by ordinal)
    from jsonb_array_elements(coalesce(a.debug_payload #> '{runContext,steps}', '[]'::jsonb))
      with ordinality as entries(step, ordinal)
    where step ->> 'name' in (
      'Select customer declaration', 'Verify declaration on final Submit', 'Attempt final Submit', 'Click final Submit'
    )
  ) as final_action_evidence,
  a.screenshot_count
from latest a
left join public.claim_submission_approvals p
  on p.claim_id = a.claim_id and p.user_id = a.user_id;
