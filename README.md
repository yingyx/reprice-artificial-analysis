# RepriceAA

English · [简体中文](README.zh-CN.md) · [Releases](../../releases) · [MIT License](LICENSE)

Reprice [Artificial Analysis](https://artificialanalysis.ai/models) charts with the prices you actually pay for subscriptions, discounted APIs, or other providers.

Switch **Price Source** from **Artificial Analysis** to **★ Auto-best (cheapest)** to compare models using the lowest price across your enabled sources.

![AA list prices and RepriceAA Auto-best prices, alternating for comparison](assets/hero.gif)

*Captured on October 5, 2026. Results depend on your configured sources and rates.*

## Install

**Chrome extension**

1. Download `repriceaa-vX.Y.Z.zip` from [Releases](../../releases) and unzip it.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.

You can also clone this repository and load its folder directly. No build step or dependencies required.

**Userscript**

Download `repriceaa.user.js` from [Releases](../../releases) and import it into Tampermonkey or a compatible userscript manager.

## Use

1. Open a supported Intelligence Index **cost-per-task** chart on Artificial Analysis.
2. Open **RepriceAA → Sources** to review enabled providers or add your own pricing.
3. Select a source or **Auto-best** in the chart's **Price Source** menu. Hover over a point for pricing details; select **Artificial Analysis** to restore the original chart.

On pages without an integrated chart, open the panel with the purple **RAA** button in the bottom-right corner.

## Features

- **Custom pricing:** multipliers, fixed task costs, formulas, and model exclusions.
- **Subscription plans:** effective prices from monthly fees and per-model allowances.
- **Source comparison:** cheapest enabled source per model, with pricing provenance and fallback sources.
- **Chart integration:** updated cost-optimal frontier; supports model-release charts and their reasoning variants.
- **Pricing maintenance:** expiring promotional rules, error indicators, and automatically refreshed built-in presets.

## Privacy

Pricing profiles and model caches stay in your browser. No analytics; the extension requests only the `storage` permission. It downloads public pricing presets from GitHub or jsDelivr and may fetch Artificial Analysis model/release pages to fill missing chart data.

## Development

```bash
node test/run-tests.js
node scripts/build-userscript.js repriceaa.user.js
```

Plain JavaScript. Releases include both the extension ZIP and the generated userscript.
