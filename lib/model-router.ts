import type {
  AnalysisIntent,
  EventEvidence,
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

export type ModelExecution = {
  model: ModelRun;
  geometry: GeoJsonGeometry | null;
  confidence: number | null;
  summary: string;
  runId?: string;
  completedAt?: string;
  outcome?: "positive" | "negative" | "inconclusive";
};

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
    version: "proposal-pipeline/v1",
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

function validEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    if (url.protocol === "https:") return true;
    return process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function metersPerPixel(scene: SceneResult) {
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
      return scene.collection.includes(collection);
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

function inputBlocker(
  spec: ModelSpec,
  scenes: SceneResult[],
  interpreter: InterpreterResult,
  events: EventEvidence[],
  location: ResolvedLocation,
) {
  const [west, south, east, north] = location.bbox;
  const meanLatitudeRadians = ((south + north) / 2) * Math.PI / 180;
  const approximateAreaKm2 = Math.abs((east - west) * 111.32 * Math.cos(meanLatitudeRadians) * (north - south) * 110.57);
  if (approximateAreaKm2 > 150_000) {
    return `אזור המשימה הוא כ-${Math.round(approximateAreaKm2).toLocaleString("he-IL")} קמ״ר. המודל לא יורץ על מספר סצנות חלקי שאינו מכסה את האזור כולו. יש לצמצם לעיר, מחוז או פוליגון ממוקד.`;
  }
  if (spec.id === "prithvi-eo-2.0-burnscars" && !events.length && !hasExactAnalysisDate(interpreter)) {
    return "לסגמנטציית צלקת שריפה נדרש תאריך אירוע מדויק או אירוע קטלוגי מאומת, כדי לבחור תמונת לפני ואחרי אמיתיות.";
  }
  if (spec.id === "volcanic-hotspot-rf-s2" && !events.length && !hasExactAnalysisDate(interpreter)) {
    return "לפענוח געשי נדרש תאריך מדויק או אירוע קטלוגי מאומת, כדי להימנע מהפעלת המודל על חלון זמן שרירותי.";
  }
  const eligible = eligibleScenes(spec, scenes);
  if (spec.maxResolutionMeters !== undefined && !eligible.length) {
    return `המודל דורש דימות ברזולוציה של עד ${spec.maxResolutionMeters} מטר לפיקסל. הסצנות הזמינות אינן עומדות בסף הזה.`;
  }
  if (!eligible.length) return "לא נמצאה סצנת מקור שמכילה את החיישן והערוצים שהמודל דורש.";
  if (eligible.length < (spec.minSceneCount || 1)) {
    return `המודל דורש לפחות ${spec.minSceneCount} סצנות מתאימות, למשל תמונה לפני ותמונה אחרי האירוע.`;
  }
  if (spec.id === "prithvi-eo-2.0-burnscars") {
    const pivot = events[0]?.date || (hasExactAnalysisDate(interpreter) ? interpreter.dateLabel : null);
    if (pivot) {
      const pivotTime = new Date(pivot).getTime();
      const hasBefore = eligible.some((scene) => new Date(scene.datetime).getTime() < pivotTime);
      const hasAfter = eligible.some((scene) => new Date(scene.datetime).getTime() >= pivotTime);
      if (!hasBefore || !hasAfter) return "מודל BurnScars דורש זוג סצנות אמיתי משני צדי תאריך האירוע.";
    }
  }
  return null;
}

function modelState(spec: ModelSpec | null, overrides: Partial<ModelRun> = {}): ModelRun {
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
    if (value.features.length > 10_000) return null;
    const features = value.features
      .filter(isRecord)
      .map((feature) => ({
        type: "Feature" as const,
        geometry: normalizeGeometry(feature.geometry),
        properties: isRecord(feature.properties) ? feature.properties : undefined,
      }))
      .filter((feature) => feature.geometry);
    return features.length ? { type: "FeatureCollection", features } : null;
  }
  return null;
}

function responseGeometry(value: unknown) {
  if (!isRecord(value)) return null;
  return normalizeGeometry(value.geometry) || normalizeGeometry(value.detectionGeometry) || normalizeGeometry(value.result) || normalizeGeometry(value.featureCollection);
}

function responseConfidence(value: unknown) {
  if (!isRecord(value)) return null;
  const candidate = value.confidence ?? value.confidenceScore ?? value.score;
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) return null;
  if (candidate >= 0 && candidate <= 1) return candidate;
  if (candidate > 1 && candidate <= 100) return candidate / 100;
  return null;
}

function responseSummary(value: unknown) {
  if (!isRecord(value) || typeof value.summary !== "string") return "";
  return value.summary.trim().slice(0, 600);
}

function responseDetected(value: unknown) {
  if (!isRecord(value) || typeof value.detected !== "boolean") return null;
  return value.detected;
}

function responseConfidenceCalibrated(value: unknown) {
  return isRecord(value) && value.confidenceCalibrated === true;
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
  if (!spec) return { model: modelState(null), geometry: null, confidence: null, summary: "" };

  const blocker = inputBlocker(spec, input.scenes, input.interpreter, input.events, input.location);
  if (blocker) {
    return {
      model: modelState(spec, { status: "blocked", message: blocker }),
      geometry: null,
      confidence: null,
      summary: "",
    };
  }

  const endpoint = configuredEndpoint(spec);
  if (!endpoint) {
    return {
      model: modelState(spec, {
        status: "not-configured",
        message: `המסלול ${spec.name} נבחר, אך לא הוגדרה כתובת שירות עבור ${spec.endpointEnv}.`,
      }),
      geometry: null,
      confidence: null,
      summary: "",
    };
  }

  if (!validEndpoint(endpoint)) {
    return {
      model: modelState(spec, {
        status: "failed",
        message: "כתובת שירות המודל אינה כתובת HTTPS תקפה.",
      }),
      geometry: null,
      confidence: null,
      summary: "",
    };
  }

  const token = configuredToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  const requestId = crypto.randomUUID();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-GeoLens-Contract": "geolens-inference/v1",
        "X-GeoLens-Model": spec.id,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        requestId,
        model: {
          id: spec.id,
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
        scenes: compactScenes(eligibleScenes(spec, input.scenes)),
      }),
    });
    if (!response.ok) {
      return {
        model: modelState(spec, {
          status: "failed",
          message: `שירות ${spec.name} החזיר שגיאה (${response.status}).`,
        }),
        geometry: null,
        confidence: null,
        summary: "",
      };
    }

    const body = (await response.json()) as unknown;
    const geometry = responseGeometry(body);
    const confidence = responseConfidence(body);
    const summary = responseSummary(body);
    const detected = responseDetected(body);
    const confidenceCalibrated = responseConfidenceCalibrated(body);
    if (detected === false) {
      const completedAt = new Date().toISOString();
      return {
        model: modelState(spec, {
          status: "completed",
          message: summary || `${spec.name} השלים פענוח ולא החזיר ממצא בסצנות המתאימות.`,
          calibratedConfidence: confidence !== null && confidenceCalibrated,
          detected: false,
        }),
        geometry: null,
        confidence,
        summary,
        runId: requestId,
        completedAt,
        outcome: "negative",
      };
    }
    if (detected !== true) {
      return {
        model: modelState(spec, {
          status: "failed",
          message: `שירות ${spec.name} לא הצהיר detected=true או detected=false, ולכן התוצאה אינה קבילה.`,
        }),
        geometry: null,
        confidence: null,
        summary,
      };
    }
    if (!geometry) {
      return {
        model: modelState(spec, {
          status: "failed",
          message: `שירות ${spec.name} השיב ללא גאומטריית GeoJSON תקפה, ולכן התוצאה לא הוצגה כממצא.`,
        }),
        geometry: null,
        confidence: null,
        summary,
      };
    }
    if (!geometryOverlapsAoi(geometry, input.location.bbox)) {
      return {
        model: modelState(spec, {
          status: "failed",
          message: `שירות ${spec.name} החזיר גאומטריה מחוץ לאזור המשימה או גדולה ממנו באופן חריג.`,
        }),
        geometry: null,
        confidence: null,
        summary,
      };
    }

    const completedAt = new Date().toISOString();
    return {
      model: modelState(spec, {
        status: "completed",
        message: summary || `${spec.name} החזיר גאומטריית זיהוי תקפה.`,
        calibratedConfidence: confidence !== null && confidenceCalibrated,
        detected: true,
      }),
      geometry,
      confidence,
      summary,
      runId: requestId,
      completedAt,
      outcome: "positive",
    };
  } catch (error) {
    const message = error instanceof DOMException && error.name === "AbortError"
      ? `שירות ${spec.name} לא השיב בתוך 45 שניות.`
      : `לא ניתן היה להגיע לשירות ${spec.name}.`;
    return {
      model: modelState(spec, { status: "failed", message }),
      geometry: null,
      confidence: null,
      summary: "",
    };
  } finally {
    clearTimeout(timeout);
  }
}
