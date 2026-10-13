import React, { useRef, useState } from 'react';

interface ResizableSplitProps {
  start: React.ReactNode;
  end: React.ReactNode;
  label: string;
}

// Discrete widths keep the split expressible as static Tailwind classes.
const RATIOS = [0.45, 0.5, 0.55, 0.6, 0.65];
const BASIS = ['basis-[45%]', 'basis-[50%]', 'basis-[55%]', 'basis-[60%]', 'basis-[65%]'];
const DEFAULT_STEP = 2;

export function ResizableSplit({ start, end, label }: ResizableSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(DEFAULT_STEP);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const nearest = RATIOS.reduce((best, r, i) => Math.abs(r - ratio) < Math.abs(RATIOS[best] - ratio) ? i : best, 0);
    setStep(nearest);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
    if (event.key === 'ArrowRight') setStep((s) => Math.min(RATIOS.length - 1, s + 1));
  };

  return (
    <div ref={containerRef} className="flex">
      <div className={`${BASIS[step]} min-w-0 shrink-0 pr-3`}>{start}</div>
      <div
        role="separator"
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={RATIOS[0] * 100}
        aria-valuemax={RATIOS[RATIOS.length - 1] * 100}
        aria-valuenow={RATIOS[step] * 100}
        tabIndex={0}
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={handlePointerMove}
        onDoubleClick={() => setStep(DEFAULT_STEP)}
        onKeyDown={handleKeyDown}
        className="group relative w-2 shrink-0 cursor-col-resize touch-none focus-visible:outline-none">

        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-line" />
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded bg-muted transition-colors duration-150 group-hover:bg-accent group-focus-visible:bg-accent" />

      </div>
      <div className="min-w-0 flex-1">{end}</div>
    </div>);

}