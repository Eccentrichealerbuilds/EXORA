import type { BookLevel } from '../../types/trade';

interface OrderBookProps {
  asks: BookLevel[];
  bids: BookLevel[];
  mid: string;
  statusLabel: string;
  baseSymbol: string;
  quoteSymbol: string;
  onSelectPrice?: (price: string) => void;
}

export function OrderBook({ asks, bids, mid, statusLabel, baseSymbol, quoteSymbol, onSelectPrice }: OrderBookProps) {
  return (
    <section aria-label="Order book" className="flex flex-col gap-0.5 px-1 pb-1 pt-2">
      <div className="flex h-6 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">Order book</h2>
        <span className="text-micro font-medium text-muted">{statusLabel}</span>
      </div>
      <div className="flex h-5 items-center justify-between gap-2 text-micro font-medium text-muted">
        <span>Price ({quoteSymbol})</span>
        <span>Size ({baseSymbol})</span>
      </div>
      {asks.map((level) =>
      <BookRow key={level.price} level={level} side="ask" onSelect={onSelectPrice} />
      )}
      <div className="h-px bg-line" />
      <div className="flex h-[26px] items-center justify-center text-sm font-semibold text-fg">{mid}</div>
      <div className="h-px bg-line" />
      {bids.map((level) =>
      <BookRow key={level.price} level={level} side="bid" onSelect={onSelectPrice} />
      )}
    </section>);

}

interface BookRowProps {
  level: BookLevel;
  side: 'ask' | 'bid';
  onSelect?: (price: string) => void;
}

function BookRow({ level, side, onSelect }: BookRowProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(level.price)}
      aria-label={`${side === 'ask' ? 'Ask' : 'Bid'} ${level.price}, size ${level.size}`}
      className="relative flex h-[18px] items-center justify-between gap-1 text-book font-medium hover:bg-fg/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">

      <svg aria-hidden="true" viewBox="0 0 100 16" preserveAspectRatio="none" className="pointer-events-none absolute left-1/2 top-px h-4 w-[40%]">
        <rect width={Math.min(Math.max(level.depth, 0), 1) * 100} height={16} className={side === 'ask' ? 'fill-depth-ask' : 'fill-depth-bid'} />
      </svg>
      <span className={`relative ${side === 'ask' ? 'text-short' : 'text-long'}`}>{level.price}</span>
      <span className="relative text-fg">{level.size}</span>
    </button>);

}