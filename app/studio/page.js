"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  syntheticReviewBulkCsv,
  syntheticReviewCsv,
  syntheticReviewFilename,
} from "../../lib/synthetic-review-export.mjs";
import {
  areviewsReviewBulkCsv,
  areviewsReviewCsv,
  areviewsReviewFilename,
} from "../../lib/areviews-export.mjs";
import AreviewsExportControls from "../areviews-export-controls";

const start = {
  productUrl: "",
  amazonListingUrl: "",
  productTitle: "",
  productDescription: "",
  reviewCount: 100,
  targetAverage: 4.7,
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const formatAverage = (value) =>
  value != null && Number.isFinite(Number(value))
    ? Number(value).toFixed(2)
    : "—";
const completedQaStatuses = new Set(["completed", "completed_with_purge"]);

function cleanReviewCount(value, fallback = 100) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(5, Math.min(250, n)) : fallback;
}
function reviewCountValue(product, fallback = 100) {
  return product?.reviewCount ?? cleanReviewCount(fallback, 100);
}
function validReviewCount(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 5 && n <= 250;
}
function storeWorkerCount(concurrency, referenceMode, count) {
  const max = referenceMode ? 4 : 12;
  return Math.min(
    Math.max(1, Number(count) || 1),
    max,
    Math.max(1, Number(concurrency) || 1),
  );
}
const activeGenerationStatuses = new Set(["queued", "running"]);
function generationTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(value));
}
function GenerationQueue({
  runs,
  loading,
  error,
  cancelingId,
  onCancel,
  onView,
  onRefresh,
}) {
  const activeCount = runs.filter((run) =>
    activeGenerationStatuses.has(run.catalog?.status),
  ).length;
  return (
    <section className="generationQueue">
      <div className="queueHead">
        <div>
          <span>SERVER-SIDE GENERATIONS</span>
          <h2>Generation queue</h2>
          <p>
            {activeCount
              ? `${activeCount} generation${activeCount === 1 ? "" : "s"} currently in process. You can close this tab safely.`
              : "No generations are currently running. Recent generations remain available below."}
          </p>
        </div>
        <button className="ghost" onClick={onRefresh} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {error && <div className="queueError">{error}</div>}
      {!runs.length && !loading ? (
        <div className="emptyQueue">No server generations yet.</div>
      ) : (
        <div className="generationJobs">
          {runs.map((run) => {
            const catalog = run.catalog || {},
              progress = run.progress || {},
              active = activeGenerationStatuses.has(catalog.status),
              current =
                run.children?.find((child) => child.status === "running") ||
                run.children?.find((child) => child.status === "queued") ||
                null,
              label = catalog.bulk
                ? `${progress.totalSkus || 0} SKU catalog`
                : catalog.productTitle ||
                  run.children?.[0]?.productTitle ||
                  "Single product generation";
            return (
              <article
                className={`generationJob ${catalog.status || "queued"}`}
                key={catalog.id}
              >
                <div className="jobTop">
                  <div>
                    <span className="jobStatus">{catalog.status}</span>
                    <h3>{label}</h3>
                  </div>
                  <strong>{progress.percent || 0}%</strong>
                </div>
                <p>
                  {catalog.progressMessage ||
                    `${progress.completeSkus || 0}/${progress.totalSkus || 0} SKUs complete`}
                </p>
                <div className="bar">
                  <span
                    style={{
                      width: `${active ? Math.max(2, progress.percent || 0) : progress.percent || 0}%`,
                    }}
                  />
                </div>
                <footer>
                  <span>
                    {(progress.done || 0).toLocaleString()}/
                    {(progress.total || 0).toLocaleString()} reviews ·{" "}
                    {progress.completeSkus || 0}/{progress.totalSkus || 0} SKUs
                    {current ? ` · ${current.productTitle || current.id}` : ""}
                  </span>
                  <span>{generationTime(catalog.createdAt)} ET</span>
                </footer>
                <div className="jobActions">
                  {catalog.status === "completed" && (
                    <button className="ghost" onClick={() => onView(run)}>
                      View generated reviews
                    </button>
                  )}
                  {active && (
                    <button
                      className="danger"
                      onClick={() => onCancel(run)}
                      disabled={cancelingId === catalog.id}
                    >
                      {cancelingId === catalog.id
                        ? "Canceling…"
                        : "Cancel whole generation"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function StudioPage() {
  const [f, setF] = useState(start),
    [health, setHealth] = useState({ loading: true }),
    [store, setStore] = useState("checking"),
    [mode, setMode] = useState("product"),
    [storeUrl, setStoreUrl] = useState(""),
    [products, setProducts] = useState([]),
    [meta, setMeta] = useState(null),
    [filter, setFilter] = useState(""),
    [busy, setBusy] = useState(false),
    [genBusy, setGenBusy] = useState(false),
    [progress, setProgress] = useState({ done: 0, total: 0, status: "" }),
    [concurrency, setConcurrency] = useState(12),
    [err, setErr] = useState(""),
    [result, setResult] = useState(null),
    [bulkResult, setBulkResult] = useState(null),
    [externalReferencesEnabled, setExternalReferencesEnabledState] =
      useState(true),
    [catalogRuns, setCatalogRuns] = useState([]),
    [queueLoading, setQueueLoading] = useState(true),
    [queueError, setQueueError] = useState(""),
    [cancelingId, setCancelingId] = useState("");
  const form = useRef(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setExternalReferencesEnabled = (v) => {
    setExternalReferencesEnabledState(v);
    try {
      window.localStorage.setItem(
        "srl-reference-sourcing-enabled",
        v ? "on" : "off",
      );
      window.dispatchEvent(
        new CustomEvent("srl-reference-sourcing-enabled", { detail: v }),
      );
    } catch {}
  };
  const storageReady = store === "supabase";

  async function healthCheck() {
    setHealth({ loading: true });
    try {
      const r = await fetch("/api/ai-health", { cache: "no-store" }),
        j = await r.json();
      setHealth({ ...j, loading: false });
    } catch (e) {
      setHealth({ ok: false, error: e.message, loading: false });
    }
  }
  const refreshStore = useCallback(async () => {
    try {
        const r = await fetch("/api/review-runs?storeOnly=1", { cache: "no-store" }),
        j = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(j.error || "Run storage check failed.");
      setStore(j.store || "unknown");
      return j.store;
    } catch (e) {
      setStore("unavailable");
      throw e;
    }
  }, []);
  const refreshCatalogRuns = useCallback(async () => {
    try {
      const response = await fetch("/api/store-review-workflows?limit=20", {
          cache: "no-store",
        }),
        data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw Error(data.error || "Could not refresh server generations.");
      setCatalogRuns(Array.isArray(data.runs) ? data.runs : []);
      setQueueError("");
      return data.runs || [];
    } catch (error) {
      setQueueError(error.message || "Could not refresh server generations.");
      throw error;
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    healthCheck();
    refreshStore().catch((e) => setErr(e.message));
  }, [refreshStore]);
  useEffect(() => {
    refreshCatalogRuns().catch(() => {});
    const timer = window.setInterval(
      () => refreshCatalogRuns().catch(() => {}),
      2500,
    );
    return () => window.clearInterval(timer);
  }, [refreshCatalogRuns]);
  useEffect(() => {
    const saved = window.localStorage.getItem("srl-reference-sourcing-enabled");
    if (saved === "off") setExternalReferencesEnabledState(false);
    const onMode = (e) => setExternalReferencesEnabledState(Boolean(e.detail));
    window.addEventListener("srl-reference-sourcing-enabled", onMode);
    return () =>
      window.removeEventListener("srl-reference-sourcing-enabled", onMode);
  }, []);

  async function scanOne(url = f.productUrl) {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url,
            amazonListingUrl: f.amazonListingUrl,
            deferReferenceScan: true,
          }),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error || "Scan failed");
      setF((x) => ({
        ...x,
        productUrl: j.productUrl,
        amazonListingUrl: j.amazonListingUrl || x.amazonListingUrl,
        productTitle: j.productTitle,
        productDescription: j.productDescription,
      }));
      return j;
    } catch (e) {
      setErr(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function scanStore() {
    setBusy(true);
    setErr("");
    setProducts([]);
    setMeta(null);
    try {
      const r = await fetch("/api/store-scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ storeUrl }),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error || "Store discovery failed");
      const defaultReviewCount = cleanReviewCount(f.reviewCount, 100),
        rows = j.products.map((p) => ({
          ...p,
          enabled: true,
          status: "queued",
          reviewCount: defaultReviewCount,
        }));
      setProducts(rows);
      setMeta({ ...j, scanned: 0, failed: 0 });
      let cursor = 0,
        scanned = 0,
        failed = 0;
      async function worker() {
        while (true) {
          const i = cursor++;
          if (i >= rows.length) return;
          rows[i] = { ...rows[i], status: "scanning" };
          setProducts([...rows]);
          try {
            const q = await fetch("/api/scan", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  url: rows[i].url,
                  deferReferenceScan: true,
                }),
              }),
              d = await q.json();
            if (!q.ok) throw Error(d.error || "Scan failed");
            rows[i] = {
              ...rows[i],
              status: "done",
              url: d.productUrl,
              productTitle: d.productTitle,
              productDescription: d.productDescription,
              extracted: d.extracted,
            };
            scanned++;
          } catch (e) {
            rows[i] = { ...rows[i], status: "error", error: e.message };
            failed++;
          }
          setProducts([...rows]);
          setMeta((m) => ({ ...m, scanned, failed }));
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(4, rows.length) }, worker),
      );
      setMeta((m) => ({ ...m, complete: true }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  function toggle(i) {
    setProducts((a) =>
      a.map((x) => (x.index === i ? { ...x, enabled: !x.enabled } : x)),
    );
  }
  function all(v) {
    setProducts((a) => a.map((x) => ({ ...x, enabled: v })));
  }
  function useProduct(p) {
    if (p.status !== "done") return;
    setF((x) => ({
      ...x,
      productUrl: p.url,
      productTitle: p.productTitle,
      productDescription: p.productDescription,
      reviewCount: reviewCountValue(p, x.reviewCount),
    }));
    form.current?.scrollIntoView({ behavior: "smooth" });
  }
  function setProductReviewCount(index, value) {
    setProducts((a) =>
      a.map((x) => (x.index === index ? { ...x, reviewCount: value } : x)),
    );
  }

  async function ensureSupabase() {
    const live = await refreshStore();
    if (live !== "supabase")
      throw Error(
        "Supabase storage is not active on Vercel. /studio is intentionally disabled until SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.",
      );
  }
  async function startDurableCatalog(payload, { bulk, total }) {
    const catalogId = globalThis.crypto.randomUUID(),
      body = { ...payload, catalogId, bulk };
    window.localStorage.setItem("srl-studio-last-run-id", catalogId);
    let started = false,
      lastError,
      accepted;
    for (let attempt = 0; attempt < 5 && !started; attempt++) {
      try {
        const response = await fetch("/api/store-review-workflows", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
          data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status < 500 && response.status !== 429)
            throw Object.assign(
              Error(data.error || "Could not start durable workflow."),
              { fatal: true },
            );
          throw Error(data.error || "Could not start durable workflow.");
        }
        started = true;
        accepted = data;
      } catch (error) {
        lastError = error;
        if (error.fatal) break;
        setProgress({
          done: 0,
          total,
          status: `Start connection interrupted · retrying the same durable request (${attempt + 1}/5)…`,
        });
        if (attempt < 4) await sleep(1000 * (attempt + 1));
      }
    }
    if (!started) {
      if (lastError?.fatal) {
        throw lastError;
      }
      const probe = await fetch(`/api/store-review-workflows/${catalogId}`, {
          cache: "no-store",
        }),
        status = await probe.json().catch(() => ({}));
      if (!probe.ok)
        throw lastError || Error("Could not confirm the durable workflow start.");
      accepted = { catalogId, status };
    }
    if (accepted?.status)
      setCatalogRuns((current) => [
        accepted.status,
        ...current.filter((run) => run.catalog?.id !== catalogId),
      ]);
    setProgress({
      done: 0,
      total,
      status:
        "Generation accepted by the server. It is now visible in the queue.",
    });
    await refreshCatalogRuns().catch(() => {});
    return accepted;
  }
  async function cancelCatalogGeneration(run) {
    const catalog = run.catalog || {},
      label = catalog.bulk
        ? `${run.progress?.totalSkus || 0} SKU catalog`
        : catalog.productTitle || "this generation";
    if (
      !window.confirm(
        `Cancel the whole ${label}? Finished work will remain stored, but no additional reviews will be generated.`,
      )
    )
      return;
    setCancelingId(catalog.id);
    setQueueError("");
    try {
      const response = await fetch(
          `/api/store-review-workflows/${catalog.id}`,
          { method: "DELETE" },
        ),
        data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw Error(data.error || "Could not cancel the generation.");
      await refreshCatalogRuns();
      if (data.warning) setQueueError(data.warning);
    } catch (error) {
      setQueueError(error.message || "Could not cancel the generation.");
    } finally {
      setCancelingId("");
    }
  }
  async function viewCatalogResult(run) {
    const catalog = run.catalog || {};
    setQueueError("");
    try {
      const response = await fetch(
          `/api/store-review-workflows/${catalog.id}/result`,
          { cache: "no-store" },
        ),
        data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw Error(data.error || "Could not load generated reviews.");
      if (catalog.bulk) {
        setResult(null);
        setBulkResult(data.result);
      } else {
        setBulkResult(null);
        setResult(data.result?.products?.[0] || null);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setQueueError(error.message || "Could not load generated reviews.");
    }
  }
  async function generate(e) {
    e.preventDefault();
    setGenBusy(true);
    setErr("");
    setResult(null);
    setBulkResult(null);
    const input = {
        ...f,
        reviewCount: +f.reviewCount,
        targetAverage: +f.targetAverage,
        externalReferencesEnabled,
      },
      total = input.reviewCount;
    try {
      await ensureSupabase();
      setProgress({
        done: 0,
        total,
        status: "Starting durable server workflow…",
      });
      await startDurableCatalog(
        {
          products: [input],
          targetAverage: input.targetAverage,
          externalReferencesEnabled,
          referenceBudget:
            window.localStorage.getItem("srl-reference-budget") || "balanced",
          concurrency: 1,
        },
        { bulk: false, total },
      );
    } catch (e) {
      setErr(e.message || "Generation failed.");
    } finally {
      setGenBusy(false);
    }
  }
  async function generateStore() {
    const selected = products.filter((x) => x.enabled && x.status === "done");
    if (!selected.length) {
      setErr("Select at least one successfully scanned product.");
      return;
    }
    const target = +f.targetAverage,
      defaultCount = cleanReviewCount(f.reviewCount, 100);
    const selectedWithCounts = selected.map((p) => ({
      ...p,
      requestedReviewCount: Number(p.reviewCount ?? defaultCount),
    }));
    const invalid = selectedWithCounts.find(
      (p) => !validReviewCount(p.requestedReviewCount),
    );
    if (invalid) {
      setErr(
        `Review count for ${invalid.productTitle || invalid.title || "one product"} must be 5–250.`,
      );
      return;
    }
    setGenBusy(true);
    setErr("");
    setResult(null);
    setBulkResult(null);
    const total = selectedWithCounts.reduce(
      (n, p) => n + p.requestedReviewCount,
      0,
    );
    try {
      await ensureSupabase();
      const workerCount = storeWorkerCount(
        concurrency,
        externalReferencesEnabled,
        selectedWithCounts.length,
      );
      setProgress({
        done: 0,
        total,
        status: `Starting ${workerCount} concurrent product${workerCount === 1 ? "" : "s"} across ${selectedWithCounts.length} SKU${selectedWithCounts.length === 1 ? "" : "s"} / ${total.toLocaleString()} reviews…`,
      });
      await startDurableCatalog(
        {
          products: selectedWithCounts.map((p) => ({
            productUrl: p.url,
            productTitle: p.productTitle,
            productDescription: p.productDescription,
            reviewCount: p.requestedReviewCount,
            existingReviewCount: p.extracted?.existingReviewCount ?? null,
          })),
          targetAverage: target,
          externalReferencesEnabled,
          referenceBudget:
            window.localStorage.getItem("srl-reference-budget") || "balanced",
          concurrency: workerCount,
        },
        { bulk: true, total },
      );
    } catch (e) {
      setErr(e.message || "Bulk generation failed.");
    } finally {
      setGenBusy(false);
    }
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q
      ? products.filter((x) =>
          `${x.productTitle || x.title} ${x.handle} ${x.url}`
            .toLowerCase()
            .includes(q),
        )
      : products;
  }, [products, filter]);
  const selectedStoreProducts = products.filter(
      (x) => x.enabled && x.status === "done",
    ),
    storeRequestedTotal = selectedStoreProducts.reduce((n, p) => {
      const count = Number(
        p.reviewCount ?? cleanReviewCount(f.reviewCount, 100),
      );
      return n + (validReviewCount(count) ? count : 0);
    }, 0);
  const enabled = products.filter((x) => x.enabled).length,
    allOn = products.length > 0 && enabled === products.length;
  function downloadData(data, filename, mime = "application/json") {
    const href = URL.createObjectURL(new Blob([data], { type: mime })),
      a = document.createElement("a");
    a.href = href;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(href);
    }, 5000);
  }
  function exportJson() {
    const data = products
      .filter((x) => x.enabled && x.status === "done")
      .map((x) => ({
        url: x.url,
        handle: x.handle,
        title: x.productTitle,
        existingReviewCount: x.extracted?.existingReviewCount ?? null,
        productDescription: x.productDescription,
      }));
    downloadData(
      JSON.stringify(
        {
          store: meta?.storeUrl || storeUrl,
          products: data,
          synthetic: true,
          datasetPurpose: "internal_qa_context_scan",
          publicationAllowed: false,
        },
        null,
        2,
      ),
      "shopify-store-product-scan.json",
    );
  }
  function dl(type) {
    if (!result) return;
    const csvName = syntheticReviewFilename(result),
      data =
        type === "json"
          ? JSON.stringify(result, null, 2)
          : syntheticReviewCsv(result),
      filename = type === "json" ? csvName.replace(/\.csv$/, ".json") : csvName;
    downloadData(
      data,
      filename,
      type === "json" ? "application/json" : "text/csv;charset=utf-8",
    );
  }
  function dlBulk(type) {
    if (!bulkResult) return;
    const csvName = syntheticReviewFilename(
        { productTitle: "shopify-catalog" },
        { bulk: true },
      ),
      data =
        type === "json"
          ? JSON.stringify(bulkResult, null, 2)
          : syntheticReviewBulkCsv(bulkResult),
      filename = type === "json" ? csvName.replace(/\.csv$/, ".json") : csvName;
    downloadData(
      data,
      filename,
      type === "json" ? "application/json" : "text/csv;charset=utf-8",
    );
  }
  function dlAreviews(dateRange) {
    if (!result) return;
    downloadData(
      areviewsReviewCsv(result, dateRange),
      areviewsReviewFilename(result),
      "text/csv;charset=utf-8",
    );
  }
  function dlBulkAreviews(dateRange) {
    if (!bulkResult) return;
    downloadData(
      areviewsReviewBulkCsv(bulkResult, dateRange),
      areviewsReviewFilename(
        { productTitle: "shopify-catalog" },
        { bulk: true },
      ),
      "text/csv;charset=utf-8",
    );
  }
  const generationQueue = (
      <GenerationQueue
        runs={catalogRuns}
        loading={queueLoading}
        error={queueError}
        cancelingId={cancelingId}
        onCancel={cancelCatalogGeneration}
        onView={viewCatalogResult}
        onRefresh={() => {
          setQueueLoading(true);
          refreshCatalogRuns().catch(() => {});
        }}
      />
    ),
    resultQaStatus = result?.corpusDiagnostics?.qaStatus,
    resultQaComplete = completedQaStatuses.has(resultQaStatus),
    resultQaLabel =
      resultQaStatus === "completed_with_purge"
        ? "Passed · purged"
        : resultQaStatus === "completed"
          ? "Passed"
          : resultQaStatus === "warning"
            ? "Review"
            : "Deterministic",
    resultQaDetail =
      resultQaStatus === "completed_with_purge"
        ? `${result?.purgedReviewCount || 0} unresolved fixture${result?.purgedReviewCount === 1 ? " was" : "s were"} removed from the final output`
        : resultQaStatus === "completed"
          ? "AI semantic-diversity assessment completed"
          : resultQaStatus === "warning"
            ? `Semantic diversity score ${result?.corpusDiagnostics?.overallDiversityScore ?? "—"}/100 is below the advisory 80-point threshold`
            : "Deterministic checks completed; AI semantic assessment was unavailable",
    resultReferenceCoverage = result?.referenceCoverage || {},
    resultReferenceLed = Number(resultReferenceCoverage.referenceLedTotal) || 0,
    resultPdpOnly = Number(resultReferenceCoverage.pdpOnlyTotal) || 0,
    resultReferenceAvailable = Number(resultReferenceCoverage.available) || 0,
    bulkReferenceLed = (bulkResult?.products || []).reduce(
      (n, p) => n + (Number(p?.referenceCoverage?.referenceLedTotal) || 0),
      0,
    ),
    bulkPdpOnly = (bulkResult?.products || []).reduce(
      (n, p) => n + (Number(p?.referenceCoverage?.pdpOnlyTotal) || 0),
      0,
    ),
    bulkNeedsReview = Boolean(
      bulkResult?.products?.some(
        (product) =>
          !completedQaStatuses.has(product?.corpusDiagnostics?.qaStatus),
      ),
    );

  if (bulkResult)
    return (
      <main>
        <header>
          <b>SR</b>
          <span>Synthetic Review Lab</span>
        </header>
        <section className="wrap">
          <div className="resultHead">
            <div>
              <small>
                {bulkNeedsReview
                  ? "BULK QA DATASET NEEDS REVIEW"
                  : "BULK QA DATASET COMPLETE"}
              </small>
              <h1>{bulkResult.skuCount} SKUs generated in parallel</h1>
              <p>
                {bulkResult.totalReviews.toLocaleString()} final synthetic
                fixtures · {bulkResult.totalPurgedReviews.toLocaleString()}{" "}
                purged
              </p>
            </div>
            <div className="actions">
              <button className="ghost" onClick={() => setBulkResult(null)}>
                Back to catalog
              </button>
              <button className="ghost" onClick={() => dlBulk("json")}>
                JSON + purge audit
              </button>
              <button onClick={() => dlBulk("csv")}>Clean CSV</button>
              <AreviewsExportControls onExport={dlBulkAreviews} />
            </div>
          </div>
          {generationQueue}
          <div className="stats">
            <article>
              <span>SKUs</span>
              <strong>{bulkResult.skuCount}</strong>
            </article>
            <article>
              <span>Requested</span>
              <strong>
                {bulkResult.generatedReviewCount.toLocaleString()}
              </strong>
            </article>
            <article>
              <span>Final fixtures</span>
              <strong>{bulkResult.totalReviews.toLocaleString()}</strong>
            </article>
            <article>
              <span>Purged</span>
              <strong>{bulkResult.totalPurgedReviews.toLocaleString()}</strong>
            </article>
            <article>
              <span>Reference-led</span>
              <strong>{bulkReferenceLed.toLocaleString()}</strong>
            </article>
            <article>
              <span>PDP-only</span>
              <strong>{bulkPdpOnly.toLocaleString()}</strong>
            </article>
          </div>
          <div className="bulkGrid">
            {bulkResult.products.map((p) => (
              <article key={p.productUrl}>
                <div>
                  <b>{p.productTitle}</b>
                  <span>
                    {p.reviews.length} final · {p.purgedReviewCount || 0} purged
                  </span>
                </div>
                <small>{p.productUrl}</small>
                <footer>
                  {formatAverage(p.actualAverage)}★ actual · existing count{" "}
                  {p.existingReviewCount ?? "unavailable"} · refs{" "}
                  {Number(
                    p.referenceCoverage?.referenceLedTotal || 0,
                  ).toLocaleString()}
                  /{p.reviews.length.toLocaleString()} · QA{" "}
                  {p.corpusDiagnostics?.qaStatus || "unknown"}
                </footer>
              </article>
            ))}
          </div>
        </section>
      </main>
    );
  if (result)
    return (
      <main>
        <header>
          <b>SR</b>
          <span>Synthetic Review Lab</span>
        </header>
        <section className="wrap">
          <div className="resultHead">
            <div>
              <small>
                {resultQaComplete
                  ? "QA DATASET COMPLETE"
                  : "QA DATASET NEEDS REVIEW"}
              </small>
              <h1>{result.input?.productTitle}</h1>
              <p>
                {result.reviews.length} final synthetic fixtures ·{" "}
                {result.purgedReviewCount || 0} purged ·{" "}
                {formatAverage(result.actualAverage)}★ actual
              </p>
            </div>
            <div className="actions">
              <button className="ghost" onClick={() => setResult(null)}>
                New experiment
              </button>
              <button className="ghost" onClick={() => dl("json")}>
                JSON + purge audit
              </button>
              <button onClick={() => dl("csv")}>Clean CSV</button>
              <AreviewsExportControls onExport={dlAreviews} />
            </div>
          </div>
          {generationQueue}
          <div className="stats">
            <article>
              <span>Requested</span>
              <strong>{result.input?.reviewCount}</strong>
            </article>
            <article>
              <span>Final fixtures</span>
              <strong>{result.reviews.length}</strong>
            </article>
            <article>
              <span>Purged</span>
              <strong>{result.purgedReviewCount || 0}</strong>
            </article>
            <article>
              <span>Average</span>
              <strong>{formatAverage(result.actualAverage)}★</strong>
            </article>
            <article>
              <span>Reference-led</span>
              <strong>{resultReferenceLed.toLocaleString()}</strong>
              <small>
                {resultReferenceAvailable.toLocaleString()} imported usable
                references
              </small>
            </article>
            <article>
              <span>PDP-only</span>
              <strong>{resultPdpOnly.toLocaleString()}</strong>
              <small>product details only</small>
            </article>
            <article>
              <span>Model</span>
              <strong>AI</strong>
              <small>{result.model}</small>
            </article>
            <article>
              <span>Unique bodies</span>
              <strong>{result.diagnostics?.uniqueBodies ?? "—"}</strong>
            </article>
            <article>
              <span>Unique titles</span>
              <strong>{result.diagnostics?.uniqueTitles ?? "—"}</strong>
            </article>
            <article>
              <span>Persona profiles</span>
              <strong>
                {result.diagnostics?.uniquePersonaProfiles ?? "—"}
              </strong>
            </article>
            <article>
              <span>Corpus QA</span>
              <strong>{resultQaLabel}</strong>
              <small>{resultQaDetail}</small>
            </article>
            <article>
              <span>Generation calls</span>
              <strong>
                {result.generationCallBudget?.aiCallsAttempted ?? "—"}
              </strong>
              <small>
                hard cap {result.generationCallBudget?.capped ?? "—"} ·
                references separate
              </small>
            </article>
          </div>
          <div className="reviews">
            {result.reviews.map((x) => (
              <article key={x.id}>
                <div>
                  <span>
                    {"★".repeat(Number(x.rating) || 0)}
                    {"☆".repeat(5 - (Number(x.rating) || 0))}
                  </span>
                  <small>
                    {x.referenceLed
                      ? "SYNTHETIC · REFERENCE-LED"
                      : "SYNTHETIC · PDP-ONLY"}
                  </small>
                  <time>{x.date}</time>
                </div>
                <h3>{x.title}</h3>
                <p>{x.body}</p>
                <footer>
                  {x.personaId} · {x.persona}
                  {x.referenceLed
                    ? ` · ${x.referencePlatform || "external reference"}`
                    : ""}
                </footer>
              </article>
            ))}
          </div>
        </section>
      </main>
    );
  return (
    <main>
      <header>
        <b>SR</b>
        <span>Synthetic Review Lab</span>
        <i>QA / modeling</i>
      </header>
      <section className="wrap">
        <div className={`health ${health.ok && storageReady ? "good" : "bad"}`}>
          <div>
            <b>AI Gateway + Supabase</b>
            <span>
              {health.loading
                ? "Checking…"
                : health.ok && storageReady
                  ? `Connected · ${health.model} · durable server workflows active`
                  : !storageReady
                    ? `Supabase inactive · current store: ${store}`
                    : `Unavailable · ${health.error || "unknown error"}`}
            </span>
          </div>
          <button
            className="ghost"
            onClick={() => {
              healthCheck();
              refreshStore().catch((e) => setErr(e.message));
            }}
          >
            Recheck
          </button>
        </div>
        <div className="qaNotice">
          <b>Internal synthetic QA fixtures only.</b>
          <span>
            Not genuine customer feedback. Exports are permanently tagged
            synthetic and publication_allowed=false.
          </span>
        </div>
        {generationQueue}
        <div className="hero">
          <div>
            <small>SYNTHETIC QA / MODELING DATA ONLY</small>
            <h1>Build the synthetic review fixtures you want to test.</h1>
            <p>
              Scan one product or a whole Shopify catalog. AI keeps only
              consumer-relevant PDP context for synthetic UI, search,
              summarization, moderation, and rating tests.
            </p>
          </div>
          <aside>
            <span>Example target</span>
            <strong>4.70★</strong>
            <em>100 synthetic fixtures</em>
          </aside>
        </div>
        <section className="panel">
          <div className="scannerHead">
            <h2>Scan product content</h2>
            <div className="tabs">
              <button
                className={mode === "product" ? "active" : ""}
                onClick={() => setMode("product")}
              >
                Single product
              </button>
              <button
                className={mode === "store" ? "active" : ""}
                onClick={() => setMode("store")}
              >
                Whole Shopify store
              </button>
            </div>
          </div>
          <div className="scannerBody">
            {mode === "product" ? (
              <>
                <label>
                  Product URL
                  <div className="row">
                    <input
                      value={f.productUrl}
                      onChange={(e) => set("productUrl", e.target.value)}
                      placeholder="https://store.com/products/product"
                    />
                    <button onClick={() => scanOne()} disabled={busy}>
                      {busy ? "Scanning…" : "Scan product"}
                    </button>
                  </div>
                </label>
                <label>
                  Verified Amazon starting source <small>(optional)</small>
                  <div className="row">
                    <input
                      value={f.amazonListingUrl}
                      onChange={(e) => set("amazonListingUrl", e.target.value)}
                      placeholder="https://www.amazon.com/dp/ASIN"
                    />
                  </div>
                  <small>
                    Use a verified listing as the first trusted source. Lens
                    still runs from the Shopify product and searches for
                    additional matching sources. The selected reference budget
                    caps marketplace review pulls at 20 reviews in Test or 200
                    in Balanced/Thorough.
                  </small>
                </label>
              </>
            ) : (
              <>
                <label>
                  Shopify store URL
                  <div className="row">
                    <input
                      value={storeUrl}
                      onChange={(e) => setStoreUrl(e.target.value)}
                      placeholder="instabeamtv.com"
                    />
                    <button onClick={scanStore} disabled={busy}>
                      {busy ? "Scanning…" : "Scan whole store"}
                    </button>
                  </div>
                </label>
                {meta && (
                  <div className="summary">
                    <div>
                      <b>{meta.productCount} products</b>
                      <span>
                        {meta.scanned || 0} scanned · {meta.failed || 0} failed
                        · {enabled} included
                      </span>
                    </div>
                    <div className="actions">
                      <span>All</span>
                      <button
                        className={`switch ${allOn ? "on" : ""}`}
                        onClick={() => all(!allOn)}
                      />
                      <input
                        className="search"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder="Search products, handles, URLs…"
                      />
                      <label className="workers">
                        Concurrent products
                        <select
                          value={concurrency}
                          onChange={(e) => setConcurrency(+e.target.value)}
                        >
                          <option value="12">12 workers</option>
                          <option value="10">10 workers</option>
                          <option value="8">8 workers</option>
                          <option value="6">6 workers</option>
                          <option value="4">4 workers</option>
                          <option value="2">2 workers</option>
                        </select>
                      </label>
                      <button className="ghost" onClick={exportJson}>
                        Export included JSON
                      </button>
                      <button
                        onClick={generateStore}
                        disabled={
                          genBusy ||
                          !storageReady ||
                          !products.some(
                            (x) => x.enabled && x.status === "done",
                          )
                        }
                      >
                        {genBusy
                          ? "Generating…"
                          : `Generate ${selectedStoreProducts.length} SKUs / ${storeRequestedTotal.toLocaleString()} reviews →`}
                      </button>
                    </div>
                  </div>
                )}
                {mode === "store" && genBusy && (
                  <div className="progressWrap">
                    <div className="progressTop">
                      <span>{progress.status}</span>
                      <b>
                        {progress.total
                          ? Math.round((progress.done / progress.total) * 100)
                          : 0}
                        %
                      </b>
                    </div>
                    <div className="bar">
                      <span
                        style={{
                          width: `${progress.total ? Math.max(2, (progress.done / progress.total) * 100) : 2}%`,
                        }}
                      />
                    </div>
                    <small>
                      Durable server workflow continues if this tab closes;
                      Supabase stores every checkpoint and the final export.
                    </small>
                  </div>
                )}
                {products.length > 0 && (
                  <div className="catalog">
                    {shown.map((p) => (
                      <div
                        className={`item ${p.status} ${p.enabled ? "" : "off"}`}
                        key={p.index}
                      >
                        <button
                          className={`switch ${p.enabled ? "on" : ""}`}
                          onClick={() => toggle(p.index)}
                        />
                        <span className="dot" />
                        <div>
                          <div className="titleLine">
                            <b>{p.productTitle || p.title}</b>
                            <span className="badge">{p.status}</span>
                          </div>
                          <a href={p.url} target="_blank" rel="noreferrer">
                            {p.url}
                          </a>
                          {p.status === "done" && (
                            <small>
                              AI kept {p.extracted.lines}/
                              {p.extracted.candidateLines} QA-useful lines
                            </small>
                          )}
                          {p.error && <small>{p.error}</small>}
                        </div>
                        <div
                          className={`reviewCount ${p.status === "done" && p.extracted?.existingReviewCount != null ? "known" : ""}`}
                        >
                          <span>Generate reviews</span>
                          <input
                            type="number"
                            min="5"
                            max="250"
                            value={reviewCountValue(p, f.reviewCount)}
                            onChange={(e) =>
                              setProductReviewCount(p.index, e.target.value)
                            }
                            disabled={busy || genBusy}
                          />
                          <small>
                            Live:{" "}
                            {p.status === "done"
                              ? p.extracted?.existingReviewCount == null
                                ? "Unavailable"
                                : p.extracted.existingReviewCount.toLocaleString()
                              : p.status === "scanning"
                                ? "Checking…"
                                : "—"}
                          </small>
                        </div>
                        <div>
                          {p.status === "done" && (
                            <button onClick={() => useProduct(p)}>
                              Use product →
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
        <form ref={form} onSubmit={generate}>
          <h2>Synthetic fixture generation</h2>
          <label>
            Product title
            <input
              value={f.productTitle}
              onChange={(e) => set("productTitle", e.target.value)}
              required
            />
          </label>
          <label>
            Consumer-relevant QA context
            <textarea
              rows="12"
              value={f.productDescription}
              onChange={(e) => set("productDescription", e.target.value)}
              required
            />
          </label>
          <div className="grid">
            <label>
              Fixture count
              <input
                type="number"
                min="5"
                max="250"
                value={f.reviewCount}
                onChange={(e) => set("reviewCount", e.target.value)}
              />
            </label>
            <label>
              Test rating average
              <input
                type="number"
                min="1"
                max="5"
                step=".1"
                value={f.targetAverage}
                onChange={(e) => set("targetAverage", e.target.value)}
              />
            </label>
            <label>
              Parallel AI
              <select
                value={concurrency}
                onChange={(e) => setConcurrency(+e.target.value)}
              >
                <option value="12">12 workers</option>
                <option value="10">10 workers</option>
                <option value="8">8 workers</option>
                <option value="6">6 workers</option>
                <option value="4">4 workers</option>
                <option value="2">2 workers</option>
              </select>
            </label>
          </div>
          <div className="generationBudget">
            <b>
              {externalReferencesEnabled
                ? "Output mode: Lens/Amazon simple rewrite"
                : "Output mode: PDP-only generator"}
            </b>
            <span>
              {externalReferencesEnabled
                ? "Reference mode On · the durable server workflow pulls source reviews, rewrites only what the source review says, and purges mismatches or failed rewrites."
                : "Reference mode Off · the durable server workflow generates every fixture from Shopify PDP context with the PDP quality/repair logic."}
            </span>
          </div>
          <AreviewsExportControls showExport={false} />
          {genBusy && (
            <div className="progressWrap">
              <div className="progressTop">
                <span>{progress.status}</span>
                <b>
                  {progress.total
                    ? Math.round((progress.done / progress.total) * 100)
                    : 0}
                  %
                </b>
              </div>
              <div className="bar">
                <span
                  style={{
                    width: `${progress.total ? Math.max(2, (progress.done / progress.total) * 100) : 2}%`,
                  }}
                />
              </div>
              <small>
                Starting one durable server workflow. It will remain visible in
                the generation queue after this request is accepted.
              </small>
            </div>
          )}
          {err && <div className="error">{err}</div>}
          <div className="formActions">
            <button
              className="primary"
              disabled={genBusy || health.ok === false || !storageReady}
            >
              {genBusy
                ? "Generating…"
                : externalReferencesEnabled
                  ? "Extract + rewrite source reviews →"
                  : "Generate PDP-only QA fixtures →"}
            </button>
          </div>
          {!storageReady && (
            <div className="qaNotice">
              <b>Supabase required for /studio.</b>
              <span>
                Current production store is {store}. Set Vercel env vars
                SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then redeploy.
              </span>
            </div>
          )}
        </form>
      </section>
    </main>
  );
}
