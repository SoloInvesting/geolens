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
  assert.match(html, /מה תרצה לאתר\?/);
  assert.match(html, /שיחה עם GeoLens/);
  assert.match(html, /שיחה חדשה/);
  assert.match(html, /תצלום לוויין/);
  assert.match(html, /מפת ניתוח לוויין אינטראקטיבית/);
  assert.doesNotMatch(html, /MissionSpec|שער היתכנות|תהליך הפענוח|מתכון פענוח/);
  assert.doesNotMatch(html, /חיישן ראשי|סצנה נבחרת|מצב זיהוי|מקורות פעילים/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps the evidence-first agent architecture and model routing visible in source", async () => {
  const [page, layout, packageJson, agent, modelRouter, openRouter, dataBroker, mission, feasibility, gis, evidence, app, map, route, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/agent.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/model-router.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/openrouter.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/data-broker.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/mission.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/feasibility.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/gis.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/evidence.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/GeoAgentApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/GeoMap.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/analyze/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /GeoAgentApp/);
  assert.match(layout, /lang="he"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(agent, /runDedicatedModel/);
  assert.match(agent, /querySatelliteScenes/);
  assert.match(agent, /buildMissionSpec/);
  assert.match(agent, /assessFeasibility/);
  assert.match(agent, /buildEvidenceLedger/);
  assert.match(agent, /eonet\.gsfc\.nasa\.gov/);
  assert.match(modelRouter, /GEO_MODEL_FLOOD_URL/);
  assert.match(modelRouter, /GEO_MODEL_BURNSCAR_URL/);
  assert.match(modelRouter, /GEO_MODEL_VOLCANO_URL/);
  assert.match(modelRouter, /GEO_MODEL_OPEN_VOCAB_URL/);
  assert.match(modelRouter, /GEO_MODEL_VESSEL_URL/);
  assert.match(modelRouter, /prithvi-eo-2.0-sen1floods11/);
  assert.match(modelRouter, /volcanic-hotspot-rf-s2/);
  assert.match(modelRouter, /grounding-dino-sam2-eo/);
  assert.match(modelRouter, /xview3-vessel-s1/);
  assert.match(dataBroker, /earth-search\.aws\.element84\.com/);
  assert.match(dataBroker, /planetarycomputer\.microsoft\.com\/api\/stac\/v1\/search/);
  assert.match(dataBroker, /anonymous-transient-sas/);
  assert.match(dataBroker, /cmr\.earthdata\.nasa\.gov\/stac\/LPCLOUD/);
  assert.match(dataBroker, /landsat-c2-l2/);
  assert.match(dataBroker, /sentinel-2-c1-l2a/);
  assert.match(dataBroker, /HLSS30_2\.0/);
  assert.match(dataBroker, /storage:requester_pays/);
  assert.match(mission, /geolens-mission\/v1/);
  assert.match(feasibility, /findingStatus/);
  assert.match(feasibility, /MODEL_ENDPOINT_UNCONFIGURED/);
  assert.match(gis, /spherical-wgs84/);
  assert.match(evidence, /geolens-evidence\/v1/);
  assert.match(app, /EvidenceDrawer/);
  assert.match(app, /AssistantTextMessage/);
  assert.match(app, /SatelliteCanvas/);
  assert.match(app, /setCanvasMode/);
  assert.match(app, /resetConversation/);
  assert.match(app, /conversationContext/);
  assert.match(map, /analysis\.feasibility\.realModelRun/);
  assert.match(map, /analysis\.model\.status === "completed"/);
  assert.match(map, /detectionPalette/);
  assert.doesNotMatch(app, /result-brief|MissionSpec מאומת|תהליך הפענוח|מתכון פענוח/);
  assert.match(styles, /\.geo-app,[\s\S]*?\.canvas-shell/);
  assert.match(styles, /\.geo-app \{[\s\S]*?width:\s*100vw;[\s\S]*?height:\s*100dvh;/);
  assert.match(styles, /\.chat-overlay[\s\S]*?position:\s*absolute/);
  assert.match(styles, /\.message-stream[\s\S]*?overflow-y:\s*auto/);
  assert.match(openRouter, /openrouter\/free/);
  assert.match(openRouter, /OPENROUTER_API_KEY/);
  assert.match(openRouter, /writeAnalysisNarrative/);
  assert.match(openRouter, /Never claim absence/);
  assert.doesNotMatch(openRouter, /openrouter\/auto/);
  assert.match(route, /analyzeRequest/);
});
