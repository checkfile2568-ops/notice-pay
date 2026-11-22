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


## Coordinated 0.7.39 release — 22 November 2026

The historical table above remains an audit record. It is not the source for this release. The authoritative private candidate is b6f9760f56f40fceae46212cd155739c574d6ff5. Its exact frontend assets and all 18 backend modules are bound by release-manifest.json. Legacy source/web and source/gas are retained as historical snapshots and must never be deployed.

Run `node tools/check-release.js --source-root=/absolute/path/to/notice-pay-source` with the exact private candidate present. The gate fails without that source; it verifies every published asset, all backend module hashes, coordinated versions, unchanged endpoint, API routes and Ledger contracts, plus the private mirror guard and immutable Calc/Core/Payout guard (only five exact reviewed V2 adapters permitted). This fixes the old guard's comparison with obsolete 0.7.19 snapshots; no missing route or formula failure is waived. No private backend source, test credentials, court records or database identifiers are published.

Retained validation: 50 synthetic regression suites and responsive CI, 17-module backup restoration, copied-data read-only Apps Script verification, 13 synthetic Apps Script transaction checks and 16 deployed synthetic HTTP checks. Browser rendering/account search used the deployed HTTP endpoint; the keypad login and full confirmation workflow were not clicked end-to-end in the browser. Authentication and confirmation were tested programmatically against the actual deployed synthetic HTTP endpoint.

Financial discrepancies remain review items and are not extra payable money. This software release never confirms or pays a real round. Production code and data verification are recorded privately; a static Pages build alone is not accounting acceptance.
