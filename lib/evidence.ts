import type {
  AnalysisResponse,
  EvidenceClaim,
  EvidenceEntry,
  EvidenceLedger,
  FeasibilityReport,
  GeoJsonGeometry,
  GeometryMeasurements,
  MissionSpec,
  ModelRun,
} from "@/app/types";

function evidenceId(kind: string, nativeId: string) {
  const safe = nativeId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
  return `${kind}:${safe || "unknown"}`;
}

export function buildEvidenceLedger(input: {
  query: string;
  mission: MissionSpec;
  scenes: AnalysisResponse["scenes"];
  events: AnalysisResponse["events"];
  model: ModelRun;
  geometry: GeoJsonGeometry | null;
  measurements: GeometryMeasurements | null;
  feasibility: FeasibilityReport;
  limitations: string[];
  generatedAt: string;
}): EvidenceLedger {
  const entries: EvidenceEntry[] = [];

  for (const scene of input.scenes) {
    entries.push({
      id: evidenceId("scene", scene.canonicalSceneId || scene.id),
      kind: "scene",
      title: `${scene.instrument}, ${scene.datetime}`,
      source: scene.catalog,
      sourceId: scene.id,
      url: scene.stacUrl,
      observedAt: scene.datetime,
      retrievedAt: input.generatedAt,
      geometry: scene.geometry,
      license: scene.license,
      limitations: [
        scene.selectionReason,
        scene.assetAccess === "public-http" ? "" : `גישה לנכסי פיקסלים: ${scene.assetAccess}.`,
      ].filter(Boolean),
    });
  }

  for (const event of input.events) {
    entries.push({
      id: evidenceId("event", event.id),
      kind: "catalog-event",
      title: event.title,
      source: event.source,
      sourceId: event.id,
      url: event.sourceUrl,
      observedAt: event.date,
      retrievedAt: input.generatedAt,
      geometry: { type: "Point", coordinates: event.coordinates },
      license: null,
      limitations: ["אירוע קטלוגי הוא ראיית הקשר ואינו מסכת זיהוי מפוקסלת."],
    });
  }

  const modelEvidenceId = input.model.runId || evidenceId("model", `${input.model.id || "none"}-${input.generatedAt}`);
  if (input.model.status === "completed") {
    entries.push({
      id: modelEvidenceId,
      kind: "model-output",
      title: input.model.name,
      source: input.model.backend || input.model.provider,
      sourceId: input.model.runId || input.model.id || "none",
      url: input.model.modelCardUrl,
      observedAt: input.model.completedAt || input.generatedAt,
      retrievedAt: input.generatedAt,
      geometry: input.geometry,
      license: null,
      limitations: [
        input.model.calibratedConfidence ? "" : "ציון המודל אינו מכויל כהסתברות.",
        ...(input.model.reasonCodes || []).map((code) => `קוד ריצה: ${code}.`),
      ].filter(Boolean),
    });
  }

  if (input.measurements && input.geometry) {
    entries.push({
      id: evidenceId("measurement", input.mission.missionId),
      kind: "measurement",
      title: "מדידות GIS דטרמיניסטיות",
      source: "GeoLens GIS engine",
      sourceId: input.mission.missionId,
      url: null,
      observedAt: input.generatedAt,
      retrievedAt: input.generatedAt,
      geometry: input.geometry,
      license: null,
      limitations: [input.measurements.precisionNote],
    });
  }

  const sceneEvidenceIds = entries.filter((entry) => entry.kind === "scene").map((entry) => entry.id);
  const eventEvidenceIds = entries.filter((entry) => entry.kind === "catalog-event").map((entry) => entry.id);
  const claims: EvidenceClaim[] = [
    {
      id: "claim:source-coverage",
      statement: input.scenes.length
        ? `נמצאו ${input.scenes.length} סצנות מקור מתאימות לחיפוש.`
        : "לא הוכח שקיימת סצנת מקור מתאימה בחלון שנבדק.",
      status: input.scenes.length ? "observed" : "not-established",
      evidenceIds: sceneEvidenceIds,
    },
    {
      id: "claim:catalog-context",
      statement: input.events.length
        ? `נמצאו ${input.events.length} רשומות אירוע חיצוניות סמוכות.`
        : "לא נמצאה רשומת אירוע חיצונית מתאימה.",
      status: input.events.length ? "observed" : "not-established",
      evidenceIds: eventEvidenceIds,
    },
    {
      id: "claim:detection",
      statement: input.mission.intent === "imagery"
        ? input.scenes.length
          ? "נמצאו סצנות דימות מקור מתועדות. לא התבקש ולא בוצע זיהוי אובייקט."
          : "לא הוכח שקיימת סצנת דימות מתאימה בחלון שנבדק."
        : input.feasibility.findingStatus === "detected"
        ? "מודל ייעודי החזיר גאומטריית זיהוי תקפה."
        : input.feasibility.findingStatus === "not-detected"
          ? "מודל ייעודי השלים ריצה על קלט מתאים ולא החזיר ממצא."
          : "לא ניתן לקבוע אם היעד קיים מהראיות הזמינות.",
      status: input.mission.intent === "imagery"
        ? input.scenes.length ? "observed" : "not-established"
        : input.feasibility.findingStatus === "indeterminate" ? "not-established" : "inferred",
      evidenceIds: input.model.status === "completed" ? [modelEvidenceId, ...sceneEvidenceIds] : sceneEvidenceIds,
    },
  ];

  return {
    schemaVersion: "geolens-evidence/v1",
    missionId: input.mission.missionId,
    query: input.query,
    entries,
    claims,
    modelVersions: input.model.id
      ? [{ id: input.model.id, version: input.model.version, status: input.model.status }]
      : [],
    reasonCodes: [...new Set([
      ...input.feasibility.checks
        .filter((check) => check.status !== "pass")
        .map((check) => check.code),
      ...(input.model.reasonCodes || []),
    ])],
    measurements: input.measurements,
    limitations: input.limitations,
    createdAt: input.generatedAt,
    reviewStatus: "unreviewed",
  };
}
