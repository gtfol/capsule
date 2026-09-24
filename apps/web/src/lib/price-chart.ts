import type { PriceHistoryEntry } from "./types";

export interface PriceObservation extends PriceHistoryEntry {
  key: string;
}

export interface PriceSeries {
  sourceUrl: string;
  label: string;
  observations: PriceObservation[];
}

export interface PriceChartModel {
  currency: string;
  currencies: string[];
  unknownSources: Array<{ url: string; label: string }>;
  unknownSource: string | undefined;
  observations: PriceObservation[];
  series: PriceSeries[];
  priceDomain: [number, number];
  timeDomain: [number, number];
}

function sourceName(sourceUrl: string) {
  try { return new URL(sourceUrl).hostname.replace(/^www\./, ""); }
  catch { return sourceUrl || "Listing"; }
}

/** Keep currencies separate, preserve every observation, and leave equal timestamps equal. */
export function buildPriceChart(entries: PriceHistoryEntry[], requestedCurrency?: string, requestedUnknownSource?: string): PriceChartModel {
  const valid = entries.flatMap((entry, index) => {
    if (!Number.isFinite(entry.price) || entry.price < 0 || !Number.isFinite(entry.fetched_at) || !Number.isFinite(new Date(entry.fetched_at).getTime())) return [];
    return [{ ...entry, currency: entry.currency.trim().toUpperCase(), key: `${index}:${entry.source_url}:${entry.fetched_at}` }];
  }).sort((a, b) => a.fetched_at - b.fetched_at);
  const currencies = Array.from(new Set(valid.map((entry) => entry.currency))).sort();
  const requested = requestedCurrency?.trim().toUpperCase();
  const currency = requested !== undefined && currencies.includes(requested) ? requested : (currencies[0] ?? "");
  const currencyObservations = valid.filter((entry) => entry.currency === currency);
  const unknownUrls = currency === "" ? Array.from(new Set(currencyObservations.map((entry) => entry.source_url))) : [];
  const unknownSources = unknownUrls.map((url, index) => ({ url, label: `${sourceName(url)}${unknownUrls.filter((other) => sourceName(other) === sourceName(url)).length > 1 ? ` · ${index + 1}` : ""}` }));
  const unknownSource = requestedUnknownSource !== undefined && unknownUrls.includes(requestedUnknownSource) ? requestedUnknownSource : unknownUrls[0];
  // Two absent currencies do not make two different listings comparable.
  const observations = currency === "" ? currencyObservations.filter((entry) => entry.source_url === unknownSource) : currencyObservations;
  const grouped = new Map<string, PriceObservation[]>();
  for (const entry of observations) {
    const group = grouped.get(entry.source_url) ?? [];
    group.push(entry);
    grouped.set(entry.source_url, group);
  }
  const names = Array.from(grouped.keys()).map(sourceName);
  const nameCounts = new Map<string, number>();
  const series = Array.from(grouped, ([sourceUrl, points]) => {
    const name = sourceName(sourceUrl);
    const index = (nameCounts.get(name) ?? 0) + 1;
    nameCounts.set(name, index);
    return { sourceUrl, observations: points, label: names.filter((entry) => entry === name).length > 1 ? `${name} · ${index}` : name };
  });
  if (!observations.length) return { currency, currencies, unknownSources, unknownSource, observations, series, priceDomain: [0, 1], timeDomain: [0, 1] };

  const prices = observations.map((entry) => entry.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const pricePadding = minPrice === maxPrice ? Math.max(maxPrice * 0.08, 1) : (maxPrice - minPrice) * 0.12;
  const first = observations[0].fetched_at;
  const last = observations[observations.length - 1].fetched_at;
  // A single instant sits in the center; axis labels still show its actual timestamp.
  const timeDomain: [number, number] = first === last ? [first - 43_200_000, last + 43_200_000] : [first, last];
  return { currency, currencies, unknownSources, unknownSource, observations, series, priceDomain: [Math.max(0, minPrice - pricePadding), maxPrice + pricePadding], timeDomain };
}

export function formatChartPrice(price: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(price);
  } catch {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(price)}${currency ? ` ${currency}` : ""}`;
  }
}

export interface PricePlotPoint { key: string; x: number; y: number; }

/** A whole-plot hit area is easier to use than hitting an individual small dot. */
export function nearestPricePoint(points: PricePlotPoint[], x: number, y: number, currentKey?: string | null, cycle = false): string | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  let nearest = Infinity;
  let candidates: string[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (distance < nearest - 0.001) { nearest = distance; candidates = [point.key]; }
    else if (Math.abs(distance - nearest) < 0.001) candidates.push(point.key);
  }
  const currentIndex = currentKey ? candidates.indexOf(currentKey) : -1;
  // Repeated taps can inspect records that occupy exactly the same position.
  if (cycle && currentIndex >= 0) return candidates[(currentIndex + 1) % candidates.length];
  return currentIndex >= 0 ? candidates[currentIndex] : candidates.at(-1);
}
