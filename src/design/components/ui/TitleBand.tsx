import React from 'react';

interface TitleBandProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function TitleBand({ eyebrow, title, subtitle, action }: TitleBandProps) {
  return (
    <section className="flex items-center justify-between gap-3 bg-accent px-[18px] py-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-micro font-medium text-ink">{eyebrow}</p>
        <h1 className="text-title font-semibold text-ink">{title}</h1>
        {subtitle && <p className="text-xs text-ink">{subtitle}</p>}
      </div>
      {action}
    </section>);

}