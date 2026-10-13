import React, { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { Tabs } from '../components/ui/Tabs';

export type Period = '1D' | '1W' | '1M' | 'All';
export type HealthTool = 'liquidation' | 'protection' | 'margin';

interface PortfolioScreenProps {
  collateralSymbol: string;
  networkLabel: string;
  /** Unknown values render as "—" */
  account: {equity?: string | null;available?: string | null;locked?: string | null;walletBalance?: string | null;};
  performance: {netPnl?: string | null;equity?: string | null;};
  period: Period;
  onPeriodChange: (period: Period) => void;
  accountConnected: boolean;
  selectedTab?: "positions" | "orders";
  onTabChange?: (tab: "positions" | "orders") => void;
  performanceChart?: React.ReactNode;
  positionsContent?: React.ReactNode;
  ordersContent?: React.ReactNode;
  onDeposit: () => void;
  onWithdraw: () => void;
  onOpenHealthTool: (tool: HealthTool) => void;
}

const PERIODS: Period[] = ['1D', '1W', '1M', 'All'];

export function PortfolioScreen(props: PortfolioScreenProps) {
  const { account, collateralSymbol, accountConnected } = props;
  const [localTab, setLocalTab] = useState<'positions' | 'orders'>('positions');
  const tab = props.selectedTab ?? localTab;
  const setTab = props.onTabChange ?? setLocalTab;
  const tabContent = tab === 'positions' ? props.positionsContent : props.ordersContent;

  return (
    <>
      <section aria-label="Perpl account" className="flex flex-col gap-1 bg-accent px-[18px] py-3.5">
        <div className="flex h-6 items-center justify-between">
          <p className="text-micro font-medium text-ink">PERPL ACCOUNT</p>
          <Chip tone="ink">{collateralSymbol}</Chip>
        </div>
        <p className="text-quote font-semibold text-ink">
          {account.equity ?? '—'} {collateralSymbol}
        </p>
        <p className="text-xs text-ink">{props.networkLabel}</p>
        <div className="flex gap-7 py-0">
          {[
          { label: 'Available', value: account.available },
          { label: 'Locked margin', value: account.locked }].
          map((item) =>
          <div key={item.label} className="flex flex-1 flex-col gap-1">
              <span className="text-xs text-ink-muted">{item.label}</span>
              <span className="text-lg font-semibold text-ink">{item.value ?? '—'}</span>
            </div>
          )}
        </div>
        <div className="flex h-5 items-center justify-between text-xs text-ink">
          <span>Wallet balance</span>
          <span className="font-medium">
            {account.walletBalance ?? '—'} {collateralSymbol}
          </span>
        </div>
        <div className="flex gap-2.5">
          <Button variant="dark" className="flex-1" onClick={props.onDeposit}>
            Deposit
          </Button>
          <Button variant="outlineInk" className="flex-1" onClick={props.onWithdraw}>
            Withdraw
          </Button>
        </div>
      </section>

      <div className="flex flex-col gap-2.5 px-5 pb-3 pt-4">
        <div className="flex h-6 items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-fg">Performance</h2>
          <div role="radiogroup" aria-label="Performance period" className="flex items-center gap-3">
            {PERIODS.map((value) =>
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={value === props.period}
              onClick={() => props.onPeriodChange(value)}
              className={`text-micro font-medium transition-colors duration-150 ${value === props.period ? 'text-accent' : 'text-muted hover:text-fg'}`}>

                {value}
              </button>
            )}
          </div>
        </div>
        {accountConnected && props.performanceChart ?
        props.performanceChart :

        <div className="flex h-[62px] flex-col">
            <div className="h-px bg-line" />
            <p className="flex flex-1 items-center justify-center text-micro font-medium text-muted">Performance syncs automatically</p>
            <div className="h-px bg-line" />
            <div className="flex-1" />
            <div className="h-px bg-line" />
          </div>
        }

        <Tabs
          label="Account orders"
          items={[
          { value: 'positions', label: 'Open positions' },
          { value: 'orders', label: 'Open orders' }]
          }
          value={tab}
          onChange={setTab} />

        {accountConnected && tabContent ?
        tabContent :

<p role="status" className="py-6 text-center text-xs text-muted">Your positions and orders will appear here automatically.</p>

        }

        <section aria-labelledby="health-heading" className="flex flex-col gap-1.5">
          <h2 id="health-heading" className="text-xs font-medium text-fg">
            Position health
          </h2>
          <div className="flex gap-1.5">
            <Chip tone="filled" onClick={() => props.onOpenHealthTool('liquidation')}>
              Liquidation distance
            </Chip>
            <Chip tone="filled" onClick={() => props.onOpenHealthTool('protection')}>
              SL / TP
            </Chip>
            <Chip tone="filled" onClick={() => props.onOpenHealthTool('margin')}>
              Margin
            </Chip>
          </div>
          {!accountConnected && <p className="text-micro font-medium text-muted">Available after connection.</p>}
        </section>
      </div>
    </>);

}