import assert from "node:assert/strict";
import test from "node:test";

import {
  extractLocationCandidate,
  inferIntentFromQuery,
  parseDateRange,
} from "../lib/request-parser.ts";

const FIXED_NOW = new Date("2026-08-10T12:00:00Z");

const relativeCases = [
  {
    query: "wildfires in Spain in the last year",
    location: "Spain",
    expected: { startDate: "2025-08-10", endDate: "2026-08-10", dateLabel: "השנה האחרונה" },
  },
  {
    query: "Madrid in the last month",
    location: "Madrid",
    expected: { startDate: "2026-07-10", endDate: "2026-08-10", dateLabel: "החודש האחרון" },
  },
  {
    query: "Madrid during the last week",
    location: "Madrid",
    expected: { startDate: "2026-08-03", endDate: "2026-08-10", dateLabel: "השבוע האחרון" },
  },
  {
    query: "Madrid for the last month",
    location: "Madrid",
    expected: { startDate: "2026-07-10", endDate: "2026-08-10", dateLabel: "החודש האחרון" },
  },
  {
    query: "קריית גת בשלושת החודשים האחרונים",
    location: "קריית גת",
    expected: { startDate: "2026-05-10", endDate: "2026-08-10", dateLabel: "3 החודשים האחרונים" },
  },
];

test("relative time phrases do not leak into location extraction", async (t) => {
  for (const item of relativeCases) {
    await t.test(item.query, () => {
      assert.equal(extractLocationCandidate(item.query), item.location);
      assert.deepEqual(parseDateRange(item.query, FIXED_NOW), item.expected);
    });
  }
});

const openVocabularyCases = [
  "detect solar panels in Madrid",
  "אתר פאנלים סולריים בבאר שבע",
  "find vehicles near Madrid",
  "זהה כלי רכב באזור חיפה",
  "detect aircraft at the airport",
  "מצא מטוסים ליד נתבג",
  "מצא מטוס ליד נתבג",
  "אתר רכב בחניון",
];

test("open-vocabulary object requests use the existing building route", () => {
  for (const query of openVocabularyCases) {
    assert.equal(inferIntentFromQuery(query), "building", query);
  }
});

test("specialist intents retain precedence over generic object words", () => {
  assert.equal(inferIntentFromQuery("map wildfire smoke over cars"), "wildfire");
  assert.equal(inferIntentFromQuery("detect vessels and nearby vehicles"), "vessel");
  assert.equal(inferIntentFromQuery("map flooding around parked vehicles"), "flood");
});
