import type {
  ConversationAnswerResponse,
  ConversationContext,
  InterpreterResult,
} from "@/app/types";

const CONTINUATION_PATTERN = /(?:^|\s)(?:ומה\s+לגבי|מה\s+לגבי|ואיפה|ומה|גם|שם|באותו|אותו|אותה|הקודם|הקודמת|what\s+about|and\s+what|there|same|previous)(?:\s|[?.,]|$)/iu;

function normalizedQuery(query: string) {
  return query.replace(/\s+/g, " ").trim();
}

function contextualQuestionKind(query: string) {
  const normalized = normalizedQuery(query).toLowerCase();
  if (/(?:באיזה|איזה)\s+(?:לוויין|לווין|חיישן)|(?:באילו|איזה)\s+(?:לוויינים|חיישנים)|which\s+(?:satellite|sensor)|what\s+(?:satellite|sensor)/iu.test(normalized)) return "sensor";
  if (/(?:איזה|באיזה)\s+מודל|מה\s+המודל|האם\s+המודל|which\s+model|what\s+model/iu.test(normalized)) return "model";
  if (/^(?:איפה\s+(?:זה|המקום|האזור|האירוע)|מה\s+(?:המקום|המיקום|הקואורדינטות)|where\s+(?:is|was)\s+(?:it|the\s+(?:place|area|event)))/iu.test(normalized)) return "location";
  if (/(?:איזה|מה)\s+(?:תאריך|טווח|תקופה)|מתי\s+(?:זה|בדקת|צולם)|what\s+(?:date|period)|when\s+(?:was|did)/iu.test(normalized)) return "date";
  if (/(?:אילו|איזה|מה)\s+(?:מקורות|תמונות|סצנות)|מאיפה\s+(?:המידע|התמונות)|what\s+(?:sources|scenes|images)/iu.test(normalized)) return "sources";
  if (/(?:למה|מדוע)\s+(?:לא|זה)|מה\s+(?:הבעיה|חסר|המגבלות)|why\s+(?:didn'?t|not|can'?t)|what\s+(?:failed|is\s+missing|are\s+the\s+limitations)/iu.test(normalized)) return "limitations";
  if (/(?:מה\s+(?:מצאת|התוצאה|המסקנה)|האם\s+(?:מצאת|זיהית|איתרת)|תסביר\s+(?:את\s+)?(?:התוצאה|המסקנה)|what\s+did\s+you\s+find|what\s+is\s+the\s+(?:result|conclusion)|did\s+you\s+(?:find|detect))/iu.test(normalized)) return "result";
  return null;
}

function noPixelModelNote(context: ConversationContext) {
  return context.model.realModelRun
    ? "מודל הפיקסלים אכן הופעל על סצנות המקור."
    : "חשוב להבדיל בין סצנות שנמצאו בקטלוג לבין פענוח: מודל פיקסלים לא הופעל על התמונות האלה.";
}

export function answerConversationQuestion(
  query: string,
  context: ConversationContext | null,
): ConversationAnswerResponse | null {
  const kind = contextualQuestionKind(query);
  if (!kind) return null;
  if (!context) {
    return {
      kind: "answer",
      ok: true,
      answer: "אין כרגע ניתוח קודם שאפשר להתייחס אליו. כתוב מקום, זמן ומה תרצה לאתר, ולאחר הניתוח אוכל לענות על שאלות המשך לגבי החיישנים, המקורות, המודל והתוצאה.",
      location: null,
      contextUsed: false,
      generatedAt: new Date().toISOString(),
    };
  }

  let answer = "";
  if (kind === "sensor") {
    answer = context.sensors.length
      ? `בבקשה הקודמת נמצאו סצנות שצולמו באמצעות ${context.sensors.join(", ")}. ${noPixelModelNote(context)}`
      : `לא נמצאה סצנת מקור בבקשה הקודמת, ולכן אין חיישן לווייני שאפשר לייחס לניתוח. ${noPixelModelNote(context)}`;
  } else if (kind === "model") {
    answer = context.model.realModelRun
      ? `המודל שהופעל היה ${context.model.name}. סטטוס הריצה היה ${context.model.status}, ותוצאת הזיהוי שנרשמה היא ${context.model.detected === true ? "חיובית" : context.model.detected === false ? "שלילית" : "לא מכרעת"}.`
      : `המסלול בחר את ${context.model.name}, אבל לא בוצעה ריצת מודל אמיתית. ${context.model.message}`;
  } else if (kind === "location") {
    answer = context.location
      ? `הניתוח הקודם התייחס ל-${context.location.name}, סביב הקואורדינטות ${context.location.latitude.toFixed(5)}, ${context.location.longitude.toFixed(5)}.`
      : "לא נקבע מקום מאומת בבקשה הקודמת.";
  } else if (kind === "date") {
    answer = `הבקשה הקודמת נבדקה עבור ${context.interpretation.dateLabel}, בין ${context.interpretation.startDate} ל-${context.interpretation.endDate}.`;
  } else if (kind === "sources") {
    answer = context.sensors.length
      ? `נמצאו ${context.sceneCount} סצנות מקור, מהן ${context.eligibleSceneCount} כשירות למסלול הניתוח. החיישנים שנמצאו היו ${context.sensors.join(", ")}.`
      : "לא נמצאו סצנות מקור מתאימות בבקשה הקודמת.";
  } else if (kind === "limitations") {
    const details = [context.clarification, ...context.limitations].filter(Boolean).slice(0, 3);
    answer = details.length
      ? `הניתוח לא הושלם למסקנה ודאית מהסיבות הבאות: ${details.join(" ")}`
      : `לא נרשמה תקלה מפורטת, אבל מצב ההיתכנות היה ${context.feasibilityStatus} ומצב הממצא היה ${context.findingStatus}.`;
  } else {
    answer = context.previousAnswer;
  }

  return {
    kind: "answer",
    ok: true,
    answer,
    location: context.location,
    contextUsed: true,
    generatedAt: new Date().toISOString(),
  };
}

export function isStandalonePlaceQuestion(query: string) {
  return /^(?:איפה|היכן)\s+(?!(?:זה|המקום|האזור|האירוע)(?:\s|[?.,]|$))|^where\s+is\s+(?!(?:it|the\s+(?:place|area|event))(?:\s|[?.,]|$))/iu.test(normalizedQuery(query));
}

export function isConversationContinuation(query: string) {
  return CONTINUATION_PATTERN.test(normalizedQuery(query));
}

function hasExplicitTemporalReference(query: string) {
  return /(?:\b20\d{2}\b|\d{1,2}[./-]\d{1,2}[./-]20\d{2}|היום|אתמול|השנה|שנה\s+(?:האחרונה|החולפת)|חודש\s+(?:האחרון|החולף)|שבוע\s+(?:האחרון|החולף)|(?:in|during|for|over)\s+(?:the\s+)?last|today|yesterday|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b|(?:ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר))/iu.test(query);
}

export function applyConversationContext(
  query: string,
  interpreter: InterpreterResult,
  context: ConversationContext | null,
) {
  if (!context || !isConversationContinuation(query)) {
    return { interpreter, inheritedLocation: null as ConversationContext["location"] };
  }

  const inheritedIntent = interpreter.intent === "imagery" && context.interpretation.intent !== "imagery";
  const inheritedDate = interpreter.dateLabel === "45 הימים האחרונים" && !hasExplicitTemporalReference(query);
  const inheritedLocation = !interpreter.locationText && context.location ? context.location : null;
  const nextIntent = inheritedIntent ? context.interpretation.intent : interpreter.intent;
  return {
    interpreter: {
      ...interpreter,
      intent: nextIntent,
      intentLabel: inheritedIntent ? context.interpretation.intentLabel : interpreter.intentLabel,
      locationText: inheritedLocation ? context.interpretation.locationText : interpreter.locationText,
      dateLabel: inheritedDate ? context.interpretation.dateLabel : interpreter.dateLabel,
      startDate: inheritedDate ? context.interpretation.startDate : interpreter.startDate,
      endDate: inheritedDate ? context.interpretation.endDate : interpreter.endDate,
      requestedObjects: inheritedIntent && !interpreter.requestedObjects.length
        ? context.interpretation.requestedObjects
        : interpreter.requestedObjects,
    },
    inheritedLocation,
  };
}
