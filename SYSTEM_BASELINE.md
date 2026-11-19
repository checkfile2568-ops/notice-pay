# System baseline — status: BLOCKED / not certified

Established 2026-11-19. This records observed source facts, not an assertion that production is correct.

| Reference | Evidence / role |
|---|---|
| 6994932ad7 | 0.7.19: 45 literal UI API calls, all found in repository GAS; no batch import |
| 04c606d4d9 | 0.7.20: 45 literal UI API calls, all found in repository GAS; batch import present; historical comparison reference |
| 67acf16ed1817d3b421214cf2b09b66fa3932dd6 | 0.7.26: 8 literal UI API actions absent from repository GAS |
| a2379722f2dff401de2a1928e637a1d7796a1359 | audited main: 54 literal UI API actions; 9 absent from repository GAS; root UI 0.7.32 and config 0.7.33, source/web and GAS 0.7.19 |
| 69f524ad7f863329e57e6cf9f070f24dab746066 | candidate 0.7.34: same 9 absent actions; not certified |

Missing actions: adjust_void, change_decide, change_decide_bulk, change_list, claim_confirm, claim_init, claim_match25, officer_stats, payout_draft. Root UI expects FREE18 preview_snapshot and price_changes; neither is present in repository Ledger.gs. Root batch PAY expects new_rows/changed_rows missing from repository Ledger.gs. Actual deployed Apps Script has not been verified. Do not implement substitutes or downgrade until the real deployed source is recovered.

## Regression contract
- Form50 issue → NOTICES; Form42 results → NOTICES; Form18 free-notice prices → NOTICES.court_amount/court_at for eligible non-locked notices; Form30 payment evidence → LEDGER; Form25 separate claim workflow. Preserve existing identity, calculation and review rules, not just this summary.
- Test one file and mixed batch, repeated file, repeated rows, distinct notices sharing case numbers, changed values, year boundary, missing or ambiguous matches, locked/paid rounds, retry/partial failure, expired preview, privacy, permissions and actual database readback.
- Test dashboard, search, reports, users, adjustments, claim workflows, calculation and all 60/40 operations. Preserve original rounding and actual historical totals.
- Test suite in source/test references source/web/app.js, which is not the deployed root app.js. A successful old-suite run is not release proof.
- Prior Excel material and expected results: retrieve from authorized private storage / existing conversation files. Not copied here; actual regression fixtures and their checksums remain unverified. Keep them private.
- Preserve configuration values and identifiers. Store a private release record of deployed GAS version, endpoint/schema, fixture hashes, test output, matched frontend commit and rollback target.

## Gate
Run node tools/check-release.js before publication. It is a static preflight, not a substitute for syntax, integration, legacy equivalence or real-file tests. Current mismatch must fail. Do not waive failures or edit the guard merely to pass. Until live GAS and fixtures are recovered and tests run, no runtime release is authorized by this record.
