# RepriceAA

<p align="center">
  <a href="../../releases"><img src="https://img.shields.io/github/v/release/yingyx/reprice-artificial-analysis?style=flat-square" alt="release"></a>
  <img src="https://img.shields.io/badge/tests-passing-brightgreen?style=flat-square" alt="tests">
  <img src="https://img.shields.io/badge/privacy-no_network_·_storage_only-green?style=flat-square" alt="privacy">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="license"></a>
</p>

<p align="center">
  <b>A Chrome extension that re-prices Artificial Analysis benchmarks with the prices you actually pay.</b>
  <br>
  Artificial Analysis ranks models by list price, while actual spending typically comes from
  subscriptions, discounted API plans, or proxies. RepriceAA re-draws the Intelligence Index
  chart with your effective prices, so the cost-optimal model is cost-optimal for you.
</p>

<p align="center">
  Same chart, one toggle: Price Source <i>Artificial Analysis</i> → <b>★ Auto-best (cheapest)</b>
</p>

<p align="center">
  <img src="assets/hero.gif" alt="Before: AA list price. After: the same chart repriced by RepriceAA (Auto-best) with the prices you actually pay." width="960">
</p>

## Why

The [Intelligence Index vs. Cost per Task](https://artificialanalysis.ai/models) chart ranks
models by published $/M token prices. If you reach the same models through a subscription or a
discounted plan, the effective price per model differs from the list price, and the chart's
cost-optimal frontier no longer reflects your situation.

| | AA list-price chart | RepriceAA |
|---|---|---|
| Price basis | published $/M tokens | your effective price |
| Subscription plans | not modeled | amortized per model |
| Multiple providers | one number | compared, cheapest wins |
| Cost-optimal frontier | list-price Pareto | *your* Pareto |

*(Illustrative — the comparison depends on the rates you configure.)*

## Features

RepriceAA adds a side panel and integrates with the native chart on any
[artificialanalysis.ai](https://artificialanalysis.ai) page:

- **4 rule types** — `multiplier` (`0.5x`), `absolute` (`$3/task`), `formula` (`aaCost * 0.8 + 0.2`), `exclude`
- **Subscription amortization** — monthly fee + token quota → automatic effective price per covered model
- **Best-of mode** — each model priced across all enabled sources; cheapest wins, with provenance
- **Fallback chains** — uncovered models fall through to another source (loops detected, depth capped at 3)
- **Time-limited rules** — `until: 2026-12-31` for promotional pricing that expires automatically
- **Anomaly flags** — zero-cost, formula errors, and uncovered models are surfaced rather than silently dropped
- **Cross-page registry** — models seen on any AA page are cached locally (600 entries, 14-day freshness) so charts stay complete

## Install

**Option 1 — packaged release (recommended, Chrome)**

1. Download `repriceaa-vX.Y.Z.zip` from the [Releases](../../releases) page and unzip it.
2. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the unzipped folder.

**Option 2 — userscript (Tampermonkey / Violentmonkey / Greasemonkey)**

Install `repriceaa.user.js` from the [Releases](../../releases) page (Tampermonkey →
Utilities → import, or drag the file into the dashboard), or install from
[Greasy Fork](https://greasyfork.org), where the script syncs from this repo's releases and
updates automatically. The same extension source produces the userscript —
the header and file order are generated from `manifest.json`, so both stay in sync.

**Option 3 — from source**

```bash
git clone <this-repo>
```

Then: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the folder.

Releases are packaged automatically by CI; each release contains the extension zip and the
generated userscript. Regenerate the userscript locally with:

```bash
node scripts/build-userscript.js repriceaa.user.js
```

No build step, no dependencies, plain JavaScript.

Once loaded, visit any [artificialanalysis.ai](https://artificialanalysis.ai) page and click the
purple launcher in the bottom-right corner.

## Privacy

Zero network requests, zero analytics. One permission (`storage`): profiles and the model cache
never leave your browser.

## Development

```bash
node test/run-tests.js
```

55 unit, integration, and smoke tests — zero dependencies, including the userscript build.

<br>

<p align="center">
  English · <a href="README.zh-CN.md">简体中文</a>
</p>
