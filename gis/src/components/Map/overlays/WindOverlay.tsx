import React from 'react';
import { Polyline, CircleMarker, Tooltip } from 'react-leaflet';
import type { LatLngTuple } from 'leaflet';

interface Props { centre: LatLngTuple; }

// Builds a wavy streamline from `from` to `to`, oscillating across the
// perpendicular axis so it reads as flowing air rather than a straight vector.
function buildWavyPath(from: LatLngTuple, to: LatLngTuple, amplitude: number, cycles: number, segments = 24): LatLngTuple[] {
  const [lat0, lng0] = from;
  const [lat1, lng1] = to;
  const dLat = lat1 - lat0;
  const dLng = lng1 - lng0;
  const len = Math.hypot(dLat, dLng) || 1;
  // Perpendicular unit vector for the oscillation.
  const pLat = -dLng / len;
  const pLng = dLat / len;

  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = i / segments;
    const wave = Math.sin(t * Math.PI * cycles) * amplitude * Math.sin(t * Math.PI);
    return [
      lat0 + dLat * t + pLat * wave,
      lng0 + dLng * t + pLng * wave,
    ] as LatLngTuple;
  });
}

// Small chevron arrowhead pointing along the path's final heading.
function buildArrowhead(tip: LatLngTuple, prev: LatLngTuple, size: number): LatLngTuple[] {
  const [lat0, lng0] = prev;
  const [lat1, lng1] = tip;
  const dLat = lat1 - lat0;
  const dLng = lng1 - lng0;
  const len = Math.hypot(dLat, dLng) || 1;
  const uLat = dLat / len;
  const uLng = dLng / len;
  const pLat = -uLng;
  const pLng = uLat;
  const backLat = lat1 - uLat * size;
  const backLng = lng1 - uLng * size;
  return [
    [backLat + pLat * size * 0.55, backLng + pLng * size * 0.55],
    tip,
    [backLat - pLat * size * 0.55, backLng - pLng * size * 0.55],
  ];
}

export const WindOverlay: React.FC<Props> = ({ centre }) => {
  const [lat, lng] = centre;
  const O = 0.0015;
  const streams: { from: LatLngTuple; to: LatLngTuple; amplitude: number; cycles: number; label: string; colour: string; weight: number }[] = [
    { from: [lat - O * 1.6, lng - O * 2.2], to: [lat + O * 1.0, lng + O * 1.0], amplitude: O * 0.22, cycles: 3, label: 'SW Prevailing — 12–18 mph', colour: '#5ba3c9', weight: 2.5 },
    { from: [lat - O * 2.0, lng - O * 0.9], to: [lat + O * 0.6, lng + O * 1.1], amplitude: O * 0.18, cycles: 3.5, label: 'W Secondary — 8–12 mph', colour: '#7ab8d4', weight: 2 },
    { from: [lat - O * 2.2, lng + O * 0.2], to: [lat + O * 0.4, lng + O * 1.6], amplitude: O * 0.14, cycles: 4, label: 'NW Tertiary — 5–8 mph', colour: '#a0cce0', weight: 1.5 },
  ];

  return (
    <>
      {streams.map((s, i) => {
        const path = buildWavyPath(s.from, s.to, s.amplitude, s.cycles);
        const tip = path[path.length - 1];
        const prev = path[path.length - 4];
        const arrow = buildArrowhead(tip, prev, O * 0.1);
        return (
          <React.Fragment key={`w-${i}`}>
            <Polyline positions={path} pathOptions={{ color: s.colour, weight: s.weight, opacity: 0.8, lineCap: 'round' }} />
            <Polyline positions={arrow} pathOptions={{ color: s.colour, weight: s.weight, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }} />
            <CircleMarker center={tip} radius={2} pathOptions={{ color: s.colour, fillColor: s.colour, fillOpacity: 0.9, weight: 1 }}>
              <Tooltip direction="left"><span style={{ fontFamily: 'DM Mono', fontSize: 10, color: s.colour }}>{s.label}</span></Tooltip>
            </CircleMarker>
          </React.Fragment>
        );
      })}
    </>
  );
};
