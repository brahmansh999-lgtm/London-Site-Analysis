import React from 'react';
import { CircleMarker, Tooltip } from 'react-leaflet';
import type { LatLngTuple } from 'leaflet';
import type { Point } from 'geojson';
import type {
  LandmarkFeatureCollection,
  OsmLandmarkProperties,
} from '../../../utils/geoUtils';

interface Props {
  landmarks: LandmarkFeatureCollection | null;
  siteId:    string;
}

export const LandmarksOverlay: React.FC<Props> = ({ landmarks, siteId }) => {
  if (!landmarks || landmarks.features.length === 0) return null;

  return (
    <>
      {landmarks.features.map((f) => {
        const p   = f.properties as OsmLandmarkProperties;
        const gPt = f.geometry as Point;

        if (
          !Array.isArray(gPt.coordinates) ||
          typeof gPt.coordinates[0] !== 'number'
        )
          return null;

        const pos: LatLngTuple = [gPt.coordinates[1], gPt.coordinates[0]];
        const radius           = 4 + p.importance * 3;

        return (
          <CircleMarker
            key={`lm-${siteId}-${p.osmId}`}
            center={pos}
            radius={radius}
            pathOptions={{
              color:       p.colour,
              fillColor:   p.colour,
              fillOpacity: 0.82,
              weight:      2,
            }}
          >
            <Tooltip permanent direction="top">
              <div style={{ fontFamily: 'DM Mono', lineHeight: 1.5 }}>
                <div style={{ fontSize: 11, color: p.colour, fontWeight: 700 }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 10, color: '#e0ddd8' }}>
                  {p.category}
                </div>
                {p.subcategory && (
                  <div style={{ fontSize: 9, color: '#9a9590' }}>
                    {p.subcategory}
                  </div>
                )}
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
};