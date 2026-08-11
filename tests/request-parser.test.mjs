import assert from "node:assert/strict";
import test from "node:test";

import {
  extractLocationCandidate,
  isPlausibleLocationCandidate,
  parseCoordinatePair,
  parseDateRange,
} from "../lib/request-parser.ts";

const FIXED_NOW = new Date("2026-08-10T12:00:00Z");

test("parses Spain and the previous year from the reported Hebrew request", () => {
  const query = "תאתר שריפות בספרד בשנה האחרונה";

  assert.equal(extractLocationCandidate(query), "ספרד");
  assert.deepEqual(parseDateRange(query, FIXED_NOW), {
    startDate: "2025-08-10",
    endDate: "2026-08-10",
    dateLabel: "השנה האחרונה",
  });
});

test("stops Hebrew location extraction before common temporal qualifiers", () => {
  assert.equal(extractLocationCandidate("בדוק שריפות באזור ספרד בשנה החולפת"), "ספרד");
  assert.equal(extractLocationCandidate("בדוק שריפות בספרד בשנת 2024"), "ספרד");
  assert.equal(extractLocationCandidate("בדוק שריפות ליד מדריד בחודש האחרון"), "מדריד");
});

test("preserves multi-year parsing", () => {
  assert.deepEqual(parseDateRange("שריפות בספרד בחמש השנים האחרונות", FIXED_NOW), {
    startDate: "2021-08-10",
    endDate: "2026-08-10",
    dateLabel: "5 השנים האחרונות",
  });
});

test("extracts a location introduced by Hebrew 'of' and excludes the month", () => {
  assert.equal(extractLocationCandidate("הצג תמונת לוויין של מדריד באוגוסט 2024"), "מדריד");
  assert.equal(extractLocationCandidate("הצג תמונת לוויין של מדריד מאוגוסט 2024"), "מדריד");
  assert.equal(extractLocationCandidate("תמונת לוויין של אוגוסט 2024"), "");
});

test("uses an exact calendar month instead of an arbitrary window around mid-month", () => {
  assert.deepEqual(parseDateRange("הצג תמונת לוויין של מדריד באוגוסט 2024", FIXED_NOW), {
    startDate: "2024-08-01",
    endDate: "2024-08-31",
    dateLabel: "אוגוסט 2024",
  });
  assert.deepEqual(parseDateRange("show satellite imagery of Madrid in August 2024", FIXED_NOW), {
    startDate: "2024-08-01",
    endDate: "2024-08-31",
    dateLabel: "august 2024",
  });
});

test("parses common singular relative periods", () => {
  assert.deepEqual(parseDateRange("שריפות בספרד בחודש האחרון", FIXED_NOW), {
    startDate: "2026-07-10",
    endDate: "2026-08-10",
    dateLabel: "החודש האחרון",
  });
  assert.deepEqual(parseDateRange("שריפות בספרד בשבוע האחרון", FIXED_NOW), {
    startDate: "2026-08-03",
    endDate: "2026-08-10",
    dateLabel: "השבוע האחרון",
  });
});

test("parses Hebrew number words for relative periods", () => {
  assert.deepEqual(parseDateRange("בדוק הצפות בשלושת החודשים האחרונים", FIXED_NOW), {
    startDate: "2026-05-10",
    endDate: "2026-08-10",
    dateLabel: "3 החודשים האחרונים",
  });
  assert.deepEqual(parseDateRange("בדוק שריפות בשבועיים האחרונים", FIXED_NOW), {
    startDate: "2026-07-27",
    endDate: "2026-08-10",
    dateLabel: "2 השבועות האחרונים",
  });
});

test("parses today and yesterday in Hebrew and English", () => {
  assert.deepEqual(parseDateRange("בדוק הצפות במדריד אתמול", FIXED_NOW), {
    startDate: "2026-08-09",
    endDate: "2026-08-09",
    dateLabel: "אתמול",
  });
  assert.deepEqual(parseDateRange("show floods in Madrid today", FIXED_NOW), {
    startDate: "2026-08-10",
    endDate: "2026-08-10",
    dateLabel: "היום",
  });
});

test("extracts coordinates without sending them to a geocoder", () => {
  assert.deepEqual(parseCoordinatePair("40.4168, -3.7038"), {
    latitude: 40.4168,
    longitude: -3.7038,
  });
  assert.deepEqual(parseCoordinatePair("-118.2437 34.0522"), {
    latitude: 34.0522,
    longitude: -118.2437,
  });
  assert.equal(extractLocationCandidate("נתח הצפות ליד 40.4168,-3.7038 אתמול"), "40.4168, -3.7038");
  assert.equal(parseCoordinatePair("200, 95"), null);
});

test("rejects temporal and analysis terms as locations", () => {
  for (const value of ["אוגוסט", "בחודש האחרון", "satellite imagery", "2024", "שריפות"]) {
    assert.equal(isPlausibleLocationCandidate(value), false, value);
  }
  assert.equal(isPlausibleLocationCandidate("מדריד"), true);
  assert.equal(isPlausibleLocationCandidate("New Orleans"), true);
});

test("preserves explicit calendar dates", () => {
  assert.deepEqual(parseDateRange("בדוק שריפה במדריד ב-2024-08-15", FIXED_NOW), {
    startDate: "2024-08-10",
    endDate: "2024-08-20",
    dateLabel: "2024-08-15",
  });
  assert.deepEqual(parseDateRange("בדוק שריפה במדריד 15.08.2024", FIXED_NOW), {
    startDate: "2024-08-10",
    endDate: "2024-08-20",
    dateLabel: "2024-08-15",
  });
});
