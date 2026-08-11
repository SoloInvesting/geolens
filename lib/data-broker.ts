import type { AnalysisIntent, GeoJsonGeometry, LicenseProvenance, SceneResult } from "@/app/types";

type Bbox = [number, number, number, number];
type CatalogId =
  | "copernicus-cdse"
  | "element84-earth-search"
  | "microsoft-planetary-computer"
  | "nasa-cmr-hls";
type SceneFamily = "sentinel-1" | "sentinel-2" | "landsat" | "naip" | "hls" | "unknown";

type StacFeature = {
  id?: unknown;
  collection?: unknown;
  bbox?: unknown;
  geometry?: unknown;
  properties?: unknown;
  assets?: unknown;
  links?: unknown;
};

type CatalogPlan = {
  id: CatalogId;
  label: string;
  endpoint: string;
  collections: string[];
};

export type SceneLicense = LicenseProvenance & {
  reviewRequired: true;
};

export type SceneProvenance = {
  catalog: CatalogId;
  catalogLabel: string;
  catalogEndpoint: string;
  dataProvider: string;
  sourceCollection: string;
  sourceItemId: string;
  itemUrl: string;
  accessPolicy: "public-metadata-no-auth" | "anonymous-transient-sas";
  requesterPays: boolean;
  fetchedAt: string;
};

export type AlternateSceneSource = {
  catalog: CatalogId;
  catalogLabel: string;
  itemUrl: string;
};

export type BrokerScene = SceneResult & {
  catalogId: CatalogId;
  catalogLabel: string;
  family: SceneFamily;
  gsdMeters: number | null;
  qualityScore: number;
  assetCompleteness: number;
  selectionReason: string;
  provenance: SceneProvenance;
  license: SceneLicense;
  alternateSources: AlternateSceneSource[];
};

export type SatelliteSceneQuery = {
  intent: AnalysisIntent;
  bbox: Bbox;
  startDate: string;
  endDate: string;
  targetDate?: string;
  queryText?: string;
  maxScenes?: number;
  timeoutMs?: number;
};

type NormalizedScene = Omit<BrokerScene, "role"> & { role: SceneResult["role"] };

const CATALOGS = {
  cdse: {
    id: "copernicus-cdse" as const,
    label: "Copernicus Data Space Ecosystem",
    endpoint: "https://stac.dataspace.copernicus.eu/v1/search",
  },
  earthSearch: {
    id: "element84-earth-search" as const,
    label: "Element 84 Earth Search",
    endpoint: "https://earth-search.aws.element84.com/v1/search",
  },
  planetaryComputer: {
    id: "microsoft-planetary-computer" as const,
    label: "Microsoft Planetary Computer",
    endpoint: "https://planetarycomputer.microsoft.com/api/stac/v1/search",
  },
  hls: {
    id: "nasa-cmr-hls" as const,
    label: "NASA CMR STAC, HLS",
    endpoint: "https://cmr.earthdata.nasa.gov/stac/LPCLOUD/search",
  },
};

const SENTINEL_TERMS = "https://dataspace.copernicus.eu/terms-and-conditions";
const LANDSAT_TERMS = "https://www.usgs.gov/landsat-missions/landsat-data-access";
const NAIP_TERMS = "https://naip-usdaonline.hub.arcgis.com/";
const HLS_TERMS = "https://www.earthdata.nasa.gov/data/projects/hls";
const DAY_MS = 86_400_000;
const SCENE_CACHE_TTL_MS = 5 * 60 * 1_000;
const SCENE_CACHE_LIMIT = 100;
const sceneQueryCache = new Map<string, { expiresAt: number; promise: Promise<BrokerScene[]> }>();

const ASSET_SPECS: Record<Exclude<SceneFamily, "unknown">, Array<{ keys: string[]; label: string }>> = {
  "sentinel-1": [
    { keys: ["vv"], label: "VV COG" },
    { keys: ["vh"], label: "VH COG" },
    { keys: ["hh"], label: "HH COG" },
    { keys: ["hv"], label: "HV COG" },
  ],
  "sentinel-2": [
    { keys: ["B02_10m", "B02", "blue"], label: "B02 Blue" },
    { keys: ["B03_10m", "B03", "green"], label: "B03 Green" },
    { keys: ["B04_10m", "B04", "red"], label: "B04 Red" },
    { keys: ["B08_10m", "B08", "nir"], label: "B08 NIR" },
    { keys: ["B8A_20m", "B8A", "nir08"], label: "B08A Narrow NIR" },
    { keys: ["B11_20m", "B11", "swir16"], label: "B11 SWIR1" },
    { keys: ["B12_20m", "B12", "swir22"], label: "B12 SWIR2" },
  ],
  landsat: [
    { keys: ["blue", "SR_B2"], label: "B02 Blue" },
    { keys: ["green", "SR_B3"], label: "B03 Green" },
    { keys: ["red", "SR_B4"], label: "B04 Red" },
    { keys: ["nir08", "SR_B5"], label: "B05 NIR" },
    { keys: ["swir16", "SR_B6"], label: "B06 SWIR1" },
    { keys: ["swir22", "SR_B7"], label: "B07 SWIR2" },
  ],
  naip: [
    { keys: ["image", "analytic", "data"], label: "NAIP RGB-NIR COG (red green blue nir)" },
  ],
  hls: [
    { keys: ["B02"], label: "B02 Blue" },
    { keys: ["B03"], label: "B03 Green" },
    { keys: ["B04"], label: "B04 Red" },
    { keys: ["B8A", "B05"], label: "B08A Narrow NIR" },
    { keys: ["B11", "B06"], label: "B11 SWIR1" },
    { keys: ["B12", "B07"], label: "B12 SWIR2" },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T00:00:00Z`).getTime());
}

function validateQuery(input: SatelliteSceneQuery) {
  if (!Array.isArray(input.bbox) || input.bbox.length !== 4 || !input.bbox.every(Number.isFinite)) {
    throw new TypeError("Satellite scene search requires a finite [west, south, east, north] bbox.");
  }
  const [west, south, east, north] = input.bbox;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    throw new RangeError("Satellite scene search received an invalid geographic bbox.");
  }
  if (!validDate(input.startDate) || !validDate(input.endDate) || input.startDate > input.endDate) {
    throw new RangeError("Satellite scene search requires a valid ascending ISO date range.");
  }
  if (input.targetDate && !validDate(input.targetDate)) {
    throw new RangeError("Satellite scene targetDate must use YYYY-MM-DD.");
  }
}

function centerOfBbox(bbox: Bbox): [number, number] {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

function isInsideUsCoverage(bbox: Bbox) {
  const [longitude, latitude] = centerOfBbox(bbox);
  const conterminous = longitude >= -125 && longitude <= -66 && latitude >= 24 && latitude <= 50;
  const alaska = longitude >= -180 && longitude <= -129 && latitude >= 50 && latitude <= 72;
  const hawaii = longitude >= -161 && longitude <= -154 && latitude >= 18 && latitude <= 23;
  const puertoRico = longitude >= -68 && longitude <= -65 && latitude >= 17 && latitude <= 19;
  return conterminous || alaska || hawaii || puertoRico;
}

function isObjectRequest(input: SatelliteSceneQuery) {
  if (input.intent === "building") return true;
  const query = input.queryText?.toLowerCase() || "";
  return ["object", "objects", "אובייקט", "אובייקטים", "מבנה", "מבנים", "בניין", "בניינים"].some((term) => query.includes(term));
}

function catalogPlans(input: SatelliteSceneQuery): CatalogPlan[] {
  const cdseCollections = new Set<string>();
  const earthCollections = new Set<string>();
  const planetaryComputerCollections = new Set<string>();
  const hlsCollections = new Set<string>();

  const addSentinel1 = () => {
    cdseCollections.add("sentinel-1-grd");
    earthCollections.add("sentinel-1-grd");
  };
  const addSentinel2 = () => {
    cdseCollections.add("sentinel-2-l2a");
    earthCollections.add("sentinel-2-c1-l2a");
    earthCollections.add("sentinel-2-l2a");
  };
  const addLandsat = () => earthCollections.add("landsat-c2-l2");
  const addHls = () => {
    hlsCollections.add("HLSS30_2.0");
    hlsCollections.add("HLSL30_2.0");
  };

  if (input.intent === "flood" || input.intent === "change") {
    addSentinel1();
    addSentinel2();
    addLandsat();
    addHls();
  } else if (input.intent === "vessel") {
    addSentinel1();
  } else if (input.intent === "building") {
    addSentinel2();
    if (isInsideUsCoverage(input.bbox) && isObjectRequest(input)) {
      earthCollections.add("naip");
      planetaryComputerCollections.add("naip");
    }
  } else if (input.intent === "volcano") {
    addSentinel1();
    addSentinel2();
    addLandsat();
    addHls();
  } else if (input.intent === "imagery") {
    addSentinel1();
    addSentinel2();
    addLandsat();
    if (isInsideUsCoverage(input.bbox) && isObjectRequest(input)) {
      earthCollections.add("naip");
      planetaryComputerCollections.add("naip");
    }
  } else {
    addSentinel2();
    addLandsat();
    addHls();
  }

  return [
    { ...CATALOGS.cdse, collections: [...cdseCollections] },
    { ...CATALOGS.earthSearch, collections: [...earthCollections] },
    { ...CATALOGS.planetaryComputer, collections: [...planetaryComputerCollections] },
    { ...CATALOGS.hls, collections: [...hlsCollections] },
  ];
}

async function fetchStacCollection(plan: CatalogPlan, collection: string, input: SatelliteSceneQuery) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), clamp(input.timeoutMs ?? 9_000, 1_000, 20_000));
  try {
    const response = await fetch(plan.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/geo+json, application/json",
        "Content-Type": "application/json",
        "User-Agent": "GeoLens-Agent/1.0 (public EO catalog broker)",
      },
      body: JSON.stringify({
        collections: [collection],
        bbox: input.bbox,
        datetime: `${input.startDate}T00:00:00Z/${input.endDate}T23:59:59Z`,
        limit: Math.min(Math.max((input.maxScenes ?? 12) * 2, 8), 32),
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${plan.label} STAC search returned ${response.status}.`);
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.features)) return [];
    return payload.features.filter(isRecord) as StacFeature[];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchStac(plan: CatalogPlan, input: SatelliteSceneQuery) {
  if (!plan.collections.length) return [];
  const searches = await Promise.allSettled(
    plan.collections.map((collection) => fetchStacCollection(plan, collection, input)),
  );
  return searches.flatMap((search) => search.status === "fulfilled" ? search.value : []);
}

function sceneFamily(collection: string, properties: Record<string, unknown>): SceneFamily {
  const combined = `${collection} ${String(properties.platform || "")} ${String(properties.constellation || "")}`.toLowerCase();
  if (combined.includes("sentinel-1")) return "sentinel-1";
  if (combined.includes("sentinel-2")) return "sentinel-2";
  if (combined.includes("landsat")) return "landsat";
  if (combined.includes("naip")) return "naip";
  if (combined.includes("hls") || combined.includes("hlss30") || combined.includes("hlsl30")) return "hls";
  return "unknown";
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function assetHref(value: unknown) {
  if (!isRecord(value)) return null;
  const direct = safeHttpsUrl(value.href);
  if (direct) return direct;
  if (!isRecord(value.alternate)) return null;
  const https = value.alternate.https;
  return isRecord(https) ? safeHttpsUrl(https.href) : null;
}

function desiredAssets(family: SceneFamily, assets: Record<string, unknown>) {
  if (family === "unknown") return [];
  const found: Array<{ label: string; href: string }> = [];
  const seen = new Set<string>();
  for (const spec of ASSET_SPECS[family]) {
    for (const key of spec.keys) {
      const href = assetHref(assets[key]);
      if (!href || seen.has(href)) continue;
      found.push({ label: spec.label, href });
      seen.add(href);
      break;
    }
  }
  return found;
}

function assetAccess(
  family: SceneFamily,
  catalogId: CatalogId,
  assets: Record<string, unknown>,
  publicAssetCount: number,
  requesterPays: boolean,
): SceneResult["assetAccess"] {
  if (family === "hls") return "authentication-required";
  if (requesterPays) return "requester-pays";
  if (catalogId === "microsoft-planetary-computer" && publicAssetCount > 0) return "public-http";
  if (publicAssetCount > 0) return "public-http";
  if (family !== "unknown") {
    const hasS3OnlySource = ASSET_SPECS[family].some((spec) => spec.keys.some((key) => {
      const asset = assets[key];
      return isRecord(asset) && typeof asset.href === "string" && asset.href.startsWith("s3://");
    }));
    if (hasS3OnlySource) return "requester-pays";
  }
  return "metadata-only";
}

function previewUrl(assets: Record<string, unknown>) {
  for (const key of ["thumbnail", "thumbnail_0", "browse", "rendered_preview", "preview", "visual"]) {
    const href = assetHref(assets[key]);
    if (href) return href;
  }
  return null;
}

function collectionGsd(family: SceneFamily) {
  if (family === "naip") return 1;
  if (family === "landsat") return 30;
  if (family === "hls") return 30;
  if (family === "sentinel-1" || family === "sentinel-2") return 10;
  return null;
}

function gsdMeters(properties: Record<string, unknown>, family: SceneFamily) {
  if (isFiniteNumber(properties.gsd) && properties.gsd > 0) return properties.gsd;
  if (Array.isArray(properties.gsd)) {
    const finite = properties.gsd.filter(isFiniteNumber).filter((value) => value > 0);
    if (finite.length) return Math.min(...finite);
  }
  return collectionGsd(family);
}

function cloudCover(properties: Record<string, unknown>) {
  const value = properties["eo:cloud_cover"];
  return isFiniteNumber(value) ? clamp(value, 0, 100) : null;
}

function featureDate(properties: Record<string, unknown>, fallback: string) {
  for (const value of [properties.datetime, properties.start_datetime, properties.created]) {
    if (typeof value === "string" && Number.isFinite(new Date(value).getTime())) return new Date(value).toISOString();
  }
  return `${fallback}T00:00:00.000Z`;
}

function validBbox(value: unknown): value is Bbox {
  return Array.isArray(value) && value.length === 4 && value.every(isFiniteNumber)
    && value[0] < value[2] && value[1] < value[3];
}

function validPosition(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(isFiniteNumber);
}

function validRing(value: unknown) {
  return Array.isArray(value) && value.length >= 4 && value.every(validPosition);
}

function geometry(value: unknown): GeoJsonGeometry | null {
  if (!isRecord(value)) return null;
  if (value.type === "Point" && validPosition(value.coordinates)) return { type: "Point", coordinates: value.coordinates };
  if (value.type === "Polygon" && Array.isArray(value.coordinates) && value.coordinates.length > 0 && value.coordinates.every(validRing)) {
    return { type: "Polygon", coordinates: value.coordinates };
  }
  if (value.type === "MultiPolygon" && Array.isArray(value.coordinates) && value.coordinates.length > 0
    && value.coordinates.every((polygon) => Array.isArray(polygon) && polygon.length > 0 && polygon.every(validRing))) {
    return { type: "MultiPolygon", coordinates: value.coordinates };
  }
  return null;
}

function selfLink(feature: StacFeature, fallback: string) {
  if (Array.isArray(feature.links)) {
    for (const link of feature.links) {
      if (!isRecord(link) || link.rel !== "self") continue;
      const href = safeHttpsUrl(link.href);
      if (href) return href;
    }
  }
  return fallback;
}

function platformName(family: SceneFamily, properties: Record<string, unknown>) {
  if (typeof properties.platform === "string" && properties.platform.trim()) return properties.platform;
  return {
    "sentinel-1": "sentinel-1",
    "sentinel-2": "sentinel-2",
    landsat: "landsat-8/9",
    naip: "USDA NAIP aerial imagery",
    hls: "NASA Harmonized Landsat Sentinel-2",
    unknown: "unknown",
  }[family];
}

function instrumentName(family: SceneFamily, properties: Record<string, unknown>) {
  const instruments = Array.isArray(properties.instruments)
    ? properties.instruments.filter((value): value is string => typeof value === "string").join(", ")
    : "";
  if (family === "sentinel-1") return "Sentinel-1 C-band SAR";
  if (family === "sentinel-2") return `Sentinel-2 ${(instruments || "MSI").toUpperCase()}`;
  if (family === "landsat") return `Landsat ${(instruments || "OLI/TIRS").toUpperCase()}`;
  if (family === "naip") return "NAIP aerial RGB-NIR camera";
  if (family === "hls") return "NASA HLS, harmonized OLI/MSI";
  return instruments || "Unknown sensor";
}

function expectedAssetCount(family: SceneFamily) {
  if (family === "sentinel-1") return 2;
  return family === "unknown" ? 1 : ASSET_SPECS[family].length;
}

function sensorPreference(intent: AnalysisIntent, family: SceneFamily) {
  if ((intent === "flood" || intent === "vessel") && family === "sentinel-1") return 1;
  if (intent === "building" && family === "naip") return 1;
  if (["wildfire", "volcano", "crop"].includes(intent) && family === "sentinel-2") return 1;
  if (["flood", "wildfire", "volcano", "crop", "change"].includes(intent) && family === "hls") return 0.92;
  if (intent === "change" && (family === "sentinel-1" || family === "sentinel-2")) return 1;
  if (intent === "imagery" && family === "sentinel-2") return 1;
  if (family === "landsat") return 0.68;
  return 0.82;
}

function targetResolution(intent: AnalysisIntent) {
  if (intent === "building") return 1;
  if (intent === "vessel") return 10;
  return 10;
}

function temporalScore(datetime: string, targetDate: string, startDate: string, endDate: string) {
  const distance = Math.abs(new Date(datetime).getTime() - new Date(`${targetDate}T12:00:00Z`).getTime()) / DAY_MS;
  const span = Math.max(10, (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / DAY_MS);
  return { distance, score: clamp(1 - distance / Math.max(span, 30)) };
}

function scoreScene(
  scene: Pick<NormalizedScene, "family" | "datetime" | "cloudCover" | "gsdMeters" | "assetCompleteness" | "catalogId" | "assetAccess">,
  input: SatelliteSceneQuery,
  targetDate: string,
) {
  const temporal = temporalScore(scene.datetime, targetDate, input.startDate, input.endDate);
  const cloud = scene.family === "sentinel-1"
    ? 1
    : scene.cloudCover === null
      ? 0.45
      : clamp(1 - scene.cloudCover / 100);
  const resolutionTarget = targetResolution(input.intent);
  const resolution = scene.gsdMeters === null ? 0.35 : clamp(resolutionTarget / scene.gsdMeters);
  const sensor = sensorPreference(input.intent, scene.family);
  const catalogReliability = (
    scene.catalogId === "copernicus-cdse" && scene.family.startsWith("sentinel")
  ) || (
    scene.catalogId === "microsoft-planetary-computer" && scene.family === "naip"
  ) ? 1 : 0.96;
  const weighted = input.intent === "building"
    ? temporal.score * 0.15 + cloud * 0.1 + resolution * 0.35
      + scene.assetCompleteness * 0.15 + sensor * 0.23 + catalogReliability * 0.02
    : temporal.score * 0.32 + cloud * 0.18 + resolution * 0.2
      + scene.assetCompleteness * 0.18 + sensor * 0.1 + catalogReliability * 0.02;
  const accessPenalty = scene.assetAccess === "public-http"
    ? 0
    : scene.assetAccess === "authentication-required"
      ? 0.12
      : scene.assetAccess === "requester-pays"
        ? 0.2
        : 0.25;
  const qualityScore = Math.round(clamp(weighted - accessPenalty) * 1_000) / 10;
  const details = [
    `${Math.round(temporal.distance)} ימים מתאריך היעד`,
    scene.family === "sentinel-1" ? "מכ״ם שאינו תלוי בעננות" : scene.cloudCover === null ? "עננות לא דווחה" : `${Math.round(scene.cloudCover)}% עננות`,
    scene.gsdMeters === null ? "GSD לא דווח" : `${scene.gsdMeters} מטר לפיקסל`,
    `${Math.round(scene.assetCompleteness * 100)}% מערוצי המקור הצפויים`,
    scene.assetAccess === "requester-pays"
      ? "נכס הנתונים דורש AWS requester-pays"
      : scene.assetAccess === "authentication-required"
        ? "מטא-דאטה ו-thumbnail ציבוריים, ערוצי HLS דורשים Earthdata Login"
      : scene.assetAccess === "public-http"
        ? scene.catalogId === "microsoft-planetary-computer"
          ? "נכס ציבורי הנחתם ב-SAS אנונימי בזמן הפענוח"
          : "נכס נתונים ציבורי ב-HTTPS"
        : "רק מטא-דאטה ציבורי זמין",
  ];
  return { qualityScore, selectionReason: details.join(", ") };
}

function licenseFor(family: SceneFamily, sourceItemId: string): SceneLicense {
  const termsUrl = family === "landsat" ? LANDSAT_TERMS : family === "naip" ? NAIP_TERMS : family === "hls" ? HLS_TERMS : SENTINEL_TERMS;
  const licenseId = family === "landsat"
    ? "USGS Landsat data policy"
    : family === "naip"
      ? "USDA NAIP data terms"
      : family === "hls"
        ? "NASA Earthdata and HLS data terms"
      : family === "sentinel-1" || family === "sentinel-2"
        ? "Copernicus Sentinel data terms"
        : "Unknown source terms";
  return {
    licenseId,
    termsUrl,
    commercialUse: null,
    redistribution: null,
    attributionRequired: null,
    sourceProvider: providerFor(family),
    sourceItemId,
    reviewRequired: true,
    note: "הגישה לקטלוג ציבורית וללא מפתח, אך יש לאמת את תנאי המקור לפני שימוש מסחרי או הפצה.",
  };
}

function providerFor(family: SceneFamily) {
  if (family === "sentinel-1" || family === "sentinel-2") return "European Commission Copernicus / ESA";
  if (family === "landsat") return "USGS / NASA Landsat";
  if (family === "naip") return "USDA NAIP";
  if (family === "hls") return "NASA LP DAAC / HLS";
  return "Source provider not identified";
}

function canonicalSceneId(family: SceneFamily, id: string, datetime: string) {
  const normalizedId = id.replace(/\.safe$/i, "").toLowerCase();
  const tile = id.match(/(?:^|[_-])T?(\d{2}[A-Z]{3})(?:[_-]|$)/i)?.[1]?.toLowerCase();
  const platform = id.match(/(?:^|[_-])(S[12][A-D])(?:[_-]|$)/i)?.[1]?.toLowerCase();
  if (tile) return `${family}:${platform || "platform"}:${datetime.slice(0, 10)}:${tile}`;
  return `${family}:${normalizedId}`;
}

function normalizeFeature(
  feature: StacFeature,
  plan: CatalogPlan,
  input: SatelliteSceneQuery,
  targetDate: string,
  fetchedAt: string,
): NormalizedScene | null {
  const properties = isRecord(feature.properties) ? feature.properties : {};
  const assets = isRecord(feature.assets) ? feature.assets : {};
  const collection = typeof feature.collection === "string" ? feature.collection : "unknown-collection";
  const family = sceneFamily(collection, properties);
  if (family === "naip" && (!isInsideUsCoverage(input.bbox) || !isObjectRequest(input))) return null;
  const id = typeof feature.id === "string" && feature.id.trim() ? feature.id : null;
  if (!id) return null;

  const selectedAssets = desiredAssets(family, assets);
  const completeness = clamp(selectedAssets.length / expectedAssetCount(family));
  const requesterPays = properties["storage:requester_pays"] === true;
  const gsd = gsdMeters(properties, family);
  const datetime = featureDate(properties, input.endDate);
  const itemUrl = selfLink(feature, plan.endpoint.replace(/\/search$/, "/"));
  const partial: NormalizedScene = {
    id,
    collection,
    platform: platformName(family, properties),
    instrument: instrumentName(family, properties),
    datetime,
    cloudCover: cloudCover(properties),
    resolution: gsd === null ? "רזולוציה לא דווחה" : `${gsd} מטר לפיקסל`,
    thumbnailUrl: previewUrl(assets),
    stacUrl: itemUrl,
    bbox: validBbox(feature.bbox) ? feature.bbox : input.bbox,
    geometry: geometry(feature.geometry),
    assets: selectedAssets,
    role: "context",
    catalog: plan.label,
    canonicalSceneId: canonicalSceneId(family, id, datetime),
    assetAccess: assetAccess(family, plan.id, assets, selectedAssets.length, requesterPays),
    catalogId: plan.id,
    catalogLabel: plan.label,
    family,
    gsdMeters: gsd,
    qualityScore: 0,
    assetCompleteness: Math.round(completeness * 100) / 100,
    selectionReason: "",
    provenance: {
      catalog: plan.id,
      catalogLabel: plan.label,
      catalogEndpoint: plan.endpoint,
      dataProvider: providerFor(family),
      sourceCollection: collection,
      sourceItemId: id,
      itemUrl,
      accessPolicy: plan.id === "microsoft-planetary-computer"
        ? "anonymous-transient-sas"
        : "public-metadata-no-auth",
      requesterPays,
      fetchedAt,
    },
    license: licenseFor(family, id),
    alternateSources: [],
  };
  const scored = scoreScene(partial, input, targetDate);
  return { ...partial, ...scored };
}

function sceneFingerprint(scene: NormalizedScene) {
  const minute = scene.datetime.slice(0, 16);
  const day = scene.datetime.slice(0, 10);
  const tile = scene.id.match(/(?:^|[_-])T?(\d{2}[A-Z]{3})(?:[_-]|$)/i)?.[1]?.toLowerCase() || "";
  const center = centerOfBbox(scene.bbox).map((value) => value.toFixed(2)).join(":");
  return tile
    ? `${scene.family}:${day}:${tile}`
    : `${scene.family}:${minute}:${center}`;
}

function deduplicate(scenes: NormalizedScene[]) {
  const selected = new Map<string, NormalizedScene>();
  for (const scene of scenes) {
    const fingerprint = sceneFingerprint(scene);
    const existing = selected.get(fingerprint);
    if (!existing) {
      selected.set(fingerprint, scene);
      continue;
    }
    const better = scene.qualityScore > existing.qualityScore ? scene : existing;
    const alternate = better === scene ? existing : scene;
    const alternateSource: AlternateSceneSource = {
      catalog: alternate.catalogId,
      catalogLabel: alternate.catalogLabel,
      itemUrl: alternate.stacUrl,
    };
    selected.set(fingerprint, {
      ...better,
      alternateSources: [...better.alternateSources, ...alternate.alternateSources, alternateSource]
        .filter((value, index, list) => list.findIndex((candidate) => candidate.itemUrl === value.itemUrl) === index),
    });
  }
  return [...selected.values()];
}

function withRoles(scenes: NormalizedScene[]) {
  if (!scenes.length) return [];
  const firstFamily = scenes[0].family;
  let confirmationAssigned = false;
  return scenes.map((scene, index): BrokerScene => {
    let role: SceneResult["role"] = "context";
    if (index === 0) role = "primary";
    else if (!confirmationAssigned && scene.family !== firstFamily) {
      role = "confirmation";
      confirmationAssigned = true;
    }
    return { ...scene, role };
  });
}

function selectDiverseScenes(scenes: NormalizedScene[], maximum: number) {
  const selected: NormalizedScene[] = [];
  const selectedIds = new Set<string>();
  const familyCounts = new Map<SceneFamily, number>();
  const familyLimit = Math.max(2, Math.ceil(maximum / 2));

  for (const scene of scenes) {
    if (selectedIds.has(scene.canonicalSceneId) || familyCounts.has(scene.family)) continue;
    selected.push(scene);
    selectedIds.add(scene.canonicalSceneId);
    familyCounts.set(scene.family, 1);
    if (selected.length === maximum) return selected;
  }

  for (const scene of scenes) {
    if (selectedIds.has(scene.canonicalSceneId)) continue;
    const count = familyCounts.get(scene.family) || 0;
    if (count >= familyLimit) continue;
    selected.push(scene);
    selectedIds.add(scene.canonicalSceneId);
    familyCounts.set(scene.family, count + 1);
    if (selected.length === maximum) break;
  }
  return selected;
}

function midpointDate(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  return new Date((start + end) / 2).toISOString().slice(0, 10);
}

function sceneQueryCacheKey(input: SatelliteSceneQuery) {
  return JSON.stringify({
    intent: input.intent,
    bbox: input.bbox.map((value) => Math.round(value * 1_000_000) / 1_000_000),
    startDate: input.startDate,
    endDate: input.endDate,
    targetDate: input.targetDate || null,
    maxScenes: Math.min(Math.max(input.maxScenes ?? 12, 1), 30),
    objectRequest: isObjectRequest(input),
  });
}

function trimSceneCache() {
  const now = Date.now();
  for (const [key, entry] of sceneQueryCache) {
    if (entry.expiresAt <= now) sceneQueryCache.delete(key);
  }
  while (sceneQueryCache.size > SCENE_CACHE_LIMIT) {
    const oldest = sceneQueryCache.keys().next().value as string | undefined;
    if (!oldest) break;
    sceneQueryCache.delete(oldest);
  }
}

/**
 * Searches only anonymous, public STAC endpoints. Catalog failure is isolated,
 * so one healthy provider can still return evidence. Access being free does not
 * imply commercial-use permission; every result carries conservative terms.
 */
async function querySatelliteScenesUncached(input: SatelliteSceneQuery): Promise<BrokerScene[]> {
  validateQuery(input);
  const normalizedInput: SatelliteSceneQuery = {
    ...input,
    maxScenes: Math.min(Math.max(input.maxScenes ?? 12, 1), 30),
    timeoutMs: Math.min(Math.max(input.timeoutMs ?? 9_000, 1_000), 20_000),
  };
  const plans = catalogPlans(normalizedInput);
  const fetchedAt = new Date().toISOString();
  const targetDate = normalizedInput.targetDate || midpointDate(normalizedInput.startDate, normalizedInput.endDate);
  const searches = await Promise.allSettled(plans.map(async (plan) => ({
    plan,
    features: await fetchStac(plan, normalizedInput),
  })));

  const normalized: NormalizedScene[] = [];
  for (const search of searches) {
    if (search.status !== "fulfilled") continue;
    for (const feature of search.value.features) {
      const scene = normalizeFeature(feature, search.value.plan, normalizedInput, targetDate, fetchedAt);
      if (scene) normalized.push(scene);
    }
  }

  const ranked = deduplicate(normalized)
    .sort((left, right) => right.qualityScore - left.qualityScore || left.datetime.localeCompare(right.datetime));
  const selected = selectDiverseScenes(ranked, normalizedInput.maxScenes || 12);
  return withRoles(selected);
}

export async function querySatelliteScenes(input: SatelliteSceneQuery): Promise<BrokerScene[]> {
  validateQuery(input);
  trimSceneCache();
  const key = sceneQueryCacheKey(input);
  const cached = sceneQueryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = querySatelliteScenesUncached(input);
  sceneQueryCache.set(key, { expiresAt: Date.now() + SCENE_CACHE_TTL_MS, promise });
  trimSceneCache();
  try {
    return await promise;
  } catch (error) {
    sceneQueryCache.delete(key);
    throw error;
  }
}
