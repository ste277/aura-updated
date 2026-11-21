# packages/palm-reading-engine — synthetic palm reading engine + test-only detector adapter (G6-I1)

**SYNTHETIC ONLY. NOT A PRODUCTION PACKAGE.**
- No app or package imports it.
- It has no dependencies.
- It is excluded from every production build. CI scans the build output with `apps/web/scripts/check-palm-engine-bundle.js`.
- No real palm images, camera or UI.

## Layout
| Path | Contents | Status |
|---|---|---|
| `prototype/src/` | the interpretation engine (7 files) | **frozen**: byte-identical to the R1.3 frozen hashes (`vendor/…R1_3…/baseline/R1_3_FROZEN_HASHES.txt`) |
| `prototype/test/` | engine, harness and adapter tests; harness modules (`oracle.mjs`, `independent-oracle.mjs`, `coverage.mjs`, `campaign-core.mjs`, `campaign-verify.mjs`) | validated R1.5 + R2-F1 harness, plus G6-I1 adapter tests |
| `prototype/fixtures/` | synthetic fixtures; `g6-i1-adapter-inputs.json` (built by `baseline/build-g6-i1-adapter-inputs.mjs`) | |
| `adapter/feature-adapter.mjs` | `toFeatures(detection, frame, identity = null)`, test-only | G6-I1 |
| `baseline/` | campaign scripts, coverage contract, expected identity, test inventory | |
| `negative-controls/` | mutation suite | |
| `vendor/` | hash-pinned read-only copies of sealed evidence (see below) | |

`vendor/` holds the following, each verified against its sealed manifest:
- the R1.1 comparison-baseline engine;
- the G6-D0 design `rules.mjs`;
- the R1.3 frozen hash list;
- the R1.4 manifest;
- the frozen D1 detector output on the G4 synthetic fixtures.

## Fast checks (CI)
```
cd packages/palm-reading-engine/prototype && node --test test/*.test.mjs
```

## Manual (expensive) validation
Run these from `packages/palm-reading-engine`, with `R11=vendor/AURA_PALM_G6_D0_R1_1_INPUT_AND_GEOMETRY_HARDENING/prototype`.

1. Run the full test suite and check it against the inventory:
   ```
   (cd prototype && node --test test/*.test.mjs > ../logs/full.log 2>&1; echo $? > ../logs/full.exit)
   node baseline/check-test-run.mjs baseline/test-inventory.json logs/full.log $(cat logs/full.exit)
   ```
2. Run each campaign: `random-1119`, `random-2026`, `random-77`, `fixtures-boundary`, `fixtures-competing`, `fixtures-loop` and `fixtures-adapter`:
   ```
   node baseline/run-campaign.mjs $R11 prototype campaigns <id>
   ```
3. Check the coverage contract:
   ```
   node baseline/check-coverage-contract.mjs baseline/coverage-contract.json prototype $R11 campaigns
   ```
4. Run the mutation suite (about an hour; needs an empty scratch directory):
   ```
   node negative-controls/run-negative-controls.mjs <empty-scratch-dir>
   ```
5. Verify the protected sources:
   ```
   node baseline/verify-protected-and-changes.mjs vendor/AURA_PALM_G6_D0_R1_3_CONSERVATIVE_CLAIM_AND_DIFFERENTIAL_INTEGRITY vendor/AURA_PALM_G6_D0_R1_4_DIFFERENTIAL_HARNESS_AND_COVERAGE_HARDENING vendor/AURA_PALM_G6_D0_R1_1_INPUT_AND_GEOMETRY_HARDENING
   ```

## A new engine identity
`baseline/write-expected-identity.mjs` refuses any engine that differs from the R1.3 frozen hashes, and any baseline that differs from the R1.1 manifest. Changing the engine therefore requires three things:
1. an owner-authorised new reference hash list;
2. a new comparison baseline decision;
3. a full re-validation: campaigns, contract, mutation suite and an independent review.
