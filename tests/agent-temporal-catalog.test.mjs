import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker(label) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("temporal-catalog", `${label}-${process.pid}-${Date.now()}`);
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

function stacFeature(collection, date) {
  const radar = collection.includes("sentinel-1");
  const landsat = collection.includes("landsat");
  const bbox = [-3.85, 40.31, -3.52, 40.62];
  const assets = radar
    ? {
        vv: { href: `https://catalog.test/${collection}-${date}-vv.tif` },
        vh: { href: `https://catalog.test/${collection}-${date}-vh.tif` },
      }
    : landsat
      ? {
          blue: { href: `https://catalog.test/${collection}-${date}-blue.tif` },
          green: { href: `https://catalog.test/${collection}-${date}-green.tif` },
          red: { href: `https://catalog.test/${collection}-${date}-red.tif` },
          nir08: { href: `https://catalog.test/${collection}-${date}-nir.tif` },
          swir16: { href: `https://catalog.test/${collection}-${date}-swir1.tif` },
          swir22: { href: `https://catalog.test/${collection}-${date}-swir2.tif` },
        }
      : {
          B02: { href: `https://catalog.test/${collection}-${date}-b02.tif` },
          B03: { href: `https://catalog.test/${collection}-${date}-b03.tif` },
          B04: { href: `https://catalog.test/${collection}-${date}-b04.tif` },
          B08: { href: `https://catalog.test/${collection}-${date}-b08.tif` },
          B8A: { href: `https://catalog.test/${collection}-${date}-b8a.tif` },
          B11: { href: `https://catalog.test/${collection}-${date}-b11.tif` },
          B12: { href: `https://catalog.test/${collection}-${date}-b12.tif` },
        };
  return {
    type: "Feature",
    id: `${collection}-${date}`,
    collection,
    bbox,
    geometry: polygon(bbox),
    properties: {
      datetime: `${date}T10:30:00.000Z`,
      platform: radar ? "sentinel-1a" : landsat ? "landsat-9" : "sentinel-2a",
      instruments: radar ? ["c-sar"] : ["msi"],
      gsd: radar ? 10 : landsat ? 30 : 10,
      "eo:cloud_cover": radar ? null : 5,
    },
    assets,
    links: [{ rel: "self", href: `https://catalog.test/items/${collection}-${date}` }],
  };
}

function testEnvironment() {
  return {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
}

async function analyze(worker, query, ipSuffix) {
  const response = await worker.fetch(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": `198.51.100.${ipSuffix}`,
      },
      body: JSON.stringify({ query, clientDate: "2026-08-10" }),
    }),
    testEnvironment(),
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  return response.json();
}

function parsedCatalogWindow(datetime) {
  const [start, end] = datetime.split("/");
  return { start: start.slice(0, 10), end: end.slice(0, 10) };
}

test("tiles a year across a bounded number of catalog windows", async () => {
  const originalFetch = globalThis.fetch;
  const catalogWindows = new Set();

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("openrouter.ai")) throw new Error("Known requests must use the deterministic planner.");
    if (url.includes("/search")) {
      const body = JSON.parse(String(init.body || "{}"));
      catalogWindows.add(body.datetime);
      const collection = body.collections?.[0] || "sentinel-2-l2a";
      return Response.json({
        type: "FeatureCollection",
        features: [stacFeature(collection, body.datetime.slice(0, 10))],
      });
    }
    throw new Error(`Unexpected external request: ${url}`);
  };

  try {
    const worker = await loadWorker("year");
    const result = await analyze(worker, "show satellite imagery of Madrid during the last year", 31);
    const windows = [...catalogWindows].map(parsedCatalogWindow).sort((left, right) => left.start.localeCompare(right.start));

    assert.equal(result.interpretation.startDate, "2025-08-10");
    assert.equal(result.interpretation.endDate, "2026-08-10");
    assert.equal(windows.length, 4, "a one-year search should use four bounded temporal tiles");
    assert.equal(windows[0].start, result.interpretation.startDate);
    assert.equal(windows.at(-1).end, result.interpretation.endDate);
    for (let index = 1; index < windows.length; index += 1) {
      const expectedStart = new Date(`${windows[index - 1].end}T00:00:00Z`);
      expectedStart.setUTCDate(expectedStart.getUTCDate() + 1);
      assert.equal(windows[index].start, expectedStart.toISOString().slice(0, 10), "tiles must be contiguous");
    }
    assert.ok(result.scenes.some((scene) => scene.datetime.startsWith(windows[0].start)), "the early part of the range must be represented");
    assert.ok(result.scenes.some((scene) => scene.datetime.startsWith(windows.at(-1).start)), "the late part of the range must be represented");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a distant EONET event and accepts only a genuinely near event", async () => {
  const originalFetch = globalThis.fetch;
  const eonetBboxes = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.hostname === "eonet.gsfc.nasa.gov") {
      eonetBboxes.push(url.searchParams.get("bbox"));
      const september = url.searchParams.get("start")?.startsWith("2024-09");
      const event = september
        ? {
            id: "near-madrid",
            title: "Wildfire just outside Madrid AOI",
            link: "https://eonet.test/near-madrid",
            sources: [{ id: "TEST", url: "https://source.test/near-madrid" }],
            geometry: [{ date: "2024-09-15T00:00:00Z", type: "Point", coordinates: [-3.95, 40.42] }],
          }
        : {
            id: "regional-but-distant",
            title: "Distant regional wildfire",
            link: "https://eonet.test/regional-but-distant",
            sources: [{ id: "TEST", url: "https://source.test/regional-but-distant" }],
            geometry: [{ date: "2024-08-15T00:00:00Z", type: "Point", coordinates: [-0.5, 40.42] }],
          };
      return Response.json({ events: [event] });
    }
    if (url.hostname === "openrouter.ai") throw new Error("Known requests must use the deterministic planner.");
    if (url.pathname.endsWith("/search")) {
      const body = JSON.parse(String(init.body || "{}"));
      const collection = body.collections?.[0] || "sentinel-2-l2a";
      return Response.json({
        type: "FeatureCollection",
        features: [stacFeature(collection, body.datetime.slice(0, 10))],
      });
    }
    throw new Error(`Unexpected external request: ${url}`);
  };

  try {
    const worker = await loadWorker("eonet-distance");
    const distant = await analyze(worker, "detect wildfire in Madrid on 2024-08-15", 32);
    const near = await analyze(worker, "detect wildfire in Madrid on 2024-09-15", 33);

    assert.deepEqual(distant.events, []);
    assert.equal(distant.ledger.claims.find((claim) => claim.id === "claim:catalog-context")?.status, "not-established");
    assert.deepEqual(near.events.map((event) => event.id), ["near-madrid"]);
    assert.equal(near.ledger.claims.find((claim) => claim.id === "claim:catalog-context")?.status, "observed");

    const [west, north, east, south] = eonetBboxes[0].split(",").map(Number);
    assert.ok(west > -4.1 && east < -3.3, "EONET longitude filter must remain local to Madrid");
    assert.ok(north < 40.8 && south > 40.1, "EONET latitude filter must remain local to Madrid");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
