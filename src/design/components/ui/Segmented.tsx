
interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  activeClassName: string;
}

interface SegmentedProps<T extends string> {
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  inactiveClassName: string;
  itemClassName?: string;
  className?: string;
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  inactiveClassName,
  itemClassName = 'h-7 rounded',
  className = ''
}: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={`flex ${className}`}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`flex flex-1 items-center justify-center whitespace-nowrap p-1 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${itemClassName} ${active ? `font-medium ${option.activeClassName}` : `${inactiveClassName} hover:text-fg`}`}>

            {option.label}
          </button>);

      })}
    </div>);

}