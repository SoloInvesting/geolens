import type {
  AnalysisIntent,
  EventEvidence,
  GeoJsonGeometry,
  InterpreterResult,
  ModelRun,
  SceneResult,
} from "@/app/types";

type ResolvedLocation = {
  name: string;
  latitude: number;
  longitude: number;
  bbox: [number, number, number, number];
};

type ModelSpec = {
  id: string;
  name: string;
  task: string;
  provider: string;
  modelCardUrl: string | null;
  endpointEnv: string;
  inputRequirement: string;
  intents: AnalysisIntent[];
  requiredCollection?: "sentinel-1" | "sentinel-2";
  requiredBands?: string[];
  minSceneCount?: number;
  maxResolutionMeters?: number;
};

type ModelExecution = {
  model: ModelRun;
  geometry: GeoJsonGeometry | null;
  confidence: number | null;
  summary: string;
};

const MODEL_REGISTRY: ModelSpec[] = [
  {
    id: "prithvi-eo-2.0-sen1floods11",
    name: "Prithvi-EO-2.0 300M TL Sen1Floods11",
    task: "סגמנטציית הצפות",
    provider: "IBM / NASA Prithvi דרך שירות פענוח GeoLens",
    modelCardUrl: "https://huggingface.co/ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL-Sen1Floods11",
    endpointEnv: "GEO_MODEL_FLOOD_URL",
    inputRequirement: "Sentinel-2 L2A או HLS עם B02, B03, B04, B08A, B11 ו-B12. הפלט חייב להיות GeoJSON של מסכת ההצפה.",
    intents: ["flood"],
    requiredCollection: "sentinel-2",
    requiredBands: ["B02", "B03", "B04", "B08A", "B11", "B12"],
  },
  {
    id: "prithvi-eo-2.0-burnscars",
    name: "Prithvi-EO-2.0 300M BurnScars",
    task: "סגמנטציית צלקות שריפה וחומרה",
    provider: "IBM / NASA Prithvi דרך שירות פענוח GeoLens",
    modelCardUrl: "https://huggingface.co/ibm-nasa-geospatial/Prithvi-EO-2.0-300M-BurnScars",
    endpointEnv: "GEO_MODEL_BURNSCAR_URL",
    inputRequirement: "HLS L30/S30 עם B02, B03, B04, B08A, B11 ו-B12, או Sentinel-2 לאחר עיבוד תואם HLS מאומת בשירות. תמונת לפני משמשת להקשר, והפלט חייב להיות GeoJSON של אזור השריפה.",
    intents: ["wildfire"],
    requiredCollection: "sentinel-2",
    requiredBands: ["B02", "B03", "B04", "B08A", "B11", "B12"],
  },
  {
    id: "volcanic-hotspot-rf-s2",
    name: "Volcanic Hotspot RF-S2",
    task: "סגמנטציית אנומליות תרמיות געשיות",
    provider: "GeoLens Volcano service, מודל Random Forest לאנומליות תרמיות",
    modelCardUrl: "https://www.mdpi.com/2072-4292/14/17/4370",
    endpointEnv: "GEO_MODEL_VOLCANO_URL",
    inputRequirement: "Sentinel-2 עם B04, B08, B11 ו-B12 באזור הר הגעש. השירות מחשב מאפיינים תרמיים ומחזיר GeoJSON של זרימה, מוקד חם או פלומה מזוהה.",
    intents: ["volcano"],
    requiredCollection: "sentinel-2",
    requiredBands: ["B04", "B08", "B11", "B12"],
  },
  {
    id: "yolo-obb-geospatial",
    name: "YOLO OBB Geospatial",
    task: "זיהוי אובייקטים עם תיבות מסובבות ופוליגונים",
    provider: "GeoLens Object Detection service",
    modelCardUrl: "https://docs.ultralytics.com/tasks/obb/",
    endpointEnv: "GEO_MODEL_OBJECT_URL",
    inputRequirement: "דימות RGB אורתו ברזולוציה של עד 3 מטר לפיקסל. הפלט חייב להיות GeoJSON של תיבות מסובבות או פוליגוני אובייקטים.",
    intents: ["building", "vessel"],
    maxResolutionMeters: 3,
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
    if (spec.requiredCollection && !scene.collection.includes(spec.requiredCollection)) return false;
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
) {
  if (spec.id === "prithvi-eo-2.0-burnscars" && !events.length && !hasExactAnalysisDate(interpreter)) {
    return "לסגמנטציית צלקת שריפה נדרש תאריך אירוע מדויק או אירוע קטלוגי מאומת, כדי לבחור תמונת לפני ואחרי אמיתיות.";
  }
  if (spec.id === "volcano-thermal-s2" && !events.length && !hasExactAnalysisDate(interpreter)) {
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
    ...overrides,
  };
}

function isFinitePosition(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate));
}

function isValidRing(value: unknown) {
  return Array.isArray(value) && value.length >= 4 && value.every(isFinitePosition);
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

function compactScenes(scenes: SceneResult[]) {
  return scenes.slice(0, 6).map((scene) => ({
    id: scene.id,
    collection: scene.collection,
    datetime: scene.datetime,
    resolution: scene.resolution,
    bbox: scene.bbox,
    geometry: scene.geometry,
    stacUrl: scene.stacUrl,
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

  const blocker = inputBlocker(spec, input.scenes, input.interpreter, input.events);
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

    return {
      model: modelState(spec, {
        status: "completed",
        message: summary || `${spec.name} החזיר גאומטריית זיהוי תקפה.`,
        calibratedConfidence: confidence !== null,
      }),
      geometry,
      confidence,
      summary,
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
