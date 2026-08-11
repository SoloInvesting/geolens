import type { AnalysisIntent, BrainRun, InterpreterResult } from "@/app/types";
import { isPlausibleLocationCandidate, parseCoordinatePair } from "@/lib/request-parser";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_FREE_MODEL = "openrouter/free";
const REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_DATE_LABEL = "45 הימים האחרונים";

const INTENTS: AnalysisIntent[] = [
  "flood",
  "wildfire",
  "volcano",
  "crop",
  "vessel",
  "building",
  "change",
  "imagery",
];

type PlannerPayload = {
  intent: AnalysisIntent;
  locationText: string;
  dateLabel: string;
  startDate: string;
  endDate: string;
  requestedObjects: string[];
  requestedOutput: string[];
};

type OpenRouterResponse = {
  model?: unknown;
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

function configuredApiKey() {
  return process.env.OPENROUTER_API_KEY?.trim() || process.env.openrouter?.trim() || null;
}

function intentLabel(intent: AnalysisIntent) {
  return {
    flood: "הצפה",
    wildfire: "שריפה וצלקת שריפה",
    volcano: "פעילות געשית",
    crop: "גידולים וצמחייה",
    vessel: "כלי שיט",
    building: "מבנים",
    change: "שינוי רב-זמני",
    imagery: "איתור דימות",
  }[intent];
}

function brainState(overrides: Partial<BrainRun> = {}): BrainRun {
  return {
    provider: "GeoLens",
    requestedModel: OPENROUTER_FREE_MODEL,
    actualModel: null,
    status: "fallback",
    freeOnly: true,
    message: "הבקשה פורשה באמצעות מנגנון הכללים המקומי.",
    ...overrides,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isSaneDateRange(startDate: unknown, endDate: unknown) {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return false;
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  const days = (end - start) / 86_400_000;
  return days >= 0 && days <= 3_660;
}

function cleanText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return "";
  const printable = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("");
  return printable.replace(/\s+/g, " ").trim().slice(0, maximumLength);
}

function cleanList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map((item) => cleanText(item, 100))
    .filter(Boolean)
    .slice(0, 8);
  return items.length ? items : fallback;
}

function messageContent(value: unknown) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .filter(isRecord)
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
}

function parsePlannerPayload(content: string): PlannerPayload | null {
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const value = JSON.parse(normalized) as unknown;
    if (!isRecord(value) || !INTENTS.includes(value.intent as AnalysisIntent)) return null;
    if (!isSaneDateRange(value.startDate, value.endDate)) return null;
    return {
      intent: value.intent as AnalysisIntent,
      locationText: cleanText(value.locationText, 160),
      dateLabel: cleanText(value.dateLabel, 80),
      startDate: value.startDate as string,
      endDate: value.endDate as string,
      requestedObjects: cleanList(value.requestedObjects, []),
      requestedOutput: cleanList(value.requestedOutput, []),
    };
  } catch {
    return null;
  }
}

function mergeInterpretation(fallback: InterpreterResult, planned: PlannerPayload): InterpreterResult {
  const intent = fallback.intent === "imagery" ? planned.intent : fallback.intent;
  const usePlannedDate = fallback.dateLabel === DEFAULT_DATE_LABEL;
  return {
    intent,
    intentLabel: intentLabel(intent),
    locationText: isPlausibleLocationCandidate(planned.locationText)
      ? planned.locationText
      : fallback.locationText,
    dateLabel: usePlannedDate ? planned.dateLabel || fallback.dateLabel : fallback.dateLabel,
    startDate: usePlannedDate ? planned.startDate : fallback.startDate,
    endDate: usePlannedDate ? planned.endDate : fallback.endDate,
    requestedObjects: cleanList(planned.requestedObjects, fallback.requestedObjects),
    requestedOutput: cleanList(planned.requestedOutput, fallback.requestedOutput),
  };
}

function plannerSchema() {
  return {
    name: "geolens_request_plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        intent: { type: "string", enum: INTENTS },
        locationText: { type: "string" },
        dateLabel: { type: "string" },
        startDate: { type: "string" },
        endDate: { type: "string" },
        requestedObjects: { type: "array", items: { type: "string" }, maxItems: 8 },
        requestedOutput: { type: "array", items: { type: "string" }, maxItems: 8 },
      },
      required: ["intent", "locationText", "dateLabel", "startDate", "endDate", "requestedObjects", "requestedOutput"],
    },
  };
}

export function localBrainState() {
  return brainState();
}

function needsOpenVocabularyPlanning(query: string, fallback: InterpreterResult) {
  if (fallback.intent !== "imagery") return false;
  return /(?:אתר|זהה|מצא|חפש|ספור|מנה|סמן)/u.test(query)
    || /\b(?:detect|identify|find|locate|count|segment|mark)\b/i.test(query);
}

export async function planWithOpenRouter(
  query: string,
  fallback: InterpreterResult,
  forceExternal = false,
  referenceDate = new Date().toISOString().slice(0, 10),
) {
  const localLocationIsComplete = Boolean(
    parseCoordinatePair(fallback.locationText)
    || isPlausibleLocationCandidate(fallback.locationText),
  );
  if (localLocationIsComplete && !forceExternal && !needsOpenVocabularyPlanning(query, fallback)) {
    return {
      interpretation: fallback,
      alternateLocationText: null,
      brain: brainState({
        requestedModel: "not-requested",
        status: "completed",
        message: "המקום, הזמן וסוג המשימה פוענחו באופן דטרמיניסטי. לא נשלחה בקשה למודל שפה חיצוני.",
      }),
    };
  }

  const apiKey = configuredApiKey();
  if (!apiKey) {
    return {
      interpretation: fallback,
      alternateLocationText: null,
      brain: brainState({
        status: "not-configured",
        message: "לא נמצא מפתח OpenRouter בצד השרת. הופעל מפענח מקומי ללא עלות.",
      }),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "HTTP-Referer": "https://geolens-agent.shaysolomon12.chatgpt.site",
        "X-Title": "GeoLens",
      },
      body: JSON.stringify({
        model: OPENROUTER_FREE_MODEL,
        temperature: 0,
        max_tokens: 650,
        response_format: {
          type: "json_schema",
          json_schema: plannerSchema(),
        },
        messages: [
          {
            role: "system",
            content: [
              "You are the request planner for an evidence-first Earth-observation application.",
              "Parse the request only. Never claim that an event or object was observed.",
              "Do not invent a location, date, satellite scene, measurement, or confidence score.",
              "Use intent=building as the existing open-vocabulary object route for user-named physical objects such as solar panels, wind turbines, aircraft, vehicles, bridges, roads, storage tanks, or construction sites, provided the request asks to detect, locate, count, or segment them.",
              "Use intent=imagery only when the user asks to retrieve or display imagery without detecting a target.",
              `Today is ${referenceDate}. Resolve relative dates against today.`,
              "Keep the supplied fallback dates when the request has no explicit temporal instruction.",
              `Validated fallback: ${JSON.stringify(fallback)}`,
            ].join(" "),
          },
          { role: "user", content: query },
        ],
      }),
    });

    if (!response.ok) {
      const reason = response.status === 429
        ? "המכסה או קצב הבקשות של המודלים החינמיים הוגבלו."
        : `OpenRouter החזיר שגיאה (${response.status}).`;
      return {
        interpretation: fallback,
        alternateLocationText: null,
        brain: brainState({ status: "fallback", message: `${reason} הופעל מפענח מקומי ללא חיוב.` }),
      };
    }

    const result = (await response.json()) as OpenRouterResponse;
    const actualModel = typeof result.model === "string" ? result.model : null;
    const content = messageContent(result.choices?.[0]?.message?.content);
    const planned = parsePlannerPayload(content);
    if (!planned) {
      return {
        interpretation: fallback,
        alternateLocationText: null,
        brain: brainState({
          provider: "OpenRouter",
          actualModel,
          status: "fallback",
          message: "המודל החינמי לא החזיר תכנית תקפה. הופעל מפענח מקומי ללא בקשה נוספת.",
        }),
      };
    }

    const interpretation = mergeInterpretation(fallback, planned);
    return {
      interpretation,
      alternateLocationText: planned.locationText && planned.locationText !== interpretation.locationText
        ? planned.locationText
        : null,
      brain: brainState({
        provider: "OpenRouter",
        actualModel,
        status: "completed",
        message: `הבקשה פורשה באמצעות ${actualModel || OPENROUTER_FREE_MODEL}. המסלול מוגבל למודלים חינמיים בלבד.`,
      }),
    };
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "AbortError"
      ? "המודל החינמי לא השיב בזמן."
      : "לא ניתן היה להגיע ל-OpenRouter.";
    return {
      interpretation: fallback,
      alternateLocationText: null,
      brain: brainState({ status: "fallback", message: `${reason} הופעל מפענח מקומי ללא חיוב.` }),
    };
  } finally {
    clearTimeout(timeout);
  }
}
