// ─── NDSS Unit type definitions ───────────────────────────────────────────────

export type Storeys = 1 | 2;

export interface NdssStoreySpec {
  storeys:    Storeys;
  minAreaSqm: number;
  maxAreaSqm: number;
}

export interface NdssUnitType {
  id:          string;
  label:       string;
  bedrooms:    number;
  persons:     number;
  storeySpecs: NdssStoreySpec[];
  storageSqm:  number;
  colour:      string;   // 2D canvas fill colour
  gridCells:   number;   // Approximate 4 m grid cells required
}

export const NDSS_UNIT_TYPES: NdssUnitType[] = [
  {
    id: '1b1p', label: '1 Bed · 1 Person', bedrooms: 1, persons: 1,
    storeySpecs: [{ storeys: 1, minAreaSqm: 39, maxAreaSqm: 40 }],
    storageSqm: 1.0, colour: '#bfdbfe', gridCells: 3,
  },
  {
    id: '1b2p', label: '1 Bed · 2 Person', bedrooms: 1, persons: 2,
    storeySpecs: [
      { storeys: 1, minAreaSqm: 50, maxAreaSqm: 56 },
      { storeys: 2, minAreaSqm: 58, maxAreaSqm: 60 },
    ],
    storageSqm: 1.5, colour: '#93c5fd', gridCells: 4,
  },
  {
    id: '2b3p', label: '2 Bed · 3 Person', bedrooms: 2, persons: 3,
    storeySpecs: [
      { storeys: 1, minAreaSqm: 61, maxAreaSqm: 64 },
      { storeys: 2, minAreaSqm: 70, maxAreaSqm: 72 },
    ],
    storageSqm: 2.0, colour: '#6ee7b7', gridCells: 4,
  },
  {
    id: '2b4p', label: '2 Bed · 4 Person', bedrooms: 2, persons: 4,
    storeySpecs: [
      { storeys: 1, minAreaSqm: 70, maxAreaSqm: 72 },
      { storeys: 2, minAreaSqm: 79, maxAreaSqm: 80 },
    ],
    storageSqm: 2.0, colour: '#fcd34d', gridCells: 5,
  },
  {
    id: '3b4p', label: '3 Bed · 4 Person', bedrooms: 3, persons: 4,
    storeySpecs: [
      { storeys: 1, minAreaSqm: 74, maxAreaSqm: 80 },
      { storeys: 2, minAreaSqm: 84, maxAreaSqm: 84 },
    ],
    storageSqm: 2.5, colour: '#fdba74', gridCells: 5,
  },
  {
    id: '3b5p', label: '3 Bed · 5 Person', bedrooms: 3, persons: 5,
    storeySpecs: [
      { storeys: 1, minAreaSqm: 86, maxAreaSqm: 88 },
      { storeys: 2, minAreaSqm: 93, maxAreaSqm: 96 },
    ],
    storageSqm: 2.5, colour: '#f9a8d4', gridCells: 6,
  },
  {
    id: '3b6p', label: '3 Bed · 6 Person', bedrooms: 3, persons: 6,
    storeySpecs: [
      { storeys: 1, minAreaSqm: 95, maxAreaSqm: 96 },
      { storeys: 2, minAreaSqm: 102, maxAreaSqm: 104 },
    ],
    storageSqm: 2.5, colour: '#c4b5fd', gridCells: 7,
  },
];

// ─── Grid ─────────────────────────────────────────────────────────────────────

export const GRID_CELL_SIZE_M = 4; // 4 m × 4 m cells

// Minimum circulation core footprint: 4 m × 4 m = 1 grid cell
// One core serves up to MAX_UNITS_PER_CORE residential units
export const CIRCULATION_CORE_SIZE_CELLS = 1; // 1 cell = 4 m × 4 m = 16 m²
export const MAX_UNITS_PER_CORE          = 8;

export interface GridCell {
  col:      number;
  row:      number;
  x:        number;
  y:        number;
  inSite:   boolean;
  quadrant: Quadrant;
}

// ─── Zone types ───────────────────────────────────────────────────────────────

export type ZoneType =
  | 'unit'
  | 'garden'
  | 'circulation'
  | 'public'
  | 'communal-private'
  | 'communal-shared'
  | 'empty';

// ─── Architectural colour palette (2D workspace) ─────────────────────────────

/**
 * Single source of truth for all 2D canvas colours.
 * Used by both the canvas renderer and the zone legend.
 */
export const ZONE_PALETTE: Record<ZoneType, { fill: string; stroke: string; dash?: number[] }> = {
  unit:               { fill: '#1e3a5f',  stroke: '#3b82f6',  dash: undefined    },
  garden:             { fill: '#14532d',  stroke: '#22c55e',  dash: undefined    },
  circulation:        { fill: '#7c2d12',  stroke: '#f97316',  dash: undefined    },
  public:             { fill: '#713f12',  stroke: '#f59e0b',  dash: [4, 3]       },
  'communal-private': { fill: '#3b0764',  stroke: '#a855f7',  dash: [6, 3]       },
  'communal-shared':  { fill: '#164e63',  stroke: '#06b6d4',  dash: [8, 4]       },
  empty:              { fill: 'transparent', stroke: 'transparent', dash: undefined },
};

export const AXIS_PALETTE = {
  primary:   { stroke: '#fbbf24', dash: [8, 5], width: 1.5 },
  secondary: { stroke: '#f59e0b', dash: [4, 4], width: 1.0 },
};

export const SETBACK_PALETTE = {
  stroke: '#c8522a', fill: 'rgba(200,82,42,0.04)', dash: [6, 4], width: 1.5,
};

// ─── Placed entities ──────────────────────────────────────────────────────────

export interface PlacedUnit {
  id:          string;
  unitTypeId:  string;
  storeys:     Storeys;
  col:         number;
  row:         number;
  widthCells:  number;
  heightCells: number;
  quadrant:    Quadrant;
  label:       string;
  level?:      number;   // 0 = ground floor; > 0 = stacked level
}

export interface PlacedCore {
  id:      string;
  col:     number;
  row:     number;
  heightM?: number;
}

// ─── Quadrant ─────────────────────────────────────────────────────────────────

export type Quadrant = 'NW' | 'NE' | 'SE' | 'SW';

export interface QuadrantStats {
  quadrant:        Quadrant;
  totalCells:      number;
  gardenCells:     number;
  gardenPct:       number;
  gardenSatisfied: boolean;
  placedUnits:     number;
  coreCount:       number;
}

// ─── Zoned cell ───────────────────────────────────────────────────────────────

export interface ZonedCell {
  col:        number;
  row:        number;
  zoneType:   ZoneType;
  unitId?:    string;
  coreId?:    string;
  isClamped?: boolean;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationResult {
  rule:    string;
  passed:  boolean;
  message: string;
}

// ─── Workspace state ──────────────────────────────────────────────────────────

export interface WorkspaceState {
  placedUnits:        PlacedUnit[];
  placedCores:        PlacedCore[];
  zonedCells:         Record<string, ZonedCell>;
  selectedTool:       'unit' | 'garden' | 'circulation' | 'erase' | 'select';
  selectedUnitTypeId: string | null;
  selectedStoreys:    Storeys;
  activeQuadrant:     Quadrant | null;
  showGrid:           boolean;
  showQuadrants:      boolean;
  showAxes:           boolean;
  showSetback:        boolean;
  showValidation:     boolean;
}

// ─── Generated plan (shared Step 4 → Step 5) ──────────────────────────────────

export interface GeneratedPlan {
  placedUnits:  PlacedUnit[];
  placedCores:  PlacedCore[];
  zonedCells:   Record<string, ZonedCell>;
  stackMap?:    Map<string, { unitId: string; storeys: Storeys; isClamped: boolean }[]>;
  gridCols:     number;
  gridRows:     number;
  cellSizeM:    number;
  siteBboxM:    { widthM: number; heightM: number };
}