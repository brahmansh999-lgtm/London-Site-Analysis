import React from 'react';
import { GeoJSON } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import type { Feature, Geometry } from 'geojson';
import type {
  BuildingFeatureCollection,
  OsmBuildingProperties,
} from '../../../utils/geoUtils';

interface Props {
  osmBuildings: BuildingFeatureCollection | null;
}

function levelsToColour(levels: number | undefined): string {
  if (levels === undefined) return '#888888';
  if (levels <= 3)  return '#cfe0f8';
  if (levels <= 6)  return '#90b8f0';
  if (levels <= 10) return '#5090e0';
  if (levels <= 15) return '#2060c0';
  return '#103080';
}

// Module-level so the style prop keeps a stable identity: react-leaflet
// re-runs setStyle() over every feature whenever it changes.
const heightStyle = (f?: Feature<Geometry>): PathOptions => {
  const lvl = (f?.properties as OsmBuildingProperties | undefined)?.levels;
  return {
    color:       '#3878c8',
    weight:      1,
    opacity:     0.9,
    fillColor:   levelsToColour(lvl),
    fillOpacity: Math.min(0.3 + (lvl ?? 1) * 0.04, 0.9),
  };
};

export const BuildingHeightsOverlay: React.FC<Props> = ({ osmBuildings }) => {
  if (!osmBuildings || osmBuildings.features.length === 0) return null;

  return (
    <GeoJSON
      key={`bh-${osmBuildings.features.length}`}
      data={osmBuildings}
      style={heightStyle}
      onEachFeature={(f: Feature<Geometry>, layer) => {
        const p     = f.properties as OsmBuildingProperties;
        const parts = [
          p.levels ? `<strong>${p.levels} storeys</strong>` : '<strong>Height unknown</strong>',
          p.name   ? p.name                                 : null,
          p.height ? `${p.height.toFixed(1)} m`             : null,
        ].filter(Boolean);
        layer.bindTooltip(parts.join('<br/>'), {
          className: 'osm-tooltip',
          direction: 'top',
          sticky:    true,
        });
      }}
    />
  );
};