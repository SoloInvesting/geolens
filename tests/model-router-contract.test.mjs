import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const CHILD_PROCESS_FLAG = "GEOLENS_MODEL_ROUTER_TEST_CHILD";
const SHARED_CONTRACT_FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/geolens-inference-v1.json", import.meta.url), "utf8"),
);

if (process.env[CHILD_PROCESS_FLAG] !== "1") {
  test("passes the isolated specialist-model router contract suite", async () => {
    const childEnvironment = { ...process.env, [CHILD_PROCESS_FLAG]: "1" };
    delete childEnvironment.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(import.meta.url)], {
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(exitCode, 0, output);
  });
} else {
const MODEL_ORIGIN = "https://models.example.test";
const MODEL_ENDPOINT = `${MODEL_ORIGIN}/v1/infer`;
const ENV_KEYS = [
  "NODE_ENV",
  "GEO_MODEL_FLOOD_URL",
  "GEO_MODEL_BURNSCAR_URL",
  "GEO_MODEL_ALLOWED_ORIGINS",
  "GEO_MODEL_MAX_ATTEMPTS",
  "GEO_MODEL_RETRY_DELAY_MS",
  "GEO_MODEL_TIMEOUT_MS",
  "GEO_MODEL_HEALTHCHECK_PATH",
  "GEO_MODEL_HEALTH_TIMEOUT_MS",
  "ANALYSIS_MODEL_URL",
];
const originalEnvironment = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

process.env.NODE_ENV = "production";
process.env.GEO_MODEL_FLOOD_URL = MODEL_ENDPOINT;
process.env.GEO_MODEL_ALLOWED_ORIGINS = MODEL_ORIGIN;
process.env.GEO_MODEL_MAX_ATTEMPTS = "2";
process.env.GEO_MODEL_RETRY_DELAY_MS = "0";
process.env.GEO_MODEL_TIMEOUT_MS = "1000";
delete process.env.GEO_MODEL_HEALTHCHECK_PATH;
delete process.env.GEO_MODEL_HEALTH_TIMEOUT_MS;
delete process.env.ANALYSIS_MODEL_URL;

let inferenceHandler = async () => {
  throw new Error("Inference handler was not configured for this test.");
};
let healthHandler = async () => Response.json({ status: "ok" });
let stacHandler = (requestBody) => {
  const collection = requestBody.collections?.[0] || "sentinel-2-l2a";
  return [stacFeature(collection, 1)];
};
let inferenceCalls = 0;
let healthCalls = 0;

function polygon(bbox) {
  const [west, south, east, north] = bbox;
  return {
    type: "Polygon",
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]],
  };
}

function inferenceContractResponse(requestBody, overrides) {
  const startedAt = "2026-08-11T12:00:00.000Z";
  const completedAt = "2026-08-11T12:00:01.000Z";
  return {
    contract: "geolens-inference/v1",
    requestId: requestBody.requestId,
    runId: randomUUID(),
    model: {
      id: requestBody.model.id,
      version: "runtime-test-1",
      backend: "contract-test",
    },
    detected: null,
    outcome: "inconclusive",
    geometry: null,
    confidence: null,
    confidenceCalibrated: false,
    summary: "Contract test response.",
    warnings: [],
    provenance: {
      backend: "contract-test",
      backendVersion: "1",
      modelId: requestBody.model.id,
      sceneIds: requestBody.scenes.map((scene) => scene.id),
      startedAt,
      completedAt,
    },
    ...overrides,
  };
}

function inferenceJson(requestBody, overrides) {
  return Response.json(inferenceContractResponse(requestBody, overrides), {
    headers: {
      "X-GeoLens-Contract": "geolens-inference/v1",
      "X-GeoLens-Backend": "contract-test",
    },
  });
}

function sharedFixtureJson(requestBody, overrides) {
  const response = structuredClone(SHARED_CONTRACT_FIXTURE);
  response.requestId = requestBody.requestId;
  response.model.id = requestBody.model.id;
  response.provenance.modelId = requestBody.model.id;
  response.provenance.sceneIds = requestBody.scenes.map((scene) => scene.id);
  Object.assign(response, overrides);
  return Response.json(response, {
    headers: {
      "X-GeoLens-Contract": response.contract,
      "X-GeoLens-Backend": response.model.backend,
    },
  });
}

function stacFeature(collection, index, datetime = "2024-08-15T10:30:00.000Z") {
  const lower = collection.toLowerCase();
  const radar = lower.includes("sentinel-1");
  const hls = lower.includes("hls");
  const landsat = lower.includes("landsat");
  const bbox = [-90.2, 29.82, -89.92, 30.08];
  const opticalAssets = hls
    ? {
        B02: { href: `https://data.lpdaac.earthdatacloud.nasa.gov/hls-${index}-b02.tif` },
        B03: { href: `https://data.lpdaac.earthdatacloud.nasa.gov/hls-${index}-b03.tif` },
        B04: { href: `https://data.lpdaac.earthdatacloud.nasa.gov/hls-${index}-b04.tif` },
        B8A: { href: `https://data.lpdaac.earthdatacloud.nasa.gov/hls-${index}-b8a.tif` },
        B11: { href: `https://data.lpdaac.earthdatacloud.nasa.gov/hls-${index}-b11.tif` },
        B12: { href: `https://data.lpdaac.earthdatacloud.nasa.gov/hls-${index}-b12.tif` },
      }
    : landsat
      ? {
          blue: { href: `https://landsatlook.usgs.gov/data-${index}-blue.tif` },
          green: { href: `https://landsatlook.usgs.gov/data-${index}-green.tif` },
          red: { href: `https://landsatlook.usgs.gov/data-${index}-red.tif` },
          nir08: { href: `https://landsatlook.usgs.gov/data-${index}-nir.tif` },
          swir16: { href: `https://landsatlook.usgs.gov/data-${index}-swir1.tif` },
          swir22: { href: `https://landsatlook.usgs.gov/data-${index}-swir2.tif` },
        }
      : {
          B02: { href: `https://sentinel-cogs.s3.amazonaws.com/data-${index}-b02.tif` },
          B03: { href: `https://sentinel-cogs.s3.amazonaws.com/data-${index}-b03.tif` },
          B04: { href: `https://sentinel-cogs.s3.amazonaws.com/data-${index}-b04.tif` },
          B08: { href: `https://sentinel-cogs.s3.amazonaws.com/data-${index}-b08.tif` },
          B8A: { href: `https://sentinel-cogs.s3.amazonaws.com/data-${index}-b8a.tif` },
          B11: { href: `https://sentinel-cogs.s3.amazonaws.com/data-${index}-b11.tif` },
          B12: { href: `https://sentinel-cogs.s3.amazonaws.com/data-${index}-b12.tif` },
        };
  return {
    type: "Feature",
    id: `${collection}-new-orleans-${index}`,
    collection,
    bbox,
    geometry: polygon(bbox),
    properties: {
      datetime,
      platform: radar ? "sentinel-1a" : hls ? "hls-s30" : landsat ? "landsat-9" : "sentinel-2a",
      instruments: radar ? ["c-sar"] : ["msi"],
      gsd: radar ? 10 : landsat || hls ? 30 : 10,
      "eo:cloud_cover": radar ? null : 4,
    },
    assets: radar
      ? {
          vv: { href: `https://sentinel-cogs.s3.amazonaws.com/data-${index}-vv.tif` },
          vh: { href: `https://sentinel-cogs.s3.amazonaws.com/data-${index}-vh.tif` },
        }
      : opticalAssets,
    links: [{ rel: "self", href: `https://catalog.example.test/${collection}/${index}` }],
  };
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url === MODEL_ENDPOINT && (init.method || "GET") === "POST") {
    inferenceCalls += 1;
    return inferenceHandler(input, init);
  }
  if (url === `${MODEL_ORIGIN}/healthz`) {
    healthCalls += 1;
    return healthHandler(input, init);
  }
  if (url.includes("eonet.gsfc.nasa.gov")) return Response.json({ events: [] });
  if (url.includes("openrouter.ai")) throw new Error("The deterministic request must not call OpenRouter.");
  if (url.includes("/search")) {
    const requestBody = typeof init.body === "string" ? JSON.parse(init.body) : {};
    return Response.json({
      type: "FeatureCollection",
      features: stacHandler(requestBody),
    });
  }
  throw new Error(`Unexpected external request: ${url}`);
};

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("model-contract", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

const workerPromise = loadWorker();
let apiCalls = 0;

function testEnvironment() {
  return {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  };
}

async function analyze(query) {
  const worker = await workerPromise;
  const response = await worker.fetch(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": `198.51.100.${apiCalls += 1}`,
      },
      body: JSON.stringify({ query, clientDate: "2026-08-11" }),
    }),
    testEnvironment(),
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  return response.json();
}

function resetModelConfiguration() {
  process.env.GEO_MODEL_FLOOD_URL = MODEL_ENDPOINT;
  delete process.env.GEO_MODEL_BURNSCAR_URL;
  process.env.GEO_MODEL_ALLOWED_ORIGINS = MODEL_ORIGIN;
  process.env.GEO_MODEL_MAX_ATTEMPTS = "2";
  process.env.GEO_MODEL_RETRY_DELAY_MS = "0";
  process.env.GEO_MODEL_TIMEOUT_MS = "1000";
  delete process.env.GEO_MODEL_HEALTHCHECK_PATH;
  healthHandler = async () => Response.json({ status: "ok" });
  stacHandler = (requestBody) => {
    const collection = requestBody.collections?.[0] || "sentinel-2-l2a";
    return [stacFeature(collection, 1)];
  };
  inferenceCalls = 0;
  healthCalls = 0;
}

after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("accepts a positive inference only with valid in-AOI GeoJSON", async () => {
  resetModelConfiguration();
  const serviceRunId = "b09fcb51-3008-4a87-856d-f6a51f85a875";
  inferenceHandler = async (_input, init) => {
    const body = JSON.parse(String(init.body));
    assert.equal(init.headers.get("X-GeoLens-Contract"), "geolens-inference/v1");
    assert.equal(init.headers.get("X-GeoLens-Attempt"), "1");
    assert.equal(init.headers.get("Idempotency-Key"), body.requestId);
    assert.equal(body.model.id, "prithvi-eo-2.0-sen1floods11");
    assert.equal(body.model.version, "2.0-300M");
    return sharedFixtureJson(body, {
      runId: serviceRunId,
    });
  };

  const result = await analyze("אתר הצפה בניו אורלינס ב-2024-08-15 והצג פוליגון contract-positive");
  assert.equal(inferenceCalls, 1);
  assert.equal(result.model.status, "completed");
  assert.equal(result.model.detected, true);
  assert.equal(result.model.calibratedConfidence, true);
  assert.equal(result.model.version, "runtime-test-1");
  assert.equal(result.model.backend, "contract-test");
  assert.equal(result.model.runId, serviceRunId);
  assert.equal(result.model.completedAt, "2026-08-11T12:00:01.000Z");
  assert.equal(result.findingStatus, "detected");
  assert.equal(result.detectionGeometry.type, "Polygon");
  assert.ok(result.measurements.areaKm2 > 0);
});

test("accepts an explicit negative inference without geometry", async () => {
  resetModelConfiguration();
  inferenceHandler = async (_input, init) => {
    const body = JSON.parse(String(init.body));
    return inferenceJson(body, {
      detected: false,
      outcome: "negative",
      confidence: 0.91,
      confidenceCalibrated: true,
      summary: "No flood pixels detected.",
    });
  };

  const result = await analyze("אתר הצפה בניו אורלינס ב-2024-08-15 והצג פוליגון contract-negative");
  assert.equal(inferenceCalls, 1);
  assert.equal(result.model.status, "completed");
  assert.equal(result.model.detected, false);
  assert.equal(result.findingStatus, "not-detected");
  assert.equal(result.detectionGeometry, null);
  assert.equal(result.feasibility.realModelRun, true);
  assert.equal(result.feasibility.canConcludeAbsence, true);
});

test("rejects a positive response with invalid GeoJSON", async () => {
  resetModelConfiguration();
  inferenceHandler = async (_input, init) => {
    const body = JSON.parse(String(init.body));
    return inferenceJson(body, {
      detected: true,
      outcome: "positive",
      confidence: 0.99,
      confidenceCalibrated: true,
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-90.12, 29.9],
          [-90.02, 29.9],
          [-90.02, 30.0],
          [-90.12, 30.0],
        ]],
      },
    });
  };

  const result = await analyze("אתר הצפה בניו אורלינס ב-2024-08-15 והצג פוליגון contract-invalid-geometry");
  assert.equal(result.model.status, "failed");
  assert.equal(result.findingStatus, "indeterminate");
  assert.equal(result.detectionGeometry, null);
  assert.ok(result.model.reasonCodes.includes("INVALID_MODEL_GEOMETRY"));
  assert.equal(result.model.errorCode, "INVALID_RESPONSE_GEOMETRY");
});

test("retries one transient upstream failure with a stable idempotency key", async () => {
  resetModelConfiguration();
  const idempotencyKeys = [];
  inferenceHandler = async (_input, init) => {
    idempotencyKeys.push(init.headers.get("Idempotency-Key"));
    if (inferenceCalls === 1) {
      return new Response("busy", { status: 503, headers: { "Retry-After": "0" } });
    }
    const body = JSON.parse(String(init.body));
    return inferenceJson(body, {
      detected: true,
      outcome: "positive",
      confidence: 0.88,
      confidenceCalibrated: true,
      geometry: polygon([-90.11, 29.91, -90.03, 29.99]),
    });
  };

  const result = await analyze("אתר הצפה בניו אורלינס ב-2024-08-15 והצג פוליגון contract-retry");
  assert.equal(result.model.status, "completed");
  assert.equal(inferenceCalls, 2);
  assert.equal(idempotencyKeys[0], idempotencyKeys[1]);
});

test("applies a bounded timeout to every retry attempt", async () => {
  resetModelConfiguration();
  process.env.GEO_MODEL_TIMEOUT_MS = "250";
  inferenceHandler = async (_input, init) => new Promise((_resolve, reject) => {
    const abort = () => reject(init.signal.reason || new DOMException("Timed out", "AbortError"));
    if (init.signal.aborted) abort();
    else init.signal.addEventListener("abort", abort, { once: true });
  });

  const startedAt = Date.now();
  const result = await analyze("אתר הצפה בניו אורלינס ב-2024-08-15 והצג פוליגון contract-timeout");
  const elapsed = Date.now() - startedAt;
  assert.equal(inferenceCalls, 2);
  assert.equal(result.model.status, "failed");
  assert.equal(result.model.errorCode, "UPSTREAM_TIMEOUT");
  assert.ok(result.model.reasonCodes.includes("MODEL_FAILED"));
  assert.ok(elapsed >= 450 && elapsed < 2_000, `unexpected timeout duration: ${elapsed}ms`);
});

test("fails closed when the endpoint origin is not allowlisted", async () => {
  resetModelConfiguration();
  process.env.GEO_MODEL_FLOOD_URL = "https://169.254.169.254/latest/infer";
  process.env.GEO_MODEL_ALLOWED_ORIGINS = "https://169.254.169.254";

  const result = await analyze("אתר הצפה בניו אורלינס ב-2024-08-15 והצג פוליגון contract-ssrf");
  assert.equal(inferenceCalls, 0);
  assert.equal(result.model.status, "failed");
  assert.equal(result.findingStatus, "indeterminate");
  assert.match(result.model.message, /רשת פרטית|כתובת מערכת חסומה/);
});

test("stops before inference when an optional health check reports not ready", async () => {
  resetModelConfiguration();
  process.env.GEO_MODEL_HEALTHCHECK_PATH = "/healthz";
  healthHandler = async () => Response.json({ status: "degraded", ready: false });

  const result = await analyze("אתר הצפה בניו אורלינס ב-2024-08-15 והצג פוליגון contract-health");
  assert.equal(healthCalls, 1);
  assert.equal(inferenceCalls, 0);
  assert.equal(result.model.status, "failed");
  assert.equal(result.findingStatus, "indeterminate");
  assert.match(result.model.message, /בדיקת המוכנות/);
});

test("rejects a validation-only service even when its readiness flag is true", async () => {
  resetModelConfiguration();
  process.env.GEO_MODEL_HEALTHCHECK_PATH = "/healthz";
  healthHandler = async () => Response.json({
    ready: true,
    status: "validation-only",
    contract: "geolens-inference/v1",
    backend: "mock",
    backendVersion: "validation-only/v1",
    inferenceEnabled: false,
    modelIds: ["prithvi-eo-2.0-sen1floods11"],
    detail: "The service validates requests but does not execute inference.",
  });

  const result = await analyze("אתר הצפה בניו אורלינס ב-2024-08-15 והצג פוליגון contract-validation-only");
  assert.equal(healthCalls, 1);
  assert.equal(inferenceCalls, 0);
  assert.equal(result.model.status, "failed");
  assert.equal(result.model.errorCode, "HEALTHCHECK_FAILED");
  assert.equal(result.findingStatus, "indeterminate");
});

test("rejects a paired-scene model response with incomplete provenance", async () => {
  resetModelConfiguration();
  process.env.GEO_MODEL_BURNSCAR_URL = MODEL_ENDPOINT;
  stacHandler = (requestBody) => {
    const collection = requestBody.collections?.[0] || "sentinel-2-l2a";
    return [
      stacFeature(collection, 1, "2024-08-13T10:30:00.000Z"),
      stacFeature(collection, 2, "2024-08-14T10:30:00.000Z"),
      stacFeature(collection, 3, "2024-08-15T10:30:00.000Z"),
    ];
  };
  inferenceHandler = async (_input, init) => {
    const body = JSON.parse(String(init.body));
    assert.equal(body.model.id, "prithvi-eo-2.0-burnscars");
    assert.ok(body.scenes.length >= 2);
    const response = inferenceContractResponse(body, {
      detected: false,
      outcome: "negative",
      confidence: 0.9,
      confidenceCalibrated: true,
      summary: "No burn scar detected.",
    });
    const beforeSceneIds = body.scenes
      .filter((scene) => new Date(scene.datetime).getTime() < new Date("2024-08-15").getTime())
      .map((scene) => scene.id)
      .slice(0, 2);
    assert.equal(beforeSceneIds.length, 2);
    response.provenance.sceneIds = beforeSceneIds;
    return Response.json(response, {
      headers: {
        "X-GeoLens-Contract": "geolens-inference/v1",
        "X-GeoLens-Backend": "contract-test",
      },
    });
  };

  const result = await analyze("אתר צלקת שריפה בניו אורלינס ב-2024-08-15 והצג פוליגון contract-incomplete-provenance");
  assert.equal(inferenceCalls, 1);
  assert.equal(result.model.status, "failed");
  assert.equal(result.model.errorCode, "INVALID_RESPONSE_CONTRACT");
  assert.equal(result.findingStatus, "indeterminate");
});
}
