import { ChartCandlestickIcon, FileTextIcon, HouseIcon, WalletIcon } from 'lucide-react';

export type NavTab = 'home' | 'trade' | 'portfolio' | 'activity';

interface BottomNavProps {
  active: NavTab;
  onNavigate: (tab: NavTab) => void;
}

const TABS = [
{ value: 'home', label: 'Home', Icon: HouseIcon },
{ value: 'trade', label: 'Trade', Icon: ChartCandlestickIcon },
{ value: 'portfolio', label: 'Portfolio', Icon: WalletIcon },
{ value: 'activity', label: 'Activity', Icon: FileTextIcon }] as
const;

export function BottomNav({ active, onNavigate }: BottomNavProps) {
  return (
    <nav
      aria-label="Primary"
      className="grid min-h-20 shrink-0 grid-cols-4 border-t border-line bg-canvas pb-[env(safe-area-inset-bottom)]">

      {TABS.map(({ value, label, Icon }) => {
        const isActive = value === active;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onNavigate(value)}
            aria-current={isActive ? 'page' : undefined}
            className={`relative flex flex-col items-center gap-[5px] pt-[15px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${isActive ? 'text-accent' : 'text-muted hover:text-fg'}`}>

            {isActive && <span aria-hidden="true" className="absolute top-0 h-[3px] w-10 bg-accent" />}
            <Icon aria-hidden="true" className="h-[22px] w-[22px]" strokeWidth={1.7} />
            <span className="text-xs font-medium">{label}</span>
          </button>);

      })}
    </nav>);

}