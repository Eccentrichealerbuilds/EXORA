import React from 'react';

interface KeyValueRowProps {
  label: string;
  /** Unknown values render as "—" */
  value?: React.ReactNode;
  className?: string;
}

export function KeyValueRow({ label, value, className = 'h-[26px]' }: KeyValueRowProps) {
  return (
    <div className={`flex items-center justify-between gap-2 ${className}`}>
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xs font-medium text-fg">{value ?? '—'}</span>
    </div>);

}