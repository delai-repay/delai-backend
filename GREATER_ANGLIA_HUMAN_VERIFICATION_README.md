# Greater Anglia human-verification detection

The Greater Anglia attempt at 11:35–11:36 UK time on 27 October 2026 clicked final Submit. Both saved screenshots then showed an unchecked reCAPTCHA and “Terms & Conditions - Captcha error”. The claim has no saved operator reference. Its single-use approval remains consumed and its submission job remains blocked. Keep final submission paused while reconciling that attempt.

## Resulting behaviour

Executor `greater-anglia-end-to-end-3.6-human-verification` stops when the final-review page contains an active reCAPTCHA widget, a configured widget that is still loading, or a visible CAPTCHA validation error. This check runs during paused preparation, at the live-submit boundary and again immediately before recording click intent. An enabled Submit button cannot override it.

The guard records `operator_human_verification_required` with boolean evidence. A blocked pre-submit run uses source `greater_anglia_playwright_human_verification_required`. It does not record Submit intent or interact with the challenge. Hidden templates are ignored. No CAPTCHA response values are accessed.

Central backend messages now distinguish human verification, prepared review, general submission issues and an uncertain final action. The job result no longer describes a security-check exception or an uncertain final action as “preparing automatic submission”. Customer pages recognise the same cases, including the persisted uncertain message from executor 3.5 after Refresh status. Portal diagnostics are classified using known values and are not rendered to customers.

The existing claim-specific approval, fraud declaration, address verification, owner authentication, claim deadline, global submission switch and fee collection gates remain in place. Dependency versions are unchanged.

## Human completion and the automation goal

This update detects the need for a person on the operator's website. It does not provide a live browser handoff or a CAPTCHA solver. The browser from the 27 October attempt has closed; its screenshot is evidence, not an interactive session. Opening the public operator form starts a separate session and does not resume the prepared browser claim.

Before another submission for this journey, reconcile the existing attempt against an operator receipt or confirmed operator status. Retain the consumed approval and blocked job. The existing 25 October logo-navigation recovery SQL is specific to that older event and must not be used to reset this attempt. This package runs no SQL and makes no claim, job, approval or payment changes during installation.

For the private beta, interactive security checks need a manual completion process with a recorded operator reference. Fully unattended operation will require an operator-supported submission route compatible with it. No availability of such a route is assumed here.

## Apply and verify

1. Preserve both screenshots, then set the backend's `GREATER_ANGLIA_FINAL_SUBMIT_ENABLED=false` in Render and use **Save and deploy**. Keep `PAYMENTS_FEE_COLLECTION_ENABLED=false` and `PAYMENTS_LIVE_COLLECTION_ENABLED=false`.
2. Download `delai-greater-anglia-human-verification-fix.zip` to Downloads.
3. Paste the whole block below into Windows PowerShell. It applies both guarded overlays and tests both projects before committing or pushing either one. If any command fails, send its output. Existing unrelated Git changes are excluded from the commits.

```powershell
& {
    $updateFolder = Join-Path $env:TEMP "delai-ga-human-verification-3-6"
    Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\delai-greater-anglia-human-verification-fix.zip" -DestinationPath $updateFolder -Force -ErrorAction Stop

    Set-Location "C:\Users\rolla\delai-backend" -ErrorAction Stop
    Expand-Archive -LiteralPath "$updateFolder\backend-overlay.zip" -DestinationPath . -Force -ErrorAction Stop
    node scripts/applyGreaterAngliaHumanVerificationFix.cjs
    if ($LASTEXITCODE -ne 0) { throw "Backend update stopped. No commit or push was performed." }
    npm.cmd run test:regression
    if ($LASTEXITCODE -ne 0) { throw "Backend regression checks failed. No commit or push was performed." }
    node scripts/testGreaterAngliaHumanVerificationBrowser.js
    if ($LASTEXITCODE -ne 0) { throw "Human-verification browser checks failed. No commit or push was performed." }
    node scripts/testGreaterAngliaConfirmationBrowser.js
    if ($LASTEXITCODE -ne 0) { throw "Confirmation browser checks failed. No commit or push was performed." }

    Set-Location "C:\Users\rolla\delai-site" -ErrorAction Stop
    Expand-Archive -LiteralPath "$updateFolder\frontend-overlay.zip" -DestinationPath . -Force -ErrorAction Stop
    node scripts/applyGreaterAngliaHumanVerificationFix.cjs
    if ($LASTEXITCODE -ne 0) { throw "Frontend update stopped. No commit or push was performed." }
    node scripts/testClaimStatusMessages.js
    if ($LASTEXITCODE -ne 0) { throw "Status message checks failed. No commit or push was performed." }
    node scripts/testClaimStatusRefresh.js
    if ($LASTEXITCODE -ne 0) { throw "Status refresh checks failed. No commit or push was performed." }
    node scripts/testClaimHumanVerification.js
    if ($LASTEXITCODE -ne 0) { throw "Human-verification message checks failed. No commit or push was performed." }
    node scripts/testClaimFinalReview.js
    if ($LASTEXITCODE -ne 0) { throw "Review checks failed. No commit or push was performed." }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed. No commit or push was performed." }

    Set-Location "C:\Users\rolla\delai-backend" -ErrorAction Stop
    $backendPaths = @("package.json", "src/server.js", "src/operators/greaterAngliaPlaywrightExecutor.js", "scripts/testGreaterAngliaConfirmationNavigation.js", "scripts/testGreaterAngliaConfirmationBrowser.js", "scripts/testGreaterAngliaHumanVerification.js", "scripts/testGreaterAngliaHumanVerificationBrowser.js", "scripts/applyGreaterAngliaHumanVerificationFix.cjs", "patches/greater-anglia-human-verification", "GREATER_ANGLIA_HUMAN_VERIFICATION_MANIFEST.json", "GREATER_ANGLIA_HUMAN_VERIFICATION_README.md")
    git add -- $backendPaths
    if ($LASTEXITCODE -ne 0) { throw "Backend Git add failed." }
    git diff --cached --quiet -- $backendPaths
    $backendDiff = $LASTEXITCODE
    if ($backendDiff -eq 1) {
        git commit --only -m "Stop Greater Anglia automation for human security checks" -- $backendPaths
        if ($LASTEXITCODE -ne 0) { throw "Backend commit failed." }
    } elseif ($backendDiff -ne 0) { throw "Backend Git change check failed." }
    git push
    if ($LASTEXITCODE -ne 0) { throw "Backend push failed." }

    Set-Location "C:\Users\rolla\delai-site" -ErrorAction Stop
    $frontendPaths = @("src/lib/claimStatusMessages.js", "src/lib/claimStatusRefresh.js", "scripts/testClaimHumanVerification.js", "scripts/applyGreaterAngliaHumanVerificationFix.cjs", "patches/greater-anglia-human-verification", "GREATER_ANGLIA_HUMAN_VERIFICATION_MANIFEST.json", "GREATER_ANGLIA_HUMAN_VERIFICATION_README.md")
    git add -- $frontendPaths
    if ($LASTEXITCODE -ne 0) { throw "Frontend Git add failed." }
    git diff --cached --quiet -- $frontendPaths
    $frontendDiff = $LASTEXITCODE
    if ($frontendDiff -eq 1) {
        git commit --only -m "Explain operator security checks and uncertain submissions" -- $frontendPaths
        if ($LASTEXITCODE -ne 0) { throw "Frontend commit failed." }
    } elseif ($frontendDiff -ne 0) { throw "Frontend Git change check failed." }
    git push
    if ($LASTEXITCODE -ne 0) { throw "Frontend push failed." }
    git status --short
}
```

Keep final submission paused after deployment. Refresh status on the existing claim; its recorded 3.5 uncertain outcome should show **Your submission is being checked**. Installing this update does not run the operator browser, create a new claim attempt, or supply fresh approval.

## Validation

Validation uses synthetic local pages and mocked application data. No real CAPTCHA challenge, operator submission, email, payment collection or live database mutation is used.

- 29 new backend guard and actual worker-branch checks.
- 15 new Chromium fixtures, including enabled Submit beside a challenge, a loading widget, late challenge insertion and the observed CAPTCHA error wording. No challenge interactions or response-token reads occur.
- Existing 31 confirmation logic checks and 26 confirmation Chromium fixtures.
- 16 new customer message/refresh checks, existing 20 refresh checks, 15 review API checks and existing central message checks.
- 13 available existing backend regression scripts passed. The local supporting snapshot lacks Releases 2C, 2D and 2D.1; the complete current regression chain is run on your computer before push.
- 20 rendered ClaimDetails fixtures passed, including disabled actions for the new security-check and persisted uncertain outcomes. All HTTP and database calls were mocked.
- The frontend production build passed. Both installers passed 16 checks covering LF/Windows CRLF, idempotency, modified-source rejection, preserved supporting files and partial-write rollback.

The local browser fixture runtime uses portable Chromium 153 with Playwright. The supplied tests use the browser installed with your project's Playwright, including your Windows/Render configuration. This package changes no browser or dependency versions.
