export type AnalysisIntent =
  | "flood"
  | "wildfire"
  | "volcano"
  | "crop"
  | "vessel"
  | "building"
  | "change"
  | "imagery";

export type ConfidenceLevel = "high" | "medium" | "low" | "not-assessed";

export type GeoJsonGeometry =
  | {
      type: "Polygon" | "MultiPolygon" | "Point";
      coordinates: unknown;
    }
  | {
      type: "FeatureCollection";
      features: Array<{
        type: "Feature";
        geometry: GeoJsonGeometry | null;
        properties?: Record<string, unknown>;
      }>;
    };

export type ModelExecutionStatus = "completed" | "not-configured" | "blocked" | "failed" | "not-applicable";

export type ModelRun = {
  id: string | null;
  name: string;
  task: string;
  provider: string;
  modelCardUrl: string | null;
  configured: boolean;
  status: ModelExecutionStatus;
  message: string;
  inputRequirement: string;
  calibratedConfidence: boolean;
};

export type BrainRun = {
  provider: "OpenRouter" | "GeoLens";
  requestedModel: "openrouter/free";
  actualModel: string | null;
  status: "completed" | "fallback" | "not-configured";
  freeOnly: true;
  message: string;
};

export type SceneResult = {
  id: string;
  collection: string;
  platform: string;
  instrument: string;
  datetime: string;
  cloudCover: number | null;
  resolution: string;
  thumbnailUrl: string | null;
  stacUrl: string;
  bbox: [number, number, number, number];
  geometry: GeoJsonGeometry | null;
  assets: Array<{ label: string; href: string }>;
  role: "primary" | "confirmation" | "context";
};

export type EventEvidence = {
  id: string;
  title: string;
  date: string;
  source: string;
  sourceUrl: string;
  coordinates: [number, number];
  type: "catalog-event" | "thermal-hotspot" | "model-detection";
};

export type AnalysisRecipe = {
  title: string;
  target: string;
  primarySensor: string;
  confirmationSensor: string;
  bands: string[];
  method: string[];
  minimumReliableScale: string;
  expectedOutput: string;
};

export type InterpreterResult = {
  intent: AnalysisIntent;
  intentLabel: string;
  locationText: string;
  dateLabel: string;
  startDate: string;
  endDate: string;
  requestedObjects: string[];
  requestedOutput: string[];
};

export type AgentStep = {
  id: string;
  label: string;
  detail: string;
  status: "completed" | "warning" | "blocked";
};

export type AnalysisResponse = {
  ok: boolean;
  query: string;
  interpretation: InterpreterResult;
  location: {
    name: string;
    latitude: number;
    longitude: number;
    bbox: [number, number, number, number];
  } | null;
  recipe: AnalysisRecipe;
  answer: string;
  verdict: string;
  confidence: ConfidenceLevel;
  confidenceScore: number;
  detectionMode: "catalog-confirmed" | "model-detected" | "source-only" | "not-feasible";
  scenes: SceneResult[];
  events: EventEvidence[];
  detectionGeometry: GeoJsonGeometry | null;
  steps: AgentStep[];
  limitations: string[];
  clarification: string | null;
  brain: BrainRun;
  model: ModelRun;
  generatedAt: string;
};
