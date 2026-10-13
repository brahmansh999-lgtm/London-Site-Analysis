import React from 'react';
import type { CoreAnalysisOverlay, OverlayMeta } from '../../types';
import { ToggleButton } from '../ui/ToggleButton';

const OVERLAYS: OverlayMeta[] = [
  { id: 'sun',         label: 'Sun Path & Shadow',    colour: '#e8a838', description: 'Solstice arcs & shadow zones'         },
  { id: 'wind',        label: 'Wind Analysis',        colour: '#5ba3c9', description: 'Prevailing vectors & shelter zones'    },
  { id: 'topography',  label: 'Topography',           colour: '#7a9e6e', description: 'Contours, slope & drainage'            },
  { id: 'context',     label: 'Existing Context',     colour: '#9e8e7a', description: 'Real OSM buildings within 500 m'       },
  { id: 'circulation', label: 'Circulation & Access', colour: '#c96b5b', description: 'Live roads + boundary access points'   },
  { id: 'noise',       label: 'Noise Zones',          colour: '#8b5ba3', description: 'Acoustic buffer from primary roads'    },
];

interface Props { activeOverlay: CoreAnalysisOverlay | null; onToggle: (id: CoreAnalysisOverlay) => void; onProceedToStep3: () => void; }

export const AnalysisSidebar: React.FC<Props> = ({ activeOverlay, onToggle, onProceedToStep3 }) => (
  <div className="absolute top-0 right-0 h-full w-72 z-[1000] flex flex-col" style={{ background: 'var(--colour-panel)', borderLeft: '1px solid var(--colour-border)', backdropFilter: 'blur(8px)' }}>
    <div className="px-4 py-4" style={{ borderBottom: '1px solid var(--colour-border)' }}>
      <p className="text-[10px] font-mono tracking-widest uppercase" style={{ color: 'var(--colour-accent)' }}>Step 02</p>
      <h3 className="text-sm font-semibold mt-1 tracking-tight" style={{ color: 'var(--colour-ink)' }}>Site Analysis</h3>
      <p className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--colour-muted)' }}>Click a layer to activate</p>
    </div>
    <div className="flex-1 overflow-y-auto py-2 px-2">
      {OVERLAYS.map((o) => (
        <ToggleButton key={o.id} label={o.label} description={o.description} colour={o.colour} isActive={activeOverlay === o.id} onToggle={() => onToggle(o.id as CoreAnalysisOverlay)} />
      ))}
    </div>
    <div className="p-4" style={{ borderTop: '1px solid var(--colour-border)' }}>
      <button onClick={onProceedToStep3} className="w-full py-2.5 text-xs font-medium tracking-widest uppercase rounded-sm hover:opacity-90 active:scale-[0.98] transition-all" style={{ background: 'var(--colour-ink)', color: 'var(--colour-bg)' }}>
        Urban Strategy →
      </button>
    </div>
  </div>
);
