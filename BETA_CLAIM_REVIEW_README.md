# Delai beta: customer claim review and approval

Prepared 23 October 2026 for the current backend source you uploaded and the deployed frontend claim-status refresh update (205e106).

Version 2 fixes the new test's Windows line-ending handling. It normalises the server source before matching the worker's code. On an installed version 1 backend, the installer updates only `scripts/testBetaClaimReview.js`; the application source and dependency files already match. The test has been rerun successfully against both LF and CRLF server files, including an upgrade from an installed version 1 package.

This adds a signed-in customer review screen for prepared Greater Anglia claims. It displays the journey, passenger address, ticket, masked payment details, success fee and deadline. A customer must explicitly tick consent and choose **Approve and submit claim** before the existing claim-specific approval and submission queue can run.

**Keep `GREATER_ANGLIA_FINAL_SUBMIT_ENABLED=false` throughout installation and checking.** The screen will show that submissions are paused and disable approval. These installers do not change environment variables, submit a claim, write to Supabase, send email or collect payment.

The backend also fixes two approval blockers: the journey date was missing from the approval lookup, and the snapshot fingerprint changed with a generated timestamp and submission workflow state. The new shared fingerprint excludes those two changing fields while protecting the claim, owner, journey, passenger, ticket and payment details. Existing operator address verification and the separate global submission gate remain in place.

The package contains `backend-overlay.zip`, `frontend-overlay.zip` and this README. Each overlay contains staged source, a guarded installer, a manifest and project notes. The installer checks all existing files and payloads before applying runtime changes, accepts LF or CRLF, backs up source outside the repository, and rolls back a write failure. A second run is safe. If it reports a different source file, stop and provide that current file; the installer has deliberately preserved it.

## 1. Install and test the backend

Save `delai-beta-claim-review-approval-v2.zip` in Downloads. Paste this complete block into Windows PowerShell:

```powershell
& {
    $ErrorActionPreference = "Stop"
    $bundlePath = Join-Path $env:USERPROFILE "Downloads\delai-beta-claim-review-approval"

    Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\delai-beta-claim-review-approval-v2.zip" -DestinationPath $bundlePath -Force
    Set-Location "C:\Users\rolla\delai-backend" -ErrorAction Stop
    Expand-Archive -LiteralPath "$bundlePath\backend-overlay.zip" -DestinationPath . -Force

    node scripts/applyBetaClaimReview.cjs
    if ($LASTEXITCODE -ne 0) { throw "Backend review update was not applied." }

    npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }

    npm.cmd run test:regression
    if ($LASTEXITCODE -ne 0) { throw "Regression checks failed. Do not push yet." }

    git diff --stat
    git status --short
}
```

The existing regression chain is preserved, including Releases 2C, 2D and 2D.1. It now ends with **Beta claim review: 25 checks passed**. Those new checks use fake accounts, a fake database and a local HTTP server. They cannot send an operator claim. `npm ci` is needed because the lockfile includes targeted compatible patches for production dependencies; declared dependency ranges are unchanged.

The full npm audit may still print four development-tooling alerts. Production audit reports zero; see the validation notes. The installer does not run an automatic major-version audit fix.

Run the read-only SQL in `scripts/sql/checkBetaClaimReviewReadiness.sql` in **Supabase → SQL Editor**. All six columns should be `true`. It checks the existing approval table, approval RPCs, RLS and the active-job uniqueness index. If any is false, leave the final-submit flag false and resolve that schema prerequisite before proceeding. The existing migrations are `supabase/migrations/20260902_release2a_claim_submission_approvals.sql` and `supabase/migrations/20260824_release1_security_fee_ledger.sql`.

After the complete regression suite passes and you have reviewed `git diff`, commit and push:

```powershell
& {
    Set-Location "C:\Users\rolla\delai-backend" -ErrorAction Stop
    git add -- package.json package-lock.json src/server.js src/operators/submissionSnapshot.js src/operators/claimFinalReview.js scripts/testBetaClaimReview.js scripts/applyBetaClaimReview.cjs scripts/sql/checkBetaClaimReviewReadiness.sql patches/beta-claim-review BETA_CLAIM_REVIEW_MANIFEST.json BETA_CLAIM_REVIEW_README.md
    if ($LASTEXITCODE -ne 0) { throw "Git add failed." }
    git commit -m "Add customer claim review and explicit submission approval"
    if ($LASTEXITCODE -ne 0) { throw "Commit failed." }
    git push
    if ($LASTEXITCODE -ne 0) { throw "Push failed." }
}
```

Wait for Render to deploy that commit and show **Your service is live**. Keep the existing build command, including Chromium installation and its launch check. In the Render shell, type:

```bash
printenv GREATER_ANGLIA_FINAL_SUBMIT_ENABLED
grep -n 'claim-final-submit-review' src/server.js
```

The first result must be `false`. The second should show the new review endpoint. No claim reset is required.

## 2. Install and test the frontend

Apply this only after the backend deployment is live:

```powershell
& {
    $ErrorActionPreference = "Stop"
    $bundlePath = Join-Path $env:USERPROFILE "Downloads\delai-beta-claim-review-approval"
    Set-Location "C:\Users\rolla\delai-site" -ErrorAction Stop
    Expand-Archive -LiteralPath "$bundlePath\frontend-overlay.zip" -DestinationPath . -Force

    node scripts/applyBetaClaimReview.cjs
    if ($LASTEXITCODE -ne 0) { throw "Frontend review update was not applied." }
    node scripts/testClaimStatusMessages.js
    if ($LASTEXITCODE -ne 0) { throw "Status message checks failed." }
    node scripts/testClaimStatusRefresh.js
    if ($LASTEXITCODE -ne 0) { throw "Status refresh checks failed." }
    node scripts/testClaimFinalReview.js
    if ($LASTEXITCODE -ne 0) { throw "Claim review checks failed." }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Build failed." }
    git diff --stat
    git status --short
}
```

The frontend dependency files are unchanged. Existing status copy and layout remain centralised. New review copy is in `src/lib/claimReviewMessages.js`, and formatting is in the dedicated review component and CSS. The existing reference, operator-response and outcome actions now send the session bearer token required by their authenticated backend endpoints.

After those checks pass and you have reviewed `git diff`, commit and push:

```powershell
& {
    Set-Location "C:\Users\rolla\delai-site" -ErrorAction Stop
    git add -- src/pages/ClaimDetails.jsx src/lib/claimStatusRefresh.js src/lib/claimStatusMessages.js src/lib/claimReviewMessages.js src/lib/claimFinalReviewApi.js src/components/ClaimFinalReviewPanel.jsx src/components/ClaimFinalReviewPanel.css scripts/testClaimFinalReview.js scripts/applyBetaClaimReview.cjs patches/beta-claim-review BETA_CLAIM_REVIEW_MANIFEST.json BETA_CLAIM_REVIEW_README.md
    if ($LASTEXITCODE -ne 0) { throw "Git add failed." }
    git commit -m "Add customer review and explicit claim approval screen"
    if ($LASTEXITCODE -ne 0) { throw "Commit failed." }
    git push
    if ($LASTEXITCODE -ne 0) { throw "Push failed." }
}
```

Wait for the matching Vercel deployment to become Ready, then reopen the site.

## 3. Check the deployed screen with submission paused

Sign in, open the prepared Greater Anglia claim, select **Refresh status**, then **Review claim**. Check the address begins with house number **11**, the journey is 7 October at 18:42, the annual ticket cost is £5,620, and the bank and smartcard numbers show only their last four digits. The success fee should be 10%.

You should see **Final submissions are paused while we finish testing**. The consent checkbox and **Approve and submit claim** button must be disabled. Opening, refreshing or closing the review only reads current details. It must not record approval or queue submission while paused.

If a prior unused approval exists, the owner can cancel that approval before consumption. Expired approvals can be checked and, when still atomically revocable, cancelled. Consumed approvals cannot be reset. A reservation with no confirmed approval record stays held for investigation because its original request may still be finishing. Refresh status; a persistent held state needs operator-side and approval-audit checks before recovery.

Approval and completed submission have separate messages. Only actual recorded submission evidence moves the page to Submitted; an approval response alone does not. A lone operator reference with no submitted state stays under checking.

No live end-to-end submission has been performed as part of this package. Before a later authorised live rehearsal, confirm the worker runs within the existing 15-minute approval window. The 7 October test journey reaches the existing application's 28-day deadline on 4 November; December beta journeys must be genuinely current and eligible.

## December beta milestones

| Target | Completion evidence |
| --- | --- |
| By 31 October | Deployed review screen; then one separately authorised, eligible claim receives a real operator reference. |
| 1–14 November | Trace the claim through operator outcome, compensation receipt, success-fee accrual and the agreed collection flow. |
| 15–22 November | Exercise job recovery, duplicate prevention, expired and uncertain approvals, private evidence access, alerts and development-tooling security updates. |
| 23–30 November | Rehearse onboarding, truthful travel confirmation, fee consent, support and deletion with an allowlisted group. |
| 1 December | Start a private beta with 5–10 Greater Anglia commuters once the complete lifecycle and support process have passed. |

Broader rail coverage can use the existing operator adapter boundary. This update does not make the beta depend on a future unified rail website.

## Validation completed here

| Check | Result |
| --- | --- |
| Backend review/auth/approval/worker-consumption fixtures | 25 passed; all database, queue and operator dependencies mocked. |
| Frontend review API fixtures | 15 passed. |
| Rendered React review and full claim-page fixtures | 34 passed, using the project's locked React dependencies. |
| Existing status refresh fixtures | 20 passed; centralised status tests also passed. |
| Overlay installers | 18 passed, including CRLF, preflight, idempotency, conflicting edits, corrupt payloads and rollback. |
| Frontend production build | Passed with Vite 8.0.10 in the available app copy. |
| Available existing backend checks | Submission validation, Steps 20A–D, payments, Release 1, Releases 2A/2B, required inputs and 14 address-verification checks passed. |
| Production dependency audit | Zero reported vulnerabilities after targeted lockfile updates. |

The uploaded backend bundle contains five current files rather than the full repository. The locally available supporting snapshot does not contain Releases 2C, 2D and 2D.1, so their full regression checks must run on your PC before pushing. The current full site build must also run on your PC; the local available app copy is not your entire latest repository. No hosted service or real Supabase database was exercised here.

The full backend dependency audit still reports four high development-only findings through `brace-expansion`, `braces`, `chokidar` and `nodemon`. The compatible nodemon update does not clear that chain. These remain a separate development-tooling task before beta; this package's zero-vulnerability result applies specifically to `npm audit --omit=dev`.
