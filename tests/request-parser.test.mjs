import assert from "node:assert/strict";
import test from "node:test";

import { extractLocationCandidate, parseDateRange } from "../lib/request-parser.ts";

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
