import React, { useMemo } from 'react';
import type { SiteFeature } from '../../types';
import {
  calculateFeatureArea,
  formatArea,
  calculateFeatureDimensions,
  formatDimensions,
  classifySiteSize,
  SITE_SIZE_COLOURS,
  type SiteContextData,
} from '../../utils/geoUtils';
import { downloadSiteContextDxf } from '../../utils/siteDxfExport';

interface Props { site: SiteFeature; contextData?: SiteContextData | null; onProceed: () => void; onClose: () => void; }

export const SiteInfoPanel: React.FC<Props> = ({ site, contextData, onProceed, onClose }) => {
  const { name, borough, description, current_use, planning_status } = site.properties;
  const area       = useMemo(() => calculateFeatureArea(site), [site]);
  const dimensions = useMemo(() => calculateFeatureDimensions(site), [site]);
  const sizeCategory = useMemo(() => classifySiteSize(area), [area]);

  return (
    <div className="absolute bottom-6 left-6 z-[1000] w-80 rounded-sm shadow-2xl overflow-hidden" style={{ background: 'var(--colour-panel)', border: '1px solid var(--colour-border)', backdropFilter: 'blur(8px)' }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--colour-border)' }}>
        <span className="text-[10px] font-mono tracking-widest uppercase" style={{ color: 'var(--colour-accent)' }}>Selected Site</span>
        <button onClick={onClose} className="text-xs font-mono hover:opacity-60 transition-opacity" style={{ color: 'var(--colour-muted)' }}>✕ close</button>
      </div>
      <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold leading-tight tracking-tight" style={{ color: 'var(--colour-ink)' }}>{name}</h2>
          <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--colour-muted)' }}>{borough}</p>
        </div>
        <span
          className="text-[10px] font-mono tracking-widest uppercase px-2 py-1 rounded-sm flex-shrink-0"
          style={{ background: SITE_SIZE_COLOURS[sizeCategory], color: '#fff' }}
        >
          {sizeCategory}
        </span>
      </div>
      <div className="mx-4 mb-3 rounded-sm overflow-hidden" style={{ border: '1px solid var(--colour-border)' }}>
        {[
          { label: 'Site Area', value: formatArea(area), hi: true },
          { label: 'Dimensions', value: formatDimensions(dimensions), hi: false },
          { label: 'Size Category', value: sizeCategory, hi: false },
          { label: 'Current Use', value: current_use, hi: false },
          { label: 'Planning Status', value: planning_status, hi: false },
        ].map(({ label, value, hi }, i) => (
          <div key={label} className="flex justify-between items-center px-3 py-2" style={{ borderTop: i > 0 ? '1px solid var(--colour-border)' : 'none', background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.02)' }}>
            <span className="text-[10px] font-mono tracking-wide uppercase" style={{ color: 'var(--colour-muted)' }}>{label}</span>
            <span className="text-xs font-medium text-right max-w-[55%]" style={{ color: hi ? 'var(--colour-accent)' : 'var(--colour-ink)', fontFamily: hi ? 'DM Mono, monospace' : undefined }}>{value}</span>
          </div>
        ))}
      </div>
      {description && <p className="px-4 pb-3 text-xs leading-relaxed" style={{ color: 'var(--colour-muted)' }}>{description}</p>}
      <div className="px-4 pb-4 flex flex-col gap-2">
        <button
          onClick={() => downloadSiteContextDxf(site, contextData ?? undefined)}
          className="w-full py-2.5 text-xs font-medium tracking-widest uppercase rounded-sm hover:opacity-90 active:scale-[0.98] transition-all"
          style={{ background: 'transparent', color: 'var(--colour-ink)', border: '1px solid var(--colour-border)' }}
        >
          Download Site Context DXF
        </button>
        <button onClick={onProceed} className="w-full py-2.5 text-xs font-medium tracking-widest uppercase rounded-sm hover:opacity-90 active:scale-[0.98] transition-all" style={{ background: 'var(--colour-ink)', color: 'var(--colour-bg)' }}>
          Proceed to Site Analysis →
        </button>
      </div>
    </div>
  );
};
