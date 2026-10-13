import React from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import type { SiteFeature } from '../../types';
import type { GeneratedPlan } from '../../types/architecture';
import type { SiteContextData } from '../../utils/geoUtils';
import { SvgOverlay } from './SvgOverlay';

export function SvgOverlayRoute(): React.ReactElement {
  const { siteId }  = useParams<{ siteId: string }>();
  const location    = useLocation();
  const navigate    = useNavigate();
  const state       = location.state as {
    site?:        SiteFeature;
    plan?:        GeneratedPlan;
    contextData?: SiteContextData;
  } | null;

  const site        = state?.site        ?? null;
  const plan        = state?.plan        ?? null;
  const contextData = state?.contextData ?? null;

  if (!site || !plan) {
    return (
      <div style={{
        width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
        background: '#0f172a', fontFamily: 'DM Mono',
      }}>
        <p style={{ color: '#f87171', fontSize: 14 }}>⚠ No plan data found for site: {siteId}</p>
        <p style={{ color: '#64748b', fontSize: 12 }}>
          Generate a plan in Step 4 first, then use the &quot;Step 5 →&quot; button.
        </p>
        <Link to="/" style={{ color: '#93c5fd', fontSize: 12 }}>← Return to Site Analysis</Link>
      </div>
    );
  }

  const handleBack = () =>
    navigate(`/plan/${site.properties.id}`, { state: { site, contextData } });

  const handleProceed = () =>
    navigate(`/massing/${site.properties.id}`, {
      state: { site, plan, contextData },
    });

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <SvgOverlay
        plan={plan}
        site={site}
        onBack={handleBack}
        onProceed={handleProceed}
      />
    </div>
  );
}
