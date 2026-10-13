import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { SiteFeature } from '../../types';
import type { SiteContextData, OsmBuildingProperties } from '../../utils/geoUtils';
import {
  NDSS_UNIT_TYPES,
  GRID_CELL_SIZE_M,
  ZONE_PALETTE,
  AXIS_PALETTE,
  SETBACK_PALETTE,
  type GridCell,
  type PlacedUnit,
  type PlacedCore,
  type ZonedCell,
  type ZoneType,
  type Quadrant,
  type WorkspaceState,
  type Storeys,
} from '../../types/architecture';
import {
  applySetback,
  generateGrid,
  computeQuadrantStats,
  validateSpatialRules,
  computeAreaSummary,
  canPlaceUnit,
  getSiteBbox,
  generateProceduralPlan,
  scoreGridCells,
  computeRoadNetwork,
  computeStackHeightM,
  MAX_LEVELS,
  STOREY_HEIGHT_M,
  type CellScore,
  type RoadCell,
  type StackMap,
} from '../../utils/architectureUtils';
import { calculateSetbackScenarios } from '../../utils/geoUtils';

// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_PADDING_PX = 48;
const INITIAL_SCALE     = 8;
const MIN_SCALE         = 3;
const MAX_SCALE         = 32;

const ROAD_COLOURS: Record<string, string> = {
  primary:   '#fbbf24',
  secondary: '#94a3b8',
  tertiary:  '#334155',
};

const QUADRANT_TINTS: Record<Quadrant, string> = {
  NW: 'rgba(239,68,68,0.04)',
  NE: 'rgba(59,130,246,0.04)',
  SE: 'rgba(34,197,94,0.04)',
  SW: 'rgba(234,179,8,0.04)',
};

const ZONE_DISPLAY_LABELS: Record<ZoneType, string> = {
  unit:               'Residential Unit',
  garden:             'Internal Garden',
  circulation:        'Vertical Circulation',
  public:             'Primary Road (8 m)',
  'communal-private': 'Private Communal',
  'communal-shared':  'Secondary Road / Corridor',
  empty:              'Empty',
};

const SCORE_OVERLAY_COLOURS = {
  premiumUnit:  'rgba(34,197,94,0.35)',
  standardUnit: 'rgba(59,130,246,0.25)',
  garden:       'rgba(234,179,8,0.30)',
  buffer:       'rgba(239,68,68,0.28)',
};

// ─── Derive context height limit from OSM buildings ───────────────────────────

function deriveContextHeightLimit(
  contextData: SiteContextData | null
): number | null {
  if (!contextData?.buildings?.features?.length) return null;
  const heights: number[] = [];
  for (const f of contextData.buildings.features) {
    const p = f?.properties as OsmBuildingProperties | undefined;
    if (!p) continue;
    if (p.height  && p.height  > 0) heights.push(p.height);
    else if (p.levels && p.levels > 0) heights.push(p.levels * 3.2);
  }
  if (!heights.length) return null;
  return heights.reduce((a, b) => a + b, 0) / heights.length;
}

// ─── Extended workspace state ─────────────────────────────────────────────────

interface ExtendedWorkspaceState extends WorkspaceState {
  showScoreOverlay:  boolean;
  showRoadHierarchy: boolean;
  showStackHeights:  boolean;
  stackMap:          StackMap;
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

type Action =
  | { type: 'SET_TOOL';              tool: WorkspaceState['selectedTool'] }
  | { type: 'SET_UNIT_TYPE';         id: string }
  | { type: 'SET_STOREYS';           storeys: Storeys }
  | { type: 'PLACE_UNIT';            unit: PlacedUnit; cells: ZonedCell[] }
  | { type: 'PLACE_CORE';            core: PlacedCore; cell: ZonedCell }
  | { type: 'PAINT_ZONE';            cell: ZonedCell }
  | { type: 'ERASE_CELL';            col: number; row: number }
  | { type: 'TOGGLE_GRID' }
  | { type: 'TOGGLE_QUADRANTS' }
  | { type: 'TOGGLE_AXES' }
  | { type: 'TOGGLE_SETBACK' }
  | { type: 'TOGGLE_VALIDATION' }
  | { type: 'TOGGLE_SCORE_OVERLAY' }
  | { type: 'TOGGLE_ROAD_HIERARCHY' }
  | { type: 'TOGGLE_STACK_HEIGHTS' }
  | { type: 'CLEAR_ALL' }
  | { type: 'SET_ACTIVE_QUADRANT';   q: Quadrant | null }
  | {
      type:        'LOAD_GENERATED';
      placedUnits: PlacedUnit[];
      placedCores: PlacedCore[];
      zonedCells:  Record<string, ZonedCell>;
      stackMap:    StackMap;
    };

const initialState: ExtendedWorkspaceState = {
  placedUnits:        [],
  placedCores:        [],
  zonedCells:         {},
  stackMap:           new Map(),
  selectedTool:       'unit',
  selectedUnitTypeId: '1b2p',
  selectedStoreys:    1,
  activeQuadrant:     null,
  showGrid:           true,
  showQuadrants:      true,
  showAxes:           true,
  showSetback:        false,
  showValidation:     false,
  showScoreOverlay:   false,
  showRoadHierarchy:  true,
  showStackHeights:   true,
};

function reducer(
  state: ExtendedWorkspaceState,
  action: Action
): ExtendedWorkspaceState {
  switch (action.type) {
    case 'SET_TOOL':             return { ...state, selectedTool: action.tool };
    case 'SET_UNIT_TYPE':        return { ...state, selectedUnitTypeId: action.id };
    case 'SET_STOREYS':          return { ...state, selectedStoreys: action.storeys };
    case 'TOGGLE_GRID':          return { ...state, showGrid:          !state.showGrid          };
    case 'TOGGLE_QUADRANTS':     return { ...state, showQuadrants:     !state.showQuadrants     };
    case 'TOGGLE_AXES':          return { ...state, showAxes:          !state.showAxes          };
    case 'TOGGLE_SETBACK':       return { ...state, showSetback:       !state.showSetback       };
    case 'TOGGLE_VALIDATION':    return { ...state, showValidation:    !state.showValidation    };
    case 'TOGGLE_SCORE_OVERLAY': return { ...state, showScoreOverlay:  !state.showScoreOverlay  };
    case 'TOGGLE_ROAD_HIERARCHY':return { ...state, showRoadHierarchy: !state.showRoadHierarchy };
    case 'TOGGLE_STACK_HEIGHTS': return { ...state, showStackHeights:  !state.showStackHeights  };
    case 'CLEAR_ALL':
      return {
        ...state,
        placedUnits: [], placedCores: [],
        zonedCells: {}, stackMap: new Map(),
      };
    case 'SET_ACTIVE_QUADRANT':
      return { ...state, activeQuadrant: action.q };
    case 'LOAD_GENERATED':
      return {
        ...state,
        placedUnits: action.placedUnits,
        placedCores: action.placedCores,
        zonedCells:  action.zonedCells,
        stackMap:    action.stackMap,
      };
    case 'PLACE_UNIT': {
      const newZoned = { ...state.zonedCells };
      action.cells.forEach((c) => { newZoned[`${c.col},${c.row}`] = c; });
      return { ...state, placedUnits: [...state.placedUnits, action.unit], zonedCells: newZoned };
    }
    case 'PLACE_CORE': {
      const k = `${action.cell.col},${action.cell.row}`;
      return {
        ...state,
        placedCores: [...state.placedCores, action.core],
        zonedCells:  { ...state.zonedCells, [k]: action.cell },
      };
    }
    case 'PAINT_ZONE': {
      const k = `${action.cell.col},${action.cell.row}`;
      if (state.zonedCells[k]?.zoneType === action.cell.zoneType) {
        const next = { ...state.zonedCells };
        delete next[k];
        return { ...state, zonedCells: next };
      }
      return { ...state, zonedCells: { ...state.zonedCells, [k]: action.cell } };
    }
    case 'ERASE_CELL': {
      const k      = `${action.col},${action.row}`;
      const unitId = state.zonedCells[k]?.unitId;
      const coreId = state.zonedCells[k]?.coreId;
      const next   = { ...state.zonedCells };
      delete next[k];
      let newUnits = state.placedUnits;
      let newCores = state.placedCores;
      if (unitId) {
        const unit = state.placedUnits.find((u) => u.id === unitId);
        if (unit) {
          for (let dc = 0; dc < unit.widthCells; dc++)
            for (let dr = 0; dr < unit.heightCells; dr++)
              delete next[`${unit.col + dc},${unit.row + dr}`];
        }
        newUnits = state.placedUnits.filter((u) => u.id !== unitId);
      }
      if (coreId) newCores = state.placedCores.filter((c) => c.id !== coreId);
      return { ...state, zonedCells: next, placedUnits: newUnits, placedCores: newCores };
    }
    default: return state;
  }
}

interface ViewToggle { label: string; on: boolean; action: Action; }

// ─── Main component ────────────────────────────────────────────────────────────

interface Props {
  site:        SiteFeature;
  contextData: SiteContextData | null;
}

export const PlanningWorkspace: React.FC<Props> = ({ site, contextData }) => {
  const navigate = useNavigate();

  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [ws, dispatch]         = useReducer(reducer, initialState);
  const [scale, setScale]      = useState(INITIAL_SCALE);
  const [panX,  setPanX]       = useState(0);
  const [panY,  setPanY]       = useState(0);
  const [isPanning, setIsPanning]   = useState(false);
  const [lastPan,   setLastPan]     = useState({ x: 0, y: 0 });
  const [hover, setHover]      = useState<{ col: number; row: number } | null>(null);
  const [isPainting, setIsPainting] = useState(false);

  // Generation state — includes error handling
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // ── Derived geometry ──────────────────────────────────────────────────────
  const developable  = useMemo(() => applySetback(site, 5), [site]);
  const bbox         = useMemo(() => getSiteBbox(developable), [developable]);
  const setbackScens = useMemo(() => calculateSetbackScenarios(site), [site]);

  const contextHeightLimitM = useMemo(
    () => deriveContextHeightLimit(contextData),
    [contextData]
  );

  const canvasW = Math.ceil(bbox.widthM  * scale) + CANVAS_PADDING_PX * 2;
  const canvasH = Math.ceil(bbox.heightM * scale) + CANVAS_PADDING_PX * 2;

  const gridCells: GridCell[] = useMemo(
    () => generateGrid(developable, scale, CANVAS_PADDING_PX, CANVAS_PADDING_PX),
    [developable, scale]
  );

  const gridCols = useMemo(
    () => gridCells.length > 0 ? Math.max(...gridCells.map((c) => c.col)) + 1 : 1,
    [gridCells]
  );
  const gridRows = useMemo(
    () => gridCells.length > 0 ? Math.max(...gridCells.map((c) => c.row)) + 1 : 1,
    [gridCells]
  );

  const cellPx = GRID_CELL_SIZE_M * scale;
  const midCol = Math.floor(gridCols / 2);
  const midRow = Math.floor(gridRows / 2);
  const axisX  = CANVAS_PADDING_PX + midCol * cellPx + cellPx / 2;
  const axisY  = CANVAS_PADDING_PX + midRow * cellPx + cellPx / 2;

  const roadCells: RoadCell[] = useMemo(
    () => computeRoadNetwork(gridCells, gridCols, gridRows),
    [gridCells, gridCols, gridRows]
  );

  const cellScores = useMemo<Map<string, CellScore>>(() => {
    const map = new Map<string, CellScore>();
    if (!contextData?.roads) return map;
    try {
      const siteCells = gridCells.filter((c) => c?.inSite);
      const scores    = scoreGridCells(siteCells, developable, contextData.roads);
      for (const s of scores) {
        if (s) map.set(`${s.col},${s.row}`, s);
      }
    } catch {
      /* swallow scoring errors — fallback handled in generation */
    }
    return map;
  }, [gridCells, developable, contextData?.roads]);

  const quadStats = useMemo(
    () => computeQuadrantStats(gridCells, ws.zonedCells, ws.placedCores),
    [gridCells, ws.zonedCells, ws.placedCores]
  );
  const validationResults = useMemo(
    () =>
      ws.showValidation
        ? validateSpatialRules(
            gridCells, ws.zonedCells, gridCols, gridRows, ws.placedCores
          )
        : [],
    [ws.showValidation, gridCells, ws.zonedCells, gridCols, gridRows, ws.placedCores]
  );
  const areaSummary = useMemo(
    () => computeAreaSummary(developable, gridCells, ws.zonedCells),
    [developable, gridCells, ws.zonedCells]
  );

  const groundFloorUnits = ws.placedUnits.filter((u) => u?.level === 0).length;
  const stackedUnits     = ws.placedUnits.length - groundFloorUnits;

  const maxStackHeightM = useMemo(() => {
    let max = 0;
    ws.stackMap?.forEach?.((stack) => {
      const h = (stack ?? []).reduce(
        (sum, e) => sum + (e?.storeys ?? 0) * STOREY_HEIGHT_M, 0
      );
      if (h > max) max = h;
    });
    return max;
  }, [ws.stackMap]);

  const viewToggles: ViewToggle[] = [
    { label: 'Show grid',         on: ws.showGrid,          action: { type: 'TOGGLE_GRID'           } },
    { label: 'Show quadrants',    on: ws.showQuadrants,     action: { type: 'TOGGLE_QUADRANTS'      } },
    { label: 'Show axes',         on: ws.showAxes,          action: { type: 'TOGGLE_AXES'           } },
    { label: 'Road hierarchy',    on: ws.showRoadHierarchy, action: { type: 'TOGGLE_ROAD_HIERARCHY' } },
    { label: 'Stack heights',     on: ws.showStackHeights,  action: { type: 'TOGGLE_STACK_HEIGHTS'  } },
    { label: 'Show setback',      on: ws.showSetback,       action: { type: 'TOGGLE_SETBACK'        } },
    { label: 'Score overlay',     on: ws.showScoreOverlay,  action: { type: 'TOGGLE_SCORE_OVERLAY'  } },
    { label: 'Validate rules',    on: ws.showValidation,    action: { type: 'TOGGLE_VALIDATION'     } },
  ];

  // ── AUTO-GENERATE — wrapped in try/catch ──────────────────────────────────
  const handleAutoGenerate = useCallback(() => {
    setIsGenerating(true);
    setGenerationError(null);

    // Defer to next tick so the button re-renders to "Generating…" before work starts
    setTimeout(() => {
      try {
        const plan = generateProceduralPlan(
          gridCells, gridCols, gridRows,
          { widthM: bbox.widthM, heightM: bbox.heightM },
          developable, contextData,
          contextHeightLimitM
        );

        // Validate the returned plan before dispatching
        if (
          !Array.isArray(plan?.placedUnits) ||
          !Array.isArray(plan?.placedCores) ||
          typeof plan?.zonedCells !== 'object'
        ) {
          throw new Error('Generator returned malformed plan data.');
        }

        dispatch({
          type:        'LOAD_GENERATED',
          placedUnits: plan.placedUnits,
          placedCores: plan.placedCores,
          zonedCells:  plan.zonedCells,
          stackMap:    plan.stackMap ?? new Map(),
        });
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : 'Unknown error during generation.';
        console.error('[PlanningWorkspace] Generation failed:', err);
        setGenerationError(`Generation failed: ${message}`);
      } finally {
        setIsGenerating(false);
      }
    }, 50);
  }, [
    gridCells, gridCols, gridRows, bbox,
    developable, contextData, contextHeightLimitM,
  ]);

  // ── Proceed to Step 5 — Detail Plan Overlay ──────────────────────────────
  const handleProceedToMassing = useCallback(() => {
    navigate(`/svg/${site.properties.id}`, {
      state: {
        site,
        plan: {
          placedUnits:  ws.placedUnits,
          placedCores:  ws.placedCores,
          zonedCells:   ws.zonedCells,
          stackMap:     ws.stackMap,
          gridCols, gridRows,
          cellSizeM:    GRID_CELL_SIZE_M,
          siteBboxM:    { widthM: bbox.widthM, heightM: bbox.heightM },
        },
        contextData,
      },
    });
  }, [ws, gridCols, gridRows, bbox, site, contextData, navigate]);

  // ── Zoom toward cursor on scroll wheel ───────────────────────────────────
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.shiftKey) {
        // Shift+scroll = horizontal pan
        setPanX((x) => x - e.deltaY * 0.8);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd+scroll = vertical pan
        setPanY((y) => y - e.deltaY * 0.8);
        return;
      }
      // Plain scroll = zoom toward cursor position
      const rect   = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 1 / 1.12 : 1.12;
      setScale((prevScale) => {
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prevScale * factor));
        // Adjust pan so the point under the cursor stays fixed
        const ratio = newScale / prevScale;
        setPanX((px) => mouseX - ratio * (mouseX - px));
        setPanY((py) => mouseY - ratio * (mouseY - py));
        return newScale;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Cell hit-test ─────────────────────────────────────────────────────────
  const getCellFromCanvasEvent = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): GridCell | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const col  = Math.floor((e.clientX - rect.left  - CANVAS_PADDING_PX) / cellPx);
      const row  = Math.floor((e.clientY - rect.top   - CANVAS_PADDING_PX) / cellPx);
      return gridCells.find((c) => c.col === col && c.row === row) ?? null;
    },
    [gridCells, cellPx]
  );

  // ── Tool action ───────────────────────────────────────────────────────────
  const handleCellAction = useCallback(
    (cell: GridCell) => {
      if (!cell?.inSite) return;

      if (ws.selectedTool === 'erase') {
        dispatch({ type: 'ERASE_CELL', col: cell.col, row: cell.row });
        return;
      }
      if (ws.selectedTool === 'circulation') {
        const k = `${cell.col},${cell.row}`;
        if (ws.zonedCells[k]) return;
        const coreId = `core-manual-${Date.now()}`;
        dispatch({
          type: 'PLACE_CORE',
          core: { id: coreId, col: cell.col, row: cell.row, heightM: 0 },
          cell: { col: cell.col, row: cell.row, zoneType: 'circulation', isClamped: false, coreId },
        });
        return;
      }
      if (ws.selectedTool === 'unit') {
        const unitType = NDSS_UNIT_TYPES.find((u) => u.id === ws.selectedUnitTypeId);
        if (!unitType) return;
        const spec = unitType.storeySpecs.find((s) => s.storeys === ws.selectedStoreys);
        if (!spec) return;
        const wCells = Math.max(1, Math.ceil(Math.sqrt(unitType.gridCells)));
        const hCells = Math.max(1, Math.ceil(unitType.gridCells / wCells));
        if (!canPlaceUnit(cell.col, cell.row, wCells, hCells, gridCells, ws.zonedCells)) return;
        const unitId  = `unit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const cells: ZonedCell[] = [];
        for (let dc = 0; dc < wCells; dc++)
          for (let dr = 0; dr < hCells; dr++)
            cells.push({
              col: cell.col + dc, row: cell.row + dr,
              zoneType: 'unit', unitId, isClamped: false,
            });
        dispatch({
          type: 'PLACE_UNIT',
          unit: {
            id: unitId, unitTypeId: unitType.id, storeys: ws.selectedStoreys,
            col: cell.col, row: cell.row, widthCells: wCells, heightCells: hCells,
            quadrant: cell.quadrant, label: unitType.id, level: 0,
          },
          cells,
        });
        return;
      }
      const zoneMap: Partial<Record<WorkspaceState['selectedTool'], ZoneType>> = {
        garden: 'garden',
      };
      const zoneType = zoneMap[ws.selectedTool];
      if (zoneType)
        dispatch({
          type: 'PAINT_ZONE',
          cell: { col: cell.col, row: cell.row, zoneType, isClamped: false },
        });
    },
    [ws, gridCells]
  );

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button === 1 || e.altKey) {
        e.preventDefault();
        setIsPanning(true);
        setLastPan({ x: e.clientX, y: e.clientY });
        return;
      }
      setIsPainting(true);
      const cell = getCellFromCanvasEvent(e);
      if (cell) handleCellAction(cell);
    },
    [getCellFromCanvasEvent, handleCellAction]
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (isPanning) {
        setPanX((x) => x + e.clientX - lastPan.x);
        setPanY((y) => y + e.clientY - lastPan.y);
        setLastPan({ x: e.clientX, y: e.clientY });
        return;
      }
      const cell = getCellFromCanvasEvent(e);
      setHover(cell ? { col: cell.col, row: cell.row } : null);
      if (isPainting && cell) handleCellAction(cell);
    },
    [isPanning, lastPan, isPainting, getCellFromCanvasEvent, handleCellAction]
  );

  const handleCanvasMouseUp = useCallback(() => {
    setIsPanning(false);
    setIsPainting(false);
  }, []);

  // ── Canvas draw ───────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cp = cellPx;

    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = '#0a0f1a';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Setback reference
    if (ws.showSetback) {
      const s5 = setbackScens.find((s) => s.setbackM === 5);
      if (s5) {
        ctx.save();
        ctx.strokeStyle = SETBACK_PALETTE.stroke;
        ctx.lineWidth   = SETBACK_PALETTE.width;
        ctx.setLineDash(SETBACK_PALETTE.dash);
        ctx.fillStyle   = SETBACK_PALETTE.fill;
        ctx.beginPath();
        for (const c of gridCells.filter((c) => c?.inSite))
          ctx.rect(c.x, c.y, cp, cp);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // Per-cell rendering
    for (const cell of gridCells) {
      if (!cell?.inSite) continue;
      const { x, y } = cell;
      const zoned     = ws.zonedCells[`${cell.col},${cell.row}`];
      const isHover   = hover?.col === cell.col && hover?.row === cell.row;
      const score     = cellScores.get(`${cell.col},${cell.row}`);

      if (ws.showQuadrants) {
        ctx.fillStyle = QUADRANT_TINTS[cell.quadrant];
        ctx.fillRect(x, y, cp, cp);
      }

      if (ws.showScoreOverlay && score) {
        ctx.fillStyle =
          score.zone === 'premium-unit'  ? SCORE_OVERLAY_COLOURS.premiumUnit  :
          score.zone === 'standard-unit' ? SCORE_OVERLAY_COLOURS.standardUnit :
          score.zone === 'garden'        ? SCORE_OVERLAY_COLOURS.garden       :
          SCORE_OVERLAY_COLOURS.buffer;
        ctx.fillRect(x, y, cp, cp);
      }

      if (zoned && zoned.zoneType !== 'empty') {
        const pal = ZONE_PALETTE[zoned.zoneType];
        if (zoned.zoneType === 'unit') {
          const groundUnit = ws.placedUnits.find(
            (pu) => pu?.id === zoned.unitId && pu?.level === 0
          );
          const ut = NDSS_UNIT_TYPES.find((u) => u.id === groundUnit?.unitTypeId);
          ctx.fillStyle = ut ? ut.colour + '30' : pal.fill + '80';
        } else {
          ctx.fillStyle = pal.fill + 'cc';
        }
        ctx.fillRect(x + 1, y + 1, cp - 2, cp - 2);
        ctx.strokeStyle = pal.stroke;
        ctx.lineWidth   = 1;
        ctx.setLineDash(pal.dash ?? []);
        ctx.strokeRect(x + 1, y + 1, cp - 2, cp - 2);
        ctx.setLineDash([]);
      }

      // Stack height overlay — brightness tint + level badge
      if (ws.showStackHeights && zoned?.zoneType === 'unit') {
        const stackH = computeStackHeightM(cell.col, cell.row, ws.stackMap);
        const levels = Math.round(stackH / STOREY_HEIGHT_M);
        if (levels > 1) {
          ctx.fillStyle = `rgba(255,255,255,${Math.min(0.08 * (levels - 1), 0.32)})`;
          ctx.fillRect(x + 2, y + 2, cp - 4, cp - 4);
          if (cp >= 12) {
            ctx.fillStyle    = 'rgba(255,255,255,0.9)';
            ctx.font         = `bold ${Math.max(7, cp * 0.28)}px "DM Mono", monospace`;
            ctx.textAlign    = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText(`L${levels}`, x + cp - 2, y + cp - 2);
          }
        }
      }

      if (ws.showGrid) {
        ctx.strokeStyle = isHover ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.05)';
        ctx.lineWidth   = isHover ? 1.5 : 0.4;
        ctx.setLineDash([]);
        ctx.strokeRect(x, y, cp, cp);
      }

      if (isHover) {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(x, y, cp, cp);
      }
    }

    // Road hierarchy overlay
    // Primary roads: full cell fill (4 m wide)
    // Secondary + tertiary: half-unit-wide stripe centred on cell (2 m wide visual stripe)
    if (ws.showRoadHierarchy) {
      for (const rc of roadCells) {
        const cell = gridCells.find((c) => c?.col === rc.col && c?.row === rc.row);
        if (!cell) continue;
        const colour = ROAD_COLOURS[rc.hierarchy] ?? '#334155';

        if (rc.hierarchy === 'primary') {
          // Full cell — primary axis is a real zoned road
          ctx.fillStyle = colour + 'bb';
          ctx.fillRect(cell.x, cell.y, cp, cp);
          if (cp >= 6) {
            ctx.strokeStyle = colour + 'cc';
            ctx.lineWidth   = 2;
            ctx.setLineDash([]);
            ctx.strokeRect(cell.x, cell.y, cp, cp);
          }
        } else {
          // Secondary / tertiary: half-unit-wide visual stripe centred on cell
          // Draw as a 50%-wide centred stripe in both axes directions
          const stripeW = cp * 0.5;
          const offset  = (cp - stripeW) / 2;
          const alpha   = rc.hierarchy === 'secondary' ? '55' : '30';

          // Determine stripe orientation by checking if this is a column or row road
          // We check the previous/next cell in the same column to see if it's a vertical stripe
          const isColRoad = roadCells.some(
            (other) => other.col === rc.col && other.row !== rc.row && other.hierarchy === rc.hierarchy
          );
          ctx.fillStyle = colour + alpha;
          if (isColRoad) {
            // Vertical stripe — narrow in X, full height
            ctx.fillRect(cell.x + offset, cell.y, stripeW, cp);
          } else {
            // Horizontal stripe — full width, narrow in Y
            ctx.fillRect(cell.x, cell.y + offset, cp, stripeW);
          }
        }
      }
    }

    // Placed unit labels — ground floor only
    for (const unit of ws.placedUnits.filter((u) => u?.level === 0)) {
      const cell = gridCells.find((c) => c?.col === unit.col && c?.row === unit.row);
      if (!cell) continue;
      const w  = unit.widthCells  * cp;
      const h  = unit.heightCells * cp;
      const ut = NDSS_UNIT_TYPES.find((u_) => u_.id === unit.unitTypeId);
      if (!ut) continue;

      ctx.fillStyle   = ut.colour + '28';
      ctx.fillRect(cell.x + 1, cell.y + 1, w - 2, h - 2);
      ctx.strokeStyle = ut.colour;
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([]);
      ctx.strokeRect(cell.x + 1, cell.y + 1, w - 2, h - 2);

      if (cp >= 8) {
        const stackH = computeStackHeightM(unit.col, unit.row, ws.stackMap);
        const levels = Math.round(stackH / STOREY_HEIGHT_M);
        const label  = levels > 1 ? `${unit.label} ×${levels}` : unit.label;
        ctx.fillStyle    = ut.colour;
        ctx.font         = `${Math.max(7, Math.min(cp * 0.26, 10))}px "DM Mono", monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, cell.x + w / 2, cell.y + h / 2);
      }
    }

    // Circulation cores
    for (const core of ws.placedCores) {
      const cell = gridCells.find((c) => c?.col === core.col && c?.row === core.row);
      if (!cell) continue;
      const pal = ZONE_PALETTE['circulation'];
      ctx.fillStyle   = pal.fill + 'ee';
      ctx.fillRect(cell.x + 1, cell.y + 1, cp - 2, cp - 2);
      ctx.strokeStyle = pal.stroke;
      ctx.lineWidth   = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(cell.x + 1, cell.y + 1, cp - 2, cp - 2);
      if (cp >= 10) {
        const coreH = core.heightM ?? 0;
        const label = coreH > 0 ? `↕ ${coreH.toFixed(0)}m` : '↕';
        ctx.fillStyle    = pal.stroke;
        ctx.font         = `bold ${Math.max(7, cp * 0.3)}px "DM Mono", monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, cell.x + cp / 2, cell.y + cp / 2);
      }
    }

    // Axes
    if (ws.showAxes) {
      ctx.strokeStyle = AXIS_PALETTE.primary.stroke;
      ctx.lineWidth   = AXIS_PALETTE.primary.width;
      ctx.setLineDash(AXIS_PALETTE.primary.dash);
      ctx.beginPath();
      ctx.moveTo(axisX, CANVAS_PADDING_PX);
      ctx.lineTo(axisX, canvasH - CANVAS_PADDING_PX);
      ctx.stroke();

      ctx.strokeStyle = AXIS_PALETTE.secondary.stroke;
      ctx.lineWidth   = AXIS_PALETTE.secondary.width;
      ctx.setLineDash(AXIS_PALETTE.secondary.dash);
      ctx.beginPath();
      ctx.moveTo(CANVAS_PADDING_PX, axisY);
      ctx.lineTo(canvasW - CANVAS_PADDING_PX, axisY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '10px "DM Mono", monospace';
      ctx.fillStyle = AXIS_PALETTE.primary.stroke;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('N', axisX, CANVAS_PADDING_PX + 4);
      ctx.textBaseline = 'bottom';
      ctx.fillText('S', axisX, canvasH - CANVAS_PADDING_PX - 4);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText('W', CANVAS_PADDING_PX + 4, axisY);
      ctx.textAlign = 'right';
      ctx.fillText('E', canvasW - CANVAS_PADDING_PX - 4, axisY);
    }

    // Quadrant labels
    if (ws.showQuadrants) {
      const qLabels: { q: Quadrant; tx: number; ty: number }[] = [
        { q: 'NW', tx: axisX / 2,             ty: axisY / 2             },
        { q: 'NE', tx: (axisX + canvasW) / 2, ty: axisY / 2             },
        { q: 'SW', tx: axisX / 2,             ty: (axisY + canvasH) / 2 },
        { q: 'SE', tx: (axisX + canvasW) / 2, ty: (axisY + canvasH) / 2 },
      ];
      ctx.font = '12px "DM Mono", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const { q, tx, ty } of qLabels) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillText(q, tx, ty);
      }
    }
  }, [
    canvasW, canvasH, cellPx, gridCells, ws, hover,
    axisX, axisY, setbackScens, cellScores, roadCells,
  ]);

  useEffect(() => { draw(); }, [draw]);

  const selectedUnitType = NDSS_UNIT_TYPES.find((u) => u.id === ws.selectedUnitTypeId);
  const selectedSpec     = selectedUnitType?.storeySpecs.find(
    (s) => s.storeys === ws.selectedStoreys
  );
  const hoverScore  = hover ? cellScores.get(`${hover.col},${hover.row}`) : null;
  const hoverStackH = hover
    ? computeStackHeightM(hover.col, hover.row, ws.stackMap)
    : 0;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex w-full h-full overflow-hidden"
      style={{ background: '#0a0f1a', color: '#e2e8f0', fontFamily: 'DM Mono, monospace' }}
    >
      {/* ── Left palette ──────────────────────────────────────────────── */}
      <aside
        className="flex flex-col flex-shrink-0 overflow-y-auto"
        style={{ width: 272, borderRight: '1px solid #1e3a5f' }}
      >
        {/* Header */}
        <div className="px-4 py-3" style={{ borderBottom: '1px solid #1e3a5f' }}>
          <Link
            to="/"
            className="text-[10px] tracking-widest uppercase hover:opacity-70"
            style={{ color: '#64748b' }}
          >
            ← Site Analysis
          </Link>
          <h1 className="text-sm font-semibold mt-1" style={{ color: '#f1f5f9' }}>
            Step 4 · Planning Workspace
          </h1>
          <p className="text-[10px] mt-0.5" style={{ color: '#64748b' }}>
            {site.properties.name}
          </p>

          <div
            className="mt-1.5 px-2 py-1 rounded text-[9px]"
            style={{
              background: contextData?.roads ? '#14532d22' : '#78350f22',
              border:     `1px solid ${contextData?.roads ? '#14532d' : '#78350f'}`,
              color:      contextData?.roads ? '#4ade80'   : '#fb923c',
            }}
          >
            {contextData?.roads
              ? '✓ Composite scoring — road + solar data loaded'
              : '⚠ No road data — solar-only scoring applied'}
          </div>

          {contextHeightLimitM !== null && (
            <div
              className="mt-1 px-2 py-1 rounded text-[9px]"
              style={{
                background: '#1e3a5f22', border: '1px solid #1e3a5f', color: '#fbbf24',
              }}
            >
              Context mean height: {contextHeightLimitM.toFixed(1)} m — stacking clamped
            </div>
          )}

          <div
            className="mt-1 px-2 py-1 rounded text-[9px]"
            style={{ background: '#1e293b', border: '1px solid #1e3a5f', color: '#475569' }}
          >
            Scroll: zoom toward cursor · Alt+drag or middle-click: pan · Shift+scroll: horizontal pan
          </div>
        </div>

        {/* ── AUTO-GENERATE BUTTON ──────────────────────────────────────── */}
        <div className="px-3 py-4" style={{ borderBottom: '1px solid #1e3a5f' }}>
          <button
            onClick={handleAutoGenerate}
            disabled={isGenerating}
            className="w-full py-3 rounded text-[11px] font-semibold tracking-widest uppercase transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            style={{
              background: isGenerating
                ? '#334155'
                : 'linear-gradient(135deg, #1d4ed8 0%, #6d28d9 100%)',
              color:     '#fff',
              border:    '1px solid #3b82f6',
              boxShadow: isGenerating ? 'none' : '0 0 20px rgba(59,130,246,0.25)',
            }}
          >
            {isGenerating ? 'Generating…' : '⚡  Auto-Generate Plan'}
          </button>

          {/* Generation error banner */}
          {generationError && (
            <div
              className="mt-2 px-2 py-2 rounded text-[9px] leading-relaxed"
              style={{
                background: '#450a0a',
                border:     '1px solid #7f1d1d',
                color:      '#fca5a5',
              }}
            >
              {generationError}
              <button
                className="block mt-1 underline opacity-70 hover:opacity-100"
                onClick={() => setGenerationError(null)}
              >
                Dismiss
              </button>
            </div>
          )}

          <p className="text-[9px] mt-2 text-center leading-relaxed" style={{ color: '#475569' }}>
            Clears previous plan · Scores every cell · Lays roads ·
            Places gardens · Stacks up to {MAX_LEVELS} storeys
          </p>
        </div>

        {/* Manual tools */}
        <div className="px-3 py-3" style={{ borderBottom: '1px solid #1e3a5f' }}>
          <p className="text-[9px] tracking-widest uppercase mb-2" style={{ color: '#475569' }}>
            Manual Tools
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['unit',        '⬜', 'Unit',   '#3b82f6'],
                ['garden',      '▪',  'Garden', '#22c55e'],
                ['circulation', '↕',  'Core',   '#f97316'],
                ['erase',       '✕',  'Erase',  '#94a3b8'],
              ] as [WorkspaceState['selectedTool'], string, string, string][]
            ).map(([tool, icon, label, colour]) => {
              const isActive = ws.selectedTool === tool;
              return (
                <button
                  key={tool}
                  onClick={() => dispatch({ type: 'SET_TOOL', tool })}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[10px]"
                  style={{
                    background: isActive ? colour + '22' : '#1e293b',
                    color:      isActive ? colour        : '#64748b',
                    border:     `1px solid ${isActive ? colour : '#1e3a5f'}`,
                  }}
                >
                  <span>{icon}</span>{label}
                </button>
              );
            })}
          </div>
        </div>

        {/* NDSS palette */}
        <div className="px-3 py-3" style={{ borderBottom: '1px solid #1e3a5f' }}>
          <p className="text-[9px] tracking-widest uppercase mb-2" style={{ color: '#475569' }}>
            NDSS Unit Types
          </p>
          <div className="flex gap-1.5 mb-2.5">
            {([1, 2] as Storeys[]).map((s) => (
              <button
                key={s}
                onClick={() => dispatch({ type: 'SET_STOREYS', storeys: s })}
                className="flex-1 py-1 rounded text-[10px]"
                style={{
                  background: ws.selectedStoreys === s ? '#1e3a5f' : 'transparent',
                  color:      ws.selectedStoreys === s ? '#93c5fd' : '#475569',
                  border:     `1px solid ${ws.selectedStoreys === s ? '#3b82f6' : '#1e3a5f'}`,
                }}
              >
                {s === 1 ? '1-Storey' : '2-Storey'}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-0.5">
            {NDSS_UNIT_TYPES.filter((u) =>
              u.storeySpecs.some((s) => s.storeys === ws.selectedStoreys)
            ).map((u) => {
              const spec       = u.storeySpecs.find((s) => s.storeys === ws.selectedStoreys)!;
              const isSelected = ws.selectedUnitTypeId === u.id;
              return (
                <button
                  key={u.id}
                  onClick={() => {
                    dispatch({ type: 'SET_UNIT_TYPE', id: u.id });
                    dispatch({ type: 'SET_TOOL', tool: 'unit' });
                  }}
                  className="flex items-center gap-2 px-2 py-1.5 rounded text-left"
                  style={{
                    background: isSelected ? '#0f172a' : 'transparent',
                    border:     `1px solid ${isSelected ? u.colour + '66' : '#1e3a5f'}`,
                  }}
                >
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: u.colour }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-medium" style={{ color: isSelected ? u.colour : '#64748b' }}>
                      {u.label}
                    </div>
                    <div className="text-[9px]" style={{ color: '#334155' }}>
                      {spec.minAreaSqm}–{spec.maxAreaSqm} m²
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {selectedUnitType && selectedSpec && (
            <div className="mt-2 p-2 rounded" style={{ background: '#0f172a', border: `1px solid ${selectedUnitType.colour}33` }}>
              <div style={{ color: selectedUnitType.colour, fontSize: 10, fontWeight: 600 }}>
                {selectedUnitType.label} · {ws.selectedStoreys === 1 ? '1-Storey' : 'Duplex'}
              </div>
              <div style={{ color: '#334155', fontSize: 9 }}>
                {selectedSpec.minAreaSqm}–{selectedSpec.maxAreaSqm} m² ·
                Storage: {selectedUnitType.storageSqm} m²
              </div>
            </div>
          )}
        </div>

        {/* View toggles */}
        <div className="px-3 py-3" style={{ borderBottom: '1px solid #1e3a5f' }}>
          <p className="text-[9px] tracking-widest uppercase mb-1.5" style={{ color: '#475569' }}>View</p>
          {viewToggles.map(({ label, on, action }) => (
            <button
              key={label}
              onClick={() => dispatch(action)}
              className="flex items-center justify-between w-full py-1 text-[10px]"
              style={{ color: on ? '#93c5fd' : '#475569' }}
            >
              <span>{label}</span>
              <span className="w-6 h-3 rounded-full" style={{ background: on ? '#1d4ed8' : '#1e3a5f' }} />
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="px-3 py-3 flex flex-col gap-2">
          <button
            onClick={() => dispatch({ type: 'CLEAR_ALL' })}
            className="w-full py-2 rounded text-[10px] hover:opacity-80"
            style={{ background: '#450a0a', color: '#fca5a5', border: '1px solid #7f1d1d' }}
          >
            Clear All
          </button>
          <button
            onClick={handleProceedToMassing}
            disabled={ws.placedUnits.length === 0}
            className="w-full py-2.5 rounded text-[10px] font-medium tracking-widest uppercase hover:opacity-90 disabled:opacity-30"
            style={{ background: '#0f766e', color: '#ccfbf1', border: '1px solid #14b8a6' }}
          >
            Step 5: Detail Plan Overlay →
          </button>
        </div>
      </aside>

      {/* ── Canvas viewport ──────────────────────────────────────────────── */}
      <main
        className="flex-1 overflow-hidden relative"
        style={{
          cursor: isPanning ? 'grabbing' : ws.selectedTool === 'erase' ? 'crosshair' : 'cell',
        }}
      >
        <div
          ref={wrapperRef}
          className="absolute inset-0 overflow-hidden"
          style={{ userSelect: 'none' }}
        >
          {/* Zoom controls */}
          <div className="absolute top-3 left-3 z-10 flex items-center gap-2 text-[10px]" style={{ color: '#334155' }}>
            <span>{Math.round(scale)} px/m</span>
            <button onClick={() => setScale((s) => Math.min(MAX_SCALE, s * 1.2))} className="w-6 h-6 rounded" style={{ background: '#1e293b', color: '#64748b' }} title="Zoom in">+</button>
            <button onClick={() => setScale((s) => Math.max(MIN_SCALE, s / 1.2))} className="w-6 h-6 rounded" style={{ background: '#1e293b', color: '#64748b' }} title="Zoom out">−</button>
            <button onClick={() => { setScale(INITIAL_SCALE); setPanX(0); setPanY(0); }} className="px-2 h-6 rounded text-[9px]" style={{ background: '#1e293b', color: '#64748b' }} title="Reset view">⌂</button>
            <span style={{ color: '#1e3a5f' }}>
              {groundFloorUnits} ground · {stackedUnits} stacked · {ws.placedCores.length} cores
            </span>
            {maxStackHeightM > 0 && (
              <span style={{ color: '#fbbf24' }}>Max: {maxStackHeightM.toFixed(1)} m</span>
            )}
          </div>

          <div
            style={{
              transform:       `translate(${panX}px, ${panY}px)`,
              transformOrigin: 'top left',
              display:         'inline-block',
              paddingTop:      42,
              paddingLeft:     8,
            }}
          >
            <canvas
              ref={canvasRef}
              width={canvasW}
              height={canvasH}
              style={{ display: 'block', border: '1px solid #1e3a5f', borderRadius: 3 }}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={() => { setHover(null); setIsPainting(false); setIsPanning(false); }}
            />
          </div>
        </div>

        {/* Hover info bar */}
        {hover && (
          <div
            className="absolute bottom-3 left-3 z-10 text-[10px] flex items-center gap-3 px-3 py-1.5 rounded"
            style={{ background: 'rgba(10,15,26,0.9)', border: '1px solid #1e3a5f', color: '#475569' }}
          >
            <span>({hover.col}, {hover.row}) · {gridCells.find((c) => c?.col === hover.col && c?.row === hover.row)?.quadrant ?? '—'}</span>
            {ws.zonedCells[`${hover.col},${hover.row}`] && (
              <span style={{ color: ZONE_PALETTE[ws.zonedCells[`${hover.col},${hover.row}`].zoneType].stroke }}>
                {ZONE_DISPLAY_LABELS[ws.zonedCells[`${hover.col},${hover.row}`].zoneType]}
              </span>
            )}
            {hoverStackH > 0 && (
              <span style={{ color: '#fbbf24' }}>
                Stack: {hoverStackH.toFixed(1)} m ({Math.round(hoverStackH / STOREY_HEIGHT_M)} levels)
              </span>
            )}
            {hoverScore && (
              <span style={{ color: '#334155' }}>
                noise {(hoverScore.noiseScore * 100).toFixed(0)}% · solar {(hoverScore.solarScore * 100).toFixed(0)}% ·{' '}
                <span style={{ color: hoverScore.zone === 'premium-unit' ? '#4ade80' : hoverScore.zone === 'standard-unit' ? '#93c5fd' : hoverScore.zone === 'garden' ? '#fbbf24' : '#f87171' }}>
                  {hoverScore.zone.replace('-', ' ')}
                </span>
              </span>
            )}
          </div>
        )}
      </main>

      {/* ── Right stats panel ─────────────────────────────────────────────── */}
      <aside
        className="flex flex-col flex-shrink-0 overflow-y-auto"
        style={{ width: 240, borderLeft: '1px solid #1e3a5f' }}
      >
        {/* Area summary */}
        <div className="px-4 py-3" style={{ borderBottom: '1px solid #1e3a5f' }}>
          <p className="text-[9px] tracking-widest uppercase mb-2" style={{ color: '#475569' }}>Area Summary</p>
          {[
            { label: 'Total site',  value: `${Math.round(areaSummary.totalSiteSqm)} m²`   },
            { label: 'Developable', value: `${Math.round(areaSummary.developableSqm)} m²` },
            { label: 'Units',       value: `${Math.round(areaSummary.unitsSqm)} m²`        },
            { label: 'Garden',      value: `${Math.round(areaSummary.gardenSqm)} m² (${areaSummary.gardenPct.toFixed(1)}%)`, hi: areaSummary.gardenPct >= 10 },
            { label: 'Circulation', value: `${Math.round(areaSummary.circulationSqm)} m²` },
            { label: 'Remaining',   value: `${Math.round(areaSummary.remainingSqm)} m²`   },
          ].map(({ label, value, hi }) => (
            <div key={label} className="flex justify-between items-center py-0.5">
              <span className="text-[10px]" style={{ color: '#475569' }}>{label}</span>
              <span className="text-[10px] font-medium" style={{ color: hi ? '#4ade80' : '#64748b' }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Stack summary */}
        <div className="px-4 py-3" style={{ borderBottom: '1px solid #1e3a5f' }}>
          <p className="text-[9px] tracking-widest uppercase mb-2" style={{ color: '#475569' }}>Vertical Stack Summary</p>
          <div className="flex justify-between py-0.5">
            <span className="text-[10px]" style={{ color: '#475569' }}>Ground units</span>
            <span className="text-[10px] font-medium" style={{ color: '#93c5fd' }}>{groundFloorUnits}</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-[10px]" style={{ color: '#475569' }}>Stacked units</span>
            <span className="text-[10px] font-medium" style={{ color: '#c4b5fd' }}>{stackedUnits}</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-[10px]" style={{ color: '#475569' }}>Total units</span>
            <span className="text-[10px] font-medium" style={{ color: '#e2e8f0' }}>{ws.placedUnits.length}</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-[10px]" style={{ color: '#475569' }}>Max height</span>
            <span className="text-[10px] font-medium" style={{ color: '#fbbf24' }}>
              {maxStackHeightM > 0 ? `${maxStackHeightM.toFixed(1)} m` : '—'}
            </span>
          </div>
          {contextHeightLimitM !== null && (
            <div className="flex justify-between py-0.5">
              <span className="text-[10px]" style={{ color: '#475569' }}>Context limit</span>
              <span className="text-[10px] font-medium" style={{ color: '#fbbf24' }}>{contextHeightLimitM.toFixed(1)} m</span>
            </div>
          )}
          {[0, 1, 2, 3].map((lvl) => {
            const count = ws.placedUnits.filter((u) => u?.level === lvl).length;
            if (count === 0) return null;
            const colours = ['#93c5fd','#6ee7b7','#fcd34d','#f9a8d4'];
            return (
              <div key={lvl} className="flex justify-between py-0.5">
                <span className="text-[9px]" style={{ color: '#334155' }}>
                  Level {lvl} ({(lvl + 1) * STOREY_HEIGHT_M} m)
                </span>
                <span className="text-[9px]" style={{ color: colours[lvl] }}>{count}</span>
              </div>
            );
          })}
        </div>

        {/* Quadrant stats */}
        <div className="px-4 py-3" style={{ borderBottom: '1px solid #1e3a5f' }}>
          <p className="text-[9px] tracking-widest uppercase mb-2" style={{ color: '#475569' }}>Quadrant Statistics</p>
          {quadStats.map((q) => (
            <div key={q.quadrant} className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-medium" style={{ color: '#94a3b8' }}>{q.quadrant}</span>
                <div className="flex gap-1.5">
                  <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: q.gardenSatisfied ? '#14532d' : '#450a0a', color: q.gardenSatisfied ? '#4ade80' : '#f87171' }}>
                    {q.gardenPct.toFixed(1)}% {q.gardenSatisfied ? '✓' : '✗'}
                  </span>
                  <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: '#7c2d1222', color: '#f97316', border: '1px solid #7c2d12' }}>
                    {q.coreCount}c
                  </span>
                </div>
              </div>
              <div className="h-1 rounded-full" style={{ background: '#0f172a' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, q.gardenPct * 10)}%`, background: q.gardenSatisfied ? '#22c55e' : '#ef4444' }} />
              </div>
            </div>
          ))}
        </div>

        {/* Validation */}
        {ws.showValidation && (
          <div className="px-4 py-3">
            <p className="text-[9px] tracking-widest uppercase mb-2" style={{ color: '#475569' }}>Spatial Rules</p>
            {validationResults.length === 0
              ? <p className="text-[10px]" style={{ color: '#1e3a5f' }}>Place zones to validate.</p>
              : (
                <div className="flex flex-col gap-2">
                  {validationResults.map((r) => (
                    <div key={r.rule} className="p-2 rounded" style={{ background: r.passed ? '#14532d18' : '#450a0a18', border: `1px solid ${r.passed ? '#14532d' : '#7f1d1d'}` }}>
                      <div className="text-[9px] font-medium mb-0.5" style={{ color: r.passed ? '#4ade80' : '#f87171' }}>
                        {r.passed ? '✓' : '✗'} {r.rule}
                      </div>
                      <div className="text-[9px]" style={{ color: '#475569' }}>{r.message}</div>
                    </div>
                  ))}
                </div>
              )
            }
          </div>
        )}
      </aside>
    </div>
  );
};
