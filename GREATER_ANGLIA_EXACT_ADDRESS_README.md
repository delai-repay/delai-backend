# Greater Anglia exact address fix

The saved profile address was correct, but the portal's final review displayed a different house number. The previous audit recorded the text of a clicked element without verifying the selected value.

This overlay targets the executor uploaded on 16 October 2026 (version `greater-anglia-end-to-end-3.2`). The installer verifies its SHA-256 before changing it, backs up the executor and package.json outside the repository, and refuses a different source version. It is safe to run twice. Updated version: `greater-anglia-end-to-end-3.3-address-verified`.

## Revision 2: portable test timing

The first test harness used real 1 ms sleeps with a 15 ms timeout. Coarse Windows timers could exhaust the lookup budget before the fixture exposed its options, yielding `address_option_not_found` instead of the intended `address_selection_mismatch` assertion.

Revision 2 advances a controlled fixture clock by the polling duration, restores the real clock in a finally block, and verifies the broken-binding tests actually select the exact option and read the bound state repeatedly. The production executor, address verification module, and submission gates are unchanged. Previously installed copies can extract this revision and rerun regression checks; the installer will report that the source update is already installed.

## Behavior

- Select one exact address option using the saved house/street, supplied locality fields and UK postcode. Treat house numbers 1, 11, 111 and 11A as different values.
- Use Playwright's real `click()` / `selectOption()` actions on address controls/options. Arbitrary page containers cannot become address options.
- Wait for asynchronous lookup/dropdown results. Missing or duplicate exact matches stop the run.
- Read the actual selected value twice after rendering. A clicked label cannot count as successful selection.
- Verify the Your Details region of final review before reporting a successful dry run, and again immediately before any authorised final submission.
- The portal's review card can omit the postcode. In that case the guard requires the postcode already verified on the personal-details step for these same saved details. A conflicting visible postcode stops the run.
- Diagnostics record booleans and error codes, not the address text. The private proof stays under the existing audit-redacted address key.

All existing submission gates, customer declarations and claim-specific approvals are preserved. Keep `GREATER_ANGLIA_FINAL_SUBMIT_ENABLED=false` during installation and verification. This update does not submit the claim or change that environment variable.

## Install and test on Windows

Download `delai-backend-greater-anglia-exact-address-fix-v2.zip` into Downloads, then run in PowerShell:

```powershell
& {
    Set-Location "C:\Users\rolla\delai-backend" -ErrorAction Stop
    Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\delai-backend-greater-anglia-exact-address-fix-v2.zip" -DestinationPath . -Force -ErrorAction Stop

    node scripts/applyGreaterAngliaAddressFix.cjs
    if ($LASTEXITCODE -ne 0) { throw "Address fix could not be applied." }

    npm.cmd run test:regression
    if ($LASTEXITCODE -ne 0) { throw "Regression checks failed." }

    git status --short
}
```

The installer appends `testGreaterAngliaAddressVerification.js` to the existing regression command. It preserves the newer Release 2C, 2D, 2D.1 and required-input checks already in your package.json. It adds `test:ga-address` and `test:ga-address-browser` commands. There are no new npm dependencies.

If the installer reports that the executor differs, stop and supply that current executor. It has left the executor and package.json unchanged.

## Commit after regression checks pass

Review `git diff` and `git status --short`. Stage only the files below:

```powershell
& {
    Set-Location "C:\Users\rolla\delai-backend" -ErrorAction Stop
    git add -- package.json src/operators/greaterAngliaPlaywrightExecutor.js src/operators/greaterAngliaAddressVerification.js scripts/applyGreaterAngliaAddressFix.cjs scripts/testGreaterAngliaAddressVerification.js scripts/testGreaterAngliaAddressBrowser.js scripts/sql/checkGreaterAngliaAddressVerification.sql GREATER_ANGLIA_EXACT_ADDRESS_README.md
    if ($LASTEXITCODE -ne 0) { throw "Git add failed." }
    git commit -m "Verify Greater Anglia address selection and final review"
    if ($LASTEXITCODE -ne 0) { throw "Commit failed." }
    git push
    if ($LASTEXITCODE -ne 0) { throw "Push failed." }
}
```

## Verify on Render before another claim preparation

Wait for the new commit to deploy successfully, with the final-submit flag still false. The Render build command already installs Chromium and checks launch; retain it and `PLAYWRIGHT_BROWSERS_PATH=0`.

In the Render service's Shell, type:

```bash
node scripts/testGreaterAngliaAddressBrowser.js
```

This browser test opens only local synthetic HTML. It checks native/custom selection, the wrong binding after a click, asynchronous lookup, arbitrary-container false positives, the scope of the review card, missing postcode handling and wrong postcode rejection. It never visits the operator portal.

After this passes, prepare the claim again with the final-submit lock still false. Re-arm only the existing unsubmitted, safety-locked claim using the previously agreed guarded process; keep the audit history. A new run is needed because earlier screenshots describe the old code.

Run `scripts/sql/checkGreaterAngliaAddressVerification.sql` in Supabase SQL Editor after the new preparation. A successful locked run should show:

- executor version `greater-anglia-end-to-end-3.3-address-verified`;
- `Select postcode address` with `ok`, `lineMatched` and `postalMatched` true;
- `Verify final review address` with `ok`, `proofValid`, `lineMatched` and `postalMatched` true;
- `final_submit_enabled=false`, `submitted=false`, and no operator reference;
- the existing safety-locked source and a new final-review screenshot.

If a verification error occurs, share the latest read-only query result. Do not enable final submission or replace the saved profile address to work around the error. Inspect the new final-review screenshot before considering the address issue resolved.

## Validation performed while preparing this update

The twelve focused regression groups passed, and the available backend snapshot's regression suite through Release 2B passed. The guarded installer was checked for exact output, repeated installation, rejection of independently modified source, preservation of newer regression commands, and unchanged existing submission-gate functions.

Chromium could not be installed in the preparation environment because the download was truncated, so the real-browser fixture test is provided for Render. The current full regression suite on your PC, Render browser fixtures, and a new safety-locked portal run remain the deployment checks.
