# Release 2C — automatic exact-service commute monitoring

Release 2C connects saved commutes to National Rail Darwin's Live Departure
Board JSON API. It reads destination calling-point times, calculates arrival
delay, and passes only exact delayed or cancelled services into Delai's existing
passenger-confirmation workflow.

## Safety properties

- Disabled by default.
- Requires Rail Data Marketplace-issued credentials.
- Uses destination arrival delay, not departure delay, for Delay Repay.
- Does not treat the text `Delayed` as a quantified delay.
- Does not fabricate a disruption when Darwin or station CRS data is absent.
- Deduplicates identical origin/destination queries across commuters.
- Keeps all Greater Anglia final-submission switches disabled.

## Activation

1. Apply `20260914_release2c_commute_station_codes.sql` once.
2. Subscribe to the National Rail LDB Webservice (Public Version JSON) in Rail
   Data Marketplace and accept its terms.
3. Add the issued username/password to the backend web service only. The cron
   service continues to authenticate to the backend with `CRON_SECRET`.
4. Add the required National Rail attribution to the customer-facing product.
5. Test with `NATIONAL_RAIL_DARWIN_ENABLED=false` first.
6. Set `NATIONAL_RAIL_DARWIN_ENABLED=true` only after an authenticated test.

The existing cron script now calls `/monitor-commutes` before processing the
automation queue. Missing credentials cause an explicit provider failure; they
never produce a detected delay.
