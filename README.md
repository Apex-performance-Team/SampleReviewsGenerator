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

## Deployment

Connect this repository to the existing Vercel project `synthetic-review-lab`. Future changes should be committed here and deployed from the connected Git repository rather than uploading the complete source tree from ChatGPT.

## Private credit monitor

Set `CREDIT_COUNTER_ACCESS_KEY` as a sensitive Vercel environment variable with a value of at least 16 characters. The live credit monitor stays locked until an administrator supplies that key. Successful unlocks create an HttpOnly, same-site session cookie that expires after eight hours; provider credentials and unrestricted balance endpoints are never exposed to the browser.
