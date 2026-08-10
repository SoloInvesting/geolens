import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the GeoLens product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>GeoLens \| סוכן פענוח לוויין עצמאי<\/title>/i);
  assert.match(html, /GeoLens/);
  assert.match(html, /סוכן פענוח עצמאי/);
  assert.match(html, /מה תרצה לאתר בכדור הארץ/);
  assert.match(html, /מפת ניתוח לוויין אינטראקטיבית/);
  assert.doesNotMatch(html, /חיישן ראשי|סצנה נבחרת|מצב זיהוי|מקורות פעילים/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps the independent agent architecture and model routing visible in source", async () => {
  const [page, layout, packageJson, agent, modelRouter, route] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/agent.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/model-router.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/analyze/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /GeoAgentApp/);
  assert.match(layout, /lang="he"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(agent, /runDedicatedModel/);
  assert.match(agent, /sentinel-1-grd/);
  assert.match(agent, /sentinel-2-l2a/);
  assert.match(agent, /eonet\.gsfc\.nasa\.gov/);
  assert.match(modelRouter, /GEO_MODEL_FLOOD_URL/);
  assert.match(modelRouter, /GEO_MODEL_BURNSCAR_URL/);
  assert.match(modelRouter, /GEO_MODEL_VOLCANO_URL/);
  assert.match(modelRouter, /GEO_MODEL_OBJECT_URL/);
  assert.match(modelRouter, /prithvi-eo-2.0-sen1floods11/);
  assert.match(modelRouter, /volcanic-hotspot-rf-s2/);
  assert.match(modelRouter, /yolo-obb-geospatial/);
  assert.match(route, /analyzeRequest/);
});
