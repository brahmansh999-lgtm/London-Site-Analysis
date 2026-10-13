import React from 'react';
import type { AppStep } from '../../types';

interface Props { currentStep: AppStep; onStepClick: (s: AppStep) => void; selectedSiteId: string | null; }

const STEPS: { step: AppStep; label: string; sub: string }[] = [
  { step: 1, label: 'Site Selection',  sub: 'Choose a site'           },
  { step: 2, label: 'Site Analysis',   sub: 'Environmental & Physical' },
  { step: 3, label: 'Urban Strategy',  sub: 'Spatial Planning'         },
];

export const StepIndicator: React.FC<Props> = ({ currentStep, onStepClick, selectedSiteId }) => {
  const canGo = (s: AppStep) => {
    if (s === 1) return true;
    if (s === 2) return selectedSiteId !== null;
    return selectedSiteId !== null && currentStep >= 2;
  };
  return (
    <div className="flex items-stretch h-full">
      {STEPS.map(({ step, label, sub }, i) => {
        const active   = currentStep === step;
        const complete = currentStep > step;
        const ok       = canGo(step);
        return (
          <React.Fragment key={step}>
            {i > 0 && <div className="flex items-center px-1"><div className="w-6 h-px" style={{ background: complete ? 'var(--colour-accent)' : 'var(--colour-border)' }} /></div>}
            <button
              onClick={() => ok && onStepClick(step)}
              disabled={!ok}
              className={`flex flex-col justify-center px-4 py-2 border-b-2 gap-0.5 transition-all duration-200 ${active ? 'border-[var(--colour-accent)]' : 'border-transparent'} ${ok ? 'cursor-pointer hover:bg-black/5' : 'cursor-not-allowed opacity-40'}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] font-medium tracking-widest uppercase" style={{ color: active ? 'var(--colour-accent)' : 'var(--colour-muted)' }}>{String(step).padStart(2, '0')}</span>
                <span className="text-xs font-medium tracking-wide" style={{ color: active ? 'var(--colour-ink)' : 'var(--colour-muted)' }}>{label}</span>
              </div>
              <span className="text-[10px] font-mono pl-6" style={{ color: 'var(--colour-muted)' }}>{sub}</span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};
