import { useRef, useState, useEffect, useCallback } from 'react';
import type { SiteFeature } from '../types';
import {
  getFeatureCentroid,
  fetchComprehensiveSiteContext,
  type SiteContextData,
} from '../utils/geoUtils';

// ─── Hook return type ─────────────────────────────────────────────────────────

export interface SiteAnalysisData {
  /** True while the mega-query is in flight */
  isLoading: boolean;
  /** Human-readable error if the request failed, otherwise null */
  error:     string | null;
  /** The fully parsed context payload, or null if not yet loaded */
  data:      SiteContextData | null;
}

// ─── Cache entry ──────────────────────────────────────────────────────────────

interface CacheEntry {
  data:      SiteContextData;
  fetchedAt: number; // Unix ms timestamp
}

// Cache TTL: 10 minutes. Stale entries are re-fetched transparently.
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * useSiteAnalysisData
 *
 * Central data hook for Steps 2 and 3.
 *
 * Architecture:
 *   1. When `selectedSite` changes, derives the centroid and fires ONE
 *      `fetchComprehensiveSiteContext` mega-query for buildings, roads,
 *      and landmarks simultaneously.
 *   2. Results are stored in a `useRef` dictionary keyed by
 *      `"lat,lng"` so revisiting a site loads instantly from memory
 *      without any network request.
 *   3. Cache entries expire after `CACHE_TTL_MS` (10 minutes) and are
 *      transparently re-fetched in the background.
 *   4. Any in-flight request from a previous site is aborted via
 *      `AbortController` when the site changes, preventing stale data
 *      from overwriting the current site's render.
 *   5. No individual overlay component ever calls Overpass directly.
 *      They all consume the data returned by this hook via props.
 *
 * @param selectedSite  The currently selected site feature, or null.
 * @param radiusM       Overpass search radius in metres (default 1000 m).
 */
export function useSiteAnalysisData(
  selectedSite: SiteFeature | null,
  radiusM = 1000
): SiteAnalysisData {
  const [state, setState] = useState<SiteAnalysisData>({
    isLoading: false,
    error:     null,
    data:      null,
  });

  // In-memory cache: key = "lat,lng" (rounded to 5 d.p. ≈ 1 m precision)
  const cache = useRef<Map<string, CacheEntry>>(new Map());

  // AbortController ref so we can cancel in-flight requests
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (site: SiteFeature) => {
      // Cancel any previous in-flight request
      if (abortRef.current) {
        abortRef.current.abort();
      }
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      // Derive a stable cache key from the site centroid
      const [lat, lng]   = getFeatureCentroid(site);
      const cacheKey     = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      const now          = Date.now();

      // ── Cache hit (within TTL) ──────────────────────────────────────────
      const cached = cache.current.get(cacheKey);
      if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
        setState({ isLoading: false, error: null, data: cached.data });
        return;
      }

      // ── Cache miss: fire the mega-query ─────────────────────────────────
      setState({ isLoading: true, error: null, data: null });

      try {
        const result = await fetchComprehensiveSiteContext(
          lat,
          lng,
          radiusM,
          signal
        );

        // Do not update state if this request was aborted (site changed)
        if (signal.aborted) return;

        // Store in cache
        cache.current.set(cacheKey, { data: result, fetchedAt: Date.now() });

        setState({ isLoading: false, error: null, data: result });
      } catch (err: unknown) {
        if (signal.aborted) return; // Ignore errors from cancelled requests

        const message =
          err instanceof Error
            ? err.message
            : 'Failed to fetch site context data.';

        setState({ isLoading: false, error: message, data: null });
      }
    },
    [radiusM]
  );

  useEffect(() => {
    if (!selectedSite) {
      // No site selected — reset state and cancel any pending request
      if (abortRef.current) abortRef.current.abort();
      setState({ isLoading: false, error: null, data: null });
      return;
    }

    void load(selectedSite);

    // Cleanup: abort in-flight request when site changes or component unmounts
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [selectedSite?.properties.id, load]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}