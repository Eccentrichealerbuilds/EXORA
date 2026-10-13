
interface TabItem<T extends string> {
  value: T;
  label: string;
}

interface TabsProps<T extends string> {
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'md' | 'sm';
}

export function Tabs<T extends string>({ label, items, value, onChange, size = 'md' }: TabsProps<T>) {
  return (
    <div role="tablist" aria-label={label} className="flex">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={`relative flex flex-1 items-center justify-center text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${size === 'md' ? 'h-10' : 'h-8'} ${active ? 'text-fg' : 'text-muted hover:text-fg'}`}>

            {item.label}
            {active && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />}
          </button>);

      })}
    </div>);

}