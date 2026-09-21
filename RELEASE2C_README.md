# Release 2C — automatic exact-service commute monitoring

## RDM gateway correction (Release 2C.1)

The Rail Data Marketplace cURL example uses the application's Consumer Key in
an `x-apikey` header. The backend now requests the gateway's
`GetDepBoardWithDetails` operation, because a plain `GetDepartureBoard` response
does not include the destination calling points needed to calculate arrival
delay. Whether this application is authorised for the detailed operation must
be established by the read-only live probe; a successful unit test cannot
confirm a marketplace subscription. An HTTP 403 or a board with no calling
points on populated services needs further access investigation.

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
3. Add your subscribed application's Consumer Key to the backend web service as
   `NATIONAL_RAIL_DARWIN_API_KEY`. The RDM cURL sample uses `x-apikey` for this
   product; never publish the key or add the Consumer Secret to this adapter.
   The cron service continues to authenticate to the backend with `CRON_SECRET`.
4. Add the required National Rail attribution to the customer-facing product.
5. Test with `NATIONAL_RAIL_DARWIN_ENABLED=false` first.
6. Call the authenticated `/probe-darwin` endpoint with `x-cron-secret` after
   the backend deploys. It makes one read-only request for HAP to LST, while
   normal monitoring remains disabled. Confirm a successful response from
   `GetDepBoardWithDetails` and destination calling points on a populated board.
7. Set `NATIONAL_RAIL_DARWIN_ENABLED=true` only after this live probe succeeds
   and the operational schedule and attribution are verified.

The existing cron script now calls `/monitor-commutes` before processing the
automation queue. Missing credentials cause an explicit provider failure; they
never produce a detected delay.
