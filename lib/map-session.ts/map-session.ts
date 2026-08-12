import type {
  AnalysisResponse,
  MapAsset,
  MapSession,
  SceneResult,
} from "../app/types";

function mapPreviewUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 96) || "unknown";
}

function sceneEvidenceId(analysis: AnalysisResponse, scene: SceneResult) {
  return analysis.ledger.entries.find((entry) => entry.kind === "scene" && entry.sourceId === scene.id)?.id
    || `scene:${safeId(scene.canonicalSceneId || scene.id)}`;
}

function eventEvidenceId(analysis: AnalysisResponse, eventId: string) {
  return analysis.ledger.entries.find((entry) => entry.kind === "catalog-event" && entry.sourceId === eventId)?.id
    || `event:${safeId(eventId)}`;
}

function modelEvidenceId(analysis: AnalysisResponse) {
  const entry = analysis.ledger.entries.find((candidate) => candidate.kind === "model-output");
  return entry?.id || analysis.model.runId || null;
}

function aoiAsset(analysis: AnalysisResponse): MapAsset | null {
  const mission = analysis.mission;
  if (!mission) return null;
  return {
    id: "aoi",
    kind: "aoi",
    title: "אזור החיפוש המאומת",
    geometry: mission.aoi.geometry,
    bbox: mission.aoi.bbox,
    imageUrl: null,
    visible: true,
    opacity: 1,
    status: "verified",
    provenance: {
      missionId: mission.missionId,
      evidenceIds: [],
      sceneId: null,
      modelRunId: null,
      observedAt: null,
      source: mission.aoi.source,
    },
  };
}

function sceneAsset(analysis: AnalysisResponse, scene: SceneResult): MapAsset {
  return {
    id: `scene-${safeId(scene.id)}`,
    kind: "source-footprint",
    title: `${scene.instrument} · ${new Date(scene.datetime).toLocaleDateString("he-IL")}`,
    geometry: scene.geometry,
    bbox: scene.bbox,
    imageUrl: null,
    visible: true,
    opacity: 1,
    status: "context",
    provenance: {
      missionId: analysis.mission?.missionId || analysis.ledger.missionId,
      evidenceIds: [sceneEvidenceId(analysis, scene)],
      sceneId: scene.id,
      modelRunId: null,
      observedAt: scene.datetime,
      source: scene.catalog,
    },
  };
}

function sourceImageAsset(analysis: AnalysisResponse, scene: SceneResult): MapAsset | null {
  const imageUrl = mapPreviewUrl(scene.thumbnailUrl);
  if (!imageUrl) return null;
  return {
    id: `source-${safeId(scene.id)}`,
    kind: "source-image",
    title: `תצוגת מקור, ${scene.instrument}`,
    geometry: null,
    bbox: scene.bbox,
    imageUrl,
    visible: true,
    opacity: 0.78,
    status: "context",
    provenance: {
      missionId: analysis.mission?.missionId || analysis.ledger.missionId,
      evidenceIds: [sceneEvidenceId(analysis, scene)],
      sceneId: scene.id,
      modelRunId: null,
      observedAt: scene.datetime,
      source: scene.catalog,
    },
  };
}

export function isVerifiedDetection(analysis: AnalysisResponse) {
  return Boolean(
    analysis.findingStatus === "detected"
      && analysis.feasibility.realModelRun
      && analysis.model.status === "completed"
      && analysis.detectionGeometry,
  );
}

export function buildMapSession(
  analysis: AnalysisResponse | null,
  preferredSceneId: string | null = null,
  now = analysis?.generatedAt || new Date().toISOString(),
): MapSession | null {
  if (!analysis?.mission) return null;
  const selectedScene = analysis.scenes.find((scene) => scene.id === preferredSceneId)
    || analysis.scenes.find((scene) => scene.role === "primary")
    || analysis.scenes[0]
    || null;
  const assets: MapAsset[] = [];
  const aoi = aoiAsset(analysis);
  if (aoi) assets.push(aoi);
  for (const scene of analysis.scenes) assets.push(sceneAsset(analysis, scene));
  if (selectedScene) {
    const source = sourceImageAsset(analysis, selectedScene);
    if (source) assets.push(source);
  }
  for (const event of analysis.events) {
    assets.push({
      id: `event-${safeId(event.id)}`,
      kind: "catalog-event",
      title: event.title,
      geometry: { type: "Point", coordinates: event.coordinates },
      bbox: [event.coordinates[0], event.coordinates[1], event.coordinates[0], event.coordinates[1]],
      imageUrl: null,
      visible: true,
      opacity: 1,
      status: "context",
      provenance: {
        missionId: analysis.mission.missionId,
        evidenceIds: [eventEvidenceId(analysis, event.id)],
        sceneId: null,
        modelRunId: null,
        observedAt: event.date,
        source: event.source,
      },
    });
  }
  if (isVerifiedDetection(analysis) && analysis.detectionGeometry) {
    assets.push({
      id: "model-detection",
      kind: "detection",
      title: `זיהוי מאומת, ${analysis.model.name}`,
      geometry: analysis.detectionGeometry,
      bbox: analysis.measurements?.bbox || null,
      imageUrl: null,
      visible: true,
      opacity: 1,
      status: "verified",
      provenance: {
        missionId: analysis.mission.missionId,
        evidenceIds: [modelEvidenceId(analysis), ...analysis.scenes.map((scene) => sceneEvidenceId(analysis, scene))].filter((id): id is string => Boolean(id)),
        sceneId: selectedScene?.id || null,
        modelRunId: analysis.model.runId || null,
        observedAt: analysis.model.completedAt || analysis.generatedAt,
        source: analysis.model.backend || analysis.model.provider,
      },
    });
  }
  if (analysis.measurements && analysis.detectionGeometry) {
    const measurementEvidence = analysis.ledger.entries.find((entry) => entry.kind === "measurement")?.id;
    assets.push({
      id: "measurement-summary",
      kind: "measurement",
      title: "מדידות GIS דטרמיניסטיות",
      geometry: analysis.detectionGeometry,
      bbox: analysis.measurements.bbox,
      imageUrl: null,
      visible: false,
      opacity: 1,
      status: "verified",
      provenance: {
        missionId: analysis.mission.missionId,
        evidenceIds: measurementEvidence ? [measurementEvidence] : [],
        sceneId: selectedScene?.id || null,
        modelRunId: analysis.model.runId || null,
        observedAt: analysis.generatedAt,
        source: "GeoLens GIS engine",
      },
    });
  }
  return {
    schemaVersion: "geolens-map/v1",
    sessionId: `map-${safeId(analysis.mission.missionId)}`,
    missionId: analysis.mission.missionId,
    title: analysis.interpretation.intentLabel,
    createdAt: analysis.generatedAt,
    updatedAt: now,
    viewport: {
      center: analysis.location ? [analysis.location.longitude, analysis.location.latitude] : null,
      bbox: analysis.mission.aoi.bbox,
      zoom: analysis.location ? 9 : null,
    },
    basemap: "satellite",
    assets,
  };
}

export function serializeMapSession(session: MapSession) {
  return JSON.stringify(session);
}

export function parseMapSession(value: string): MapSession | null {
  try {
    const parsed = JSON.parse(value) as Partial<MapSession>;
    if (parsed.schemaVersion !== "geolens-map/v1" || typeof parsed.sessionId !== "string" || !Array.isArray(parsed.assets)) return null;
    return parsed as MapSession;
  } catch {
    return null;
  }
}
