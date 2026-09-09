"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronDown } from "lucide-react";
import type { PriceHistoryEntry } from "@/lib/types";
import { buildPriceChart, formatChartPrice, nearestPricePoint, type PriceObservation } from "@/lib/price-chart";

interface PriceHistoryChartProps {
  entries: PriceHistoryEntry[];
  currency?: string;
}

const WIDTH = 420;
const HEIGHT = 194;
const LEFT = 56;
const RIGHT = WIDTH - 14;
const TOP = 12;
const BOTTOM = HEIGHT - 29;

function PriceDot({ x, y, series, active = false }: { x: number; y: number; series: number; active?: boolean }) {
  const hollow = series % 3 === 1;
  return <circle cx={x} cy={y} r={active ? 4.5 : 3.2} fill={active || !hollow ? "currentColor" : "var(--surface)"} stroke="currentColor" strokeWidth={hollow ? 1 : 0.65} opacity={active ? 1 : series % 3 === 2 ? 0.5 : 0.75} pointerEvents="none" />;
}

function displayDate(time: number, exact = false) {
  return new Intl.DateTimeFormat("en-US", exact
    ? { dateStyle: "medium", timeStyle: "long" }
    : { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(time);
}

function axisDate(time: number, first: number, last: number) {
  const sameDay = first !== last && new Date(first).toDateString() === new Date(last).toDateString();
  return new Intl.DateTimeFormat("en-US", sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", ...(new Date(first).getFullYear() !== new Date(last).getFullYear() ? { year: "2-digit" as const } : {}) }).format(time);
}

function safeListingUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

export function PriceHistoryChart({ entries, currency }: PriceHistoryChartProps) {
  const chartId = useId();
  const [chosenCurrency, setChosenCurrency] = useState<string | undefined>();
  const [chosenUnknownSource, setChosenUnknownSource] = useState<string | undefined>();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const pointRefs = useRef(new Map<string, SVGCircleElement>());
  const model = useMemo(() => buildPriceChart(entries, chosenCurrency ?? currency, chosenUnknownSource), [entries, chosenCurrency, currency, chosenUnknownSource]);
  const active = model.observations.find((entry) => entry.key === activeKey) ?? model.observations.at(-1);
  const activeSeries = model.series.find((series) => series.sourceUrl === active?.source_url);
  const x = (time: number) => LEFT + ((time - model.timeDomain[0]) / (model.timeDomain[1] - model.timeDomain[0])) * (RIGHT - LEFT);
  const y = (price: number) => BOTTOM - ((price - model.priceDomain[0]) / (model.priceDomain[1] - model.priceDomain[0])) * (BOTTOM - TOP);
  const points = model.observations.map((entry) => ({ key: entry.key, x: x(entry.fetched_at), y: y(entry.price) }));
  const describe = (entry: PriceObservation) => `${formatChartPrice(entry.price, model.currency)}, ${displayDate(entry.fetched_at, true)}, ${entry.source_url}`;

  function navigatePoint(event: KeyboardEvent<SVGCircleElement>, point: PriceObservation) {
    const index = model.observations.findIndex((entry) => entry.key === point.key);
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(model.observations.length - 1, index + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(0, index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = model.observations.length - 1;
    else return;
    event.preventDefault();
    const observation = model.observations[next];
    setActiveKey(observation.key);
    pointRefs.current.get(observation.key)?.focus({ preventScroll: true });
  }

  function inspectPointer(event: PointerEvent<SVGSVGElement>, select = false) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const pointerX = (event.clientX - bounds.left) / bounds.width * WIDTH;
    const pointerY = (event.clientY - bounds.top) / bounds.height * HEIGHT;
    if (!select && (pointerX < LEFT || pointerX > RIGHT || pointerY < TOP || pointerY > BOTTOM)) return;
    const next = nearestPricePoint(points, Math.max(LEFT, Math.min(RIGHT, pointerX)), Math.max(TOP, Math.min(BOTTOM, pointerY)), active?.key, select);
    if (!next) return;
    setActiveKey(next);
    if (select) pointRefs.current.get(next)?.focus({ preventScroll: true });
  }

  if (!active) return <p className="py-5 text-xs text-muted-foreground">No price history yet.</p>;

  const firstTime = model.observations[0].fetched_at;
  const lastTime = model.observations[model.observations.length - 1].fetched_at;
  const prices = model.observations.map((entry) => entry.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const ticks = min === max ? [min] : [max, (min + max) / 2, min];

  return <div className="min-w-0">
    <div className="mb-3 flex min-h-11 items-start justify-between gap-4" aria-live="polite" aria-atomic="true">
      <div className="min-w-0">
        <p className="text-[17px] leading-6 tabular-nums">{formatChartPrice(active.price, model.currency)}</p>
        <time dateTime={new Date(active.fetched_at).toISOString()} title={displayDate(active.fetched_at, true)} className="mt-0.5 block text-[10px] text-muted-foreground">{displayDate(active.fetched_at)}</time>
      </div>
      <div className="flex min-w-0 max-w-[45%] flex-col items-end gap-1 pt-0.5 text-[11px] text-muted-foreground">
        {model.currencies.length > 1 && <label>
          <span className="sr-only">Price history currency</span>
          <select value={model.currency} onChange={(event) => { setChosenCurrency(event.target.value); setActiveKey(null); }} className="max-w-28 bg-background py-0.5 text-foreground outline-offset-4">
            {model.currencies.map((code) => <option key={code} value={code}>{code || "Unspecified"}</option>)}
          </select>
        </label>}
        {model.unknownSources.length > 1 ? <label className="min-w-0 max-w-full">
          <span className="sr-only">Listing with an unspecified currency</span>
          <select value={model.unknownSource} onChange={(event) => { setChosenUnknownSource(event.target.value); setActiveKey(null); }} className="max-w-full truncate bg-background py-0.5 text-foreground outline-offset-4">
            {model.unknownSources.map((source) => <option key={source.url} value={source.url}>{source.label}</option>)}
          </select>
        </label> : <span className="max-w-full truncate py-0.5" title={active.source_url}>{activeSeries?.label}</span>}
        {!model.currency && <span className="text-[10px]">Currency unavailable</span>}
      </div>
    </div>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block w-full cursor-crosshair touch-pan-y select-none overflow-visible text-foreground" role="group" aria-labelledby={`${chartId}-title`} aria-describedby={`${chartId}-help`} onPointerMove={(event) => { if (event.pointerType === "mouse" || event.buttons === 1) inspectPointer(event); }} onPointerDown={(event) => { if (event.button !== 0) return; inspectPointer(event, true); if (event.pointerType === "touch") event.currentTarget.setPointerCapture(event.pointerId); }}>
      <title id={`${chartId}-title`}>Price history{model.currency ? ` in ${model.currency}` : ""}: {model.observations.length} observations from {model.series.length} {model.series.length === 1 ? "listing" : "listings"}</title>
      <desc id={`${chartId}-help`}>Each dot is a fetched price. Move over the chart or tap to inspect the nearest observation. Use arrow keys to inspect observations in chronological order, or tap again to cycle overlapping dots. Full dates, prices and listing links are under All observations.</desc>
      <rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} fill="transparent" />
      {ticks.map((price, index) => <g key={index} pointerEvents="none">
        <line x1={LEFT} x2={RIGHT} y1={y(price)} y2={y(price)} stroke="var(--hairline)" strokeDasharray="2 4" />
        <text x={LEFT - 10} y={y(price)} dy="0.32em" textAnchor="end" fill="var(--muted-text)" fontSize={10}>{formatChartPrice(price, model.currency)}</text>
      </g>)}
      <g pointerEvents="none">
        <line x1={x(active.fetched_at)} x2={x(active.fetched_at)} y1={TOP} y2={BOTTOM} stroke="var(--muted-text)" strokeDasharray="2 4" opacity={0.4} />
        <circle cx={x(active.fetched_at)} cy={y(active.price)} r={8} fill="var(--surface)" stroke="var(--line)" strokeWidth={0.8} />
        {firstTime === lastTime
          ? <text x={x(firstTime)} y={HEIGHT - 6} textAnchor="middle" fill="var(--muted-text)" fontSize={10}>{axisDate(firstTime, firstTime, lastTime)}</text>
          : <>
            <text x={LEFT} y={HEIGHT - 6} fill="var(--muted-text)" fontSize={10}>{axisDate(firstTime, firstTime, lastTime)}</text>
            <text x={RIGHT} y={HEIGHT - 6} textAnchor="end" fill="var(--muted-text)" fontSize={10}>{axisDate(lastTime, firstTime, lastTime)}</text>
          </>}
      </g>
      {model.series.map((series, index) => <g key={series.sourceUrl}>
        {series.observations.map((entry) => <g key={entry.key}>
          <PriceDot x={x(entry.fetched_at)} y={y(entry.price)} series={index} active={active.key === entry.key} />
          <circle ref={(node) => { if (node) pointRefs.current.set(entry.key, node); else pointRefs.current.delete(entry.key); }} cx={x(entry.fetched_at)} cy={y(entry.price)} r={12} fill="transparent" pointerEvents="none" tabIndex={active.key === entry.key ? 0 : -1} role="img" aria-label={describe(entry)} className="outline-none focus-visible:stroke-foreground focus-visible:[stroke-width:0.75]" onFocus={() => setActiveKey(entry.key)} onKeyDown={(event) => navigatePoint(event, entry)} />
        </g>)}
      </g>)}
      <PriceDot x={x(active.fetched_at)} y={y(active.price)} series={model.series.findIndex((series) => series.sourceUrl === active.source_url)} active />
    </svg>
    {model.series.length > 1 && <ul className="mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[10px]" aria-label="Price history listings">
      {model.series.map((series, index) => <li key={series.sourceUrl} className="min-w-0">
        <button type="button" className={`inline-flex max-w-full items-center gap-1.5 py-1 ${active.source_url === series.sourceUrl ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`} title={series.sourceUrl} aria-pressed={active.source_url === series.sourceUrl} aria-label={`Inspect prices from ${series.label}`} onClick={() => setActiveKey(series.observations[series.observations.length - 1].key)}>
          <svg width={12} height={10} aria-hidden="true" className="shrink-0"><PriceDot x={6} y={5} series={index} /></svg>
          <span className="max-w-48 truncate">{series.label}</span>
        </button>
      </li>)}
    </ul>}
    <details className="group mt-3 text-[10px] text-muted-foreground">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 py-1 hover:text-foreground focus-visible:outline-foreground focus-visible:outline-offset-4 [&::-webkit-details-marker]:hidden">All observations <span>({model.observations.length})</span><ChevronDown size={10} strokeWidth={1.3} className="transition-transform group-open:rotate-180" /></summary>
      <div className="mt-3 max-h-64 overflow-auto">
        <table className="w-full border-collapse text-left text-[11px]">
          <caption className="sr-only">Price observations{model.currency ? ` in ${model.currency}` : ""}; times shown in your local time zone.</caption>
          <thead><tr className="border-b border-border"><th scope="col" className="pb-2 pr-3 font-normal">Fetched</th><th scope="col" className="pb-2 pr-3 font-normal">Price</th><th scope="col" className="pb-2 font-normal">Listing</th></tr></thead>
          <tbody>{model.observations.toReversed().map((entry) => <tr key={entry.key} className="border-b border-border align-top">
            <td className="py-2 pr-3"><time dateTime={new Date(entry.fetched_at).toISOString()}>{displayDate(entry.fetched_at, true)}</time></td>
            <td className="whitespace-nowrap py-2 pr-3 text-foreground">{formatChartPrice(entry.price, model.currency)}</td>
            <td className="max-w-36 break-all py-2">{safeListingUrl(entry.source_url) ? <a href={safeListingUrl(entry.source_url)} target="_blank" rel="noopener noreferrer" className="hover:text-foreground" title={entry.source_url}>{entry.source_url}</a> : entry.source_url}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  </div>;
}
