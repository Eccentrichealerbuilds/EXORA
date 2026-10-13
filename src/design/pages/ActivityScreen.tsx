import React, { useState } from 'react';
import { DatabaseIcon, RotateCwIcon } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { SelectField, SelectOption } from '../components/ui/SelectField';
import { Stat } from '../components/ui/Stat';
import { Tabs } from '../components/ui/Tabs';
import { TitleBand } from '../components/ui/TitleBand';

interface ActivityScreenProps {
  marketOptions: SelectOption[];
  market: string;
  onMarketChange: (market: string) => void;
  periodOptions: SelectOption[];
  period: string;
  onPeriodChange: (period: string) => void;
  /** Unknown values render as "—" */
  results: {realizedPnl?: string | null;fees?: string | null;funding?: string | null;};
  accountConnected: boolean;
  timelineContent?: React.ReactNode;
  journalContent?: React.ReactNode;
  onRefresh: () => void;
}

export function ActivityScreen(props: ActivityScreenProps) {
  const [tab, setTab] = useState<'timeline' | 'journal'>('timeline');
  const content = tab === 'timeline' ? props.timelineContent : props.journalContent;

  return (
    <div className="flex min-h-full flex-col">
      <TitleBand
        eyebrow="ACCOUNT HISTORY"
        title="Activity"
        subtitle="Orders, transfers and your trading journal"
        action={
        <IconButton label="Refresh activity" tone="ink" onClick={props.onRefresh}>
            <RotateCwIcon className="h-5 w-5" strokeWidth={1.7} />
          </IconButton>
        } />

      <div className="flex flex-1 flex-col gap-3.5 px-5 pb-5 pt-3">
        <Tabs
          label="History view"
          items={[
          { value: 'timeline', label: 'Timeline' },
          { value: 'journal', label: 'Journal' }]
          }
          value={tab}
          onChange={setTab} />

        <div className="flex gap-2.5">
          <SelectField className="flex-1" label="Market" value={props.market} options={props.marketOptions} onChange={props.onMarketChange} />
          <SelectField className="flex-1" label="Period" value={props.period} options={props.periodOptions} onChange={props.onPeriodChange} />
        </div>
        {Object.values(props.results).some(value => value != null) && <div className="flex gap-3.5 border-b border-line pb-3.5">
          <Stat label="Realized PnL" value={props.results.realizedPnl} />
          <Stat label="Fees" value={props.results.fees} />
          <Stat label="Funding" value={props.results.funding} />
        </div>}

        {props.accountConnected && content ?
        content :

        <div className="py-4">
<p role="status" className="py-6 text-center text-xs text-muted">Your account history will appear here automatically.</p>

          </div>
        }

        <div className="mt-auto flex items-center gap-3 rounded-md bg-surface p-3">
          <DatabaseIcon aria-hidden="true" className="h-6 w-6 shrink-0 text-accent" strokeWidth={1.7} />
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-fg">History loads on demand</p>
            <p className="text-xs text-muted">Recent activity is saved on this device.</p>
          </div>
        </div>
      </div>
    </div>);

}