import assert from "node:assert/strict";
import {
  AREVIEWS_HEADERS,
  areviewsReviewBulkCsv,
  areviewsReviewCsv,
  areviewsReviewText,
  generateAreviewsDates,
  generateAreviewsNames,
  normalizeAreviewsDateRange,
  productHandle,
} from "../lib/areviews-export.mjs";
import {
  AREVIEWS_FIRST_NAMES,
  AREVIEWS_LAST_NAMES,
} from "../lib/areviews-names.mjs";

function randomSequence(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

assert.equal(AREVIEWS_FIRST_NAMES.length, 2000);
assert.equal(new Set(AREVIEWS_FIRST_NAMES).size, 1915);
assert.equal(AREVIEWS_LAST_NAMES.length, 1000);
assert.equal(new Set(AREVIEWS_LAST_NAMES).size, 1000);
assert.deepEqual(
  normalizeAreviewsDateRange(
    { startDate: "2026-08-20", endDate: "2026-08-25" },
    "2026-08-25",
  ),
  {
    startDate: "2026-08-20",
    endDate: "2026-08-25",
    startTime: Date.UTC(2026, 7, 20),
    endTime: Date.UTC(2026, 7, 25),
    dayCount: 6,
  },
);
assert.throws(
  () =>
    normalizeAreviewsDateRange(
      { startDate: "2026-08-26", endDate: "2026-08-25" },
      "2026-08-25",
    ),
  /start date/,
);
assert.throws(
  () =>
    normalizeAreviewsDateRange(
      { startDate: "2026-08-25", endDate: "2026-08-26" },
      "2026-08-25",
    ),
  /after today/,
);

const dates = generateAreviewsDates(
  5,
  { startDate: "2026-08-20", endDate: "2026-08-25" },
  {
    today: "2026-08-25",
    random: randomSequence([0, 0, 0.4, 0.4, 0.99]),
  },
);
assert.deepEqual(dates, [
  "2026-08-20",
  "2026-08-20",
  "2026-08-22",
  "2026-08-22",
  "2026-08-25",
]);
assert.equal(new Set(dates).size, 3, "Repeated dates and skipped days must be possible.");
assert.deepEqual(
  generateAreviewsDates(
    3,
    { startDate: "2026-08-25", endDate: "2026-08-25" },
    { today: "2026-08-25", random: () => 0.75 },
  ),
  ["2026-08-25", "2026-08-25", "2026-08-25"],
);

assert.equal(
  areviewsReviewText("Solid value", "  Easy   to install.\nWorks well. "),
  "Solid value. Easy to install. Works well.",
);
assert.equal(
  areviewsReviewText("Worth it!", "I would buy it again."),
  "Worth it! I would buy it again.",
);
assert.equal(
  productHandle("https://example.com/products/black-telescopic?variant=1"),
  "black-telescopic",
);

const uniqueNames = generateAreviewsNames(600, {
  random: randomSequence([0.1, 0.2, 0.7, 0.9, 0.33, 0.66, 0.45, 0.85]),
});
assert.equal(uniqueNames.length, 600);
assert.equal(new Set(uniqueNames).size, 600);

const result = {
  input: {
    productTitle: "Heavy-Duty Black Telescopic Flagpole",
    productUrl: "https://flagpole.example/products/black-telescopic",
  },
  reviews: [
    { rating: 5, title: "Solid value", body: "Easy to install, and sturdy." },
    { rating: 4, title: "Works well!", body: "Looks good in the yard." },
  ],
};
const csv = areviewsReviewCsv(result, {
  startDate: "2026-08-20",
  endDate: "2026-08-25",
  today: "2026-08-25",
  random: randomSequence([0.1, 0.2, 0.7, 0.9, 0, 0.99]),
});
assert.ok(!csv.startsWith("\ufeff"), "Areviews CSV should match the sample without a BOM.");
assert.ok(csv.includes("\r\n"));
const rows = parseCsv(csv);
assert.deepEqual(rows[0], AREVIEWS_HEADERS);
assert.equal(rows.length, 3);
for (const row of rows) assert.equal(row.length, 10);
assert.equal(rows[1][0], "1");
assert.equal(rows[1][2], "");
assert.equal(rows[1][3], "");
assert.match(rows[1][4], /^[A-Za-zÀ-ÖØ-öø-ÿ’'-]+ [A-Za-zÀ-ÖØ-öø-ÿ’'-]+$/);
assert.ok(!/[\r\n]/.test(rows[1][5]));
assert.equal(rows[1][7], "Heavy-Duty Black Telescopic Flagpole");
assert.equal(rows[1][8], "black-telescopic");
assert.equal(rows[1][9], "");

const bulk = parseCsv(
  areviewsReviewBulkCsv(
    {
      products: [
        result,
        {
          productTitle: "Second Product",
          productUrl: "https://flagpole.example/products/second-product",
          reviews: [{ rating: 5, title: "Great", body: "Does the job." }],
        },
      ],
    },
    {
      startDate: "2026-08-25",
      endDate: "2026-08-25",
      today: "2026-08-25",
      random: randomSequence([0.12, 0.24, 0.36, 0.48]),
    },
  ),
);
assert.equal(bulk.length, 4);
assert.deepEqual(new Set(bulk.slice(1).map((row) => row[7])), new Set([
  "Heavy-Duty Black Telescopic Flagpole",
  "Second Product",
]));

const bulkShuffledDates = parseCsv(
  areviewsReviewBulkCsv(
    {
      products: [
        {
          productTitle: "Product A",
          productUrl: "https://example.com/products/a",
          reviews: [{ rating: 5, title: "A", body: "First review." }],
        },
        {
          productTitle: "Product B",
          productUrl: "https://example.com/products/b",
          reviews: [{ rating: 5, title: "B", body: "Second review." }],
        },
        {
          productTitle: "Product C",
          productUrl: "https://example.com/products/c",
          reviews: [{ rating: 5, title: "C", body: "Third review." }],
        },
        {
          productTitle: "Product D",
          productUrl: "https://example.com/products/d",
          reviews: [{ rating: 5, title: "D", body: "Fourth review." }],
        },
      ],
    },
    {
      startDate: "2026-08-20",
      endDate: "2026-08-25",
      today: "2026-08-25",
      random: randomSequence([
        0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08,
        0, 0.2, 0.4, 0.99,
        0, 0, 0,
      ]),
    },
  ),
);
const emittedDates = bulkShuffledDates.slice(1).map((row) => row[6]);
assert.notDeepEqual(
  emittedDates,
  [...emittedDates].sort(),
  "Bulk Areviews exports should not expose a chronological date sort across mixed SKUs.",
);

console.log("Areviews export self-test passed.");
