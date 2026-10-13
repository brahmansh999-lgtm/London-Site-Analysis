import React from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import type { SiteFeature } from '../../types';
import type { SiteContextData } from '../../utils/geoUtils';
import { PlanningWorkspace } from './PlanningWorkspace';

export function PlanningWorkspaceRoute(): React.ReactElement {
  const { siteId } = useParams<{ siteId: string }>();
  const location   = useLocation();
  const state      = location.state as { site?: SiteFeature; contextData?: SiteContextData } | null;
  const site        = state?.site        ?? null;
  const contextData = state?.contextData ?? null;

  if (!site) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#0f172a', fontFamily: 'DM Mono' }}>
        <p style={{ color: '#f87171', fontSize: 14 }}>⚠ No site data found for ID: {siteId}</p>
        <p style={{ color: '#64748b', fontSize: 12 }}>Return to the main application and select a site first.</p>
        <Link to="/" style={{ color: '#93c5fd', fontSize: 12 }}>← Return to Site Analysis</Link>
      </div>
    );
  }

  return <PlanningWorkspace site={site} contextData={contextData} />;
}