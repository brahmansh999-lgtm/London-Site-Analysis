import React from 'react';

interface Props { label: string; description?: string; colour: string; isActive: boolean; onToggle: () => void; }

export const ToggleButton: React.FC<Props> = ({ label, description, colour, isActive, onToggle }) => (
  <button
    onClick={onToggle}
    className={`w-full flex items-start gap-3 px-3 py-2.5 rounded text-left transition-all duration-150 ${isActive ? 'bg-black/10' : 'hover:bg-black/5'}`}
  >
    <div className="mt-0.5 flex-shrink-0">
      <div className="w-3 h-3 rounded-sm border transition-all" style={{ background: isActive ? colour : 'transparent', borderColor: colour, boxShadow: isActive ? `0 0 6px ${colour}60` : 'none' }} />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-xs font-medium tracking-wide leading-tight" style={{ color: isActive ? 'var(--colour-ink)' : 'var(--colour-muted)' }}>{label}</p>
      {description && <p className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--colour-muted)' }}>{description}</p>}
    </div>
    {isActive && <span className="flex-shrink-0 text-[9px] font-mono tracking-widest uppercase px-1.5 py-0.5 rounded" style={{ background: colour + '22', color: colour }}>ON</span>}
  </button>
);
