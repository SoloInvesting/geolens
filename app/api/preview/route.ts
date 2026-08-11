const ALLOWED_HOSTS = new Set([
  "datahub.creodias.eu",
  "zipper.creodias.eu",
]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;

function validatedPreviewUrl(value: string | null) {
  if (!value || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (!/^\/odata\/v1\/Assets\([0-9a-f-]{36}\)\/\$value$/i.test(url.pathname)) return null;
    if (url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function imageMime(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  return null;
}

async function fetchPreview(initialUrl: URL, signal: AbortSignal) {
  let current = initialUrl;
  for (let redirect = 0; redirect <= 2; redirect += 1) {
    const response = await fetch(current, {
      signal,
      redirect: "manual",
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      const next = validatedPreviewUrl(location ? new URL(location, current).toString() : null);
      if (!next) throw new Error("unsafe-redirect");
      current = next;
      continue;
    }
    return response;
  }
  throw new Error("too-many-redirects");
}

export async function GET(request: Request) {
  const source = validatedPreviewUrl(new URL(request.url).searchParams.get("url"));
  if (!source) {
    return Response.json({ error: "כתובת התצוגה המקדימה אינה מאושרת." }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const upstream = await fetchPreview(source, controller.signal);
    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => undefined);
      return Response.json({ error: "תמונת המקור אינה זמינה כרגע." }, { status: 502 });
    }
    const declaredLength = Number(upstream.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
      await upstream.body?.cancel().catch(() => undefined);
      return Response.json({ error: "תמונת המקור גדולה מהמגבלה המותרת." }, { status: 413 });
    }
    const buffer = await upstream.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
      return Response.json({ error: "תמונת המקור אינה תקינה." }, { status: 502 });
    }
    const mime = imageMime(new Uint8Array(buffer));
    if (!mime) {
      return Response.json({ error: "המקור לא החזיר תמונה נתמכת." }, { status: 502 });
    }
    return new Response(buffer, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return Response.json({ error: "לא ניתן לטעון את תמונת המקור." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
