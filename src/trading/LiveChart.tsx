import { useEffect, useRef, useState } from "react";
import { CandlestickSeries, HistogramSeries, ColorType, CrosshairMode, LineStyle, createChart,
  type IChartApi, type ISeriesApi, type Coordinate, type LogicalRange, type Time, type UTCTimestamp } from "lightweight-charts";
import { CrosshairIcon, ExpandIcon, Loader2Icon, RotateCwIcon, XIcon } from "lucide-react";
import type { Candle } from "./types";
import { useChartFullscreen } from "./chartFullscreen";
import "./chart.css";

export const chartIntervals = [60,300,900,1800,3600,7200,14400,28800,43200,86400].map(seconds => ({seconds,
  label: seconds < 3600 ? `${seconds/60}m` : seconds < 86400 ? `${seconds/3600}h` : "1D"}));
export function preferredChartInterval() {
  try { const saved = Number(localStorage.getItem("exora.chartInterval")); return chartIntervals.some(i => i.seconds === saved) ? saved : 900; } catch { return 900; }
}
export type ChartLevel = { id: string; price: number; label: string; color: string; onSelect?: () => void };
type Props = { candles: Candle[]; symbol: string; marketId: number; priceDecimals: number; resolution: number;
  onResolution: (value: number) => void; showVolume: boolean; onVolume: () => void;
  connected: boolean; loading: boolean; canLoadOlder: boolean; error: string; loadHistory: (older?: boolean) => Promise<void>; levels: ChartLevel[] };
const time = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
const valid = (c: Candle) => c.time > 0 && [c.open,c.high,c.low,c.close,c.volume].every(n => Number.isFinite(Number(n)));
const price = (c: Candle) => ({time: time(c.time), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close)});
const volume = (c: Candle) => ({time: time(c.time), value: Number(c.volume), color: Number(c.close) >= Number(c.open) ? "#77eac450" : "#ff8b9a50"});

export function LiveChart(props: Props) {
  const {candles, marketId, resolution, symbol, priceDecimals, showVolume, levels} = props;
  const wrapper = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumes = useRef<ISeriesApi<"Histogram"> | null>(null);
  const previous = useRef<Candle[]>([]);
  const latest = useRef(props); latest.current = props;
  const userNavigated = useRef(false);
  const savedRange = useRef<LogicalRange | null>(null);
  const [crosshair, setCrosshair] = useState<Candle | null>(null);
  const [away, setAway] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [intervalMenu, setIntervalMenu] = useState(false);
  const {fullscreen, open, close} = useChartFullscreen();
  const fmt = (n: string | number) => Number(n).toLocaleString(undefined, {maximumFractionDigits: priceDecimals});

  useEffect(() => {
    if (!host.current) return;
    const instance = createChart(host.current, {autoSize:true,
      layout:{background:{type:ColorType.Solid,color:"#0b0c15"},textColor:"#9f9db4",fontFamily:"system-ui",fontSize:10, attributionLogo:true},
      grid:{vertLines:{color:"#ffffff06"},horzLines:{color:"#ffffff09"}},
      crosshair:{mode:CrosshairMode.Normal,vertLine:{color:"#baa5ff80",labelBackgroundColor:"#40345d"},horzLine:{color:"#baa5ff80",labelBackgroundColor:"#40345d"}},
      rightPriceScale:{borderVisible:false,minimumWidth:65,scaleMargins:{top:.12,bottom:.2}},
      timeScale:{borderVisible:false,timeVisible:true,secondsVisible:false,rightOffset:6,barSpacing:7,shiftVisibleRangeOnNewBar:true},
      handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},
      handleScale:{axisPressedMouseMove:true,mouseWheel:true,pinch:true},
      localization:{priceFormatter:(value:number) => value.toLocaleString(undefined,{maximumFractionDigits:latest.current.priceDecimals})},
    });
    chart.current = instance;
    series.current = instance.addSeries(CandlestickSeries,{upColor:"#77eac4",downColor:"#ff8b9a",wickUpColor:"#77eac4",wickDownColor:"#ff8b9a",borderVisible:false,
      priceFormat:{type:"price",precision:priceDecimals,minMove:10**-priceDecimals}});
    volumes.current = instance.addSeries(HistogramSeries,{priceFormat:{type:"volume"},priceScaleId:"volume",priceLineVisible:false,lastValueVisible:false,visible:showVolume});
    volumes.current.priceScale().applyOptions({scaleMargins:{top:.82,bottom:0},visible:false});
    previous.current = []; savedRange.current = null; userNavigated.current = false; setCrosshair(null); setAway(false); setSelectedLevel(null);
    const rangeChanged = (range: LogicalRange | null) => {
      if (!range || !previous.current.length) return;
      savedRange.current = range;
      setAway(range.to < previous.current.length - 2);
      // Loading occurs only after a user reaches the left edge; no history polling.
      if (userNavigated.current && range.from < 10 && latest.current.canLoadOlder && !latest.current.loading && !latest.current.error) void latest.current.loadHistory(true);
    };
    instance.timeScale().subscribeVisibleLogicalRangeChange(rangeChanged);
    instance.subscribeCrosshairMove(event => {
      const point = event.seriesData.get(series.current!) as {time:Time;open?:number;high?:number;low?:number;close?:number} | undefined;
      if (!event.point || !point || point.open === undefined || typeof point.time !== "number") {setCrosshair(null); return;}
      const bar = previous.current.find(c => time(c.time) === point.time);
      setCrosshair(bar ?? null);
    });
    instance.subscribeClick(event => {
      if (!event.point || !series.current) return;
      const nearest = latest.current.levels.filter(l => l.onSelect).map(level => ({level,y:series.current!.priceToCoordinate(level.price)}))
        .filter((entry): entry is {level:ChartLevel;y:Coordinate} => entry.y !== null)
        .sort((a,b) => Math.abs(a.y-event.point!.y)-Math.abs(b.y-event.point!.y))[0];
      if (nearest && Math.abs(nearest.y-event.point.y)<16) setSelectedLevel(nearest.level.id);
    });
    return () => {instance.remove();chart.current=null;series.current=null;volumes.current=null;previous.current=[];};
  }, [marketId, resolution, priceDecimals]);

  useEffect(() => {
    const s = series.current, v = volumes.current, c = chart.current;
    if (!s || !v || !c) return;
    const bars = candles.filter(valid);
    if (!bars.length) return;
    const old = previous.current;
    const oldTimes = new Set(old.map(b => b.time));
    const lastOld = old[old.length-1]?.time ?? 0;
    // Older-page insertion requires setData; normal ticks update only changed bars.
    const structural = !old.length || bars[0].time !== old[0].time || bars.some(b => b.time < lastOld && !oldTimes.has(b.time));
    const range = c.timeScale().getVisibleLogicalRange();
    const inspectingHistory = range !== null && old.length > 0 && range.to < old.length - 2;
    previous.current = bars;
    if (structural) {
      s.setData(bars.map(price));v.setData(bars.map(volume));
      if (!old.length) c.timeScale().setVisibleLogicalRange({from:Math.max(0,bars.length-65),to:bars.length+5});
      else if (range) {
        const offset = bars.findIndex(b => b.time === old[0].time);
        if (offset >= 0) c.timeScale().setVisibleLogicalRange({from:range.from+offset,to:range.to+offset});
        else if (savedRange.current) c.timeScale().setVisibleLogicalRange(savedRange.current);
      }
    } else {
      const known = new Map(old.map(b => [b.time,b]));
      for (const bar of bars) {
        const before = known.get(bar.time);
        if (before && before.open===bar.open && before.close===bar.close && before.high===bar.high && before.low===bar.low && before.volume===bar.volume) continue;
        const historical = bar.time < lastOld;
        s.update(price(bar),historical);v.update(volume(bar),historical);
      }
      if (inspectingHistory && range) c.timeScale().setVisibleLogicalRange(range);
    }
  }, [candles, marketId, resolution, priceDecimals]);
  useEffect(() => { volumes.current?.applyOptions({visible:showVolume}); }, [showVolume,marketId,resolution,priceDecimals]);
  useEffect(() => {
    const s = series.current; if (!s) return;
    const lines = levels.filter(l => Number.isFinite(l.price) && l.price > 0).map(l => s.createPriceLine({price:l.price,color:l.color,lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:true,title:l.label}));
    return () => { if (series.current === s) for (const line of lines) s.removePriceLine(line); };
  }, [levels,marketId,resolution,priceDecimals]);
  useEffect(() => { if (fullscreen) {closeButton.current?.focus();chart.current?.applyOptions({handleScroll:{vertTouchDrag:true}});} else chart.current?.applyOptions({handleScroll:{vertTouchDrag:false}}); }, [fullscreen]);
  const selected = levels.find(l => l.id === selectedLevel);
  const inspected = crosshair ?? candles[candles.length-1];
  const chooseInterval = (value:number) => {props.onResolution(value);setIntervalMenu(false);try{localStorage.setItem("exora.chartInterval",String(value));}catch{/* Optional preference. */}};
  return <div ref={wrapper} className={`trading-chart ${fullscreen ? "trading-chart-fullscreen" : ""}`} role={fullscreen ? "dialog" : "region"} aria-modal={fullscreen || undefined} aria-label={`${symbol} trading chart`}
    onKeyDown={event => {
      if (!fullscreen || event.key !== "Tab") return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')];
      const first=buttons[0],last=buttons[buttons.length-1];
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
    }}>
    <div className="chart-toolbar">
      {fullscreen && <strong>{symbol}</strong>}
      <div className="chart-intervals">{[60,300,900,3600,14400,86400].map(value => <button key={value} type="button" aria-pressed={resolution===value} onClick={()=>chooseInterval(value)}>{chartIntervals.find(i=>i.seconds===value)!.label}</button>)}</div>
      <div className="chart-more"><button type="button" aria-expanded={intervalMenu} aria-label="More chart intervals" onClick={()=>setIntervalMenu(!intervalMenu)}>{[60,300,900,3600,14400,86400].includes(resolution) ? "•••" : chartIntervals.find(i=>i.seconds===resolution)?.label}</button>
        {intervalMenu && <div className="chart-interval-menu">{chartIntervals.map(item=><button type="button" key={item.seconds} aria-pressed={resolution===item.seconds} onClick={()=>chooseInterval(item.seconds)}>{item.label}</button>)}</div>}</div>
      <button type="button" aria-pressed={showVolume} aria-label="Toggle chart volume" onClick={props.onVolume} className="chart-volume">Vol</button>
      {fullscreen ? <button ref={closeButton} type="button" aria-label="Exit fullscreen chart" onClick={()=>close()}><XIcon size={18}/></button> : <button type="button" aria-label="Open fullscreen landscape chart" onClick={()=>open(wrapper.current)}><ExpandIcon size={17}/></button>}
    </div>
    <div className="chart-readout" aria-live="off">{inspected ? <><span>O <b>{fmt(inspected.open)}</b></span><span>H <b>{fmt(inspected.high)}</b></span><span>L <b>{fmt(inspected.low)}</b></span><span>C <b>{fmt(inspected.close)}</b></span>{showVolume && <span>Vol <b>{Number(inspected.volume).toLocaleString(undefined,{maximumFractionDigits:2})} AUSD</b></span>}</> : <span>{symbol} · Perpl candles</span>}</div>
    <div className="chart-canvas-wrap"><div ref={host} className="chart-canvas" onPointerDown={()=>{userNavigated.current=true;}} onWheel={()=>{userNavigated.current=true;}}/>
      {!candles.length && <div className="chart-empty">{props.loading ? <><Loader2Icon className="animate-spin" size={20}/>Loading chart…</> : <><CrosshairIcon size={20}/>{props.error ? "Chart unavailable" : "No candles in this interval"}<button type="button" onClick={()=>void props.loadHistory()}>Retry</button></>}</div>}
      {away && <button type="button" className="chart-live" onClick={()=>chart.current?.timeScale().scrollToRealTime()}><CrosshairIcon size={13}/> Return to live</button>}
      {selected && <div className="chart-level-detail"><span style={{color:selected.color}}>{selected.label} · {fmt(selected.price)}</span><button type="button" onClick={()=>{close(selected.onSelect);setSelectedLevel(null);}}>Manage</button><button type="button" aria-label="Dismiss chart order" onClick={()=>setSelectedLevel(null)}><XIcon size={14}/></button></div>}
    </div>
    <div className="chart-footer"><span className={props.connected ? "chart-connected" : "chart-stale"}>{props.connected ? "● Live" : "● Reconnecting · prices may be stale"}</span>
      {props.loading ? <span className="chart-loading"><Loader2Icon size={11} className="animate-spin"/> Loading history</span> : props.error ? <button type="button" title={props.error} onClick={()=>void props.loadHistory()}>History unavailable · Retry</button> : <button type="button" disabled={!props.canLoadOlder} onClick={()=>void props.loadHistory(true)}>{props.canLoadOlder ? "Older candles" : "History limit reached"}</button>}
    </div>
    {fullscreen && <span className="chart-rotate-hint"><RotateCwIcon size={13}/> Rotate your screen for a wider view</span>}
    <details className="chart-attribution" draggable={false}><summary draggable={false}>Chart credits</summary><a draggable={false} href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc.</a></details>
  </div>;
}
