import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("quality", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

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

function stacFeature(collection, date, index) {
  const radar = collection.includes("sentinel-1");
  const hls = collection.toLowerCase().includes("hls");
  const landsat = collection.includes("landsat");
  const bbox = [-3.85, 40.31, -3.52, 40.62];
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
    id: `${collection}-T30TVK-${date}-${index}`,
    collection,
    bbox,
    geometry: polygon(bbox),
    properties: {
      datetime: `${date}T10:30:00.000Z`,
      platform: radar ? "sentinel-1a" : hls ? "hls-s30" : landsat ? "landsat-9" : "sentinel-2a",
      instruments: radar ? ["c-sar"] : ["msi"],
      gsd: radar ? 10 : landsat || hls ? 30 : 10,
      "eo:cloud_cover": radar ? null : 8,
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

function testEnvironment() {
  return {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  };
}

async function analyze(worker, query) {
  const response = await worker.fetch(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, clientDate: "2026-08-10" }),
    }),
    testEnvironment(),
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  return response.json();
}

test("passes deterministic Hebrew location, time, evidence, safety, and cache gates", async () => {
  const worker = await loadWorker();
  const originalFetch = globalThis.fetch;
  let catalogRequests = 0;
  let openRouterRequests = 0;

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("openrouter.ai")) {
      openRouterRequests += 1;
      throw new Error("The deterministic fast path must not call OpenRouter.");
    }
    if (url.includes("eonet.gsfc.nasa.gov")) return Response.json({ events: [] });
    if (url.includes("/search")) {
      catalogRequests += 1;
      const body = JSON.parse(String(init.body || "{}"));
      const collection = body.collections?.[0] || "sentinel-2-l2a";
      return Response.json({
        type: "FeatureCollection",
        features: [
          stacFeature(collection, "2024-08-08", 1),
          stacFeature(collection, "2024-08-22", 2),
        ],
      });
    }
    throw new Error(`Unexpected external request: ${url}`);
  };

  try {
    const madrid = await analyze(worker, "הצג תמונת לוויין של מדריד באוגוסט 2024");
    assert.equal(madrid.ok, true);
    assert.match(madrid.location.name, /Madrid/);
    assert.equal(madrid.location.source, "known-location");
    assert.equal(madrid.interpretation.locationText, "Madrid, Community of Madrid, Spain");
    assert.equal(madrid.interpretation.startDate, "2024-08-01");
    assert.equal(madrid.interpretation.endDate, "2024-08-31");
    assert.equal(madrid.interpretation.dateLabel, "אוגוסט 2024");
    assert.equal(madrid.brain.provider, "GeoLens");
    assert.equal(madrid.brain.status, "completed");
    assert.equal(madrid.model.status, "not-applicable");
    assert.ok(madrid.scenes.length > 0);
    assert.ok(madrid.feasibility.eligibleSceneIds.length > 0);
    assert.equal(madrid.feasibility.realModelRun, false);
    assert.match(madrid.answer, /לא נדרשה ריצת מודל סגמנטציה/);
    assert.equal(openRouterRequests, 0);

    const requestsAfterFirstRun = catalogRequests;
    const repeated = await analyze(worker, "הצג תמונת לוויין של מדריד באוגוסט 2024");
    assert.equal(repeated.mission.missionId, madrid.mission.missionId);
    assert.equal(catalogRequests, requestsAfterFirstRun, "identical analysis should reuse the short-lived catalog cache");

    const wildfire = await analyze(worker, "אתר צלקת שריפה במדריד ב-2024-08-15 והצג פוליגון");
    assert.equal(wildfire.interpretation.intent, "wildfire");
    assert.equal(wildfire.interpretation.dateLabel, "2024-08-15");
    assert.ok(wildfire.scenes.some((scene) => scene.role === "primary"));
    assert.ok(wildfire.scenes.some((scene) => scene.role === "confirmation"));
    assert.ok(wildfire.feasibility.checks.some((check) => check.code === "BASELINE_REQUIRED" && check.status === "pass"));
    assert.ok(wildfire.feasibility.eligibleSceneIds.length >= 2);
    assert.equal(wildfire.model.status, "not-configured");
    assert.equal(wildfire.feasibility.realModelRun, false);
    assert.equal(wildfire.findingStatus, "indeterminate");
    assert.equal(wildfire.detectionGeometry, null);
    assert.equal(wildfire.confidenceScore, null);
    assert.match(wildfire.answer, /לא בוצע פענוח פיקסלים/);

    const spain = await analyze(worker, "תאתר שריפות בספרד בשנה האחרונה");
    assert.equal(spain.ok, true);
    assert.equal(spain.interpretation.locationText, "Spain");
    assert.equal(spain.location.name, "Spain");
    assert.equal(spain.interpretation.startDate, "2025-08-10");
    assert.equal(spain.interpretation.endDate, "2026-08-10");
    assert.equal(spain.feasibility.status, "blocked");
    assert.ok(spain.feasibility.checks.some((check) => check.code === "AOI_TOO_LARGE" && check.status === "fail"));
    assert.ok(!spain.feasibility.checks.some((check) => check.code === "LOCATION_UNRESOLVED"));
    assert.match(spain.clarification, /זוהה בהצלחה/);
    assert.equal(spain.feasibility.realModelRun, false);
    assert.equal(spain.findingStatus, "indeterminate");
    assert.equal(spain.confidenceScore, null);
    assert.doesNotMatch(JSON.stringify(spain), /OPENROUTER_API_KEY|GEO_MODEL_TOKEN/);
    assert.equal(openRouterRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
