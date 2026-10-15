-- Read-only. Returns field names from the latest recorded operator attempt.
select
  started_at,
  submission_source,
  coalesce(
    debug_payload -> 'missingAutomationInputs',
    debug_payload #> '{portalSubmissionPlan,automationReadiness,missingAutomationInputs}'
  ) as missing_inputs
from public.operator_submission_attempts
where claim_id = 'af1e72d0-6652-4a76-be72-434ba7c64a59'::uuid
order by started_at desc
limit 1;
