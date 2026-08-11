import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("narrative", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

async function analyze(worker, query) {
  const response = await worker.fetch(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, clientDate: "2026-08-10" }),
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  return response.json();
}

test("accepts a grounded free-model narrative and rejects an unsafe one", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.openrouter;
  process.env.openrouter = "test-openrouter-key";
  let unsafe = false;
  let requests = 0;

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("openrouter.ai")) {
      requests += 1;
      return Response.json({
        model: "test/free-model",
        usage: { cost: 0 },
        choices: [{
          message: {
            content: unsafe
              ? "זוהתה שריפה בוודאות של 98% באמצעות Sentinel-2."
              : JSON.stringify({ answer: "לא ניתן לקבוע אם התרחשו שריפות בכל ספרד מהקלט הזמין. לא בוצע פענוח פיקסלים, ולכן נדרש אזור חיפוש מצומצם יותר." }),
          },
        }],
      });
    }
    if (url.includes("eonet.gsfc.nasa.gov")) return Response.json({ events: [] });
    throw new Error(`Unexpected external request: ${url}`);
  };

  try {
    const worker = await loadWorker();
    const safe = await analyze(worker, "תאתר שריפות בספרד בשנה האחרונה");
    assert.equal(safe.brain.provider, "OpenRouter");
    assert.match(safe.answer, /לא ניתן לקבוע/);
    assert.match(safe.answer, /לא בוצע פענוח פיקסלים/);
    assert.equal(requests, 1);

    unsafe = true;
    const rejected = await analyze(worker, "תאתר שריפות בספרד בשנת 2025");
    assert.doesNotMatch(rejected.answer, /98%|זוהתה שריפה בוודאות/);
    assert.match(rejected.answer, /לא בוצע פענוח פיקסלים/);
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.openrouter;
    else process.env.openrouter = originalKey;
  }
});
