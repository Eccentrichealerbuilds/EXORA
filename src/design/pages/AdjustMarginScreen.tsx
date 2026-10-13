import { ArrowLeftIcon, ShieldIcon } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { IconButton } from '../components/ui/IconButton';
import { KeyValueRow } from '../components/ui/KeyValueRow';
import { SelectField, SelectOption } from '../components/ui/SelectField';
import { Tabs } from '../components/ui/Tabs';
import { TextField } from '../components/ui/TextField';
import { TitleBand } from '../components/ui/TitleBand';

type MarginMode = 'add' | 'remove';
type Metric = {before?: string | null;after?: string | null;};

interface AdjustMarginScreenProps {
  mode: MarginMode;
  onModeChange: (mode: MarginMode) => void;
  disabled?: boolean;
  quickAmountsEnabled?: boolean;
  collateralSymbol: string;
  feeSymbol: string;
  positions: SelectOption[];
  positionId: string;
  onPositionChange: (id: string) => void;
  accountConnected: boolean;
  amount: string;
  onAmountChange: (amount: string) => void;
  available?: string | null;
  networkFee?: string | null;
  /** Before/after previews computed by the application */
  preview: {positionMargin?: Metric;leverage?: Metric;liquidationPrice?: Metric;liquidationDistance?: Metric;};
  onQuickAmount: (fraction: 0.25 | 0.5 | 1) => void;
  onSubmit: (request: {positionId: string;mode: MarginMode;amount: string;}) => void;
  onBack: () => void;
}

const QUICK_AMOUNTS = [
{ label: '25%', fraction: 0.25 },
{ label: '50%', fraction: 0.5 },
{ label: 'Max', fraction: 1 }] as
const;

export function AdjustMarginScreen(props: AdjustMarginScreenProps) {
  const { preview, collateralSymbol, positionId } = props;
  const mode = props.mode;
  const setMode = props.onModeChange;
  const rows = [
  { label: 'Position margin', metric: preview.positionMargin },
  { label: 'Effective leverage', metric: preview.leverage },
  { label: 'Liquidation price', metric: preview.liquidationPrice },
  { label: 'Distance to liquidation', metric: preview.liquidationDistance }];


  return (
    <>
      <TitleBand
        eyebrow="POSITION HEALTH"
        title="Adjust margin"
        action={
        <IconButton label="Back" tone="ink" onClick={props.onBack}>
            <ArrowLeftIcon className="h-5 w-5" strokeWidth={1.7} />
          </IconButton>
        } />

      <div className="flex flex-col gap-1.5 px-[18px] py-3">
        <SelectField
          hideLabel
          label="Position"
          placeholder="Choose an open position"
          value={positionId}
          options={props.positions}
          onChange={props.onPositionChange}
          disabled={!props.positions.length} />

        {!props.accountConnected && <p className="text-micro font-medium text-muted">Positions sync automatically</p>}
        <Tabs
          label="Margin action"
          items={[
          { value: 'add', label: 'Add margin' },
          { value: 'remove', label: 'Remove margin' }]
          }
          value={mode}
          onChange={setMode} />

        <TextField label="Amount" value={props.amount} onChange={props.onAmountChange} suffix={collateralSymbol} />
        <div className="flex h-7 items-center justify-between gap-2">
          <span className="whitespace-pre text-micro font-medium text-muted">
            Available  {props.available ?? '—'} {collateralSymbol}
          </span>
          <div className="flex gap-1.5">
            {props.quickAmountsEnabled && QUICK_AMOUNTS.map((q) =>
            <Chip key={q.label} tone="filled" className="w-[42px]" onClick={() => props.onQuickAmount(q.fraction)}>
                {q.label}
              </Chip>
            )}
          </div>
        </div>

        <table className="w-full text-left">
          <thead>
            <tr className="h-[26px] text-micro font-medium">
              <th scope="col" className="w-[48%]">
                <span className="sr-only">Metric</span>
              </th>
              <th scope="col" className="text-right text-muted">
                Before
              </th>
              <th scope="col" className="text-right text-accent">
                After
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, metric }) =>
            <tr key={label} className="h-[34px] border-b border-line text-xs">
                <th scope="row" className="font-normal text-muted">
                  {label}
                </th>
                <td className="text-right text-fg">{metric?.before ?? '—'}</td>
                <td className="w-[104px] bg-accent-tint p-2 text-right text-accent">{metric?.after ?? '—'}</td>
              </tr>
            )}
          </tbody>
        </table>

        <section aria-labelledby="risk-heading" className="flex flex-col gap-2 pt-1.5">
          <h2 id="risk-heading" className="text-xs font-medium text-fg">
            Liquidation risk (estimated)
          </h2>
          <div className="h-[3px] bg-line" />
          {!positionId && <p className="text-micro font-medium text-muted">Select a position to preview the change.</p>}
        </section>

        <div className="flex items-center gap-2.5 bg-surface p-2">
          <ShieldIcon aria-hidden="true" className="h-[22px] w-[22px] shrink-0 text-accent" strokeWidth={1.7} />
          <p className="text-micro font-medium text-muted">
            Add collateral to increase your liquidation buffer. Estimates update with mark price and funding.
          </p>
        </div>
        <KeyValueRow label="Network fee" value={`${props.networkFee ?? '—'} ${props.feeSymbol}`} className="h-6" />
        <p className="text-micro font-medium text-muted">Position size stays unchanged.</p>
        <Button
          disabled={props.disabled || !positionId || !props.amount.trim()}
          onClick={() => props.onSubmit({ positionId, mode, amount: props.amount })}>

          {!positionId ? 'Select a position' : mode === 'add' ? 'Review add margin' : 'Review removal request'}
        </Button>
      </div>
    </>);

}