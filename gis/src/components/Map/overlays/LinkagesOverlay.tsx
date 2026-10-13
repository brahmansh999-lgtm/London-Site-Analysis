import React from 'react';
import { Polyline, CircleMarker, Tooltip } from 'react-leaflet';
import type { LatLngTuple } from 'leaflet';
import type { LinkageLine } from '../../../utils/geoUtils';

interface Props {
  linkageLines: LinkageLine[];
  centre:       LatLngTuple;
  siteId:       string;
}

export const LinkagesOverlay: React.FC<Props> = ({
  linkageLines,
  centre,
  siteId,
}) => {
  if (linkageLines.length === 0) return null;

  return (
    <>
      {linkageLines.map((l, i) => (
        <React.Fragment key={`lnk-${siteId}-${i}`}>
          <Polyline
            positions={[l.from, l.to]}
            pathOptions={{
              color:     l.colour,
              weight:    2,
              opacity:   0.75,
              dashArray: '8 6',
            }}
          >
            <Tooltip direction="top" sticky>
              <div style={{ fontFamily: 'DM Mono', lineHeight: 1.5 }}>
                <div style={{ fontSize: 11, color: l.colour, fontWeight: 700 }}>
                  {l.name}
                </div>
                <div style={{ fontSize: 10, color: '#e0ddd8' }}>
                  {l.category}
                </div>
                <div style={{ fontSize: 9, color: '#9a9590' }}>
                  {l.distanceM} m from site
                </div>
              </div>
            </Tooltip>
          </Polyline>

          <CircleMarker
            center={l.to}
            radius={6}
            pathOptions={{
              color:       l.colour,
              fillColor:   l.colour,
              fillOpacity: 0.85,
              weight:      2,
            }}
          >
            <Tooltip permanent direction="top">
              <div style={{ fontFamily: 'DM Mono', lineHeight: 1.4 }}>
                <div style={{ fontSize: 11, color: l.colour, fontWeight: 700 }}>
                  {l.name}
                </div>
                <div style={{ fontSize: 9, color: '#9a9590' }}>
                  {l.distanceM} m
                </div>
              </div>
            </Tooltip>
          </CircleMarker>
        </React.Fragment>
      ))}

      <CircleMarker
        center={centre}
        radius={5}
        pathOptions={{
          color:       '#38a878',
          fillColor:   '#38a878',
          fillOpacity: 1,
          weight:      2,
        }}
      >
        <Tooltip direction="top">
          <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: '#38a878' }}>
            Site centroid
          </span>
        </Tooltip>
      </CircleMarker>
    </>
  );
};