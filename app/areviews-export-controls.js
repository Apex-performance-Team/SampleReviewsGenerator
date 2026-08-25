"use client";

import { useEffect, useState } from "react";
import { areviewsToday } from "../lib/areviews-export.mjs";

export default function AreviewsExportControls({ onExport, disabled = false }) {
  const [today, setToday] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    const value = areviewsToday();
    setToday(value);
    setStartDate(value);
    setEndDate(value);
  }, []);

  const invalid = !startDate || !endDate || startDate > endDate;

  return (
    <div className="areviewsExport">
      <label>
        Areviews start
        <input
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
        Areviews end
        <input
          type="date"
          min={startDate}
          max={today}
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={disabled || invalid}
        onClick={() => onExport({ startDate, endDate })}
      >
        Export Areviews CSV
      </button>
    </div>
  );
}

