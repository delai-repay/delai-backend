# Release 2D.1: allowlisted pilot confirmation email

This patch adds one controlled admin route for the first real confirmation-email test:

`POST /send-pilot-confirmation-email`

The route is protected by `x-cron-secret` and will send only when all of these are true:

- normal automated delivery remains disabled;
- pilot delivery is explicitly enabled;
- the submitted detected-delay ID exactly matches the allowlisted ID;
- that record is still awaiting passenger confirmation; and
- the account email exactly matches the allowlisted pilot recipient.

The pilot route enables email only for its single internal delivery call. It does not enable email delivery for commute monitoring or any other customer. Existing sent-delivery records make repeat calls idempotent.

## Required Render values for the controlled test

```text
DELAI_EMAIL_DELIVERY_ENABLED=false
DELAI_EMAIL_PILOT_ENABLED=true
DELAI_EMAIL_PILOT_DETECTED_DELAY_ID=<the selected pending detected_delays.id>
DELAI_EMAIL_PILOT_RECIPIENT=<the selected pilot account email>
```

Keep the Resend, sender, public app URL, token-secret and cron-secret values already configured. After the controlled test, set `DELAI_EMAIL_PILOT_ENABLED=false`.

No database migration is required.
