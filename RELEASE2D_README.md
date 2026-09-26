# Release 2D — secure journey-confirmation email

Release 2D adds transactional email delivery around Delai's existing passenger
confirmation workflow. It does not change delay eligibility or enable final
operator submission.

## Included

- Resend delivery from Delai's verified sending domain.
- A random 256-bit token whose HMAC-SHA256 hash, never the raw token, is stored.
- Single-use links with a configurable 48-hour expiry.
- A read-only preview endpoint and a separate POST response endpoint.
- Five-minute processing leases to prevent concurrent link use.
- Email idempotency and server-only delivery audit records.
- HTML escaping, no-store responses and no-referrer headers.
- A safe `Review journey` email button. Opening an email link cannot confirm a
  journey or start a claim.
- `no_scheduled_commutes` monitoring status when no commute runs that day.

## Deployment order

1. Keep `DELAI_EMAIL_DELIVERY_ENABLED=false`.
2. Run only `20260926_release2d_confirmation_email.sql` in Supabase.
3. Run `npm run test:regression` locally.
4. Deploy the backend.
5. Build and deploy the frontend route `/confirm-journey` so it calls:
   - `GET /delay-confirmation-token/preview?token=...`
   - `POST /delay-confirmation-token/respond` with `{ token, response }`.
6. Test a controlled email and response using a pilot account.
7. Set `DELAI_EMAIL_DELIVERY_ENABLED=true` only after the frontend route is
   live and the controlled test succeeds.

## Required environment variables

```text
RESEND_API_KEY=
DELAI_EMAIL_FROM=Delai <claims@notify.delaiapp.com>
DELAI_PUBLIC_APP_URL=https://delaiapp.com
DELAI_EMAIL_DELIVERY_ENABLED=false
DELAI_CONFIRMATION_TOKEN_SECRET=
DELAI_CONFIRMATION_TOKEN_TTL_HOURS=48
CONFIRMATION_LINK_RATE_LIMIT_MAX=30
```

Do not expose the Resend key or confirmation-token secret to the frontend.

## Safety state

The Greater Anglia final-submit switches remain disabled. A positive passenger
response may prepare and queue a claim under the existing workflow, but it
cannot bypass Release 2A's claim-specific final-submission approval.
