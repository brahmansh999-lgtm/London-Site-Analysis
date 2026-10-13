import React from 'react';
import { GeoJSON, CircleMarker, Tooltip } from 'react-leaflet';
import type { PathOptions, LatLngTuple } from 'leaflet';
import type { Feature, Geometry } from 'geojson';
import {
  getRoadStyle,
  type RoadFeatureCollection,
  type OsmRoadProperties,
  type AccessPoint,
} from '../../../utils/geoUtils';

interface Props {
  roads:        RoadFeatureCollection | null;
  accessPoints: AccessPoint[];
  siteId:       string;
}

const AP_COLOUR: Record<string, string> = {
  primary:     '#e8c038',
  secondary:   '#a0c858',
  tertiary:    '#70b8d8',
  residential: '#90b8c8',
};

// Module-level so the style prop keeps a stable identity: react-leaflet
// re-runs setStyle() over every feature whenever it changes.
const circulationStyle = (f?: Feature<Geometry>): PathOptions => {
  const s = getRoadStyle(
    (f?.properties as OsmRoadProperties | undefined)?.highway ?? ''
  );
  return { color: s.colour, weight: s.weight, opacity: 0.9 };
};

export const CirculationOverlay: React.FC<Props> = ({
  roads,
  accessPoints,
  siteId,
}) => {
  if (!roads || roads.features.length === 0) return null;

  return (
    <>
      <GeoJSON
        key={`circ-${siteId}-${roads.features.length}`}
        data={roads}
        style={circulationStyle}
        onEachFeature={(f: Feature<Geometry>, layer) => {
          const p     = f.properties as OsmRoadProperties;
          const s     = getRoadStyle(p.highway);
          const parts = [
            p.name     ? `<strong>${p.name}</strong>` : `<em>${s.label}</em>`,
            p.maxspeed ? `Speed: ${p.maxspeed}`       : null,
            p.surface  ? `Surface: ${p.surface}`      : null,
          ].filter(Boolean);
          layer.bindTooltip(parts.join('<br/>'), {
            className: 'osm-tooltip',
            direction: 'top',
            sticky:    true,
          });
        }}
      />

      {accessPoints.map((ap, i) => {
        const colour = AP_COLOUR[ap.highway] ?? '#ffffff';
        return (
          <React.Fragment key={`ap-${siteId}-${i}`}>
            <CircleMarker
              center={ap.position as LatLngTuple}
              radius={11}
              pathOptions={{
                color:       '#ffffff',
                fillColor:   '#ffffff',
                fillOpacity: 0.2,
                weight:      2,
                opacity:     0.5,
              }}
            />
            <CircleMarker
              center={ap.position as LatLngTuple}
              radius={6}
              pathOptions={{
                color:       colour,
                fillColor:   colour,
                fillOpacity: 1,
                weight:      2.5,
              }}
            >
              <Tooltip permanent direction="top">
                <div style={{ fontFamily: 'DM Mono', lineHeight: 1.4 }}>
                  <div style={{ fontSize: 11, color: colour, fontWeight: 700 }}>
                    Site access point
                  </div>
                  <div style={{ fontSize: 9, color: '#9a9590' }}>
                    {ap.roadName}
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          </React.Fragment>
        );
      })}
    </>
  );
};