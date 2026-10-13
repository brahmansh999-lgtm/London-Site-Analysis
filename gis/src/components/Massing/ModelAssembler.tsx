/**
 * Step 7 — Componentised GLB Assembly
 *
 * Replaces the abstract voxel boxes from Step 6 with real .glb architectural
 * component models, one per NDSS unit typology.  The same Step 4 GeneratedPlan
 * data drives the layout — nothing in the packing algorithm changes.
 *
 * Model assets must be placed at:
 *   /data/asset/model/{typologyId}.glb
 * e.g. /data/asset/model/1b1p.glb, /data/asset/model/3b6p.glb …
 *
 * Coordinate system:
 *   Three.X = col  × cellSizeM × SCENE_SCALE  (east)
 *   Three.Y = 0 (unit base) → targetH / 2 (unit centre)
 *   Three.Z = row  × cellSizeM × SCENE_SCALE  (south)
 *
 * Orientation rule (corridor-facing, south-glazing preference):
 *   NW quadrant →   0°   entry faces south / primary axis
 *   NE quadrant →  90°   entry faces west  / primary axis
 *   SE quadrant → 180°   entry faces north / primary axis
 *   SW quadrant → 270°   entry faces east  / primary axis
 *
 * Performance:
 *   - shadows={false} on Canvas — no shadow map pass
 *   - antialias=false, precision=lowp, dpr capped at 1.5
 *   - frameloop="demand" — only re-renders when scene changes
 *   - GLB scenes cloned once per unit via useMemo, not inside render loop
 *   - All typologies preloaded at startup via useGLTF.preload
 *   - MeshBasicMaterial on all meshes — no lighting required, no black faces
 *   - GLB group positioned at cell centre so Y-rotation pivot is correct
 */

import React, { useMemo, useRef, Suspense } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  useGLTF,
} from '@react-three/drei';
import * as THREE from 'three';
import type { SiteFeature } from '../../types';
import type { GeneratedPlan, PlacedUnit, ZonedCell } from '../../types/architecture';
import type { SiteContextData, OsmBuildingProperties } from '../../utils/geoUtils';
import { NDSS_UNIT_TYPES } from '../../types/architecture';

// ─── Scale constants (must match MassingViewer) ───────────────────────────────

const STOREY_HEIGHT_M = 3.5;
const SCENE_SCALE     = 0.1; // 1 Three.js unit = 10 m

// ─── GLB asset path resolver ──────────────────────────────────────────────────

const MODEL_BASE_PATH = '/data/asset/model';

function modelPath(typologyId: string): string {
  return `${MODEL_BASE_PATH}/${typologyId}.glb`;
}

// Preload all GLB assets at module init so they are cached before scene mounts
useGLTF.preload(modelPath('1b1p'));
useGLTF.preload(modelPath('1b2p'));
useGLTF.preload(modelPath('2b3p'));
useGLTF.preload(modelPath('2b4p'));
useGLTF.preload(modelPath('3b4p'));
useGLTF.preload(modelPath('3b5p'));
useGLTF.preload(modelPath('3b6p'));

// ─── Quadrant → Y-rotation mapping ───────────────────────────────────────────

type Quadrant = 'NW' | 'NE' | 'SE' | 'SW';

const QUADRANT_ROTATION_Y: Record<Quadrant, number> = {
  NW:   0,
  NE:   Math.PI / 2,
  SE:   Math.PI,
  SW: -(Math.PI / 2),
};

// ─── Shared module-level materials — MeshBasicMaterial, no lighting required ──

const MAT_GROUND         = new THREE.MeshBasicMaterial({ color: '#e8e4de' });
const MAT_AXIS           = new THREE.LineBasicMaterial({ color: '#fbbf24', transparent: true, opacity: 0.4 });
const MAT_PRIMARY_ROAD   = new THREE.MeshBasicMaterial({ color: '#c45e10' });
const MAT_SECONDARY_ROAD = new THREE.MeshBasicMaterial({ color: '#94a3b8' });
const MAT_GARDEN_1       = new THREE.MeshBasicMaterial({ color: '#6ab187' });
const MAT_GARDEN_2       = new THREE.MeshBasicMaterial({ color: '#4d9e6a' });
const MAT_GARDEN_3       = new THREE.MeshBasicMaterial({ color: '#2d7a4f' });
const MAT_CORE           = new THREE.MeshBasicMaterial({ color: '#64748b', transparent: true, opacity: 0.95 });
const MAT_CONTEXT        = new THREE.MeshBasicMaterial({ color: '#6B7F8E', transparent: true, opacity: 0.4, depthWrite: false, side: THREE.FrontSide });
const MAT_EDGE_NORMAL    = new THREE.LineBasicMaterial({ color: '#0f172a', transparent: true, opacity: 0.45 });

// ─── Point-in-polygon helpers ─────────────────────────────────────────────────

function pointInPolygonRing(px: number, py: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function centroidInsideSite(coords: number[][], siteRings: number[][][]): boolean {
  let sumLng = 0, sumLat = 0, cnt = 0;
  for (const pt of coords) {
    if (Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
      sumLng += pt[0]; sumLat += pt[1]; cnt++;
    }
  }
  if (cnt === 0) return false;
  const cLng = sumLng / cnt, cLat = sumLat / cnt;
  for (const ring of siteRings) {
    if (pointInPolygonRing(cLng, cLat, ring)) return true;
  }
  return false;
}

function extractSiteRings(site: SiteFeature): number[][][] {
  const rings: number[][][] = [];
  if (!site?.geometry) return rings;
  if (site.geometry.type === 'Polygon') {
    if (site.geometry.coordinates[0]) rings.push(site.geometry.coordinates[0] as number[][]);
  } else if (site.geometry.type === 'MultiPolygon') {
    for (const poly of site.geometry.coordinates) {
      if (poly[0]) rings.push(poly[0] as number[][]);
    }
  }
  return rings;
}

// ─── Contextual height limit ──────────────────────────────────────────────────

function computeContextualHeightLimit(contextData: SiteContextData | null | undefined): number | null {
  if (!contextData?.buildings?.features?.length) return null;
  const heights: number[] = [];
  for (const f of contextData.buildings.features) {
    if (!f?.properties) continue;
    const p = f.properties as OsmBuildingProperties;
    if (p.height && p.height > 0) heights.push(p.height);
    else if (p.levels && p.levels > 0) heights.push(p.levels * 3.2);
  }
  if (!heights.length) return null;
  return heights.reduce((a, b) => a + b, 0) / heights.length;
}

// ─── Ground plane ─────────────────────────────────────────────────────────────

const SitePlane: React.FC<{ widthM: number; heightM: number }> = ({ widthM, heightM }) => {
  const w = widthM  * SCENE_SCALE;
  const h = heightM * SCENE_SCALE;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[w / 2, -0.01, h / 2]}>
      <planeGeometry args={[w + 1.0, h + 1.0]} />
      <primitive object={MAT_GROUND} attach="material" />
    </mesh>
  );
};

// ─── Axis lines ───────────────────────────────────────────────────────────────

const AxisLines: React.FC<{ widthM: number; heightM: number }> = ({ widthM, heightM }) => {
  const w = widthM  * SCENE_SCALE;
  const h = heightM * SCENE_SCALE;
  const nsLine = useMemo(() => {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(w / 2, 0.02, 0),
      new THREE.Vector3(w / 2, 0.02, h),
    ]);
    return new THREE.Line(geo, MAT_AXIS);
  }, [w, h]);
  const ewLine = useMemo(() => {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.02, h / 2),
      new THREE.Vector3(w, 0.02, h / 2),
    ]);
    return new THREE.Line(geo, MAT_AXIS);
  }, [w, h]);
  return <><primitive object={nsLine} /><primitive object={ewLine} /></>;
};

// ─── Road slab ────────────────────────────────────────────────────────────────

const RoadSlab: React.FC<{ col: number; row: number; cellSizeM: number; isPrimary: boolean }> = ({
  col, row, cellSizeM, isPrimary,
}) => {
  const s   = cellSizeM * SCENE_SCALE;
  if (!Number.isFinite(s) || s <= 0) return null;
  const slH = isPrimary ? 0.014 : 0.007;
  const mat = isPrimary ? MAT_PRIMARY_ROAD : MAT_SECONDARY_ROAD;
  return (
    <mesh position={[col * s + s / 2, slH / 2, row * s + s / 2]}>
      <boxGeometry args={[s, slH, s]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
};

// ─── Garden patch ─────────────────────────────────────────────────────────────

function inferGardenStripWidth(col: number, row: number, zonedCells: Record<string, ZonedCell>): number {
  let width = 0;
  for (let dc = 0; dc <= 3; dc++) { if (zonedCells[`${col + dc},${row}`]?.zoneType === 'garden') width++; else break; }
  for (let dc = 1; dc <= 3; dc++) { if (zonedCells[`${col - dc},${row}`]?.zoneType === 'garden') width++; else break; }
  return Math.min(width, 3);
}

const GardenPatch: React.FC<{ col: number; row: number; cellSizeM: number; stripWidth?: number }> = ({
  col, row, cellSizeM, stripWidth = 1,
}) => {
  const s = cellSizeM * SCENE_SCALE;
  if (!Number.isFinite(s) || s <= 0) return null;
  const h   = stripWidth === 3 ? 0.06 : stripWidth === 2 ? 0.03 : 0.004;
  const mat = stripWidth === 3 ? MAT_GARDEN_3 : stripWidth === 2 ? MAT_GARDEN_2 : MAT_GARDEN_1;
  return (
    <mesh position={[col * s + s / 2, h / 2, row * s + s / 2]}>
      <boxGeometry args={[s - 0.015, h, s - 0.015]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
};

// ─── Circulation core ─────────────────────────────────────────────────────────

const CoreBlock: React.FC<{ col: number; row: number; cellSizeM: number; heightLimit: number | null }> = ({
  col, row, cellSizeM, heightLimit,
}) => {
  const s     = cellSizeM * SCENE_SCALE;
  const coreH = Math.min(STOREY_HEIGHT_M * 2 + 1.5, heightLimit ?? Infinity) * SCENE_SCALE;
  const x     = col * s + s / 2;
  const z     = row * s + s / 2;
  const coreGeo  = useMemo(() => new THREE.BoxGeometry(s - 0.01, coreH, s - 0.01), [s, coreH]);
  const edgeLine = useMemo(() => new THREE.LineSegments(new THREE.EdgesGeometry(coreGeo), MAT_EDGE_NORMAL), [coreGeo]);
  return (
    <group>
      <mesh position={[x, coreH / 2, z]} geometry={coreGeo}>
        <primitive object={MAT_CORE} attach="material" />
      </mesh>
      <primitive object={edgeLine} position={[x, coreH / 2, z]} />
    </group>
  );
};

// ─── Context buildings (PIP-filtered) ────────────────────────────────────────

const ContextBuildings: React.FC<{
  contextData:   SiteContextData | null | undefined;
  siteOriginLat: number;
  siteOriginLng: number;
  siteRings:     number[][][];
}> = ({ contextData, siteOriginLat, siteOriginLng, siteRings }) => {
  const meshes = useMemo(() => {
    if (!contextData?.buildings?.features?.length) return [];
    return contextData.buildings.features.map((f, i) => {
      if (!f?.properties) return null;
      const p      = f.properties as OsmBuildingProperties;
      const height = ((p.height ?? 0) > 0 ? p.height! : (p.levels ?? 2) * 3.2) * SCENE_SCALE;
      if (!Number.isFinite(height) || height <= 0) return null;
      const coords =
        f.geometry?.type === 'Polygon'       ? f.geometry.coordinates?.[0]
        : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates?.[0]?.[0]
        : null;
      if (!Array.isArray(coords) || coords.length < 3) return null;
      if (siteRings.length > 0 && centroidInsideSite(coords as number[][], siteRings)) return null;
      let sumLng = 0, sumLat = 0, cnt = 0;
      for (const pt of coords) {
        if (Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
          sumLng += pt[0]; sumLat += pt[1]; cnt++;
        }
      }
      if (cnt === 0) return null;
      const dx = (sumLng / cnt - siteOriginLng) * 111320 * Math.cos((siteOriginLat * Math.PI) / 180) * SCENE_SCALE;
      const dz = -(sumLat / cnt - siteOriginLat) * 111320 * SCENE_SCALE;
      if (!Number.isFinite(dx) || !Number.isFinite(dz)) return null;
      const safeH = Math.max(0.01, Math.min(height, 100 * SCENE_SCALE));
      return (
        <mesh key={`ctx-${i}`} position={[dx, safeH / 2, dz]}>
          <boxGeometry args={[0.28, safeH, 0.28]} />
          <primitive object={MAT_CONTEXT} attach="material" />
        </mesh>
      );
    }).filter(Boolean);
  }, [contextData, siteOriginLat, siteOriginLng, siteRings]);
  return <>{meshes}</>;
};

// ─── Auto camera setup ────────────────────────────────────────────────────────

const AutoCamera: React.FC<{ widthM: number; heightM: number }> = ({ widthM, heightM }) => {
  const { camera } = useThree();
  const w    = widthM  * SCENE_SCALE;
  const h    = heightM * SCENE_SCALE;
  const dist = Math.max(w, h, 0.1) * 2.0;
  React.useEffect(() => {
    camera.position.set(w / 2 + dist * 0.55, dist * 0.60, h / 2 + dist * 0.65);
    camera.lookAt(w / 2, 0, h / 2);
  }, [camera, w, h, dist]);
  return null;
};

// ─── Orbit controls ───────────────────────────────────────────────────────────
// makeDefault lets OrbitControls call invalidate() automatically so
// frameloop="demand" only renders when the camera actually moves.

const DampedControls: React.FC<{ targetX: number; targetZ: number }> = ({ targetX, targetZ }) => (
  <OrbitControls
    makeDefault
    target={[targetX, 0, targetZ]}
    minPolarAngle={0}
    maxPolarAngle={Math.PI / 2 - 0.05}
    enablePan
    enableRotate
    enableZoom
    enableDamping
    dampingFactor={0.08}
    mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
    touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
  />
);

// ─── Memoised GLB unit instance ───────────────────────────────────────────────
//
// Each GLB clone is:
//   1. Positioned at the cell CENTRE so Y-rotation pivots correctly
//   2. Re-centred by subtracting its bounding box centre (GLB origins are arbitrary)
//   3. All mesh materials replaced with MeshBasicMaterial — no black faces ever

interface GlbUnitProps {
  unit:        PlacedUnit;
  cellSizeM:   number;
  heightLimit: number | null;
}

const GlbUnit: React.FC<GlbUnitProps> = ({ unit, cellSizeM, heightLimit }) => {
  const path      = modelPath(unit.unitTypeId);
  console.log('[GLB] Loading:', path, 'for unit', unit.id, '— unitTypeId:', unit.unitTypeId);
  const { scene } = useGLTF(path);
  const s         = cellSizeM * SCENE_SCALE;

  const totalLevels   = Math.max(1, (unit.storeys as number) ?? 1);
  const clampedLevels = heightLimit !== null
    ? Math.min(totalLevels, Math.floor(heightLimit / STOREY_HEIGHT_M))
    : totalLevels;

  // Cell CENTRE — rotation pivot must be at the centre, not the corner
  const cellCentreX = unit.col * s + s / 2;
  const cellCentreZ = unit.row * s + s / 2;
  const rotY        = QUADRANT_ROTATION_Y[(unit.quadrant as Quadrant) ?? 'NW'] ?? 0;

  if (!Number.isFinite(cellCentreX) || !Number.isFinite(cellCentreZ)) return null;

  // Compute uniform scale to fit one storey height
  const uniformScale = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const sz  = new THREE.Vector3();
    box.getSize(sz);
    if (!sz.y || sz.y <= 0) return 1;
    return (STOREY_HEIGHT_M * SCENE_SCALE) / sz.y;
  }, [scene]);

  const storeyHeightPx = STOREY_HEIGHT_M * SCENE_SCALE;

  // Clone once per storey:
  //   - disable shadows on all child meshes
  //   - replace materials with MeshBasicMaterial (preserves colour, kills black faces)
  //   - re-centre clone so its bounding box centre is at (0,0,0) relative to the group
  const levels = useMemo(() => {
    const arr: THREE.Object3D[] = [];
    for (let lvl = 0; lvl < clampedLevels; lvl++) {
      const clone = scene.clone(true);
      clone.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow    = false;
          mesh.receiveShadow = false;
          const oldMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          const colour = (oldMat as THREE.MeshStandardMaterial).color ?? new THREE.Color('#ccbbaa');
          mesh.material = new THREE.MeshBasicMaterial({
            color: colour,
            side:  THREE.FrontSide,
          });
        }
      });
      // Re-centre: shift clone so its bounding box centre is at the group origin
      const box    = new THREE.Box3().setFromObject(clone);
      const centre = new THREE.Vector3();
      box.getCenter(centre);
      clone.position.sub(centre);
      arr.push(clone);
    }
    return arr;
  }, [scene, clampedLevels]);

  return (
    <group position={[cellCentreX, 0, cellCentreZ]} rotation={[0, rotY, 0]}>
      {levels.map((clone, lvl) => (
        <primitive
          key={lvl}
          object={clone}
          position={[0, lvl * storeyHeightPx, 0]}
          scale={[uniformScale, uniformScale, uniformScale]}
        />
      ))}
    </group>
  );
};

// ─── Fallback box while GLB streams in ───────────────────────────────────────

const UnitFallback: React.FC<{ unit: PlacedUnit; cellSizeM: number; heightLimit: number | null }> = ({
  unit, cellSizeM, heightLimit,
}) => {
  const ut    = NDSS_UNIT_TYPES.find((u) => u.id === unit.unitTypeId);
  const colour = ut?.colour ?? '#93c5fd';
  const s     = cellSizeM * SCENE_SCALE;
  const w     = (unit.widthCells  ?? 1) * s;
  const d     = (unit.heightCells ?? 1) * s;
  const storeyH = STOREY_HEIGHT_M * SCENE_SCALE;
  const totalLevels = unit.storeys as number ?? 1;
  const clampedLevels = heightLimit !== null
    ? Math.min(totalLevels, Math.floor(heightLimit / STOREY_HEIGHT_M))
    : totalLevels;
  const x = unit.col * s;
  const z = unit.row * s;
  if (!Number.isFinite(w) || !Number.isFinite(d)) return null;
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.75 }),
    [colour],
  );
  return (
    <group position={[x, 0, z]}>
      {Array.from({ length: Math.max(1, clampedLevels) }, (_, lvl) => (
        <mesh key={lvl} position={[w / 2, lvl * storeyH + storeyH / 2, d / 2]}>
          <boxGeometry args={[w - 0.012, storeyH - 0.02, d - 0.012]} />
          <primitive object={mat} attach="material" />
        </mesh>
      ))}
    </group>
  );
};

// ─── Full assembled scene (inner Canvas content) ──────────────────────────────

interface AssembledSceneProps {
  plan:        GeneratedPlan;
  contextData: SiteContextData | null | undefined;
  site:        SiteFeature;
  heightLimit: number | null;
}

const AssembledScene: React.FC<AssembledSceneProps> = ({ plan, contextData, site, heightLimit }) => {
  const rawUnits    = plan?.placedUnits  ?? [];
  const placedCores = plan?.placedCores  ?? [];
  const zonedCells  = (plan?.zonedCells  ?? {}) as Record<string, ZonedCell>;
  const cellSizeM   = plan?.cellSizeM    ?? 4;
  const siteBboxM   = plan?.siteBboxM    ?? { widthM: 50, heightM: 50 };
  const { widthM, heightM } = siteBboxM;

  const placedUnits = useMemo(
    () => rawUnits.filter((u) => u && Number.isFinite(u.col) && Number.isFinite(u.row)),
    [rawUnits],
  );

  const gardenCells      = useMemo(() => Object.values(zonedCells).filter((z) => z?.zoneType === 'garden'),          [zonedCells]);
  const primaryRoadCells = useMemo(() => Object.values(zonedCells).filter((z) => z?.zoneType === 'public'),          [zonedCells]);
  const secondaryCells   = useMemo(() => Object.values(zonedCells).filter((z) => z?.zoneType === 'communal-shared'), [zonedCells]);
  const circCells        = useMemo(() => {
    if (placedCores.length > 0) return placedCores.filter((c) => c && Number.isFinite(c.col));
    return Object.values(zonedCells).filter((z) => z?.zoneType === 'circulation');
  }, [placedCores, zonedCells]);

  let siteOriginLat = 51.5, siteOriginLng = -0.1;
  if (
    site?.geometry?.type === 'Polygon' &&
    Array.isArray(site.geometry.coordinates?.[0]) &&
    site.geometry.coordinates[0].length > 0
  ) {
    const first = site.geometry.coordinates[0][0];
    if (Array.isArray(first) && first.length >= 2) {
      siteOriginLng = first[0]; siteOriginLat = first[1];
    }
  }

  const siteRings = useMemo(() => extractSiteRings(site), [site]);

  const targetX = widthM  * SCENE_SCALE / 2;
  const targetZ = heightM * SCENE_SCALE / 2;

  return (
    <>
      <AutoCamera widthM={widthM} heightM={heightM} />

      {/* No lights needed — all materials are MeshBasicMaterial */}

      <SitePlane widthM={widthM} heightM={heightM} />
      <AxisLines  widthM={widthM} heightM={heightM} />

      {primaryRoadCells.map((c) => c ? (
        <RoadSlab key={`pr-${c.col}-${c.row}`} col={c.col} row={c.row} cellSizeM={cellSizeM} isPrimary />
      ) : null)}
      {secondaryCells.map((c) => c ? (
        <RoadSlab key={`sr-${c.col}-${c.row}`} col={c.col} row={c.row} cellSizeM={cellSizeM} isPrimary={false} />
      ) : null)}

      {gardenCells.map((c) => {
        if (!c) return null;
        const sw = inferGardenStripWidth(c.col, c.row, zonedCells);
        return <GardenPatch key={`g-${c.col}-${c.row}`} col={c.col} row={c.row} cellSizeM={cellSizeM} stripWidth={sw} />;
      })}

      {circCells.map((c) => c ? (
        <CoreBlock key={`core-${c.col}-${c.row}`} col={c.col} row={c.row} cellSizeM={cellSizeM} heightLimit={heightLimit} />
      ) : null)}

      {placedUnits.map((unit) => (
        <Suspense
          key={unit.id}
          fallback={<UnitFallback unit={unit} cellSizeM={cellSizeM} heightLimit={heightLimit} />}
        >
          <GlbUnit unit={unit} cellSizeM={cellSizeM} heightLimit={heightLimit} />
        </Suspense>
      ))}

      <ContextBuildings
        contextData={contextData}
        siteOriginLat={siteOriginLat}
        siteOriginLng={siteOriginLng}
        siteRings={siteRings}
      />

      <DampedControls targetX={targetX} targetZ={targetZ} />
    </>
  );
};

// ─── Stats overlay ────────────────────────────────────────────────────────────

const StatsOverlay: React.FC<{ plan: GeneratedPlan; heightLimit: number | null }> = ({ plan, heightLimit }) => {
  const placedUnits = plan?.placedUnits ?? [];
  const clamped     = heightLimit !== null
    ? placedUnits.filter((u) => ((u?.storeys ?? 1) * STOREY_HEIGHT_M) > heightLimit).length
    : 0;

  const panel: React.CSSProperties = {
    background: 'rgba(10,15,26,0.92)', border: '1px solid #1e3a5f', borderRadius: 4,
    padding: '10px 14px', fontFamily: 'DM Mono', fontSize: 11, color: '#e2e8f0', minWidth: 240,
  };
  const lbl: React.CSSProperties = {
    color: '#475569', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8,
  };
  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', marginBottom: 3 };

  return (
    <div style={{ position: 'absolute', top: 68, right: 16, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={panel}>
        <div style={lbl}>Assembly Statistics</div>
        <div style={row}><span style={{ color: '#475569' }}>Total units</span>    <span style={{ color: '#93c5fd' }}>{placedUnits.length}</span></div>
        <div style={row}><span style={{ color: '#475569' }}>Site area</span>       <span style={{ color: '#93c5fd' }}>{Math.round((plan?.siteBboxM?.widthM ?? 0) * (plan?.siteBboxM?.heightM ?? 0))} m²</span></div>
        <div style={row}><span style={{ color: '#475569' }}>Rendering mode</span> <span style={{ color: '#4ade80' }}>GLB Components</span></div>
        {heightLimit !== null && (
          <>
            <div style={{ borderTop: '1px solid #1e3a5f', margin: '7px 0' }} />
            <div style={row}><span style={{ color: '#475569' }}>Context mean height</span><span style={{ color: '#fbbf24' }}>{heightLimit.toFixed(1)} m</span></div>
            <div style={row}><span style={{ color: '#475569' }}>Height violations</span><span style={{ color: clamped > 0 ? '#fde68a' : '#4ade80' }}>{clamped > 0 ? `${clamped} ⚠` : '0 ✓'}</span></div>
          </>
        )}
        {heightLimit === null && (
          <div style={{ color: '#334155', fontSize: 9, marginTop: 6 }}>No adjacent height data — constraint not applied.</div>
        )}
      </div>

      <div style={panel}>
        <div style={lbl}>Typology Colour Code</div>
        {NDSS_UNIT_TYPES.map((ut) => (
          <div key={ut.id} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: ut.colour, flexShrink: 0, border: '1px solid rgba(255,255,255,0.15)' }} />
            <span style={{ color: '#64748b', fontSize: 10 }}>{ut.label}</span>
          </div>
        ))}
        <div style={{ borderTop: '1px solid #1e3a5f', margin: '6px 0' }} />
        {[
          { colour: '#64748b',               label: 'Vertical circulation core'  },
          { colour: '#4d7c5e',               label: 'Internal garden'            },
          { colour: '#c45e10',               label: 'Primary road (4 m axis)'    },
          { colour: '#94a3b8',               label: 'Secondary road / corridor'  },
          { colour: 'rgba(107,127,142,0.4)', label: 'Existing context (ghosted)' },
        ].map(({ colour, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: colour, flexShrink: 0, border: '1px solid rgba(255,255,255,0.12)' }} />
            <span style={{ color: '#64748b', fontSize: 10 }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Zoom controls (FOV) ──────────────────────────────────────────────────────

const ZoomControls: React.FC<{ onZoomIn: () => void; onZoomOut: () => void; onReset: () => void }> = ({
  onZoomIn, onZoomOut, onReset,
}) => (
  <div style={{ position: 'absolute', bottom: 24, right: 24, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
    {[
      { label: '+', title: 'Zoom in',  onClick: onZoomIn  },
      { label: '−', title: 'Zoom out', onClick: onZoomOut },
      { label: '⌂', title: 'Reset',    onClick: onReset   },
    ].map(({ label, title, onClick }) => (
      <button key={title} title={title} onClick={onClick} style={{
        width: 36, height: 36, borderRadius: 4, fontFamily: 'DM Mono',
        fontSize: 16, fontWeight: 700, cursor: 'pointer',
        background: 'rgba(10,15,26,0.88)', color: '#93c5fd',
        border: '1px solid #1e3a5f',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {label}
      </button>
    ))}
    <div style={{ marginTop: 4, fontSize: 9, fontFamily: 'DM Mono', color: '#334155', textAlign: 'center', lineHeight: 1.4 }}>
      Scroll<br />to zoom
    </div>
  </div>
);

// ─── Prop types ───────────────────────────────────────────────────────────────

export interface ModelAssemblerProps {
  site:            SiteFeature;
  plan:            GeneratedPlan;
  contextData:     SiteContextData | null | undefined;
  onBackToMassing: () => void;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export const ModelAssembler: React.FC<ModelAssemblerProps> = ({
  site, plan, contextData, onBackToMassing,
}) => {
  const heightLimit = useMemo(() => computeContextualHeightLimit(contextData), [contextData]);
  const cameraRef   = useRef<THREE.PerspectiveCamera>(null);

  const handleZoomIn  = () => { if (!cameraRef.current) return; cameraRef.current.fov = Math.max(10, cameraRef.current.fov - 5); cameraRef.current.updateProjectionMatrix(); };
  const handleZoomOut = () => { if (!cameraRef.current) return; cameraRef.current.fov = Math.min(90, cameraRef.current.fov + 5); cameraRef.current.updateProjectionMatrix(); };
  const handleReset   = () => { if (!cameraRef.current) return; cameraRef.current.fov = 45; cameraRef.current.updateProjectionMatrix(); };

  if (!plan) {
    return (
      <div style={{
        width: '100%', height: '100%', background: '#0a0f1a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'DM Mono', color: '#475569',
      }}>
        No plan data — return to Step 4 and generate a plan first.
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', background: '#0a0f1a', position: 'relative' }}>

      {/* ── Header strip ── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, height: 52,
        background: 'rgba(10,15,26,0.96)', borderBottom: '1px solid #1e3a5f',
        display: 'flex', alignItems: 'center', padding: '0 20px', gap: 16, fontFamily: 'DM Mono',
      }}>
        <button
          onClick={onBackToMassing}
          style={{ color: '#475569', fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          ← Step 6 Massing
        </button>
        <div style={{ width: 1, height: 20, background: '#1e3a5f' }} />
        <div style={{ width: 8, height: 8, borderRadius: 2, background: '#4ade80' }} />
        <span style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600 }}>Step 7 · Componentised GLB Assembly</span>
        <span style={{ color: '#475569', fontSize: 11 }}>{site?.properties?.name ?? ''}</span>
        {heightLimit !== null && (
          <>
            <div style={{ width: 1, height: 20, background: '#1e3a5f', marginLeft: 8 }} />
            <span style={{ color: '#fbbf24', fontSize: 11 }}>Context mean height: {heightLimit.toFixed(1)} m — constraint active</span>
          </>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ color: '#334155', fontSize: 10 }}>Left: orbit · Right-drag: pan · Scroll: zoom</span>
      </div>

      {/* ── Three.js canvas ── */}
      <div style={{ position: 'absolute', inset: 0, paddingTop: 52 }}>
        <Canvas
          style={{ width: '100%', height: '100%' }}
          shadows={false}
          frameloop="demand"
          gl={{
            antialias: false,
            powerPreference: 'high-performance',
            precision: 'lowp',
          }}
          dpr={[1, 1.5]}
          camera={{ fov: 45, near: 0.01, far: 500 }}
          onCreated={({ camera }) => {
            (cameraRef as React.MutableRefObject<THREE.Camera>).current = camera;
          }}
        >
          <Suspense fallback={null}>
            <AssembledScene
              plan={plan}
              contextData={contextData}
              site={site}
              heightLimit={heightLimit}
            />
          </Suspense>
        </Canvas>
      </div>

      <StatsOverlay plan={plan} heightLimit={heightLimit} />
      <ZoomControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onReset={handleReset} />

      <div style={{
        position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
        fontSize: 10, fontFamily: 'DM Mono', color: '#334155', zIndex: 10,
      }}>
        Left-drag: orbit · Right-drag: pan · Scroll: zoom · Buttons: FOV zoom
      </div>
    </div>
  );
};
