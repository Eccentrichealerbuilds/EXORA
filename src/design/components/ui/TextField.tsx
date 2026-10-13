import React, { useId } from 'react';

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  size?: 'sm' | 'md';
  error?: string;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  className?: string;
}

export function TextField({
  label,
  value,
  onChange,
  suffix,
  size = 'md',
  error,
  placeholder,
  inputMode = 'decimal',
  className = ''
}: TextFieldProps) {
  const id = useId();
  return (
    <div className={`flex min-w-0 flex-col gap-[5px] ${className}`}>
      <label htmlFor={id} className="text-micro font-medium text-muted">
        {label}
      </label>
      <div
        className={`flex items-center gap-2 rounded border px-2.5 transition-colors duration-150 focus-within:border-accent ${size === 'sm' ? 'h-8' : 'h-10'} ${error ? 'border-short' : 'border-line'}`}>

        <input
          id={id}
          value={value}
          inputMode={inputMode}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-fg outline-none placeholder:text-muted" />

        {suffix && <span className="shrink-0 text-xs text-muted">{suffix}</span>}
      </div>
      {error &&
      <p id={`${id}-error`} className="text-micro font-medium text-short">
          {error}
        </p>
      }
    </div>);

}