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

type KnownLocation = {
  names: string[];
  canonical: string;
  latitude: number;
  longitude: number;
  bbox: [number, number, number, number];
};

const KNOWN_LOCATIONS: KnownLocation[] = [
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

const HEBREW_MONTHS: Record<string, number> = {
  ינואר: 0,
  פברואר: 1,
  מרץ: 2,
  אפריל: 3,
  מאי: 4,
  יוני: 5,
  יולי: 6,
  אוגוסט: 7,
  ספטמבר: 8,
  אוקטובר: 9,
  נובמבר: 10,
  דצמבר: 11,
};

const ENGLISH_MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

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

function inferIntent(query: string): AnalysisIntent {
  const normalized = query.toLowerCase();
  if (includesAny(normalized, ["הר געש", "הרי געש", "התפרצות", "התפרצויות", "לבה", "אפר געשי", "volcano", "eruption", "lava", "ash plume"])) return "volcano";
  if (includesAny(normalized, ["הצפה", "הצפות", "שיטפון", "שטפונות", "flood", "inundation", "standing water"])) return "flood";
  if (includesAny(normalized, ["שריפה", "שריפות", "צלקת שריפה", "שטח שרוף", "wildfire", "burn scar", "active fire", "smoke plume"])) return "wildfire";
  if (includesAny(normalized, ["ספינה", "ספינות", "כלי שיט", "אונייה", "ship", "vessel", "boat"])) return "vessel";
  if (includesAny(normalized, ["בניין", "בניינים", "מבנים", "בית", "building", "rooftop", "structure"])) return "building";
  if (includesAny(normalized, ["גידול", "גידולים", "חקלא", "יבול", "crop", "agriculture", "vegetation health"])) return "crop";
  if (includesAny(normalized, ["שינוי", "לפני ואחרי", "השתנה", "change", "before and after", "difference"])) return "change";
  return "imagery";
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

function parseDateRange(query: string) {
  const normalized = query.toLowerCase();
  const now = new Date();

  const iso = normalized.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const date = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    return { startDate: toIsoDate(addDays(date, -5)), endDate: toIsoDate(addDays(date, 5)), dateLabel: toIsoDate(date) };
  }

  const lastYears = normalized.match(/(?:last|over the last)\s+(\d+)\s+years?/);
  const hebrewYears = normalized.match(/ב(?:חמש|ארבע|שלוש|שתי|שנתיים|\d+)\s+השנים האחרונות/);
  if (lastYears || hebrewYears) {
    const hebrewNumber = hebrewYears?.[0].includes("חמש") ? 5 : hebrewYears?.[0].includes("ארבע") ? 4 : hebrewYears?.[0].includes("שלוש") ? 3 : 2;
    const years = lastYears ? Number(lastYears[1]) : hebrewNumber;
    const start = new Date(now);
    start.setUTCFullYear(start.getUTCFullYear() - Math.min(Math.max(years, 1), 10));
    return { startDate: toIsoDate(start), endDate: toIsoDate(now), dateLabel: `${years} השנים האחרונות` };
  }

  const monthNames = { ...ENGLISH_MONTHS, ...HEBREW_MONTHS };
  for (const [monthName, month] of Object.entries(monthNames)) {
    const escaped = monthName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const dayMonth = normalized.match(new RegExp(`(?:\\b(\\d{1,2})\\s+(?:ב)?${escaped}|${escaped}\\s+(\\d{1,2}))[,\\s-]*(20\\d{2})`));
    if (dayMonth) {
      const day = Number(dayMonth[1] || dayMonth[2]);
      const date = new Date(Date.UTC(Number(dayMonth[3]), month, day));
      return { startDate: toIsoDate(addDays(date, -5)), endDate: toIsoDate(addDays(date, 5)), dateLabel: toIsoDate(date) };
    }
    const monthYear = normalized.match(new RegExp(`${escaped}\\s+(20\\d{2})`));
    if (monthYear) {
      const date = new Date(Date.UTC(Number(monthYear[1]), month, 15));
      return { startDate: toIsoDate(addDays(date, -20)), endDate: toIsoDate(addDays(date, 20)), dateLabel: `${monthName} ${monthYear[1]}` };
    }
  }

  const year = normalized.match(/\b(20\d{2})\b/);
  if (year) {
    return { startDate: `${year[1]}-01-01`, endDate: `${year[1]}-12-31`, dateLabel: year[1] };
  }

  return { startDate: toIsoDate(addDays(now, -45)), endDate: toIsoDate(now), dateLabel: "45 הימים האחרונים" };
}

function findKnownLocation(query: string) {
  const normalized = query.toLowerCase();
  return KNOWN_LOCATIONS.find((location) => location.names.some((name) => normalized.includes(name)));
}

function extractLocationCandidate(query: string) {
  const english = query.match(/\b(?:in|near|around|at)\s+([A-Za-zÀ-ÿ' .-]+?)(?=\s+(?:on|during|after|before|between|from|over|for|last)\b|[,.?]|$)/i);
  if (english?.[1]) return english[1].trim();

  const hebrew = query.match(/(?:באזור\s+|ליד\s+|סביב\s+|ב)([א-ת׳״'" -]{2,}?)(?=\s+(?:בתאריך|ביום|לאחר|לפני|בין|בחמש|בארבע|בשלוש|בשנת|ב-?\d|20\d{2})|[,.?]|$)/);
  if (hebrew?.[1]) return hebrew[1].trim();
  return "";
}

function buildInterpreter(query: string): InterpreterResult {
  const intent = inferIntent(query);
  const dates = parseDateRange(query);
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

async function geocode(locationText: string, query: string) {
  const known = findKnownLocation(query) || findKnownLocation(locationText);
  if (known) {
    return {
      name: known.canonical,
      latitude: known.latitude,
      longitude: known.longitude,
      bbox: known.bbox,
    };
  }
  if (!locationText) return null;

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", locationText);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "GeoLens-Agent/1.0 (standalone EO analysis application)",
      },
    });
    if (!response.ok) return null;
    const results = (await response.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
      boundingbox: [string, string, string, string];
    }>;
    const first = results[0];
    if (!first) return null;
    const latitude = Number(first.lat);
    const longitude = Number(first.lon);
    const bbox: [number, number, number, number] = first.boundingbox
      ? [Number(first.boundingbox[2]), Number(first.boundingbox[0]), Number(first.boundingbox[3]), Number(first.boundingbox[1])]
      : [longitude - 0.2, latitude - 0.2, longitude + 0.2, latitude + 0.2];
    return { name: first.display_name, latitude, longitude, bbox };
  } catch {
    return null;
  }
}

function dateDistanceDays(a: string, b: string) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

function chooseSceneWindow(interpreter: InterpreterResult, events: EventEvidence[]) {
  const eventDate = events[0]?.date;
  if (eventDate) {
    const date = new Date(eventDate);
    if (interpreter.intent === "wildfire") {
      return { start: toIsoDate(addDays(date, -45)), end: toIsoDate(addDays(date, 30)) };
    }
    return { start: toIsoDate(addDays(date, -8)), end: toIsoDate(addDays(date, 8)) };
  }
  const end = new Date(interpreter.endDate);
  const span = dateDistanceDays(interpreter.startDate, interpreter.endDate);
  if (interpreter.intent === "wildfire" && span <= 120) {
    return {
      start: toIsoDate(addDays(new Date(interpreter.startDate), -30)),
      end: toIsoDate(addDays(new Date(interpreter.endDate), 30)),
    };
  }
  if (span <= 45) return { start: interpreter.startDate, end: interpreter.endDate };
  return { start: toIsoDate(addDays(end, -30)), end: toIsoDate(end) };
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

async function queryScenes(
  interpreter: InterpreterResult,
  location: NonNullable<AnalysisResponse["location"]>,
  events: EventEvidence[],
) {
  const window = chooseSceneWindow(interpreter, events);
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

async function queryEvents(
  interpreter: InterpreterResult,
  location: NonNullable<AnalysisResponse["location"]>,
) {
  const category = interpreter.intent === "volcano" ? "volcanoes" : interpreter.intent === "wildfire" ? "wildfires" : interpreter.intent === "flood" ? "floods" : null;
  if (!category) return [];
  try {
    const url = new URL("https://eonet.gsfc.nasa.gov/api/v3/events");
    url.searchParams.set("category", category);
    url.searchParams.set("status", "all");
    url.searchParams.set("start", interpreter.startDate);
    url.searchParams.set("end", interpreter.endDate);
    url.searchParams.set("limit", "100");
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      events?: Array<{
        id: string;
        title: string;
        link: string;
        sources?: Array<{ id: string; url: string }>;
        geometry?: Array<{ date: string; type: string; coordinates: [number, number] }>;
      }>;
    };
    const center: [number, number] = [location.longitude, location.latitude];
    const maxDistance = Math.max(350, haversineKm([location.bbox[0], location.bbox[1]], [location.bbox[2], location.bbox[3]]) / 1.3);
    const events: EventEvidence[] = [];
    for (const event of data.events || []) {
      const geometry = [...(event.geometry || [])].reverse().find((item) => item.type === "Point" && Array.isArray(item.coordinates));
      if (!geometry || haversineKm(center, geometry.coordinates) > maxDistance) continue;
      const source = event.sources?.[0];
      events.push({
        id: event.id,
        title: event.title,
        date: geometry.date,
        source: source?.id || "NASA EONET",
        sourceUrl: source?.url || event.link,
        coordinates: geometry.coordinates,
        type: "catalog-event",
      });
    }
    return events.slice(0, 8);
  } catch {
    return [];
  }
}

function buildSteps(
  interpreter: InterpreterResult,
  location: AnalysisResponse["location"],
  scenes: SceneResult[],
  events: EventEvidence[],
  model: ModelRun,
  geometry: GeoJsonGeometry | null,
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
      detail: `${scenes.length} סצנות לוויין ו-${events.length} אירועים קטלוגיים נמצאו.`,
      status: scenes.length || events.length ? "completed" : "warning",
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
) {
  const limitations: string[] = [];
  if (!scenes.length) limitations.push("לא נמצאה סצנת Sentinel מתאימה בחלון הזמן שנבדק.");
  if (!events.length && ["flood", "wildfire", "volcano"].includes(intent)) limitations.push("לא נמצא דיווח NASA EONET סמוך למקום ולזמן. היעדר דיווח אינו הוכחה שלא התרחש אירוע.");
  if (!geometry) limitations.push("אין פוליגון זיהוי מאומת. המפה מציגה רק אזור חיפוש, טביעת רגל של סצנה ונקודות קטלוגיות.");
  if (model.status === "not-configured") limitations.push(`נבחר ${model.name}, אך טרם הוגדרה כתובת השירות שלו.`);
  if (model.status === "blocked") limitations.push(model.message);
  if (model.status === "failed") limitations.push(`הפעלת ${model.name} לא הושלמה: ${model.message}`);
  if (geometry && !model.calibratedConfidence) limitations.push("המודל החזיר גאומטריה ללא ציון ביטחון מכויל, ולכן ציון הביטחון מוצג כשמרני.");
  if (intent === "building") limitations.push("Sentinel-2 ברזולוציית 10 מטר אינו מתאים לזיהוי אמין של מבנים בודדים.");
  if (intent === "vessel") limitations.push("Sentinel-1 יכול להצביע על החזר חריג של כלי שיט, אך נדרש AIS או מקור נוסף לזיהוי זהות וסוג.");
  return limitations;
}

export async function analyzeRequest(query: string): Promise<AnalysisResponse> {
  const cleanedQuery = query.trim().slice(0, 1_500);
  const fallbackInterpreter = buildInterpreter(cleanedQuery);
  const { interpretation: interpreter, brain } = await planWithOpenRouter(cleanedQuery, fallbackInterpreter);
  const location = await geocode(interpreter.locationText, cleanedQuery);
  const recipe = RECIPES[interpreter.intent];

  if (!location) {
    const model = selectedModel(interpreter.intent);
    const steps = buildSteps(interpreter, null, [], [], model, null);
    return {
      ok: false,
      query: cleanedQuery,
      interpretation: interpreter,
      location: null,
      recipe,
      answer: "הבנתי את סוג הניתוח, אבל חסר מקום גאוגרפי חד-משמעי.",
      verdict: "נדרשת הבהרת מקום לפני חיפוש סצנות.",
      confidence: "not-assessed",
      confidenceScore: 0,
      detectionMode: "not-feasible",
      scenes: [],
      events: [],
      detectionGeometry: null,
      steps,
      limitations: ["לא ניתן להריץ פענוח ללא אזור חיפוש."],
      clarification: "באיזה מקום או אזור לבצע את הניתוח? אפשר לכתוב עיר, מדינה או קואורדינטות.",
      brain,
      model: {
        ...model,
        message: "לא הופעל לפני פתרון מקום.",
      },
      generatedAt: new Date().toISOString(),
    };
  }

  const events = await queryEvents(interpreter, location);
  const scenes = await queryScenes(interpreter, location, events);
  const modelResult = await runDedicatedModel({ query: cleanedQuery, interpreter, location, scenes, events });
  const geometry = modelResult.geometry;
  const resolutionBlocked = modelResult.model.id === "yolo-obb-geospatial" && modelResult.model.status === "blocked";
  const detectionMode = resolutionBlocked
    ? "not-feasible"
    : geometry
      ? "model-detected"
      : events.length
        ? "catalog-confirmed"
        : "source-only";
  const confidenceScore = resolutionBlocked
    ? 0.18
    : geometry
      ? Math.max(0, Math.min(modelResult.confidence ?? 0.6, 1))
      : events.length && scenes.length
        ? 0.74
        : scenes.length
          ? 0.46
          : 0.22;
  const confidence = confidenceScore >= 0.8 ? "high" : confidenceScore >= 0.55 ? "medium" : confidenceScore > 0.25 ? "low" : "not-assessed";
  const verdict = resolutionBlocked
    ? "הבקשה דורשת דימות ברזולוציה גבוהה יותר מ-Sentinel. הסוכן עצר לפני יצירת זיהוי מטעה."
    : geometry
      ? `הוחזרה גאומטריית זיהוי מ-${modelResult.model.name}, לצד סצנות המקור והראיות.`
      : modelResult.model.status === "blocked"
        ? `המודל שנבחר לא הופעל: ${modelResult.model.message}`
      : events.length
        ? `נמצא אירוע קטלוגי מתאים ו-${scenes.length} סצנות מקור. עדיין אין מסכת אובייקטים ממודל.`
        : `נמצאו ${scenes.length} סצנות מקור, אך אין כרגע ראיה מספקת לקבוע שהאובייקט או האירוע זוהה.`;
  const answer = `${recipe.title} עבור ${location.name}. הסוכן בחר ב-${recipe.primarySensor}, בדק את הטווח ${interpreter.dateLabel}, ואסף ${scenes.length} סצנות ו-${events.length} רשומות אירוע. ${verdict}`;
  const steps = buildSteps(interpreter, location, scenes, events, modelResult.model, geometry);

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
    detectionMode,
    scenes,
    events,
    detectionGeometry: geometry,
    steps,
    limitations: buildLimitations(interpreter.intent, scenes, events, geometry, modelResult.model),
    clarification: null,
    brain,
    model: modelResult.model,
    generatedAt: new Date().toISOString(),
  };
}
