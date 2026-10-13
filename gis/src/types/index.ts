import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';

export interface SiteProperties {
  id: string;
  name: string;
  borough: string;
  area_sqm: number;
  description: string;
  current_use: string;
  planning_status: string;
}

export type SiteFeature = Feature<Polygon | MultiPolygon, SiteProperties>;
export type SiteFeatureCollection = FeatureCollection<Polygon | MultiPolygon, SiteProperties>;

export type AppStep = 1 | 2 | 3;

export type CoreAnalysisOverlay =
  | 'sun'
  | 'wind'
  | 'topography'
  | 'context'
  | 'circulation'
  | 'noise';

export type UrbanStrategyOverlay =
  | 'building_heights'
  | 'linkages'
  | 'landmarks'
  | 'developable';

export type OverlayId = CoreAnalysisOverlay | UrbanStrategyOverlay;

export interface OverlayMeta {
  id: OverlayId;
  label: string;
  colour: string;
  description: string;
}
