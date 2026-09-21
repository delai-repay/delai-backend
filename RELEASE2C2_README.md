# Release 2C.2 — commute monitoring status correction

This maintenance update corrects the response produced when the authenticated
Live Departure Board feed connects successfully but returns no qualifying
delayed or cancelled services.

Previously that safe empty result was labelled
`exact_service_feed_required`, which incorrectly suggested the feed was
missing. The monitoring endpoint now reports `provider_status: connected` and
includes route-level provider diagnostics, queried-route counts and skipped
commutes.

The update does not change disruption eligibility, create synthetic delays,
enable final claim submission, or modify the database schema. No Supabase
migration or new environment variable is required.

After deployment, a normal empty monitoring pass should return HTTP 200 with:

```json
{
  "ok": true,
  "provider_status": "connected",
  "supplied_service_count": 0,
  "created_count": 0
}
```

Run `npm run test:regression` before committing.
