import React from 'react';
import { Polyline, CircleMarker, Tooltip } from 'react-leaflet';
import type { LatLngTuple, LatLngBounds } from 'leaflet';

interface Props { centre: LatLngTuple; bounds: LatLngBounds; }

export const SunPathOverlay: React.FC<Props> = ({ centre, bounds }) => {
  const [lat, lng] = centre;
  // Scale the arc to the site's own footprint so it always spans the
  // boundary, regardless of how large or small the selected site is.
  const halfLat = (bounds.getNorth() - bounds.getSouth()) / 2;
  const halfLng = (bounds.getEast()  - bounds.getWest())  / 2;
  const Olat = halfLat * 1.15;
  const Olng = halfLng * 1.15;
  const buildArc = (h: number): LatLngTuple[] =>
    Array.from({ length: 13 }, (_, i) => {
      const t = i / 12;
      const x = (t - 0.5) * 2;
      return [lat + h * (1 - x * x) * Olat, lng + x * Olng] as LatLngTuple;
    });

  const summer  = buildArc(1.2);
  const equinox = buildArc(0.75);
  const winter  = buildArc(0.35);

  return (
    <>
      <Polyline positions={winter}  pathOptions={{ color: '#f4d080', weight: 1.5, dashArray: '4 5', opacity: 0.7 }}>
        <Tooltip direction="bottom"><span style={{ fontFamily: 'DM Mono', fontSize: 10, color: '#f4d080' }}>Winter solstice</span></Tooltip>
      </Polyline>
      <Polyline positions={equinox} pathOptions={{ color: '#e8a838', weight: 2, opacity: 0.9 }}>
        <Tooltip direction="top"><span style={{ fontFamily: 'DM Mono', fontSize: 10, color: '#e8a838' }}>Equinox</span></Tooltip>
      </Polyline>
      <Polyline positions={summer}  pathOptions={{ color: '#e8c838', weight: 2, dashArray: '8 4', opacity: 0.85 }}>
        <Tooltip direction="top"><span style={{ fontFamily: 'DM Mono', fontSize: 10, color: '#e8c838' }}>Summer solstice</span></Tooltip>
      </Polyline>
      <CircleMarker center={equinox[0]}  radius={6} pathOptions={{ color: '#e8a838', fillColor: '#fff', fillOpacity: 1, weight: 2 }}>
        <Tooltip permanent direction="left"><span style={{ fontFamily: 'DM Mono', fontSize: 10 }}>Sunrise ↗ E</span></Tooltip>
      </CircleMarker>
      <CircleMarker center={equinox[6]}  radius={8} pathOptions={{ color: '#e8a838', fillColor: '#e8a838', fillOpacity: 1, weight: 2 }}>
        <Tooltip permanent direction="top"><span style={{ fontFamily: 'DM Mono', fontSize: 10 }}>Solar noon ↑ S</span></Tooltip>
      </CircleMarker>
      <CircleMarker center={equinox[12]} radius={6} pathOptions={{ color: '#e8a838', fillColor: '#fff', fillOpacity: 1, weight: 2 }}>
        <Tooltip permanent direction="right"><span style={{ fontFamily: 'DM Mono', fontSize: 10 }}>Sunset ↘ W</span></Tooltip>
      </CircleMarker>
    </>
  );
};
