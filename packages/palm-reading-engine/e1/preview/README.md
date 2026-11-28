# E1 reading preview harness (PALM-04-I4, plan G-6 and decision D1)

**Development only. Synthetic only.** This harness replays a **confirmed synthetic scanner journey** through the one E1 reading interface (`../src/reading.ts`, `generateSyntheticReading(input, { synthetic: true, mode })`). It prints the reading as JSON, or as a self-contained HTML page with no scripts, no external resources and every value escaped.

- **Isolation:** it lives in the E1 package, outside `apps/web`. No app module imports it, it is in no build, and it never sends or stores anything.
- **D1:** the app never imports E1. The scanner and the harness meet only through fixture files.

```bash
npx ts-node packages/palm-reading-engine/e1/preview/render.ts packages/palm-reading-engine/e1/preview/fixtures/uncertain-photo.json --format html --out /tmp/preview.html
```

## Fixtures

`fixtures/*.json` contain `{ kind: 'palm-04-e1-preview-fixture@0.1.0', synthetic: true, source: 'synthetic-scanner-journey', scenario, description, input }`.
- They are written by `test/palm04I4FeatureToReading.test.ts --write`. That test drives the real P4-I1 tracing model through each journey (trace and confirm, skip, cannot-see, hand answers) and records `toFeatureSetInput`.
- Without `--write`, it checks that the committed files are exactly reproducible and replays them through this harness as a separate process.
- The harness refuses (exit 2) anything that is not a synthetic scanner-journey fixture.

| Scenario | What it exercises |
|---|---|
| `all-lines-confirmed` | Heart, head and life confirmed; upward not requested |
| `skipped-and-cannot-see` | User-skipped and user-cannot-see lines |
| `uncertain-photo` | A dark photo: uncertain measurements, never presented as observed |
| `unavailable-measurements` | Hand cut off: no measurement available |

The reading remains `UNREVIEWED_RESEARCH_CONTENT`, with `publicationApproved: false`.
