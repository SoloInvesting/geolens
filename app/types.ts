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

export type FindingStatus = "detected" | "not-detected" | "indeterminate";
export type FeasibilityStatus = "feasible" | "conditional" | "blocked";

export type FeasibilityReasonCode =
  | "LOCATION_UNRESOLVED"
  | "INVALID_AOI"
  | "AOI_TOO_LARGE"
  | "EXACT_DATE_REQUIRED"
  | "BASELINE_REQUIRED"
  | "NO_SCENES"
  | "CATALOG_UNAVAILABLE"
  | "MISSING_SENSOR"
  | "MISSING_BANDS"
  | "INSUFFICIENT_SCENE_COUNT"
  | "INSUFFICIENT_INDEPENDENT_SOURCES"
  | "RESOLUTION_TOO_COARSE"
  | "CLOUD_COVER_TOO_HIGH"
  | "ASSET_UNAVAILABLE"
  | "MODEL_ENDPOINT_UNCONFIGURED"
  | "MODEL_FAILED"
  | "INVALID_MODEL_GEOMETRY"
  | "UNCALIBRATED_CONFIDENCE";

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
  version: string | null;
  detected: boolean | null;
  reasonCodes?: FeasibilityReasonCode[];
  errorCode?: string | null;
  runId?: string | null;
  completedAt?: string | null;
  backend?: string | null;
};

export type BrainRun = {
  provider: "OpenRouter" | "GeoLens";
  requestedModel: "openrouter/free" | "not-requested";
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
  catalog: "Copernicus Data Space" | "Element 84 Earth Search" | "NASA CMR" | string;
  canonicalSceneId: string;
  gsdMeters: number | null;
  qualityScore: number;
  selectionReason: string;
  assetAccess: "public-http" | "requester-pays" | "authentication-required" | "metadata-only";
  license: LicenseProvenance;
};

export type LicenseProvenance = {
  licenseId: string;
  commercialUse: boolean | null;
  redistribution: boolean | null;
  attributionRequired: boolean | null;
  sourceProvider: string;
  sourceItemId: string;
  termsUrl: string;
  note: string;
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

export type MissionSpec = {
  version: "geolens-mission/v1";
  missionId: string;
  targetConcept: string;
  intent: AnalysisIntent;
  requestedObjects: string[];
  aoi: {
    label: string;
    bbox: [number, number, number, number];
    geometry: GeoJsonGeometry;
    source: "validated-geocoder" | "known-location" | "coordinates";
  };
  temporal: {
    startDate: string;
    endDate: string;
    eventDate: string | null;
  };
  scenePolicy: {
    preferredSensors: string[];
    requiredBands: string[];
    maxCloudCover: number | null;
    maxGsdMeters: number | null;
    minSceneCount: number;
    beforeAfterRequired: boolean;
  };
  outputs: string[];
  validationPolicy: {
    minIndependentSources: number;
    requireModelGeometryForDetection: true;
  };
};

export type FeasibilityCheck = {
  code: FeasibilityReasonCode;
  status: "pass" | "warning" | "fail";
  message: string;
  evidenceIds: string[];
};

export type FeasibilityReport = {
  status: FeasibilityStatus;
  findingStatus: FindingStatus;
  summary: string;
  checks: FeasibilityCheck[];
  eligibleSceneIds: string[];
  realModelRun: boolean;
  canConcludeAbsence: boolean;
};

export type GeometryMeasurements = {
  areaKm2: number | null;
  perimeterKm: number | null;
  centroid: [number, number] | null;
  bbox: [number, number, number, number] | null;
  featureCount: number;
  method: "spherical-wgs84";
  precisionNote: string;
};

export type EvidenceEntry = {
  id: string;
  kind: "scene" | "catalog-event" | "model-output" | "measurement" | "tool-run";
  title: string;
  source: string;
  sourceId: string;
  url: string | null;
  observedAt: string | null;
  retrievedAt: string;
  geometry: GeoJsonGeometry | null;
  license: LicenseProvenance | null;
  limitations: string[];
};

export type EvidenceClaim = {
  id: string;
  statement: string;
  status: "observed" | "inferred" | "not-established";
  evidenceIds: string[];
};

export type EvidenceLedger = {
  schemaVersion: "geolens-evidence/v1";
  missionId: string;
  query: string;
  entries: EvidenceEntry[];
  claims: EvidenceClaim[];
  modelVersions: Array<{ id: string; version: string | null; status: ModelExecutionStatus }>;
  reasonCodes: FeasibilityReasonCode[];
  measurements: GeometryMeasurements | null;
  limitations: string[];
  createdAt: string;
  reviewStatus: "unreviewed" | "analyst-reviewed";
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
    source: "known-location" | "coordinates" | "validated-geocoder";
    matchQuality: "exact" | "strong" | "translated";
    resultType: string;
  } | null;
  recipe: AnalysisRecipe;
  answer: string;
  verdict: string;
  confidence: ConfidenceLevel;
  confidenceScore: number | null;
  findingStatus: FindingStatus;
  detectionMode: "catalog-confirmed" | "model-detected" | "source-only" | "not-feasible";
  scenes: SceneResult[];
  events: EventEvidence[];
  detectionGeometry: GeoJsonGeometry | null;
  steps: AgentStep[];
  limitations: string[];
  clarification: string | null;
  brain: BrainRun;
  model: ModelRun;
  mission: MissionSpec | null;
  feasibility: FeasibilityReport;
  measurements: GeometryMeasurements | null;
  ledger: EvidenceLedger;
  exportsVersion: "geolens-export/v1";
  generatedAt: string;
};
