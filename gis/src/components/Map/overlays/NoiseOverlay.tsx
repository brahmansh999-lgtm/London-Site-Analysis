import React from 'react';
import { GeoJSON } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import type { Feature, Geometry } from 'geojson';
import type {
  NoiseZoneCollection,
  NoiseZoneProperties,
} from '../../../utils/geoUtils';

interface Props {
  noiseZones: NoiseZoneCollection | null;
  siteId:     string;
}

// Module-level so the style prop keeps a stable identity: react-leaflet
// re-runs setStyle() over every feature whenever it changes.
const noiseStyle = (f?: Feature<Geometry>): PathOptions => {
  const p = f?.properties as NoiseZoneProperties | undefined;
  return {
    color:       p?.colour ?? '#ff2020',
    weight:      0.25,
    opacity:     0.35,
    fillColor:   p?.colour ?? '#ff2020',
    fillOpacity: p?.opacity ?? 0.2,
  };
};

export const NoiseOverlay: React.FC<Props> = ({ noiseZones, siteId }) => {
  if (!noiseZones || noiseZones.features.length === 0) return null;

  return (
    <GeoJSON
      key={`noise-${siteId}-${noiseZones.features.length}`}
      data={noiseZones}
      style={noiseStyle}
      onEachFeature={(f: Feature<Geometry>, layer) => {
        const p   = f.properties as NoiseZoneProperties;
        const lbl =
          p.noiseLevel === 'severe'   ? 'Severe — 0–15 m'    :
          p.noiseLevel === 'moderate' ? 'Moderate — 15–35 m' :
          'Low — 35–65 m';
        layer.bindTooltip(
          `<strong style="color:${p.colour}">${lbl}</strong>`,
          { className: 'osm-tooltip', direction: 'top', sticky: true }
        );
      }}
    />
  );
};