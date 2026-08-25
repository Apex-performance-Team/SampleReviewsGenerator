"use client";

import { useEffect, useState } from "react";
import {
  areviewsToday,
  normalizeAreviewsDateRange,
} from "../lib/areviews-export.mjs";

const STORAGE_KEY = "srl-areviews-date-range";

export default function AreviewsExportControls({
  onExport,
  disabled = false,
  showExport = true,
}) {
  const [today, setToday] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    const value = areviewsToday();
    let range = { startDate: value, endDate: value };
    try {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
      range = normalizeAreviewsDateRange(stored, value);
    } catch {}
    setToday(value);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  }, []);

  const invalid =
    !startDate ||
    !endDate ||
    startDate > endDate ||
    startDate > today ||
    endDate > today;

  useEffect(() => {
    if (!today || invalid) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ startDate, endDate }),
      );
    } catch {}
  }, [endDate, invalid, startDate, today]);

  return (
    <fieldset className="areviewsExport">
      <legend>Areviews export date range</legend>
      <p>
        Review dates are randomized inside this range. Days may be skipped, and
        multiple reviews may share a date.
      </p>
      <div className="areviewsExportFields">
        <label>
          Start date
          <input
            aria-label="Areviews start date"
            type="date"
            max={today}
            value={startDate}
            onChange={(event) => {
              const value = event.target.value;
              setStartDate(value);
              if (endDate && value > endDate) setEndDate(value);
            }}
          />
        </label>
        <label>
          End date
          <input
            aria-label="Areviews end date"
            type="date"
            min={startDate}
            max={today}
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>
        {showExport && (
          <button
            type="button"
            disabled={disabled || invalid}
            onClick={() => onExport?.({ startDate, endDate })}
          >
            {disabled ? "Available when complete" : "Export Areviews CSV"}
          </button>
        )}
      </div>
    </fieldset>
  );
}
