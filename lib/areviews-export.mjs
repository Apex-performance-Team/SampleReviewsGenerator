import {
  AREVIEWS_FIRST_NAMES,
  AREVIEWS_LAST_NAMES,
} from "./areviews-names.mjs";

export const AREVIEWS_HEADERS = [
  "status",
  "rating",
  "email",
  "img",
  "username",
  "review",
  "date",
  "product title",
  "handle",
  "country",
];

const DAY_MS = 86400000;

function clean(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return clean(value || "product")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70) || "product";
}

function parseIsoDay(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const time = Date.UTC(year, month - 1, day);
  const parsed = new Date(time);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  )
    return null;
  return { text, time };
}

function isoDay(time) {
  return new Date(time).toISOString().slice(0, 10);
}

export function areviewsToday(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeAreviewsDateRange(
  { startDate, endDate } = {},
  today = areviewsToday(),
) {
  const maximum = parseIsoDay(today);
  const start = parseIsoDay(startDate || today);
  const end = parseIsoDay(endDate || today);
  if (!maximum || !start || !end)
    throw Error("Choose valid Areviews start and end dates.");
  if (start.time > end.time)
    throw Error("The Areviews start date must be on or before the end date.");
  if (end.time > maximum.time)
    throw Error("Areviews review dates cannot be after today.");
  return {
    startDate: start.text,
    endDate: end.text,
    startTime: start.time,
    endTime: end.time,
    dayCount: Math.floor((end.time - start.time) / DAY_MS) + 1,
  };
}

export function generateAreviewsDates(
  count,
  range,
  { random = Math.random, today } = {},
) {
  const normalized = normalizeAreviewsDateRange(range, today || areviewsToday());
  return Array.from({ length: Math.max(0, Number(count) || 0) }, () => {
    const offset = Math.floor(random() * normalized.dayCount);
    return isoDay(normalized.startTime + offset * DAY_MS);
  });
}

export function generateAreviewsNames(count, { random = Math.random } = {}) {
  const requested = Math.max(0, Number(count) || 0);
  const combinations = AREVIEWS_FIRST_NAMES.length * AREVIEWS_LAST_NAMES.length;
  if (requested > combinations)
    throw Error("The Areviews name pool is too small for this export.");
  const used = new Set();
  const names = [];
  let attempts = 0;
  while (names.length < requested && attempts < requested * 30 + 100) {
    attempts++;
    const first =
      AREVIEWS_FIRST_NAMES[
        Math.floor(random() * AREVIEWS_FIRST_NAMES.length)
      ];
    const last =
      AREVIEWS_LAST_NAMES[Math.floor(random() * AREVIEWS_LAST_NAMES.length)];
    const name = `${first} ${last}`;
    if (used.has(name)) continue;
    used.add(name);
    names.push(name);
  }
  for (let firstIndex = 0; names.length < requested; firstIndex++) {
    const first = AREVIEWS_FIRST_NAMES[firstIndex];
    for (const last of AREVIEWS_LAST_NAMES) {
      const name = `${first} ${last}`;
      if (used.has(name)) continue;
      used.add(name);
      names.push(name);
      if (names.length === requested) break;
    }
  }
  return names;
}

export function areviewsReviewText(title, body) {
  const heading = clean(title);
  const reviewBody = clean(body);
  if (!heading) return reviewBody;
  if (!reviewBody) return /[.!?]$/.test(heading) ? heading : `${heading}.`;
  const firstSentence = /[.!?]$/.test(heading) ? heading : `${heading}.`;
  return `${firstSentence} ${reviewBody}`;
}

export function productHandle(productUrl, fallback = "") {
  if (fallback) return clean(fallback);
  try {
    const pathname = new URL(productUrl).pathname;
    const match = pathname.match(/\/products\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]).trim() : "";
  } catch {
    return "";
  }
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function encode(rows) {
  return [
    AREVIEWS_HEADERS.join(","),
    ...rows.map((row) =>
      AREVIEWS_HEADERS.map((header) => csvCell(row[header])).join(","),
    ),
  ].join("\r\n");
}

function sourceRows(result) {
  const input = result?.input || {};
  const productTitle = result?.productTitle || input.productTitle || "";
  const productUrl = result?.productUrl || input.productUrl || "";
  const handle = productHandle(productUrl, result?.handle || input.handle || "");
  return (result?.reviews || []).map((review, index) => ({
    review,
    index,
    productTitle,
    handle,
  }));
}

function areviewsRows(rows, options = {}) {
  const names = generateAreviewsNames(rows.length, options);
  const dates = generateAreviewsDates(rows.length, options, options);
  return rows
    .map((row, index) => ({
      order: index,
      status: 1,
      rating: row.review?.rating ?? "",
      email: "",
      img: "",
      username: names[index],
      review: areviewsReviewText(row.review?.title, row.review?.body),
      date: dates[index],
      "product title": row.productTitle,
      handle: row.handle,
      country: "",
    }))
    .sort((left, right) =>
      left.date.localeCompare(right.date) || left.order - right.order,
    )
    .map(({ order, ...row }) => row);
}

export function areviewsReviewCsv(result, options = {}) {
  return encode(areviewsRows(sourceRows(result), options));
}

export function areviewsReviewBulkCsv(bulkResult, options = {}) {
  return encode(
    areviewsRows(
      (bulkResult?.products || []).flatMap((product) => sourceRows(product)),
      options,
    ),
  );
}

export function areviewsReviewFilename(result, { bulk = false } = {}) {
  const title = bulk
    ? "shopify-catalog"
    : result?.input?.productTitle || result?.productTitle || "product";
  return `areviews-${slug(title)}-${areviewsToday()}.csv`;
}

