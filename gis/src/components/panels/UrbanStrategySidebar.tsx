import React from 'react';
import type { UrbanStrategyOverlay, OverlayMeta } from '../../types';
import { ToggleButton } from '../ui/ToggleButton';

const OVERLAYS: OverlayMeta[] = [
  { id: 'building_heights', label: 'Building Heights', colour: '#3878c8', description: 'Real OSM storey data — height coded'       },
  { id: 'linkages',         label: 'Urban Linkages',   colour: '#38a878', description: 'Site centroid → nearest landmarks'         },
  { id: 'landmarks',        label: 'Landmarks & Nodes',colour: '#c83878', description: 'Live OSM amenities within 1 km'            },
  { id: 'developable',      label: 'Developable Land', colour: '#78c838', description: 'Turf.js setback — real buildable footprint'},
];

interface Props { activeOverlay: UrbanStrategyOverlay | null; onToggle: (id: UrbanStrategyOverlay) => void; onBackToStep2: () => void; }

export const UrbanStrategySidebar: React.FC<Props> = ({ activeOverlay, onToggle, onBackToStep2 }) => (
  <div className="absolute top-0 right-0 h-full w-72 z-[1000] flex flex-col" style={{ background: 'var(--colour-panel)', borderLeft: '1px solid var(--colour-border)', backdropFilter: 'blur(8px)' }}>
    <div className="px-4 py-4" style={{ borderBottom: '1px solid var(--colour-border)' }}>
      <p className="text-[10px] font-mono tracking-widest uppercase" style={{ color: 'var(--colour-accent)' }}>Step 03</p>
      <h3 className="text-sm font-semibold mt-1 tracking-tight" style={{ color: 'var(--colour-ink)' }}>Urban Strategy</h3>
      <p className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--colour-muted)' }}>Click a layer to activate</p>
    </div>
    <div className="flex-1 overflow-y-auto py-2 px-2">
      {OVERLAYS.map((o) => (
        <ToggleButton key={o.id} label={o.label} description={o.description} colour={o.colour} isActive={activeOverlay === o.id} onToggle={() => onToggle(o.id as UrbanStrategyOverlay)} />
      ))}
    </div>
    <div className="p-4" style={{ borderTop: '1px solid var(--colour-border)' }}>
      <button onClick={onBackToStep2} className="w-full py-2.5 text-xs font-medium tracking-widest uppercase rounded-sm hover:opacity-80 active:scale-[0.98] transition-all" style={{ background: 'transparent', color: 'var(--colour-ink)', border: '1px solid var(--colour-border)' }}>
        ← Back to Site Analysis
      </button>
    </div>
  </div>
);
