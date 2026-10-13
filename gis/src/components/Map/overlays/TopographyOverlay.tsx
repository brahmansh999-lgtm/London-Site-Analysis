import React from 'react';
import { Polyline, CircleMarker, Tooltip } from 'react-leaflet';
import type { LatLngTuple, LatLngBounds } from 'leaflet';

interface Props { centre: LatLngTuple; bounds: LatLngBounds; }

export const TopographyOverlay: React.FC<Props> = ({ centre, bounds }) => {
  const [lat, lng] = centre;
  // Scale contour radii to the site's own footprint so the rings always
  // wrap the boundary, regardless of how large or small the site is.
  const halfLat = (bounds.getNorth() - bounds.getSouth()) / 2;
  const baseRadius = halfLat / 0.65; // undo the 0.65 lat compression below
  const contours = [0.4, 0.8, 1.3, 1.9].map((mult, idx) => {
    const radius = baseRadius * mult;
    const pts: LatLngTuple[] = [];
    const skew = halfLat * 0.05 * idx;
    for (let a = 0; a <= 360; a += 10) {
      const r = (a * Math.PI) / 180;
      pts.push([lat + Math.sin(r) * radius * 0.65 + skew, lng + Math.cos(r) * radius * 1.3]);
    }
    return { pts, label: `+${(idx + 1) * 2}m AOD` };
  });
  const spotOffset = halfLat * 1.0;
  const spots: { pos: LatLngTuple; h: string }[] = [
    { pos: [lat + spotOffset * 0.5,  lng + spotOffset * 0.25], h: '8.4 m' },
    { pos: [lat - spotOffset * 0.25, lng - spotOffset * 0.5],  h: '6.1 m' },
    { pos: [lat + spotOffset * 0.25, lng - spotOffset * 0.75], h: '5.3 m' },
  ];

  return (
    <>
      {contours.map(({ pts, label }, i) => (
        <Polyline key={`c-${i}`} positions={pts} pathOptions={{ color: '#7a9e6e', weight: 1, opacity: 0.4 + i * 0.12, dashArray: '3 4' }}>
          <Tooltip direction="top"><span style={{ fontFamily: 'DM Mono', fontSize: 10, color: '#7a9e6e' }}>{label}</span></Tooltip>
        </Polyline>
      ))}
      {spots.map(({ pos, h }, i) => (
        <CircleMarker key={`s-${i}`} center={pos} radius={4} pathOptions={{ color: '#7a9e6e', fillColor: '#fff', fillOpacity: 1, weight: 1.5 }}>
          <Tooltip permanent direction="right"><span style={{ fontFamily: 'DM Mono', fontSize: 10, color: '#7a9e6e' }}>▲ {h}</span></Tooltip>
        </CircleMarker>
      ))}
    </>
  );
};
