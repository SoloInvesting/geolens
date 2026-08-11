import { analyzeRequest } from "@/lib/agent";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_QUERY_CHARACTERS = 1_500;
const RATE_CAPACITY = 6;
const RATE_REFILL_PER_MS = RATE_CAPACITY / 60_000;
const MAX_CONCURRENT_PER_CLIENT = 2;
const MAX_TRACKED_CLIENTS = 2_000;

type ClientBudget = {
  tokens: number;
  updatedAt: number;
  inFlight: number;
  lastSeenAt: number;
};

const sharedRateState = globalThis as typeof globalThis & {
  __geoLensClientBudgets?: Map<string, ClientBudget>;
};
const clientBudgets = sharedRateState.__geoLensClientBudgets || new Map<string, ClientBudget>();
sharedRateState.__geoLensClientBudgets = clientBudgets;

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function clientKey(request: Request) {
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "anonymous";
}

function trimBudgets(now: number) {
  if (clientBudgets.size <= MAX_TRACKED_CLIENTS) return;
  const entries = [...clientBudgets.entries()].sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt);
  for (const [key, budget] of entries.slice(0, clientBudgets.size - MAX_TRACKED_CLIENTS)) {
    if (budget.inFlight === 0 || now - budget.lastSeenAt > 5 * 60_000) clientBudgets.delete(key);
  }
}

function acquireClientBudget(request: Request) {
  const now = Date.now();
  const key = clientKey(request);
  const existing = clientBudgets.get(key) || {
    tokens: RATE_CAPACITY,
    updatedAt: now,
    inFlight: 0,
    lastSeenAt: now,
  };
  existing.tokens = Math.min(RATE_CAPACITY, existing.tokens + (now - existing.updatedAt) * RATE_REFILL_PER_MS);
  existing.updatedAt = now;
  existing.lastSeenAt = now;
  clientBudgets.set(key, existing);
  trimBudgets(now);

  if (existing.inFlight >= MAX_CONCURRENT_PER_CLIENT) {
    return { ok: false as const, retryAfterSeconds: 10 };
  }
  if (existing.tokens < 1) {
    const retryAfterSeconds = Math.max(1, Math.ceil((1 - existing.tokens) / RATE_REFILL_PER_MS / 1_000));
    return { ok: false as const, retryAfterSeconds };
  }
  existing.tokens -= 1;
  existing.inFlight += 1;
  let released = false;
  return {
    ok: true as const,
    release() {
      if (released) return;
      released = true;
      existing.inFlight = Math.max(0, existing.inFlight - 1);
      existing.lastSeenAt = Date.now();
    },
  };
}

function validClientDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return undefined;
  const serverNoon = new Date();
  serverNoon.setUTCHours(12, 0, 0, 0);
  return Math.abs(parsed.getTime() - serverNoon.getTime()) <= 2 * 24 * 60 * 60 * 1_000
    ? value
    : undefined;
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/json")) {
    return jsonResponse({ error: "הבקשה חייבת להישלח כ-JSON." }, 415);
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: "הבקשה גדולה מהמגבלה המותרת." }, 413);
  }

  const budget = acquireClientBudget(request);
  if (!budget.ok) {
    return jsonResponse(
      { error: "נשלחו יותר מדי בקשות בזמן קצר. יש לנסות שוב בעוד מעט." },
      429,
      { "Retry-After": String(budget.retryAfterSeconds) },
    );
  }

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return jsonResponse({ error: "הבקשה גדולה מהמגבלה המותרת." }, 413);
    }
    let body: { query?: unknown; clientDate?: unknown };
    try {
      body = JSON.parse(rawBody) as { query?: unknown; clientDate?: unknown };
    } catch {
      return jsonResponse({ error: "גוף הבקשה אינו JSON תקין." }, 400);
    }
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      return jsonResponse({ error: "יש לכתוב בקשת ניתוח." }, 400);
    }
    if (query.length > MAX_QUERY_CHARACTERS) {
      return jsonResponse({ error: `הבקשה מוגבלת ל-${MAX_QUERY_CHARACTERS} תווים.` }, 400);
    }
    const clientDate = validClientDate(body.clientDate);
    const result = await analyzeRequest(query, { referenceDate: clientDate });
    return jsonResponse(result);
  } catch {
    return jsonResponse({
      error: "הסוכן לא הצליח להשלים את הניתוח. אפשר לנסות שוב עם מקום ותאריך מדויקים יותר.",
    }, 500);
  } finally {
    budget.release();
  }
}
