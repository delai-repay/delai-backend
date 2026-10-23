# Greater Anglia address picker update (executor 3.4)

The 23 October 2026 run reached Personal Details with executor 3.3 but reported `address_option_not_found` and `optionCount: 0`. The exact-address checks had recognised native/ARIA dropdowns, while the live Tracsis portal uses its own postcode-suggestion rows.

The live form was inspected using public postcodes, without entering passenger details, progressing the claim, or submitting a claim. Its address rows are direct children of `#postcode #autosuggest-form`, identified by `.item.getFullAddressByID[data-type="Address"][data-id]`. Selection populates the real `txtAddress1`, `txtAddress2`, `txtCityTown`, postcode and country form controls, with the address fields normally hidden by CSS.

## Changes

- Detect only this recognised picker structure and its specifically identified address rows.
- Re-enter the saved postcode with real keyboard events and blur, then wait for the exact lookup result. Allow time for partial-postcode results to be replaced.
- Keep exact house/street, supplied locality, postcode and ambiguity checks.
- Click the exact row and read back the actual bound form fields twice. Require the address-line-1 field itself to match; a correct-looking suggestion or description cannot hide a wrong stored house number.
- Retain the existing final-review address verification and every existing submission gate.

Executor version: `greater-anglia-end-to-end-3.4-address-picker`.

The installer verifies the existing executor, helper and test files against the supplied 3.3/v2 baselines before changing any runtime file. It makes backups outside the repository, preserves existing line endings, supports repeated installation, and leaves package.json and all existing regression commands intact. Files under `patches/greater-anglia-address-picker` are installer payloads, not runtime imports.

## Install and verify on your PC

Keep `GREATER_ANGLIA_FINAL_SUBMIT_ENABLED=false`. Download `delai-backend-greater-anglia-address-picker-fix.zip` into Downloads and run:

```powershell
& {
    Set-Location "C:\Users\rolla\delai-backend" -ErrorAction Stop
    Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\delai-backend-greater-anglia-address-picker-fix.zip" -DestinationPath . -Force -ErrorAction Stop
    node scripts/applyGreaterAngliaAddressPickerFix.cjs
    if ($LASTEXITCODE -ne 0) { throw "Address picker update failed." }
    npm.cmd run test:regression
    if ($LASTEXITCODE -ne 0) { throw "Regression checks failed." }
    node scripts/testGreaterAngliaAddressBrowser.js
    if ($LASTEXITCODE -ne 0) { throw "Browser checks failed." }
    git status --short
}
```

Expected: 14 focused address checks and 14 browser-fixture checks. The browser test uses synthetic local HTML and contacts no operator portal. It now includes the Tracsis picker, keyboard-triggered asynchronous results, CSS-hidden bound fields, wrong binding behind a correct visible description, absent and duplicate matches, and a misleading combined address assembled from a wrong first field.

If the installer detects an independently modified runtime/test file, stop and provide that current file for a matching patch. The runtime files have not been changed.

## Commit and deploy after tests pass

Review the diff and stage only these files:

```powershell
& {
    Set-Location "C:\Users\rolla\delai-backend" -ErrorAction Stop
    git add -- src/operators/greaterAngliaPlaywrightExecutor.js src/operators/greaterAngliaAddressVerification.js scripts/testGreaterAngliaAddressVerification.js scripts/testGreaterAngliaAddressBrowser.js scripts/applyGreaterAngliaAddressPickerFix.cjs patches/greater-anglia-address-picker GREATER_ANGLIA_ADDRESS_PICKER_README.md
    if ($LASTEXITCODE -ne 0) { throw "Git add failed." }
    git commit -m "Support Greater Anglia postcode picker and verify stored address"
    if ($LASTEXITCODE -ne 0) { throw "Commit failed." }
    git push
    if ($LASTEXITCODE -ne 0) { throw "Push failed." }
}
```

Keep the existing Render Chromium build command and `PLAYWRIGHT_BROWSERS_PATH=0`. After the new commit is live, type these commands in Render Shell:

```bash
printenv GREATER_ANGLIA_FINAL_SUBMIT_ENABLED
grep executorVersion src/operators/greaterAngliaPlaywrightExecutor.js
node scripts/testGreaterAngliaAddressBrowser.js
```

Expect `false`, executor 3.4, and 14 browser-fixture checks passed. Final submission remains locked. Re-arm only the known unsubmitted failed claim after deployment is verified, then prepare it once and inspect its new audit and final-review screenshot.

A successful new address-selection step should have `method=exact_tracsis_address_option`, `lineMatched=true`, `postalMatched=true`, and `postalSource=bound_form_fields`. The existing final-review verification must also pass before the run can return the safety-locked final-review result.

## Validation performed for this update

The 14 focused checks and the available backend snapshot's regression suite through Release 2B pass. The live portal's picker markup and the form fields populated by a selection were observed using public addresses. Installer checks cover repeated application, unexpected-source refusal, CRLF handling, package preservation and unchanged final-submission gates.

The new browser fixtures must be run on your PC and Render. A usable local Chromium binary was unavailable in the preparation environment because the browser download was truncated. The final review of this customer's new claim has not yet been verified.
