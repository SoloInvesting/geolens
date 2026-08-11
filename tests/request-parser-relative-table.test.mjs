import assert from "node:assert/strict";
import test from "node:test";

import {
  extractOpenVocabularyObjects,
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
  "מצא גגות אדומים במדריד",
  "find blue roofs in Madrid",
];

test("open-vocabulary object requests use the existing building route", () => {
  for (const query of openVocabularyCases) {
    assert.equal(inferIntentFromQuery(query), "building", query);
  }
});

const extractedObjectCases = [
  {
    query: "זהה כלי רכב באזור חיפה",
    expected: ["vehicle"],
  },
  {
    query: "אתר משאיות כחולות באזור חיפה",
    expected: ["blue truck"],
  },
  {
    query: "מצא מבנים עם גג אדום במדריד",
    expected: ["red roof", "building"],
  },
  {
    query: "find blue-roof buildings in Madrid",
    expected: ["blue roof", "building"],
  },
  {
    query: "find red cars in Madrid",
    expected: ["red car"],
  },
  {
    query: "מצא גגות אדומים וכחולים במדריד",
    expected: ["red roof", "blue roof"],
  },
  {
    query: "מצא מכוניות בבית שמש",
    expected: ["car"],
  },
];

test("open-vocabulary targets preserve object classes and colour attributes", async (t) => {
  for (const item of extractedObjectCases) {
    await t.test(item.query, () => {
      assert.deepEqual(extractOpenVocabularyObjects(item.query), item.expected);
    });
  }
});

test("specialist intents retain precedence over generic object words", () => {
  assert.equal(inferIntentFromQuery("map wildfire smoke over cars"), "wildfire");
  assert.equal(inferIntentFromQuery("detect vessels and nearby vehicles"), "vessel");
  assert.equal(inferIntentFromQuery("map flooding around parked vehicles"), "flood");
});

test("Hebrew word fragments do not create false open-vocabulary targets", () => {
  assert.deepEqual(extractOpenVocabularyObjects("הצג תמונה של רכבת במדריד"), []);
});
