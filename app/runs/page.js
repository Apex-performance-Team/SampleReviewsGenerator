"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AreviewsExportControls from "../areviews-export-controls";

const start = {
  mode: "pdp_only",
  productUrl: "",
  amazonListingUrl: "",
  productTitle: "",
  productDescription: "",
  reviewCount: 50,
  targetAverage: 4.7,
  referenceBudget: "balanced",
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fmtDate = (value) => (value ? new Date(value).toLocaleString() : "—");
const statusLabel = (run) =>
  `${run?.completed_count || 0}/${run?.requested_count || 0}${run?.purged_count ? ` · ${run.purged_count} purged` : ""}`;
const linkButton = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  borderRadius: 9,
  padding: "11px 14px",
  fontWeight: 750,
  textDecoration: "none",
};
const cardGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
  gap: 12,
};
const fullGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
  gap: 18,
  alignItems: "start",
};
const muted = { color: "#8995a2" };
const tiny = { fontSize: 11, color: "#8995a2", lineHeight: 1.45 };
const activeBorder = { border: "1px solid #477e59", background: "#101b14" };
const quietBorder = { border: "1px solid #29313a", background: "#0d1218" };

function wizardIndex(form, run) {
  if (run?.status === "completed") return 4;
  if (run) return 3;
  if (form.productUrl || form.productTitle) return 2;
  return 0;
}
function stageRows(run) {
  if (!run) return [];
  const source = run.mode === "source_rewrite";
  const rows = source
    ? [
        ["scan_pdp", "Product scanned", "Read Shopify product identity"],
        [
          "source_scan",
          "Sources found",
          "Use Lens/search to locate matching listings",
        ],
        [
          "marketplace_pull",
          "Reviews pulled",
          "Import available Amazon/eBay review bodies",
        ],
        [
          "source_rewrite",
          "Rewrite + purge",
          "Rewrite source reviews and discard mismatches",
        ],
        ["finalize", "Finalize", "Build final CSV payload"],
      ]
    : [
        ["scan_pdp", "Product scanned", "Read Shopify product identity"],
        [
          "plan",
          "Corpus planned",
          "Create review distribution and variation map",
        ],
        [
          "generate",
          "PDP reviews generated",
          "Generate batches from Shopify context",
        ],
        ["qa", "QA checked", "Run corpus checks where available"],
        ["finalize", "Finalize", "Build final CSV payload"],
      ];
  const step = run.current_step || "queued",
    index =
      run.status === "completed"
        ? rows.length
        : Math.max(
            0,
            rows.findIndex((row) => row[0] === step),
          );
  return rows.map((row, i) => ({
    key: row[0],
    title: row[1],
    detail: row[2],
    state:
      run.status === "failed" && i === index
        ? "failed"
        : i < index || run.status === "completed"
          ? "done"
          : i === index
            ? "active"
            : "waiting",
  }));
}
function StepRail({ form, run }) {
  const steps = ["Product", "Mode", "Settings", "Run", "Export"],
    active = wizardIndex(form, run);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))",
        gap: 8,
        margin: "0 0 18px",
      }}
    >
      {steps.map((step, i) => (
        <div
          key={step}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: i <= active ? "1px solid #477e59" : "1px solid #29313a",
            background: i === active ? "#101b14" : "#0d1218",
          }}
        >
          <b style={{ fontSize: 12 }}>
            {i + 1}. {step}
          </b>
          <small style={{ display: "block", marginTop: 3, ...tiny }}>
            {i < active ? "Done" : i === active ? "Current" : "Next"}
          </small>
        </div>
      ))}
    </div>
  );
}
function ProgressList({ run }) {
  const rows = stageRows(run);
  if (!rows.length)
    return (
      <div className="qaNotice" style={{ margin: 0 }}>
        <b>No active run</b>
        <span>Create a run or select one from history.</span>
      </div>
    );
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.map((row) => (
        <div
          key={row.key}
          style={{
            display: "grid",
            gridTemplateColumns: "28px minmax(0,1fr)",
            gap: 9,
            alignItems: "start",
            padding: "11px 12px",
            borderRadius: 10,
            ...(row.state === "active" ? activeBorder : quietBorder),
          }}
        >
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background:
                row.state === "done"
                  ? "#21402b"
                  : row.state === "failed"
                    ? "#4a1c1c"
                    : "#1b2229",
              color: row.state === "waiting" ? "#788593" : "#dff4e6",
              fontSize: 12,
            }}
          >
            {row.state === "done"
              ? "✓"
              : row.state === "failed"
                ? "!"
                : row.state === "active"
                  ? "▶"
                  : "○"}
          </span>
          <div>
            <b style={{ fontSize: 13 }}>{row.title}</b>
            <small style={{ display: "block", marginTop: 3, ...tiny }}>
              {row.detail}
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}
function ModeCard({ active, title, detail, bullets, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left",
        color: "inherit",
        padding: 16,
        borderRadius: 13,
        ...(active ? activeBorder : quietBorder),
      }}
    >
      <b>{title}</b>
      <p style={{ margin: "7px 0 10px", ...tiny }}>{detail}</p>
      <ul style={{ margin: 0, paddingLeft: 18, ...tiny }}>
        {bullets.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </button>
  );
}

export default function RunsPage() {
  const [form, setForm] = useState(start),
    [runs, setRuns] = useState([]),
    [selected, setSelected] = useState(null),
    [store, setStore] = useState(""),
    [busy, setBusy] = useState(false),
    [auto, setAuto] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const stopRef = useRef(false);
  const set = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));
  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selected) || null,
    [runs, selected],
  );
  const isSource = form.mode === "source_rewrite";
  const canExport = selectedRun?.status === "completed";
  const refresh = useCallback(async (selectId = null) => {
    setError("");
    const res = await fetch("/api/review-runs", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Error(json.error || "Could not load server runs.");
    setRuns(json.runs || []);
    setStore(json.store || "");
    if (selectId) setSelected(selectId);
    else setSelected((current) => current || json.runs?.[0]?.id || null);
    return json;
  }, []);
  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, [refresh]);
  async function scanProduct() {
    if (!form.productUrl) {
      setError("Add a Shopify product URL first.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("Scanning Shopify product identity…");
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: form.productUrl,
          amazonListingUrl: form.amazonListingUrl,
          deferReferenceScan: true,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw Error(json.error || "Product scan failed.");
      setForm((current) => ({
        ...current,
        productUrl: json.productUrl || current.productUrl,
        amazonListingUrl: json.amazonListingUrl || current.amazonListingUrl,
        productTitle: json.productTitle || current.productTitle,
        productDescription:
          json.productDescription || current.productDescription,
      }));
      setNotice("Product identity loaded. Choose the run mode next.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveRun(startNow = false) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/review-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          reviewCount: Number(form.reviewCount),
          targetAverage: Number(form.targetAverage),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw Error(json.error || "Could not create server run.");
      setSelected(json.run.id);
      setNotice(
        startNow
          ? "Run created. Starting its durable server workflow…"
          : "Run saved. Start it when ready.",
      );
      await refresh(json.run.id);
      if (startNow) {
        await startDurableRun(json.run.id);
        setNotice(
          "Durable server workflow started. It continues if this tab closes.",
        );
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function processOnce(id = selected) {
    if (!id) return null;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/review-runs/${id}/process`, {
        method: "POST",
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw Error(json.error || "Could not process run.");
      await refresh(id);
      return json.run;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function startDurableRun(id) {
    if (!id) throw Error("Select a run first.");
    const res = await fetch("/api/store-review-workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          catalogId: globalThis.crypto.randomUUID(),
          resumeRunIds: [id],
          bulk: false,
          concurrency: 1,
          targetAverage: Number(form.targetAverage),
          referenceBudget: form.referenceBudget,
        }),
      }),
      json = await res.json().catch(() => ({}));
    if (!res.ok)
      throw Error(json.error || "Could not start durable server workflow.");
    return json;
  }
  async function autoRun() {
    if (!selected) return;
    stopRef.current = false;
    setAuto(true);
    setError("");
    setNotice("Starting durable server workflow…");
    try {
      await startDurableRun(selected);
      setNotice(
        "Server workflow is running. This page is only watching it; closing the tab will not stop generation.",
      );
      for (let i = 0; i < 600 && !stopRef.current; i++) {
        const json = await refresh(selected),
          current = json.runs?.find((run) => run.id === selected);
        if (
          !current ||
          ["completed", "failed", "canceled"].includes(current.status)
        )
          break;
        await sleep(2000);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setAuto(false);
    }
  }
  function stopAuto() {
    stopRef.current = true;
    setAuto(false);
    setNotice("Live watching stopped. The server workflow is still running.");
  }
  function exportAreviews({ startDate, endDate }) {
    if (!selectedRun) return;
    const query = new URLSearchParams({ startDate, endDate });
    window.location.assign(
      `/api/review-runs/${selectedRun.id}/areviews.csv?${query.toString()}`,
    );
  }
  return (
    <main>
      <header>
        <b>SR</b>
        <span>Synthetic Review Lab</span>
        <i>Server runs</i>
      </header>
      <section className="wrap">
        <div className={`health ${store === "supabase" ? "good" : "bad"}`}>
          <div>
            <b>Run storage</b>
            <span>
              {store === "supabase"
                ? "Supabase durable storage active"
                : store === "local_tmp"
                  ? "Local temp fallback active. Production needs Supabase env vars for team durability."
                  : "Checking storage…"}
            </span>
          </div>
          <div className="actions">
            <a className="ghost" style={linkButton} href="/">
              Generator
            </a>
            <button
              className="ghost"
              onClick={() => refresh().catch((err) => setError(err.message))}
            >
              Refresh
            </button>
          </div>
        </div>
        <StepRail form={form} run={selectedRun} />
        {notice && (
          <div className="qaNotice">
            <b>Status</b>
            <span>{notice}</span>
          </div>
        )}
        {error && <div className="error">{error}</div>}
        <div style={fullGrid}>
          <section style={{ display: "grid", gap: 18 }}>
            <section className="panel">
              <div className="scannerHead">
                <div>
                  <h2>1. Product identity</h2>
                  <small style={tiny}>
                    Start with the Shopify listing. The title/context here
                    becomes the product truth for filtering and generation.
                  </small>
                </div>
                <button
                  type="button"
                  onClick={scanProduct}
                  disabled={busy || !form.productUrl}
                >
                  {busy ? "Working…" : "Scan product"}
                </button>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  saveRun(false);
                }}
              >
                <label>
                  Shopify product URL
                  <input
                    value={form.productUrl}
                    onChange={(event) => set("productUrl", event.target.value)}
                    placeholder="https://store.com/products/product"
                  />
                </label>
                <label>
                  Verified Amazon starting source <small>(optional)</small>
                  <input
                    value={form.amazonListingUrl}
                    onChange={(event) =>
                      set("amazonListingUrl", event.target.value)
                    }
                    placeholder="https://www.amazon.com/dp/ASIN"
                  />
                </label>
                <label>
                  Detected / manual product title
                  <input
                    value={form.productTitle}
                    onChange={(event) =>
                      set("productTitle", event.target.value)
                    }
                    placeholder="Product title from Shopify listing"
                  />
                </label>
                <label>
                  Detected / manual product context
                  <textarea
                    rows="8"
                    value={form.productDescription}
                    onChange={(event) =>
                      set("productDescription", event.target.value)
                    }
                    placeholder="Scan a URL or paste PDP context here."
                  />
                </label>
              </form>
            </section>
            <section className="panel">
              <div className="scannerHead">
                <div>
                  <h2>2. Choose output mode</h2>
                  <small style={tiny}>
                    These modes should feel different because the rewrite rules
                    are different.
                  </small>
                </div>
              </div>
              <div style={{ padding: 20 }}>
                <div style={cardGrid}>
                  <ModeCard
                    active={!isSource}
                    title="PDP-only generator"
                    detail="Use when we are creating synthetic PDP review fixtures from Shopify context."
                    bullets={[
                      "Full synthetic review logic",
                      "Target average matters",
                      "Heavier repair/diversity path",
                    ]}
                    onClick={() => set("mode", "pdp_only")}
                  />
                  <ModeCard
                    active={isSource}
                    title="Source review rewrite"
                    detail="Use when pulling Amazon/eBay-style source reviews and rewriting only what is already there."
                    bullets={[
                      "Product-match filter first",
                      "Simple rewrite only",
                      "Failed or mismatched rewrites get purged",
                    ]}
                    onClick={() => set("mode", "source_rewrite")}
                  />
                </div>
              </div>
            </section>
            <section className="panel">
              <div className="scannerHead">
                <div>
                  <h2>3. Configure run</h2>
                  <small style={tiny}>
                    {isSource
                      ? "Source mode should optimize for usable source review count, not perfect target-average control."
                      : "PDP mode uses count and target average as primary controls."}
                  </small>
                </div>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  saveRun(false);
                }}
              >
                <div className="grid">
                  <label>
                    {isSource ? "Target final reviews" : "Review count"}
                    <input
                      type="number"
                      min="5"
                      max="250"
                      value={form.reviewCount}
                      onChange={(event) =>
                        set("reviewCount", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    {isSource ? "Reference budget" : "Target average"}
                    {isSource ? (
                      <select
                        value={form.referenceBudget}
                        onChange={(event) =>
                          set("referenceBudget", event.target.value)
                        }
                      >
                        <option value="test">Test</option>
                        <option value="balanced">Balanced</option>
                        <option value="thorough">Thorough</option>
                      </select>
                    ) : (
                      <input
                        type="number"
                        min="1"
                        max="5"
                        step=".1"
                        value={form.targetAverage}
                        onChange={(event) =>
                          set("targetAverage", event.target.value)
                        }
                      />
                    )}
                  </label>
                  <label>
                    {isSource ? "Export target average" : "Reference budget"}
                    {isSource ? (
                      <input
                        type="number"
                        min="1"
                        max="5"
                        step=".1"
                        value={form.targetAverage}
                        onChange={(event) =>
                          set("targetAverage", event.target.value)
                        }
                      />
                    ) : (
                      <select
                        value={form.referenceBudget}
                        onChange={(event) =>
                          set("referenceBudget", event.target.value)
                        }
                      >
                        <option value="test">Test</option>
                        <option value="balanced">Balanced</option>
                        <option value="thorough">Thorough</option>
                      </select>
                    )}
                  </label>
                </div>
                <div className="generationBudget">
                  <b>
                    {isSource ? "Source rewrite rules" : "PDP generator rules"}
                  </b>
                  <span>
                    {isSource
                      ? "Pull sources, filter against the Shopify title/context, rewrite source reviews lightly, and purge anything that fails."
                      : "Generate from Shopify PDP context with the fuller synthetic review modifiers and QA path."}
                  </span>
                </div>
                <div className="formActions" style={{ gap: 8 }}>
                  <button className="ghost" type="submit" disabled={busy}>
                    {busy ? "Working…" : "Save run"}
                  </button>
                  <button
                    className="primary"
                    type="button"
                    disabled={busy}
                    onClick={() => saveRun(true)}
                  >
                    {busy ? "Working…" : "Create + start"}
                  </button>
                </div>
              </form>
            </section>
          </section>
          <aside style={{ display: "grid", gap: 18 }}>
            <section className="panel">
              <div className="scannerHead">
                <div>
                  <h2>4. Active run</h2>
                  <small style={tiny}>
                    This is the operational view. It shows what is actually
                    happening now.
                  </small>
                </div>
              </div>
              <div style={{ padding: 20, display: "grid", gap: 14 }}>
                {selectedRun ? (
                  <>
                    <div style={{ display: "grid", gap: 6 }}>
                      <small style={muted}>Product</small>
                      <b>
                        {selectedRun.product_title ||
                          selectedRun.input_json?.productTitle ||
                          "Untitled product"}
                      </b>
                      <small style={tiny}>
                        {selectedRun.product_url ||
                          selectedRun.input_json?.productUrl ||
                          "No URL saved"}
                      </small>
                    </div>
                    <div
                      className="stats"
                      style={{
                        gridTemplateColumns: "repeat(3,1fr)",
                        margin: 0,
                      }}
                    >
                      <article>
                        <span>Status</span>
                        <strong style={{ fontSize: 20 }}>
                          {selectedRun.status}
                        </strong>
                      </article>
                      <article>
                        <span>Progress</span>
                        <strong style={{ fontSize: 20 }}>
                          {statusLabel(selectedRun)}
                        </strong>
                      </article>
                      <article>
                        <span>Mode</span>
                        <strong style={{ fontSize: 20 }}>
                          {selectedRun.mode === "source_rewrite"
                            ? "Source"
                            : "PDP"}
                        </strong>
                      </article>
                    </div>
                    <ProgressList run={selectedRun} />
                    <div className="actions">
                      {selectedRun.status !== "completed" &&
                        selectedRun.status !== "canceled" && (
                          <button
                            className="ghost"
                            disabled={busy || auto}
                            onClick={() => processOnce()}
                          >
                            {busy ? "Processing…" : "Process next step"}
                          </button>
                        )}
                      {auto ? (
                        <button className="ghost" onClick={stopAuto}>
                          Stop live updates
                        </button>
                      ) : (
                        <button
                          disabled={
                            busy ||
                            !selectedRun ||
                            ["completed", "failed", "canceled"].includes(
                              selectedRun.status,
                            )
                          }
                          onClick={autoRun}
                        >
                          Run durably on server
                        </button>
                      )}
                      {canExport && (
                        <a
                          className="ghost"
                          style={linkButton}
                          href={`/api/review-runs/${selectedRun.id}/export.csv`}
                        >
                          Export CSV
                        </a>
                      )}
                      {canExport && (
                        <AreviewsExportControls onExport={exportAreviews} />
                      )}
                    </div>
                    <div className="qaNotice" style={{ margin: 0 }}>
                      <b>Server-side behavior</b>
                      <span>
                        Safe to close. Generation continues on the server; come
                        back later to see progress or export the completed run.
                      </span>
                    </div>
                  </>
                ) : (
                  <ProgressList run={null} />
                )}
              </div>
            </section>
            <section className="panel">
              <div className="scannerHead">
                <div>
                  <h2>5. Recent runs</h2>
                  <small style={tiny}>
                    History is secondary: select a run only when you need to
                    resume or export.
                  </small>
                </div>
              </div>
              <div className="catalog" style={{ margin: 20 }}>
                {runs.length ? (
                  runs.map((run) => (
                    <button
                      key={run.id}
                      type="button"
                      className={`item ${selected === run.id ? "done" : ""}`}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        background: "transparent",
                        color: "inherit",
                        border: 0,
                        borderBottom: "1px solid #222a32",
                        borderRadius: 0,
                        gridTemplateColumns: "10px minmax(0,1fr) 105px",
                      }}
                      onClick={() => setSelected(run.id)}
                    >
                      <span className="dot" />
                      <div>
                        <div className="titleLine">
                          <b>
                            {run.product_title ||
                              run.input_json?.productTitle ||
                              "Untitled product"}
                          </b>
                          <span className="badge">{run.status}</span>
                        </div>
                        <small>
                          {run.mode} · {fmtDate(run.created_at)}
                        </small>
                      </div>
                      <div
                        className={`reviewCount ${run.completed_count ? "known" : ""}`}
                      >
                        <span>Progress</span>
                        <strong>{statusLabel(run)}</strong>
                      </div>
                    </button>
                  ))
                ) : (
                  <div
                    className="item"
                    style={{ gridTemplateColumns: "10px minmax(0,1fr)" }}
                  >
                    <span className="dot" />
                    <div>
                      <b>No runs yet</b>
                      <small>Create one from the workflow.</small>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
