import type { Position } from 'geojson';
import type { SiteFeature } from '../types';
import {
  calculateFeatureArea,
  formatArea,
  getFeatureBounds,
  getFeatureCentroid,
  type SiteContextData,
} from './geoUtils';

interface Point2d {
  x: number;
  y: number;
}

const EARTH_RADIUS_M = 6_378_137;

function sanitiseText(value: string | number | undefined | null): string {
  return String(value ?? '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dxfPair(code: number, value: string | number): string {
  return `${code}\n${value}\n`;
}

function projectPosition(position: Position, originLng: number, originLat: number): Point2d {
  const [lng, lat] = position;
  const latRad = originLat * Math.PI / 180;
  return {
    x: (lng - originLng) * Math.PI / 180 * EARTH_RADIUS_M * Math.cos(latRad),
    y: (lat - originLat) * Math.PI / 180 * EARTH_RADIUS_M,
  };
}

function collectRings(site: SiteFeature): Position[][] {
  if (site.geometry.type === 'Polygon') return site.geometry.coordinates;
  return site.geometry.coordinates.flatMap((polygon) => polygon);
}

function closeRing(points: Point2d[]): Point2d[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first.x === last.x && first.y === last.y) return points;
  return [...points, first];
}

function layer(name: string, colour: number): string {
  return [
    dxfPair(0, 'LAYER'),
    dxfPair(2, name),
    dxfPair(70, 0),
    dxfPair(62, colour),
    dxfPair(6, 'CONTINUOUS'),
  ].join('');
}

function line(layerName: string, a: Point2d, b: Point2d): string {
  return [
    dxfPair(0, 'LINE'),
    dxfPair(8, layerName),
    dxfPair(10, a.x.toFixed(3)),
    dxfPair(20, a.y.toFixed(3)),
    dxfPair(30, 0),
    dxfPair(11, b.x.toFixed(3)),
    dxfPair(21, b.y.toFixed(3)),
    dxfPair(31, 0),
  ].join('');
}

function lineLoop(layerName: string, points: Point2d[]): string {
  const closed = closeRing(points);
  let out = '';
  for (let i = 0; i < closed.length - 1; i++) {
    out += line(layerName, closed[i], closed[i + 1]);
  }
  return out;
}

function circle(layerName: string, centre: Point2d, radius: number): string {
  return [
    dxfPair(0, 'CIRCLE'),
    dxfPair(8, layerName),
    dxfPair(10, centre.x.toFixed(3)),
    dxfPair(20, centre.y.toFixed(3)),
    dxfPair(30, 0),
    dxfPair(40, radius.toFixed(3)),
  ].join('');
}

function text(layerName: string, position: Point2d, height: number, value: string): string {
  return [
    dxfPair(0, 'TEXT'),
    dxfPair(8, layerName),
    dxfPair(10, position.x.toFixed(3)),
    dxfPair(20, position.y.toFixed(3)),
    dxfPair(30, 0),
    dxfPair(40, height.toFixed(3)),
    dxfPair(1, sanitiseText(value)),
    dxfPair(7, 'STANDARD'),
  ].join('');
}

function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();

  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

function slugify(value: string): string {
  return sanitiseText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function buildSiteContextDxf(site: SiteFeature, contextData?: SiteContextData): string {
  const [originLat, originLng] = getFeatureCentroid(site);
  const bounds = getFeatureBounds(site);
  const area = calculateFeatureArea(site);
  const rings = collectRings(site).map((ring) =>
    ring.map((position) => projectPosition(position, originLng, originLat))
  );
  const allPoints = rings.flat();

  const minX = Math.min(...allPoints.map((p) => p.x));
  const maxX = Math.max(...allPoints.map((p) => p.x));
  const minY = Math.min(...allPoints.map((p) => p.y));
  const maxY = Math.max(...allPoints.map((p) => p.y));
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const pad = Math.max(width, height) * 0.18;
  const labelHeight = Math.max(Math.min(Math.max(width, height) / 28, 8), 2.5);
  const context = [
    { x: minX - pad, y: minY - pad },
    { x: maxX + pad, y: minY - pad },
    { x: maxX + pad, y: maxY + pad },
    { x: minX - pad, y: maxY + pad },
  ];
  const titleX = minX - pad;
  const titleY = maxY + pad + labelHeight * 2.6;
  const scaleLength = Math.max(10, Math.round(Math.max(width, height) / 5 / 10) * 10);
  const scaleStart = { x: minX - pad, y: minY - pad - labelHeight * 3 };

  let entities = '';

  if (contextData) {
    for (const feature of contextData.buildings.features) {
      const coords = feature.geometry.type === 'Polygon'
        ? feature.geometry.coordinates
        : feature.geometry.coordinates.flatMap((p) => p);
      for (const ring of coords) {
        const pts = ring.map((pos) => projectPosition(pos, originLng, originLat));
        entities += lineLoop('ADJACENT_BUILDINGS', pts);
      }
    }

    for (const feature of contextData.roads.features) {
      const pts = feature.geometry.coordinates.map((pos) => projectPosition(pos, originLng, originLat));
      for (let i = 0; i < pts.length - 1; i++) {
        entities += line('ROADS', pts[i], pts[i + 1]);
      }
    }
  }

  rings.forEach((ring, index) => {
    entities += lineLoop(index === 0 ? 'SITE_BOUNDARY' : 'SITE_HOLES', ring);
  });

  entities += lineLoop('SITE_CONTEXT', context);
  entities += circle('SITE_CONTEXT', { x: 0, y: 0 }, Math.max(labelHeight * 0.7, 1.5));
  entities += line('SITE_CONTEXT', { x: maxX + pad * 0.65, y: maxY }, { x: maxX + pad * 0.65, y: maxY + pad * 0.55 });
  entities += line('SITE_CONTEXT', { x: maxX + pad * 0.65, y: maxY + pad * 0.55 }, { x: maxX + pad * 0.48, y: maxY + pad * 0.35 });
  entities += line('SITE_CONTEXT', { x: maxX + pad * 0.65, y: maxY + pad * 0.55 }, { x: maxX + pad * 0.82, y: maxY + pad * 0.35 });
  entities += text('SITE_LABELS', { x: maxX + pad * 0.48, y: maxY + pad * 0.6 }, labelHeight, 'N');
  entities += line('SITE_CONTEXT', scaleStart, { x: scaleStart.x + scaleLength, y: scaleStart.y });
  entities += line('SITE_CONTEXT', scaleStart, { x: scaleStart.x, y: scaleStart.y + labelHeight * 0.8 });
  entities += line('SITE_CONTEXT', { x: scaleStart.x + scaleLength, y: scaleStart.y }, { x: scaleStart.x + scaleLength, y: scaleStart.y + labelHeight * 0.8 });
  entities += text('SITE_LABELS', { x: scaleStart.x, y: scaleStart.y - labelHeight * 1.4 }, labelHeight, `${scaleLength} m`);
  entities += text('SITE_LABELS', { x: titleX, y: titleY }, labelHeight * 1.35, site.properties.name);
  entities += text('SITE_LABELS', { x: titleX, y: titleY - labelHeight * 1.8 }, labelHeight, `Borough: ${site.properties.borough}`);
  entities += text('SITE_LABELS', { x: titleX, y: titleY - labelHeight * 3.2 }, labelHeight, `Site area: ${formatArea(area)}`);
  entities += text('SITE_LABELS', { x: titleX, y: titleY - labelHeight * 4.6 }, labelHeight, `Current use: ${site.properties.current_use}`);
  entities += text('SITE_LABELS', { x: titleX, y: titleY - labelHeight * 6 }, labelHeight, `Planning: ${site.properties.planning_status}`);
  entities += text('SITE_LABELS', { x: titleX, y: titleY - labelHeight * 7.4 }, labelHeight * 0.85, `Approx local origin: ${originLat.toFixed(6)}, ${originLng.toFixed(6)}`);
  entities += text('SITE_LABELS', { x: titleX, y: titleY - labelHeight * 8.6 }, labelHeight * 0.85, `Bounds: W ${bounds.getWest().toFixed(6)} S ${bounds.getSouth().toFixed(6)} E ${bounds.getEast().toFixed(6)} N ${bounds.getNorth().toFixed(6)}`);

  const extMinX = (minX - pad).toFixed(3);
  const extMinY = (scaleStart.y - labelHeight * 2).toFixed(3);
  const extMaxX = (maxX + pad).toFixed(3);
  const extMaxY = titleY.toFixed(3);
  const viewCx = ((minX - pad + maxX + pad) / 2).toFixed(3);
  const viewCy = (((scaleStart.y - labelHeight * 2) + titleY) / 2).toFixed(3);
  const viewH = Math.max(titleY - (scaleStart.y - labelHeight * 2), 1).toFixed(3);

  return [
    dxfPair(0, 'SECTION'),
    dxfPair(2, 'HEADER'),
    dxfPair(9, '$ACADVER'),
    dxfPair(1, 'AC1009'),
    dxfPair(9, '$INSUNITS'),
    dxfPair(70, 6),
    dxfPair(9, '$EXTMIN'),
    dxfPair(10, extMinX),
    dxfPair(20, extMinY),
    dxfPair(30, 0),
    dxfPair(9, '$EXTMAX'),
    dxfPair(10, extMaxX),
    dxfPair(20, extMaxY),
    dxfPair(30, 0),
    dxfPair(9, '$LIMMIN'),
    dxfPair(10, extMinX),
    dxfPair(20, extMinY),
    dxfPair(9, '$LIMMAX'),
    dxfPair(10, extMaxX),
    dxfPair(20, extMaxY),
    dxfPair(0, 'ENDSEC'),
    dxfPair(0, 'SECTION'),
    dxfPair(2, 'TABLES'),
    dxfPair(0, 'TABLE'),
    dxfPair(2, 'LTYPE'),
    dxfPair(70, 1),
    dxfPair(0, 'LTYPE'),
    dxfPair(2, 'CONTINUOUS'),
    dxfPair(70, 0),
    dxfPair(3, 'Solid line'),
    dxfPair(72, 65),
    dxfPair(73, 0),
    dxfPair(40, 0.0),
    dxfPair(0, 'ENDTAB'),
    dxfPair(0, 'TABLE'),
    dxfPair(2, 'LAYER'),
    dxfPair(70, 6),
    layer('SITE_BOUNDARY', 1),
    layer('SITE_HOLES', 6),
    layer('SITE_CONTEXT', 8),
    layer('SITE_LABELS', 7),
    layer('ADJACENT_BUILDINGS', 253),
    layer('ROADS', 3),
    dxfPair(0, 'ENDTAB'),
    dxfPair(0, 'TABLE'),
    dxfPair(2, 'STYLE'),
    dxfPair(70, 1),
    dxfPair(0, 'STYLE'),
    dxfPair(2, 'STANDARD'),
    dxfPair(70, 0),
    dxfPair(40, 0.0),
    dxfPair(41, 1.0),
    dxfPair(50, 0.0),
    dxfPair(71, 0),
    dxfPair(42, 0.2),
    dxfPair(3, 'txt'),
    dxfPair(4, ''),
    dxfPair(0, 'ENDTAB'),
    dxfPair(0, 'TABLE'),
    dxfPair(2, 'VPORT'),
    dxfPair(70, 1),
    dxfPair(0, 'VPORT'),
    dxfPair(2, '*ACTIVE'),
    dxfPair(70, 0),
    dxfPair(10, 0.0),
    dxfPair(20, 0.0),
    dxfPair(11, 1.0),
    dxfPair(21, 1.0),
    dxfPair(12, viewCx),
    dxfPair(22, viewCy),
    dxfPair(13, 0.0),
    dxfPair(23, 0.0),
    dxfPair(14, 1.0),
    dxfPair(24, 1.0),
    dxfPair(15, 1.0),
    dxfPair(25, 1.0),
    dxfPair(16, 0.0),
    dxfPair(26, 0.0),
    dxfPair(36, 1.0),
    dxfPair(17, 0.0),
    dxfPair(27, 0.0),
    dxfPair(37, 0.0),
    dxfPair(40, viewH),
    dxfPair(41, 1.0),
    dxfPair(42, 50.0),
    dxfPair(43, 0.0),
    dxfPair(44, 0.0),
    dxfPair(50, 0.0),
    dxfPair(51, 0.0),
    dxfPair(71, 0),
    dxfPair(72, 1000),
    dxfPair(73, 1),
    dxfPair(74, 3),
    dxfPair(75, 0),
    dxfPair(76, 0),
    dxfPair(77, 0),
    dxfPair(78, 0),
    dxfPair(0, 'ENDTAB'),
    dxfPair(0, 'ENDSEC'),
    dxfPair(0, 'SECTION'),
    dxfPair(2, 'ENTITIES'),
    entities,
    dxfPair(0, 'ENDSEC'),
    dxfPair(0, 'EOF'),
  ].join('');
}

export function downloadSiteContextDxf(site: SiteFeature, contextData?: SiteContextData): void {
  const filename = `${slugify(site.properties.name || site.properties.id) || 'site'}-context.dxf`;
  downloadTextFile(filename, buildSiteContextDxf(site, contextData), 'application/dxf');
}
