# Synthetic Review Lab

Internal QA/modeling app for creating clearly labeled synthetic review fixtures. Production is the Vercel project `synthetic-review-lab` at:

https://synthetic-review-lab.vercel.app/

Every export produced by this app must remain synthetic QA data only. Do not remove the synthetic/provenance labels unless the product requirements are explicitly changed:

- `synthetic_fixture=true`
- `publication_allowed=false`
- `fixture_type=synthetic_review_qa`
- `dataset_purpose=internal_qa_modeling`

## Current stable Studio behavior

The working UI is `/studio`. The app is now organized around four operator screens:

| Screen | Purpose | Main files |
| --- | --- | --- |
| Generate | Configure run settings, scan one product or a Shopify store, then queue generation. | `app/studio/page.js`, `app/globals.css` |
| Queue | Always-visible server queue with active jobs, progress, view, refresh, and cancel. | `app/studio/page.js`, `app/api/store-review-workflows/*` |
| Results | Completed batch archive with pagination, preview, JSON/CSV exports, and Areviews export. | `app/studio/page.js`, `lib/synthetic-review-export.mjs`, `lib/areviews-export.mjs` |
| Settings | Reference mode, Areviews date defaults, scan budget, and credit monitor. | `app/studio/page.js`, `app/areviews-export-controls.js`, `app/reference-budget-control.js`, `app/credit-balance-bar.js` |

The Generate screen order is intentional:

1. Hero
2. Synthetic QA warning
3. Run settings card
   - `Test Review Count`
   - `Test rating average`
   - Output mode notice
   - Areviews export date range
4. Source input card
   - Single product scan
   - Whole Shopify store scan
5. Product details form and queue button

Keep the run settings above Source input. Store mode uses `Test Review Count` as the default review count for every discovered SKU, so it needs to be visible before the user scans a store.

## Local development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Useful self-tests:

```bash
node scripts/areviews-export-selftest.mjs
node scripts/store-review-catalog-selftest.mjs
npm run build --silent
```

`npm run build` runs the `prebuild` script first:

```bash
node scripts/apply-natural-language-runtime-patch.mjs
node scripts/apply-store-mode-workers-only-patch.mjs
```

Those scripts are expected in this project. Do not remove them casually; they patch older paths and currently log that the durable Studio workflow is detected.

## Required production environment

`/studio` is intended to run with durable Supabase storage. Without Supabase, the UI deliberately blocks generation.

Required Vercel env vars:

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_KEY`
- AI/provider keys used by the generation/reference routes
- `CREDIT_COUNTER_ACCESS_KEY` for the private credit monitor

The storage mode is checked through:

- `lib/review-run-store.mjs`
- `GET /api/review-runs?storeOnly=1`
- `GET /api/store-review-workflows`

To verify what is live in production:

```bash
curl -sS https://synthetic-review-lab.vercel.app/api/version
curl -I https://synthetic-review-lab.vercel.app/studio
```

`/api/version` reports the deployed Git commit from Vercel.

## Architecture map

### Studio UI

Most product-facing behavior lives in `app/studio/page.js`.

Important state and functions:

| Area | What to modify |
| --- | --- |
| Default form values | `start` object near the top of `app/studio/page.js` |
| Test review count label/value | Run settings card in `app/studio/page.js`; state key is `f.reviewCount` |
| Target average | `f.targetAverage` |
| Worker dropdown | Store summary actions in `app/studio/page.js`; values are currently 12, 10, 8, 6, 4, 2 |
| Worker cap | `storeWorkerCount()` in `app/studio/page.js` and `maxConcurrency` in `app/api/store-review-workflows/route.js` |
| Scan notices/errors | `scanNotice`, `scanError`, `.scannerNotice` CSS |
| Source tabs | `mode === "product"` vs `mode === "store"` |
| Queue rail | `GenerationQueue` component in `app/studio/page.js` |
| Results archive | `screen === "results"` block in `app/studio/page.js` |
| Areviews date UI | `app/areviews-export-controls.js` |
| Styling | `app/globals.css` |

### Scanning flow

Single product scan:

1. User enters a product URL.
2. `scanOne()` calls `POST /api/scan`.
3. `/api/scan` returns product URL, title, description/context, and extracted diagnostics.
4. The Product details form is populated.

Whole store scan:

1. User enters a Shopify store domain or URL.
2. `scanStore()` calls `POST /api/store-scan`.
3. `/api/store-scan` reads the Shopify sitemap and returns product URLs.
4. The UI immediately renders queued products and starts per-product detail scans through `/api/scan`.
5. Store scan status is shown inline next to the button:
   - reading sitemap
   - products found
   - product-detail scan progress
   - complete/failed counts

Do not move scan errors back into the lower form. Errors need to appear beside the control the user clicked, or the button feels dead.

### Durable generation flow

Generation is server-side and durable. Closing the browser tab should not kill a queued/running generation.

Main files:

- `app/api/store-review-workflows/route.js`
- `workflows/store-review-catalog.js`
- `lib/review-run-store.mjs`
- `lib/store-review-catalog.mjs`
- `lib/review-run-engine.mjs`

Flow:

1. Studio calls `POST /api/store-review-workflows`.
2. The route validates products, creates/reuses child review runs, creates a parent catalog run, and starts `storeReviewCatalogWorkflow`.
3. `workflows/store-review-catalog.js` advances child runs in groups based on the selected concurrency.
4. Run state is stored in Supabase `review_runs`.
5. Studio polls `GET /api/store-review-workflows?limit=30` every 2.5 seconds.
6. Queue and Results render from the same catalog status payload.

Current durable limits:

- Per-product requested review count: 5–250.
- Catalog products: up to 100 SKUs.
- Store worker concurrency: up to 12.
- Default selected workers: 12.

If changing worker options, update all of these together:

1. Worker dropdown options in `app/studio/page.js`.
2. `storeWorkerCount()` in `app/studio/page.js`.
3. `maxConcurrency` in `app/api/store-review-workflows/route.js`.
4. Any copy that says `12 workers`.
5. Re-run `node scripts/store-review-catalog-selftest.mjs` and `npm run build --silent`.

### Cancel flow

The Queue has a whole-generation cancel button.

- UI: `cancelCatalogGeneration()` in `app/studio/page.js`
- API: `DELETE /api/store-review-workflows/[id]`
- Storage: `cancelRuns()` in `lib/review-run-store.mjs`

Cancel marks queued/running parent and child runs as canceled. Completed work remains stored/exportable when available.

### Results and exports

Clean synthetic CSV:

- `lib/synthetic-review-export.mjs`
- Single-product export: `syntheticReviewCsv()`
- Bulk export: `syntheticReviewBulkCsv()`

Areviews CSV:

- `app/areviews-export-controls.js`
- `lib/areviews-export.mjs`
- Name pool: `lib/areviews-names.mjs`

Areviews rules:

- Export is an additional export, not a replacement for the clean synthetic CSV.
- Headers are:
  - `status`
  - `rating`
  - `email`
  - `img`
  - `username`
  - `review`
  - `date`
  - `product title`
  - `handle`
  - `country`
- `email`, `img`, and `country` are intentionally blank.
- `username` is generated from first/last name combinations in `lib/areviews-names.mjs`.
- `review` combines generated title and body into one field.
- Review text is normalized to regular spacing with no line breaks.
- The review title should read as the first sentence inside the combined review text.
- Date range defaults to today.
- Dates are randomized inside the selected range.
- Dates may skip days and multiple reviews may share the same day.
- Bulk Areviews rows are shuffled so mixed SKUs do not appear in strict SKU/date order.

If changing Areviews columns, change `AREVIEWS_HEADERS` and `areviewsRows()` in `lib/areviews-export.mjs`, then update `scripts/areviews-export-selftest.mjs`.

## Common modification recipes

### Rename a visible UI label

1. Search the exact text with `rg`.
2. Change it in `app/studio/page.js`.
3. Run:

```bash
git diff --check
npm run build --silent
```

### Move a UI section

Most Studio sections are JSX blocks inside `screen === "generate"` in `app/studio/page.js`.

Current important blocks:

- Run settings card: `<section className="studioCard runSettingsCard">`
- Source input card: `<section className="panel studioCard">` with `SOURCE / Product input`
- Product details form: `<form ref={form} onSubmit={generate} className="generationForm">`

After moving JSX, verify the static order:

```bash
npm run build --silent
node - <<'NODE'
const fs=require('fs');
const html=fs.readFileSync('.next/server/app/studio.html','utf8');
console.log({
  settingsBeforeSource:
    html.indexOf('Test Review Count') > -1 &&
    html.indexOf('SOURCE') > -1 &&
    html.indexOf('Test Review Count') < html.indexOf('SOURCE')
});
NODE
```

### Change store-scan behavior

- Store sitemap discovery lives in `app/api/store-scan/route.js`.
- Product detail extraction lives behind `POST /api/scan`.
- UI orchestration lives in `scanStore()` in `app/studio/page.js`.

Do not make the store scan wait silently. Keep `scanNotice` updates before, during, and after long operations.

### Change generated review quality

Generation quality is mostly outside the UI:

- `lib/review-run-engine.mjs`
- `lib/review-blueprint.mjs`
- `lib/review-quality-finalize.mjs`
- `lib/reference-pipeline.mjs`
- `lib/source-card-counts.mjs`
- `app/api/generation-plan/route.js`

Run the relevant tests:

```bash
npm run test:generation-quality
npm run test:reference-pipeline
npm run build --silent
```

### Change source/reference mode

Current modes:

- Reference mode on: Lens/Amazon simple rewrite.
- Reference mode off: PDP-only generator.

UI toggle:

- `externalReferencesEnabled` in `app/studio/page.js`
- Settings screen toggle
- Local storage key: `srl-reference-sourcing-enabled`

Reference budget:

- `app/reference-budget-control.js`
- Local storage key: `srl-reference-budget`

Reference scanning and enrichment endpoints include:

- `app/api/reference-scan/*`
- `app/api/reference-enrich-marketplaces/route.js`
- `app/reference-bridge.js`
- `lib/reference-pipeline.mjs`

## Deployment workflow

Normal deployment is through the connected GitHub repository:

`Apex-performance-Team/SampleReviewsGenerator`, branch `main`.

Vercel deploys automatically from `main`.

When shell `git push` credentials are unavailable, use the connected GitHub app tools to:

1. Fetch current `refs/heads/main`.
2. Create blobs for changed files.
3. Create a tree from the current base tree.
4. Create a commit with the current `main` commit as parent.
5. Re-fetch `main` and confirm it did not move.
6. Update `main` with `force:false`.
7. Check combined commit status for `Vercel`.
8. Verify production:

```bash
curl -sS https://synthetic-review-lab.vercel.app/api/version
curl -I https://synthetic-review-lab.vercel.app/studio
```

For code/UI changes, use at least:

```bash
git diff --check
node scripts/areviews-export-selftest.mjs
node scripts/store-review-catalog-selftest.mjs
npm run build --silent
```

For small copy-only changes, `git diff --check` and `npm run build --silent` are usually enough, but running the two self-tests is cheap and safer.

## Gotchas for future agents

- This app uses Next.js 16. Read the local Next docs under `node_modules/next/dist/docs/` before making Next-specific code changes.
- `next dev` may generate local `AGENTS.md` / `CLAUDE.md` files. Do not include incidental generated files in commits unless there is an explicit reason.
- There is a current Next warning that `middleware` is deprecated in favor of `proxy`. It is a warning, not the blocker that broke the UI.
- The local dev server may not be reachable from separate shell calls in some sandbox sessions. Prefer build checks and production curl verification when that happens.
- Do not put long-running generation work in browser-only code. Generation must continue server-side through the durable workflow.
- Keep queue visibility and cancel controls available. The user may run many batches; the UI must make background work obvious.
- Keep scan and generation errors close to the button/action that caused them.
- Do not commit secrets, keys, generated review exports, or large uploaded scratch files.
- The app is public-facing, but the outputs are internal synthetic QA fixtures. Keep the synthetic disclaimers visible.

## Current “known good” behavior checklist

Before calling the app good after a UI change:

- `/studio` loads.
- Run settings appear above Source input.
- Label says `Test Review Count`.
- Whole-store scan button shows immediate status and discovers products.
- Product detail scans show progress and per-row statuses.
- The worker dropdown defaults to 12 and matches backend concurrency.
- Queue rail stays visible.
- Completed batches can be opened in Results.
- Clean CSV export still works.
- Areviews CSV export still works with randomized dates.
- Cancel whole generation remains available for queued/running jobs.
- `/api/version` reports the commit that was just deployed.
