import assert from "node:assert/strict";
import test from "node:test";

import {
  answerConversationQuestion,
  applyConversationContext,
  isConversationContinuation,
  isStandalonePlaceQuestion,
} from "../lib/conversation.ts";

const context = {
  previousQuery: "האם היו הצפות בניו אורלינס?",
  previousAnswer: "אין ראיה מספקת לקבוע אם הייתה הצפה.",
  interpretation: {
    intent: "flood",
    intentLabel: "הצפה",
    locationText: "New Orleans, Louisiana, USA",
    dateLabel: "2023-08-15",
    startDate: "2023-08-10",
    endDate: "2023-08-20",
    requestedObjects: ["מים חדשים"],
    requestedOutput: ["תשובה מוסברת"],
  },
  location: {
    name: "New Orleans, Louisiana, USA",
    latitude: 29.9511,
    longitude: -90.0715,
    bbox: [-90.35, 29.75, -89.75, 30.18],
    source: "known-location",
    matchQuality: "exact",
    resultType: "curated-location",
  },
  sensors: ["Sentinel-2 MSI", "Sentinel-1 C-band SAR"],
  sceneCount: 8,
  eligibleSceneCount: 5,
  findingStatus: "indeterminate",
  feasibilityStatus: "conditional",
  model: {
    name: "Prithvi-EO-2.0 300M TL Sen1Floods11",
    status: "not-configured",
    realModelRun: false,
    detected: null,
    message: "לא הוגדרה כתובת שירות.",
  },
  limitations: ["אין פוליגון זיהוי מאומת."],
  clarification: null,
};

test("answers factual follow-up questions from verified prior context", () => {
  const sensor = answerConversationQuestion("באיזה לוויין השתמשת?", context);
  assert.equal(sensor?.kind, "answer");
  assert.match(sensor?.answer || "", /Sentinel-2 MSI/);
  assert.match(sensor?.answer || "", /מודל פיקסלים לא הופעל/);

  const location = answerConversationQuestion("איפה זה נמצא?", context);
  assert.match(location?.answer || "", /New Orleans/);
  assert.match(location?.answer || "", /29\.95110/);

  const result = answerConversationQuestion("מה מצאת שם?", context);
  assert.equal(result?.answer, context.previousAnswer);
});

test("answers context questions honestly when no prior analysis exists", () => {
  const answer = answerConversationQuestion("באיזה לוויין השתמשת?", null);
  assert.equal(answer?.contextUsed, false);
  assert.match(answer?.answer || "", /אין כרגע ניתוח קודם/);
});

test("distinguishes standalone place questions from contextual location questions", () => {
  assert.equal(isStandalonePlaceQuestion("איפה נמצאת מדריד?"), true);
  assert.equal(isStandalonePlaceQuestion("where is Barcelona?"), true);
  assert.equal(isStandalonePlaceQuestion("איפה זה נמצא?"), false);
  assert.equal(isStandalonePlaceQuestion("where is the area?"), false);
});

test("inherits prior mission context only for explicit continuations", () => {
  const blankInterpretation = {
    intent: "imagery",
    intentLabel: "איתור דימות",
    locationText: "",
    dateLabel: "45 הימים האחרונים",
    startDate: "2026-06-26",
    endDate: "2026-08-10",
    requestedObjects: [],
    requestedOutput: ["תשובה מוסברת"],
  };
  assert.equal(isConversationContinuation("ומה לגבי החודש הקודם?"), true);
  const inherited = applyConversationContext("ומה לגבי החודש הקודם?", blankInterpretation, context);
  assert.equal(inherited.interpreter.intent, "flood");
  assert.equal(inherited.interpreter.locationText, "New Orleans, Louisiana, USA");
  assert.equal(inherited.inheritedLocation?.name, "New Orleans, Louisiana, USA");

  const independent = applyConversationContext("מצא הצפות בפריז", blankInterpretation, context);
  assert.equal(independent.inheritedLocation, null);

  const explicitDate = {
    ...blankInterpretation,
    dateLabel: "השנה האחרונה",
    startDate: "2025-08-10",
    endDate: "2026-08-10",
  };
  const changedPeriod = applyConversationContext("ומה לגבי השנה האחרונה?", explicitDate, context);
  assert.equal(changedPeriod.interpreter.startDate, "2025-08-10");
  assert.equal(changedPeriod.interpreter.endDate, "2026-08-10");
});
