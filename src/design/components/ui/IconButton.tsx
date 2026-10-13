import React from 'react';

type IconButtonTone = 'ghost' | 'line' | 'ink';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: IconButtonTone;
}

const TONES: Record<IconButtonTone, string> = {
  ghost: 'text-accent hover:bg-surface',
  line: 'border border-line text-accent hover:bg-surface',
  ink: 'border border-ink text-ink hover:bg-ink/5'
};

export function IconButton({ label, tone = 'ghost', className = 'h-10 w-10', children, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-[background-color,transform] duration-150 ease-out active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${TONES[tone]} ${className}`}
      {...props}>

      {children}
    </button>);

}