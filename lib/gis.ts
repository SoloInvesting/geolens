import type { GeoJsonGeometry, GeometryMeasurements } from "@/app/types";

export type { GeometryMeasurements } from "@/app/types";

type Position = [number, number];
type LinearRing = Position[];
type PolygonCoordinates = LinearRing[];
type MultiPolygonCoordinates = PolygonCoordinates[];

type NormalizedGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "Polygon"; coordinates: PolygonCoordinates }
  | { type: "MultiPolygon"; coordinates: MultiPolygonCoordinates }
  | {
      type: "FeatureCollection";
      features: Array<{
        type: "Feature";
        geometry: Exclude<NormalizedGeometry, { type: "FeatureCollection" }> | null;
        properties?: Record<string, unknown>;
      }>;
    };

const EARTH_RADIUS_METERS = 6_371_008.8;
const MAX_COORDINATES = 250_000;
const MAX_FEATURES = 10_000;

export class GeoJsonValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeoJsonValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLongitude(value: number) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 && value > 0 ? 180 : normalized;
}

function position(value: unknown, counter: { coordinates: number }): Position | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const longitude = value[0];
  const latitude = value[1];
  if (
    typeof longitude !== "number"
    || typeof latitude !== "number"
    || !Number.isFinite(longitude)
    || !Number.isFinite(latitude)
    || longitude < -180
    || longitude > 180
    || latitude < -90
    || latitude > 90
  ) {
    return null;
  }
  counter.coordinates += 1;
  if (counter.coordinates > MAX_COORDINATES) {
    throw new GeoJsonValidationError(`Geometry exceeds the ${MAX_COORDINATES} coordinate safety limit.`);
  }
  return [longitude, latitude];
}

function positionsEqual(first: Position, second: Position) {
  return first[0] === second[0] && first[1] === second[1];
}

function ring(value: unknown, counter: { coordinates: number }): LinearRing | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const result: LinearRing = [];
  for (const candidate of value) {
    const normalized = position(candidate, counter);
    if (!normalized) return null;
    result.push(normalized);
  }
  if (!positionsEqual(result[0], result[result.length - 1])) return null;
  const distinct = new Set(result.slice(0, -1).map(([longitude, latitude]) => `${longitude},${latitude}`));
  return distinct.size >= 3 ? result : null;
}

function polygonCoordinates(value: unknown, counter: { coordinates: number }): PolygonCoordinates | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const result: PolygonCoordinates = [];
  for (const candidate of value) {
    const normalized = ring(candidate, counter);
    if (!normalized) return null;
    result.push(normalized);
  }
  return result;
}

function multiPolygonCoordinates(value: unknown, counter: { coordinates: number }): MultiPolygonCoordinates | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const result: MultiPolygonCoordinates = [];
  for (const candidate of value) {
    const normalized = polygonCoordinates(candidate, counter);
    if (!normalized) return null;
    result.push(normalized);
  }
  return result;
}

function normalizedProperties(value: unknown) {
  return isRecord(value) ? value : undefined;
}

function normalizeAtomicGeometry(
  value: unknown,
  counter: { coordinates: number },
): Exclude<NormalizedGeometry, { type: "FeatureCollection" }> | null {
  if (!isRecord(value)) return null;
  if (value.type === "Point") {
    const coordinates = position(value.coordinates, counter);
    return coordinates ? { type: "Point", coordinates } : null;
  }
  if (value.type === "Polygon") {
    const coordinates = polygonCoordinates(value.coordinates, counter);
    return coordinates ? { type: "Polygon", coordinates } : null;
  }
  if (value.type === "MultiPolygon") {
    const coordinates = multiPolygonCoordinates(value.coordinates, counter);
    return coordinates ? { type: "MultiPolygon", coordinates } : null;
  }
  return null;
}

function normalizeInternal(value: unknown): NormalizedGeometry | null {
  const counter = { coordinates: 0 };
  if (!isRecord(value)) return null;
  if (value.type === "Feature") return normalizeAtomicGeometry(value.geometry, counter);

  const atomic = normalizeAtomicGeometry(value, counter);
  if (atomic) return atomic;

  if (value.type !== "FeatureCollection" || !Array.isArray(value.features)) return null;
  if (value.features.length === 0 || value.features.length > MAX_FEATURES) return null;
  const features: Extract<NormalizedGeometry, { type: "FeatureCollection" }>["features"] = [];
  for (const candidate of value.features) {
    if (!isRecord(candidate) || candidate.type !== "Feature") return null;
    if (candidate.geometry === null) {
      features.push({ type: "Feature", geometry: null, properties: normalizedProperties(candidate.properties) });
      continue;
    }
    const geometry = normalizeAtomicGeometry(candidate.geometry, counter);
    if (!geometry) return null;
    features.push({ type: "Feature", geometry, properties: normalizedProperties(candidate.properties) });
  }
  if (!features.some((feature) => feature.geometry !== null)) return null;
  return { type: "FeatureCollection", features };
}

export function normalizeGeoJsonGeometry(value: unknown): GeoJsonGeometry | null {
  return normalizeInternal(value) as GeoJsonGeometry | null;
}

export function isValidGeoJsonGeometry(value: unknown): value is GeoJsonGeometry {
  try {
    return normalizeInternal(value) !== null;
  } catch {
    return false;
  }
}

export function geometryBbox(value: GeoJsonGeometry): [number, number, number, number] {
  const positions: Position[] = [];
  const collect = (candidate: GeoJsonGeometry | null) => {
    if (!candidate) return;
    if (candidate.type === "Point") {
      positions.push(candidate.coordinates as Position);
      return;
    }
    if (candidate.type === "FeatureCollection") {
      for (const feature of candidate.features) collect(feature.geometry);
      return;
    }
    const visit = (node: unknown): void => {
      if (!Array.isArray(node)) return;
      if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
        positions.push([node[0], node[1]]);
        return;
      }
      for (const child of node) visit(child);
    };
    visit(candidate.coordinates);
  };
  collect(value);
  if (!positions.length) throw new GeoJsonValidationError("Geometry has no coordinates.");
  const longitudes = positions.map(([longitude]) => longitude);
  const latitudes = positions.map(([, latitude]) => latitude);
  return [
    Math.min(...longitudes),
    Math.min(...latitudes),
    Math.max(...longitudes),
    Math.max(...latitudes),
  ];
}

function radians(value: number) {
  return value * Math.PI / 180;
}

function degrees(value: number) {
  return value * 180 / Math.PI;
}

function longitudeDeltaRadians(first: number, second: number) {
  let delta = radians(second - first);
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

function haversineMeters(first: Position, second: Position) {
  const latitude1 = radians(first[1]);
  const latitude2 = radians(second[1]);
  const deltaLatitude = latitude2 - latitude1;
  const deltaLongitude = longitudeDeltaRadians(first[0], second[0]);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

function ringPerimeterMeters(value: LinearRing) {
  let perimeter = 0;
  for (let index = 1; index < value.length; index += 1) {
    perimeter += haversineMeters(value[index - 1], value[index]);
  }
  return perimeter;
}

function ringAreaSquareMeters(value: LinearRing) {
  let sum = 0;
  for (let index = 1; index < value.length; index += 1) {
    const first = value[index - 1];
    const second = value[index];
    sum += longitudeDeltaRadians(first[0], second[0])
      * (2 + Math.sin(radians(first[1])) + Math.sin(radians(second[1])));
  }
  return Math.abs(sum * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS / 2);
}

function circularMeanLongitude(value: LinearRing) {
  let x = 0;
  let y = 0;
  for (const [longitude] of value.slice(0, -1)) {
    x += Math.cos(radians(longitude));
    y += Math.sin(radians(longitude));
  }
  return degrees(Math.atan2(y, x));
}

function ringCentroid(value: LinearRing): Position {
  const vertices = value.slice(0, -1);
  const referenceLongitude = circularMeanLongitude(value);
  const referenceLatitude = vertices.reduce((sum, point) => sum + point[1], 0) / vertices.length;
  const referenceLongitudeRadians = radians(referenceLongitude);
  const referenceLatitudeRadians = radians(referenceLatitude);
  const cosineLatitude = Math.max(Math.abs(Math.cos(referenceLatitudeRadians)), 1e-12);
  const projected = value.map(([longitude, latitude]) => {
    const deltaLongitude = longitudeDeltaRadians(referenceLongitude, longitude);
    return [
      EARTH_RADIUS_METERS * deltaLongitude * cosineLatitude,
      EARTH_RADIUS_METERS * (radians(latitude) - referenceLatitudeRadians),
    ] as Position;
  });

  let twiceArea = 0;
  let centroidX = 0;
  let centroidY = 0;
  for (let index = 1; index < projected.length; index += 1) {
    const first = projected[index - 1];
    const second = projected[index];
    const cross = first[0] * second[1] - second[0] * first[1];
    twiceArea += cross;
    centroidX += (first[0] + second[0]) * cross;
    centroidY += (first[1] + second[1]) * cross;
  }
  if (Math.abs(twiceArea) < 1e-9) {
    return [referenceLongitude, referenceLatitude];
  }
  centroidX /= 3 * twiceArea;
  centroidY /= 3 * twiceArea;
  return [
    normalizeLongitude(degrees(referenceLongitudeRadians + centroidX / (EARTH_RADIUS_METERS * cosineLatitude))),
    degrees(referenceLatitudeRadians + centroidY / EARTH_RADIUS_METERS),
  ];
}

type AtomicMeasurement = {
  areaSquareMeters: number;
  perimeterMeters: number;
  centroid: Position;
  positions: Position[];
  featureCount: number;
};

function weightedCentroid(parts: Array<{ centroid: Position; weight: number }>): Position {
  const positive = parts.filter((part) => Number.isFinite(part.weight) && part.weight > 0);
  if (!positive.length) throw new GeoJsonValidationError("Geometry has no measurable coordinates.");
  const totalWeight = positive.reduce((sum, part) => sum + part.weight, 0);
  let longitudeX = 0;
  let longitudeY = 0;
  let latitude = 0;
  for (const part of positive) {
    longitudeX += Math.cos(radians(part.centroid[0])) * part.weight;
    longitudeY += Math.sin(radians(part.centroid[0])) * part.weight;
    latitude += part.centroid[1] * part.weight;
  }
  return [normalizeLongitude(degrees(Math.atan2(longitudeY, longitudeX))), latitude / totalWeight];
}

function measurePolygon(value: PolygonCoordinates): AtomicMeasurement {
  const outerArea = ringAreaSquareMeters(value[0]);
  if (outerArea <= 0) throw new GeoJsonValidationError("Polygon outer ring has zero area.");
  const outerCentroid = ringCentroid(value[0]);
  let area = outerArea;
  let perimeter = ringPerimeterMeters(value[0]);
  const centroidParts = [{ centroid: outerCentroid, weight: outerArea }];
  for (const hole of value.slice(1)) {
    const holeArea = ringAreaSquareMeters(hole);
    area -= holeArea;
    perimeter += ringPerimeterMeters(hole);
    centroidParts.push({ centroid: ringCentroid(hole), weight: -holeArea });
  }
  if (area <= 0) throw new GeoJsonValidationError("Polygon holes consume or exceed the outer ring area.");

  let centroid = outerCentroid;
  const longitudeReference = radians(outerCentroid[0]);
  let longitudeOffset = 0;
  let latitude = 0;
  for (const part of centroidParts) {
    longitudeOffset += longitudeDeltaRadians(outerCentroid[0], part.centroid[0]) * part.weight;
    latitude += part.centroid[1] * part.weight;
  }
  centroid = [
    normalizeLongitude(degrees(longitudeReference + longitudeOffset / area)),
    latitude / area,
  ];

  return {
    areaSquareMeters: area,
    perimeterMeters: perimeter,
    centroid,
    positions: value.flat(),
    featureCount: 1,
  };
}

function measureAtomic(value: Exclude<NormalizedGeometry, { type: "FeatureCollection" }>): AtomicMeasurement {
  if (value.type === "Point") {
    return {
      areaSquareMeters: 0,
      perimeterMeters: 0,
      centroid: value.coordinates,
      positions: [value.coordinates],
      featureCount: 1,
    };
  }
  if (value.type === "Polygon") return measurePolygon(value.coordinates);

  const polygons = value.coordinates.map(measurePolygon);
  return {
    areaSquareMeters: polygons.reduce((sum, part) => sum + part.areaSquareMeters, 0),
    perimeterMeters: polygons.reduce((sum, part) => sum + part.perimeterMeters, 0),
    centroid: weightedCentroid(polygons.map((part) => ({ centroid: part.centroid, weight: part.areaSquareMeters }))),
    positions: polygons.flatMap((part) => part.positions),
    featureCount: polygons.length,
  };
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function measurements(value: NormalizedGeometry): GeometryMeasurements {
  const atomic = value.type === "FeatureCollection"
    ? value.features.flatMap((feature) => feature.geometry ? [measureAtomic(feature.geometry)] : [])
    : [measureAtomic(value)];
  if (!atomic.length) throw new GeoJsonValidationError("FeatureCollection contains no measurable geometry.");

  const positions = atomic.flatMap((part) => part.positions);
  const longitudes = positions.map((point) => point[0]);
  const latitudes = positions.map((point) => point[1]);
  const totalArea = atomic.reduce((sum, part) => sum + part.areaSquareMeters, 0);
  const hasArealGeometry = atomic.some((part) => part.areaSquareMeters > 0);
  const centroidWeights = atomic.map((part) => ({
    centroid: part.centroid,
    weight: part.areaSquareMeters > 0 ? part.areaSquareMeters : 1,
  }));
  const centroid = weightedCentroid(centroidWeights);

  return {
    areaKm2: hasArealGeometry ? round(totalArea / 1_000_000, 6) : null,
    perimeterKm: hasArealGeometry ? round(atomic.reduce((sum, part) => sum + part.perimeterMeters, 0) / 1000, 6) : null,
    centroid: [round(centroid[0], 7), round(centroid[1], 7)],
    bbox: [
      round(Math.min(...longitudes), 7),
      round(Math.min(...latitudes), 7),
      round(Math.max(...longitudes), 7),
      round(Math.max(...latitudes), 7),
    ],
    featureCount: atomic.reduce((sum, part) => sum + part.featureCount, 0),
    method: "spherical-wgs84",
    precisionNote: "Area uses a spherical WGS84 approximation and perimeter uses great-circle segments. Results are deterministic but are not a cadastral survey.",
  };
}

export function measureGeometry(value: unknown): GeometryMeasurements {
  const normalized = normalizeInternal(value);
  if (!normalized) {
    throw new GeoJsonValidationError("Expected valid Point, Polygon, MultiPolygon, or FeatureCollection GeoJSON.");
  }
  return measurements(normalized);
}

export function tryMeasureGeometry(value: unknown): GeometryMeasurements | null {
  try {
    return measureGeometry(value);
  } catch {
    return null;
  }
}
