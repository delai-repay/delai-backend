# Greater Anglia confirmation navigation fix

This update targets the live attempt at 20:30–20:31 UK time on 25 October 2026, which reached final review and failed after the old “Select customer declaration” step. Its approval has been consumed and its operator receipt remains unconfirmed. Keep `GREATER_ANGLIA_FINAL_SUBMIT_ENABLED=false` and both payment collection switches false while applying this update and reconciling that attempt.

## What changed

The old generic choice selector considered buttons and links near declaration wording. A local Chromium reproduction using the actual 3.4 source selected and clicked Submit as the declaration. Greater Anglia's public claim form states that final Submit is the action which accepts the scheme terms: <https://greateranglia.delayrepaycompensation.com/index.cfm?action=myclaims.add>.

The new executor is `greater-anglia-end-to-end-3.5-confirmation-navigation`:

- A declaration explicitly bound to final Submit is verified through a passive read. There is no separate declaration click for that form.
- A separate, native declaration checkbox is supported when the portal provides one. Ambiguous or unrecognised controls require review.
- Passive page snapshots can recover from a destroyed navigation context within a bounded time. Clicks and declaration actions are not passed through that retry helper.
- Final Submit uses a single exact Playwright control. Its intent is recorded before the click. An uncertain response remains held for receipt investigation.
- The declaration method is checked again before final submission. The existing fraud-warning, final-review, travel-confirmation, claim-approval and global gates remain in force.

The server, single-use approval service, address verifier, payment implementation and dependency versions are preserved. The regression command gains the new confirmation checks. No database migration is required. The installer does not change existing approval or job records.

## Apply, test and deploy

Save `delai-backend-greater-anglia-confirmation-navigation-fix.zip` in Downloads. Confirm the final-submit switch is false on the Render backend. Then paste this complete block into Windows PowerShell. It applies guarded changes, runs the full existing regression chain and local Chromium fixtures, commits only this update's paths, pushes, and copies a read-only investigation query to the clipboard.

```powershell
& {
    Set-Location "C:\Users\rolla\delai-backend" -ErrorAction Stop
    Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\delai-backend-greater-anglia-confirmation-navigation-fix.zip" -DestinationPath . -Force -ErrorAction Stop

    node scripts/applyGreaterAngliaConfirmationNavigationFix.cjs
    if ($LASTEXITCODE -ne 0) { throw "Confirmation fix could not be applied." }
    npm.cmd run test:regression
    if ($LASTEXITCODE -ne 0) { throw "Regression checks failed. No commit or push was performed." }
    node scripts/testGreaterAngliaConfirmationBrowser.js
    if ($LASTEXITCODE -ne 0) { throw "Chromium checks failed. No commit or push was performed." }

    $updatePaths = @(
        "package.json",
        "src/operators/greaterAngliaPlaywrightExecutor.js",
        "src/operators/greaterAngliaConfirmationNavigation.js",
        "scripts/applyGreaterAngliaConfirmationNavigationFix.cjs",
        "scripts/testGreaterAngliaConfirmationNavigation.js",
        "scripts/testGreaterAngliaConfirmationBrowser.js",
        "scripts/sql/checkGreaterAngliaConfirmationAttempt.sql",
        "patches/greater-anglia-confirmation-navigation",
        "GREATER_ANGLIA_CONFIRMATION_NAVIGATION_MANIFEST.json",
        "GREATER_ANGLIA_CONFIRMATION_NAVIGATION_README.md"
    )
    git add -- $updatePaths
    if ($LASTEXITCODE -ne 0) { throw "Git add failed." }
    git diff --cached --quiet -- $updatePaths
    $changesFound = $LASTEXITCODE
    if ($changesFound -eq 1) {
        git commit --only -m "Fix Greater Anglia declaration and final-submit navigation" -- $updatePaths
        if ($LASTEXITCODE -ne 0) { throw "Git commit failed." }
    } elseif ($changesFound -ne 0) {
        throw "Git change check failed."
    }
    git push
    if ($LASTEXITCODE -ne 0) { throw "Git push failed." }

    Get-Content -LiteralPath "scripts/sql/checkGreaterAngliaConfirmationAttempt.sql" -Raw -ErrorAction Stop | Set-Clipboard
    Write-Host "Update pushed. The read-only investigation query is on your clipboard."
    git status --short
}
```

The installer checks the supplied 3.4 executor and current beta-review sources before writing, makes source backups outside the repository, preserves Windows line endings and can be rerun. If a current source differs, it stops before runtime changes.

Wait for the corresponding Render deployment to become Live. On its Shell, `grep executorVersion src/operators/greaterAngliaPlaywrightExecutor.js` should show version 3.5. Final submission stays paused during receipt investigation.

## Reconcile the existing attempt

Paste the query copied by the block into Supabase SQL Editor and run it. It exposes only the declaration/final-action names, times, control tag/text, checked state, method, approval state and existing operator reference for the latest attempt. It makes no changes.

Check the claim's email inbox and junk folder for a Greater Anglia receipt around 20:31 UK time on 25 October. If an operator reference exists for this exact journey, reconcile that actual receipt with the existing Delai claim. If receipt cannot be established, retain the consumed approval and investigate operator history/evidence before considering recovery. This package includes no reset or reapproval operation for consumed approvals.

## Verification completed

- Reproduced the Submit-as-declaration bug using actual 3.4 source on a local synthetic page.
- 31 logic/guard checks, including lost action responses, locked final submission, changed declaration methods and bounded passive-read retries.
- 26 real Chromium fixtures, including a controlled same-URL navigation, the current declaration wording pattern, hidden/ambiguous controls, passive declaration verification and a single synthetic local form POST.
- 8 installer checks, including LF/CRLF, the installed tests on Windows-style CRLF source, idempotency, modified source guards and rollback.
- The 12 locally available prior regression scripts passed, including security, fee ledger, claim approval/deadline, required inputs, address verification and beta review.

The Chromium fixture run here used portable Chromium 153 with the project's installed Playwright. The included browser command uses your installed Playwright browser, including the Render/Windows Chromium 149 configuration. The available local supporting source lacks Releases 2C, 2D and 2D.1, so the block deliberately runs your complete current regression chain before committing or pushing. Fixture requests are restricted to localhost; they do not submit an operator claim or collect fees. The public operator form was inspected read-only to verify declaration semantics.
