import { useState, useEffect } from 'react';
import type { SiteFeatureCollection } from '../types';

interface UseSiteDataReturn {
  data: SiteFeatureCollection | null;
  loading: boolean;
  error: string | null;
}

export function useSiteData(): UseSiteDataReturn {
  const [data, setData] = useState<SiteFeatureCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/data/site.geojson');
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const json: SiteFeatureCollection = await res.json();

        const normalised: SiteFeatureCollection = {
          ...json,
          features: json.features
            .map((f, idx) => {
              const raw = (f.properties as unknown) as Record<string, unknown>;
              const str = (v: unknown) => (v != null ? String(v) : '');
              const num = (v: unknown) => { const n = Number(v); return isNaN(n) ? 0 : n; };
              const pick = (...keys: string[]) => { for (const k of keys) { if (raw[k] != null) return raw[k]; } return undefined; };
              const name = pick('name', 'Name', 'NAME', 'site_name', 'title');
              return {
                ...f,
                properties: {
                  id:              str(pick('id', 'Id', 'ID', 'site_id', 'OBJECTID', 'FID') ?? `site-${idx}`),
                  name:            name != null ? str(name) : '',
                  borough:         str(pick('borough', 'Borough', 'BOROUGH', 'district', 'local_authority') ?? 'London'),
                  area_sqm:        num(pick('area_sqm', 'area', 'AREA', 'shape_area', 'Shape_Area')),
                  description:     str(pick('description', 'Description', 'notes', 'Notes')),
                  current_use:     str(pick('current_use', 'use', 'USE', 'land_use', 'landuse') ?? 'Not specified'),
                  planning_status: str(pick('planning_status', 'status', 'STATUS', 'planning') ?? 'Not specified'),
                },
              };
            })
            // Drop sites with no real name in the source data — these were
            // previously shown as "Site 1", "Site 2", etc.
            .filter((f) => f.properties.name.trim().length > 0),
        };
        setData(normalised);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error loading site data.');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return { data, loading, error };
}
