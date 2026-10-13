import React from 'react';

interface PreferenceRowProps {
  title: string;
  description?: string;
  control: React.ReactNode;
}

export function PreferenceRow({ title, description, control }: PreferenceRowProps) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-xs font-medium text-fg">{title}</p>
        {description && <p className="text-micro font-medium text-muted">{description}</p>}
      </div>
      {control}
    </div>);

}