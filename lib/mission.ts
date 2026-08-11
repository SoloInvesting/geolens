import type {
  AnalysisIntent,
  InterpreterResult,
  MissionSpec,
} from "@/app/types";

export type { MissionSpec } from "@/app/types";

export type MissionLocation = {
  name: string;
  latitude: number;
  longitude: number;
  bbox: [number, number, number, number];
  source?: "validated-geocoder" | "known-location" | "coordinates";
};

export type BuildMissionInput = {
  interpreter: InterpreterResult;
  location: MissionLocation;
};

type IntentDefaults = MissionSpec["scenePolicy"];

const INTENT_DEFAULTS: Record<AnalysisIntent, IntentDefaults> = {
  flood: {
    preferredSensors: ["Sentinel-1 SAR", "Sentinel-2 MSI", "Landsat OLI"],
    requiredBands: [],
    maxCloudCover: 35,
    maxGsdMeters: 30,
    minSceneCount: 1,
    beforeAfterRequired: false,
  },
  wildfire: {
    preferredSensors: ["Sentinel-2 MSI", "Landsat OLI"],
    requiredBands: ["red", "nir", "swir1", "swir2"],
    maxCloudCover: 35,
    maxGsdMeters: 30,
    minSceneCount: 2,
    beforeAfterRequired: true,
  },
  volcano: {
    preferredSensors: ["Sentinel-2 MSI", "Sentinel-1 SAR", "Landsat OLI", "ASTER"],
    requiredBands: ["red", "nir", "swir1", "swir2"],
    maxCloudCover: 40,
    maxGsdMeters: 30,
    minSceneCount: 1,
    beforeAfterRequired: false,
  },
  crop: {
    preferredSensors: ["Sentinel-2 MSI", "HLS", "Landsat OLI"],
    requiredBands: ["red", "nir", "swir1"],
    maxCloudCover: 25,
    maxGsdMeters: 30,
    minSceneCount: 2,
    beforeAfterRequired: true,
  },
  vessel: {
    preferredSensors: ["Sentinel-1 SAR", "NAIP", "very-high-resolution optical"],
    requiredBands: [],
    maxCloudCover: null,
    maxGsdMeters: 10,
    minSceneCount: 1,
    beforeAfterRequired: false,
  },
  building: {
    preferredSensors: ["NAIP", "very-high-resolution optical"],
    requiredBands: ["red", "green", "blue"],
    maxCloudCover: 20,
    maxGsdMeters: 3,
    minSceneCount: 1,
    beforeAfterRequired: false,
  },
  change: {
    preferredSensors: ["Sentinel-2 MSI", "Sentinel-1 SAR", "Landsat OLI", "NAIP"],
    requiredBands: [],
    maxCloudCover: 30,
    maxGsdMeters: 30,
    minSceneCount: 2,
    beforeAfterRequired: true,
  },
  imagery: {
    preferredSensors: ["Sentinel-2 MSI", "Sentinel-1 SAR", "Landsat OLI", "NAIP"],
    requiredBands: [],
    maxCloudCover: 40,
    maxGsdMeters: null,
    minSceneCount: 1,
    beforeAfterRequired: false,
  },
};

const DEFAULT_OUTPUTS = ["source-imagery", "source-provenance", "analysis-summary"];

export class MissionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissionValidationError";
  }
}

function assertFiniteCoordinate(value: number, label: string, min: number, max: number) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new MissionValidationError(`${label} must be a finite number between ${min} and ${max}.`);
  }
}

function roundCoordinate(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizedText(value: string, field: string) {
  const result = value.trim().replace(/\s+/g, " ");
  if (!result) throw new MissionValidationError(`${field} cannot be empty.`);
  if (result.length > 500) throw new MissionValidationError(`${field} is too long.`);
  return result;
}

function normalizedList(values: string[]) {
  return [...new Set(values.map((value) => value.trim().replace(/\s+/g, " ")).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "en"));
}

function isoDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new MissionValidationError(`${field} must use YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new MissionValidationError(`${field} is not a valid calendar date.`);
  }
  return value;
}

function validatedLocation(location: MissionLocation) {
  const name = normalizedText(location.name, "location.name");
  assertFiniteCoordinate(location.longitude, "longitude", -180, 180);
  assertFiniteCoordinate(location.latitude, "latitude", -90, 90);
  if (!Array.isArray(location.bbox) || location.bbox.length !== 4) {
    throw new MissionValidationError("bbox must contain [west, south, east, north].");
  }

  const [west, south, east, north] = location.bbox;
  assertFiniteCoordinate(west, "bbox.west", -180, 180);
  assertFiniteCoordinate(east, "bbox.east", -180, 180);
  assertFiniteCoordinate(south, "bbox.south", -90, 90);
  assertFiniteCoordinate(north, "bbox.north", -90, 90);
  if (west >= east || south >= north) {
    throw new MissionValidationError("bbox must be non-degenerate and ordered west, south, east, north.");
  }
  if (
    location.longitude < west
    || location.longitude > east
    || location.latitude < south
    || location.latitude > north
  ) {
    throw new MissionValidationError("The resolved location centroid must be inside its bbox.");
  }

  return {
    name,
    longitude: roundCoordinate(location.longitude),
    latitude: roundCoordinate(location.latitude),
    bbox: [west, south, east, north].map(roundCoordinate) as [number, number, number, number],
    source: location.source ?? "validated-geocoder",
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(",")}}`;
}

function hash32(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
    hash ^= hash >>> 13;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function stableMissionId(value: Omit<MissionSpec, "missionId">) {
  const canonical = stableStringify(value);
  return `mission-${hash32(canonical, 0x811c9dc5)}${hash32(canonical, 0x9e3779b9)}`;
}

export function buildMissionSpec(input: BuildMissionInput): MissionSpec {
  const location = validatedLocation(input.location);
  const startDate = isoDate(input.interpreter.startDate, "startDate");
  const endDate = isoDate(input.interpreter.endDate, "endDate");
  if (startDate > endDate) {
    throw new MissionValidationError("startDate cannot be after endDate.");
  }

  const defaults = INTENT_DEFAULTS[input.interpreter.intent];
  const requestedObjects = normalizedList(input.interpreter.requestedObjects);
  const outputs = normalizedList([
    ...DEFAULT_OUTPUTS,
    ...input.interpreter.requestedOutput,
    ...(input.interpreter.intent === "imagery" ? [] : ["detection-geometry", "evidence-ledger"]),
  ]);
  const [west, south, east, north] = location.bbox;

  const withoutId: Omit<MissionSpec, "missionId"> = {
    version: "geolens-mission/v1",
    intent: input.interpreter.intent,
    targetConcept: requestedObjects.join(", ") || normalizedText(input.interpreter.intentLabel, "intentLabel"),
    requestedObjects,
    aoi: {
      label: location.name,
      bbox: location.bbox,
      geometry: {
        type: "Polygon",
        coordinates: [[
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ]],
      },
      source: location.source,
    },
    temporal: {
      startDate,
      endDate,
      eventDate: /^\d{4}-\d{2}-\d{2}$/.test(input.interpreter.dateLabel)
        ? input.interpreter.dateLabel
        : startDate === endDate
          ? startDate
          : null,
    },
    scenePolicy: {
      preferredSensors: [...defaults.preferredSensors],
      requiredBands: [...defaults.requiredBands],
      maxCloudCover: defaults.maxCloudCover,
      maxGsdMeters: defaults.maxGsdMeters,
      minSceneCount: defaults.minSceneCount,
      beforeAfterRequired: defaults.beforeAfterRequired,
    },
    outputs,
    validationPolicy: {
      minIndependentSources: input.interpreter.intent === "imagery" ? 1 : 2,
      requireModelGeometryForDetection: true,
    },
  };

  return { ...withoutId, missionId: stableMissionId(withoutId) };
}
