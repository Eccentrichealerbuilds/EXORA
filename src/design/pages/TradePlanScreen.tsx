import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { KeyValueRow } from '../components/ui/KeyValueRow';
import { Stat } from '../components/ui/Stat';
import { TitleBand } from '../components/ui/TitleBand';

interface Row {
  label: string;
  value?: string | null;
}

interface TradePlanScreenProps {
  /** e.g. "BTC / USD · Long · 5×" */
  summary: string;
  levels: {entry: string;stop: string;target: string;};
  outcome: {atStop: string;atTarget: string;lossAmount: number;gainAmount: number;};
  calculations: Row[];
  quoteStatus: string;
  execution: Row[];
  /** Order lifecycle states reported by the application, e.g. "Not submitted" */
  protection: {label: string;status: string;}[];
  onRefreshReview: () => void;
}

export function TradePlanScreen({ summary, levels, outcome, calculations, quoteStatus, execution, protection, onRefreshReview }: TradePlanScreenProps) {
  const total = Math.max(outcome.lossAmount + outcome.gainAmount, 1);
  const lossWidth = outcome.lossAmount / total * 100;

  return (
    <>
      <TitleBand eyebrow="TRADE PLANNER" title="Review your plan" subtitle={summary} action={<Chip tone="ink">Draft</Chip>} />
      <div className="flex flex-col gap-2 px-[18px] py-3">
        <div className="flex h-11 items-center gap-3">
          <Stat size="sm" label="Entry" value={levels.entry} />
          <Stat size="sm" label="Stop" value={levels.stop} />
          <Stat size="sm" label="Target" value={levels.target} />
        </div>

        <section aria-labelledby="outcome-heading" className="flex flex-col gap-1.5">
          <h2 id="outcome-heading" className="text-sm font-semibold text-fg">
            Estimated outcome
          </h2>
          <p className="text-micro font-medium text-muted">Before fees, funding and slippage</p>
          <svg aria-hidden="true" viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 w-full">
            <rect x={0} y={2.5} width={lossWidth} height={3} className="fill-short" />
            <rect x={lossWidth} y={0} width={0.85} height={8} className="fill-accent" />
            <rect x={lossWidth + 0.85} y={2.5} width={100 - lossWidth - 0.85} height={3} className="fill-long" />
          </svg>
          <div className="flex h-[34px] items-center justify-between gap-2">
            <Stat size="sm" label="At stop" value={outcome.atStop} tone="short" />
            <Stat size="sm" label="Entry" value={levels.entry} align="center" />
            <Stat size="sm" label="At target" value={outcome.atTarget} tone="long" align="end" />
          </div>
        </section>

        <div className="divide-y divide-line">
          {calculations.map((row) =>
          <KeyValueRow key={row.label} label={row.label} value={row.value} />
          )}
        </div>

        <section aria-labelledby="execution-heading">
          <div className="flex h-[26px] items-center justify-between gap-2">
            <h2 id="execution-heading" className="text-sm font-semibold text-fg">
              Execution preview
            </h2>
            <Chip>{quoteStatus}</Chip>
          </div>
          {execution.map((row) =>
          <KeyValueRow key={row.label} label={row.label} value={row.value} className="h-6" />
          )}
        </section>

        <section aria-labelledby="protection-heading">
          <h2 id="protection-heading" className="text-sm font-semibold text-fg">
            Order &amp; protection
          </h2>
          {protection.map((row) =>
          <div key={row.label} className="flex h-[27px] items-center justify-between gap-2">
              <span className="text-xs text-muted">{row.label}</span>
              <span className="flex h-[26px] w-[100px] items-center gap-1.5 bg-surface p-1.5 text-micro font-medium text-muted">
                <span aria-hidden="true" className="h-1 w-1 rounded-full bg-muted" />
                {row.status}
              </span>
            </div>
          )}
        </section>

        <Button onClick={onRefreshReview}>Refresh &amp; review</Button>
        <p className="text-center text-micro font-medium text-muted">Final terms appear before your passkey approval.</p>
      </div>
    </>);

}