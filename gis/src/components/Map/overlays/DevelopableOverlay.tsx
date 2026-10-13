import React, { useMemo } from 'react';
import { Polygon as LPolygon, Tooltip } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import type { Position } from 'geojson';
import type { SiteFeature } from '../../../types';
import {
  calculateSetbackScenarios,
  calculateFeatureArea,
  formatArea,
  type SetbackScenario,
} from '../../../utils/geoUtils';
import type { Polygon as GP, MultiPolygon as GMP } from 'geojson';

interface Props { selectedSite: SiteFeature; }

function ring2ll(ring: Position[]): LatLngExpression[] {
  return ring.map(([lon, lat]) => [lat, lon] as LatLngExpression);
}

function scenarioPos(s: SetbackScenario): LatLngExpression[][] | null {
  try {
    const g = s.feature.geometry;
    if (g.type === 'Polygon') {
      const p = g as GP;
      if (!p.coordinates[0] || p.coordinates[0].length < 4) return null;
      return p.coordinates.map(ring2ll);
    }
    const m   = g as GMP;
    const out: LatLngExpression[][] = [];
    for (const poly of m.coordinates) {
      if (poly[0] && poly[0].length >= 4) out.push(ring2ll(poly[0]));
    }
    return out.length ? out : null;
  } catch { return null; }
}

function sitePos(site: SiteFeature): LatLngExpression[][] {
  const g = site.geometry;
  if (g.type === 'Polygon') return g.coordinates.map(ring2ll);
  return g.coordinates.map((p) => ring2ll(p[0]));
}

export const DevelopableOverlay: React.FC<Props> = ({ selectedSite }) => {
  // useMemo recomputes automatically when selectedSite changes — no manual
  // state reset needed because Turf.js is synchronous.
  const scenarios = useMemo(
    () => calculateSetbackScenarios(selectedSite),
    [selectedSite]
  );
  const sitePts  = useMemo(() => sitePos(selectedSite),            [selectedSite]);
  const siteArea = useMemo(() => calculateFeatureArea(selectedSite), [selectedSite]);

  return (
    <>
      {/* Site boundary reference */}
      <LPolygon
        positions={sitePts}
        pathOptions={{
          color:       '#c8522a',
          weight:      2.5,
          opacity:     1,
          fillColor:   'transparent',
          fillOpacity: 0,
          dashArray:   '6 4',
        }}
      >
        <Tooltip direction="top">
          <div style={{ fontFamily: 'DM Mono', lineHeight: 1.5 }}>
            <div style={{ fontSize: 11, color: '#c8522a', fontWeight: 700 }}>
              Site boundary
            </div>
            <div style={{ fontSize: 9, color: '#9a9590' }}>
              {formatArea(siteArea)}
            </div>
          </div>
        </Tooltip>
      </LPolygon>

      {/* Setback polygons */}
      {scenarios.map((s, i) => {
        const pos = scenarioPos(s);
        if (!pos) return null;
        return (
          <LPolygon
            key={`sb-${i}-${selectedSite.properties.id}`}
            positions={pos}
            pathOptions={{
              color:       s.colour,
              weight:      1.5,
              opacity:     1,
              fillColor:   s.colour,
              fillOpacity: 0.2 + i * 0.06,
              dashArray:   i === 0 ? undefined : '6 4',
            }}
          >
            <Tooltip permanent direction="top">
              <div style={{ fontFamily: 'DM Mono', lineHeight: 1.6, maxWidth: 220 }}>
                <div style={{ fontSize: 12, color: s.colour, fontWeight: 700 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 10, color: '#e0ddd8' }}>
                  Buildable: {formatArea(s.areaSqm)}
                </div>
                <div style={{ fontSize: 9, color: '#9a9590' }}>
                  Turf.js negative buffer
                </div>
              </div>
            </Tooltip>
          </LPolygon>
        );
      })}

      {/* Empty state */}
      {scenarios.length === 0 && (
        <LPolygon
          positions={sitePts}
          pathOptions={{
            color:       '#c8522a',
            weight:      2,
            fillColor:   '#c8522a',
            fillOpacity: 0.05,
            dashArray:   '4 4',
          }}
        >
          <Tooltip permanent direction="top">
            <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: '#c8522a' }}>
              Site too small for setback
            </span>
          </Tooltip>
        </LPolygon>
      )}
    </>
  );
};