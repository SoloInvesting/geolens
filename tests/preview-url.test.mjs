import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { displayPreviewUrl } from "../lib/preview-url.ts";

test("proxies only approved CDSE preview hosts", () => {
  const source = "https://datahub.creodias.eu/odata/v1/Assets(01234567-89ab-cdef-0123-456789abcdef)/$value";
  assert.equal(displayPreviewUrl(source), `/api/preview?url=${encodeURIComponent(source)}`);
  assert.equal(displayPreviewUrl("https://example.test/preview.jpg"), "https://example.test/preview.jpg");
  assert.equal(displayPreviewUrl("not a URL"), null);
});

test("keeps the server-side preview proxy narrowly allowlisted", async () => {
  const route = await readFile(new URL("../app/api/preview/route.ts", import.meta.url), "utf8");
  assert.match(route, /datahub\.creodias\.eu/);
  assert.match(route, /zipper\.creodias\.eu/);
  assert.match(route, /url\.protocol !== "https:"/);
  assert.match(route, /MAX_IMAGE_BYTES/);
  assert.match(route, /imageMime/);
  assert.doesNotMatch(route, /redirect:\s*"follow"/);
});
