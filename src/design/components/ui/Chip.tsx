import React from 'react';

type ChipTone = 'muted' | 'accent' | 'ink' | 'filled';

interface ChipProps {
  children: React.ReactNode;
  tone?: ChipTone;
  onClick?: () => void;
  className?: string;
}

const TONES: Record<ChipTone, string> = {
  muted: 'border-muted text-muted',
  accent: 'border-accent text-accent',
  ink: 'border-ink text-ink',
  filled: 'border-line bg-surface text-muted'
};

export function Chip({ children, tone = 'muted', onClick, className = '' }: ChipProps) {
  const classes = `inline-flex h-6 shrink-0 items-center justify-center whitespace-nowrap rounded border px-1.5 text-micro font-medium ${TONES[tone]} ${className}`;
  if (!onClick) return <span className={classes}>{children}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${classes} transition-[background-color,transform] duration-150 ease-out hover:bg-fg/5 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}>

      {children}
    </button>);

}