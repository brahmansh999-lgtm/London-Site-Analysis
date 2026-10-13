import type {
  Feature,
  FeatureCollection,
  Polygon,
  MultiPolygon,
  LineString,
  MultiLineString,
  Point,
  Position,
  GeoJsonProperties,
} from 'geojson';
import type { LatLngBounds, LatLngTuple } from 'leaflet';
import L from 'leaflet';
import turfArea     from '@turf/area';
import turfBuffer   from '@turf/buffer';
import turfCenter   from '@turf/center';
import turfDistance from '@turf/distance';
import { point as turfPoint } from '@turf/helpers';
import type { Units } from '@turf/helpers';

// ─── Bounds & centroid ────────────────────────────────────────────────────────

export function getFeatureBounds(
  feature: Feature<Polygon | MultiPolygon>
): LatLngBounds {
  const coords: Position[] = [];
  if (feature.geometry.type === 'Polygon') {
    feature.geometry.coordinates[0].forEach((c) => coords.push(c));
  } else {
    feature.geometry.coordinates.forEach((poly) =>
      poly[0].forEach((c) => coords.push(c))
    );
  }
  return L.latLngBounds(coords.map((c) => [c[1], c[0]] as LatLngTuple));
}

export function getFeatureCentroid(
  feature: Feature<Polygon | MultiPolygon>
): LatLngTuple {
  const c  = turfCenter(feature);
  const pt = c.geometry as Point;
  return [pt.coordinates[1], pt.coordinates[0]];
}

export function padBounds(
  bounds: LatLngBounds,
  factor: number
): LatLngBounds {
  const latPad = (bounds.getNorth() - bounds.getSouth()) * factor;
  const lngPad = (bounds.getEast() - bounds.getWest()) * factor;
  return L.latLngBounds(
    [bounds.getSouth() - latPad, bounds.getWest() - lngPad],
    [bounds.getNorth() + latPad, bounds.getEast() + lngPad]
  );
}

// ─── Area ─────────────────────────────────────────────────────────────────────

export function calculateFeatureArea(
  feature: Feature<Polygon | MultiPolygon>
): number {
  return turfArea(feature);
}

export function formatArea(sqm: number): string {
  if (sqm >= 10_000) return `${(sqm / 10_000).toFixed(2)} ha`;
  return `${Math.round(sqm).toLocaleString('en-GB')} m²`;
}

// ─── Size category & dimensions ──────────────────────────────────────────────

export type SiteSizeCategory = 'Small' | 'Medium' | 'Large';

export function classifySiteSize(sqm: number): SiteSizeCategory {
  if (sqm < 5_000)  return 'Small';
  if (sqm < 20_000) return 'Medium';
  return 'Large';
}

export const SITE_SIZE_COLOURS: Record<SiteSizeCategory, string> = {
  Small:  '#3878c8',
  Medium: '#e8a838',
  Large:  '#c84838',
};

export interface SiteDimensions {
  widthM:  number;
  lengthM: number;
}

/**
 * Approximate site dimensions from the bounding box of the polygon,
 * using equirectangular distance at the site's latitude.
 */
export function calculateFeatureDimensions(
  feature: Feature<Polygon | MultiPolygon>
): SiteDimensions {
  const coords: Position[] = [];
  if (feature.geometry.type === 'Polygon') {
    feature.geometry.coordinates[0].forEach((c) => coords.push(c));
  } else {
    feature.geometry.coordinates.forEach((poly) => poly[0].forEach((c) => coords.push(c)));
  }
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const west = Math.min(...lngs), east = Math.max(...lngs);
  const south = Math.min(...lats), north = Math.max(...lats);
  const midLat = (south + north) / 2;

  const widthM  = turfDistance(turfPoint([west, midLat]), turfPoint([east, midLat]), { units: 'meters' as Units });
  const lengthM = turfDistance(turfPoint([west, south]), turfPoint([west, north]), { units: 'meters' as Units });

  return { widthM, lengthM };
}

export function formatDimensions({ widthM, lengthM }: SiteDimensions): string {
  return `${Math.round(widthM)} m × ${Math.round(lengthM)} m`;
}

// ─── BBox ─────────────────────────────────────────────────────────────────────

export interface BBox {
  south: number;
  west:  number;
  north: number;
  east:  number;
}

export function boundsToBbox(b: {
  getSouth(): number;
  getWest():  number;
  getNorth(): number;
  getEast():  number;
}): BBox {
  return {
    south: b.getSouth(),
    west:  b.getWest(),
    north: b.getNorth(),
    east:  b.getEast(),
  };
}

// ─── Ring utilities ───────────────────────────────────────────────────────────

function closeRing(ring: Position[]): Position[] {
  if (ring.length < 3) return ring;
  const f = ring[0];
  const l = ring[ring.length - 1];
  if (f[0] !== l[0] || f[1] !== l[1]) return [...ring, f];
  return ring;
}

function closeCoordRing(coords: [number, number][]): [number, number][] {
  if (coords.length < 3) return coords;
  const f = coords[0];
  const l = coords[coords.length - 1];
  if (f[0] !== l[0] || f[1] !== l[1]) return [...coords, f];
  return coords;
}

// ─── Setback / developable footprint ─────────────────────────────────────────

export interface SetbackScenario {
  label:    string;
  setbackM: number;
  feature:  Feature<Polygon | MultiPolygon>;
  areaSqm:  number;
  colour:   string;
}

export function calculateBuildableFootprint(
  site:     Feature<Polygon | MultiPolygon>,
  setbackM: number
): Feature<Polygon | MultiPolygon> | null {
  try {
    const buf = turfBuffer(site, -Math.abs(setbackM), { units: 'meters' as Units });
    if (!buf) return null;

    const bufAny = buf as unknown as { type: string };
    let result: Feature<Polygon | MultiPolygon, GeoJsonProperties> | null = null;

    if (bufAny.type === 'FeatureCollection') {
      const fc = buf as unknown as FeatureCollection<Polygon | MultiPolygon, GeoJsonProperties>;
      if (!fc.features.length) return null;
      let best = fc.features[0];
      let bestArea = turfArea(best);
      for (let i = 1; i < fc.features.length; i++) {
        const a = turfArea(fc.features[i]);
        if (a > bestArea) { best = fc.features[i]; bestArea = a; }
      }
      result = best;
    } else {
      result = buf as unknown as Feature<Polygon | MultiPolygon, GeoJsonProperties>;
    }

    if (!result) return null;

    const g = result.geometry;
    if (g.type === 'Polygon') {
      const fixed: Feature<Polygon | MultiPolygon, GeoJsonProperties> = {
        ...result,
        geometry: { ...g, coordinates: g.coordinates.map(closeRing) },
      };
      const poly = fixed.geometry as Polygon;
      if (!poly.coordinates[0] || poly.coordinates[0].length < 4) return null;
      return fixed as Feature<Polygon | MultiPolygon>;
    }

    const multi = g as MultiPolygon;
    const fixed: Feature<Polygon | MultiPolygon, GeoJsonProperties> = {
      ...result,
      geometry: { ...multi, coordinates: multi.coordinates.map((p) => p.map(closeRing)) },
    };
    const mp = fixed.geometry as MultiPolygon;
    if (!mp.coordinates[0]?.[0] || mp.coordinates[0][0].length < 4) return null;
    return fixed as Feature<Polygon | MultiPolygon>;
  } catch {
    return null;
  }
}

export function calculateSetbackScenarios(
  site: Feature<Polygon | MultiPolygon>
): SetbackScenario[] {
  const defs = [
    { label: 'Minimum setback — 3 m', setbackM: 3, colour: '#78c838' },
    { label: 'Standard setback — 5 m', setbackM: 5, colour: '#a0d860' },
    { label: 'Generous setback — 9 m', setbackM: 9, colour: '#c8ec98' },
  ];
  const results: SetbackScenario[] = [];
  for (const d of defs) {
    const f = calculateBuildableFootprint(site, d.setbackM);
    if (f) results.push({ ...d, feature: f, areaSqm: calculateFeatureArea(f) });
  }
  return results;
}

// ─── Access point intersection ────────────────────────────────────────────────

export interface AccessPoint {
  position: LatLngTuple;
  roadName: string;
  highway:  string;
}

export function findAccessPoints(
  site:  Feature<Polygon | MultiPolygon>,
  roads: RoadFeatureCollection
): AccessPoint[] {
  const siteGeom  = site.geometry;
  const outerRing: [number, number][] =
    siteGeom.type === 'Polygon'
      ? ((siteGeom as Polygon).coordinates[0] as [number, number][])
      : ((siteGeom as MultiPolygon).coordinates[0][0] as [number, number][]);

  const raw: AccessPoint[] = [];

  for (const road of roads.features) {
    if (!road.properties) continue;
    const rc = (road.geometry as LineString).coordinates as [number, number][];

    for (let ri = 0; ri < rc.length - 1; ri++) {
      const [rx1, ry1] = rc[ri];
      const [rx2, ry2] = rc[ri + 1];
      for (let si = 0; si < outerRing.length - 1; si++) {
        const [sx1, sy1] = outerRing[si];
        const [sx2, sy2] = outerRing[si + 1];
        const denom = (rx2 - rx1) * (sy2 - sy1) - (ry2 - ry1) * (sx2 - sx1);
        if (Math.abs(denom) < 1e-12) continue;
        const t = ((sx1 - rx1) * (sy2 - sy1) - (sy1 - ry1) * (sx2 - sx1)) / denom;
        const u = ((sx1 - rx1) * (ry2 - ry1) - (sy1 - ry1) * (rx2 - rx1)) / denom;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
          raw.push({
            position: [ry1 + t * (ry2 - ry1), rx1 + t * (rx2 - rx1)],
            roadName: road.properties.name ?? road.properties.highway,
            highway:  road.properties.highway,
          });
        }
      }
    }
  }

  const out: AccessPoint[] = [];
  for (const c of raw) {
    const isDup = out.some((e) => {
      const dlat = (c.position[0] - e.position[0]) * 111320;
      const dlng = (c.position[1] - e.position[1]) * 111320 * Math.cos((e.position[0] * Math.PI) / 180);
      return Math.sqrt(dlat * dlat + dlng * dlng) < 5;
    });
    if (!isDup) out.push(c);
  }
  return out;
}

// ─── Noise buffer zones ───────────────────────────────────────────────────────

export interface NoiseZoneProperties {
  noiseLevel: string;
  colour:     string;
  label:      string;
  opacity:    number;
}

export type NoiseZoneCollection = FeatureCollection<Polygon | MultiPolygon, NoiseZoneProperties>;

export function buildNoiseZones(roads: RoadFeatureCollection): NoiseZoneCollection {
  const noiseRoads = roads.features.filter(
    (f) => f.properties?.highway === 'primary' || f.properties?.highway === 'secondary'
  );
  const bands = [
    { radiusM: 15, noiseLevel: 'severe',   colour: '#ff2020', opacity: 0.35, label: 'Severe' },
    { radiusM: 35, noiseLevel: 'moderate', colour: '#ff8020', opacity: 0.22, label: 'Moderate' },
    { radiusM: 65, noiseLevel: 'low',      colour: '#ffcc20', opacity: 0.12, label: 'Low' },
  ];

  if (noiseRoads.length === 0) return { type: 'FeatureCollection', features: [] };

  // Buffer all noisy roads as ONE MultiLineString: the buffer op dissolves
  // overlaps itself, so each band comes out as a single merged shape without
  // a per-road buffer + pairwise union loop (which took seconds on busy sites).
  const allRoads: Feature<MultiLineString> = {
    type: 'Feature',
    geometry: { type: 'MultiLineString', coordinates: noiseRoads.map((r) => r.geometry.coordinates) },
    properties: {},
  };

  const features: Feature<Polygon | MultiPolygon, NoiseZoneProperties>[] = [];
  for (const band of bands) {
    let merged: Feature<Polygon | MultiPolygon> | null = null;
    try {
      merged = turfBuffer(allRoads, band.radiusM, { units: 'meters' as Units }) as unknown as Feature<Polygon | MultiPolygon>;
    } catch { /* skip a band that fails to buffer */ }
    if (!merged?.geometry) continue;

    features.push({
      type: 'Feature',
      geometry: merged.geometry,
      properties: { noiseLevel: band.noiseLevel, colour: band.colour, label: band.label, opacity: band.opacity },
    });
  }
  return { type: 'FeatureCollection', features };
}

// ─── Overpass plumbing ────────────────────────────────────────────────────────

// Public Overpass mirrors in preference order. Each one is individually
// unreliable (rate limits, 406/504s, hangs), so ovpFetch hedges across them.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

interface ONode {
  type: 'node'; id: number; lat: number; lon: number;
  tags?: Record<string, string>;
}
interface OWay {
  type: 'way'; id: number; nodes: number[];
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}
interface ORel {
  type: 'relation'; id: number;
  tags?: Record<string, string>;
  members?: { type: string; ref: number; role: string; geometry?: { lat: number; lon: number }[] }[];
}
type OEl   = ONode | OWay | ORel;
interface OResp { elements: OEl[]; }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Per-attempt timeout: the public Overpass mirrors occasionally hang for
// 30s+ on heavier queries. Failing fast lets us retry/fall over instead of
// leaving the UI stuck on "Fetching site context…" with no feedback.
const OVERPASS_ATTEMPT_TIMEOUT_MS = 12_000;

async function fetchWithTimeout(
  url: string,
  body: string,
  headers: HeadersInit,
  signal: AbortSignal | undefined
): Promise<Response | null> {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), OVERPASS_ATTEMPT_TIMEOUT_MS);

  // Combine the caller's abort signal (site changed) with our own timeout.
  const onCallerAbort = () => timeoutController.abort();
  signal?.addEventListener('abort', onCallerAbort);

  try {
    return await fetch(url, { method: 'POST', headers, body, signal: timeoutController.signal }).catch(() => null);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

async function fetchEndpoint(
  url: string,
  body: string,
  headers: HeadersInit,
  signal: AbortSignal | undefined
): Promise<Response | null> {
  // Overpass's public instances 429 under rapid repeated queries (e.g. fast
  // site switching) and occasionally hang outright. Retry with backoff,
  // but only for the caller's own abort (site changed) — a real abort
  // should propagate immediately rather than retrying.
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) return null;
    const res = await fetchWithTimeout(url, body, headers, signal);
    if (res && res.ok) return res;
    if (res && res.status !== 429 && res.status !== 504) return res; // non-retryable failure
    if (attempt < maxAttempts - 1) await sleep(500 * 2 ** attempt);
  }
  return null;
}

// If a mirror hasn't answered by then, bring in the next one in parallel and
// take whichever responds first, instead of waiting out one mirror's full
// retry cycle before even trying another. A mirror that fails outright hands
// over to the next immediately.
const OVERPASS_HEDGE_DELAY_MS = 4_000;

function linkedController(parent: AbortSignal | undefined): AbortController {
  const c = new AbortController();
  if (parent?.aborted) c.abort();
  else parent?.addEventListener('abort', () => c.abort(), { once: true });
  return c;
}

async function ovpFetch(query: string, signal?: AbortSignal): Promise<OResp> {
  const body    = `data=${encodeURIComponent(query)}`;
  const headers: HeadersInit = { 'Content-Type': 'application/x-www-form-urlencoded' };

  const controllers = OVERPASS_ENDPOINTS.map(() => linkedController(signal));

  const res = await new Promise<Response | null>((resolve) => {
    let next    = 0;
    let pending = 0;
    let done    = false;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;

    const launch = () => {
      clearTimeout(hedgeTimer);
      if (done || next >= OVERPASS_ENDPOINTS.length) return;
      const i = next++;
      pending++;
      void fetchEndpoint(OVERPASS_ENDPOINTS[i], body, headers, controllers[i].signal).then((r) => {
        pending--;
        if (done) return;
        if (r && r.ok) {
          done = true;
          clearTimeout(hedgeTimer);
          controllers.forEach((c, j) => { if (j !== i) c.abort(); });
          resolve(r);
          return;
        }
        launch(); // this mirror failed — try the next one now
        if (pending === 0) { done = true; resolve(null); }
      });
      hedgeTimer = setTimeout(launch, OVERPASS_HEDGE_DELAY_MS);
    };
    launch();
  });

  if (!res || !res.ok) throw new Error('Overpass API unavailable — please try again in a moment.');
  return res.json() as Promise<OResp>;
}

// ─── Property types ───────────────────────────────────────────────────────────

export interface OsmBuildingProperties {
  osmId:         number;
  name?:         string;
  buildingType?: string;
  levels?:       number;
  height?:       number;
}

export type BuildingFeatureCollection = FeatureCollection<Polygon | MultiPolygon, OsmBuildingProperties>;

export interface OsmRoadProperties {
  osmId:     number;
  name?:     string;
  highway:   string;
  maxspeed?: string;
  oneway?:   boolean;
  surface?:  string;
  lanes?:    number;
}

export type RoadFeatureCollection = FeatureCollection<LineString, OsmRoadProperties>;

export const ROAD_STYLES: Record<string, { weight: number; colour: string; label: string }> = {
  primary:     { weight: 4,   colour: '#e8c038', label: 'Primary road'     },
  secondary:   { weight: 3,   colour: '#a0c858', label: 'Secondary road'   },
  tertiary:    { weight: 2.5, colour: '#70b8d8', label: 'Tertiary road'    },
  residential: { weight: 2,   colour: '#90b8c8', label: 'Residential road' },
};

export function getRoadStyle(h: string): { weight: number; colour: string; label: string } {
  return ROAD_STYLES[h] ?? { weight: 1.5, colour: '#7898a8', label: h };
}

export interface OsmLandmarkProperties {
  osmId:       number;
  name:        string;
  category:    string;
  subcategory: string;
  colour:      string;
  importance:  number;
  lat:         number;
  lng:         number;
}

export type LandmarkFeatureCollection = FeatureCollection<Point, OsmLandmarkProperties>;

function classifyLandmark(tags: Record<string, string>): { category: string; subcategory: string; colour: string; importance: number } | null {
  const { amenity, historic, leisure, public_transport, tourism, landuse } = tags;
  if (public_transport === 'station' || amenity === 'bus_station' || amenity === 'ferry_terminal')
    return { category: 'Transport',        subcategory: amenity ?? public_transport ?? '', colour: '#c83878', importance: 3 };
  if (amenity === 'university' || amenity === 'college' || amenity === 'school')
    return { category: 'Education',        subcategory: amenity,                           colour: '#3878c8', importance: 2 };
  if (amenity === 'hospital' || amenity === 'clinic')
    return { category: 'Health',           subcategory: amenity,                           colour: '#e84848', importance: 3 };
  if (historic)
    return { category: 'Heritage',         subcategory: historic,                          colour: '#8060a0', importance: 2 };
  if (amenity === 'theatre' || amenity === 'cinema' || amenity === 'library')
    return { category: 'Culture',          subcategory: amenity,                           colour: '#c060c0', importance: 2 };
  if (leisure === 'park' || leisure === 'garden' || landuse === 'recreation_ground')
    return { category: 'Green Space',      subcategory: leisure ?? landuse ?? '',          colour: '#38a878', importance: 2 };
  if (leisure === 'sports_centre' || leisure === 'stadium')
    return { category: 'Sport / Leisure',  subcategory: leisure,                           colour: '#c860a0', importance: 1 };
  if (amenity === 'townhall' || amenity === 'courthouse' || amenity === 'police')
    return { category: 'Civic',            subcategory: amenity,                           colour: '#c8a030', importance: 3 };
  if (tourism === 'attraction' || tourism === 'museum' || tourism === 'gallery')
    return { category: 'Tourism',          subcategory: tourism,                           colour: '#e060a0', importance: 2 };
  if (amenity === 'place_of_worship')
    return { category: 'Heritage / Faith', subcategory: amenity,                           colour: '#a02060', importance: 1 };
  return null;
}

// ─── Comprehensive site context payload ───────────────────────────────────────

export interface SiteContextData {
  buildings: BuildingFeatureCollection;
  roads:     RoadFeatureCollection;
  landmarks: LandmarkFeatureCollection;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * fetchComprehensiveSiteContext
 * Single Overpass union-block query — replaces 3–6 individual requests.
 * All generic type casts use single-line syntax to avoid esbuild parse errors.
 */
export async function fetchComprehensiveSiteContext(
  lat:     number,
  lng:     number,
  radiusM: number = 1000,
  signal?: AbortSignal
): Promise<SiteContextData> {
  const around = `around:${radiusM},${lat},${lng}`;
  // Landmark nodes are filtered server-side to the values classifyLandmark()
  // keeps — fetching every amenity/leisure/tourism node (cafés, benches,
  // bins…) made the response much larger only for it to be discarded.
  const query  = `
    [out:json][timeout:60];
    (
      way["building"](${around});
      relation["building"]["type"="multipolygon"](${around});
      way["highway"~"^(primary|secondary|tertiary|residential)$"](${around});
      node["amenity"~"^(bus_station|ferry_terminal|university|college|school|hospital|clinic|theatre|cinema|library|townhall|courthouse|police|place_of_worship)$"](${around});
      node["historic"](${around});
      node["leisure"~"^(park|garden|sports_centre|stadium)$"](${around});
      node["public_transport"="station"](${around});
      node["tourism"~"^(attraction|museum|gallery)$"](${around});
    );
    out geom tags qt;
  `;

  const data = await ovpFetch(query, signal);

  const buildingFeatures: Feature<Polygon | MultiPolygon, OsmBuildingProperties>[] = [];
  const roadFeatures:     Feature<LineString, OsmRoadProperties>[]                 = [];
  const landmarkFeatures: Feature<Point, OsmLandmarkProperties>[]                  = [];

  for (const el of data.elements) {
    if (el.type === 'node') {
      const n = el as ONode;
      if (!n.tags || typeof n.lat !== 'number' || typeof n.lon !== 'number') continue;
      const name = n.tags['name'] ?? n.tags['operator'];
      if (!name) continue;
      const cls = classifyLandmark(n.tags);
      if (!cls) continue;
      landmarkFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [n.lon, n.lat] },
        properties: { osmId: n.id, name, lat: n.lat, lng: n.lon, ...cls },
      });
      continue;
    }

    if (el.type === 'way') {
      const w          = el as OWay;
      if (!w.tags)     continue;
      const isBuilding = !!w.tags['building'];
      const isRoad     = !!w.tags['highway'] &&
        ['primary', 'secondary', 'tertiary', 'residential'].includes(w.tags['highway']);

      if (isBuilding && w.geometry && w.geometry.length >= 3) {
        const coords = closeCoordRing(w.geometry.map((n) => [n.lon, n.lat] as [number, number]));
        buildingFeatures.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [coords] },
          properties: {
            osmId:        w.id,
            name:         w.tags['name'],
            buildingType: w.tags['building'],
            levels:       w.tags['building:levels'] ? parseInt(w.tags['building:levels'], 10) : w.tags['height'] ? Math.round(parseFloat(w.tags['height']) / 3.2) : undefined,
            height:       w.tags['height'] ? parseFloat(w.tags['height']) : w.tags['building:levels'] ? parseInt(w.tags['building:levels'], 10) * 3.2 : undefined,
          },
        });
        continue;
      }

      if (isRoad && w.geometry && w.geometry.length >= 2) {
        // Overpass's `around` filter only requires ONE node of a way to be
        // within radius — the returned geometry can include nodes far
        // outside it (a long road continuing past the search boundary).
        // Clip to nodes actually within radius so buffers (e.g. noise
        // zones) don't balloon out along the rest of the road.
        const margin = radiusM * 1.1;
        const inRange = w.geometry.filter(
          (n) => haversineMeters(lat, lng, n.lat, n.lon) <= margin
        );
        if (inRange.length < 2) continue;
        roadFeatures.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: inRange.map((n) => [n.lon, n.lat]) },
          properties: {
            osmId:    w.id,
            name:     w.tags['name'],
            highway:  w.tags['highway'],
            maxspeed: w.tags['maxspeed'],
            oneway:   w.tags['oneway'] === 'yes',
            surface:  w.tags['surface'],
            lanes:    w.tags['lanes'] ? parseInt(w.tags['lanes'], 10) : undefined,
          },
        });
        continue;
      }
    }

    if (el.type === 'relation') {
      const r = el as ORel;
      if (!r.tags?.['building'] || !r.members) continue;
      const outer: [number, number][][] = [];
      const inner: [number, number][][] = [];
      for (const m of r.members) {
        if (m.type !== 'way' || !m.geometry) continue;
        const coords = closeCoordRing(m.geometry.map((n) => [n.lon, n.lat] as [number, number]));
        if (coords.length < 4) continue;
        if (m.role === 'outer') outer.push(coords);
        if (m.role === 'inner') inner.push(coords);
      }
      if (!outer.length) continue;
      const geom: Polygon | MultiPolygon = outer.length === 1
        ? { type: 'Polygon',      coordinates: [outer[0], ...inner] }
        : { type: 'MultiPolygon', coordinates: outer.map((o) => [o]) };
      buildingFeatures.push({
        type: 'Feature', geometry: geom,
        properties: {
          osmId:        r.id,
          name:         r.tags['name'],
          buildingType: r.tags['building'],
          levels:       r.tags['building:levels'] ? parseInt(r.tags['building:levels'], 10) : undefined,
          height:       r.tags['height']           ? parseFloat(r.tags['height'])             : undefined,
        },
      });
    }
  }

  return {
    buildings: { type: 'FeatureCollection', features: buildingFeatures },
    roads:     { type: 'FeatureCollection', features: roadFeatures     },
    landmarks: { type: 'FeatureCollection', features: landmarkFeatures },
  };
}

// ─── Linkage lines ────────────────────────────────────────────────────────────

export interface LinkageLine {
  from:      LatLngTuple;
  to:        LatLngTuple;
  name:      string;
  category:  string;
  colour:    string;
  distanceM: number;
}

export function buildLinkageLinesFromLandmarks(
  site:      Feature<Polygon | MultiPolygon>,
  landmarks: LandmarkFeatureCollection,
  maxLinks:  number = 5
): LinkageLine[] {
  const cFeature     = turfCenter(site);
  const cPt          = cFeature.geometry as Point;
  const [clng, clat] = cPt.coordinates;
  const cp           = turfPoint([clng, clat]);

  return landmarks.features
    .map((f) => {
      const gPt          = f.geometry as Point;
      const [fLng, fLat] = gPt.coordinates;
      return { f, dist: turfDistance(cp, turfPoint([fLng, fLat]), { units: 'kilometers' }) };
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, maxLinks)
    .map(({ f, dist }) => {
      const p = f.properties as OsmLandmarkProperties;
      return {
        from:      [clat, clng] as LatLngTuple,
        to:        [p.lat, p.lng] as LatLngTuple,
        name:      p.name,
        category:  p.category,
        colour:    p.colour,
        distanceM: Math.round(dist * 1000),
      };
    });
}