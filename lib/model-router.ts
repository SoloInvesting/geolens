import type {
  AnalysisIntent,
  EventEvidence,
  FeasibilityReasonCode,
  GeoJsonGeometry,
  InterpreterResult,
  ModelRun,
  SceneResult,
} from "@/app/types";
import { tryMeasureGeometry } from "@/lib/gis";

type ResolvedLocation = {
  name: string;
  latitude: number;
  longitude: number;
  bbox: [number, number, number, number];
};

type ModelSpec = {
  id: string;
  version: string;
  name: string;
  task: string;
  provider: string;
  modelCardUrl: string | null;
  endpointEnv: string;
  inputRequirement: string;
  intents: AnalysisIntent[];
  requiredCollections?: Array<"sentinel-1" | "sentinel-2" | "hls">;
  requiredBands?: string[];
  minSceneCount?: number;
  maxResolutionMeters?: number;
};

export type RoutedModelRun = ModelRun & {
  reasonCodes: FeasibilityReasonCode[];
  errorCode: ModelExecutionErrorCode | null;
  runId: string | null;
  completedAt: string | null;
  backend: string | null;
};

export type ModelExecution = {
  model: RoutedModelRun;
  geometry: GeoJsonGeometry | null;
  confidence: number | null;
  summary: string;
  reasonCodes: FeasibilityReasonCode[];
  attempts: number;
  error?: ModelExecutionError;
  runId?: string;
  completedAt?: string;
  outcome?: "positive" | "negative" | "inconclusive";
};

export type ModelExecutionErrorCode =
  | "ENDPOINT_NOT_ALLOWED"
  | "HEALTHCHECK_FAILED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_NETWORK_ERROR"
  | "UPSTREAM_HTTP_ERROR"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_CONTENT_TYPE"
  | "INVALID_RESPONSE_JSON"
  | "INVALID_RESPONSE_CONTRACT"
  | "INVALID_RESPONSE_GEOMETRY";

export type ModelExecutionError = {
  code: ModelExecutionErrorCode;
  retryable: boolean;
  attempts: number;
  httpStatus?: number;
};

type InputBlocker = {
  message: string;
  reasonCode: FeasibilityReasonCode;
};

type EndpointValidation =
  | { ok: true; url: URL }
  | { ok: false; message: string };

type FetchFailure = {
  code: "UPSTREAM_TIMEOUT" | "UPSTREAM_NETWORK_ERROR";
  attempts: number;
};

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;
const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const MODEL_REGISTRY: ModelSpec[] = [
  {
    id: "prithvi-eo-2.0-sen1floods11",
    version: "2.0-300M",
    name: "Prithvi-EO-2.0 300M TL Sen1Floods11",
    task: "סגמנטציית הצפות",
    provider: "IBM / NASA Prithvi דרך שירות פענוח GeoLens",
    modelCardUrl: "https://huggingface.co/ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL-Sen1Floods11",
    endpointEnv: "GEO_MODEL_FLOOD_URL",
    inputRequirement: "Sentinel-2 L2A או HLS עם B02, B03, B04, B08A, B11 ו-B12. הפלט חייב להיות GeoJSON של מסכת ההצפה.",
    intents: ["flood"],
    requiredCollections: ["sentinel-2", "hls"],
    requiredBands: ["B02", "B03", "B04", "B08A", "B11", "B12"],
  },
  {
    id: "prithvi-eo-2.0-burnscars",
    version: "2.0-300M",
    name: "Prithvi-EO-2.0 300M BurnScars",
    task: "סגמנטציית צלקות שריפה וחומרה",
    provider: "IBM / NASA Prithvi דרך שירות פענוח GeoLens",
    modelCardUrl: "https://huggingface.co/ibm-nasa-geospatial/Prithvi-EO-2.0-300M-BurnScars",
    endpointEnv: "GEO_MODEL_BURNSCAR_URL",
    inputRequirement: "HLS L30/S30 עם B02, B03, B04, B08A, B11 ו-B12, או Sentinel-2 לאחר עיבוד תואם HLS מאומת בשירות. תמונת לפני משמשת להקשר, והפלט חייב להיות GeoJSON של אזור השריפה.",
    intents: ["wildfire"],
    requiredCollections: ["sentinel-2", "hls"],
    requiredBands: ["B02", "B03", "B04", "B08A", "B11", "B12"],
    minSceneCount: 2,
  },
  {
    id: "volcanic-hotspot-rf-s2",
    version: "research-contract/v1",
    name: "Volcanic Hotspot RF-S2",
    task: "סגמנטציית אנומליות תרמיות געשיות",
    provider: "GeoLens Volcano service, מודל Random Forest לאנומליות תרמיות",
    modelCardUrl: "https://www.mdpi.com/2072-4292/14/17/4370",
    endpointEnv: "GEO_MODEL_VOLCANO_URL",
    inputRequirement: "Sentinel-2 עם B04, B08, B11 ו-B12 באזור הר הגעש. השירות מחשב מאפיינים תרמיים ומחזיר GeoJSON של זרימה, מוקד חם או פלומה מזוהה.",
    intents: ["volcano"],
    requiredCollections: ["sentinel-2"],
    requiredBands: ["B04", "B08", "B11", "B12"],
  },
  {
    id: "grounding-dino-sam2-eo",
    version: "grounding-dino-tiny+sam2.1-hiera-small/v1",
    name: "Grounding DINO + SAM 2.1 EO",
    task: "הצעת אובייקטים פתוחה לפי טקסט וסגמנטציית מופעים",
    provider: "GeoLens Open Vocabulary service",
    modelCardUrl: "https://github.com/IDEA-Research/Grounded-SAM-2",
    endpointEnv: "GEO_MODEL_OPEN_VOCAB_URL",
    inputRequirement: "RGB COG אורתו ברזולוציה של עד 3 מטר לפיקסל. השירות חייב לבצע tiling, להחזיר GeoJSON ולהצהיר על גרסאות Grounding DINO ו-SAM 2.1. התוצאה היא הצעת מועמד עד אימות אנליסט.",
    intents: ["building"],
    maxResolutionMeters: 3,
  },
  {
    id: "xview3-vessel-s1",
    version: "xview3-second-place/public",
    name: "xView3 Sentinel-1 Vessel Detector",
    task: "איתור כלי שיט ב-SAR",
    provider: "GeoLens SAR service, based on the public xView3 pipeline",
    modelCardUrl: "https://github.com/DIUx-xView/xView3_second_place",
    endpointEnv: "GEO_MODEL_VESSEL_URL",
    inputRequirement: "Sentinel-1 GRD מכויל עם VV ו-VH, נרמול תואם xView3 ו-tiling. הפלט הוא נקודה או תיבה עם אומדן אורך, לא קונטור מדויק של גוף כלי השיט.",
    intents: ["vessel"],
    requiredCollections: ["sentinel-1"],
    requiredBands: ["VV", "VH"],
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function modelForIntent(intent: AnalysisIntent) {
  return MODEL_REGISTRY.find((model) => model.intents.includes(intent)) || null;
}

function configuredEndpoint(spec: ModelSpec) {
  return process.env[spec.endpointEnv]?.trim() || process.env.ANALYSIS_MODEL_URL?.trim() || null;
}

function configuredToken() {
  return process.env.GEO_MODEL_TOKEN?.trim() || process.env.ANALYSIS_MODEL_TOKEN?.trim() || null;
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  if (!value?.trim() || !/^\d+$/.test(value.trim())) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function inferenceTimeoutMs() {
  return boundedInteger(process.env.GEO_MODEL_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 250, 60_000);
}

function maximumAttempts() {
  return boundedInteger(process.env.GEO_MODEL_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1, 3);
}

function retryDelayMs() {
  return boundedInteger(process.env.GEO_MODEL_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS, 0, 2_000);
}

function maximumResponseBytes() {
  return boundedInteger(process.env.GEO_MODEL_MAX_RESPONSE_BYTES, DEFAULT_MAX_RESPONSE_BYTES, 1_024, 5_000_000);
}

function normalizedHostname(url: URL) {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function privateIpv4(hostname: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const parts = hostname.split(".").map(Number);
  if (parts.some((part) => part < 0 || part > 255)) return true;
  const [first, second] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

function privateIpv6(hostname: string) {
  if (!hostname.includes(":")) return false;
  const value = hostname.toLowerCase();
  return value === "::"
    || value === "::1"
    || value.startsWith("fc")
    || value.startsWith("fd")
    || /^fe[89ab]/.test(value)
    || value.startsWith("::ffff:127.")
    || value.startsWith("::ffff:10.")
    || value.startsWith("::ffff:192.168.");
}

function localDevelopmentHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function blockedHostname(hostname: string) {
  return hostname === "metadata.google.internal"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || privateIpv4(hostname)
    || privateIpv6(hostname);
}

function configuredAllowedOrigins() {
  const origins = new Set<string>();
  for (const raw of (process.env.GEO_MODEL_ALLOWED_ORIGINS || "").split(",")) {
    const candidate = raw.trim();
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (
        url.protocol !== "https:"
        || url.username
        || url.password
        || url.pathname !== "/"
        || url.search
        || url.hash
        || blockedHostname(normalizedHostname(url))
      ) {
        continue;
      }
      origins.add(url.origin);
    } catch {
      // Invalid entries are ignored. An empty effective allowlist fails closed.
    }
  }
  return origins;
}

function validateEndpoint(endpoint: string): EndpointValidation {
  try {
    const url = new URL(endpoint);
    const hostname = normalizedHostname(url);
    if (url.username || url.password || url.hash) {
      return { ok: false, message: "כתובת שירות המודל אינה יכולה לכלול פרטי התחברות או fragment." };
    }
    if (process.env.NODE_ENV !== "production" && localDevelopmentHost(hostname)) {
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { ok: false, message: "שירות פיתוח מקומי חייב להשתמש ב-HTTP או HTTPS." };
      }
      return { ok: true, url };
    }
    if (url.protocol !== "https:") {
      return { ok: false, message: "כתובת שירות המודל חייבת להשתמש ב-HTTPS." };
    }
    if (blockedHostname(hostname)) {
      return { ok: false, message: "כתובת שירות המודל מצביעה לרשת פרטית או לכתובת מערכת חסומה." };
    }
    if (!configuredAllowedOrigins().has(url.origin)) {
      return { ok: false, message: "מקור שירות המודל אינו מופיע ב-GEO_MODEL_ALLOWED_ORIGINS." };
    }
    return { ok: true, url };
  } catch {
    return { ok: false, message: "כתובת שירות המודל אינה כתובת URL תקפה." };
  }
}

function healthcheckUrl(endpoint: URL): URL | null {
  const path = process.env.GEO_MODEL_HEALTHCHECK_PATH?.trim();
  if (!path) return null;
  if (!path.startsWith("/") || path.startsWith("//") || path.length > 200 || path.includes("#")) return null;
  const url = new URL(path, endpoint.origin);
  return url.origin === endpoint.origin ? url : null;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
    || isRecord(error) && error.name === "AbortError";
}

function retryAfterMs(response: Response) {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Math.min(Number(value) * 1000, 2_000);
  const date = new Date(value).getTime();
  if (!Number.isFinite(date)) return null;
  return Math.min(Math.max(date - Date.now(), 0), 2_000);
}

function wait(milliseconds: number) {
  return milliseconds > 0 ? new Promise<void>((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();
}

async function fetchWithRetry(
  url: URL,
  init: RequestInit,
  options: { timeoutMs: number; maxAttempts: number },
): Promise<{ response: Response; attempts: number } | { failure: FetchFailure }> {
  let lastFailure: FetchFailure["code"] = "UPSTREAM_NETWORK_ERROR";
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const headers = new Headers(init.headers);
      headers.set("X-GeoLens-Attempt", String(attempt));
      const response = await fetch(url, {
        ...init,
        headers,
        redirect: "error",
        signal: controller.signal,
      });
      if (!RETRYABLE_HTTP_STATUS.has(response.status) || attempt === options.maxAttempts) {
        return { response, attempts: attempt };
      }
      const delay = retryAfterMs(response) ?? retryDelayMs() * attempt;
      await response.body?.cancel().catch(() => undefined);
      await wait(delay);
    } catch (error) {
      lastFailure = isAbortError(error) ? "UPSTREAM_TIMEOUT" : "UPSTREAM_NETWORK_ERROR";
      if (attempt === options.maxAttempts) return { failure: { code: lastFailure, attempts: attempt } };
      await wait(retryDelayMs() * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
  return { failure: { code: lastFailure, attempts: options.maxAttempts } };
}

async function readWithDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadline: number,
) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return { timeout: true as const };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      reader.read().then((value) => ({ timeout: false as const, value })),
      new Promise<{ timeout: true }>((resolve) => {
        timeout = setTimeout(() => resolve({ timeout: true }), remaining);
      }),
    ]);
    return result;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function responseTextWithinLimit(response: Response, byteLimit: number, timeoutMs: number) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > byteLimit) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false as const, reason: "too-large" as const };
  }
  if (!response.body) return { ok: true as const, text: "" };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let size = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await readWithDeadline(reader, deadline);
      if (chunk.timeout) {
        await reader.cancel().catch(() => undefined);
        return { ok: false as const, reason: "timeout" as const };
      }
      const { done, value } = chunk.value;
      if (done) break;
      size += value.byteLength;
      if (size > byteLimit) {
        await reader.cancel().catch(() => undefined);
        return { ok: false as const, reason: "too-large" as const };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true as const, text };
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false as const, reason: "network" as const };
  }
}

function metersPerPixel(scene: SceneResult) {
  if (scene.gsdMeters !== null && Number.isFinite(scene.gsdMeters) && scene.gsdMeters > 0) {
    return scene.gsdMeters;
  }
  const match = scene.resolution.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function sceneSupportsBands(scene: SceneResult, requiredBands: string[]) {
  const available = scene.assets.map((asset) => asset.label.toUpperCase());
  return requiredBands.every((band) => available.some((label) => label.includes(band)));
}

function eligibleScenes(spec: ModelSpec, scenes: SceneResult[]) {
  return scenes.filter((scene) => {
    if (scene.assetAccess !== "public-http" || !scene.assets.length) return false;
    if (spec.requiredCollections && !spec.requiredCollections.some((collection) => {
      if (collection === "hls") return scene.collection.toLowerCase().includes("hls");
      return scene.collection.toLowerCase().includes(collection);
    })) return false;
    if (spec.requiredBands && !sceneSupportsBands(scene, spec.requiredBands)) return false;
    if (spec.maxResolutionMeters !== undefined) {
      const resolution = metersPerPixel(scene);
      if (resolution === null || resolution > spec.maxResolutionMeters) return false;
    }
    return true;
  });
}

function hasExactAnalysisDate(interpreter: InterpreterResult) {
  return /^\d{4}-\d{2}-\d{2}$/.test(interpreter.dateLabel);
}

function analysisPivotTime(interpreter: InterpreterResult, events: EventEvidence[]) {
  const value = events[0]?.date || (hasExactAnalysisDate(interpreter) ? interpreter.dateLabel : null);
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function inputBlocker(
  spec: ModelSpec,
  scenes: SceneResult[],
  interpreter: InterpreterResult,
  events: EventEvidence[],
  location: ResolvedLocation,
): InputBlocker | null {
  const [west, south, east, north] = location.bbox;
  if (
    ![west, south, east, north, location.latitude, location.longitude].every(Number.isFinite)
    || west < -180
    || east > 180
    || south < -90
    || north > 90
    || west >= east
    || south >= north
    || location.longitude < west
    || location.longitude > east
    || location.latitude < south
    || location.latitude > north
  ) {
    return { message: "אזור המשימה אינו bbox גאוגרפי תקף.", reasonCode: "INVALID_AOI" };
  }
  const meanLatitudeRadians = ((south + north) / 2) * Math.PI / 180;
  const approximateAreaKm2 = Math.abs((east - west) * 111.32 * Math.cos(meanLatitudeRadians) * (north - south) * 110.57);
  if (approximateAreaKm2 > 150_000) {
    return {
      message: `אזור המשימה הוא כ-${Math.round(approximateAreaKm2).toLocaleString("he-IL")} קמ״ר. המודל לא יורץ על מספר סצנות חלקי שאינו מכסה את האזור כולו. יש לצמצם לעיר, מחוז או פוליגון ממוקד.`,
      reasonCode: "AOI_TOO_LARGE",
    };
  }
  if (spec.id === "prithvi-eo-2.0-burnscars" && !events.length && !hasExactAnalysisDate(interpreter)) {
    return {
      message: "לסגמנטציית צלקת שריפה נדרש תאריך אירוע מדויק או אירוע קטלוגי מאומת, כדי לבחור תמונת לפני ואחרי אמיתיות.",
      reasonCode: "EXACT_DATE_REQUIRED",
    };
  }
  if (spec.id === "volcanic-hotspot-rf-s2" && !events.length && !hasExactAnalysisDate(interpreter)) {
    return {
      message: "לפענוח געשי נדרש תאריך מדויק או אירוע קטלוגי מאומת, כדי להימנע מהפעלת המודל על חלון זמן שרירותי.",
      reasonCode: "EXACT_DATE_REQUIRED",
    };
  }
  if (!scenes.length) {
    return { message: "לא נמצאו סצנות מקור להפעלת המודל.", reasonCode: "NO_SCENES" };
  }
  const accessible = scenes.filter((scene) => scene.assetAccess === "public-http" && scene.assets.length > 0);
  if (!accessible.length) {
    return { message: "לסצנות שנמצאו אין נכסי קלט ציבוריים ונגישים למודל.", reasonCode: "ASSET_UNAVAILABLE" };
  }
  const collectionMatches = spec.requiredCollections
    ? accessible.filter((scene) => spec.requiredCollections!.some((collection) => {
        if (collection === "hls") return scene.collection.toLowerCase().includes("hls");
        return scene.collection.toLowerCase().includes(collection);
      }))
    : accessible;
  if (!collectionMatches.length) {
    return { message: "לא נמצאה סצנת מקור מהחיישן או האוסף שהמודל דורש.", reasonCode: "MISSING_SENSOR" };
  }
  const bandMatches = spec.requiredBands
    ? collectionMatches.filter((scene) => sceneSupportsBands(scene, spec.requiredBands!))
    : collectionMatches;
  if (!bandMatches.length) {
    return { message: "הסצנות אינן מכילות את כל הערוצים שהמודל דורש.", reasonCode: "MISSING_BANDS" };
  }
  const resolutionMatches = spec.maxResolutionMeters !== undefined
    ? bandMatches.filter((scene) => {
        const resolution = metersPerPixel(scene);
        return resolution !== null && resolution <= spec.maxResolutionMeters!;
      })
    : bandMatches;
  if (!resolutionMatches.length) {
    return {
      message: `המודל דורש דימות ברזולוציה של עד ${spec.maxResolutionMeters} מטר לפיקסל. הסצנות הזמינות אינן עומדות בסף הזה.`,
      reasonCode: "RESOLUTION_TOO_COARSE",
    };
  }
  const eligible = eligibleScenes(spec, scenes);
  if (eligible.length < (spec.minSceneCount || 1)) {
    return {
      message: `המודל דורש לפחות ${spec.minSceneCount} סצנות מתאימות, למשל תמונה לפני ותמונה אחרי האירוע.`,
      reasonCode: "INSUFFICIENT_SCENE_COUNT",
    };
  }
  if (spec.id === "prithvi-eo-2.0-burnscars") {
    const pivotTime = analysisPivotTime(interpreter, events);
    if (pivotTime !== null) {
      const hasBefore = eligible.some((scene) => new Date(scene.datetime).getTime() < pivotTime);
      const hasAfter = eligible.some((scene) => new Date(scene.datetime).getTime() >= pivotTime);
      if (!hasBefore || !hasAfter) {
        return {
          message: "מודל BurnScars דורש זוג סצנות אמיתי משני צדי תאריך האירוע.",
          reasonCode: "BASELINE_REQUIRED",
        };
      }
    }
  }
  return null;
}

function modelState(spec: ModelSpec | null, overrides: Partial<RoutedModelRun> = {}): RoutedModelRun {
  if (!spec) {
    return {
      id: null,
      name: "ללא מודל ייעודי",
      task: "איסוף ראיות ובחירת דימות",
      provider: "GeoLens",
      modelCardUrl: null,
      configured: false,
      status: "not-applicable",
      message: "למשימה הזו לא נבחר מודל סגמנטציה ייעודי.",
      inputRequirement: "אין",
      calibratedConfidence: false,
      version: null,
      detected: null,
      reasonCodes: [],
      errorCode: null,
      runId: null,
      completedAt: null,
      backend: null,
      ...overrides,
    };
  }

  return {
    id: spec.id,
    name: spec.name,
    task: spec.task,
    provider: spec.provider,
    modelCardUrl: spec.modelCardUrl,
    configured: Boolean(configuredEndpoint(spec)),
    status: "not-configured",
    message: `ממתין לחיבור שירות ${spec.name}.`,
    inputRequirement: spec.inputRequirement,
    calibratedConfidence: false,
    version: spec.version,
    detected: null,
    reasonCodes: [],
    errorCode: null,
    runId: null,
    completedAt: null,
    backend: null,
    ...overrides,
  };
}

function isFinitePosition(value: unknown): value is [number, number] {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === "number"
    && typeof value[1] === "number"
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && value[0] >= -180
    && value[0] <= 180
    && value[1] >= -90
    && value[1] <= 90;
}

function isValidRing(value: unknown) {
  if (!Array.isArray(value) || value.length < 4 || !value.every(isFinitePosition)) return false;
  const first = value[0] as [number, number];
  const last = value[value.length - 1] as [number, number];
  return first[0] === last[0] && first[1] === last[1];
}

function isValidPolygonCoordinates(value: unknown) {
  return Array.isArray(value) && value.length > 0 && value.every(isValidRing);
}

function isValidMultiPolygonCoordinates(value: unknown) {
  return Array.isArray(value) && value.length > 0 && value.every(isValidPolygonCoordinates);
}

function normalizeGeometry(value: unknown): GeoJsonGeometry | null {
  if (!isRecord(value)) return null;
  if (value.type === "Feature" && "geometry" in value) return normalizeGeometry(value.geometry);

  if (value.type === "Point" && isFinitePosition(value.coordinates)) {
    return { type: "Point", coordinates: value.coordinates };
  }
  if (value.type === "Polygon" && isValidPolygonCoordinates(value.coordinates)) {
    return { type: "Polygon", coordinates: value.coordinates };
  }
  if (value.type === "MultiPolygon" && isValidMultiPolygonCoordinates(value.coordinates)) {
    return { type: "MultiPolygon", coordinates: value.coordinates };
  }
  if (value.type === "FeatureCollection" && Array.isArray(value.features)) {
    if (!value.features.length || value.features.length > 10_000) return null;
    const features: Extract<GeoJsonGeometry, { type: "FeatureCollection" }>["features"] = [];
    for (const feature of value.features) {
      if (!isRecord(feature) || feature.type !== "Feature") return null;
      const geometry = normalizeGeometry(feature.geometry);
      if (!geometry || geometry.type === "FeatureCollection") return null;
      features.push({
        type: "Feature",
        geometry,
        properties: isRecord(feature.properties) ? feature.properties : undefined,
      });
    }
    return { type: "FeatureCollection", features };
  }
  return null;
}

type ValidatedInferenceResponse = {
  runId: string;
  modelVersion: string;
  backend: string;
  detected: boolean | null;
  outcome: "positive" | "negative" | "inconclusive";
  geometry: GeoJsonGeometry | null;
  confidence: number | null;
  confidenceCalibrated: boolean;
  summary: string;
  completedAt: string;
};

type ContractValidation =
  | { ok: true; value: ValidatedInferenceResponse }
  | {
      ok: false;
      errorCode: "INVALID_RESPONSE_CONTRACT" | "INVALID_RESPONSE_GEOMETRY";
      reasonCode: "MODEL_FAILED" | "INVALID_MODEL_GEOMETRY";
    };

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}

function nonEmptyString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength;
}

function uuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function timestamp(value: unknown) {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function validProvenanceScenes(
  spec: ModelSpec,
  sceneIds: unknown[],
  requestedScenes: Array<{ id: string; datetime: string }>,
  pivotTime: number | null,
) {
  const minimumSceneCount = Math.max(spec.minSceneCount ?? 1, 1);
  const requestedSceneIds = requestedScenes.map((scene) => scene.id);
  if (
    sceneIds.length < minimumSceneCount
    || sceneIds.length > 6
    || sceneIds.some((sceneId) => typeof sceneId !== "string" || !requestedSceneIds.includes(sceneId))
    || new Set(sceneIds).size !== sceneIds.length
  ) {
    return false;
  }
  if (spec.id !== "prithvi-eo-2.0-burnscars") return true;
  if (pivotTime === null) return false;
  const referencedScenes = requestedScenes.filter((scene) => sceneIds.includes(scene.id));
  return referencedScenes.some((scene) => new Date(scene.datetime).getTime() < pivotTime)
    && referencedScenes.some((scene) => new Date(scene.datetime).getTime() >= pivotTime);
}

function validateInferenceContract(
  value: unknown,
  headers: Headers,
  spec: ModelSpec,
  requestId: string,
  requestedScenes: Array<{ id: string; datetime: string }>,
  pivotTime: number | null,
): ContractValidation {
  if (!isRecord(value) || !exactKeys(value, [
    "contract",
    "requestId",
    "runId",
    "model",
    "detected",
    "outcome",
    "geometry",
    "confidence",
    "confidenceCalibrated",
    "summary",
    "warnings",
    "provenance",
  ])) {
    return { ok: false, errorCode: "INVALID_RESPONSE_CONTRACT", reasonCode: "MODEL_FAILED" };
  }
  if (
    value.contract !== "geolens-inference/v1"
    || headers.get("X-GeoLens-Contract") !== "geolens-inference/v1"
    || value.requestId !== requestId
    || !uuid(value.runId)
    || !isRecord(value.model)
    || !exactKeys(value.model, ["id", "version", "backend"])
    || value.model.id !== spec.id
    || !nonEmptyString(value.model.version, 128)
    || !nonEmptyString(value.model.backend, 128)
    || headers.get("X-GeoLens-Backend") !== value.model.backend
    || !isRecord(value.provenance)
    || !exactKeys(value.provenance, ["backend", "backendVersion", "modelId", "sceneIds", "startedAt", "completedAt"])
    || value.provenance.backend !== value.model.backend
    || !nonEmptyString(value.provenance.backendVersion, 128)
    || value.provenance.modelId !== spec.id
    || !Array.isArray(value.provenance.sceneIds)
    || !validProvenanceScenes(spec, value.provenance.sceneIds, requestedScenes, pivotTime)
  ) {
    return { ok: false, errorCode: "INVALID_RESPONSE_CONTRACT", reasonCode: "MODEL_FAILED" };
  }
  const startedAt = timestamp(value.provenance.startedAt);
  const completedAt = timestamp(value.provenance.completedAt);
  if (
    startedAt === null
    || completedAt === null
    || completedAt < startedAt
    || typeof value.provenance.completedAt !== "string"
    || !["positive", "negative", "inconclusive"].includes(String(value.outcome))
    || (value.detected !== true && value.detected !== false && value.detected !== null)
    || (value.confidence !== null
      && (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1))
    || typeof value.confidenceCalibrated !== "boolean"
    || (value.confidenceCalibrated && value.confidence === null)
    || !nonEmptyString(value.summary, 1_000)
    || !Array.isArray(value.warnings)
    || value.warnings.length > 50
    || value.warnings.some((warning) => typeof warning !== "string")
  ) {
    return { ok: false, errorCode: "INVALID_RESPONSE_CONTRACT", reasonCode: "MODEL_FAILED" };
  }

  const geometry = value.geometry === null ? null : normalizeGeometry(value.geometry);
  if (
    (value.detected === true && (value.outcome !== "positive" || !geometry || !tryMeasureGeometry(geometry)))
    || (value.detected === false && (value.outcome !== "negative" || value.geometry !== null))
    || (value.detected === null && (value.outcome !== "inconclusive" || value.geometry !== null))
  ) {
    return { ok: false, errorCode: "INVALID_RESPONSE_GEOMETRY", reasonCode: "INVALID_MODEL_GEOMETRY" };
  }

  return {
    ok: true,
    value: {
      runId: value.runId,
      modelVersion: value.model.version,
      backend: value.model.backend,
      detected: value.detected,
      outcome: value.outcome as ValidatedInferenceResponse["outcome"],
      geometry,
      confidence: value.confidence,
      confidenceCalibrated: value.confidenceCalibrated,
      summary: value.summary.trim().slice(0, 600),
      completedAt: value.provenance.completedAt,
    },
  };
}

async function readInferenceJson(response: Response): Promise<
  | { ok: true; value: unknown }
  | {
      ok: false;
      code: "RESPONSE_TOO_LARGE" | "INVALID_CONTENT_TYPE" | "INVALID_RESPONSE_JSON" | "UPSTREAM_TIMEOUT" | "UPSTREAM_NETWORK_ERROR";
    }
> {
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.includes("application/json") && !contentType.includes("+json")) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, code: "INVALID_CONTENT_TYPE" };
  }
  const body = await responseTextWithinLimit(response, maximumResponseBytes(), inferenceTimeoutMs());
  if (!body.ok) {
    const code = body.reason === "too-large"
      ? "RESPONSE_TOO_LARGE"
      : body.reason === "timeout"
        ? "UPSTREAM_TIMEOUT"
        : "UPSTREAM_NETWORK_ERROR";
    return { ok: false, code };
  }
  try {
    return { ok: true, value: JSON.parse(body.text) as unknown };
  } catch {
    return { ok: false, code: "INVALID_RESPONSE_JSON" };
  }
}

async function serviceIsHealthy(endpoint: URL, spec: ModelSpec, token: string | null) {
  const url = healthcheckUrl(endpoint);
  if (!process.env.GEO_MODEL_HEALTHCHECK_PATH?.trim()) {
    return { ok: true as const, attempts: 0 };
  }
  if (!url) {
    return { ok: false as const, attempts: 0, httpStatus: undefined };
  }
  const timeoutMs = boundedInteger(
    process.env.GEO_MODEL_HEALTH_TIMEOUT_MS,
    Math.min(inferenceTimeoutMs(), 5_000),
    250,
    10_000,
  );
  const result = await fetchWithRetry(url, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain;q=0.9",
      "X-GeoLens-Contract": "geolens-inference/v1",
      "X-GeoLens-Model": spec.id,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }, { timeoutMs, maxAttempts: 1 });
  if ("failure" in result) return { ok: false as const, attempts: result.failure.attempts, httpStatus: undefined };
  if (!result.response.ok) {
    await result.response.body?.cancel().catch(() => undefined);
    return { ok: false as const, attempts: result.attempts, httpStatus: result.response.status };
  }
  if (result.response.status === 204 || !result.response.body) {
    return { ok: true as const, attempts: result.attempts };
  }
  const body = await responseTextWithinLimit(result.response, 16_384, timeoutMs);
  if (!body.ok) return { ok: false as const, attempts: result.attempts, httpStatus: result.response.status };
  const text = body.text.trim();
  if (!text) return { ok: true as const, attempts: result.attempts };
  const contentType = result.response.headers.get("content-type")?.toLowerCase() || "";
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    try {
      const value = JSON.parse(text) as unknown;
      if (!isRecord(value)) return { ok: false as const, attempts: result.attempts, httpStatus: result.response.status };
      const status = typeof value.status === "string" ? value.status.toLowerCase() : "";
      const declaresGeoLensReadiness = "contract" in value
        || "inferenceEnabled" in value
        || "modelIds" in value
        || "backendVersion" in value
        || status === "validation-only"
        || status === "unavailable";
      const ready = declaresGeoLensReadiness
        ? value.contract === "geolens-inference/v1"
          && value.ready === true
          && status === "ready"
          && value.inferenceEnabled === true
          && Array.isArray(value.modelIds)
          && value.modelIds.every((modelId) => typeof modelId === "string")
          && value.modelIds.includes(spec.id)
        : value.ready === true
          || value.healthy === true
          || ["ok", "healthy", "ready", "live"].includes(status);
      return ready
        ? { ok: true as const, attempts: result.attempts }
        : { ok: false as const, attempts: result.attempts, httpStatus: result.response.status };
    } catch {
      return { ok: false as const, attempts: result.attempts, httpStatus: result.response.status };
    }
  }
  return ["ok", "healthy", "ready", "live"].includes(text.toLowerCase())
    ? { ok: true as const, attempts: result.attempts }
    : { ok: false as const, attempts: result.attempts, httpStatus: result.response.status };
}

function geometryOverlapsAoi(geometry: GeoJsonGeometry, bbox: [number, number, number, number]) {
  const measured = tryMeasureGeometry(geometry);
  if (!measured?.bbox) return false;
  const [west, south, east, north] = bbox;
  const longitudeMargin = Math.max((east - west) * 0.1, 0.02);
  const latitudeMargin = Math.max((north - south) * 0.1, 0.02);
  const [resultWest, resultSouth, resultEast, resultNorth] = measured.bbox;
  const overlaps = resultEast >= west - longitudeMargin
    && resultWest <= east + longitudeMargin
    && resultNorth >= south - latitudeMargin
    && resultSouth <= north + latitudeMargin;
  const aoiBoxArea = Math.max((east - west) * (north - south), 1e-9);
  const resultBoxArea = Math.max((resultEast - resultWest) * (resultNorth - resultSouth), 0);
  return overlaps && resultBoxArea <= aoiBoxArea * 25;
}

function compactScenes(scenes: SceneResult[]) {
  return scenes.slice(0, 6).map((scene) => ({
    id: scene.id,
    collection: scene.collection,
    datetime: scene.datetime,
    resolution: scene.resolution,
    bbox: scene.bbox,
    geometry: scene.geometry,
    stacUrl: scene.stacUrl,
    catalog: scene.catalog,
    assetAccess: scene.assetAccess,
    license: scene.license,
    assets: scene.assets,
  }));
}

export function selectedModel(intent: AnalysisIntent) {
  const spec = modelForIntent(intent);
  return modelState(spec);
}

export async function runDedicatedModel(input: {
  query: string;
  interpreter: InterpreterResult;
  location: ResolvedLocation;
  scenes: SceneResult[];
  events: EventEvidence[];
}): Promise<ModelExecution> {
  const spec = modelForIntent(input.interpreter.intent);
  if (!spec) {
    return {
      model: modelState(null),
      geometry: null,
      confidence: null,
      summary: "",
      reasonCodes: [],
      attempts: 0,
    };
  }

  const blocker = inputBlocker(spec, input.scenes, input.interpreter, input.events, input.location);
  if (blocker) {
    return {
      model: modelState(spec, {
        status: "blocked",
        message: blocker.message,
        reasonCodes: [blocker.reasonCode],
      }),
      geometry: null,
      confidence: null,
      summary: "",
      reasonCodes: [blocker.reasonCode],
      attempts: 0,
    };
  }

  const endpoint = configuredEndpoint(spec);
  if (!endpoint) {
    return {
      model: modelState(spec, {
        status: "not-configured",
        message: `המסלול ${spec.name} נבחר, אך לא הוגדרה כתובת שירות עבור ${spec.endpointEnv}.`,
        reasonCodes: ["MODEL_ENDPOINT_UNCONFIGURED"],
      }),
      geometry: null,
      confidence: null,
      summary: "",
      reasonCodes: ["MODEL_ENDPOINT_UNCONFIGURED"],
      attempts: 0,
    };
  }

  const endpointValidation = validateEndpoint(endpoint);
  if (!endpointValidation.ok) {
    return {
      model: modelState(spec, {
        status: "failed",
        message: endpointValidation.message,
        reasonCodes: ["MODEL_FAILED"],
        errorCode: "ENDPOINT_NOT_ALLOWED",
      }),
      geometry: null,
      confidence: null,
      summary: "",
      reasonCodes: ["MODEL_FAILED"],
      attempts: 0,
      error: {
        code: "ENDPOINT_NOT_ALLOWED",
        retryable: false,
        attempts: 0,
      },
    };
  }

  const token = configuredToken();
  const health = await serviceIsHealthy(endpointValidation.url, spec, token);
  if (!health.ok) {
    return {
      model: modelState(spec, {
        status: "failed",
        message: `בדיקת המוכנות של ${spec.name} נכשלה, ולכן לא נשלח אליו דימות.`,
        reasonCodes: ["MODEL_FAILED"],
        errorCode: "HEALTHCHECK_FAILED",
      }),
      geometry: null,
      confidence: null,
      summary: "",
      reasonCodes: ["MODEL_FAILED"],
      attempts: health.attempts,
      error: {
        code: "HEALTHCHECK_FAILED",
        retryable: true,
        attempts: health.attempts,
        ...(health.httpStatus !== undefined ? { httpStatus: health.httpStatus } : {}),
      },
    };
  }

  const requestId = crypto.randomUUID();
  const requestScenes = compactScenes(eligibleScenes(spec, input.scenes));
  const requestBody = JSON.stringify({
    requestId,
    model: {
      id: spec.id,
      version: spec.version,
      task: spec.task,
      modelCardUrl: spec.modelCardUrl,
    },
    query: input.query,
    intent: input.interpreter.intent,
    dateRange: {
      startDate: input.interpreter.startDate,
      endDate: input.interpreter.endDate,
    },
    requestedObjects: input.interpreter.requestedObjects,
    location: input.location,
    scenes: requestScenes,
  });
  const fetched = await fetchWithRetry(endpointValidation.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-GeoLens-Contract": "geolens-inference/v1",
      "X-GeoLens-Model": spec.id,
      "Idempotency-Key": requestId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: requestBody,
  }, {
    timeoutMs: inferenceTimeoutMs(),
    maxAttempts: maximumAttempts(),
  });

  if ("failure" in fetched) {
    const timedOut = fetched.failure.code === "UPSTREAM_TIMEOUT";
    return {
      model: modelState(spec, {
        status: "failed",
        message: timedOut
          ? `שירות ${spec.name} לא השיב בזמן שהוקצב לאחר ${fetched.failure.attempts} ניסיונות.`
          : `לא ניתן היה להגיע לשירות ${spec.name} לאחר ${fetched.failure.attempts} ניסיונות.`,
        reasonCodes: ["MODEL_FAILED"],
        errorCode: fetched.failure.code,
      }),
      geometry: null,
      confidence: null,
      summary: "",
      reasonCodes: ["MODEL_FAILED"],
      attempts: fetched.failure.attempts,
      error: {
        code: fetched.failure.code,
        retryable: true,
        attempts: fetched.failure.attempts,
      },
    };
  }

  const { response, attempts } = fetched;
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return {
      model: modelState(spec, {
        status: "failed",
        message: `שירות ${spec.name} החזיר שגיאה (${response.status}) לאחר ${attempts} ניסיונות.`,
        reasonCodes: ["MODEL_FAILED"],
        errorCode: "UPSTREAM_HTTP_ERROR",
      }),
      geometry: null,
      confidence: null,
      summary: "",
      reasonCodes: ["MODEL_FAILED"],
      attempts,
      error: {
        code: "UPSTREAM_HTTP_ERROR",
        retryable: RETRYABLE_HTTP_STATUS.has(response.status),
        attempts,
        httpStatus: response.status,
      },
    };
  }

  const parsed = await readInferenceJson(response);
  if (!parsed.ok) {
    const messages = {
      RESPONSE_TOO_LARGE: `שירות ${spec.name} החזיר תשובה גדולה מהמגבלה המותרת.`,
      INVALID_CONTENT_TYPE: `שירות ${spec.name} לא החזיר תוכן JSON.`,
      INVALID_RESPONSE_JSON: `שירות ${spec.name} החזיר JSON שאינו ניתן לפענוח.`,
      UPSTREAM_TIMEOUT: `קריאת התשובה של ${spec.name} חרגה ממגבלת הזמן.`,
      UPSTREAM_NETWORK_ERROR: `החיבור ל-${spec.name} נותק במהלך קריאת התשובה.`,
    } as const;
    return {
      model: modelState(spec, {
        status: "failed",
        message: messages[parsed.code],
        reasonCodes: ["MODEL_FAILED"],
        errorCode: parsed.code,
      }),
      geometry: null,
      confidence: null,
      summary: "",
      reasonCodes: ["MODEL_FAILED"],
      attempts,
      error: {
        code: parsed.code,
        retryable: parsed.code === "UPSTREAM_TIMEOUT" || parsed.code === "UPSTREAM_NETWORK_ERROR",
        attempts,
      },
    };
  }

  const contract = validateInferenceContract(
    parsed.value,
    response.headers,
    spec,
    requestId,
    requestScenes,
    analysisPivotTime(input.interpreter, input.events),
  );
  if (!contract.ok) {
    return {
      model: modelState(spec, {
        status: "failed",
        message: `שירות ${spec.name} החזיר תשובה שאינה תואמת לחוזה geolens-inference/v1.`,
        detected: contract.reasonCode === "INVALID_MODEL_GEOMETRY" ? true : null,
        reasonCodes: [contract.reasonCode],
        errorCode: contract.errorCode,
      }),
      geometry: null,
      confidence: null,
      summary: "",
      reasonCodes: [contract.reasonCode],
      attempts,
      error: {
        code: contract.errorCode,
        retryable: false,
        attempts,
      },
    };
  }

  const {
    runId,
    modelVersion,
    backend,
    detected,
    outcome,
    geometry,
    confidence,
    confidenceCalibrated,
    summary,
    completedAt,
  } = contract.value;

  if (detected === null && outcome === "inconclusive") {
    const reasonCodes: FeasibilityReasonCode[] = ["UNCALIBRATED_CONFIDENCE"];
    return {
      model: modelState(spec, {
        status: "completed",
        message: summary,
        calibratedConfidence: confidence !== null && confidenceCalibrated,
        detected: null,
        version: modelVersion,
        reasonCodes,
        runId,
        completedAt,
        backend,
      }),
      geometry: null,
      confidence,
      summary,
      reasonCodes,
      attempts,
      runId,
      completedAt,
      outcome: "inconclusive",
    };
  }

  if (detected === false) {
    const reasonCodes: FeasibilityReasonCode[] = confidence !== null && !confidenceCalibrated
      ? ["UNCALIBRATED_CONFIDENCE"]
      : [];
    return {
      model: modelState(spec, {
        status: "completed",
        message: summary || `${spec.name} השלים פענוח ולא החזיר ממצא בסצנות המתאימות.`,
        calibratedConfidence: confidence !== null && confidenceCalibrated,
        detected: false,
        version: modelVersion,
        reasonCodes,
        runId,
        completedAt,
        backend,
      }),
      geometry: null,
      confidence,
      summary,
      reasonCodes,
      attempts,
      runId,
      completedAt,
      outcome: "negative",
    };
  }

  if (detected !== true || outcome !== "positive" || !geometry || !geometryOverlapsAoi(geometry, input.location.bbox)) {
    return {
      model: modelState(spec, {
        status: "failed",
        message: `שירות ${spec.name} החזיר גאומטריה מחוץ לאזור המשימה או גדולה ממנו באופן חריג.`,
        detected: true,
        reasonCodes: ["INVALID_MODEL_GEOMETRY"],
        errorCode: "INVALID_RESPONSE_GEOMETRY",
      }),
      geometry: null,
      confidence: null,
      summary,
      reasonCodes: ["INVALID_MODEL_GEOMETRY"],
      attempts,
      error: {
        code: "INVALID_RESPONSE_GEOMETRY",
        retryable: false,
        attempts,
      },
    };
  }

  const reasonCodes: FeasibilityReasonCode[] = confidence !== null && !confidenceCalibrated
    ? ["UNCALIBRATED_CONFIDENCE"]
    : [];
  return {
    model: modelState(spec, {
      status: "completed",
      message: summary || `${spec.name} החזיר גאומטריית זיהוי תקפה.`,
      calibratedConfidence: confidence !== null && confidenceCalibrated,
      detected: true,
      version: modelVersion,
      reasonCodes,
      runId,
      completedAt,
      backend,
    }),
    geometry,
    confidence,
    summary,
    reasonCodes,
    attempts,
    runId,
    completedAt,
    outcome: "positive",
  };
}
