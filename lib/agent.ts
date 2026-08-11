import type {
  AgentStep,
  AnalysisIntent,
  AnalysisRecipe,
  AnalysisResponse,
  EventEvidence,
  GeoJsonGeometry,
  InterpreterResult,
  ModelRun,
  SceneResult,
} from "@/app/types";
import { runDedicatedModel, selectedModel } from "@/lib/model-router";
import { planWithOpenRouter } from "@/lib/openrouter";
import { querySatelliteScenes } from "@/lib/data-broker";
import { buildMissionSpec } from "@/lib/mission";
import { assessFeasibility, type ModelObservation } from "@/lib/feasibility";
import { tryMeasureGeometry } from "@/lib/gis";
import { buildEvidenceLedger } from "@/lib/evidence";
import {
  extractLocationCandidate,
  inferIntentFromQuery,
  isPlausibleLocationCandidate,
  parseCoordinatePair,
  parseDateRange,
} from "@/lib/request-parser";

type KnownLocation = {
  names: string[];
  canonical: string;
  latitude: number;
  longitude: number;
  bbox: [number, number, number, number];
};

const KNOWN_LOCATIONS: KnownLocation[] = [
  {
    names: ["madrid", "מדריד"],
    canonical: "Madrid, Community of Madrid, Spain",
    latitude: 40.4168,
    longitude: -3.7038,
    bbox: [-3.888, 40.312, -3.518, 40.643],
  },
  {
    names: ["spain", "ספרד", "españa", "espana"],
    canonical: "Spain",
    latitude: 40.2085,
    longitude: -3.713,
    bbox: [-9.3929, 35.9469, 3.0395, 43.7483],
  },
  {
    names: ["new orleans", "ניו אורלינס"],
    canonical: "New Orleans, Louisiana, USA",
    latitude: 29.9511,
    longitude: -90.0715,
    bbox: [-90.35, 29.75, -89.75, 30.18],
  },
  {
    names: ["lahaina", "לחאינה", "להאינה", "maui", "מאווי"],
    canonical: "Lahaina, Maui, Hawaii, USA",
    latitude: 20.8783,
    longitude: -156.6825,
    bbox: [-156.78, 20.81, -156.56, 20.98],
  },
  {
    names: ["iceland", "איסלנד", "reykjanes", "רייקיאנס"],
    canonical: "Iceland",
    latitude: 64.88,
    longitude: -19.02,
    bbox: [-24.8, 63.2, -13.0, 66.8],
  },
  {
    names: ["etna", "אטנה", "sicily", "סיציליה"],
    canonical: "Mount Etna, Sicily, Italy",
    latitude: 37.751,
    longitude: 14.993,
    bbox: [14.72, 37.55, 15.25, 37.92],
  },
  {
    names: ["haifa", "חיפה", "haifa bay", "מפרץ חיפה"],
    canonical: "Haifa, Israel",
    latitude: 32.794,
    longitude: 34.9896,
    bbox: [34.82, 32.69, 35.12, 32.9],
  },
  {
    names: ["tel aviv", "תל אביב"],
    canonical: "Tel Aviv, Israel",
    latitude: 32.0853,
    longitude: 34.7818,
    bbox: [34.68, 31.98, 34.9, 32.2],
  },
  {
    names: ["israel", "ישראל"],
    canonical: "Israel",
    latitude: 31.5,
    longitude: 34.8,
    bbox: [34.2, 29.4, 35.9, 33.4],
  },
  {
    names: ["los angeles", "לוס אנג'לס", "לוס אנג׳לס"],
    canonical: "Los Angeles, California, USA",
    latitude: 34.0522,
    longitude: -118.2437,
    bbox: [-118.72, 33.7, -117.7, 34.35],
  },
  {
    names: ["washington dc", "washington d.c", "וושינגטון"],
    canonical: "Washington, District of Columbia, USA",
    latitude: 38.9072,
    longitude: -77.0369,
    bbox: [-77.18, 38.79, -76.89, 39.02],
  },
];

const RECIPES: Record<AnalysisIntent, AnalysisRecipe> = {
  flood: {
    title: "מיפוי הצפה רב-חיישני",
    target: "מים חדשים, הצפה וניתוקי קרקע",
    primarySensor: "Sentinel-1 SAR",
    confirmationSensor: "Sentinel-2 MSI",
    bands: ["VV", "VH", "B03 Green", "B08 NIR", "B11 SWIR"],
    method: [
      "שינוי בעוצמת החזר המכ״ם לפני ואחרי האירוע",
      "NDWI/MNDWI לאימות מים בתמונה אופטית",
      "סינון מים קבועים, צל ועננות",
    ],
    minimumReliableScale: "שטחים רציפים של עשרות מטרים ומעלה",
    expectedOutput: "מסכת הצפה, גבול פוליגונלי ושטח מחושב",
  },
  wildfire: {
    title: "איתור שריפה וצלקת שריפה",
    target: "מוקדי חום, עשן וצלקות שריפה",
    primarySensor: "Sentinel-2 MSI",
    confirmationSensor: "NASA EONET / FIRMS כאשר זמין",
    bands: ["B08 NIR", "B11 SWIR1", "B12 SWIR2", "B04 Red"],
    method: [
      "NBR ו-dNBR מול תמונת בסיס",
      "שינוי ספקטרלי בצמחייה ובקרקע חרוכה",
      "אימות מול אירוע קטלוגי או מוקד תרמי",
    ],
    minimumReliableScale: "צלקות שריפה של מספר פיקסלים רציפים",
    expectedOutput: "פוליגון שטח שרוף, דרגת שינוי ותמונות לפני ואחרי",
  },
  volcano: {
    title: "פענוח פעילות געשית",
    target: "לבה, אפר, פלומה ושינוי פני שטח",
    primarySensor: "Sentinel-2 MSI",
    confirmationSensor: "NASA EONET ו-Sentinel-1 SAR",
    bands: ["B12 SWIR2", "B11 SWIR1", "B08 NIR", "B04 Red"],
    method: [
      "איתור אנומליה ספקטרלית ושינוי פני שטח",
      "בדיקת פלומה באור נראה ו-SWIR",
      "אימות מול דיווח קטלוגי והפרדת ענן מאפר",
    ],
    minimumReliableScale: "זרימות לבה ופלומות רחבות, לא פעילות תת-פיקסלית",
    expectedOutput: "נקודת אירוע מאומתת ופוליגון רק אם מודל החזיר גבול",
  },
  crop: {
    title: "סיווג וגילוי מצב גידולים",
    target: "סוג גידול, כיסוי וצמחייה חריגה",
    primarySensor: "Sentinel-2 MSI",
    confirmationSensor: "סדרת זמן רב-עונתית",
    bands: ["B02 Blue", "B03 Green", "B04 Red", "B08 NIR", "B11 SWIR"],
    method: [
      "סדרת זמן NDVI ו-NDMI",
      "חתימה עונתית והשוואה בין חלקות",
      "סיווג רק כאשר קיימות דוגמאות אימון מתאימות",
    ],
    minimumReliableScale: "חלקות גדולות ממספר פיקסלים של 10 מטר",
    expectedOutput: "פוליגוני חלקות, סיווג והסתברות",
  },
  vessel: {
    title: "איתור כלי שיט במכ״ם",
    target: "כלי שיט בינוניים וגדולים",
    primarySensor: "Sentinel-1 SAR",
    confirmationSensor: "AIS או תמונה אופטית כאשר זמינים",
    bands: ["VV", "VH"],
    method: [
      "איתור החזר מכ״ם בהיר מעל רקע ים",
      "סינון גל, חוף ותשתיות קבועות",
      "התאמה ל-AIS לצורך זיהוי זהות",
    ],
    minimumReliableScale: "כלי שיט בינוניים וגדולים, לא סירות קטנות",
    expectedOutput: "נקודות זיהוי עם ציון ביטחון, לא זיהוי ודאי של סוג כלי השיט",
  },
  building: {
    title: "בדיקת היתכנות לזיהוי מבנים",
    target: "מבנים ותשתיות קטנות",
    primarySensor: "דימות ברזולוציה גבוהה מ-3 מטר",
    confirmationSensor: "מודל זיהוי אובייקטים ייעודי",
    bands: ["RGB", "NIR"],
    method: [
      "בדיקת רזולוציה לפני הפעלת מודל",
      "זיהוי מופעים ופוליגון לכל אובייקט",
      "בקרת דיוק מול שכבת אמת",
    ],
    minimumReliableScale: "נדרשים 0.3 עד 3 מטר לפיקסל בהתאם לאובייקט",
    expectedOutput: "זיהוי מבנים אפשרי רק עם מקור ברזולוציה מתאימה",
  },
  change: {
    title: "איתור שינויים בין זמנים",
    target: "שינוי כיסוי, מים, תשתית או צמחייה",
    primarySensor: "Sentinel-1 SAR ו-Sentinel-2 MSI",
    confirmationSensor: "תמונת בסיס מאותה עונה",
    bands: ["VV", "VH", "RGB", "NIR", "SWIR"],
    method: [
      "יישור תמונות ונרמול רדיומטרי",
      "חישוב הפרש ספקטרלי ומכ״מי",
      "סף אדפטיבי ובקרת שינוי עונתי",
    ],
    minimumReliableScale: "שינוי גדול ממספר פיקסלים רציפים",
    expectedOutput: "פוליגוני שינוי עם סוג שינוי וציון ביטחון",
  },
  imagery: {
    title: "איתור ובחירת דימות מקור",
    target: "סצנת לוויין מתאימה לבקשה",
    primarySensor: "Sentinel-2 MSI",
    confirmationSensor: "Sentinel-1 SAR לפי תנאי עננות",
    bands: ["RGB", "NIR", "SWIR"],
    method: [
      "חיפוש לפי מקום וזמן",
      "דירוג לפי עננות, קרבה בזמן ורזולוציה",
      "שמירת קישור STAC ותמונת מקור",
    ],
    minimumReliableScale: "10 מטר באופטיקה, כ-10 מטר במכ״ם GRD",
    expectedOutput: "סצנות מקור מדורגות עם מטא-דאטה",
  },
};

function includesAny(query: string, terms: string[]) {
  return terms.some((term) => query.includes(term));
}

function intentLabel(intent: AnalysisIntent) {
  return {
    flood: "הצפה",
    wildfire: "שריפה וצלקת שריפה",
    volcano: "פעילות געשית",
    crop: "גידולים וצמחייה",
    vessel: "כלי שיט",
    building: "מבנים",
    change: "שינוי רב-זמני",
    imagery: "איתור דימות",
  }[intent];
}

function requestedObjects(intent: AnalysisIntent) {
  return {
    flood: ["מים חדשים", "גבול הצפה", "שטח מוצף"],
    wildfire: ["צלקת שריפה", "מוקד תרמי", "עשן"],
    volcano: ["מוקד התפרצות", "זרימת לבה", "פלומת אפר"],
    crop: ["חלקות", "סוג גידול", "בריאות צמחייה"],
    vessel: ["כלי שיט", "החזר מכ״ם חריג"],
    building: ["מבנה", "טביעת רגל"],
    change: ["אזור שינוי", "סוג שינוי"],
    imagery: ["סצנת מקור", "כיסוי עננים"],
  }[intent];
}

function outputRequests(query: string) {
  const normalized = query.toLowerCase();
  const outputs = ["תשובה מוסברת", "תמונות מקור", "מטא-דאטה של החיישן"];
  if (includesAny(normalized, ["פוליגון", "polygon", "גבול", "boundary", "מסכה", "mask"])) outputs.push("פוליגון או מסכה כאשר קיימת גאומטריה אמיתית");
  if (includesAny(normalized, ["מפה", "map", "תציג", "show"])) outputs.push("מפה אינטראקטיבית");
  return outputs;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function findKnownLocation(query: string) {
  const normalized = query.toLowerCase();
  return KNOWN_LOCATIONS.find((location) => location.names.some((name) => normalized.includes(name)));
}

type ResolvedLocation = NonNullable<AnalysisResponse["location"]>;

type NominatimResult = {
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
  boundingbox?: unknown;
  category?: unknown;
  class?: unknown;
  type?: unknown;
  importance?: unknown;
  place_rank?: unknown;
  namedetails?: unknown;
  address?: unknown;
};

const GEOCODE_TIMEOUT_MS = 6_000;
const GEOCODE_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const GEOCODE_CACHE_LIMIT = 200;
const geocodeCache = new Map<string, { expiresAt: number; value: ResolvedLocation | null }>();
const EVENT_CACHE_TTL_MS = 5 * 60 * 1_000;
const EVENT_TIMEOUT_MS = 6_000;
const DAY_MS = 86_400_000;
const MAX_TEMPORAL_TILES = 6;
const eventCache = new Map<string, { expiresAt: number; promise: Promise<EventEvidence[]> }>();

function normalizedLocationText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9א-ת]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function knownResolvedLocation(known: KnownLocation): ResolvedLocation {
  return {
    name: known.canonical,
    latitude: known.latitude,
    longitude: known.longitude,
    bbox: known.bbox,
    source: "known-location",
    matchQuality: "exact",
    resultType: "curated-location",
  };
}

function coordinateLocation(value: string): ResolvedLocation | null {
  const coordinates = parseCoordinatePair(value);
  if (!coordinates) return null;
  const latitudeRadius = 0.1;
  const longitudeRadius = Math.min(0.25, latitudeRadius / Math.max(Math.cos(coordinates.latitude * Math.PI / 180), 0.2));
  return {
    name: `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}`,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    bbox: [
      Math.max(-180, coordinates.longitude - longitudeRadius),
      Math.max(-90, coordinates.latitude - latitudeRadius),
      Math.min(180, coordinates.longitude + longitudeRadius),
      Math.min(90, coordinates.latitude + latitudeRadius),
    ],
    source: "coordinates",
    matchQuality: "exact",
    resultType: "coordinates",
  };
}

function finiteBbox(value: unknown, longitude: number, latitude: number): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) {
    return [longitude - 0.2, latitude - 0.2, longitude + 0.2, latitude + 0.2];
  }
  const south = Number(value[0]);
  const north = Number(value[1]);
  const west = Number(value[2]);
  const east = Number(value[3]);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return null;
  if (longitude < west || longitude > east || latitude < south || latitude > north) return null;
  return [west, south, east, north];
}

function resultNames(result: NominatimResult) {
  const values = [typeof result.display_name === "string" ? result.display_name : ""];
  if (result.namedetails && typeof result.namedetails === "object" && !Array.isArray(result.namedetails)) {
    values.push(...Object.values(result.namedetails).filter((value): value is string => typeof value === "string"));
  }
  if (result.address && typeof result.address === "object" && !Array.isArray(result.address)) {
    values.push(...Object.values(result.address).filter((value): value is string => typeof value === "string"));
  }
  return normalizedLocationText(values.join(" "));
}

function scoreNominatimResult(candidate: string, result: NominatimResult) {
  const candidateNormalized = normalizedLocationText(candidate);
  const names = resultNames(result);
  const tokens = candidateNormalized.split(" ").filter((token) => token.length > 1);
  const matchedTokens = tokens.filter((token) => names.includes(token)).length;
  const lexicalRatio = tokens.length ? matchedTokens / tokens.length : 0;
  const importance = typeof result.importance === "number" && Number.isFinite(result.importance)
    ? Math.max(0, Math.min(1, result.importance))
    : 0;
  const type = String(result.type || result.category || result.class || "").toLowerCase();
  const usefulType = [
    "city", "town", "village", "municipality", "administrative", "country", "state", "region",
    "county", "island", "peak", "volcano", "mountain", "water", "bay", "river", "forest",
  ].some((value) => type.includes(value));
  const exact = Boolean(candidateNormalized && names.split(" ").includes(candidateNormalized));
  return {
    score: lexicalRatio * 65 + importance * 25 + (usefulType ? 10 : 0) + (exact ? 15 : 0),
    lexicalRatio,
    importance,
    type: type || "place",
  };
}

function trimGeocodeCache() {
  const now = Date.now();
  for (const [key, entry] of geocodeCache) {
    if (entry.expiresAt <= now) geocodeCache.delete(key);
  }
  while (geocodeCache.size > GEOCODE_CACHE_LIMIT) {
    const oldest = geocodeCache.keys().next().value as string | undefined;
    if (!oldest) break;
    geocodeCache.delete(oldest);
  }
}

function buildInterpreter(query: string, referenceDate: string): InterpreterResult {
  const intent = inferIntentFromQuery(query);
  const dates = parseDateRange(query, new Date(`${referenceDate}T12:00:00Z`));
  const known = findKnownLocation(query);
  return {
    intent,
    intentLabel: intentLabel(intent),
    locationText: known?.canonical || extractLocationCandidate(query),
    dateLabel: dates.dateLabel,
    startDate: dates.startDate,
    endDate: dates.endDate,
    requestedObjects: requestedObjects(intent),
    requestedOutput: outputRequests(query),
  };
}

export async function resolveLocation(locationText: string, query: string, alternateLocationText: string | null = null) {
  const known = findKnownLocation(query) || findKnownLocation(locationText) || findKnownLocation(alternateLocationText || "");
  if (known) return knownResolvedLocation(known);

  const directCoordinates = coordinateLocation(locationText) || coordinateLocation(query) || coordinateLocation(alternateLocationText || "");
  if (directCoordinates) return directCoordinates;

  const candidates = Array.from(new Set([locationText, alternateLocationText]
    .map((candidate) => candidate?.trim() || "")
    .filter((candidate) => candidate && isPlausibleLocationCandidate(candidate))));

  for (const candidate of candidates) {
    const cacheKey = normalizedLocationText(candidate);
    const cached = geocodeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.value) return cached.value;
      continue;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", candidate);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "5");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("namedetails", "1");
      url.searchParams.set("accept-language", "he,en");
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "GeoLens-Agent/1.0 (standalone EO analysis application)",
        },
      });
      if (!response.ok) continue;
      const payload = await response.json() as unknown;
      if (!Array.isArray(payload)) continue;
      const ranked = payload
        .filter((result): result is NominatimResult => Boolean(result) && typeof result === "object" && !Array.isArray(result))
        .map((result) => ({ result, ...scoreNominatimResult(candidate, result) }))
        .sort((left, right) => right.score - left.score || right.importance - left.importance);

      for (const item of ranked) {
        const latitude = Number(item.result.lat);
        const longitude = Number(item.result.lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) continue;
        const bbox = finiteBbox(item.result.boundingbox, longitude, latitude);
        if (!bbox) continue;
        const displayName = typeof item.result.display_name === "string" ? item.result.display_name.trim() : "";
        if (!displayName) continue;
        const translationFallback = item.lexicalRatio === 0 && item.importance >= 0.25;
        if (item.lexicalRatio < 0.5 && !translationFallback) continue;
        const resolved: ResolvedLocation = {
          name: displayName,
          latitude,
          longitude,
          bbox,
          source: "validated-geocoder",
          matchQuality: item.lexicalRatio >= 1 ? "exact" : item.lexicalRatio >= 0.5 ? "strong" : "translated",
          resultType: item.type,
        };
        geocodeCache.set(cacheKey, { expiresAt: Date.now() + GEOCODE_CACHE_TTL_MS, value: resolved });
        trimGeocodeCache();
        return resolved;
      }
      geocodeCache.set(cacheKey, { expiresAt: Date.now() + 15 * 60 * 1_000, value: null });
      trimGeocodeCache();
    } catch {
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

function dateDistanceDays(a: string, b: string) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / DAY_MS;
}

type CatalogWindow = { start: string; end: string; target: string };

function temporalTileCount(totalDays: number, maximum = MAX_TEMPORAL_TILES) {
  const tieredCount = totalDays <= 45
    ? 1
    : totalDays <= 120
      ? 2
      : totalDays <= 240
        ? 3
        : totalDays <= 400
          ? 4
          : totalDays <= 730
            ? 5
            : MAX_TEMPORAL_TILES;
  return Math.max(1, Math.min(tieredCount, maximum));
}

function temporalCatalogWindows(startDate: string, endDate: string, maximum = MAX_TEMPORAL_TILES): CatalogWindow[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const totalDays = Math.max(1, Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1);
  const count = temporalTileCount(totalDays, maximum);

  return Array.from({ length: count }, (_, index) => {
    const firstOffset = Math.floor(index * totalDays / count);
    const nextOffset = Math.floor((index + 1) * totalDays / count);
    const lastOffset = Math.max(firstOffset, nextOffset - 1);
    const windowStart = addDays(start, firstOffset);
    const windowEnd = addDays(start, lastOffset);
    const target = addDays(windowStart, Math.floor((lastOffset - firstOffset) / 2));
    return { start: toIsoDate(windowStart), end: toIsoDate(windowEnd), target: toIsoDate(target) };
  });
}

function chooseSceneWindow(interpreter: InterpreterResult, events: EventEvidence[]) {
  const span = dateDistanceDays(interpreter.startDate, interpreter.endDate);
  const eventDate = events[0]?.date;
  if (eventDate && span <= 45) {
    const date = new Date(eventDate);
    if (interpreter.intent === "wildfire") {
      return { start: toIsoDate(addDays(date, -45)), end: toIsoDate(addDays(date, 30)) };
    }
    return { start: toIsoDate(addDays(date, -8)), end: toIsoDate(addDays(date, 8)) };
  }
  if (interpreter.intent === "wildfire" && span <= 120) {
    return {
      start: toIsoDate(addDays(new Date(interpreter.startDate), -30)),
      end: toIsoDate(addDays(new Date(interpreter.endDate), 30)),
    };
  }
  if (span <= 45) return { start: interpreter.startDate, end: interpreter.endDate };
  return { start: interpreter.startDate, end: interpreter.endDate };
}

function collectionsFor(intent: AnalysisIntent) {
  if (intent === "flood" || intent === "change") return ["sentinel-1-grd", "sentinel-2-l2a"];
  if (intent === "vessel") return ["sentinel-1-grd"];
  return ["sentinel-2-l2a"];
}

function publicAsset(asset: unknown) {
  if (!asset || typeof asset !== "object") return null;
  const item = asset as { href?: string; alternate?: { https?: { href?: string } } };
  if (item.href?.startsWith("https://")) return item.href;
  return item.alternate?.https?.href || null;
}

function sceneInstrument(collection: string, properties: Record<string, unknown>) {
  if (collection.includes("sentinel-1")) return "Sentinel-1 C-band SAR";
  const instruments = Array.isArray(properties.instruments) ? properties.instruments.join(", ") : "MSI";
  return `Sentinel-2 ${instruments.toUpperCase()}`;
}

function sceneDate(feature: Record<string, unknown>, fallback: string) {
  const properties = (feature.properties || {}) as Record<string, unknown>;
  return String(properties.datetime || properties.start_datetime || fallback);
}

function sceneCloudCover(feature: Record<string, unknown>) {
  const properties = (feature.properties || {}) as Record<string, unknown>;
  const cloudCover = Number(properties["eo:cloud_cover"]);
  return Number.isFinite(cloudCover) ? cloudCover : 50;
}

function selectSceneFeatures(
  features: Array<Record<string, unknown>>,
  interpreter: InterpreterResult,
  events: EventEvidence[],
) {
  const targetDate = events[0]?.date || interpreter.endDate;
  const byRelevance = [...features].sort((left, right) => (
    dateDistanceDays(sceneDate(left, targetDate), targetDate) + sceneCloudCover(left) / 20
    - (dateDistanceDays(sceneDate(right, targetDate), targetDate) + sceneCloudCover(right) / 20)
  ));

  if (interpreter.intent !== "wildfire") return byRelevance.slice(0, 2);

  const pairTarget = events[0]?.date || toIsoDate(new Date((new Date(interpreter.startDate).getTime() + new Date(interpreter.endDate).getTime()) / 2));
  const before = features
    .filter((feature) => new Date(sceneDate(feature, pairTarget)).getTime() < new Date(pairTarget).getTime())
    .sort((left, right) => (
      dateDistanceDays(sceneDate(left, pairTarget), pairTarget) + sceneCloudCover(left) / 20
      - (dateDistanceDays(sceneDate(right, pairTarget), pairTarget) + sceneCloudCover(right) / 20)
    ));
  const after = features
    .filter((feature) => new Date(sceneDate(feature, pairTarget)).getTime() >= new Date(pairTarget).getTime())
    .sort((left, right) => (
      dateDistanceDays(sceneDate(left, pairTarget), pairTarget) + sceneCloudCover(left) / 20
      - (dateDistanceDays(sceneDate(right, pairTarget), pairTarget) + sceneCloudCover(right) / 20)
    ));
  if (before[0] && after[0]) return [before[0], after[0]];

  const chronological = [...features].sort((left, right) => new Date(sceneDate(left, pairTarget)).getTime() - new Date(sceneDate(right, pairTarget)).getTime());
  if (chronological.length >= 2) return [chronological[0], chronological[chronological.length - 1]];
  return byRelevance.slice(0, 2);
}

function mergeTemporalSceneGroups(groups: SceneResult[][], maximum: number) {
  const selected: SceneResult[] = [];
  const selectedIds = new Set<string>();
  const add = (scene: SceneResult) => {
    if (selectedIds.has(scene.canonicalSceneId) || selected.length >= maximum) return;
    selected.push(scene);
    selectedIds.add(scene.canonicalSceneId);
  };

  for (const group of groups) {
    if (group[0]) add(group[0]);
  }
  const remaining = groups
    .flatMap((group) => group.slice(1))
    .sort((left, right) => right.qualityScore - left.qualityScore || left.datetime.localeCompare(right.datetime));
  for (const scene of remaining) add(scene);

  return selected.map((scene, index) => ({
    ...scene,
    role: index === 0 ? "primary" as const : scene.role === "confirmation" ? "confirmation" as const : "context" as const,
  }));
}

async function queryScenes(
  interpreter: InterpreterResult,
  location: NonNullable<AnalysisResponse["location"]>,
  events: EventEvidence[],
  queryText: string,
) {
  const window = chooseSceneWindow(interpreter, events);
  const span = dateDistanceDays(interpreter.startDate, interpreter.endDate);
  const exactEventDate = events[0]?.date.slice(0, 10)
    || (/^\d{4}-\d{2}-\d{2}$/.test(interpreter.dateLabel) ? interpreter.dateLabel : null);
  const requiresTemporalPair = ["wildfire", "crop", "change"].includes(interpreter.intent);
  let brokerScenes: SceneResult[];

  if (requiresTemporalPair) {
    const baselineAnchor = exactEventDate
      ? toIsoDate(addDays(new Date(`${exactEventDate}T12:00:00Z`), -1))
      : interpreter.startDate;
    const targetAnchor = exactEventDate || interpreter.endDate;
    const baselineStart = toIsoDate(addDays(new Date(`${baselineAnchor}T12:00:00Z`), -45));
    const targetEnd = toIsoDate(addDays(new Date(`${targetAnchor}T12:00:00Z`), 45));
    const requestedWindows = span > 45
      ? temporalCatalogWindows(interpreter.startDate, interpreter.endDate, 4)
      : [];
    const searches = [
      {
        start: baselineStart,
        end: baselineAnchor,
        target: baselineAnchor,
        role: "primary" as const,
      },
      ...requestedWindows.map((item) => ({ ...item, role: "context" as const })),
      {
        start: targetAnchor,
        end: targetEnd,
        target: targetAnchor,
        role: "confirmation" as const,
      },
    ];
    const groups = await Promise.all(searches.map((search) => (
      querySatelliteScenes({
        intent: interpreter.intent,
        bbox: location.bbox,
        startDate: search.start,
        endDate: search.end,
        targetDate: search.target,
        queryText,
        maxScenes: requestedWindows.length ? 3 : 6,
        timeoutMs: 6_000,
      }).then((scenes) => scenes.map((scene, index) => ({
        ...scene,
        role: index === 0 ? search.role : "context" as const,
      })))
    )));
    brokerScenes = mergeTemporalSceneGroups(groups, 12);
  } else if (span > 45) {
    const requestedWindows = temporalCatalogWindows(interpreter.startDate, interpreter.endDate);
    const groups = await Promise.all(requestedWindows.map((search) => querySatelliteScenes({
        intent: interpreter.intent,
        bbox: location.bbox,
        startDate: search.start,
        endDate: search.end,
        targetDate: search.target,
        queryText,
        maxScenes: Math.max(2, Math.ceil(8 / requestedWindows.length)),
        timeoutMs: 6_000,
    })));
    brokerScenes = mergeTemporalSceneGroups(groups, 8);
  } else {
    brokerScenes = await querySatelliteScenes({
      intent: interpreter.intent,
      bbox: location.bbox,
      startDate: window.start,
      endDate: window.end,
      targetDate: exactEventDate || interpreter.endDate,
      queryText,
      maxScenes: 8,
      timeoutMs: 6_000,
    });
  }
  if (brokerScenes.length || process.env.GEOLENS_ENABLE_LEGACY_STAC_FALLBACK !== "1") return brokerScenes;

  const collections = collectionsFor(interpreter.intent);
  const results: SceneResult[] = [];

  for (const [collectionIndex, collection] of collections.entries()) {
    try {
      const response = await fetch("https://stac.dataspace.copernicus.eu/v1/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/geo+json" },
        body: JSON.stringify({
          collections: [collection],
          bbox: location.bbox,
          datetime: `${window.start}T00:00:00Z/${window.end}T23:59:59Z`,
          limit: interpreter.intent === "wildfire" ? 24 : 6,
        }),
      });
      if (!response.ok) continue;
      const data = (await response.json()) as { features?: Array<Record<string, unknown>> };
      const features = selectSceneFeatures(data.features || [], interpreter, events);

      for (const feature of features) {
        const properties = (feature.properties || {}) as Record<string, unknown>;
        const assets = (feature.assets || {}) as Record<string, unknown>;
        const links = (feature.links || []) as Array<{ rel?: string; href?: string }>;
        const bbox = (feature.bbox || location.bbox) as [number, number, number, number];
        const stacUrl = links.find((link) => link.rel === "self")?.href || "https://stac.dataspace.copernicus.eu/v1/";
        const publicAssets: Array<{ label: string; href: string }> = [];
        const desiredAssets = collection.includes("sentinel-1")
          ? [["vv", "VV COG"], ["vh", "VH COG"]]
          : [
              ["B04_10m", "B04 Red"],
              ["B03_10m", "B03 Green"],
              ["B02_10m", "B02 Blue"],
              ["B08_10m", "B08 NIR"],
              ["B8A_20m", "B08A Narrow NIR"],
              ["B11_20m", "B11 SWIR1"],
              ["B12_20m", "B12 SWIR2"],
            ];
        for (const [key, label] of desiredAssets) {
          const href = publicAsset(assets[key]);
          if (href) publicAssets.push({ label, href });
        }
        results.push({
          id: String(feature.id || "unknown-scene"),
          collection,
          platform: String(properties.platform || (collection.includes("sentinel-1") ? "sentinel-1" : "sentinel-2")),
          instrument: sceneInstrument(collection, properties),
          datetime: String(properties.datetime || properties.start_datetime || window.end),
          cloudCover: typeof properties["eo:cloud_cover"] === "number" ? properties["eo:cloud_cover"] : null,
          resolution: collection.includes("sentinel-1") ? "כ-10 מטר לפיקסל" : `${String(properties.gsd || 10)} מטר לפיקסל`,
          thumbnailUrl: publicAsset(assets.thumbnail),
          stacUrl,
          bbox,
          geometry: (feature.geometry || null) as GeoJsonGeometry | null,
          assets: publicAssets,
          role: collectionIndex === 0 && results.length === 0 ? "primary" : collectionIndex === 0 ? "context" : "confirmation",
          catalog: "Copernicus Data Space",
          canonicalSceneId: `${collection}:${String(feature.id || "unknown-scene").toLowerCase()}`,
          gsdMeters: collection.includes("sentinel-1") ? 10 : Number(properties.gsd || 10),
          qualityScore: Math.max(0, Math.min(100, 100 - sceneCloudCover(feature) - dateDistanceDays(sceneDate(feature, window.end), window.end))),
          selectionReason: "סצנת fallback מ-Copernicus לאחר שה-Data Broker המאוחד לא החזיר תוצאות.",
          assetAccess: publicAssets.length ? "public-http" : "metadata-only",
          license: {
            licenseId: "Copernicus Sentinel data terms",
            commercialUse: null,
            redistribution: null,
            attributionRequired: null,
            sourceProvider: "European Commission Copernicus / ESA",
            sourceItemId: String(feature.id || "unknown-scene"),
            termsUrl: "https://dataspace.copernicus.eu/terms-and-conditions",
            note: "יש לאמת את תנאי המקור לפני שימוש מסחרי או הפצה.",
          },
        });
      }
    } catch {
      continue;
    }
  }
  return results;
}

function haversineKm(a: [number, number], b: [number, number]) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earth = 6371;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earth * 2 * Math.asin(Math.sqrt(h));
}

function distanceToBboxKm(point: [number, number], bbox: [number, number, number, number]) {
  const longitude = Math.max(bbox[0], Math.min(bbox[2], point[0]));
  const latitude = Math.max(bbox[1], Math.min(bbox[3], point[1]));
  return haversineKm(point, [longitude, latitude]);
}

function eventProximityKm(bbox: [number, number, number, number]) {
  const diagonal = haversineKm([bbox[0], bbox[1]], [bbox[2], bbox[3]]);
  return Math.min(75, Math.max(10, diagonal * 0.2));
}

function expandBboxByKm(bbox: [number, number, number, number], distanceKm: number) {
  const latitude = (bbox[1] + bbox[3]) / 2;
  const latitudeDelta = distanceKm / 111.32;
  const longitudeDelta = distanceKm / Math.max(111.32 * Math.cos(latitude * Math.PI / 180), 20);
  return [
    Math.max(-180, bbox[0] - longitudeDelta),
    Math.min(90, bbox[3] + latitudeDelta),
    Math.min(180, bbox[2] + longitudeDelta),
    Math.max(-90, bbox[1] - latitudeDelta),
  ] as const;
}

async function queryEventsUncached(
  interpreter: InterpreterResult,
  location: NonNullable<AnalysisResponse["location"]>,
) {
  const category = interpreter.intent === "volcano" ? "volcanoes" : interpreter.intent === "wildfire" ? "wildfires" : interpreter.intent === "flood" ? "floods" : null;
  if (!category) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EVENT_TIMEOUT_MS);
  try {
    type EonetEvent = {
      id: string;
      title: string;
      link: string;
      sources?: Array<{ id: string; url: string }>;
      geometry?: Array<{ date: string; type: string; coordinates: [number, number] }>;
    };
    const proximityKm = eventProximityKm(location.bbox);
    const searchBbox = expandBboxByKm(location.bbox, proximityKm);
    const windows = temporalCatalogWindows(interpreter.startDate, interpreter.endDate);
    const searches = await Promise.allSettled(windows.map(async (window) => {
      const url = new URL("https://eonet.gsfc.nasa.gov/api/v3/events");
      url.searchParams.set("category", category);
      url.searchParams.set("status", "all");
      url.searchParams.set("start", window.start);
      url.searchParams.set("end", window.end);
      url.searchParams.set("bbox", searchBbox.join(","));
      url.searchParams.set("limit", "100");
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return [];
      const data = (await response.json()) as { events?: EonetEvent[] };
      return data.events || [];
    }));
    const catalogEvents = searches.flatMap((search) => search.status === "fulfilled" ? search.value : []) as EonetEvent[];
    const center: [number, number] = [location.longitude, location.latitude];
    const rankedEvents: Array<EventEvidence & { distanceKm: number }> = [];
    for (const event of catalogEvents) {
      const geometry = (event.geometry || [])
        .filter((item) => (
          item.type === "Point"
          && Array.isArray(item.coordinates)
          && item.coordinates.length >= 2
          && item.coordinates.every(Number.isFinite)
          && typeof item.date === "string"
          && item.date.slice(0, 10) >= interpreter.startDate
          && item.date.slice(0, 10) <= interpreter.endDate
        ))
        .map((item) => ({ item, distanceKm: distanceToBboxKm(item.coordinates, location.bbox) }))
        .filter((candidate) => candidate.distanceKm <= proximityKm)
        .sort((left, right) => left.distanceKm - right.distanceKm || dateDistanceDays(left.item.date, interpreter.endDate) - dateDistanceDays(right.item.date, interpreter.endDate))[0];
      if (!geometry) continue;
      const source = event.sources?.[0];
      rankedEvents.push({
        id: event.id,
        title: event.title,
        date: geometry.item.date,
        source: source?.id || "NASA EONET",
        sourceUrl: source?.url || event.link,
        coordinates: geometry.item.coordinates,
        type: "catalog-event",
        distanceKm: geometry.distanceKm,
      });
    }
    const uniqueEvents = new Map<string, EventEvidence & { distanceKm: number }>();
    for (const event of rankedEvents
      .sort((left, right) => (
        left.distanceKm + haversineKm(center, left.coordinates) / 20 + dateDistanceDays(left.date, interpreter.endDate) / 8
        - right.distanceKm - haversineKm(center, right.coordinates) / 20 - dateDistanceDays(right.date, interpreter.endDate) / 8
      ))) {
      if (!uniqueEvents.has(event.id)) uniqueEvents.set(event.id, event);
    }
    return [...uniqueEvents.values()].slice(0, 8).map((event) => ({
      id: event.id,
      title: event.title,
      date: event.date,
      source: event.source,
      sourceUrl: event.sourceUrl,
      coordinates: event.coordinates,
      type: event.type,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function queryEvents(
  interpreter: InterpreterResult,
  location: NonNullable<AnalysisResponse["location"]>,
) {
  const category = interpreter.intent === "volcano" ? "volcanoes" : interpreter.intent === "wildfire" ? "wildfires" : interpreter.intent === "flood" ? "floods" : null;
  if (!category) return [];
  const key = JSON.stringify({
    category,
    startDate: interpreter.startDate,
    endDate: interpreter.endDate,
    center: [location.longitude, location.latitude].map((value) => Math.round(value * 10_000) / 10_000),
    bbox: location.bbox.map((value) => Math.round(value * 10_000) / 10_000),
  });
  const now = Date.now();
  for (const [cachedKey, entry] of eventCache) {
    if (entry.expiresAt <= now) eventCache.delete(cachedKey);
  }
  const cached = eventCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;
  const promise = queryEventsUncached(interpreter, location);
  eventCache.set(key, { expiresAt: now + EVENT_CACHE_TTL_MS, promise });
  while (eventCache.size > 100) {
    const oldest = eventCache.keys().next().value as string | undefined;
    if (!oldest) break;
    eventCache.delete(oldest);
  }
  return promise;
}

function buildSteps(
  interpreter: InterpreterResult,
  location: AnalysisResponse["location"],
  scenes: SceneResult[],
  events: EventEvidence[],
  model: ModelRun,
  geometry: GeoJsonGeometry | null,
  catalogSearchSkipped = false,
) {
  const steps: AgentStep[] = [
    {
      id: "interpret",
      label: "פירוש הבקשה",
      detail: `זוהה יעד ${interpreter.intentLabel}, טווח ${interpreter.dateLabel} ותוצרים: ${interpreter.requestedOutput.join(", ")}.`,
      status: "completed",
    },
    {
      id: "locate",
      label: "פתרון מקום וזמן",
      detail: location ? `המקום זוהה כ-${location.name}.` : "לא זוהה מקום חד-משמעי.",
      status: location ? "completed" : "blocked",
    },
    {
      id: "route",
      label: "בחירת מסלול פענוח",
      detail: `${RECIPES[interpreter.intent].primarySensor} נבחר כחיישן ראשי. ${RECIPES[interpreter.intent].confirmationSensor} נבחר לאימות.`,
      status: "completed",
    },
    {
      id: "sources",
      label: "איסוף ראיות מקור",
      detail: catalogSearchSkipped
        ? "חיפוש הסצנות לא בוצע משום שאזור המשימה גדול מדי לכיסוי אמין במספר מצומצם של תוצאות."
        : `${scenes.length} סצנות לוויין ו-${events.length} אירועים קטלוגיים נמצאו.`,
      status: catalogSearchSkipped ? "blocked" : scenes.length || events.length ? "completed" : "warning",
    },
    {
      id: "infer",
      label: "פענוח אובייקטים",
      detail: geometry
        ? `${model.name} החזיר גאומטריה תקפה להצגה במפה.`
        : model.status === "blocked"
          ? model.message
          : model.status === "not-configured"
            ? `${model.name} נבחר, אך שירות הפענוח שלו עדיין לא הוגדר.`
            : model.status === "failed"
              ? model.message
              : "לא נבחר מודל ייעודי למשימה זו.",
      status: geometry ? "completed" : model.status === "blocked" ? "blocked" : "warning",
    },
    {
      id: "verify",
      label: "בקרת איכות",
      detail: "כל קביעה הופרדה בין ראיית מקור, אירוע קטלוגי ותוצאת מודל.",
      status: "completed",
    },
  ];
  return steps;
}

function buildLimitations(
  intent: AnalysisIntent,
  scenes: SceneResult[],
  events: EventEvidence[],
  geometry: GeoJsonGeometry | null,
  model: ModelRun,
  catalogSearchSkipped = false,
) {
  const limitations: string[] = [];
  if (!scenes.length) limitations.push(catalogSearchSkipped
    ? "חיפוש סצנות לא בוצע, משום שאזור המשימה גדול מכדי להסיק מסקנה מכיסוי חלקי."
    : "לא נמצאה סצנת לוויין מתאימה בקטלוגים ובחלון הזמן שנבדקו.");
  if (!events.length && !catalogSearchSkipped && ["flood", "wildfire", "volcano"].includes(intent)) limitations.push("לא נמצא דיווח NASA EONET סמוך למקום ולזמן. היעדר דיווח אינו הוכחה שלא התרחש אירוע.");
  if (!geometry) limitations.push("אין פוליגון זיהוי מאומת. המפה מציגה רק אזור חיפוש, טביעת רגל של סצנה ונקודות קטלוגיות.");
  if (model.status === "not-configured") limitations.push(`נבחר ${model.name}, אך טרם הוגדרה כתובת השירות שלו.`);
  if (model.status === "blocked") limitations.push(model.message);
  if (model.status === "failed") limitations.push(`הפעלת ${model.name} לא הושלמה: ${model.message}`);
  if (geometry && !model.calibratedConfidence) limitations.push("המודל החזיר גאומטריה ללא ציון ביטחון מכויל, ולכן ציון הביטחון מוצג כשמרני.");
  if (intent === "building" && !scenes.some((scene) => scene.gsdMeters !== null && scene.gsdMeters <= 3 && scene.assetAccess === "public-http")) {
    limitations.push("זיהוי מבנים בודדים דורש מקור RGB נגיש ברזולוציה של עד 3 מטר. רשומת NAIP בקטלוג לבדה אינה מספקת גישת פיקסלים ללא Requester Pays.");
  }
  if (intent === "vessel") limitations.push("Sentinel-1 יכול להצביע על החזר חריג של כלי שיט, אך נדרש AIS או מקור נוסף לזיהוי זהות וסוג.");
  if (scenes.some((scene) => scene.assetAccess === "requester-pays")) limitations.push("חלק מהסצנות נמצאו כקטלוג בלבד משום שנכסי המקור דורשים AWS Requester Pays.");
  if (scenes.some((scene) => scene.license.commercialUse === null)) limitations.push("תנאי השימוש נשמרו עם המקור, אך נדרשת בדיקת רישוי לפני שימוש מסחרי או הפצה.");
  return limitations;
}

export async function analyzeRequest(
  query: string,
  options: { referenceDate?: string } = {},
): Promise<AnalysisResponse> {
  const cleanedQuery = query.trim().slice(0, 1_500);
  const serverDate = new Date().toISOString().slice(0, 10);
  const candidateReferenceDate = typeof options.referenceDate === "string" ? options.referenceDate : "";
  const parsedReferenceDate = /^\d{4}-\d{2}-\d{2}$/.test(candidateReferenceDate)
    ? new Date(`${candidateReferenceDate}T12:00:00Z`)
    : null;
  const referenceDate = parsedReferenceDate
    && Number.isFinite(parsedReferenceDate.getTime())
    && parsedReferenceDate.toISOString().slice(0, 10) === candidateReferenceDate
      ? candidateReferenceDate
      : serverDate;
  const fallbackInterpreter = buildInterpreter(cleanedQuery, referenceDate);
  let plan = await planWithOpenRouter(cleanedQuery, fallbackInterpreter, false, referenceDate);
  let interpreter = plan.interpretation;
  let brain = plan.brain;
  let location = await resolveLocation(interpreter.locationText, cleanedQuery, plan.alternateLocationText);
  if (!location && brain.provider === "GeoLens" && brain.status === "completed") {
    plan = await planWithOpenRouter(cleanedQuery, fallbackInterpreter, true, referenceDate);
    interpreter = plan.interpretation;
    brain = plan.brain;
    location = await resolveLocation(interpreter.locationText, cleanedQuery, plan.alternateLocationText);
  }
  const recipe = RECIPES[interpreter.intent];

  if (!location) {
    const generatedAt = new Date().toISOString();
    const model = {
      ...selectedModel(interpreter.intent),
      message: "לא הופעל לפני פתרון מקום.",
    };
    const steps = buildSteps(interpreter, null, [], [], model, null);
    const limitations = ["לא ניתן להריץ פענוח ללא אזור חיפוש מאומת."];
    const feasibility: AnalysisResponse["feasibility"] = {
      status: "blocked",
      findingStatus: "indeterminate",
      summary: "לא ניתן לקבוע דבר לפני פתרון מקום ויצירת AOI מאומת.",
      eligibleSceneIds: [],
      realModelRun: false,
      canConcludeAbsence: false,
      checks: [{
        code: "LOCATION_UNRESOLVED",
        status: "fail",
        message: "לא זוהה מקום חד-משמעי בבקשה.",
        evidenceIds: [],
      }],
    };
    return {
      ok: false,
      query: cleanedQuery,
      interpretation: interpreter,
      location: null,
      recipe,
      answer: "הבנתי את סוג הניתוח, אבל חסר מקום גאוגרפי חד-משמעי.",
      verdict: "נדרשת הבהרת מקום לפני חיפוש סצנות.",
      confidence: "not-assessed",
      confidenceScore: null,
      findingStatus: "indeterminate",
      detectionMode: "not-feasible",
      scenes: [],
      events: [],
      detectionGeometry: null,
      steps,
      limitations,
      clarification: "באיזה מקום או אזור לבצע את הניתוח? אפשר לכתוב עיר, מדינה או קואורדינטות.",
      brain,
      model,
      mission: null,
      feasibility,
      measurements: null,
      ledger: {
        schemaVersion: "geolens-evidence/v1",
        missionId: "mission-unresolved-location",
        query: cleanedQuery,
        entries: [],
        claims: [{
          id: "claim:location",
          statement: "לא ניתן ליצור משימת פענוח ללא מקום מאומת.",
          status: "not-established",
          evidenceIds: [],
        }],
        modelVersions: model.id ? [{ id: model.id, version: model.version, status: model.status }] : [],
        reasonCodes: ["LOCATION_UNRESOLVED"],
        measurements: null,
        limitations,
        createdAt: generatedAt,
        reviewStatus: "unreviewed",
      },
      exportsVersion: "geolens-export/v1",
      generatedAt,
    };
  }

  const mission = buildMissionSpec({ interpreter, location });
  const aoiMeasurements = tryMeasureGeometry(mission.aoi.geometry);
  const oversizedSpecialistAoi = interpreter.intent !== "imagery"
    && aoiMeasurements?.areaKm2 !== null
    && aoiMeasurements?.areaKm2 !== undefined
    && aoiMeasurements.areaKm2 > 150_000;
  let events: EventEvidence[] = [];
  let scenes: SceneResult[] = [];
  if (!oversizedSpecialistAoi) {
    const hasExactDate = /^\d{4}-\d{2}-\d{2}$/.test(interpreter.dateLabel);
    const eventIntent = ["flood", "wildfire", "volcano"].includes(interpreter.intent);
    if (hasExactDate || !eventIntent) {
      [events, scenes] = await Promise.all([
        queryEvents(interpreter, location),
        queryScenes(interpreter, location, [], cleanedQuery),
      ]);
    } else {
      events = await queryEvents(interpreter, location);
      scenes = await queryScenes(interpreter, location, events, cleanedQuery);
    }
  }
  const modelResult = await runDedicatedModel({ query: cleanedQuery, interpreter, location, scenes, events });
  const geometry = modelResult.geometry;
  const generatedAt = new Date().toISOString();
  const measurements = geometry ? tryMeasureGeometry(geometry) : null;
  const modelObservation: ModelObservation | null = modelResult.runId && modelResult.completedAt && modelResult.outcome && modelResult.model.id
    ? {
        runId: modelResult.runId,
        modelId: modelResult.model.id,
        modelVersion: modelResult.model.version,
        completedAt: modelResult.completedAt,
        outcome: modelResult.outcome,
        confidence: modelResult.confidence,
        geometry,
      }
    : null;
  const feasibility = assessFeasibility({
    mission,
    scenes,
    model: modelResult.model,
    modelObservation,
    catalogConfirmed: events.length > 0,
    catalogSearchSkipped: oversizedSpecialistAoi,
  });
  const findingStatus = feasibility.findingStatus;
  const detectionMode: AnalysisResponse["detectionMode"] = findingStatus === "detected"
    ? "model-detected"
    : feasibility.status === "blocked"
      ? "not-feasible"
      : events.length
        ? "catalog-confirmed"
        : "source-only";
  const confidenceScore = modelResult.model.calibratedConfidence && modelResult.confidence !== null
    ? Math.max(0, Math.min(modelResult.confidence, 1))
    : null;
  const confidence = confidenceScore === null
    ? "not-assessed"
    : confidenceScore >= 0.8
      ? "high"
      : confidenceScore >= 0.55
        ? "medium"
      : "low";
  const analysisReadyCount = feasibility.eligibleSceneIds.length;
  const blockingMessages = feasibility.checks
    .filter((check) => check.status === "fail")
    .map((check) => check.message)
    .slice(0, 2);
  const verdict = interpreter.intent === "imagery"
    ? scenes.length
      ? "הדימות הוחזר עם מטא-דאטה וקישורי מקור. זו בקשת דימות, ולכן אין צורך לטעון שאובייקט זוהה או לא זוהה."
      : "לא נמצאה סצנת מקור מתאימה בחלון ובקטלוגים שנבדקו."
    : findingStatus === "detected"
    ? `הוחזרה גאומטריית זיהוי תקפה מ-${modelResult.model.name}, עם סצנות מקור ויומן ראיות.`
    : findingStatus === "not-detected"
      ? `המודל ${modelResult.model.name} השלים פענוח על קלט שעבר את שער ההיתכנות ולא החזיר ממצא.`
      : feasibility.status === "blocked"
        ? oversizedSpecialistAoi
          ? "המשימה נעצרה לפני חיפוש חלקי שעלול ליצור מסקנה מטעה."
          : `המשימה אינה ניתנת להכרעה מהקלט הזמין. ${blockingMessages.join(" ") || "הסוכן עצר בלי לייצר זיהוי מטעה."}`
        : events.length
          ? "קיימת רשומת אירוע חיצונית, אך עדיין אין גאומטריית זיהוי ממודל."
          : "אין ראיה מספקת לקבוע אם היעד קיים.";
  const modelExecutionStatement = feasibility.realModelRun
    ? `ריצת ${modelResult.model.name} הושלמה ותועדה.`
    : interpreter.intent === "imagery"
      ? "הבקשה היא לבחירת דימות ולכן לא נדרשה ריצת מודל סגמנטציה."
      : oversizedSpecialistAoi
        ? "לא בוצע פענוח פיקסלים."
        : `לא בוצע פענוח פיקסלים: ${modelResult.model.message}`;
  const evidenceCollectionStatement = oversizedSpecialistAoi
    ? "חיפוש הסצנות נעצר לפני פנייה לקטלוגים, משום שה-AOI גדול מדי לפענוח אמין בכיסוי חלקי."
    : `נמצאו ${scenes.length} סצנות, מתוכן ${analysisReadyCount} כשירות לניתוח, וכן ${events.length} רשומות אירוע.`;
  const answer = `${recipe.title} עבור ${location.name}. הסוכן בחר ב-${recipe.primarySensor} ובדק את הטווח ${interpreter.dateLabel}. ${evidenceCollectionStatement} ${modelExecutionStatement} ${verdict}`;
  const steps = buildSteps(interpreter, location, scenes, events, modelResult.model, geometry, oversizedSpecialistAoi);
  const limitations = buildLimitations(interpreter.intent, scenes, events, geometry, modelResult.model, oversizedSpecialistAoi);
  const ledger = buildEvidenceLedger({
    query: cleanedQuery,
    mission,
    scenes,
    events,
    model: modelResult.model,
    geometry,
    measurements,
    feasibility,
    limitations,
    generatedAt,
  });

  return {
    ok: true,
    query: cleanedQuery,
    interpretation: interpreter,
    location,
    recipe,
    answer,
    verdict,
    confidence,
    confidenceScore,
    findingStatus,
    detectionMode,
    scenes,
    events,
    detectionGeometry: geometry,
    steps,
    limitations,
    clarification: feasibility.checks.some((check) => check.code === "AOI_TOO_LARGE" && check.status === "fail")
      ? `המקום ${location.name} זוהה בהצלחה, אך זהו אזור גדול מדי לפענוח מלא במספר מצומצם של סצנות. ציין מחוז, עיר, שמורה או קואורדינטות בתוך האזור.`
      : null,
    brain,
    model: modelResult.model,
    mission,
    feasibility,
    measurements,
    ledger,
    exportsVersion: "geolens-export/v1",
    generatedAt,
  };
}
