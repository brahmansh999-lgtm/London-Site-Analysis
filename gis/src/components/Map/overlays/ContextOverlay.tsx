import React from 'react';
import { GeoJSON } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import type { Feature, Geometry } from 'geojson';
import type {
  BuildingFeatureCollection,
  OsmBuildingProperties,
} from '../../../utils/geoUtils';

/**
 * ContextOverlay — "dumb" rendering component.
 *
 * This component contains NO useEffect hooks, NO Overpass API calls,
 * and NO internal loading state. It receives pre-fetched building data
 * directly as a prop from the parent (SiteMap → OsmBaseLayer or the
 * useSiteAnalysisData hook) and focuses purely on rendering.
 *
 * This is the canonical pattern all overlays should follow.
 */
interface Props {
  /** Pre-fetched building footprint data from useSiteAnalysisData */
  buildings: BuildingFeatureCollection | null;
  /** Stable key to force GeoJSON re-render when the site changes */
  siteId:    string;
}

// Module-level so the style prop keeps a stable identity: react-leaflet
// re-runs setStyle() over every feature whenever it changes.
const contextStyle = (): PathOptions => ({
  color:       '#9e8e7a',
  weight:      1.5,
  opacity:     0.9,
  fillColor:   '#9e8e7a',
  fillOpacity: 0.25,
  dashArray:   '4 3',
});

export const ContextOverlay: React.FC<Props> = ({ buildings, siteId }) => {
  if (!buildings || buildings.features.length === 0) return null;

  return (
    <GeoJSON
      // Key forces react-leaflet to remount the layer when the site changes,
      // preventing stale geometry from the previous site being displayed.
      key={`ctx-${siteId}-${buildings.features.length}`}
      data={buildings}
      style={contextStyle}
      onEachFeature={(f: Feature<Geometry>, layer) => {
        const p = f.properties as OsmBuildingProperties;

        const parts: string[] = [];
        if (p.name)         parts.push(`<strong>${p.name}</strong>`);
        if (p.buildingType) parts.push(`Type: ${p.buildingType}`);
        if (p.levels)       parts.push(`Floors: ${p.levels}`);
        if (p.height)       parts.push(`Height: ${p.height.toFixed(1)} m`);
        if (!parts.length)  parts.push('<em>Building</em>');

        layer.bindTooltip(parts.join('<br/>'), {
          className: 'osm-tooltip',
          direction: 'top',
          sticky:    true,
        });
      }}
    />
  );
};