/**
 * MassingViewerRoute
 *
 * Route shell for /massing/:siteId.  Hosts both:
 *   Step 5 — Abstract 3D Massing Viewer  (MassingViewer)
 *   Step 6 — Componentised GLB Assembly  (ModelAssembler)
 *
 * A toggle in the viewer header switches between the two views without
 * navigating away, preserving all router state.
 */

import React, { useState } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import type { SiteFeature } from '../../types';
import type { GeneratedPlan } from '../../types/architecture';
import type { SiteContextData } from '../../utils/geoUtils';
import { MassingViewer } from './MassingViewer';
import { ModelAssembler } from './ModelAssembler';

// ─── View modes ───────────────────────────────────────────────────────────────

type ViewMode = 'massing' | 'assembled';

// ─── Error fallback ───────────────────────────────────────────────────────────

function MissingDataFallback({ siteId }: { siteId: string | undefined }) {
  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 16, background: '#0f172a', fontFamily: 'DM Mono',
    }}>
      <p style={{ color: '#f87171', fontSize: 14 }}>⚠ No plan data found for site: {siteId}</p>
      <p style={{ color: '#64748b', fontSize: 12 }}>
        Generate a plan in Step 4 first, then use the "3D Massing →" button.
      </p>
      <Link to="/" style={{ color: '#93c5fd', fontSize: 12 }}>← Return to Site Analysis</Link>
    </div>
  );
}

// ─── Step toggle bar ──────────────────────────────────────────────────────────
// Rendered as an absolute overlay at the top of the viewport, shared across
// both viewer modes so the user can switch at any time.

interface StepToggleProps {
  view:      ViewMode;
  siteId:    string;
  siteName:  string;
  onSwitch:  (v: ViewMode) => void;
}

function StepToggle({ view, siteId, siteName, onSwitch }: StepToggleProps) {
  const btnBase: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '0 16px', height: 36, borderRadius: 4,
    fontFamily: 'DM Mono', fontSize: 11, fontWeight: 600,
    cursor: 'pointer', border: '1px solid #1e3a5f',
    letterSpacing: '0.04em', transition: 'background 0.15s, color 0.15s',
  };

  const activeStyle:   React.CSSProperties = { background: '#0f766e', color: '#f0fdf4', borderColor: '#0f766e' };
  const inactiveStyle: React.CSSProperties = { background: 'rgba(10,15,26,0.88)', color: '#475569' };

  return (
    <div style={{
      position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
      zIndex: 30, display: 'flex', gap: 4,
      background: 'rgba(10,15,26,0.92)', border: '1px solid #1e3a5f',
      borderRadius: 6, padding: 4,
    }}>
      {/* Step label */}
      <div style={{ display: 'flex', alignItems: 'center', paddingRight: 8, paddingLeft: 4, borderRight: '1px solid #1e3a5f', marginRight: 4 }}>
        <span style={{ color: '#334155', fontFamily: 'DM Mono', fontSize: 10 }}>{siteName}</span>
      </div>

      {/* Step 6 button */}
      <button
        style={{ ...btnBase, ...(view === 'massing' ? activeStyle : inactiveStyle) }}
        onClick={() => onSwitch('massing')}
        title="Switch to Step 6 — Abstract 3D Massing"
      >
        <span style={{
          width: 18, height: 18, borderRadius: 3, display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700,
          background: view === 'massing' ? 'rgba(255,255,255,0.15)' : '#1e3a5f',
          color: view === 'massing' ? '#fff' : '#64748b',
        }}>06</span>
        3D Massing
      </button>

      {/* Step 7 button */}
      <button
        style={{ ...btnBase, ...(view === 'assembled' ? activeStyle : inactiveStyle) }}
        onClick={() => onSwitch('assembled')}
        title="Switch to Step 7 — Componentised GLB Assembly"
      >
        <span style={{
          width: 18, height: 18, borderRadius: 3, display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700,
          background: view === 'assembled' ? 'rgba(255,255,255,0.15)' : '#1e3a5f',
          color: view === 'assembled' ? '#fff' : '#64748b',
        }}>07</span>
        GLB Assembly
      </button>
    </div>
  );
}

// ─── Route component ──────────────────────────────────────────────────────────

export function MassingViewerRoute(): React.ReactElement {
  const { siteId } = useParams<{ siteId: string }>();
  const location   = useLocation();
  const state      = location.state as {
    site?:        SiteFeature;
    plan?:        GeneratedPlan;
    contextData?: SiteContextData;
  } | null;

  const site        = state?.site        ?? null;
  const plan        = state?.plan        ?? null;
  const contextData = state?.contextData ?? null;

  // Active view mode — defaults to Step 5 massing on first load.
  const [view, setView] = useState<ViewMode>('massing');

  if (!site || !plan) {
    return <MissingDataFallback siteId={siteId} />;
  }

  const siteName = site.properties?.name ?? '';

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', background: '#0a0f1a' }}>
      {/* ── Active viewer (fills the full viewport) ── */}
      <div style={{ width: '100%', height: '100%' }}>
        {view === 'massing' ? (
          <MassingViewer
            site={site}
            plan={plan}
            contextData={contextData}
          />
        ) : (
          <ModelAssembler
            site={site}
            plan={plan}
            contextData={contextData}
            onBackToMassing={() => setView('massing')}
          />
        )}
      </div>

      {/* ── Step toggle — always visible regardless of active view ── */}
      <StepToggle
        view={view}
        siteId={siteId ?? ''}
        siteName={siteName}
        onSwitch={setView}
      />
    </div>
  );
}
