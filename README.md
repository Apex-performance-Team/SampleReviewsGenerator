# Synthetic Review Lab

Internal QA/modeling tool for generating clearly labeled synthetic review fixtures.

## Purpose

This repository is the persistent source of truth for Synthetic Review Lab. Generated fixtures are synthetic QA data only and are not genuine customer feedback.

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

## Generation quality and call budget

Each run creates a product-specific corpus blueprint before drafting fixtures. A 100-fixture run uses 25 themes with four distinct scenarios each, unique persona profiles, a natural whole-star distribution, deterministic duplicate gates, and a compact semantic corpus assessment. Only flagged fixtures are regenerated.

The app displays the generation-model call budget before a run. For 100 fixtures, the normal path is 12 calls (one planner, ten drafting batches, and one corpus assessment). A run-level cap allows at most two failed-batch retries, two targeted-repair calls, and one follow-up assessment, for a maximum of 17. PDP scanning and external-reference discovery have separate budgets.

CSV exports include the product and run identifiers, plan/scenario and persona metadata, reference provenance, rating distribution, QA status, repair metadata, and generation-call accounting. Every row remains marked `synthetic_fixture=true` and `publication_allowed=false`.

## Deployment

Connect this repository to the existing Vercel project `synthetic-review-lab`. Future changes should be committed here and deployed from the connected Git repository rather than uploading the complete source tree from ChatGPT.

## Private credit monitor

Set `CREDIT_COUNTER_ACCESS_KEY` as a sensitive Vercel environment variable with a value of at least 16 characters. The live credit monitor stays locked until an administrator supplies that key. Successful unlocks create an HttpOnly, same-site session cookie that expires after eight hours; provider credentials and unrestricted balance endpoints are never exposed to the browser.
