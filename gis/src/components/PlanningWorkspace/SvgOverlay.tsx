/**
 * Step 5 — Detail Plan Overlay
 *
 * Renders the procedural grid from Step 4 as HTML div cells, then injects the
 * real typology SVG floor plans (fetched from /data/floorplans/) into every
 * placed residential unit cell.
 *
 * SVGs are fetched as text on mount, stripped of their fixed pt-based
 * width/height attributes (which would override the cell size), then injected
 * via dangerouslySetInnerHTML.  The viewBox attribute controls scaling;
 * preserveAspectRatio="xMidYMid meet" centres and fits without distortion.
 *
 * Each unit cell div is the bounding box.  The SVG wrapper inside it uses
 * position:absolute inset:0 so the SVG fills and clips to the cell exactly.
 *
 * Rotation:  derived from the unit's quadrant field.
 *   NW → 0°   (entry faces south)
 *   NE → 90°  (entry faces west)
 *   SE → 180° (entry faces north)
 *   SW → 270° (entry faces east)
 *
 * Opacity slider controls all unit SVGs simultaneously.
 * Tab bar highlights the active typology but does NOT hide other typologies —
 * all placed units show their own SVG regardless of which tab is active.
 *
 * Pan/zoom: scroll-wheel to zoom toward cursor, Alt+drag or middle-mouse to pan.
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { GeneratedPlan, ZonedCell } from '../../types/architecture';
import { NDSS_UNIT_TYPES, ZONE_PALETTE } from '../../types/architecture';
import { usePanZoom } from '../../hooks/usePanZoom';
import { tightenSvgViewBox, recolourSvg } from '../../utils/svgUtils';

// ─── Prop types ───────────────────────────────────────────────────────────────

export interface SvgOverlayProps {
  plan:      GeneratedPlan;
  site:      unknown;
  onBack:    () => void;
  onProceed: () => void;
}

// ─── Quadrant → CSS rotation ──────────────────────────────────────────────────

const QUADRANT_DEG: Record<string, number> = {
  NW:   0,
  NE:  90,
  SE: 180,
  SW: 270,
};

// ─── Known typology IDs for pre-fetch ─────────────────────────────────────────

const TYPOLOGY_IDS = ['1b1p', '1b2p', '2b3p', '2b4p', '3b4p', '3b5p', '3b6p'];

// ─── Process fetched SVG: tight viewBox crop + dark-mode recolouring ─────────

function processSvg(svgText: string): string {
  return recolourSvg(tightenSvgViewBox(svgText));
}

// ─── Per-cell real SVG ────────────────────────────────────────────────────────

interface CellSvgProps {
  svgHtml:   string;
  rotateDeg: number;
  opacity:   number;
}

const CellSvg: React.FC<CellSvgProps> = ({ svgHtml, rotateDeg, opacity }) => (
  <div
    style={{
      position:        'absolute',
      inset:           0,
      overflow:        'hidden',
      pointerEvents:   'none',
      opacity,
      transform:       `rotate(${rotateDeg}deg)`,
      transformOrigin: '50% 50%',
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'center',
      width:           '100%',
      height:          '100%',
    }}
    dangerouslySetInnerHTML={{ __html: svgHtml }}
  />
);

// ─── Zone background colour ───────────────────────────────────────────────────

function zoneBg(zoneType: string): string {
  const p = ZONE_PALETTE[zoneType as keyof typeof ZONE_PALETTE];
  return p?.fill ?? 'transparent';
}

function zoneBorder(zoneType: string): string {
  const p = ZONE_PALETTE[zoneType as keyof typeof ZONE_PALETTE];
  if (!p?.stroke || p.stroke === 'transparent') return 'transparent';
  return p.stroke;
}

// ─── Zoom control button style ────────────────────────────────────────────────

const btnStyle: React.CSSProperties = {
  width: 28, height: 28,
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 4,
  color: '#fff',
  fontSize: 14,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'DM Mono',
};

// ─── Main component ───────────────────────────────────────────────────────────

export const SvgOverlay: React.FC<SvgOverlayProps> = ({
  plan,
  onBack,
  onProceed,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pxPerM, setPxPerM] = useState(12);

  // Global opacity for all SVG overlays
  const [svgOpacity, setSvgOpacity] = useState(0.82);

  // Active tab — visual highlight only, does not filter what is rendered
  const [activeTab, setActiveTab] = useState<string>(NDSS_UNIT_TYPES[0]?.id ?? '1b1p');

  // ── Fetch real SVG floor plans on mount ───────────────────────────────────
  const [svgCache, setSvgCache] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      TYPOLOGY_IDS.map((id) =>
        fetch(`/data/floorplans/${id}.svg`)
          .then((r) => {
            console.log(`[SvgOverlay] fetch /data/floorplans/${id}.svg → ${r.status}`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.text();
          })
          .then((text) => {
            return [id, processSvg(text)] as [string, string];
          })
          .catch((err) => {
            console.warn(`[SvgOverlay] failed to load ${id}.svg:`, err);
            return [id, ''] as [string, string];
          }),
      ),
    ).then((entries) => {
      if (!cancelled) setSvgCache(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, []);

  // ── Responsive cell size ──────────────────────────────────────────────────
  const computeDimensions = useCallback(() => {
    if (!wrapRef.current || !plan) return;
    const { widthM, heightM } = plan.siteBboxM;
    const rect = wrapRef.current.getBoundingClientRect();
    const pad  = 48;
    const px   = Math.max(4, Math.min(40, Math.min(
      (rect.width  - pad * 2) / widthM,
      (rect.height - pad * 2) / heightM,
    )));
    setPxPerM(px);
  }, [plan]);

  useLayoutEffect(() => {
    computeDimensions();
    const ro = new ResizeObserver(computeDimensions);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [computeDimensions]);

  // ── Derive cell pixel size ────────────────────────────────────────────────
  const cellPx = plan.cellSizeM * pxPerM;

  // ── Collect the anchor cell for each unit (top-left cell only) ───────────
  const anchoredUnits = useMemo(() => {
    return plan.placedUnits.filter((u) => {
      const zc = plan.zonedCells[`${u.col},${u.row}`];
      return zc?.unitId === u.id;
    });
  }, [plan]);

  // ── Pan + zoom ────────────────────────────────────────────────────────────
  const {
    containerRef: panZoomRef,
    cssTransform,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    zoomIn,
    zoomOut,
    resetTransform,
  } = usePanZoom(0.1, 8);

  // ── Style helpers ─────────────────────────────────────────────────────────
  const panel: React.CSSProperties = {
    background: 'rgba(10,15,26,0.92)', border: '1px solid #1e3a5f',
    borderRadius: 4, padding: '10px 14px', fontFamily: 'DM Mono',
    fontSize: 11, color: '#e2e8f0',
  };
  const lbl: React.CSSProperties = {
    color: '#475569', fontSize: 9, letterSpacing: '0.1em',
    textTransform: 'uppercase', marginBottom: 4, display: 'block',
  };

  const activeUt = NDSS_UNIT_TYPES.find((u) => u.id === activeTab);

  // Grid canvas dimensions
  const gridW = plan.gridCols * cellPx;
  const gridH = plan.gridRows * cellPx;

  return (
    <div style={{ width: '100%', height: '100%', background: '#0a0f1a', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header strip ── */}
      <div style={{
        flexShrink: 0, height: 52,
        background: 'rgba(10,15,26,0.96)', borderBottom: '1px solid #1e3a5f',
        display: 'flex', alignItems: 'center', padding: '0 20px', gap: 16,
        fontFamily: 'DM Mono',
      }}>
        <button onClick={onBack} style={{ color: '#475569', fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          ← Step 4 Planning
        </button>
        <div style={{ width: 1, height: 20, background: '#1e3a5f' }} />
        <div style={{ width: 8, height: 8, borderRadius: 2, background: '#60a5fa' }} />
        <span style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600 }}>Step 5 · Detail Plan Overlay</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onProceed}
          style={{
            padding: '6px 16px', borderRadius: 4, fontFamily: 'DM Mono',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
            background: '#0f766e', color: '#f0fdf4', border: '1px solid #0f766e',
          }}
        >
          Step 6: 3D Massing →
        </button>
      </div>

      {/* ── Typology tab bar ── */}
      <div style={{
        flexShrink: 0, height: 38, borderBottom: '1px solid #1e3a5f',
        background: 'rgba(10,15,26,0.88)', display: 'flex', alignItems: 'center',
        padding: '0 16px', gap: 4, overflowX: 'auto',
      }}>
        {NDSS_UNIT_TYPES.map((ut) => {
          const isActive = ut.id === activeTab;
          return (
            <button
              key={ut.id}
              onClick={() => setActiveTab(ut.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 12px', borderRadius: 3, fontFamily: 'DM Mono',
                fontSize: 10, fontWeight: isActive ? 700 : 400,
                cursor: 'pointer', border: '1px solid',
                borderColor: isActive ? ut.colour : '#1e3a5f',
                background:  isActive ? `${ut.colour}22` : 'transparent',
                color:       isActive ? ut.colour : '#475569',
                whiteSpace:  'nowrap',
                transition:  'all 0.12s',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: ut.colour }} />
              {ut.label}
            </button>
          );
        })}
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Grid viewport with pan+zoom ── */}
        <div
          ref={(el) => {
            // Attach both the resize observer ref and the pan/zoom containerRef
            (wrapRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
            (panZoomRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            cursor: 'grab',
            userSelect: 'none',
          }}
        >
          {/* Transformed inner content */}
          <div
            style={{
              transform:       cssTransform,
              transformOrigin: '0 0',
              willChange:      'transform',
              padding:         48,
              display:         'inline-block',
            }}
          >
            {/* Site grid container — positions all cells absolutely */}
            <div
              style={{
                position:  'relative',
                width:     gridW,
                height:    gridH,
                flexShrink: 0,
                border:    '1px solid #334155',
                background: '#0f172a',
              }}
            >
              {/* ── Zone background cells (all non-empty zones) ── */}
              {(Object.values(plan.zonedCells) as ZonedCell[]).map((zc) => {
                if (!zc || zc.zoneType === 'empty') return null;
                const bg      = zoneBg(zc.zoneType);
                const border  = zoneBorder(zc.zoneType);
                const palette = ZONE_PALETTE[zc.zoneType];
                const dashStr = palette?.dash ? `${palette.dash[0]}px ${palette.dash[1]}px` : undefined;
                return (
                  <div
                    key={`zone-${zc.col}-${zc.row}`}
                    style={{
                      position:    'absolute',
                      left:        zc.col * cellPx,
                      top:         zc.row * cellPx,
                      width:       cellPx,
                      height:      cellPx,
                      background:  bg,
                      border:      `1px solid ${border}`,
                      borderStyle: dashStr ? 'dashed' : 'solid',
                      boxSizing:   'border-box',
                    }}
                  />
                );
              })}

              {/* ── Circulation cores ── */}
              {plan.placedCores.map((core) => (
                <div
                  key={`core-${core.id}`}
                  style={{
                    position:   'absolute',
                    left:       core.col * cellPx + 2,
                    top:        core.row * cellPx + 2,
                    width:      cellPx - 4,
                    height:     cellPx - 4,
                    background: '#64748b',
                    borderRadius: 2,
                    display:    'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span style={{ color: '#0f172a', fontSize: Math.max(7, cellPx * 0.18), fontFamily: 'DM Mono', fontWeight: 700, userSelect: 'none' }}>
                    ⬡
                  </span>
                </div>
              ))}

              {/* ── Residential units with per-cell real SVG floor plan ── */}
              {anchoredUnits.map((unit) => {
                const ut           = NDSS_UNIT_TYPES.find((u) => u.id === unit.unitTypeId);
                const colour       = ut?.colour ?? '#93c5fd';
                const rotateDeg    = QUADRANT_DEG[unit.quadrant] ?? 0;
                const unitW        = (unit.widthCells  ?? 1) * cellPx;
                const unitH        = (unit.heightCells ?? 1) * cellPx;
                const isHighlighted = unit.unitTypeId === activeTab;
                const svgHtml      = svgCache[unit.unitTypeId] ?? '';

                return (
                  <div
                    key={unit.id}
                    style={{
                      position:   'absolute',
                      left:       unit.col * cellPx,
                      top:        unit.row * cellPx,
                      width:      unitW,
                      height:     unitH,
                      minHeight:  unitH,
                      boxSizing:  'border-box',
                      border:     `1.5px solid ${isHighlighted ? colour : colour + '66'}`,
                      background: isHighlighted ? `${colour}18` : `${colour}09`,
                      borderRadius: 1,
                      overflow:   'hidden',
                      transition: 'border-color 0.12s, background 0.12s',
                    }}
                  >
                    {/* SVG — inline injected, fills the unit cell absolutely */}
                    {svgHtml && (
                      <CellSvg
                        svgHtml={svgHtml}
                        rotateDeg={rotateDeg}
                        opacity={svgOpacity}
                      />
                    )}

                    {/* Unit label chip — top-left corner */}
                    <div style={{
                      position:   'absolute',
                      top:        3,
                      left:       3,
                      zIndex:     2,
                      background: 'rgba(10,15,26,0.78)',
                      border:     `1px solid ${colour}44`,
                      borderRadius: 2,
                      padding:    '1px 4px',
                      fontFamily: 'DM Mono',
                      fontSize:   Math.max(7, Math.min(10, cellPx * 0.14)),
                      color:      colour,
                      pointerEvents: 'none',
                      whiteSpace: 'nowrap',
                      lineHeight: 1.4,
                    }}>
                      {unit.unitTypeId}
                    </div>
                  </div>
                );
              })}

              {/* ── Grid overlay lines ── */}
              {Array.from({ length: plan.gridCols + 1 }, (_, c) => (
                <div key={`vl-${c}`} style={{
                  position: 'absolute', left: c * cellPx, top: 0,
                  width: 1, height: gridH,
                  background: 'rgba(30,58,95,0.35)', pointerEvents: 'none',
                }} />
              ))}
              {Array.from({ length: plan.gridRows + 1 }, (_, r) => (
                <div key={`hl-${r}`} style={{
                  position: 'absolute', top: r * cellPx, left: 0,
                  width: gridW, height: 1,
                  background: 'rgba(30,58,95,0.35)', pointerEvents: 'none',
                }} />
              ))}
            </div>
          </div>

          {/* ── Zoom controls (absolute, top-right) ── */}
          <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 100, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button onClick={zoomIn}         style={btnStyle}>+</button>
            <button onClick={zoomOut}        style={btnStyle}>−</button>
            <button onClick={resetTransform} style={btnStyle}>⌂</button>
          </div>

          {/* ── Pan hint ── */}
          <div style={{
            position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
            fontSize: 9, fontFamily: 'DM Mono', color: '#334155', pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}>
            Scroll: zoom · Alt+drag or middle-click: pan
          </div>
        </div>

        {/* ── Right control panel ── */}
        <div style={{
          flexShrink: 0, width: 260, overflowY: 'auto',
          borderLeft: '1px solid #1e3a5f',
          padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 12,
          fontFamily: 'DM Mono',
        }}>

          {/* Active typology indicator */}
          <div style={panel}>
            <div style={{ color: '#475569', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              Active Typology
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: activeUt?.colour ?? '#93c5fd', flexShrink: 0 }} />
              <span style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 600 }}>{activeUt?.label ?? activeTab}</span>
            </div>
            <div style={{ color: '#334155', fontSize: 9, marginTop: 6, lineHeight: 1.5 }}>
              All placed units show their own SVG schematic.
              Active tab highlights matching cells.
            </div>
          </div>

          {/* SVG opacity control */}
          <div style={panel}>
            <div style={{ color: '#475569', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
              Overlay Controls
            </div>
            <span style={lbl}>SVG Opacity {Math.round(svgOpacity * 100)}%</span>
            <input
              type="range" min={0} max={1} step={0.01}
              value={svgOpacity}
              onChange={(e) => setSvgOpacity(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: '#3b82f6', cursor: 'pointer' }}
            />
            <div style={{ color: '#334155', fontSize: 9, marginTop: 8, lineHeight: 1.5 }}>
              SVGs rotate with unit quadrant:<br />
              NW=0° · NE=90° · SE=180° · SW=270°
            </div>
          </div>

          {/* Zone legend */}
          <div style={panel}>
            <div style={{ color: '#475569', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              Zone Legend
            </div>
            {(
              [
                { colour: '#1e3a5f', label: 'Residential unit'       },
                { colour: '#14532d', label: 'Garden'                  },
                { colour: '#713f12', label: 'Primary axis / road'     },
                { colour: '#64748b', label: 'Circulation core'        },
                { colour: '#164e63', label: 'Communal shared'         },
                { colour: '#3b0764', label: 'Communal private'        },
              ] as { colour: string; label: string }[]
            ).map(({ colour, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: colour, flexShrink: 0, border: '1px solid rgba(255,255,255,0.15)' }} />
                <span style={{ color: '#64748b', fontSize: 10 }}>{label}</span>
              </div>
            ))}
          </div>

          {/* SVG load status */}
          <div style={{ ...panel, fontSize: 9, color: '#334155', lineHeight: 1.6 }}>
            <div style={{ color: '#475569', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
              Floor Plan SVGs
            </div>
            {TYPOLOGY_IDS.map((id) => {
              const loaded = !!svgCache[id];
              return (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <div style={{ width: 8, height: 8, flexShrink: 0, borderRadius: 1, background: loaded ? '#4ade80' : '#334155' }} />
                  <span style={{ color: loaded ? '#64748b' : '#334155' }}>{id} {loaded ? '✓' : '…'}</span>
                </div>
              );
            })}
          </div>

          {/* Plan statistics */}
          <div style={panel}>
            <div style={{ color: '#475569', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              Plan Statistics
            </div>
            {[
              { label: 'Total units',    value: plan.placedUnits.length },
              { label: 'Grid module',    value: `${plan.cellSizeM} m`   },
              { label: 'Grid size',      value: `${plan.gridCols} × ${plan.gridRows}` },
              { label: 'Site area',      value: `${Math.round(plan.siteBboxM.widthM * plan.siteBboxM.heightM)} m²` },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ color: '#475569' }}>{label}</span>
                <span style={{ color: '#93c5fd' }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SvgOverlay;
