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
import CreditBalanceBar from "../credit-balance-bar";
import ReferenceBudgetControl from "../reference-budget-control";

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
  variant = "full",
}) {
  const activeRuns = runs.filter((run) =>
      activeGenerationStatuses.has(run.catalog?.status),
    ),
    inactiveRuns = runs.filter(
      (run) => !activeGenerationStatuses.has(run.catalog?.status),
    ),
    activeCount = activeRuns.length,
    displayRuns =
      variant === "rail" ? [...activeRuns, ...inactiveRuns.slice(0, 3)] : runs,
    compact = variant === "rail";
  return (
    <section className={`generationQueue ${compact ? "queueRailPanel" : ""}`}>
      <div className="queueHead">
        <div>
          <span>{compact ? "ALWAYS VISIBLE" : "SERVER-SIDE GENERATIONS"}</span>
          <h2>{compact ? "Server queue" : "Generation queue"}</h2>
          <p>
            {activeCount
              ? `${activeCount} generation${activeCount === 1 ? "" : "s"} currently in process. You can close this tab safely.`
              : "No generations are currently running. Recent generations remain available below."}
          </p>
        </div>
        {!compact && (
          <button className="ghost" onClick={onRefresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>
      {error && <div className="queueError">{error}</div>}
      {!displayRuns.length && !loading ? (
        <div className="emptyQueue">No server generations yet.</div>
      ) : (
        <div className="generationJobs">
          {displayRuns.map((run) => {
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
                      {compact ? "View" : "View generated reviews"}
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
                        : compact
                          ? "Cancel"
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
    [scanNotice, setScanNotice] = useState(""),
    [scanError, setScanError] = useState(""),
    [result, setResult] = useState(null),
    [bulkResult, setBulkResult] = useState(null),
    [externalReferencesEnabled, setExternalReferencesEnabledState] =
      useState(true),
    [catalogRuns, setCatalogRuns] = useState([]),
    [queueLoading, setQueueLoading] = useState(true),
    [queueError, setQueueError] = useState(""),
    [cancelingId, setCancelingId] = useState(""),
    [screen, setScreen] = useState("generate"),
    [resultsPage, setResultsPage] = useState(1);
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
      const response = await fetch("/api/store-review-workflows?limit=30", {
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
    const targetUrl = String(url || "").trim();
    if (!targetUrl) {
      const message = "Enter a product URL first.";
      setErr(message);
      setScanError(message);
      setScanNotice("");
      return null;
    }
    setBusy(true);
    setErr("");
    setScanError("");
    setScanNotice("Scanning product page and extracting QA context…");
    try {
      const r = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: targetUrl,
            amazonListingUrl: f.amazonListingUrl,
            deferReferenceScan: true,
          }),
        }),
        j = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(j.error || "Scan failed");
      setF((x) => ({
        ...x,
        productUrl: j.productUrl,
        amazonListingUrl: j.amazonListingUrl || x.amazonListingUrl,
        productTitle: j.productTitle,
        productDescription: j.productDescription,
      }));
      setScanNotice(
        `Product scan complete: ${j.productTitle || "details loaded"}.`,
      );
      return j;
    } catch (e) {
      setErr(e.message);
      setScanError(e.message);
      setScanNotice("");
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function scanStore() {
    const normalizedStoreUrl = storeUrl.trim();
    if (!normalizedStoreUrl) {
      const message = "Enter a Shopify store URL first.";
      setErr(message);
      setScanError(message);
      setScanNotice("");
      return;
    }
    setBusy(true);
    setErr("");
    setScanError("");
    setScanNotice("Reading the Shopify sitemap and product catalog…");
    setProducts([]);
    setMeta(null);
    try {
      const r = await fetch("/api/store-scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ storeUrl: normalizedStoreUrl }),
        }),
        j = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(j.error || "Store discovery failed");
      if (!Array.isArray(j.products) || !j.products.length)
        throw Error("No Shopify products were found for that store URL.");
      const defaultReviewCount = cleanReviewCount(f.reviewCount, 100),
        rows = j.products.map((p) => ({
          ...p,
          enabled: true,
          status: "queued",
          reviewCount: defaultReviewCount,
        }));
      setProducts(rows);
      setMeta({ ...j, scanned: 0, failed: 0 });
      const scanWorkers = Math.min(
        Math.max(1, Number(concurrency) || 1),
        rows.length,
      );
      setScanNotice(
        `Found ${rows.length} products. Scanning product details with ${scanWorkers} worker${scanWorkers === 1 ? "" : "s"}…`,
      );
      await sleep(60);
      let cursor = 0,
        scanned = 0,
        failed = 0;
      const updateScanProgress = () => {
        const complete = scanned + failed;
        setMeta((m) => ({ ...(m || j), scanned, failed }));
        setScanNotice(
          `Scanning product details · ${complete}/${rows.length} complete${failed ? ` · ${failed} failed` : ""}.`,
        );
      };
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
              d = await q.json().catch(() => ({}));
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
          updateScanProgress();
        }
      }
      await Promise.all(Array.from({ length: scanWorkers }, worker));
      setMeta((m) => ({ ...m, complete: true }));
      setScanNotice(
        `Store scan complete · ${scanned} product${scanned === 1 ? "" : "s"} ready${failed ? ` · ${failed} failed` : ""}.`,
      );
    } catch (e) {
      setErr(e.message);
      setScanError(e.message);
      setScanNotice("");
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
    setScreen("queue");
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
      setScreen("results");
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
  const activeRuns = catalogRuns.filter((run) =>
      activeGenerationStatuses.has(run.catalog?.status),
    ),
    queuedRuns = catalogRuns.filter((run) => run.catalog?.status === "queued"),
    completedRuns = catalogRuns.filter(
      (run) => run.catalog?.status === "completed",
    ),
    failedOrCanceledRuns = catalogRuns.filter((run) =>
      ["failed", "canceled"].includes(run.catalog?.status),
    ),
    resultsPageSize = 10,
    totalResultPages = Math.max(
      1,
      Math.ceil(completedRuns.length / resultsPageSize),
    ),
    safeResultsPage = Math.min(resultsPage, totalResultPages),
    pagedCompletedRuns = completedRuns.slice(
      (safeResultsPage - 1) * resultsPageSize,
      safeResultsPage * resultsPageSize,
    ),
    generationQueue = (
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
    queueRail = (
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
        variant="rail"
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
    ),
    bulkPreviewReviews = (bulkResult?.products || [])
      .flatMap((product) =>
        (product.reviews || []).slice(0, 2).map((review) => ({
          ...review,
          productTitle: product.productTitle,
        })),
      )
      .slice(0, 8),
    resultPreviewReviews = result ? (result.reviews || []).slice(0, 12) : [],
    loadedResultLabel = bulkResult
      ? `${bulkResult.skuCount} SKU batch`
      : result
        ? result.input?.productTitle || "Single product"
        : "No batch loaded",
    healthLabel = health.loading
      ? "Checking…"
      : health.ok && storageReady
        ? `Connected · ${health.model} · durable server workflows active`
        : !storageReady
          ? `Supabase inactive · current store: ${store}`
          : `Unavailable · ${health.error || "unknown error"}`,
    navItems = [
      ["generate", "Generate", "Scan + configure"],
      ["queue", "Queue", `${activeRuns.length} active`],
      ["results", "Results", `${completedRuns.length} completed`],
      ["settings", "Settings", "Exports + sourcing"],
    ];

  return (
    <main className="studioShell">
      <header className="studioTopbar">
        <div className="studioBrand">
          <b>SR</b>
          <div>
            <span>Synthetic Review Lab</span>
            <small>Review operations</small>
          </div>
        </div>
        <div className={`studioConnection ${health.ok && storageReady ? "good" : "bad"}`}>
          <span />
          {healthLabel}
        </div>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            healthCheck();
            refreshStore().catch((e) => setErr(e.message));
            setQueueLoading(true);
            refreshCatalogRuns().catch(() => {});
          }}
        >
          Recheck
        </button>
      </header>

      <section className="studioLayout">
        <aside className="studioNav">
          <div className="studioNavIntro">
            <small>WORKFLOW</small>
            <h1>Review ops</h1>
            <p>
              Prepare batches, monitor server jobs, and export completed review
              sets from one workspace.
            </p>
          </div>
          <nav>
            {navItems.map(([id, label, detail]) => (
              <button
                type="button"
                key={id}
                className={screen === id ? "active" : ""}
                onClick={() => setScreen(id)}
              >
                <span>{label}</span>
                <small>{detail}</small>
              </button>
            ))}
          </nav>
          <div className="studioNavSummary">
            <span>Loaded result</span>
            <strong>{loadedResultLabel}</strong>
            <small>
              {selectedStoreProducts.length
                ? `${selectedStoreProducts.length} scanned SKUs selected`
                : f.productTitle
                  ? "Single product ready"
                  : "Nothing selected yet"}
            </small>
          </div>
        </aside>

        <section className="studioWorkspace">
          {screen === "generate" && (
            <div className="screenStack">
              <div className="studioHero">
                <div>
                  <small>SYNTHETIC QA / MODELING DATA ONLY</small>
                  <h2>Prepare a batch</h2>
                  <p>
                    Scan one product or a catalog, confirm the output settings,
                    then queue the work server-side.
                  </p>
                </div>
                <aside>
                  <span>Default run</span>
                  <strong>{concurrency} workers</strong>
                  <em>{f.targetAverage}★ target average</em>
                </aside>
              </div>

              <div className="qaNotice">
                <b>Internal synthetic QA fixtures only.</b>
                <span>
                  Not genuine customer feedback. Exports are permanently tagged
                  synthetic and publication_allowed=false.
                </span>
              </div>

              <section className="panel studioCard">
                <div className="scannerHead">
                  <div>
                    <small>SOURCE</small>
                    <h2>Product input</h2>
                  </div>
                  <div className="tabs">
                    <button
                      type="button"
                      className={mode === "product" ? "active" : ""}
                      onClick={() => setMode("product")}
                    >
                      Single product
                    </button>
                    <button
                      type="button"
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
                          <button
                            type="button"
                            onClick={() => scanOne()}
                            disabled={busy}
                          >
                            {busy ? "Scanning…" : "Scan product"}
                          </button>
                        </div>
                      </label>
                      {scanNotice && (
                        <div className="scannerNotice">{scanNotice}</div>
                      )}
                      {scanError && (
                        <div className="scannerNotice scannerNoticeError">
                          {scanError}
                        </div>
                      )}
                      <label>
                        Verified Amazon starting source <small>(optional)</small>
                        <div className="row">
                          <input
                            value={f.amazonListingUrl}
                            onChange={(e) =>
                              set("amazonListingUrl", e.target.value)
                            }
                            placeholder="https://www.amazon.com/dp/ASIN"
                          />
                        </div>
                        <small>
                          Use a verified listing as the first trusted source.
                          Lens still runs from the Shopify product and searches
                          for additional matching sources.
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
                          <button
                            type="button"
                            onClick={scanStore}
                            disabled={busy}
                          >
                            {busy ? "Scanning…" : "Scan whole store"}
                          </button>
                        </div>
                      </label>
                      {scanNotice && (
                        <div className="scannerNotice">{scanNotice}</div>
                      )}
                      {scanError && (
                        <div className="scannerNotice scannerNoticeError">
                          {scanError}
                        </div>
                      )}
                      {meta && (
                        <div className="summary">
                          <div>
                            <b>{meta.productCount} products</b>
                            <span>
                              {meta.scanned || 0} scanned · {meta.failed || 0}{" "}
                              failed · {enabled} included
                            </span>
                          </div>
                          <div className="actions">
                            <span>All</span>
                            <button
                              type="button"
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
                            <button
                              type="button"
                              className="ghost"
                              onClick={exportJson}
                            >
                              Export included JSON
                            </button>
                            <button
                              type="button"
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
                                ? "Starting…"
                                : `Queue ${selectedStoreProducts.length} SKUs / ${storeRequestedTotal.toLocaleString()} reviews →`}
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
                                ? Math.round(
                                    (progress.done / progress.total) * 100,
                                  )
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
                            Durable server workflow continues if this tab closes.
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
                                type="button"
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
                                    setProductReviewCount(
                                      p.index,
                                      e.target.value,
                                    )
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
                                  <button
                                    type="button"
                                    onClick={() => useProduct(p)}
                                  >
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

              <form ref={form} onSubmit={generate} className="generationForm">
                <div className="formHead">
                  <div>
                    <small>OUTPUT</small>
                    <h2>Batch settings</h2>
                  </div>
                  <span>
                    {mode === "store"
                      ? "Bulk uses the selected SKUs above."
                      : "Single product creates one server job."}
                  </span>
                </div>
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
                {genBusy && mode === "product" && (
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
                      Starting one durable server workflow. It will remain
                      visible in the generation queue after acceptance.
                    </small>
                  </div>
                )}
                {err && <div className="error">{err}</div>}
                <div className="formActions">
                  <button
                    className="primary"
                    disabled={
                      mode !== "product" ||
                      genBusy ||
                      health.ok === false ||
                      !storageReady
                    }
                  >
                    {genBusy && mode === "product"
                      ? "Starting…"
                      : externalReferencesEnabled
                        ? "Queue single source rewrite →"
                        : "Queue single PDP-only run →"}
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
            </div>
          )}

          {screen === "queue" && (
            <div className="screenStack">
              <div className="studioPageHead">
                <div>
                  <small>SERVER OPERATIONS</small>
                  <h2>Server queue</h2>
                  <p>
                    Track active jobs, cancel full generations, and open
                    completed batches into Results.
                  </p>
                </div>
              </div>
              <div className="studioStats">
                <article>
                  <span>Active</span>
                  <strong>{activeRuns.length}</strong>
                </article>
                <article>
                  <span>Queued</span>
                  <strong>{queuedRuns.length}</strong>
                </article>
                <article>
                  <span>Completed</span>
                  <strong>{completedRuns.length}</strong>
                </article>
                <article>
                  <span>Stopped / failed</span>
                  <strong>{failedOrCanceledRuns.length}</strong>
                </article>
              </div>
              {generationQueue}
            </div>
          )}

          {screen === "results" && (
            <div className="screenStack">
              <div className="studioPageHead">
                <div>
                  <small>RESULTS ARCHIVE</small>
                  <h2>Batch archive</h2>
                  <p>
                    Latest 30 completed server batches, paged 10 at a time.
                    Open any batch to preview and export.
                  </p>
                </div>
              </div>

              <section className="studioCard archiveCard">
                <div className="cardHead">
                  <div>
                    <small>COMPLETED SERVER BATCHES</small>
                    <h3>Batch archive</h3>
                  </div>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setQueueLoading(true);
                      refreshCatalogRuns().catch(() => {});
                    }}
                    disabled={queueLoading}
                  >
                    {queueLoading ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
                {!completedRuns.length ? (
                  <div className="emptyQueue">
                    No completed server batches yet. Start a generation, then
                    it will appear here when finished.
                  </div>
                ) : (
                  <>
                    <div className="archiveList">
                      {pagedCompletedRuns.map((run) => {
                        const catalog = run.catalog || {},
                          progress = run.progress || {},
                          label = catalog.bulk
                            ? `${progress.totalSkus || 0} SKU catalog`
                            : catalog.productTitle ||
                              run.children?.[0]?.productTitle ||
                              "Single product generation";
                        return (
                          <article key={catalog.id} className="archiveRow">
                            <div>
                              <span className="jobStatus">{catalog.status}</span>
                              <h4>{label}</h4>
                              <small>
                                {generationTime(catalog.createdAt)} ET ·{" "}
                                {(progress.total || 0).toLocaleString()} reviews
                              </small>
                            </div>
                            <button
                              type="button"
                              onClick={() => viewCatalogResult(run)}
                            >
                              Open
                            </button>
                          </article>
                        );
                      })}
                    </div>
                    <div className="paginationControls">
                      <button
                        type="button"
                        className="ghost"
                        disabled={safeResultsPage <= 1}
                        onClick={() =>
                          setResultsPage((page) => Math.max(1, page - 1))
                        }
                      >
                        Previous
                      </button>
                      <span>
                        Page {safeResultsPage} of {totalResultPages}
                      </span>
                      <button
                        type="button"
                        className="ghost"
                        disabled={safeResultsPage >= totalResultPages}
                        onClick={() =>
                          setResultsPage((page) =>
                            Math.min(totalResultPages, page + 1),
                          )
                        }
                      >
                        Next
                      </button>
                    </div>
                  </>
                )}
              </section>

              <section className="studioCard resultDetailCard">
                {bulkResult ? (
                  <>
                    <div className="resultHead">
                      <div>
                        <small>
                          {bulkNeedsReview
                            ? "BULK QA DATASET NEEDS REVIEW"
                            : "BULK QA DATASET COMPLETE"}
                        </small>
                        <h2>{bulkResult.skuCount} SKUs generated in parallel</h2>
                        <p>
                          {bulkResult.totalReviews.toLocaleString()} final
                          synthetic fixtures ·{" "}
                          {bulkResult.totalPurgedReviews.toLocaleString()} purged
                        </p>
                      </div>
                      <div className="actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setBulkResult(null)}
                        >
                          Clear detail
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => dlBulk("json")}
                        >
                          JSON + purge audit
                        </button>
                        <button type="button" onClick={() => dlBulk("csv")}>
                          Clean CSV
                        </button>
                        <AreviewsExportControls onExport={dlBulkAreviews} />
                      </div>
                    </div>
                    <div className="studioStats detailStats">
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
                        <strong>
                          {bulkResult.totalPurgedReviews.toLocaleString()}
                        </strong>
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
                    <div className="bulkGrid resultSkuGrid">
                      {bulkResult.products.map((p) => (
                        <article key={p.productUrl}>
                          <div>
                            <b>{p.productTitle}</b>
                            <span>
                              {p.reviews.length} final ·{" "}
                              {p.purgedReviewCount || 0} purged
                            </span>
                          </div>
                          <small>{p.productUrl}</small>
                          <footer>
                            {formatAverage(p.actualAverage)}★ actual · existing
                            count {p.existingReviewCount ?? "unavailable"} · refs{" "}
                            {Number(
                              p.referenceCoverage?.referenceLedTotal || 0,
                            ).toLocaleString()}
                            /{p.reviews.length.toLocaleString()} · QA{" "}
                            {p.corpusDiagnostics?.qaStatus || "unknown"}
                          </footer>
                        </article>
                      ))}
                    </div>
                    <div className="reviewPreviewList">
                      <div className="cardHead">
                        <div>
                          <small>PREVIEW</small>
                          <h3>Review samples</h3>
                        </div>
                        <span>First samples across SKUs</span>
                      </div>
                      {bulkPreviewReviews.map((review, index) => (
                        <article key={`${review.productTitle}-${review.id || index}`}>
                          <div>
                            <span>
                              {"★".repeat(Number(review.rating) || 0)}
                              {"☆".repeat(5 - (Number(review.rating) || 0))}
                            </span>
                            <small>{review.productTitle}</small>
                            <time>{review.date}</time>
                          </div>
                          <h4>{review.title}</h4>
                          <p>{review.body}</p>
                        </article>
                      ))}
                    </div>
                  </>
                ) : result ? (
                  <>
                    <div className="resultHead">
                      <div>
                        <small>
                          {resultQaComplete
                            ? "QA DATASET COMPLETE"
                            : "QA DATASET NEEDS REVIEW"}
                        </small>
                        <h2>{result.input?.productTitle}</h2>
                        <p>
                          {result.reviews.length} final synthetic fixtures ·{" "}
                          {result.purgedReviewCount || 0} purged ·{" "}
                          {formatAverage(result.actualAverage)}★ actual
                        </p>
                      </div>
                      <div className="actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setResult(null)}
                        >
                          Clear detail
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => dl("json")}
                        >
                          JSON + purge audit
                        </button>
                        <button type="button" onClick={() => dl("csv")}>
                          Clean CSV
                        </button>
                        <AreviewsExportControls onExport={dlAreviews} />
                      </div>
                    </div>
                    <div className="studioStats detailStats">
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
                          {resultReferenceAvailable.toLocaleString()} imported
                          usable references
                        </small>
                      </article>
                      <article>
                        <span>PDP-only</span>
                        <strong>{resultPdpOnly.toLocaleString()}</strong>
                        <small>product details only</small>
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
                          hard cap {result.generationCallBudget?.capped ?? "—"}
                        </small>
                      </article>
                    </div>
                    <div className="reviewPreviewList">
                      <div className="cardHead">
                        <div>
                          <small>PREVIEW</small>
                          <h3>Generated reviews</h3>
                        </div>
                        <span>Showing first {resultPreviewReviews.length}</span>
                      </div>
                      {resultPreviewReviews.map((review) => (
                        <article key={review.id}>
                          <div>
                            <span>
                              {"★".repeat(Number(review.rating) || 0)}
                              {"☆".repeat(5 - (Number(review.rating) || 0))}
                            </span>
                            <small>
                              {review.referenceLed
                                ? "SYNTHETIC · REFERENCE-LED"
                                : "SYNTHETIC · PDP-ONLY"}
                            </small>
                            <time>{review.date}</time>
                          </div>
                          <h4>{review.title}</h4>
                          <p>{review.body}</p>
                          <footer>
                            {review.personaId} · {review.persona}
                            {review.referenceLed
                              ? ` · ${review.referencePlatform || "external reference"}`
                              : ""}
                          </footer>
                        </article>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="emptyResultDetail">
                    <small>NO RESULT OPEN</small>
                    <h2>Open a completed batch from the archive.</h2>
                    <p>
                      This keeps old batches easy to inspect without losing your
                      Generate setup or hiding jobs that are still running.
                    </p>
                  </div>
                )}
              </section>
            </div>
          )}

          {screen === "settings" && (
            <div className="screenStack">
              <div className="studioPageHead">
                <div>
                  <small>SETTINGS</small>
                  <h2>Defaults and controls</h2>
                  <p>
                    Configure new jobs and export defaults. Completed batches
                    remain unchanged.
                  </p>
                </div>
              </div>
              <section className={`health ${health.ok && storageReady ? "good" : "bad"}`}>
                <div>
                  <b>AI Gateway + Supabase</b>
                  <span>{healthLabel}</span>
                </div>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    healthCheck();
                    refreshStore().catch((e) => setErr(e.message));
                  }}
                >
                  Recheck
                </button>
              </section>
              <section className="studioCard settingsGrid">
                <article>
                  <small>SOURCING MODE</small>
                  <h3>External source rewrites</h3>
                  <p>
                    When enabled, server jobs pull matching source reviews,
                    rewrite only source-supported claims, and purge bad fits.
                  </p>
                  <label className="toggleLine">
                    <input
                      type="checkbox"
                      checked={externalReferencesEnabled}
                      onChange={(e) =>
                        setExternalReferencesEnabled(e.target.checked)
                      }
                    />
                    {externalReferencesEnabled ? "Reference mode On" : "PDP-only"}
                  </label>
                </article>
                <article>
                  <small>AREVIEWS EXPORT</small>
                  <h3>Date range</h3>
                  <p>
                    Default is today. Exports randomize review dates inside the
                    selected range so multiple SKUs do not appear strictly
                    chronological.
                  </p>
                  <AreviewsExportControls showExport={false} />
                </article>
              </section>
              <section className="studioCard settingsStack">
                <div className="cardHead">
                  <div>
                    <small>REFERENCE BUDGET</small>
                    <h3>Scan depth</h3>
                  </div>
                </div>
                <ReferenceBudgetControl embedded />
              </section>
              <section className="studioCard settingsStack">
                <div className="cardHead">
                  <div>
                    <small>CREDITS</small>
                    <h3>Spend monitor</h3>
                  </div>
                </div>
                <CreditBalanceBar embedded />
              </section>
            </div>
          )}
        </section>

        <aside className="studioQueueRail">{queueRail}</aside>
      </section>
    </main>
  );
}
