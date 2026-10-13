import React, { useEffect, useCallback, useState, useMemo } from 'react';
import { MapContainer, TileLayer, useMap, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import type { PathOptions, LatLngTuple } from 'leaflet';
import type { Feature, Geometry } from 'geojson';
import type {
  CoreAnalysisOverlay,
  UrbanStrategyOverlay,
  AppStep,
  SiteFeature,
} from '../../types';
import {
  getFeatureBounds,
  padBounds,
  getRoadStyle,
  buildNoiseZones,
  findAccessPoints,
  buildLinkageLinesFromLandmarks,
  type OsmBuildingProperties,
  type OsmRoadProperties,
} from '../../utils/geoUtils';
import { useSiteAnalysisData } from '../../hooks/useSiteAnalysisData';
import { SitePolygon } from './SitePolygon';

import { SunPathOverlay }         from './overlays/SunPathOverlay';
import { WindOverlay }            from './overlays/WindOverlay';
import { TopographyOverlay }      from './overlays/TopographyOverlay';
import { ContextOverlay }         from './overlays/ContextOverlay';
import { CirculationOverlay }     from './overlays/CirculationOverlay';
import { NoiseOverlay }           from './overlays/NoiseOverlay';
import { BuildingHeightsOverlay } from './overlays/BuildingHeightsOverlay';
import { LinkagesOverlay }        from './overlays/LinkagesOverlay';
import { LandmarksOverlay }       from './overlays/LandmarksOverlay';
import { DevelopableOverlay }     from './overlays/DevelopableOverlay';

const DEFAULT_LAT  = 51.505;
const DEFAULT_LNG  = -0.09;
const DEFAULT_ZOOM = 12;

// ─── Tile layers ──────────────────────────────────────────────────────────────

const TILE_OSM = {
  url:         'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  sub:         'abc',
  filter:      'grayscale(40%) contrast(0.9) brightness(1.05)',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

// CARTO basemaps now require an API key, so the dark theme reuses the keyless
// OSM tiles and darkens them with a CSS filter instead.
const TILE_DARK = {
  url:         'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  sub:         'abc',
  filter:      'invert(1) hue-rotate(180deg) grayscale(100%) brightness(0.85) contrast(0.9)',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

const DynamicTileLayer: React.FC<{ step: AppStep }> = ({ step }) => {
  const map = useMap();
  const cfg = step === 1 ? TILE_OSM : TILE_DARK;

  useEffect(() => {
    const pane = map.getPane('tilePane');
    if (pane) {
      pane.style.filter     = cfg.filter;
      pane.style.transition = 'filter 0.6s ease';
    }
  }, [map, cfg.filter]);

  return (
    <TileLayer
      key={step === 1 ? 'osm' : 'dark'}
      url={cfg.url}
      attribution={cfg.attribution}
      maxZoom={19}
      subdomains={cfg.sub}
    />
  );
};

// ─── Map camera controller ────────────────────────────────────────────────────

const MapCamera: React.FC<{ site: SiteFeature | null; step: AppStep }> = ({
  site,
  step,
}) => {
  const map = useMap();

  useEffect(() => {
    if (!site) {
      map.setView(L.latLng(DEFAULT_LAT, DEFAULT_LNG), DEFAULT_ZOOM, {
        animate: true,
      });
      return;
    }
    const bounds   = getFeatureBounds(site);
    const padded   = padBounds(bounds, step === 3 ? 1.4 : 0.6);
    const rightPad = step >= 2 ? 300 : 50;
    map.fitBounds(padded, {
      paddingTopLeft:     L.point(50, 50),
      paddingBottomRight: L.point(rightPad, 50),
      animate:            true,
      maxZoom:            18,
    });
  }, [site?.properties.id, step, map]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
};

// ─── Shared OSM base data (buildings + roads always visible in steps 2–3) ────

interface OsmBaseLayerProps {
  site:   SiteFeature | null;
  step:   AppStep;
  active: CoreAnalysisOverlay | UrbanStrategyOverlay | null;
  buildings: ReturnType<typeof useSiteAnalysisData>['data'] extends null
    ? null
    : NonNullable<ReturnType<typeof useSiteAnalysisData>['data']>['buildings'] | null;
  roads: ReturnType<typeof useSiteAnalysisData>['data'] extends null
    ? null
    : NonNullable<ReturnType<typeof useSiteAnalysisData>['data']>['roads'] | null;
}

const OsmBaseLayer: React.FC<{
  site:      SiteFeature | null;
  step:      AppStep;
  active:    CoreAnalysisOverlay | UrbanStrategyOverlay | null;
  buildings: OsmBaseLayerProps['buildings'];
  roads:     OsmBaseLayerProps['roads'];
}> = ({ site, step, active, buildings, roads }) => {
  if (!site || step < 2) return null;

  const showBuildings =
    active === 'context' ||
    active === 'building_heights' ||
    active === 'developable' ||
    active === null;

  const showRoads =
    active === 'circulation' ||
    active === 'noise' ||
    active === 'linkages' ||
    active === null;

  return (
    <>
      {showBuildings && buildings && buildings.features.length > 0 && (
        <GeoJSON
          key={`b-${site.properties.id}`}
          data={buildings}
          style={(f?: Feature<Geometry>): PathOptions => {
            const p   = f?.properties as OsmBuildingProperties | undefined;
            const lvl = p?.levels ?? 1;
            const fill =
              active === 'building_heights'
                ? lvl <= 3  ? '#cfe0f8'
                : lvl <= 6  ? '#90b8f0'
                : lvl <= 10 ? '#5090e0'
                : lvl <= 15 ? '#2060c0'
                :             '#103080'
                : '#484848';
            return {
              color:       '#666',
              weight:      0.8,
              opacity:     0.9,
              fillColor:   fill,
              fillOpacity: Math.min(0.25 + lvl * 0.06, 0.85),
            };
          }}
          onEachFeature={(f: Feature<Geometry>, l) => {
            const p     = f.properties as OsmBuildingProperties;
            const parts = [
              p.name   ? `<strong>${p.name}</strong>`       : null,
              p.levels ? `Floors: ${p.levels}`              : null,
              p.height ? `Height: ${p.height.toFixed(1)} m` : null,
            ].filter(Boolean);
            if (!parts.length) parts.push('<em>Building</em>');
            l.bindTooltip(parts.join('<br/>'), {
              className: 'osm-tooltip',
              direction: 'top',
              sticky:    true,
            });
          }}
        />
      )}

      {showRoads && roads && roads.features.length > 0 && (
        <GeoJSON
          key={`r-${site.properties.id}`}
          data={roads}
          style={(f?: Feature<Geometry>): PathOptions => {
            const s = getRoadStyle(
              (f?.properties as OsmRoadProperties | undefined)?.highway ?? ''
            );
            return { color: s.colour, weight: s.weight, opacity: 0.85 };
          }}
          onEachFeature={(f: Feature<Geometry>, l) => {
            const p = f.properties as OsmRoadProperties;
            const s = getRoadStyle(p.highway);
            const parts = [
              p.name     ? `<strong>${p.name}</strong>` : `<em>${s.label}</em>`,
              p.maxspeed ? `Speed: ${p.maxspeed}`       : null,
              p.surface  ? `Surface: ${p.surface}`      : null,
            ].filter(Boolean);
            l.bindTooltip(parts.join('<br/>'), {
              className: 'osm-tooltip',
              direction: 'top',
              sticky:    true,
            });
          }}
        />
      )}
    </>
  );
};

// ─── Analytical overlay dispatcher ───────────────────────────────────────────

/**
 * All overlays receive their data as props — none fetch independently.
 * Turf.js calculations (noise buffers, access points, linkages) are
 * computed here from the pre-fetched data and passed as derived props.
 */
const Overlays: React.FC<{
  step:  AppStep;
  site:  SiteFeature | null;
  core:  CoreAnalysisOverlay  | null;
  urban: UrbanStrategyOverlay | null;
  contextData: ReturnType<typeof useSiteAnalysisData>['data'];
}> = ({ step, site, core, urban, contextData }) => {
  const b      = site ? getFeatureBounds(site) : null;
  const centre: LatLngTuple = b ? [b.getCenter().lat, b.getCenter().lng] : [0, 0];
  const siteId = site?.properties.id ?? '';

  // ── Derived data (Turf.js) computed once per site/contextData change ──────
  // These are expensive (turf union/intersection loops) and must not
  // recompute on every overlay toggle, only when the underlying data changes.

  const noiseZones = useMemo(
    () => (contextData?.roads ? buildNoiseZones(contextData.roads) : null),
    [contextData?.roads]
  );

  const accessPoints = useMemo(
    () => (site && contextData?.roads ? findAccessPoints(site, contextData.roads) : []),
    [site, contextData?.roads]
  );

  const linkageLines = useMemo(
    () => (site && contextData?.landmarks ? buildLinkageLinesFromLandmarks(site, contextData.landmarks, 5) : []),
    [site, contextData?.landmarks]
  );

  if (!site) return null;

  return (
    <>
      {/* ── Step 2: Core analysis ─────────────────────────────────────── */}
      {step === 2 && core === 'sun'         && <SunPathOverlay    centre={centre} bounds={b!} />}
      {step === 2 && core === 'wind'        && <WindOverlay       centre={centre} />}
      {step === 2 && core === 'topography'  && <TopographyOverlay centre={centre} bounds={b!} />}

      {step === 2 && core === 'context' && (
        <ContextOverlay
          buildings={contextData?.buildings ?? null}
          siteId={siteId}
        />
      )}

      {step === 2 && core === 'circulation' && (
        <CirculationOverlay
          roads={contextData?.roads ?? null}
          accessPoints={accessPoints}
          siteId={siteId}
        />
      )}

      {step === 2 && core === 'noise' && (
        <NoiseOverlay
          noiseZones={noiseZones}
          siteId={siteId}
        />
      )}

      {/* ── Step 3: Urban strategy ────────────────────────────────────── */}
      {step === 3 && urban === 'building_heights' && (
        <BuildingHeightsOverlay
          osmBuildings={contextData?.buildings ?? null}
        />
      )}

      {step === 3 && urban === 'linkages' && (
        <LinkagesOverlay
          linkageLines={linkageLines}
          centre={centre}
          siteId={siteId}
        />
      )}

      {step === 3 && urban === 'landmarks' && (
        <LandmarksOverlay
          landmarks={contextData?.landmarks ?? null}
          siteId={siteId}
        />
      )}

      {step === 3 && urban === 'developable' && (
        <DevelopableOverlay selectedSite={site} />
      )}
    </>
  );
};

// ─── Main SiteMap component ───────────────────────────────────────────────────

interface SiteMapProps {
  sites:        SiteFeature[];
  selectedSite: SiteFeature | null;
  step:         AppStep;
  coreOverlay:  CoreAnalysisOverlay  | null;
  urbanOverlay: UrbanStrategyOverlay | null;
  onSiteClick:  (f: SiteFeature) => void;
}

export const SiteMap: React.FC<SiteMapProps> = ({
  sites,
  selectedSite,
  step,
  coreOverlay,
  urbanOverlay,
  onSiteClick,
}) => {
  const active: CoreAnalysisOverlay | UrbanStrategyOverlay | null =
    step === 2 ? coreOverlay : step === 3 ? urbanOverlay : null;

  // ── Single centralised data fetch for ALL overlays ─────────────────────────
  // The hook fires one mega-query and caches results by site.
  // No individual overlay component ever calls Overpass directly.
  const { isLoading, error, data } = useSiteAnalysisData(
    step >= 2 ? selectedSite : null,
    1000
  );

  // Elapsed-time counter so a slow-but-working fetch doesn't read as stuck.
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  useEffect(() => {
    if (!isLoading) {
      setLoadingSeconds(0);
      return;
    }
    const interval = setInterval(() => setLoadingSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isLoading]);

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={L.latLng(DEFAULT_LAT, DEFAULT_LNG)}
        zoom={DEFAULT_ZOOM}
        className="w-full h-full"
        zoomControl={false}
      >
        <DynamicTileLayer step={step} />
        <MapCamera site={selectedSite} step={step} />

        {sites.map((s) => (
          <SitePolygon
            key={`site-${s.properties.id}`}
            feature={s}
            isSelected={selectedSite?.properties.id === s.properties.id}
            onClick={onSiteClick}
          />
        ))}

        {/* Always-visible buildings + roads base layer */}
        <OsmBaseLayer
          site={selectedSite}
          step={step}
          active={active}
          buildings={data?.buildings ?? null}
          roads={data?.roads ?? null}
        />

        {/* Analytical overlays — all data-prop-driven, none self-fetching */}
        <Overlays
          step={step}
          site={selectedSite}
          core={coreOverlay}
          urban={urbanOverlay}
          contextData={data}
        />
      </MapContainer>

      {/* Loading badge */}
      {isLoading && (
        <div
          style={{
            position:     'absolute',
            bottom:       16,
            left:         16,
            zIndex:       2000,
            background:   'rgba(26,26,26,0.88)',
            color:        '#f5f2ee',
            fontFamily:   'DM Mono, monospace',
            fontSize:     11,
            padding:      '6px 12px',
            borderRadius: 2,
            border:       '1px solid rgba(255,255,255,0.1)',
            display:      'flex',
            alignItems:   'center',
            gap:          8,
          }}
        >
          <span
            style={{
              display:      'inline-block',
              width:        8,
              height:       8,
              borderRadius: '50%',
              background:   '#c8522a',
              animation:    'pulse 1s infinite',
            }}
          />
          Fetching site context…{loadingSeconds > 2 ? ` (${loadingSeconds}s)` : ''}
          {loadingSeconds > 8 && (
            <span style={{ opacity: 0.7 }}> — public map data can be slow, still working</span>
          )}
        </div>
      )}

      {/* Error badge */}
      {error && !isLoading && (
        <div
          style={{
            position:     'absolute',
            bottom:       16,
            left:         16,
            zIndex:       2000,
            background:   'rgba(200,82,42,0.9)',
            color:        '#fff',
            fontFamily:   'DM Mono, monospace',
            fontSize:     11,
            padding:      '6px 12px',
            borderRadius: 2,
          }}
        >
          ⚠ {error}
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        .osm-tooltip {
          background:    rgba(20,20,20,0.92) !important;
          border:        1px solid rgba(255,255,255,0.12) !important;
          color:         #f0ede8 !important;
          font-family:   'DM Mono', monospace !important;
          font-size:     11px !important;
          border-radius: 2px !important;
          padding:       5px 8px !important;
        }
      `}</style>
    </div>
  );
};