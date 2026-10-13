import React from 'react';

type ButtonVariant = 'primary' | 'dark' | 'outline' | 'outlineInk';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-ink hover:brightness-110',
  dark: 'bg-canvas text-fg hover:bg-raised',
  outline: 'border border-line text-fg hover:bg-surface',
  outlineInk: 'border border-ink text-ink hover:bg-ink/5'
};

export function Button({ variant = 'primary', className = '', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-semibold transition-[background-color,filter,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:border-transparent disabled:bg-raised disabled:text-muted disabled:hover:brightness-100 ${VARIANTS[variant]} ${className}`}
      {...props} />);


}