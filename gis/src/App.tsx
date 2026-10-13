import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  SiteFeature,
  AppStep,
  CoreAnalysisOverlay,
  UrbanStrategyOverlay,
} from './types';
import { useSiteData } from './hooks/useSiteData';
import { useSiteAnalysisData } from './hooks/useSiteAnalysisData';
import { SiteMap } from './components/Map/SiteMap';
import { SiteInfoPanel } from './components/panels/SiteInfoPanel';
import { AnalysisSidebar } from './components/panels/AnalysisSidebar';
import { UrbanStrategySidebar } from './components/panels/UrbanStrategySidebar';
import { StepIndicator } from './components/ui/StepIndicator';

export const App: React.FC = () => {
  const navigate = useNavigate();

  // ── Site GeoJSON data ──────────────────────────────────────────────────────
  const { data: siteCollection, loading, error } = useSiteData();

  // ── Application step state ─────────────────────────────────────────────────
  const [step,  setStep]  = useState<AppStep>(1);
  const [site,  setSite]  = useState<SiteFeature | null>(null);
  const [core,  setCore]  = useState<CoreAnalysisOverlay  | null>(null);
  const [urban, setUrban] = useState<UrbanStrategyOverlay | null>(null);

  // ── Centralised Overpass mega-query ────────────────────────────────────────
  // Fires ONE request when a site is selected and step >= 2.
  // All overlays consume data from this hook via props — none fetch directly.
  const { data: contextData } = useSiteAnalysisData(site, 1000);

  // ── Navigation handlers ────────────────────────────────────────────────────

  const handleSiteClick = useCallback((f: SiteFeature) => setSite(f), []);

  const handleProceedToStep2 = useCallback(() => {
    setCore(null);
    setStep(2);
  }, []);

  const handleProceedToStep3 = useCallback(() => {
    setUrban(null);
    setStep(3);
  }, []);

  const handleBackToStep2 = useCallback(() => setStep(2), []);
  const handleClosePanel  = useCallback(() => setSite(null), []);
  const handleStepClick   = useCallback((s: AppStep) => setStep(s), []);

  const handleCoreToggle = useCallback(
    (id: CoreAnalysisOverlay) => setCore((p) => p === id ? null : id),
    []
  );

  const handleUrbanToggle = useCallback(
    (id: UrbanStrategyOverlay) => setUrban((p) => p === id ? null : id),
    []
  );

  // Navigate to Step 4 — Planning Workspace.
  // Passes the site feature AND the pre-fetched context data so the
  // planning workspace can forward it to the Step 5 massing viewer
  // without firing a second Overpass request.
  const handleProceedToPlanning = useCallback(() => {
    if (!site) return;
    navigate(`/plan/${site.properties.id}`, {
      state: { site, contextData },
    });
  }, [site, navigate, contextData]);

  const sites = siteCollection?.features ?? [];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col w-full h-full"
      style={{ background: 'var(--colour-bg)' }}
    >
      {/* ── Header ────────────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between px-6 flex-shrink-0"
        style={{
          height:       56,
          background:   'var(--colour-panel)',
          borderBottom: '1px solid var(--colour-border)',
        }}
      >
        {/* Branding */}
        <div className="flex items-center gap-3">
          <div
            className="w-5 h-5 rounded-sm"
            style={{ background: 'var(--colour-accent)' }}
          />
          <div>
            <h1
              className="text-sm font-semibold tracking-tight leading-none"
              style={{ color: 'var(--colour-ink)' }}
            >
              Architectural Site Analysis
            </h1>
            <p
              className="text-[10px] font-mono tracking-wide mt-0.5"
              style={{ color: 'var(--colour-muted)' }}
            >
              GIS Analysis Platform — London
            </p>
          </div>
        </div>

        {/* Step indicator */}
        <StepIndicator
          currentStep={step}
          onStepClick={handleStepClick}
          selectedSiteId={site?.properties.id ?? null}
        />

        {/* Right controls */}
        <div className="flex items-center gap-3">
          {/* Step 4 entry point — visible once a site is selected and analysed */}
          {site && step >= 2 && (
            <button
              onClick={handleProceedToPlanning}
              className="px-3 py-1.5 rounded-sm text-[10px] font-medium tracking-widest uppercase transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: 'var(--colour-accent)', color: '#fff' }}
            >
              Step 4: Planning →
            </button>
          )}

          {/* Selected site label */}
          <div className="text-right min-w-[120px]">
            {site ? (
              <>
                <p
                  className="text-xs font-medium tracking-wide leading-none"
                  style={{ color: 'var(--colour-ink)' }}
                >
                  {site.properties.name}
                </p>
                <p
                  className="text-[10px] font-mono mt-0.5"
                  style={{ color: 'var(--colour-muted)' }}
                >
                  {site.properties.borough}
                </p>
              </>
            ) : (
              <p
                className="text-[10px] font-mono"
                style={{ color: 'var(--colour-muted)' }}
              >
                No site selected
              </p>
            )}
          </div>
        </div>
      </header>

      {/* ── Map area ──────────────────────────────────────────────────── */}
      <main className="flex-1 relative overflow-hidden">

        {/* Loading state */}
        {loading && (
          <div
            className="absolute inset-0 z-[2000] flex flex-col items-center justify-center gap-3"
            style={{ background: 'var(--colour-bg)' }}
          >
            <div
              className="w-8 h-8 rounded-sm animate-spin"
              style={{
                border:           '2px solid var(--colour-border)',
                borderTopColor:   'var(--colour-accent)',
              }}
            />
            <p
              className="text-xs font-mono"
              style={{ color: 'var(--colour-muted)' }}
            >
              Loading site data…
            </p>
          </div>
        )}

        {/* GeoJSON error state */}
        {error && (
          <div
            className="absolute inset-0 z-[2000] flex flex-col items-center justify-center gap-2 p-8"
            style={{ background: 'var(--colour-bg)' }}
          >
            <p
              className="text-xs font-mono text-center max-w-md"
              style={{ color: 'var(--colour-accent)' }}
            >
              ⚠ {error}
            </p>
            <p
              className="text-[10px] font-mono"
              style={{ color: 'var(--colour-muted)' }}
            >
              Ensure <code>site.geojson</code> is at{' '}
              <code>public/data/site.geojson</code>
            </p>
          </div>
        )}

        {/* Empty GeoJSON */}
        {!loading && !error && sites.length === 0 && (
          <div
            className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 rounded-sm text-xs font-mono"
            style={{
              background: 'var(--colour-panel)',
              border:     '1px solid var(--colour-border)',
              color:      'var(--colour-muted)',
            }}
          >
            No features found in site.geojson — check the file format.
          </div>
        )}

        {/* Step 1 prompt */}
        {!loading && !error && step === 1 && !site && sites.length > 0 && (
          <div
            className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 rounded-sm text-xs font-mono whitespace-nowrap"
            style={{
              background: 'var(--colour-panel)',
              border:     '1px solid var(--colour-border)',
              color:      'var(--colour-muted)',
            }}
          >
            Click a site boundary to begin analysis
          </div>
        )}

        {/* Map — always rendered once data is available so Leaflet initialises correctly */}
        {!loading && (
          <SiteMap
            sites={sites}
            selectedSite={site}
            step={step}
            coreOverlay={core}
            urbanOverlay={urban}
            onSiteClick={handleSiteClick}
          />
        )}

        {/* Step 1: Site info panel */}
        {step === 1 && site && (
          <SiteInfoPanel
            site={site}
            contextData={contextData}
            onProceed={handleProceedToStep2}
            onClose={handleClosePanel}
          />
        )}

        {/* Step 2: Analysis sidebar */}
        {step === 2 && (
          <AnalysisSidebar
            activeOverlay={core}
            onToggle={handleCoreToggle}
            onProceedToStep3={handleProceedToStep3}
          />
        )}

        {/* Step 3: Urban strategy sidebar */}
        {step === 3 && (
          <UrbanStrategySidebar
            activeOverlay={urban}
            onToggle={handleUrbanToggle}
            onBackToStep2={handleBackToStep2}
          />
        )}
      </main>
    </div>
  );
};