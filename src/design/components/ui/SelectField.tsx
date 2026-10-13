import React, { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T | '';
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  /**
   * stacked: label above a bordered box · inline: label inside the box ·
   * plain: borderless label/value row · preference: title with value as description
   */
  layout?: 'stacked' | 'inline' | 'plain' | 'preference';
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select',
  layout = 'stacked',
  hideLabel = false,
  disabled = false,
  className = ''
}: SelectFieldProps<T>) {
  const id = useId();
  const labelId = `${id}-label`;
  const listId = `${id}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const display = options[selectedIndex]?.label ?? placeholder;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const openMenu = () => {
    if (disabled || !options.length) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return openMenu();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((i) => (i + delta + options.length) % options.length);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      choose(activeIndex);
    }
  };

  const chevron = (size: string, color: string) =>
  <ChevronDownIcon
    aria-hidden="true"
    className={`${size} ${color} shrink-0 transition-transform duration-150 ease-out ${open ? 'rotate-180' : ''}`}
    strokeWidth={1.7} />;



  const triggerBase = `relative w-full text-left disabled:cursor-not-allowed focus-visible:outline-none`;
  const triggerProps = {
    type: 'button' as const,
    disabled,
    'aria-haspopup': 'listbox' as const,
    'aria-expanded': open,
    'aria-controls': listId,
    'aria-labelledby': `${labelId} ${id}-value`,
    'aria-activedescendant': open && activeIndex >= 0 ? `${id}-opt-${activeIndex}` : undefined,
    onClick: () => open ? setOpen(false) : openMenu(),
    onKeyDown: handleKeyDown
  };
  const valueClass = selectedIndex >= 0 ? 'text-fg' : 'text-muted';

  let trigger: React.ReactNode;
  if (layout === 'plain') {
    trigger =
    <button {...triggerProps} className={`${triggerBase} flex h-full items-center justify-between gap-2 rounded focus-visible:ring-2 focus-visible:ring-accent`}>
        <span id={labelId} className="text-xs text-muted">{label}</span>
        <span id={`${id}-value`} className={`flex items-center gap-1 text-xs font-medium ${valueClass}`}>
          {display}
          {chevron('h-3 w-3', 'text-muted')}
        </span>
      </button>;

  } else if (layout === 'inline') {
    trigger =
    <button
      {...triggerProps}
      className={`${triggerBase} flex h-10 items-center justify-between gap-2 rounded border px-2 transition-colors duration-150 focus-visible:border-accent ${open ? 'border-accent' : 'border-line hover:border-muted'}`}>

        <span id={labelId} className="text-xs text-muted">{label}</span>
        <span id={`${id}-value`} className={`flex items-center gap-1.5 text-xs font-medium ${valueClass}`}>
          {display}
          {chevron('h-3.5 w-3.5', 'text-accent')}
        </span>
      </button>;

  } else if (layout === 'preference') {
    trigger =
    <button {...triggerProps} className={`${triggerBase} flex min-h-[46px] items-center justify-between gap-2 rounded focus-visible:ring-2 focus-visible:ring-accent`}>
        <span className="flex flex-col gap-[3px]">
          <span id={labelId} className="text-xs font-medium text-fg">{label}</span>
          <span id={`${id}-value`} className="text-micro font-medium text-muted">{display}</span>
        </span>
        {chevron('h-4 w-4', 'text-accent')}
      </button>;

  } else {
    trigger =
    <>
        <span id={labelId} className={hideLabel ? 'sr-only' : 'text-micro font-medium text-muted'}>
          {label}
        </span>
        <button
        {...triggerProps}
        className={`${triggerBase} flex items-center justify-between gap-2 rounded border px-2.5 transition-colors duration-150 focus-visible:border-accent ${hideLabel ? 'h-[42px]' : 'h-10'} ${open ? 'border-accent' : 'border-line enabled:hover:border-muted'}`}>

          <span id={`${id}-value`} className={`truncate text-xs font-medium ${valueClass}`}>{display}</span>
          {chevron('h-4 w-4', 'text-accent')}
        </button>
      </>;

  }

  const fullWidthMenu = layout === 'stacked' || layout === 'preference';

  return (
    <div ref={rootRef} className={`relative flex min-w-0 flex-col gap-[5px] ${className}`}>
      {trigger}
      <AnimatePresence>
        {open &&
        <motion.ul
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          initial={{ opacity: 0, y: -4, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.96 }}
          transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
          className={`absolute top-full z-30 mt-1 max-h-60 origin-top overflow-y-auto rounded border border-line bg-surface p-1 shadow-[0_12px_32px_rgba(0,0,0,0.6)] ${fullWidthMenu ? 'inset-x-0' : 'right-0 min-w-[148px]'}`}>

            {options.map((option, index) => {
            const selected = index === selectedIndex;
            const active = index === activeIndex;
            return (
              <li
                key={option.value}
                id={`${id}-opt-${index}`}
                role="option"
                aria-selected={selected}
                onPointerEnter={() => setActiveIndex(index)}
                onClick={() => choose(index)}
                className={`flex h-9 cursor-pointer items-center justify-between gap-3 rounded-[3px] px-2 text-xs transition-colors duration-100 ${active ? 'bg-raised' : ''} ${selected ? 'font-medium text-accent' : 'text-fg'}`}>

                  <span className="whitespace-nowrap">{option.label}</span>
                  {selected && <CheckIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
                </li>);

          })}
          </motion.ul>
        }
      </AnimatePresence>
    </div>);

}