import type {
  Feature,
  FeatureCollection,
  Polygon,
  MultiPolygon,
  Point,
  Position,
} from 'geojson';
import turfArea   from '@turf/area';
import turfBuffer from '@turf/buffer';
import turfCenter from '@turf/center';
import type { Units } from '@turf/helpers';
import type {
  GridCell,
  Quadrant,
  PlacedUnit,
  PlacedCore,
  ZonedCell,
  ZoneType,
  QuadrantStats,
  ValidationResult,
  GeneratedPlan,
  Storeys,
} from '../types/architecture';
import {
  GRID_CELL_SIZE_M,
  NDSS_UNIT_TYPES,
} from '../types/architecture';
import type { SiteContextData, RoadFeatureCollection } from './geoUtils';

// ─── Vertical level constants ─────────────────────────────────────────────────

export const MAX_LEVELS      = 4;
export const STOREY_HEIGHT_M = 3.5;
export const CORE_OVERRUN_M  = 1.5;

// Hard iteration cap per packing loop pass
const MAX_PACK_ATTEMPTS = 2000;

// ─── Dynamic grid resolution ──────────────────────────────────────────────────

/**
 * Derives the active grid module size (in metres) from site area.
 * Sites < 2 000 m² use a 2 m module for finer resolution.
 * Larger sites use the standard 4 m module.
 */
export function deriveGridSize(
  sitePolygon: Feature<Polygon | MultiPolygon>
): 2 | 4 {
  try {
    const areaSqm = turfArea(sitePolygon);
    return areaSqm < 2000 ? 2 : 4;
  } catch {
    return 4;
  }
}

// ─── UnitInstance — collapsed per-anchor export for Step 7 ───────────────────

/**
 * A single resolved building instance derived from the packing algorithm.
 * One UnitInstance is emitted per anchor cell regardless of how many
 * stacked PlacedUnit records share that anchor.  The `levels` field
 * carries the total number of storeys across the full stack so the 3D
 * assembler can clone and stack one GLB model per level without scaling.
 */
export interface UnitInstance {
  id:           string;   // anchor unit id (ground-floor unit)
  type:         string;   // NDSS typology id, e.g. '2b4p'
  anchorX:      number;   // col × gridSize (metres from site origin, west→east)
  anchorY:      number;   // row × gridSize (metres from site origin, north→south)
  widthInCells: number;   // footprint width in grid cells
  lengthInCells: number;  // footprint depth in grid cells
  levels:       number;   // total storeys in the vertical stack
}

/**
 * Collapses a `placedUnits` array + `stackMap` into one `UnitInstance`
 * per anchor position.  Only level-0 (ground-floor) units produce an
 * instance; stacked entries on the same anchor contribute to `levels`.
 */
export function exportUnitInstances(
  placedUnits: PlacedUnit[],
  stackMap:    StackMap,
  gridSize:    number = GRID_CELL_SIZE_M
): UnitInstance[] {
  const instances: UnitInstance[] = [];

  for (const unit of placedUnits) {
    if (!unit || (unit as any).level !== 0) continue;

    const sk     = `${unit.col},${unit.row}`;
    const stack  = stackMap.get(sk) ?? [];
    const levels = stack.reduce((sum, e) => sum + (e?.storeys ?? 0), 0) || (unit.storeys as number) || 1;

    instances.push({
      id:            unit.id,
      type:          unit.unitTypeId,
      anchorX:       unit.col * gridSize,
      anchorY:       unit.row * gridSize,
      widthInCells:  unit.widthCells,
      lengthInCells: unit.heightCells,
      levels,
    });
  }

  return instances;
}

// ─── Bounding box ─────────────────────────────────────────────────────────────

export interface SiteBbox {
  minLng:  number;
  minLat:  number;
  maxLng:  number;
  maxLat:  number;
  widthM:  number;
  heightM: number;
}

export function getSiteBbox(
  site: Feature<Polygon | MultiPolygon>
): SiteBbox {
  let minLng =  Infinity, minLat =  Infinity;
  let maxLng = -Infinity, maxLat = -Infinity;

  const processRing = (ring: Position[]) => {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  };

  if (site.geometry.type === 'Polygon') {
    processRing(site.geometry.coordinates[0]);
  } else {
    site.geometry.coordinates.forEach((p) => processRing(p[0]));
  }

  const midLat  = (minLat + maxLat) / 2;
  const widthM  = (maxLng - minLng) * 111320 * Math.cos((midLat * Math.PI) / 180);
  const heightM = (maxLat - minLat) * 111320;
  return { minLng, minLat, maxLng, maxLat, widthM, heightM };
}

// ─── Setback ──────────────────────────────────────────────────────────────────

export function applySetback(
  site:     Feature<Polygon | MultiPolygon>,
  setbackM: number = 5
): Feature<Polygon | MultiPolygon> {
  try {
    const buf = turfBuffer(site, -Math.abs(setbackM), { units: 'meters' as Units });
    if (!buf) return site;
    const asAny = buf as unknown as { type: string };
    if (asAny.type === 'FeatureCollection') {
      const fc = buf as unknown as FeatureCollection;
      if (!fc.features.length) return site;
      return fc.features[0] as Feature<Polygon | MultiPolygon>;
    }
    return buf as unknown as Feature<Polygon | MultiPolygon>;
  } catch {
    return site;
  }
}

// ─── Centroid ─────────────────────────────────────────────────────────────────

export function getSiteCentroid(
  site: Feature<Polygon | MultiPolygon>
): [number, number] {
  const c  = turfCenter(site);
  const pt = c.geometry as Point;
  return [pt.coordinates[1], pt.coordinates[0]];
}

export function computeSiteAxes(
  site: Feature<Polygon | MultiPolygon>
): { centroid: [number, number] } {
  return { centroid: getSiteCentroid(site) };
}

// ─── Quadrant assignment ──────────────────────────────────────────────────────

export function getQuadrant(
  lng:      number,
  lat:      number,
  centroid: [number, number]
): Quadrant {
  const [clat, clng] = centroid;
  if (lat >= clat && lng <  clng) return 'NW';
  if (lat >= clat && lng >= clng) return 'NE';
  if (lat <  clat && lng >= clng) return 'SE';
  return 'SW';
}

// ─── Point-in-polygon ─────────────────────────────────────────────────────────

function pointInPolygon(
  lng:  number,
  lat:  number,
  poly: Feature<Polygon | MultiPolygon>
): boolean {
  const testRing = (ring: Position[]): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (
        yi > lat !== yj > lat &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
      ) inside = !inside;
    }
    return inside;
  };
  if (poly.geometry.type === 'Polygon')
    return testRing(poly.geometry.coordinates[0]);
  return poly.geometry.coordinates.some((p) => testRing(p[0]));
}

// ─── Grid generation ──────────────────────────────────────────────────────────

export function generateGrid(
  site:    Feature<Polygon | MultiPolygon>,
  scalePx: number,
  offsetX: number,
  offsetY: number
): GridCell[] {
  const bb       = getSiteBbox(site);
  const centroid = getSiteCentroid(site);
  const midLat   = (bb.minLat + bb.maxLat) / 2;
  const cellDegLng =
    (GRID_CELL_SIZE_M / 111320) / Math.cos((midLat * Math.PI) / 180);
  const cellDegLat = GRID_CELL_SIZE_M / 111320;
  const cols = Math.ceil((bb.maxLng - bb.minLng) / cellDegLng);
  const rows = Math.ceil((bb.maxLat - bb.minLat) / cellDegLat);
  const cells: GridCell[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const centreLng = bb.minLng + (col + 0.5) * cellDegLng;
      const centreLat = bb.maxLat - (row + 0.5) * cellDegLat;
      cells.push({
        col, row,
        x:        offsetX + col * GRID_CELL_SIZE_M * scalePx,
        y:        offsetY + row * GRID_CELL_SIZE_M * scalePx,
        inSite:   pointInPolygon(centreLng, centreLat, site),
        quadrant: getQuadrant(centreLng, centreLat, centroid),
      });
    }
  }
  return cells;
}

// ─── Quadrant statistics ──────────────────────────────────────────────────────

export function computeQuadrantStats(
  cells:       GridCell[],
  zoned:       Record<string, ZonedCell>,
  placedCores: PlacedCore[]
): QuadrantStats[] {
  const quads: Quadrant[] = ['NW', 'NE', 'SE', 'SW'];
  return quads.map((q) => {
    const qCells    = cells.filter((c) => c?.inSite && c.quadrant === q);
    const total     = qCells.length;
    const gardens   = qCells.filter(
      (c) => zoned[`${c.col},${c.row}`]?.zoneType === 'garden'
    ).length;
    const pct       = total > 0 ? (gardens / total) * 100 : 0;
    const unitCount = Object.values(zoned).filter(
      (zc) =>
        zc?.zoneType === 'unit' &&
        cells.find((c) => c.col === zc.col && c.row === zc.row && c.quadrant === q)
    ).length;
    const coreCount = (placedCores ?? []).filter((core) => {
      const c = cells.find((x) => x.col === core.col && x.row === core.row);
      return c?.quadrant === q;
    }).length;
    return {
      quadrant:        q,
      totalCells:      total,
      gardenCells:     gardens,
      gardenPct:       Math.round(pct * 10) / 10,
      gardenSatisfied: pct >= 10,
      placedUnits:     unitCount,
      coreCount,
    };
  });
}

// ─── Spatial rules validation ─────────────────────────────────────────────────

export function validateSpatialRules(
  cells:       GridCell[],
  zoned:       Record<string, ZonedCell>,
  gridCols:    number,
  gridRows:    number,
  placedCores: PlacedCore[]
): ValidationResult[] {
  const results: ValidationResult[] = [];
  const get     = (col: number, row: number) => zoned[`${col},${row}`];
  const midCol  = Math.floor(gridCols / 2);
  const midRow  = Math.floor(gridRows / 2);

  const onPrimaryAxis = (col: number, row: number) =>
    col === midCol || row === midRow;

  const neighbours = (col: number, row: number) =>
    [get(col-1,row), get(col+1,row), get(col,row-1), get(col,row+1)]
      .filter(Boolean) as ZonedCell[];

  // Rule 1 — Gardens touch primary axis
  const gardenCells  = Object.values(zoned).filter((z) => z?.zoneType === 'garden');
  const disconnected = gardenCells.filter(
    (g) =>
      !onPrimaryAxis(g.col, g.row) &&
      !neighbours(g.col, g.row).some((n) => onPrimaryAxis(n.col, n.row))
  );
  results.push({
    rule:    'Garden connectivity to primary axis',
    passed:  disconnected.length === 0,
    message: disconnected.length === 0
      ? 'All gardens touch the primary axis. ✓'
      : `${disconnected.length} garden cell(s) not touching the primary axis.`,
  });

  // Rule 2 — Garden ≥ 10% per quadrant
  const siteCells = cells.filter((c) => c?.inSite);
  const quads: Quadrant[] = ['NW', 'NE', 'SE', 'SW'];
  const failedQuads = quads.filter((q) => {
    const qTotal   = siteCells.filter((c) => c.quadrant === q).length;
    const qGardens = gardenCells.filter((g) =>
      cells.find((c) => c.col === g.col && c.row === g.row && c.quadrant === q)
    ).length;
    return qTotal > 0 && qGardens / qTotal < 0.1;
  });
  results.push({
    rule:    'Garden allocation (≥ 10% per quadrant)',
    passed:  failedQuads.length === 0,
    message: failedQuads.length === 0
      ? 'All quadrants meet the 10% garden requirement. ✓'
      : `Quadrant(s) ${failedQuads.join(', ')} below 10% garden target.`,
  });

  // Rule 3 — Units accessible
  const unitCells     = Object.values(zoned).filter((z) => z?.zoneType === 'unit');
  const isolatedUnits = unitCells.filter(
    (u) => !(placedCores ?? []).some(
      (c) => Math.abs(c.col - u.col) + Math.abs(c.row - u.row) <= 5
    )
  );
  results.push({
    rule:    'All units within reach of a circulation core',
    passed:  isolatedUnits.length === 0,
    message: isolatedUnits.length === 0
      ? 'All units are within reach of a circulation core. ✓'
      : `${isolatedUnits.length} unit cell(s) not near any core.`,
  });

  // Rule 4 — Height clamping
  const clampedUnits = Object.values(zoned).filter(
    (z) => z?.zoneType === 'unit' && z.isClamped === true
  );
  results.push({
    rule:    'Context height clamping',
    passed:  clampedUnits.length === 0,
    message: clampedUnits.length === 0
      ? 'No units exceed the context mean height limit. ✓'
      : `${clampedUnits.length} unit cell(s) were clamped to the context mean height.`,
  });

  return results;
}

// ─── Area summary ─────────────────────────────────────────────────────────────

export interface AreaSummary {
  totalSiteSqm:   number;
  developableSqm: number;
  gardenSqm:      number;
  gardenPct:      number;
  unitsSqm:       number;
  circulationSqm: number;
  remainingSqm:   number;
}

export function computeAreaSummary(
  site:  Feature<Polygon | MultiPolygon>,
  cells: GridCell[],
  zoned: Record<string, ZonedCell>
): AreaSummary {
  const cellSqm   = GRID_CELL_SIZE_M * GRID_CELL_SIZE_M;
  const siteCells = cells.filter((c) => c?.inSite);
  const count     = (type: string) =>
    siteCells.filter((c) => zoned[`${c.col},${c.row}`]?.zoneType === type).length;
  const total     = turfArea(site);
  const devSqm    = siteCells.length * cellSqm;
  const gCells    = count('garden');
  const uCells    = count('unit');
  const cCells    = count('circulation');
  return {
    totalSiteSqm:   total,
    developableSqm: devSqm,
    gardenSqm:      gCells * cellSqm,
    gardenPct:      devSqm > 0 ? (gCells / siteCells.length) * 100 : 0,
    unitsSqm:       uCells * cellSqm,
    circulationSqm: cCells * cellSqm,
    remainingSqm:   (siteCells.length - gCells - uCells - cCells) * cellSqm,
  };
}

// ─── Unit placement check ─────────────────────────────────────────────────────

export function canPlaceUnit(
  col:         number,
  row:         number,
  widthCells:  number,
  heightCells: number,
  cells:       GridCell[],
  zoned:       Record<string, ZonedCell>
): boolean {
  if (
    !Number.isFinite(col) || !Number.isFinite(row) ||
    !Number.isFinite(widthCells)  || widthCells  < 1 ||
    !Number.isFinite(heightCells) || heightCells < 1
  ) return false;
  for (let dc = 0; dc < widthCells; dc++) {
    for (let dr = 0; dr < heightCells; dr++) {
      const cell = cells.find((x) => x.col === col + dc && x.row === row + dr);
      if (!cell || !cell.inSite)             return false;
      if (zoned[`${col + dc},${row + dr}`]) return false;
    }
  }
  return true;
}

// ─── Vertical stacking check ──────────────────────────────────────────────────

export function canStackLevel(
  col:                 number,
  row:                 number,
  storeys:             number,
  currentStack:        StackEntry[],
  zoned:               Record<string, ZonedCell>,
  contextHeightLimitM: number | null
): boolean {
  if (storeys < 1 || storeys > 5) return false;
  if (zoned[`${col},${row}`]?.zoneType === 'circulation') return false;
  const occupied = (currentStack ?? []).reduce((sum, e) => sum + (e?.storeys ?? 0), 0);
  if (occupied >= MAX_LEVELS)          return false;
  if (occupied + storeys > MAX_LEVELS) return false;
  if (contextHeightLimitM !== null && Number.isFinite(contextHeightLimitM)) {
    const currentH = (currentStack ?? []).reduce(
      (sum, e) => sum + (e?.storeys ?? 0) * STOREY_HEIGHT_M, 0
    );
    if (currentH + storeys * STOREY_HEIGHT_M > contextHeightLimitM) return false;
  }
  return true;
}

// ─── Z-level stack map ────────────────────────────────────────────────────────

export interface StackEntry {
  unitId:    string;
  storeys:   Storeys;
  isClamped: boolean;
}

export type StackMap = Map<string, StackEntry[]>;

export function computeStackHeightM(
  col:      number,
  row:      number,
  stackMap: StackMap | null | undefined
): number {
  if (!stackMap) return 0;
  const stack = stackMap.get(`${col},${row}`);
  if (!Array.isArray(stack) || stack.length === 0) return 0;
  return stack.reduce(
    (total, e) => total + (e?.storeys ?? 0) * STOREY_HEIGHT_M, 0
  );
}

// ─── Composite heuristic scoring ─────────────────────────────────────────────

export interface CellScore {
  col:        number;
  row:        number;
  noiseScore: number;
  solarScore: number;
  zone:       ResolvedZone;
}

type ResolvedZone = 'premium-unit' | 'standard-unit' | 'garden' | 'buffer';

const ACOUSTIC_BANDS = {
  primary:   { SEVERE_M: 20, MODERATE_M: 50,  QUIET_M: 100 },
  secondary: { SEVERE_M: 10, MODERATE_M: 30,  QUIET_M: 65  },
};

function pointToSegmentDistM(
  pLng: number, pLat: number,
  aLng: number, aLat: number,
  bLng: number, bLat: number
): number {
  const cosLat = Math.cos((((pLat + aLat + bLat) / 3) * Math.PI) / 180);
  const px = (pLng - aLng) * 111320 * cosLat;
  const py = (pLat - aLat) * 111320;
  const dx = (bLng - aLng) * 111320 * cosLat;
  const dy = (bLat - aLat) * 111320;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return Math.sqrt(px * px + py * py);
  const t  = Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));
  return Math.sqrt((t * dx - px) ** 2 + (t * dy - py) ** 2);
}

function computeNoiseScore(
  centreLng: number,
  centreLat: number,
  roads:     RoadFeatureCollection
): number {
  let minDist   = Infinity;
  let roadClass = 'residential';
  for (const feature of (roads?.features ?? [])) {
    const hw = feature?.properties?.highway ?? 'residential';
    if (hw !== 'primary' && hw !== 'secondary') continue;
    const coords = (feature.geometry as unknown as { coordinates: [number,number][] })?.coordinates;
    if (!Array.isArray(coords)) continue;
    for (let i = 0; i < coords.length - 1; i++) {
      const [aLng, aLat] = coords[i]   ?? [0, 0];
      const [bLng, bLat] = coords[i+1] ?? [0, 0];
      const d = pointToSegmentDistM(centreLng, centreLat, aLng, aLat, bLng, bLat);
      if (d < minDist) { minDist = d; roadClass = hw; }
    }
  }
  if (!Number.isFinite(minDist) || minDist === Infinity) return 1.0;
  const bands = roadClass === 'primary' ? ACOUSTIC_BANDS.primary : ACOUSTIC_BANDS.secondary;
  if (minDist <= bands.SEVERE_M)   return 0.0;
  if (minDist >= bands.QUIET_M)    return 1.0;
  if (minDist <= bands.MODERATE_M)
    return 0.35 * (minDist - bands.SEVERE_M) / (bands.MODERATE_M - bands.SEVERE_M);
  return 0.35 + 0.65 * (minDist - bands.MODERATE_M) / (bands.QUIET_M - bands.MODERATE_M);
}

function computeSolarScore(
  centreLng: number,
  centreLat: number,
  siteBbox:  SiteBbox,
  centroid:  [number, number]
): number {
  const [, cLng] = centroid;
  const latRange = siteBbox.maxLat - siteBbox.minLat;
  const normLat  = latRange > 1e-10 ? (centreLat - siteBbox.minLat) / latRange : 0.5;
  const primary  = 1 - normLat;
  const maxLng   = (siteBbox.maxLng - siteBbox.minLng) / 2 + 1e-12;
  const eastBias = ((centreLng - cLng) / maxLng) * 0.065;
  return Math.max(0, Math.min(1, primary + eastBias));
}

const NOISE_THRESHOLD = 0.4;
const SOLAR_THRESHOLD = 0.55;

function resolveZone(noiseScore: number, solarScore: number): ResolvedZone {
  const isNoisy = noiseScore < NOISE_THRESHOLD;
  const isSouth = solarScore >= SOLAR_THRESHOLD;
  if (isNoisy && isSouth)   return 'garden';
  if (isNoisy && !isSouth)  return 'buffer';
  if (!isNoisy && isSouth)  return 'premium-unit';
  return 'standard-unit';
}

export function scoreGridCells(
  cells: GridCell[],
  site:  Feature<Polygon | MultiPolygon>,
  roads: RoadFeatureCollection
): CellScore[] {
  const bb        = getSiteBbox(site);
  const centroid  = getSiteCentroid(site);
  const midLat    = (bb.minLat + bb.maxLat) / 2;
  const cellDegLng =
    (GRID_CELL_SIZE_M / 111320) / Math.cos((midLat * Math.PI) / 180);
  const cellDegLat = GRID_CELL_SIZE_M / 111320;
  const scored: CellScore[] = [];

  for (const cell of cells) {
    if (!cell?.inSite) continue;
    const centreLng  = bb.minLng + (cell.col + 0.5) * cellDegLng;
    const centreLat  = bb.maxLat - (cell.row + 0.5) * cellDegLat;
    const noiseScore = computeNoiseScore(centreLng, centreLat, roads);
    const solarScore = computeSolarScore(centreLng, centreLat, bb, centroid);
    scored.push({ col: cell.col, row: cell.row, noiseScore, solarScore, zone: resolveZone(noiseScore, solarScore) });
  }
  return scored;
}

// ─── Road hierarchy ───────────────────────────────────────────────────────────

export type RoadHierarchy = 'primary' | 'secondary' | 'tertiary';

export interface RoadCell {
  col:        number;
  row:        number;
  hierarchy:  RoadHierarchy;
  /**
   * blocksLayout = true  → cell is added to roadSet, blocks unit placement
   * blocksLayout = false → visual-only overlay, units may still occupy the cell
   *
   * Primary roads block layout.
   * Secondary roads are visual-only (half-unit-wide stripe).
   * Tertiary roads are visual-only (half-unit-wide stripe).
   */
  blocksLayout: boolean;
}

/**
 * computeRoadNetwork
 *
 * Returns ALL road cells for visual rendering.
 * Only PRIMARY roads are added to roadSet (blocksLayout = true).
 * Secondary and tertiary roads are painted as half-unit-wide visual stripes
 * and do NOT block unit placement or cluster derivation.
 *
 * This is the key fix: previously secondary and tertiary roads fragmented
 * the site into tiny unusable clusters, preventing any unit from placing.
 */
export function computeRoadNetwork(
  cells:    GridCell[],
  gridCols: number,
  gridRows: number
): RoadCell[] {
  if (gridCols < 3 || gridRows < 3) return [];

  const roadCells: RoadCell[] = [];
  const seen = new Set<string>();

  const addRoad = (col: number, row: number, hier: RoadHierarchy, blocks: boolean) => {
    if (col < 0 || row < 0 || col >= gridCols || row >= gridRows) return;
    const k = `${col},${row}`;
    if (seen.has(k)) return;
    const cell = cells.find((c) => c?.col === col && c?.row === row && c?.inSite);
    if (!cell) return;
    seen.add(k);
    roadCells.push({ col, row, hierarchy: hier, blocksLayout: blocks });
  };

  const midCol = Math.floor(gridCols / 2);
  const midRow = Math.floor(gridRows / 2);

  // ── Primary axis — 1 cell wide (4 m), BLOCKS layout ──────────────────────
  for (let r = 0; r < gridRows; r++) addRoad(midCol, r, 'primary', true);
  for (let c = 0; c < gridCols; c++) addRoad(c, midRow, 'primary', true);

  // ── Secondary roads — visual-only, do NOT block layout ───────────────────
  // Rendered as half-unit-wide stripes at 25% and 75% of grid dimensions.
  for (const sCol of [
    Math.floor(gridCols * 0.25),
    Math.floor(gridCols * 0.75),
  ]) {
    for (let r = 0; r < gridRows; r++) addRoad(sCol, r, 'secondary', false);
  }
  for (const sRow of [
    Math.floor(gridRows * 0.25),
    Math.floor(gridRows * 0.75),
  ]) {
    for (let c = 0; c < gridCols; c++) addRoad(c, sRow, 'secondary', false);
  }

  // ── Tertiary corridors — visual-only, do NOT block layout ─────────────────
  // Rendered as half-unit-wide stripes at 12.5% intervals.
  for (const tCol of [
    Math.floor(gridCols * 0.125), Math.floor(gridCols * 0.375),
    Math.floor(gridCols * 0.625), Math.floor(gridCols * 0.875),
  ]) {
    for (let r = 0; r < gridRows; r++) addRoad(tCol, r, 'tertiary', false);
  }
  for (const tRow of [
    Math.floor(gridRows * 0.125), Math.floor(gridRows * 0.375),
    Math.floor(gridRows * 0.625), Math.floor(gridRows * 0.875),
  ]) {
    for (let c = 0; c < gridCols; c++) addRoad(c, tRow, 'tertiary', false);
  }

  return roadCells;
}

// ─── Tower cluster derivation ─────────────────────────────────────────────────

export interface TowerCluster {
  id:       string;
  cells:    GridCell[];
  quadrant: Quadrant;
  colMin:   number;
  colMax:   number;
  rowMin:   number;
  rowMax:   number;
}

/**
 * deriveTowerClusters
 *
 * BFS flood-fill over buildable cells, using ONLY the primary-axis roadSet
 * as hard boundaries. Secondary/tertiary roads no longer fragment the site.
 */
export function deriveTowerClusters(
  cells:   GridCell[],
  roadSet: Set<string>       // contains only primary-axis cells
): TowerCluster[] {
  const buildable = cells.filter(
    (c) => c?.inSite && !roadSet.has(`${c.col},${c.row}`)
  );
  const visited   = new Set<string>();
  const clusters: TowerCluster[] = [];
  let   idCounter = 0;

  for (const seed of buildable) {
    if (!seed) continue;
    const sk = `${seed.col},${seed.row}`;
    if (visited.has(sk)) continue;

    const clusterCells: GridCell[] = [];
    const queue: GridCell[] = [seed];
    visited.add(sk);

    let bfsCount = 0;
    while (queue.length > 0 && bfsCount < 10000) {
      bfsCount++;
      const current = queue.shift()!;
      clusterCells.push(current);
      for (const [nc, nr] of [
        [current.col - 1, current.row],
        [current.col + 1, current.row],
        [current.col,     current.row - 1],
        [current.col,     current.row + 1],
      ]) {
        const nk = `${nc},${nr}`;
        if (visited.has(nk) || roadSet.has(nk)) continue;
        const n = buildable.find((c) => c.col === nc && c.row === nr);
        if (!n) continue;
        visited.add(nk);
        queue.push(n);
      }
    }

    if (clusterCells.length < 1) continue;

    const colMin = Math.min(...clusterCells.map((c) => c.col));
    const colMax = Math.max(...clusterCells.map((c) => c.col));
    const rowMin = Math.min(...clusterCells.map((c) => c.row));
    const rowMax = Math.max(...clusterCells.map((c) => c.row));

    const quadCounts: Record<Quadrant, number> = { NW:0, NE:0, SE:0, SW:0 };
    for (const c of clusterCells) quadCounts[c.quadrant]++;
    const dominantQ = (Object.keys(quadCounts) as Quadrant[])
      .reduce((a, b) => quadCounts[a] >= quadCounts[b] ? a : b);

    clusters.push({
      id: `cluster-${idCounter++}`,
      cells: clusterCells,
      quadrant: dominantQ,
      colMin, colMax, rowMin, rowMax,
    });
  }
  return clusters;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN GENERATION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * generateProceduralPlan
 *
 * Road topology:
 *   Primary axis (midCol, midRow) → zoned as 'public', blocks unit placement
 *   Secondary roads               → visual-only, units may overlap them
 *   Tertiary roads                → visual-only, units may overlap them
 *
 * This means the packing loop sees large open quadrants to fill, not tiny
 * 1-2 cell fragments.
 */
export function generateProceduralPlan(
  cells:               GridCell[],
  gridCols:            number,
  gridRows:            number,
  siteBbox:            { widthM: number; heightM: number },
  site:                Feature<Polygon | MultiPolygon>,
  contextData:         SiteContextData | null,
  contextHeightLimitM: number | null = null
): GeneratedPlan {
  // Safe empty plan
  const emptyPlan = (): GeneratedPlan => ({
    placedUnits: [], placedCores: [],
    zonedCells: {}, stackMap: new Map(),
    gridCols: Math.max(gridCols, 1),
    gridRows: Math.max(gridRows, 1),
    cellSizeM: GRID_CELL_SIZE_M,
    siteBboxM: siteBbox,
  });

  if (!Array.isArray(cells) || cells.length === 0) return emptyPlan();

  const siteCells = cells.filter((c) => c?.inSite === true);
  if (siteCells.length === 0) return emptyPlan();

  const zoned:    Record<string, ZonedCell> = {};
  const placed:   PlacedUnit[]  = [];
  const cores:    PlacedCore[]  = [];
  const stackMap: StackMap      = new Map();

  const safeGridCols = Math.max(gridCols, 1);
  const safeGridRows = Math.max(gridRows, 1);
  const midCol  = Math.floor(safeGridCols / 2);
  const midRow  = Math.floor(safeGridRows / 2);
  const key     = (col: number, row: number) => `${col},${row}`;
  const isFree  = (col: number, row: number) => !zoned[key(col, row)];

  const onPrimaryAxis = (col: number, row: number) =>
    col === midCol || row === midRow;

  // ── Phase 0: Scoring ──────────────────────────────────────────────────────
  const scoreMap = new Map<string, CellScore>();
  const hasRoads =
    Array.isArray(contextData?.roads?.features) &&
    (contextData!.roads.features.length ?? 0) > 0;

  if (hasRoads) {
    try {
      const scores = scoreGridCells(siteCells, site, contextData!.roads);
      for (const s of scores) {
        if (s) scoreMap.set(key(s.col, s.row), s);
      }
    } catch (err) {
      console.warn('[architectureUtils] Scoring failed, solar-only fallback:', err);
    }
  }

  if (scoreMap.size === 0) {
    const bb         = getSiteBbox(site);
    const latRange   = bb.maxLat - bb.minLat;
    const cellDegLat = GRID_CELL_SIZE_M / 111320;
    for (const cell of siteCells) {
      const centreLat = bb.maxLat - (cell.row + 0.5) * cellDegLat;
      const normLat   = latRange > 1e-10 ? (centreLat - bb.minLat) / latRange : 0.5;
      const solar     = Math.max(0, Math.min(1, 1 - normLat));
      const zone: ResolvedZone = solar >= SOLAR_THRESHOLD ? 'premium-unit' : 'standard-unit';
      scoreMap.set(key(cell.col, cell.row), {
        col: cell.col, row: cell.row, noiseScore: 1.0, solarScore: solar, zone,
      });
    }
  }

  // ── Phase 1: Road network — only primary axis blocks layout ───────────────
  const allRoadCells = computeRoadNetwork(cells, safeGridCols, safeGridRows);
  const roadSet      = new Set<string>();   // primary-only hard boundaries

  for (const rc of allRoadCells) {
    if (!rc) continue;
    if (rc.blocksLayout) {
      // Primary axis → zone as public road, block packing
      roadSet.add(key(rc.col, rc.row));
      zoned[key(rc.col, rc.row)] = {
        col: rc.col, row: rc.row, zoneType: 'public', isClamped: false,
      };
    }
    // Secondary/tertiary roads are NOT added to zoned or roadSet.
    // They only appear as visual-only stripes drawn by the canvas renderer.
  }

  // ── Phase 2: Garden allocation (30% per quadrant, concentric square forms) ─
  //
  // Instead of linear strips, gardens are placed as:
  //   A) Concentric square rings (hollow squares of radius 1, 2, 3) centred at
  //      focal points distributed across each quadrant.
  //   B) Solid square patches (2×2 or 3×3) for smaller courtyard inserts.
  //   C) L-shaped corners for variety at ring edges.
  //
  // gardenWidthMap still records each cell's "ring thickness" (1, 2, or 3),
  // which drives the same adjacent building height cap as before.
  //
  const gardenWidthMap = new Map<string, number>();

  // ── Helpers ────────────────────────────────────────────────────────────────

  // Mark a single cell as garden with a given width value
  const markGarden = (col: number, row: number, w: number): boolean => {
    const k = key(col, row);
    const cell = cells.find((x) => x?.col === col && x?.row === row && x?.inSite);
    if (!cell || !isFree(col, row)) return false;
    zoned[k] = { col, row, zoneType: 'garden', isClamped: false };
    gardenWidthMap.set(k, w);
    return true;
  };

  // Place a hollow concentric square ring of given radius around (cx, cy).
  // radius 1 = 8 cells (perimeter of 3×3), radius 2 = 16 cells, radius 3 = 24 cells.
  // Returns number of cells actually placed.
  const placeConcentricRing = (cx: number, cy: number, radius: number, w: number): number => {
    let placed = 0;
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        // Only the perimeter of the square (Chebyshev distance === radius)
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
        if (markGarden(cx + dc, cy + dr, w)) placed++;
      }
    }
    return placed;
  };

  // Place a solid filled square patch of given half-size around (cx, cy).
  // halfSize 1 = 3×3 patch, halfSize 0 = single cell
  const placeSolidPatch = (cx: number, cy: number, halfSize: number, w: number): number => {
    let placed = 0;
    for (let dc = -halfSize; dc <= halfSize; dc++) {
      for (let dr = -halfSize; dr <= halfSize; dr++) {
        if (markGarden(cx + dc, cy + dr, w)) placed++;
      }
    }
    return placed;
  };

  // Place an L-shaped garden (one corner of a ring) — adds organic variety
  const placeLShape = (cx: number, cy: number, arm: number, w: number): number => {
    let placed = 0;
    // Horizontal arm
    for (let dc = 0; dc <= arm; dc++) if (markGarden(cx + dc, cy, w)) placed++;
    // Vertical arm (shares corner at cx,cy)
    for (let dr = 1; dr <= arm; dr++) if (markGarden(cx, cy + dr, w)) placed++;
    return placed;
  };

  // ── Quadrant focal point grid ───────────────────────────────────────────────
  // For each quadrant, compute a grid of focal points spaced ~6-8 cells apart.
  // Each focal point gets a concentric ring or patch, cycling through types.

  // Form type sequence: 0=concentric rings (r1+r2), 1=solid patch, 2=L-shape, 3=single ring (r1 only)
  const formSeq  = [0, 1, 0, 3, 2, 0, 1, 0, 2, 3, 0, 1, 2, 0, 3, 1];
  let   formIdx  = 0;

  const quads: Quadrant[] = ['NW', 'NE', 'SE', 'SW'];
  for (const q of quads) {
    const qCells = siteCells.filter((c) => c?.quadrant === q && isFree(c.col, c.row));
    const target = Math.max(3, Math.ceil(qCells.length * 0.30));
    let   count  = 0;

    if (qCells.length === 0) continue;

    // Compute bounding box of this quadrant's site cells
    const qColMin = Math.min(...qCells.map((c) => c.col));
    const qColMax = Math.max(...qCells.map((c) => c.col));
    const qRowMin = Math.min(...qCells.map((c) => c.row));
    const qRowMax = Math.max(...qCells.map((c) => c.row));

    // Generate focal points on a ~7-cell grid within the quadrant bbox
    const focalSpacing = 7;
    const focalPoints: { col: number; row: number }[] = [];
    for (let fc = qColMin + 3; fc <= qColMax - 3; fc += focalSpacing) {
      for (let fr = qRowMin + 3; fr <= qRowMax - 3; fr += focalSpacing) {
        // Only include if this position is actually inside the site
        const inSiteCell = cells.find((x) => x?.col === fc && x?.row === fr && x?.inSite);
        if (inSiteCell) focalPoints.push({ col: fc, row: fr });
      }
    }

    // If no focal points derived, fall back to quadrant centroid
    if (focalPoints.length === 0) {
      const cCol = Math.round((qColMin + qColMax) / 2);
      const cRow = Math.round((qRowMin + qRowMax) / 2);
      focalPoints.push({ col: cCol, row: cRow });
    }

    // Place garden forms at each focal point until target reached
    for (const fp of focalPoints) {
      if (count >= target) break;
      const form = formSeq[formIdx % formSeq.length];
      formIdx++;

      if (form === 0) {
        // Concentric double ring: inner (r=1, w=2) + outer (r=2, w=1)
        count += placeConcentricRing(fp.col, fp.row, 1, 2); // inner ring — width 2
        if (count < target) {
          count += placeConcentricRing(fp.col, fp.row, 2, 1); // outer ring — width 1
        }
      } else if (form === 1) {
        // Solid 3×3 patch (halfSize=1), width=2
        count += placeSolidPatch(fp.col, fp.row, 1, 2);
      } else if (form === 2) {
        // L-shape with arm length 3, width=1
        count += placeLShape(fp.col, fp.row, 3, 1);
      } else {
        // Single ring (r=1), width=3 — compact square frame
        count += placeConcentricRing(fp.col, fp.row, 1, 3);
      }
    }

    // ── Priority 2: axis-adjacent gardens to connect green to the spine ──────
    if (count < target) {
      const axisGardens = qCells
        .filter((c) => {
          if (!isFree(c.col, c.row)) return false;
          return (
            onPrimaryAxis(c.col, c.row) ||
            [[-1,0],[1,0],[0,-1],[0,1]].some(
              ([dc, dr]) => onPrimaryAxis(c.col + dc, c.row + dr)
            )
          );
        })
        .sort((a, b) =>
          (Math.abs(a.col - midCol) + Math.abs(a.row - midRow)) -
          (Math.abs(b.col - midCol) + Math.abs(b.row - midRow))
        );
      for (const c of axisGardens) {
        if (count >= target) break;
        if (markGarden(c.col, c.row, 1)) count++;
      }
    }

    // ── Priority 3: fill remaining quota with concentric singles ─────────────
    if (count < target) {
      for (const c of qCells) {
        if (count >= target) break;
        if (markGarden(c.col, c.row, 1)) count++;
      }
    }
  }

  // ── Compute adjacentGardenWidth for each site cell ─────────────────────
  // For a building cell, find the width of the nearest adjacent garden strip.
  // This caps the building's storeys: width 1 → max 2s, width 2 → max 4s, width 3 → max 5s
  const getAdjacentGardenWidth = (col: number, row: number): number => {
    for (const [dc, dr] of [[-1,0],[1,0],[0,-1],[0,1],[0,0]]) {
      const w = gardenWidthMap.get(key(col + dc, row + dr));
      if (w !== undefined) return w;
    }
    return 0; // no adjacent garden
  };

  // ── Phase 3: Vertical circulation cores ───────────────────────────────────
  // Two columns at 25% / 75% of grid width, one core every 3 rows.
  const coreColumns = [
    Math.floor(safeGridCols * 0.25),
    Math.floor(safeGridCols * 0.75),
  ];
  let coreIdCounter = 1;

  for (const cCol of coreColumns) {
    let lastRow = -4;
    for (let r = 0; r < safeGridRows; r++) {
      if (r - lastRow < 3) continue;
      const cell = cells.find((c) => c?.col === cCol && c?.row === r && c?.inSite);
      if (!cell || !isFree(cCol, r)) continue;
      const coreId = `core-${coreIdCounter++}`;
      zoned[key(cCol, r)] = {
        col: cCol, row: r, zoneType: 'circulation', isClamped: false, coreId,
      };
      cores.push({ id: coreId, col: cCol, row: r, heightM: 0 });
      lastRow = r;
    }
  }

  // ── Phase 4A: Ground-floor packing ───────────────────────────────────────
  //
  // Clusters are derived using ONLY the primary-axis roadSet.
  // This gives 4 large quadrant clusters instead of dozens of tiny fragments.
  // Units can now fill the full quadrant area minus gardens and cores.
  //
  const clusters = deriveTowerClusters(cells, roadSet);

  const PREMIUM_TYPES  = ['3b4p', '3b5p', '3b6p', '2b4p'];
  const STANDARD_TYPES = ['1b1p', '1b2p', '2b3p'];
  let   premiumIdx  = 0;
  let   standardIdx = 0;
  let   idCounter   = 1;

  // Deterministic storey sequence for visual variety
  // Heights 1-5 storeys: varied sequence creates towers, mid-rise and low-rise mix
  // Cast as number[] then assign — Storeys type comes from architecture.ts (1|2) but
  // we use the numeric value directly; the PlacedUnit.storeys field receives it as-is.
  // Richer height sequence — more 3s and 4s for interesting mid-rise skyline
  const storeySeq: number[] = [1, 3, 5, 2, 4, 1, 3, 5, 2, 4, 3, 1, 4, 2, 5, 3, 1, 4, 2, 5, 3, 4, 1, 5, 2, 3, 4, 1];
  let   storeySeqIdx = 0;

  for (const cluster of clusters) {
    if (!cluster?.cells?.length) continue;

    const packCells = cluster.cells
      .filter((c) => c?.inSite && isFree(c.col, c.row))
      .sort((a, b) => {
        const rA = scoreMap.get(key(a.col, a.row))?.zone === 'premium-unit' ? 0 : 1;
        const rB = scoreMap.get(key(b.col, b.row))?.zone === 'premium-unit' ? 0 : 1;
        return rA !== rB ? rA - rB : a.row - b.row;
      });

    let passAttempts = 0;

    for (const cell of packCells) {
      if (passAttempts >= MAX_PACK_ATTEMPTS) {
        console.warn(`[architectureUtils] Packing cap reached at cluster ${cluster.id}`);
        break;
      }
      passAttempts++;

      if (!cell || !isFree(cell.col, cell.row)) continue;

      // Spacing — target 33% of total site area as buildings.
      // After roads (~5%) and gardens (~30%), ~65% of site cells remain for buildings + gaps.
      // Need to skip ~49% of those remaining cells to land at 33% built overall.
      // Every 3rd column = gap lane (33% skip) + hash scatter ~18% of remainder
      const gapCol  = cell.col % 3 === 0;
      const gapRow  = cell.row % 4 === 0;                           // adds ~25% of non-gapCol cells
      const gapHash = (cell.col * 11 + cell.row * 7) % 11 < 2;     // ~18% irregular scatter
      if (gapCol || gapRow || gapHash) continue;

      const score     = scoreMap.get(key(cell.col, cell.row));
      const isPremium = score?.zone === 'premium-unit';
      const pool      = isPremium ? PREMIUM_TYPES : STANDARD_TYPES;
      const typeId    = pool[(isPremium ? premiumIdx : standardIdx) % pool.length];

      const unitType = NDSS_UNIT_TYPES.find((u) => u.id === typeId);
      if (!unitType) { isPremium ? premiumIdx++ : standardIdx++; continue; }

      // Garden-width-driven height cap:
      //   Adjacent 1-cell garden → max 2 storeys (low-rise edge condition)
      //   Adjacent 2-cell garden → max 4 storeys (mid-rise)
      //   Adjacent 3-cell garden → max 5 storeys (tall, broad light)
      //   No adjacent garden     → max 5 storeys (interior blocks, full freedom)
      const adjGW = getAdjacentGardenWidth(cell.col, cell.row);
      const maxStoreysByGarden =
        adjGW === 1 ? 2 :
        adjGW === 2 ? 4 :
        adjGW === 3 ? 5 : 5;

      // Base desired height from sequence, clamped by garden rule
      let desiredStoreys: number = Math.min(
        storeySeq[storeySeqIdx % storeySeq.length],
        maxStoreysByGarden
      );
      storeySeqIdx++;

      // Clamp to context height limit
      if (contextHeightLimitM !== null && 1 * STOREY_HEIGHT_M > contextHeightLimitM) {
        isPremium ? premiumIdx++ : standardIdx++;
        continue;
      }
      if (contextHeightLimitM !== null && desiredStoreys * STOREY_HEIGHT_M > contextHeightLimitM) {
        desiredStoreys = 1;
      }

      const spec = unitType.storeySpecs.find((s) => s.storeys === desiredStoreys)
        ?? unitType.storeySpecs[0];
      if (!spec) { isPremium ? premiumIdx++ : standardIdx++; continue; }

      const wCells = Math.max(1, Math.ceil(Math.sqrt(unitType.gridCells)));
      const hCells = Math.max(1, Math.ceil(unitType.gridCells / wCells));

      // Try progressively smaller footprints until one fits
      let fw = wCells, fh = hCells;
      if (!canPlaceUnit(cell.col, cell.row, fw, fh, cells, zoned)) {
        if (canPlaceUnit(cell.col, cell.row, 1, unitType.gridCells, cells, zoned)) {
          fw = 1; fh = unitType.gridCells;
        } else if (canPlaceUnit(cell.col, cell.row, unitType.gridCells, 1, cells, zoned)) {
          fw = unitType.gridCells; fh = 1;
        } else if (canPlaceUnit(cell.col, cell.row, 1, 1, cells, zoned)) {
          fw = 1; fh = 1;
        } else {
          isPremium ? premiumIdx++ : standardIdx++;
          continue;
        }
      }

      const unitId    = `u${idCounter++}`;
      const isClamped = desiredStoreys < (storeySeq[(storeySeqIdx - 1) % storeySeq.length]);

      for (let dc = 0; dc < fw; dc++) {
        for (let dr = 0; dr < fh; dr++) {
          zoned[key(cell.col + dc, cell.row + dr)] = {
            col: cell.col + dc, row: cell.row + dr,
            zoneType: 'unit', unitId, isClamped,
          };
        }
      }

      placed.push({
        id: unitId, unitTypeId: typeId, storeys: desiredStoreys as unknown as Storeys,
        col: cell.col, row: cell.row,
        widthCells: fw, heightCells: fh,
        quadrant: cell.quadrant, label: typeId, level: 0,
      });

      const k0 = key(cell.col, cell.row);
      if (!stackMap.has(k0)) stackMap.set(k0, []);
      stackMap.get(k0)!.push({ unitId, storeys: desiredStoreys as unknown as Storeys, isClamped });

      isPremium ? premiumIdx++ : standardIdx++;
    }
  }

  // ── Phase 4B: Vertical stacking (levels 1–3) ─────────────────────────────
  const groundAnchors = placed
    .filter((u) => u?.level === 0)
    .map((u) => ({
      col: u.col, row: u.row,
      widthCells: u.widthCells, heightCells: u.heightCells,
      quadrant: u.quadrant,
    }));

  let totalStackAttempts = 0;

  for (const anchor of groundAnchors) {
    if (totalStackAttempts >= MAX_PACK_ATTEMPTS) break;

    const sk = key(anchor.col, anchor.row);
    if (!stackMap.has(sk)) stackMap.set(sk, []);
    const stack = stackMap.get(sk)!;

    let levelLoops = 0;
    while (levelLoops < MAX_LEVELS * 2) {
      levelLoops++;
      totalStackAttempts++;

      const occupied = stack.reduce((sum, e) => sum + (e?.storeys ?? 0), 0);
      if (occupied >= MAX_LEVELS) break;

      // Vary stacking heights 1-5 deterministically by position in sequence
      const stackSeq: number[] = [2, 3, 1, 4, 2, 5, 1, 3, 2, 4, 1, 5, 3, 2, 1, 4];
      const nextStoreys: number = stackSeq[(totalStackAttempts) % stackSeq.length];

      if (!canStackLevel(anchor.col, anchor.row, nextStoreys, stack, zoned, contextHeightLimitM)) {
        if (
          nextStoreys === 2 &&
          canStackLevel(anchor.col, anchor.row, 1, stack, zoned, contextHeightLimitM)
        ) {
          const isPrem = scoreMap.get(sk)?.zone === 'premium-unit';
          const pool   = isPrem ? PREMIUM_TYPES : STANDARD_TYPES;
          const typeId = pool[(isPrem ? premiumIdx : standardIdx) % pool.length];
          const ut     = NDSS_UNIT_TYPES.find((u) => u.id === typeId);
          if (ut) {
            const unitId = `u${idCounter++}`;
            placed.push({
              id: unitId, unitTypeId: typeId, storeys: 1 as unknown as Storeys,
              col: anchor.col, row: anchor.row,
              widthCells: anchor.widthCells, heightCells: anchor.heightCells,
              quadrant: anchor.quadrant, label: typeId, level: occupied,
            });
            stack.push({ unitId, storeys: 1 as unknown as Storeys, isClamped: true });
            isPrem ? premiumIdx++ : standardIdx++;
          }
        }
        break;
      }

      const isPrem = scoreMap.get(sk)?.zone === 'premium-unit';
      const pool   = isPrem ? PREMIUM_TYPES : STANDARD_TYPES;
      const typeId = pool[(isPrem ? premiumIdx : standardIdx) % pool.length];
      const ut     = NDSS_UNIT_TYPES.find((u) => u.id === typeId);
      if (!ut) { isPrem ? premiumIdx++ : standardIdx++; break; }

      const unitId = `u${idCounter++}`;
      placed.push({
        id: unitId, unitTypeId: typeId, storeys: nextStoreys as unknown as Storeys,
        col: anchor.col, row: anchor.row,
        widthCells: anchor.widthCells, heightCells: anchor.heightCells,
        quadrant: anchor.quadrant, label: typeId, level: occupied,
      });
      stack.push({ unitId, storeys: nextStoreys as unknown as Storeys, isClamped: false });
      isPrem ? premiumIdx++ : standardIdx++;
    }

    stackMap.set(sk, stack);
  }

  // ── Phase 5: Core heights ─────────────────────────────────────────────────
  for (const core of cores) {
    const adjH: number[] = [];
    for (const [dc, dr] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const h = computeStackHeightM(core.col + dc, core.row + dr, stackMap);
      if (h > 0) adjH.push(h);
    }
    const maxAdj   = adjH.length > 0 ? Math.max(...adjH) : STOREY_HEIGHT_M;
    const rawCoreH = maxAdj + CORE_OVERRUN_M;
    core.heightM   = contextHeightLimitM !== null
      ? Math.min(rawCoreH, contextHeightLimitM)
      : rawCoreH;
  }

  return {
    placedUnits: placed,
    placedCores: cores,
    zonedCells:  zoned,
    stackMap,
    gridCols:    safeGridCols,
    gridRows:    safeGridRows,
    cellSizeM:   GRID_CELL_SIZE_M,
    siteBboxM:   siteBbox,
  };
}
