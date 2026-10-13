import { ArrowRightIcon, ArrowUpRightIcon, DropletIcon, RotateCwIcon, SendIcon } from 'lucide-react';
import { AssetBadge } from '../components/ui/AssetBadge';
import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { IconButton } from '../components/ui/IconButton';

export interface TokenBalance {
  symbol: string;
  name: string;
  amount: string;
  value: string;
}

export interface MarketQuote {
  symbol: string;
  name: string;
  price: string;
}

interface HomeScreenProps {
  totalValue: string;
  balancesReady?: boolean;
  refreshing?: boolean;
  networkLabel: string;
  balances: TokenBalance[];
  markets: MarketQuote[];
  pricesNote: string;
  faucetToken: string;
  onRefresh: () => void;
  onTransfer: () => void;
  onSend: (symbol: string) => void;
  onFaucet: () => void;
  onOpenMarket: (symbol: string) => void;
  onDataSaver: () => void;
}

export function HomeScreen(props: HomeScreenProps) {
  const { totalValue, networkLabel, balances, markets, pricesNote, faucetToken } = props;

  return (
    <>
      <section aria-label="Wallet summary" className="flex flex-col gap-1 bg-accent px-[18px] py-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-ink">ESTIMATED TOTAL</p>
          <IconButton label={props.refreshing ? "Updating balances" : "Refresh balances"} disabled={props.refreshing} tone="ink" className="h-8 w-8" onClick={props.onRefresh}>
            <RotateCwIcon className={`h-5 w-5 ${props.refreshing ? "animate-spin" : ""}`} strokeWidth={1.7} />
          </IconButton>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex min-w-0 max-w-full flex-auto flex-col gap-1">
            <p className="text-hero font-bold text-ink [overflow-wrap:anywhere]">{totalValue}</p>
            <p className="text-xs text-ink">{networkLabel}</p>
          </div>
          <Button variant="dark" disabled={props.balancesReady === false} className="ml-auto w-[110px] shrink-0" onClick={props.onTransfer}>
            Transfer
            <ArrowUpRightIcon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
          </Button>
        </div>
      </section>

      <div className="flex flex-col px-[18px] py-2">
        <ul aria-label="Token balances" className="divide-y divide-line border-b border-line">
          {balances.map((token) =>
          <li key={token.symbol} className="grid min-h-16 grid-cols-[32px_minmax(0,1fr)_minmax(0,1.5fr)_40px] items-center gap-3 py-3">
              <AssetBadge symbol={token.symbol} kind="token" size="md" />
              <div className="flex min-w-0 flex-col [overflow-wrap:anywhere]">
                <span className="text-sm font-semibold text-fg">{token.symbol}</span>
                <span className="text-xs text-muted">{token.name}</span>
              </div>
              <div className="flex min-w-0 flex-col text-right [overflow-wrap:anywhere]">
                <span className="text-lg font-semibold leading-snug text-fg">{token.amount}</span>
                <span className="text-xs text-muted">{token.value}</span>
              </div>
              <IconButton label={`Send ${token.symbol}`} disabled={props.balancesReady === false} tone="line" onClick={() => props.onSend(token.symbol)}>
                <SendIcon className="h-5 w-5" strokeWidth={1.7} />
              </IconButton>
            </li>
          )}
        </ul>

        <button
          type="button"
          onClick={props.onFaucet}
          className="mt-3 flex h-[52px] items-center gap-3 rounded border border-accent px-3 py-2 text-left transition-colors duration-150 hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">

          <DropletIcon aria-hidden="true" className="h-6 w-6 text-accent" strokeWidth={1.7} />
          <span className="flex flex-1 flex-col">
            <span className="text-sm font-semibold text-fg">Get testnet {faucetToken}</span>
            <span className="text-xs text-muted">Agora faucet</span>
          </span>
          <ArrowRightIcon aria-hidden="true" className="h-5 w-5 text-accent" strokeWidth={1.7} />
        </button>

        <section aria-labelledby="markets-heading" className="mt-4">
          <div className="flex h-8 items-center justify-between gap-2">
            <h2 id="markets-heading" className="text-sm font-semibold text-fg">
              All Perpetual Markets
            </h2>
            <Chip onClick={props.onDataSaver} className="w-20">
              Data saver
            </Chip>
          </div>
          <div className="flex h-6 items-center justify-between border-b border-line text-micro font-medium text-muted">
            <span>MARKET</span>
            <span>PRICE</span>
          </div>
          <ul>
            {markets.map((market) =>
            <li key={market.symbol}>
                <button
                type="button"
                onClick={() => props.onOpenMarket(market.symbol)}
                className="flex h-[46px] w-full items-center gap-3 border-b border-line text-left transition-colors duration-150 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">

                  <AssetBadge symbol={market.symbol} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-semibold text-fg">{market.name}</span>
                    <span className="text-micro font-medium text-muted">{market.symbol}</span>
                  </span>
                  <span className="text-sm font-medium text-fg">{market.price}</span>
                </button>
              </li>
            )}
          </ul>
          <p className="mt-2.5 text-xs text-muted">{pricesNote}</p>
        </section>
      </div>
    </>);

}
