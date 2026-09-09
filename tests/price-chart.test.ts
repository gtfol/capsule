import assert from "node:assert/strict";
import test from "node:test";
import { buildPriceChart, formatChartPrice, nearestPricePoint } from "../src/lib/price-chart";
import type { PriceHistoryEntry } from "../src/lib/types";

const source = "https://example.com/listing";
function observation(price: number, fetched_at = 1_700_000_000_000, currency = "USD", source_url = source): PriceHistoryEntry {
  return { price, fetched_at, currency, source_url };
}

test("a chart never joins listing prices or compares different currencies", () => {
  const alternative = "https://example.com/alternative";
  const entries = [observation(100), observation(90, 1_700_000_001_000, "USD", alternative), observation(70, 1_700_000_002_000, "EUR"), observation(95, 1_700_000_003_000)];
  const usd = buildPriceChart(entries, "USD");
  assert.deepEqual(usd.currencies, ["EUR", "USD"]);
  assert.deepEqual(usd.series.map((series) => series.observations.map((entry) => entry.price)), [[100, 95], [90]]);
  assert.notEqual(usd.series[0].label, usd.series[1].label);
  assert.ok(usd.observations.every((entry) => entry.currency === "USD"));
  assert.deepEqual(buildPriceChart(entries, "EUR").observations.map((entry) => entry.price), [70]);
});

test("unknown currencies from different listings are shown separately", () => {
  const alternative = "https://other.example/item";
  const entries = [observation(100, 100, ""), observation(90, 200, "", alternative), observation(95, 300, ""), observation(120, 400, "USD")];
  const initial = buildPriceChart(entries, "");
  assert.equal(initial.unknownSources.length, 2);
  assert.deepEqual(initial.observations.map((entry) => entry.price), [100, 95]);
  assert.deepEqual(buildPriceChart(entries, "", alternative).observations.map((entry) => entry.price), [90]);
  assert.deepEqual(buildPriceChart(entries, "USD", alternative).observations.map((entry) => entry.price), [120]);
});

test("one observation and constant or free prices keep a finite nonzero chart scale", () => {
  for (const entries of [[observation(100)], [observation(0)], [observation(80), observation(80, 1_700_000_001_000)]]) {
    const model = buildPriceChart(entries);
    assert.ok(model.priceDomain[1] > model.priceDomain[0]);
    assert.ok(model.priceDomain[0] >= 0);
    assert.ok(model.timeDomain[1] > model.timeDomain[0]);
    for (const entry of model.observations) {
      assert.ok(entry.price >= model.priceDomain[0] && entry.price <= model.priceDomain[1]);
      assert.ok(entry.fetched_at >= model.timeDomain[0] && entry.fetched_at <= model.timeDomain[1]);
    }
  }
});

test("same-millisecond observations remain distinct without inventing fetch times", () => {
  const entries = [observation(100), observation(90), observation(80, undefined, "USD", "https://other.example/item")];
  const chart = buildPriceChart(entries);
  assert.equal(chart.observations.length, 3);
  assert.equal(new Set(chart.observations.map((entry) => entry.key)).size, 3);
  assert.ok(chart.observations.every((entry) => entry.fetched_at === entries[0].fetched_at));
  assert.deepEqual(entries.map((entry) => entry.price), [100, 90, 80]);
});

test("out-of-order observations sort chronologically without mutating persisted history", () => {
  const entries = [observation(90, 300), observation(100, 100), observation(95, 200)];
  const chart = buildPriceChart(entries);
  assert.deepEqual(chart.observations.map((entry) => entry.price), [100, 95, 90]);
  assert.deepEqual(entries.map((entry) => entry.fetched_at), [300, 100, 200]);
});

test("empty, invalid and absent selected-currency histories render safely", () => {
  const invalid = [observation(NaN), observation(Infinity), observation(-2), observation(30, NaN), observation(30, 9e15)];
  assert.deepEqual(buildPriceChart(invalid).observations, []);
  assert.deepEqual(buildPriceChart([]).series, []);
  assert.equal(buildPriceChart([observation(12, undefined, "usd")], "EUR").currency, "USD");
  assert.equal(formatChartPrice(100, ""), "100");
  assert.equal(formatChartPrice(100, "USD"), "$100.00");
});

test("the whole plot selects nearby observations and a single dot is reachable anywhere", () => {
  const points = [{ key: "first", x: 40, y: 80 }, { key: "second", x: 120, y: 20 }, { key: "third", x: 120, y: 100 }];
  assert.equal(nearestPricePoint(points, 41, 75), "first");
  assert.equal(nearestPricePoint(points, 105, 15), "second");
  assert.equal(nearestPricePoint(points, 108, 95), "third");
  assert.equal(nearestPricePoint([points[0]], 350, 1), "first");
  assert.equal(nearestPricePoint([], 20, 20), undefined);
  assert.equal(nearestPricePoint(points, NaN, 20), undefined);
});

test("overlapping dots stay stable on hover and repeated taps inspect each observation", () => {
  const points = [{ key: "first", x: 100, y: 50 }, { key: "second", x: 100, y: 50 }];
  assert.equal(nearestPricePoint(points, 100, 50), "second");
  assert.equal(nearestPricePoint(points, 100, 50, "second"), "second");
  assert.equal(nearestPricePoint(points, 100, 50, "second", true), "first");
  assert.equal(nearestPricePoint(points, 100, 50, "first", true), "second");
});
