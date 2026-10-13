import React from 'react';
import { DiamondIcon } from 'lucide-react';

interface AssetBadgeProps {
  symbol: string;
  /** MON renders as a lettered token on balances and as the Monad mark in market lists */
  kind?: 'token' | 'market';
  size?: 'sm' | 'md';
}

const SIZES = { sm: 'h-7 w-7', md: 'h-8 w-8' };
const LETTER = 'text-lg font-semibold';

export function AssetBadge({ symbol, kind = 'market', size = 'sm' }: AssetBadgeProps) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full ${SIZES[size]} ${badgeClass(symbol, kind)}`}>

      {glyph(symbol, kind)}
    </span>);

}

function badgeClass(symbol: string, kind: 'token' | 'market') {
  switch (symbol) {
    case 'AUSD':
      return 'bg-accent text-fg';
    case 'MON':
      return kind === 'token' ? 'bg-monad text-fg' : 'bg-canvas';
    case 'BTC':
      return 'bg-asset-btc text-fg';
    case 'ETH':
      return 'bg-asset-eth';
    case 'SOL':
      return 'bg-canvas';
    case 'ZEC':
      return 'bg-asset-zec text-ink';
    case 'LIT':
      return 'bg-fg text-ink';
    default:
      return 'bg-raised text-fg';
  }
}

function glyph(symbol: string, kind: 'token' | 'market'): React.ReactNode {
  if (symbol === 'BTC') return <span className={LETTER}>₿</span>;
  if (symbol === 'ETH') {
    return (
      <svg viewBox="0 0 20 28" className="h-7 w-5">
        <path d="M10 1 18 14.5 10 19.5 2 14.5Z" className="fill-fg stroke-accent" strokeWidth={0.5} />
        <path d="M10 21.5 18 16.5 10 27 2 16.5Z" className="fill-fg" />
      </svg>);

  }
  if (symbol === 'SOL') {
    return (
      <span className="flex w-[23px] flex-col gap-[3px]">
        <span className="h-1 bg-long" />
        <span className="h-1 bg-accent" />
        <span className="h-1 bg-long" />
      </span>);

  }
  if (symbol === 'MON' && kind === 'market') {
    return <DiamondIcon className="h-6 w-6 text-accent" strokeWidth={1.7} />;
  }
  return <span className={LETTER}>{symbol.charAt(0)}</span>;
}