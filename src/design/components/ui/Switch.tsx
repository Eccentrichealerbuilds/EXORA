
interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Switch({ label, checked, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex h-[22px] w-9 shrink-0 items-center rounded-full p-[3px] transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${checked ? 'bg-accent' : 'bg-raised'}`}>

      <span
        aria-hidden="true"
        className={`h-4 w-4 rounded-full transition-[transform,background-color] duration-150 ease-out ${checked ? 'translate-x-[14px] bg-ink' : 'translate-x-0 bg-muted'}`} />

    </button>);

}