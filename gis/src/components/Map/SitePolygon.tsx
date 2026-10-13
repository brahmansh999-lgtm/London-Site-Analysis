import React, { useMemo } from 'react';
import { Polygon, Tooltip } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import type { Position } from 'geojson';
import type { SiteFeature } from '../../types';
import {
  calculateFeatureArea,
  calculateFeatureDimensions,
  formatArea,
  formatDimensions,
  classifySiteSize,
  SITE_SIZE_COLOURS,
} from '../../utils/geoUtils';

interface Props { feature: SiteFeature; isSelected: boolean; onClick: (f: SiteFeature) => void; }

function toLatLng(coords: Position[][]): LatLngExpression[][] {
  return coords.map((ring) => ring.map((c) => [c[1], c[0]] as LatLngExpression));
}

export const SitePolygon: React.FC<Props> = ({ feature, isSelected, onClick }) => {
  const { geometry, properties } = feature;

  const area       = useMemo(() => calculateFeatureArea(feature), [feature]);
  const dimensions = useMemo(() => calculateFeatureDimensions(feature), [feature]);
  const sizeCategory = useMemo(() => classifySiteSize(area), [area]);
  const categoryColour = SITE_SIZE_COLOURS[sizeCategory];

  const style = isSelected
    ? { weight: 4, color: '#ff6b35', fillColor: '#ff6b35', fillOpacity: 0.18, opacity: 1 }
    : { weight: 3, color: categoryColour, fillColor: categoryColour, fillOpacity: 0.15, opacity: 0.9, dashArray: '1' };

  const handleClick = () => onClick(feature);

  const tooltipContent = (
    <span style={{ fontFamily: 'DM Mono', fontSize: 12 }}>
      <strong>{properties.name}</strong>
      <br />
      {sizeCategory} — {formatArea(area)}
      <br />
      {formatDimensions(dimensions)}
    </span>
  );

  if (geometry.type === 'Polygon') {
    return (
      <Polygon key={`${properties.id}-p`} positions={toLatLng(geometry.coordinates)} pathOptions={style} eventHandlers={{ click: handleClick }}>
        <Tooltip sticky offset={[10, 0]}>{tooltipContent}</Tooltip>
      </Polygon>
    );
  }
  return (
    <>
      {geometry.coordinates.map((poly, i) => (
        <Polygon key={`${properties.id}-mp-${i}`} positions={toLatLng(poly)} pathOptions={style} eventHandlers={{ click: handleClick }}>
          {i === 0 && <Tooltip sticky offset={[10, 0]}>{tooltipContent}</Tooltip>}
        </Polygon>
      ))}
    </>
  );
};
