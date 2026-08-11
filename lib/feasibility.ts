import type {
  FeasibilityCheck,
  FeasibilityReasonCode,
  FeasibilityReport,
  GeoJsonGeometry,
  ModelRun,
  SceneResult,
  MissionSpec,
} from "@/app/types";
import { isValidGeoJsonGeometry, tryMeasureGeometry } from "@/lib/gis";

export type { FeasibilityReasonCode, FeasibilityReport } from "@/app/types";

export type ModelObservation = {
  runId: string;
  modelId: string;
  modelVersion: string | null;
  completedAt: string;
  outcome: "positive" | "negative" | "inconclusive";
  confidence: number | null;
  geometry: GeoJsonGeometry | null;
};

export type FeasibilityInput = {
  mission: MissionSpec;
  scenes: SceneResult[];
  model?: ModelRun | null;
  modelObservation?: ModelObservation | null;
  catalogConfirmed?: boolean;
  catalogSearchSkipped?: boolean;
  modelDisagreement?: boolean;
};

type CheckDimension = "coverage" | "resolution" | "cloud" | "sensor" | "bands" | "time" | "evidence" | "model";

export type DetailedFeasibilityCheck = FeasibilityCheck & {
  dimension: CheckDimension;
};

export type FeasibilityAssessment = Omit<FeasibilityReport, "checks"> & {
  evidenceBasis: "model" | "catalog" | "none";
  reasonCodes: FeasibilityReasonCode[];
  checks: DetailedFeasibilityCheck[];
  eligibleSceneIds: string[];
  realModelRun: boolean;
  canConcludeAbsence: boolean;
};

function normalizedToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function sensorFamily(value: string) {
  const token = normalizedToken(value);
  if (token.includes("sentinel1") || token.includes("sar") || token.includes("csar")) return "sentinel1";
  if (token.includes("sentinel2") || token.includes("msi")) return "sentinel2";
  if (token.includes("landsat") || token.includes("oli")) return "landsat";
  if (token.includes("naip")) return "naip";
  if (token.includes("hls")) return "hls";
  if (token.includes("aster")) return "aster";
  if (token.includes("veryhighresolution") || token.includes("vhr")) return "vhr";
  return token;
}

function sceneMatchesPreferredSensor(scene: SceneResult, preferredSensors: string[]) {
  if (!preferredSensors.length) return true;
  const sceneValues = [scene.collection, scene.platform, scene.instrument].map(sensorFamily);
  const preferred = preferredSensors.map(sensorFamily);
  return preferred.some((sensor) => sceneValues.some((value) => value === sensor || value.includes(sensor) || sensor.includes(value)));
}

const BAND_ALIASES: Record<string, string[]> = {
  red: ["red", "b04", "band4"],
  green: ["green", "b03", "band3"],
  blue: ["blue", "b02", "band2"],
  nir: ["nir", "nir08", "b08", "b8a", "b08a", "band5"],
  swir1: ["swir1", "swir16", "b11", "band6"],
  swir2: ["swir2", "swir22", "b12", "band7"],
};

function sceneHasRequiredBands(scene: SceneResult, requiredBands: string[]) {
  if (!requiredBands.length) return true;
  const labels = scene.assets.map((asset) => normalizedToken(asset.label));
  return requiredBands.every((band) => {
    const aliases = BAND_ALIASES[normalizedToken(band)] || [normalizedToken(band)];
    return aliases.some((alias) => labels.some((label) => label === alias || label.includes(alias)));
  });
}

function resolutionMeters(scene: SceneResult) {
  if (scene.gsdMeters !== null && Number.isFinite(scene.gsdMeters) && scene.gsdMeters > 0) {
    return scene.gsdMeters;
  }
  const match = scene.resolution.match(/(\d+(?:\.\d+)?)\s*(?:m|meter|metre|מטר)/i)
    || scene.resolution.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function sceneIsRadar(scene: SceneResult) {
  return sensorFamily(`${scene.collection} ${scene.platform} ${scene.instrument}`) === "sentinel1";
}

function validIsoTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function validRealModelRun(model: ModelRun | null | undefined, observation: ModelObservation | null | undefined) {
  if (!model || model.status !== "completed" || !observation) return false;
  if (!observation.runId.trim() || !observation.modelId.trim()) return false;
  if (model.id && model.id !== observation.modelId) return false;
  if (model.version && observation.modelVersion && model.version !== observation.modelVersion) return false;
  if (validIsoTimestamp(observation.completedAt) === null) return false;
  if (
    observation.confidence !== null
    && (!Number.isFinite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1)
  ) {
    return false;
  }
  if (observation.outcome === "positive") {
    return model.detected === true && isValidGeoJsonGeometry(observation.geometry);
  }
  if (observation.outcome === "negative") {
    return model.detected === false && observation.geometry === null;
  }
  return model.detected === null && observation.geometry === null;
}

function addCheck(
  checks: DetailedFeasibilityCheck[],
  dimension: CheckDimension,
  status: FeasibilityCheck["status"],
  code: FeasibilityReasonCode,
  message: string,
  evidenceIds: string[] = [],
) {
  checks.push({ dimension, status, code, message, evidenceIds });
}

function distinctTemporalPair(scenes: SceneResult[], startDate: string, endDate: string) {
  const start = new Date(`${startDate}T23:59:59.999Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  const before = scenes.filter((scene) => {
    const time = validIsoTimestamp(scene.datetime);
    return time !== null && time <= start;
  });
  const after = scenes.filter((scene) => {
    const time = validIsoTimestamp(scene.datetime);
    return time !== null && time >= end;
  });
  return before.some((first) => after.some((second) => first.id !== second.id));
}

function failedAndWarningCodes(checks: DetailedFeasibilityCheck[]) {
  return [...new Set(
    checks
      .filter((item) => item.status !== "pass")
      .map((item) => item.code),
  )];
}

export function assessFeasibility(input: FeasibilityInput): FeasibilityAssessment {
  const checks: DetailedFeasibilityCheck[] = [];
  const policy = input.mission.scenePolicy;
  const requiresSpecialistModel = input.mission.intent !== "imagery";
  let eligible = [...input.scenes];
  const aoiMeasurements = tryMeasureGeometry(input.mission.aoi.geometry);
  if (aoiMeasurements && aoiMeasurements.areaKm2 !== null && aoiMeasurements.areaKm2 > 150_000) {
    const status = requiresSpecialistModel ? "fail" : "warning";
    addCheck(
      checks,
      "coverage",
      status,
      "AOI_TOO_LARGE",
      `אזור החיפוש הוא כ-${Math.round(aoiMeasurements.areaKm2).toLocaleString("he-IL")} קמ״ר. ${requiresSpecialistModel ? "פענוח אובייקטים על מספר קטן של סצנות לא יכסה אותו באופן אמין, ולכן נדרש אזור ממוקד יותר." : "מומלץ לצמצם אותו כדי למנוע דילוג על סצנות ולשפר דיוק."}`,
    );
  }

  if (!eligible.length && !input.catalogSearchSkipped) {
    addCheck(checks, "coverage", "fail", "NO_SCENES", "לא נמצאו סצנות מקור עבור אזור וזמן המשימה.");
  } else if (eligible.length) {
    addCheck(checks, "coverage", "pass", "NO_SCENES", `נמצאו ${eligible.length} סצנות מקור מועמדות.`, eligible.map((scene) => scene.id));

    const sensorMatches = eligible.filter((scene) => sceneMatchesPreferredSensor(scene, policy.preferredSensors));
    if (!sensorMatches.length) {
      addCheck(checks, "sensor", "fail", "MISSING_SENSOR", "אף סצנה אינה תואמת לחיישנים המועדפים במשימה.");
      eligible = [];
    } else {
      addCheck(checks, "sensor", "pass", "MISSING_SENSOR", `${sensorMatches.length} סצנות תואמות לחיישנים הנדרשים.`, sensorMatches.map((scene) => scene.id));
      eligible = sensorMatches;
    }

    if (eligible.length) {
      const accessible = eligible.filter((scene) => scene.assetAccess === "public-http" && scene.assets.length > 0);
      if (!accessible.length) {
        addCheck(checks, "coverage", "fail", "ASSET_UNAVAILABLE", "נמצאו רשומות קטלוג, אך אין נכסי פיקסלים ציבוריים שניתן להציג או למסור לשירות הפענוח.", eligible.map((scene) => scene.id));
        eligible = [];
      } else {
        addCheck(checks, "coverage", "pass", "ASSET_UNAVAILABLE", `${accessible.length} סצנות כוללות נכסי פיקסלים ציבוריים.`, accessible.map((scene) => scene.id));
        eligible = accessible;
      }
    }

    if (eligible.length && policy.requiredBands.length) {
      const bandMatches = eligible.filter((scene) => sceneHasRequiredBands(scene, policy.requiredBands));
      if (!bandMatches.length) {
        addCheck(checks, "bands", "fail", "MISSING_BANDS", "הסצנות אינן מספקות את כל הערוצים הספקטרליים הנדרשים.");
        eligible = [];
      } else {
        addCheck(checks, "bands", "pass", "MISSING_BANDS", `${bandMatches.length} סצנות כוללות את הערוצים הנדרשים.`, bandMatches.map((scene) => scene.id));
        eligible = bandMatches;
      }
    } else if (!policy.requiredBands.length) {
      addCheck(checks, "bands", "pass", "MISSING_BANDS", "למשימה אין דרישת ערוצים קשיחה.");
    }

    if (eligible.length && policy.maxGsdMeters !== null) {
      const resolutionMatches = eligible.filter((scene) => {
        const meters = resolutionMeters(scene);
        return meters !== null && meters <= policy.maxGsdMeters!;
      });
      if (!resolutionMatches.length) {
        addCheck(checks, "resolution", "fail", "RESOLUTION_TOO_COARSE", `אין סצנה ברזולוציה של ${policy.maxGsdMeters} מטר לפיקסל או טובה יותר.`);
        eligible = [];
      } else {
        addCheck(checks, "resolution", "pass", "RESOLUTION_TOO_COARSE", `${resolutionMatches.length} סצנות עומדות בסף הרזולוציה.`, resolutionMatches.map((scene) => scene.id));
        eligible = resolutionMatches;
      }
    } else if (policy.maxGsdMeters === null) {
      addCheck(checks, "resolution", "pass", "RESOLUTION_TOO_COARSE", "למשימה אין סף רזולוציה קשיח.");
    }

    if (eligible.length && policy.maxCloudCover !== null) {
      const cloudMatches = eligible.filter((scene) => {
        if (sceneIsRadar(scene)) return true;
        return scene.cloudCover === null || scene.cloudCover <= policy.maxCloudCover!;
      });
      if (!cloudMatches.length) {
        addCheck(checks, "cloud", "fail", "CLOUD_COVER_TOO_HIGH", `כל הסצנות האופטיות חורגות מסף עננות של ${policy.maxCloudCover}%.`);
        eligible = [];
      } else {
        addCheck(checks, "cloud", "pass", "CLOUD_COVER_TOO_HIGH", `${cloudMatches.length} סצנות עוברות את סף העננות או מבוססות SAR.`, cloudMatches.map((scene) => scene.id));
        eligible = cloudMatches;
      }
    } else if (policy.maxCloudCover === null) {
      addCheck(checks, "cloud", "pass", "CLOUD_COVER_TOO_HIGH", "עננות אינה חסם קשיח למשימה זו.");
    }

    if (eligible.length < policy.minSceneCount) {
      addCheck(checks, "coverage", "fail", "INSUFFICIENT_SCENE_COUNT", `נדרשות לפחות ${policy.minSceneCount} סצנות מתאימות, ונמצאו ${eligible.length}.`, eligible.map((scene) => scene.id));
    }

    if (eligible.length && policy.beforeAfterRequired) {
      if (!distinctTemporalPair(eligible, input.mission.temporal.startDate, input.mission.temporal.endDate)) {
        addCheck(checks, "time", "fail", "BASELINE_REQUIRED", "לא נמצא צמד סצנות נפרדות שמכסה לפני ואחרי חלון המשימה.", eligible.map((scene) => scene.id));
      } else {
        addCheck(checks, "time", "pass", "BASELINE_REQUIRED", "נמצא צמד סצנות נפרדות לפני ואחרי חלון המשימה.", eligible.map((scene) => scene.id));
      }
    } else if (!policy.beforeAfterRequired) {
      addCheck(checks, "time", "pass", "BASELINE_REQUIRED", "המשימה אינה דורשת צמד זמנים.");
    }
  }

  if (requiresSpecialistModel && !input.catalogSearchSkipped) {
    const independentSources = new Set(
      input.scenes.map((scene) => sensorFamily(`${scene.collection} ${scene.platform} ${scene.instrument}`)),
    );
    if (input.catalogConfirmed) independentSources.add("external-event-catalog");
    const count = independentSources.size;
    if (count < input.mission.validationPolicy.minIndependentSources) {
      addCheck(
        checks,
        "evidence",
        "warning",
        "INSUFFICIENT_INDEPENDENT_SOURCES",
        `מדיניות המשימה דורשת ${input.mission.validationPolicy.minIndependentSources} מקורות בלתי תלויים, ונמצאו ${count}. ממצא מודל אפשרי יישאר מותנה עד אימות נוסף.`,
        input.scenes.map((scene) => scene.id),
      );
    } else {
      addCheck(
        checks,
        "evidence",
        "pass",
        "INSUFFICIENT_INDEPENDENT_SOURCES",
        `נמצאו ${count} מקורות חיישן או קטלוג בלתי תלויים.`,
        input.scenes.map((scene) => scene.id),
      );
    }
  }

  const realModelRun = validRealModelRun(input.model, input.modelObservation);
  if (requiresSpecialistModel) {
    if (!input.model || input.model.status === "not-configured" || input.model.status === "not-applicable") {
      addCheck(checks, "model", "warning", "MODEL_ENDPOINT_UNCONFIGURED", "לא מחובר שירות מודל ייעודי, ולכן אי אפשר להסיק ממצא פיקסלי סופי.");
    } else if (input.model.status === "failed") {
      addCheck(checks, "model", "warning", "MODEL_FAILED", "שירות המודל נכשל, ולכן התוצאה אינה מסקנת פענוח.");
    } else if (input.model.status === "blocked") {
      addCheck(
        checks,
        "model",
        "warning",
        input.model.reasonCodes?.[0] || "MODEL_ENDPOINT_UNCONFIGURED",
        "הפעלת המודל נחסמה בגלל תנאי קלט שלא התקיימו.",
      );
    } else if (!realModelRun) {
      const code: FeasibilityReasonCode = input.model.detected === true ? "INVALID_MODEL_GEOMETRY" : "UNCALIBRATED_CONFIDENCE";
      addCheck(checks, "model", "warning", code, "אין רשומת ריצה מלאה שמאפשרת להסיק חיובי או שלילי.");
    } else if (input.modelObservation?.outcome === "inconclusive") {
      addCheck(checks, "model", "warning", "UNCALIBRATED_CONFIDENCE", "ריצת המודל הסתיימה ללא הכרעה.", [input.modelObservation.runId]);
    } else {
      addCheck(checks, "model", "pass", "MODEL_FAILED", `ריצת המודל ${input.modelObservation!.runId} הושלמה עם ראיות ניתנות למעקב.`, [input.modelObservation!.runId]);
    }
  } else {
    addCheck(checks, "model", "pass", "MODEL_ENDPOINT_UNCONFIGURED", "המשימה אינה דורשת מודל ייעודי כדי להחזיר דימות מקור.");
  }

  if (input.modelDisagreement) {
    addCheck(checks, "model", "warning", "UNCALIBRATED_CONFIDENCE", "קיימת אי-הסכמה בין מקורות או מודלים, ולכן נדרשת בדיקה אנושית.");
  }

  const hasFailure = checks.some((item) => item.status === "fail");
  const hasWarning = checks.some((item) => item.status === "warning");
  const status: FeasibilityReport["status"] = hasFailure ? "blocked" : hasWarning ? "conditional" : "feasible";
  const positiveModel = !hasFailure
    && realModelRun
    && input.modelObservation?.outcome === "positive"
    && isValidGeoJsonGeometry(input.modelObservation.geometry);
  const reliableNegative = status === "feasible"
    && realModelRun
    && input.modelObservation?.outcome === "negative"
    && !input.modelDisagreement;

  let findingStatus: FeasibilityReport["findingStatus"] = "indeterminate";
  let evidenceBasis: FeasibilityAssessment["evidenceBasis"] = "none";
  if (positiveModel) {
    findingStatus = "detected";
    evidenceBasis = "model";
  } else if (reliableNegative) {
    findingStatus = "not-detected";
    evidenceBasis = "model";
  }

  const summary = findingStatus === "detected"
    ? evidenceBasis === "model"
      ? "זוהה ממצא עם גאומטריה מריצת מודל מתועדת."
      : "האירוע מאומת בקטלוג חיצוני, אך אין בכך לבדו סגמנטציה פיקסלית."
    : findingStatus === "not-detected"
      ? "לא זוהה ממצא בריצת מודל אמיתית ורק לאחר שכל תנאי ההיתכנות עברו."
      : "אין מספיק ראיות כדי לקבוע שהאירוע זוהה או שלא זוהה.";

  return {
    status,
    findingStatus,
    evidenceBasis,
    reasonCodes: failedAndWarningCodes(checks),
    checks,
    eligibleSceneIds: eligible.map((scene) => scene.id),
    realModelRun,
    canConcludeAbsence: reliableNegative,
    summary,
  };
}
