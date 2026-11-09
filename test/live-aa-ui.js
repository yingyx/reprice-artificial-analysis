// Exercise the unpacked extension in Chromium's real content-script world.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { nativeGeometry, matchesPoint } = require('../scripts/check-aa-ui-repair');

const root = path.resolve(process.env.AA_UI_EXTENSION_DIR || path.join(__dirname, '..'));
const output = path.resolve(process.env.AA_UI_ARTIFACTS || '.opencode/aa-ui');
const origin = 'https://artificialanalysis.ai';
const cyberPath = '/evaluations/artificial-analysis-cyber-index';
const core = new Map([
  ['/', ['main', 'release']],
  ['/models', ['main']],
  ['/agents/coding-agents', ['benchmark']],
  [cyberPath, ['benchmark']]
]);
const source = { id: 'aa-ui-smoke', name: 'AA UI Smoke', kind: 'usage',
  defaultRule: { type: 'multiplier', value: 0.5 }, rules: {}, nameIncludes: [] };
const costScatter = /^(?!.*(?:time|tokens?|compute)\s+vs\.?).+\s+(?:vs\.?|versus)\s+(?:average\s+)?(?:api\s+)?cost per (?:intelligence index )?task\b/i;
const costTab = new RegExp(costScatter.source + '|^Cost per Task$', 'i');
const nativePoints = '.recharts-scatter [data-chart-item-id], .recharts-scatter circle, .recharts-scatter path';
const nativeContainer = 'xpath=ancestor::*[.//*[contains(concat(" ", normalize-space(@class), " "), " recharts-responsive-container ")]][1]';
const evaluationPath = /^\/evaluations\/[a-z0-9-]+\/?$/;
const selectedCharts = new Set();

function extensionWorld(cdp) {
  const worlds = new Map();
  cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.set(context.id, context));
  cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => worlds.delete(executionContextId));
  cdp.on('Runtime.executionContextsCleared', () => worlds.clear());
  return async expression => {
    const world = [...worlds.values()].find(c => c.name === 'RepriceAA' && c.auxData?.type === 'isolated');
    if (!world) return null;
    const response = await cdp.send('Runtime.evaluate', {
      uniqueContextId: world.uniqueId, expression, returnByValue: true, awaitPromise: true
    });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  };
}

async function waitFor(read, message, timeout = 30000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await read();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 400));
  } while (Date.now() < deadline);
  throw new Error(message);
}

async function checkChart(page, evaluate, heading, result, evidenceDir) {
  let chart;
  let select;
  try {
    await waitFor(async () => {
      try {
        await heading.scrollIntoViewIfNeeded({ timeout: 2000 });
        return true;
      } catch (err) {
        if (!/not attached|Timeout/.test(err.message)) throw err;
        return false;
      }
    }, 'Native chart heading was not stable after hydration', 15000);
    const observedCard = heading.locator('xpath=ancestor::*[@id and not(@role="tabpanel")][1]');
    if (await observedCard.count() && await observedCard.getByRole('heading', { name: costScatter }).count() === 1) {
      chart = observedCard;
      result.anchor = await chart.getAttribute('id');
    }
    const native = heading.locator(nativeContainer);
    const visiblePoint = (chart || native).locator(nativePoints).filter({ visible: true }).first();
    if (chart) {
      const plot = chart.locator('.recharts-responsive-container').first();
      if (await plot.count()) await plot.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    }
    await visiblePoint.waitFor({ state: 'visible', timeout: 20000 });
    chart ||= native;
    result.axes = await chart.locator('.recharts-responsive-container .recharts-label').allTextContents();
    result.nativePoints = await chart.locator(nativePoints).count();
    result.status = 'regression';
    result.stage = 'mount';
    let geometry;
    if (selectedCharts.has(result.chart)) {
      const svg = await chart.locator('.recharts-surface').first().evaluate(el => el.outerHTML);
      geometry = nativeGeometry(svg, result.axes);
      assert(geometry, 'Could not measure the selected native plot');
    }
    select = chart.locator('.raa-srcselect');
    await select.waitFor({ state: 'visible', timeout: 5000 });
    // A page can contain the same AA ID in multiple tab groups. Associate the exact tested control.
    await select.evaluate((el, id) => el.setAttribute('data-raa-live-check', id), result.chart);
    const configured = await evaluate(`(() => {
      RepriceAA.state.upsertProfile(${JSON.stringify(source)});
      RepriceAA.state.setSource('__aa__');
      return true;
    })()`);
    assert(configured, 'RepriceAA content-script context unavailable');

    result.stage = 'repricing';
    await select.selectOption(source.id, { timeout: 5000 });
    const readChart = `(() => {
      const control = Array.from(document.querySelectorAll('[data-raa-live-check]'))
        .find(el => el.getAttribute('data-raa-live-check') === ${JSON.stringify(result.chart)});
      const ctx = RepriceAA.integration._contexts().find(c => c.select === control);
      if (!ctx?.wrap?.getClientRects().length) return null;
      const models = Object.values(ctx.dataById || {}).filter(m => m.aaCost > 0 && Number.isFinite(m.repricedCost));
      return models.length ? {
        isRelease: ctx.isRelease,
        isBenchmark: Boolean(ctx.taskChart),
        rendered: Object.values(ctx.nodes).filter(node => ctx.wrap.contains(node)).length,
        models: models.map(({ id, chartId, intelligence, aaCost, repricedCost, pricingUnsupported }) =>
          ({ id, chartId, intelligence, aaCost, repricedCost, pricingUnsupported }))
      } : null;
    })()`;
    const priced = await waitFor(() => evaluate(readChart), 'Native plot loaded, but the repriced plot never rendered');
    await chart.locator('.raa-chartwrap svg').waitFor({ state: 'visible', timeout: 5000 });
    result.renderedPoints = priced.rendered;
    result.example = priced.models.find(model => !model.pricingUnsupported);
    assert(result.example, 'No priced point supports repricing');
    assert.equal(priced.isRelease, result.kind === 'release', 'Release chart classified incorrectly');
    assert.equal(priced.isBenchmark, result.kind === 'benchmark', 'Benchmark chart classified incorrectly');
    assert(priced.rendered >= priced.models.length, 'Repriced points missing from the visible SVG');
    if (priced.isBenchmark) {
      const ids = await chart.locator('.recharts-scatter [data-chart-item-id]').evaluateAll(points =>
        points.map(point => point.getAttribute('data-chart-item-id')));
      assert(priced.models.every(model => ids.includes(model.chartId)), 'Repriced benchmark points do not map to the native plot');
    }
    for (const model of priced.models) {
      const expected = model.pricingUnsupported ? model.aaCost : model.aaCost * source.defaultRule.value;
      assert(Math.abs(model.repricedCost - expected) < 1e-8,
        `${model.id}: expected ${expected}, got ${model.repricedCost} for AA cost ${model.aaCost}`);
    }
    if (geometry) {
      const comparable = priced.models.filter(model => geometry.points.has(model.chartId));
      const verifiedPoints = new Set(comparable.map(model => model.chartId)).size;
      assert(verifiedPoints >= Math.max(3, geometry.points.size / 2),
        'Too few repriced points to verify the selected chart against the native plot');
      for (const model of comparable) {
        assert(matchesPoint(geometry, model.chartId, model.aaCost, model.intelligence),
          `${model.id}: extracted AA cost or score differs from the native plot`);
      }
      result.verifiedCoordinates = verifiedPoints;
    }
    await select.selectOption('__aa__', { timeout: 5000 });
    await chart.locator('.raa-chartwrap').waitFor({ state: 'hidden', timeout: 5000 });
    await visiblePoint.waitFor({ state: 'visible', timeout: 5000 });
    result.status = 'pass';
    result.stage = 'complete';
  } catch (err) {
    result.error = err.message;
    result.badge = await chart?.locator('.raa-prov').first().textContent({ timeout: 1000 }).catch(() => null);
    if (chart && result.nativePoints) {
      result.sampleNativeId = await chart.locator('.recharts-scatter [data-chart-item-id]:not([opacity="0.25"])')
        .filter({ visible: true }).first().getAttribute('data-chart-item-id', { timeout: 1000 }).catch(() => null);
    }
    const capture = chart || heading.locator('xpath=parent::*');
    const dom = await capture.evaluate(el => el.outerHTML.slice(0, 160000), null, { timeout: 2000 }).catch(() => null);
    await fs.mkdir(evidenceDir, { recursive: true });
    if (dom) await fs.writeFile(path.join(evidenceDir, 'chart.html'), dom.replace(/></g, '>\n<'), 'utf8');
    await page.screenshot({ path: path.join(evidenceDir, 'chart.png'), timeout: 5000 }).catch(() => {});
  } finally {
    if (select) await page.evaluate(id => {
      for (const el of document.querySelectorAll('[data-raa-live-check]')) {
        if (el.getAttribute('data-raa-live-check') === id) el.removeAttribute('data-raa-live-check');
      }
    }, result.chart).catch(() => {});
  }
}

async function openPage(page, route) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await page.goto(new URL(route, origin).href, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (!response?.ok() || new URL(page.url()).origin !== origin) {
        throw new Error(`AA navigation returned HTTP ${response?.status()} or left the AA origin`);
      }
      await page.locator('main').waitFor({ state: 'visible', timeout: 10000 });
      return response.status();
    } catch (err) {
      if (attempt || err.name !== 'TimeoutError') throw err;
      console.log(`${route}: retrying after a navigation timeout`);
    }
  }
}

async function evaluationLinks(page) {
  return page.locator('main a[href]').evaluateAll((links, { origin, pattern }) => links.flatMap(link => {
    const url = new URL(link.href);
    if (url.origin !== origin || !new RegExp(pattern).test(url.pathname)) return [];
    return [url.pathname.replace(/\/$/, '')];
  }), { origin, pattern: evaluationPath.source });
}

async function checkView(page, evaluate, scope, result, seen) {
  const headings = scope.getByRole('heading', { name: costScatter });
  for (const heading of await headings.all()) {
    const { title, view, group } = await heading.evaluate(el => {
      const text = node => node.textContent.trim().replace(/\s+/g, ' ');
      const label = el.closest('[role="tabpanel"]')?.getAttribute('aria-labelledby');
      const tab = label && document.getElementById(label);
      const view = tab ? text(tab) : '';
      const matchingTabs = tab ? [...document.querySelectorAll('[role="tab"]')].filter(node => text(node) === view) : [];
      return { title: text(el), view, group: matchingTabs.length > 1 ? matchingTabs.indexOf(tab) + 1 : 0 };
    });
    const key = [result.route, group ? `${view} #${group}` : view, title].filter(Boolean).join(' | ');
    const occurrence = (seen.get(key) || 0) + 1;
    seen.set(key, occurrence);
    const kind = /\bby Model Release\b/i.test(title) ? 'release' :
      /^Intelligence Index\s+(?:vs\.?|versus)\s/i.test(title) ? 'main' : 'benchmark';
    const evidence = `${result.evidence}/chart-${result.charts.length + 1}`;
    const chart = { chart: `${key} | ${occurrence}`, title, view, kind, evidence, status: 'site-unavailable', stage: 'native-chart' };
    result.charts.push(chart);
    await checkChart(page, evaluate, heading, chart, path.join(output, evidence));
  }
}

async function checkPage({ page, evaluate }, route, enqueue) {
  const evidence = route.slice(1).replaceAll('/', '--') || 'home';
  const result = { route, evidence, charts: [], issues: [], related: [], console: [], requests: [], publicData: [] };
  const append = (entries, value) => { if (entries.length < 30) entries.push(value.slice(0, 500)); };
  const listeners = {
    console: msg => { if (msg.type() === 'error') append(result.console, msg.text()); },
    pageerror: err => append(result.console, err.message),
    requestfailed: req => append(result.requests, `${req.failure()?.errorText} ${req.url().split(/[?#]/, 1)[0]}`),
    response: res => {
      if (res.status() >= 400) append(result.requests, `${res.status()} ${res.url().split(/[?#]/, 1)[0]}`);
      const url = new URL(res.url());
      if (res.ok() && res.request().method() === 'GET' && url.origin === origin && url.pathname.startsWith('/data/')) {
        const headers = res.headers();
        result.publicData.push({ path: url.pathname, type: headers['content-type'], encoding: headers['content-encoding'] });
      }
    }
  };
  Object.entries(listeners).forEach(([event, listener]) => page.on(event, listener));
  try {
    try {
      result.httpStatus = await openPage(page, route);
    } catch (err) {
      result.issues.push(err.message);
      await fs.mkdir(path.join(output, evidence), { recursive: true });
      await page.screenshot({ path: path.join(output, evidence, 'navigation.png'), timeout: 5000 }).catch(() => {});
      return result;
    }

    const tabs = page.getByRole('tab', { name: costTab });
    if (core.has(route)) {
      result.related = [...new Set(await evaluationLinks(page))];
      result.related.forEach(enqueue);
    }

    const seen = new Map();
    await checkView(page, evaluate, page, result, seen);
    const alternatives = [];
    for (const tab of await tabs.all()) {
      if (await tab.getAttribute('aria-selected') === 'false') alternatives.push(tab);
    }
    for (const tab of alternatives) {
      const label = (await tab.textContent()).trim();
      try {
        const panelId = await tab.getAttribute('aria-controls');
        await tab.click({ timeout: 10000 });
        const panel = panelId ? page.locator(`[id=${JSON.stringify(panelId)}]`) : page.getByRole('tabpanel', { name: label, exact: true });
        await panel.waitFor({ state: 'visible', timeout: 10000 });
        if (costScatter.test(label)) await panel.getByRole('heading', { name: costScatter }).first().waitFor({ timeout: 10000 });
        await checkView(page, evaluate, panel, result, seen);
      } catch (err) {
        result.issues.push(`Could not inspect tab ${label}: ${err.message}`);
      }
    }

    for (const kind of core.get(route) || []) {
      if (!result.charts.some(chart => chart.kind === kind)) result.issues.push(`Expected ${kind} cost scatter was not found`);
    }
    if (result.charts.some(chart => chart.status === 'regression')) {
      try {
        result.extraction = await evaluate(`(() => {
          const data = RepriceAA.extract.extractModelsDetailed(document);
          const benchmarks = Object.fromEntries(Object.entries(data.charts || {}).map(([key, models]) =>
            [key, { rows: models.length, withCost: models.filter(model => model.aaCost > 0).length }]));
          return { source: data.source, coverage: data.coverage, benchmarks,
            nativeIdMappings: Object.keys(data.chartIds).length, releaseModels: data.releaseData.models.length };
        })()`);
      } catch (err) { result.extractionError = err.message; }
      const payload = await page.evaluate(() => Array.from(document.scripts)
        .filter(s => !s.src && (s.type === 'application/ld+json' || s.textContent.includes('__next_f')))
        .map(s => s.textContent).join('\n').slice(0, 3000000));
      // Keep long serialized records searchable with line-limited agent tools.
      if (payload) await fs.writeFile(path.join(output, evidence, 'aa-payload.txt'), payload.match(/.{1,1500}/gs).join('\n'), 'utf8');
    }
    return result;
  } finally {
    Object.entries(listeners).forEach(([event, listener]) => page.off(event, listener));
  }
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const report = { url: origin, status: 'error', charts: [], pages: [], discovery: {} };
  const contexts = [];
  try {
    if (process.env.AA_UI_TARGET_FILE) {
      const target = JSON.parse(await fs.readFile(process.env.AA_UI_TARGET_FILE, 'utf8'));
      for (const chart of target.evidence) selectedCharts.add(chart.chart);
    }
    // Use independent profiles because the active price source is shared within a profile.
    const workers = await Promise.allSettled(Array.from({ length: 4 }, async () => {
      const context = await chromium.launchPersistentContext('', {
        channel: 'chromium', viewport: { width: 1440, height: 1000 },
        args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
      });
      contexts.push(context);
      const page = context.pages()[0] || await context.newPage();
      const cdp = await context.newCDPSession(page);
      const evaluate = extensionWorld(cdp);
      await cdp.send('Runtime.enable');
      return { page, evaluate };
    }));
    const failedWorker = workers.find(worker => worker.status === 'rejected');
    if (failedWorker) throw failedWorker.reason;
    const browsers = workers.map(worker => worker.value);

    const catalogue = '/evaluations';
    try {
      await openPage(browsers[0].page, catalogue);
      report.discovery.catalogue = [...new Set(await evaluationLinks(browsers[0].page))];
      if (!report.discovery.catalogue.length) throw new Error('No benchmark links in the AA evaluation catalogue');
    } catch (err) { report.discovery.error = err.message; }

    const routes = [...new Set([...core.keys(), ...(report.discovery.catalogue || [])])];
    const enqueue = route => { if (!routes.includes(route)) routes.push(route); };
    const pages = [];
    let next = 0;
    const completed = await Promise.allSettled(browsers.map(async worker => {
      while (next < routes.length) {
        const index = next++;
        const page = await checkPage(worker, routes[index], enqueue);
        pages[index] = page;
        const passed = page.charts.filter(chart => chart.status === 'pass').length;
        console.log(`${page.route}: ${passed}/${page.charts.length} charts passed${page.issues.length ? ' (page inspection incomplete)' : ''}`);
      }
    }));
    report.pages = pages.filter(Boolean).map(({ charts, ...page }) => page);
    report.charts = pages.filter(Boolean).flatMap(page => page.charts);
    const scanError = completed.find(worker => worker.status === 'rejected');
    if (scanError) throw scanError.reason;
    const unavailable = report.discovery.error || report.pages.some(page => page.issues.length) ||
      report.charts.some(chart => chart.status === 'site-unavailable');
    report.status = report.charts.some(chart => chart.status === 'regression') ? 'regression' :
      unavailable ? 'site-unavailable' : 'pass';
  } catch (err) {
    report.error = err.message;
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()));
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  }
  return report;
}

main().then(report => {
  console.log(JSON.stringify({ status: report.status, pages: report.pages.length, charts: report.charts.length,
    error: report.error, artifacts: output }, null, 2));
  process.exitCode = { pass: 0, regression: 1, 'site-unavailable': 2, error: 3 }[report.status];
}).catch(err => { console.error(err); process.exitCode = 3; });
