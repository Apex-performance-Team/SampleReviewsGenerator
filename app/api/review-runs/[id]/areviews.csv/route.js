export const runtime = "nodejs";

import { areviewsCsvForRun } from "../../../../../lib/review-run-engine.mjs";
import { getRun } from "../../../../../lib/review-run-store.mjs";

function slug(value) {
  return (
    String(value || "product")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70) || "product"
  );
}

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const run = await getRun(id);
    if (run.status !== "completed")
      return new Response("Run is not completed yet.", {
        status: 409,
        headers: { "cache-control": "no-store" },
      });
    const search = new URL(req.url).searchParams;
    const csv = areviewsCsvForRun(run, {
      startDate: search.get("startDate") || "",
      endDate: search.get("endDate") || "",
    });
    return new Response(csv, {
      headers: {
        "content-type": "text/csv;charset=utf-8",
        "content-disposition": `attachment; filename="areviews-${slug(run.product_title)}-${run.id.slice(0, 8)}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = error.message || "Areviews CSV export failed.";
    const status = /date|after today|start date/i.test(message) ? 400 : 404;
    return new Response(message, {
      status,
      headers: { "cache-control": "no-store" },
    });
  }
}

