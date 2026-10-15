# Greater Anglia required-input fix

The recorded attempt for claim `af1e72d0-6652-4a76-be72-434ba7c64a59` stopped with `greater_anglia_playwright_missing_inputs` before the operator browser was launched. The exact missing-field list for that real claim has not yet been returned.

Two issues are confirmed in the supplied source:

1. The passenger context includes title/salutation, but the Greater Anglia adapter drops both when constructing the mapped passenger details.
2. General readiness can succeed without address and postcode, although the Greater Anglia portal plan requires them. The UI can therefore show Ready before the executor rejects the same inputs.

This update forwards title/salutation and reuses the portal's required-input check during ordinary validation. Missing fields receive specific labels such as Passenger title, Passenger address line 1, and Passenger postcode. Validation reports these gaps before submission is attempted. The stricter requirements apply to Greater Anglia Delay Repay; cancellation validation follows its existing path.

## Install and check in PowerShell

Download the ZIP to Downloads, then run:

```powershell
& {
    Set-Location "C:\Users\rolla\delai-backend" -ErrorAction Stop
    Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\delai-backend-greater-anglia-required-inputs-fix.zip" -DestinationPath . -Force -ErrorAction Stop

    node scripts/applyGreaterAngliaInputFix.cjs
    if ($LASTEXITCODE -ne 0) { throw "The Greater Anglia fix could not be applied." }

    npm.cmd run test:regression
    if ($LASTEXITCODE -ne 0) { throw "Regression checks failed. Send the output." }

    git status --short
}
```

The installer checks edit locations before writing, backs up edited files to the system temporary folder, and applies to your current source instead of overwriting the complete server with an older version. Repeated installation does not duplicate imports or regression commands. Use `node scripts/applyGreaterAngliaInputFix.cjs --check` for a compatibility check without source changes.

Your existing regression command is preserved, including any current pilot-email tests, and `node scripts/testGreaterAngliaRequiredInputs.js` is appended. You can run that new test alone with `npm.cmd run test:ga-inputs`.

## Read the real claim's audit

Run the contents of `scripts/sql/checkGreaterAngliaMissingInputs.sql` in Supabase SQL Editor and return the result. It returns field names, not passenger values. If it returns no row, report that result.

## Deploy after the local regression suite passes

Review `git status --short`, then stage these files:

```powershell
git add -- package.json src/server.js src/operators/greaterAngliaOperatorAdapter.js src/operators/submissionValidation.js src/operators/greaterAngliaRequiredInputs.js scripts/testSubmissionValidation.js scripts/testGreaterAngliaRequiredInputs.js scripts/applyGreaterAngliaInputFix.cjs scripts/sql/checkGreaterAngliaMissingInputs.sql GREATER_ANGLIA_REQUIRED_INPUTS_README.md
git diff --cached --stat
```

Commit with `git commit -m "Fix Greater Anglia title mapping and required-input validation"` and push using your normal backend branch. Wait for the matching Render deployment to finish. No dependency installation or database migration is required by this update.

Keep `GREATER_ANGLIA_FINAL_SUBMIT_ENABLED=false` for the ongoing dry run. This update does not alter the submission switches or claim-specific approval requirement.

## Check the prepared claim after deployment

Refresh Delai and reopen the 07/10/2026, 18:42 London Liverpool Street to Hatfield Peverel claim. The readiness check will name any remaining required fields. Use the Update profile/ticket action beside a listed field and save the passenger's correct details. A value already present in the profile should now reach the mapped plan correctly.

The existing held claim will still need its controlled retry once readiness is verified. Do not treat a passing code test as evidence that the real passenger data or portal run has passed. The saved audit and the next claim result establish that separately.

## Files changed by the installer

- `src/operators/greaterAngliaOperatorAdapter.js`: preserves title and salutation.
- `src/operators/submissionValidation.js`: adds the operator's own required-input issues and removes duplicate warnings for blocking fields.
- `src/server.js`: maps the exact field names to specific customer labels.
- `scripts/testSubmissionValidation.js`: updates the original valid sample with complete passenger details when that sample is present.
- `package.json`: adds the new test while retaining existing release scripts.

The ZIP also supplies the shared required-input helper, its regression test, this installer, and the read-only audit query.

## Verification completed

- The saved-source regression suite through Release 2D passed with the new required-input test appended.
- The new test follows a synthetic profile through context building, actual adapter mapping and portal readiness. It covers title/salutation, missing title/address/postcode, other operators, cancellation scope, journey time, specific ticket errors and absence of passenger values in public issues.
- Syntax checks passed for the edited server, validator, adapter and new helper.
- The adapter's submission and approval code is unchanged.

The supplied source snapshot does not contain the newer Release 2D.1 pilot-email test. The installer retains that test in your own regression command; the PowerShell step above runs your current full suite. No live database or operator claim was submitted from this workspace.
