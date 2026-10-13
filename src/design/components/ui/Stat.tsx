
interface StatProps {
  label: string;
  /** Unknown values render as "—" */
  value?: string | null;
  tone?: 'default' | 'long' | 'short';
  size?: 'lg' | 'sm';
  align?: 'start' | 'center' | 'end';
}

const TONES = { default: 'text-fg', long: 'text-long', short: 'text-short' };
const ALIGN = { start: 'items-start text-left', center: 'items-center text-center', end: 'items-end text-right' };

export function Stat({ label, value, tone = 'default', size = 'lg', align = 'start' }: StatProps) {
  return (
    <div className={`flex min-w-0 flex-1 flex-col ${size === 'lg' ? 'gap-[3px]' : 'gap-0.5'} ${ALIGN[align]}`}>
      <span className="text-micro font-medium text-muted">{label}</span>
      <span className={`${size === 'lg' ? 'text-lg font-semibold' : 'text-xs font-medium'} ${TONES[tone]}`}>
        {value ?? '—'}
      </span>
    </div>);

}