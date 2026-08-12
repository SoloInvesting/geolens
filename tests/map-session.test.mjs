import test from "node:test";
import assert from "node:assert/strict";
import { buildMapSession, isVerifiedDetection, parseMapSession, serializeMapSession } from "../lib/map-session.ts";

const mission = {
  version: "geolens-mission/v1",
  missionId: "mission-test",
  targetConcept: "שריפה",
  intent: "wildfire",
  requestedObjects: [],
  aoi: {
    label: "Test area",
    bbox: [-1, -1, 1, 1],
    geometry: { type: "Polygon", coordinates: [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]] },
    source: "validated-geocoder",
  },
  temporal: { startDate: "2023-08-01", endDate: "2023-08-31", eventDate: "2023-08-15" },
  scenePolicy: { preferredSensors: ["Sentinel-2 MSI"], requiredBands: [], maxCloudCover: 30, maxGsdMeters: 30, minSceneCount: 2, beforeAfterRequired: true },
  outputs: ["source-imagery"],
  validationPolicy: { minIndependentSources: 2, requireModelGeometryForDetection: true },
};

function analysis(overrides = {}) {
  const scene = {
    id: "scene-primary",
    canonicalSceneId: "S2_TEST_1",
    collection: "sentinel-2-l2a",
    platform: "sentinel-2",
    instrument: "Sentinel-2 MSI",
    datetime: "2023-08-15T00:00:00Z",
    cloudCover: 5,
    resolution: "10m",
    thumbnailUrl: "https://example.com/quicklook.jpg",
    stacUrl: "https://example.com/item.json",
    bbox: [-1, -1, 1, 1],
    geometry: mission.aoi.geometry,
    assets: [],
    role: "primary",
    catalog: "Element 84 Earth Search",
    gsdMeters: 10,
    qualityScore: 90,
    selectionReason: "test",
    assetAccess: "public-http",
    license: { licenseId: "unknown", commercialUse: null, redistribution: null, attributionRequired: null, sourceProvider: "test", sourceItemId: "scene-primary", termsUrl: "https://example.com", note: "test" },
  };
  return {
    ok: true,
    query: "test",
    interpretation: { intent: "wildfire", intentLabel: "שריפה", locationText: "Test area", dateLabel: "2023-08-15", startDate: "2023-08-01", endDate: "2023-08-31", requestedObjects: [], requestedOutput: [] },
    location: { name: "Test area", latitude: 0, longitude: 0, bbox: [-1, -1, 1, 1], source: "validated-geocoder", matchQuality: "exact", resultType: "city" },
    recipe: { title: "test", target: "test", primarySensor: "Sentinel-2 MSI", confirmationSensor: "Landsat", bands: [], method: [], minimumReliableScale: "10m", expectedOutput: "GeoJSON" },
    answer: "test",
    verdict: "test",
    confidence: "not-assessed",
    confidenceScore: null,
    findingStatus: "indeterminate",
    detectionMode: "source-only",
    scenes: [scene],
    events: [],
    detectionGeometry: null,
    steps: [],
    limitations: [],
    clarification: null,
    brain: { provider: "GeoLens", requestedModel: "not-requested", actualModel: null, status: "fallback", freeOnly: true, message: "test" },
    model: { id: "test-model", name: "test-model", task: "wildfire", provider: "test", modelCardUrl: null, configured: false, status: "not-configured", message: "test", inputRequirement: "test", calibratedConfidence: false, version: "1", detected: null, runId: null, completedAt: null, backend: null },
    mission,
    feasibility: { status: "conditional", findingStatus: "indeterminate", summary: "test", checks: [], eligibleSceneIds: [scene.id], realModelRun: false, canConcludeAbsence: false },
    measurements: null,
    ledger: { schemaVersion: "geolens-evidence/v1", missionId: "mission-test", query: "test", entries: [{ id: "scene:s2-test-1", kind: "scene", title: "test", source: "test", sourceId: scene.id, url: scene.stacUrl, observedAt: scene.datetime, retrievedAt: scene.datetime, geometry: scene.geometry, license: scene.license, limitations: [] }], claims: [], modelVersions: [], reasonCodes: [], measurements: null, limitations: [], createdAt: scene.datetime, reviewStatus: "unreviewed" },
    exportsVersion: "geolens-export/v1",
    generatedAt: scene.datetime,
    ...overrides,
  };
}

test("buildMapSession preserves evidence links for source and AOI assets", () => {
  const result = buildMapSession(analysis());
  assert.ok(result);
  assert.equal(result.schemaVersion, "geolens-map/v1");
  assert.ok(result.assets.some((asset) => asset.kind === "aoi" && asset.provenance.missionId === "mission-test"));
  const source = result.assets.find((asset) => asset.kind === "source-image");
  assert.deepEqual(source?.provenance.evidenceIds, ["scene:s2-test-1"]);
});

test("unverified geometry never becomes a detection asset", () => {
  const result = buildMapSession(analysis({ detectionGeometry: mission.aoi.geometry }));
  assert.ok(result);
  assert.equal(isVerifiedDetection(analysis({ detectionGeometry: mission.aoi.geometry })), false);
  assert.equal(result.assets.some((asset) => asset.kind === "detection"), false);
});

test("verified model output becomes a provenance-linked detection asset", () => {
  const result = buildMapSession(analysis({
    findingStatus: "detected",
    detectionMode: "model-detected",
    detectionGeometry: { type: "Point", coordinates: [0, 0] },
    model: { ...analysis().model, configured: true, status: "completed", detected: true, runId: "run-1", completedAt: "2023-08-16T00:00:00Z", backend: "test" },
    feasibility: { ...analysis().feasibility, status: "feasible", findingStatus: "detected", realModelRun: true },
    ledger: { ...analysis().ledger, entries: [...analysis().ledger.entries, { id: "run-1", kind: "model-output", title: "test", source: "test", sourceId: "run-1", url: null, observedAt: "2023-08-16T00:00:00Z", retrievedAt: "2023-08-16T00:00:00Z", geometry: { type: "Point", coordinates: [0, 0] }, license: null, limitations: [] }] },
  }));
  assert.ok(result);
  const detection = result.assets.find((asset) => asset.kind === "detection");
  assert.equal(detection?.provenance.modelRunId, "run-1");
  assert.equal(detection?.status, "verified");
});

test("map session serialization is round-trip safe", () => {
  const session = buildMapSession(analysis());
  assert.ok(session);
  assert.deepEqual(parseMapSession(serializeMapSession(session)), session);
  assert.equal(parseMapSession("not-json"), null);
});
