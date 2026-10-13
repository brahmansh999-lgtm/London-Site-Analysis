import { useState, useEffect } from 'react';
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

// ─── Shared cache ─────────────────────────────────────────────────────────────
//
// Module-level (not per-hook) so App and SiteMap share one fetch per site
// instead of each downloading and parsing the same Overpass payload.
//   - memoryCache: parsed results for this page session
//   - inFlight:    pending requests, so a second caller joins the first
//   - IndexedDB:   persists results across reloads (OSM data changes slowly)

interface CacheEntry {
  data:      SiteContextData;
  fetchedAt: number; // Unix ms timestamp
}

const MEMORY_TTL_MS     = 10 * 60 * 1000;          // 10 minutes
const PERSISTED_TTL_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days
// Wait briefly before hitting Overpass so rapid site-clicking doesn't fire
// (and get rate-limited for) a query per click.
const FETCH_DEBOUNCE_MS = 400;

const memoryCache = new Map<string, CacheEntry>();
const inFlight    = new Map<string, { promise: Promise<SiteContextData>; controller: AbortController; users: number }>();

// ─── IndexedDB persistence (best-effort: any failure falls back to network) ──

const IDB_NAME  = 'gis-site-context';
const IDB_STORE = 'context';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

async function readPersisted(key: string): Promise<CacheEntry | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      req.onsuccess = () => {
        const entry = req.result as CacheEntry | undefined;
        resolve(entry && Date.now() - entry.fetchedAt < PERSISTED_TTL_MS ? entry : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writePersisted(key: string, entry: CacheEntry): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(entry, key);
  } catch { /* quota or private mode — memory cache still works */ }
}

function getMemoryCached(key: string): SiteContextData | null {
  const entry = memoryCache.get(key);
  return entry && Date.now() - entry.fetchedAt < MEMORY_TTL_MS ? entry.data : null;
}

/** Joins an existing request for `key` or starts one (persisted cache first, then network). */
function acquire(key: string, lat: number, lng: number, radiusM: number) {
  let entry = inFlight.get(key);
  if (!entry) {
    const controller = new AbortController();
    const promise = (async () => {
      const persisted = await readPersisted(key);
      if (persisted) return persisted.data;
      const data = await fetchComprehensiveSiteContext(lat, lng, radiusM, controller.signal);
      void writePersisted(key, { data, fetchedAt: Date.now() });
      return data;
    })();
    entry = { promise, controller, users: 0 };
    inFlight.set(key, entry);
    promise
      .then((data) => memoryCache.set(key, { data, fetchedAt: Date.now() }))
      .catch(() => { /* surfaced to callers below */ })
      .finally(() => { if (inFlight.get(key) === entry) inFlight.delete(key); });
  }
  entry.users++;
  const acquired = entry;
  // Abort the network request only when every caller has gone away.
  const release = () => {
    if (--acquired.users === 0 && inFlight.get(key) === acquired) {
      acquired.controller.abort();
      inFlight.delete(key);
    }
  };
  return { promise: acquired.promise, release };
}

/**
 * useSiteAnalysisData
 *
 * Central data hook for Steps 2 and 3. Fires ONE Overpass mega-query for
 * buildings, roads and landmarks per site; every caller shares the result
 * through the module-level cache above. No overlay calls Overpass directly.
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

  useEffect(() => {
    if (!selectedSite) {
      setState({ isLoading: false, error: null, data: null });
      return;
    }

    // Stable cache key from the site centroid (5 d.p. ≈ 1 m) and radius
    const [lat, lng] = getFeatureCentroid(selectedSite);
    const key        = `${lat.toFixed(5)},${lng.toFixed(5)},${radiusM}`;

    const cached = getMemoryCached(key);
    if (cached) {
      setState({ isLoading: false, error: null, data: cached });
      return;
    }

    setState({ isLoading: true, error: null, data: null });

    let cancelled = false;
    let release: (() => void) | null = null;

    const start = () => {
      const req = acquire(key, lat, lng, radiusM);
      release = req.release;
      req.promise.then(
        (data) => { if (!cancelled) setState({ isLoading: false, error: null, data }); },
        (err: unknown) => {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : 'Failed to fetch site context data.';
          setState({ isLoading: false, error: message, data: null });
        }
      );
    };

    // Join an in-flight request immediately; otherwise debounce the new one.
    const timer = inFlight.has(key) ? (start(), null) : setTimeout(start, FETCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      release?.();
    };
  }, [selectedSite?.properties.id, radiusM]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
