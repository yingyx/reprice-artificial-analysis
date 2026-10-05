const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function parseX(transform) {
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(transform || '');
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
}

function makeElement(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); }
    },
    listeners: {},
    attrs: {},
    _innerHTML: '',
    appendChild(child) { el.children.push(child); child.parentNode = el; return child; },
    insertBefore(child, ref) {
      const i = ref ? el.children.indexOf(ref) : -1;
      if (i === -1) el.children.push(child); else el.children.splice(i, 0, child);
      child.parentNode = el;
      return child;
    },
    removeChild(child) { const i = el.children.indexOf(child); if (i >= 0) el.children.splice(i, 1); },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    contains() { return true; },
    addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return el.attrs[k] == null ? null : el.attrs[k]; },
    querySelector(sel) { return el._querySelector(sel, false); },
    querySelectorAll(sel) { return el._querySelector(sel, true); },
    _querySelector(sel, all) {
      const out = [];
      const walk = (n) => {
        for (const c of n.children || []) {
          if (el._matches(c, sel)) { out.push(c); if (!all) return out[0]; }
          const r = walk(c);
          if (!all && r) return r;
        }
        return null;
      };
      const r = walk(el);
      return all ? out : (r || null);
    },
    _matches(n, sel) {
      if (sel.includes(',')) return sel.split(',').some(s => el._matches(n, s.trim()));
      const m = /^([a-z]+)\.([a-z-]+)$/i.exec(sel);
      if (m) return n.tagName === m[1].toUpperCase() && n.classList._set.has(m[2]);
      if (sel.startsWith('.')) return n.classList._set.has(sel.slice(1));
      if (sel.startsWith('#')) return n.attrs.id === sel.slice(1);
      if (sel.startsWith('span')) return n.tagName === 'SPAN' && /background-color/.test(n.attrs.style || '');
      return n.tagName === sel.toUpperCase();
    },
    getBoundingClientRect() { return el.rect || { left: 0, top: 0, width: 0, height: 0 }; }
  };
  Object.defineProperty(el, 'className', {
    get() { return [...el.classList._set].join(' '); },
    set(v) {
      el.classList._set = new Set(String(v).split(/\s+/).filter(Boolean));
    }
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._innerHTML; },
    set(v) {
      el._innerHTML = v;
      if (el.tagName === 'G') el.children = [];
    }
  });
  Object.defineProperty(el, 'firstChild', { get() { return el.children[0] || null; } });
  return el;
}

function makeDoc(ldJsonScripts) {
  const doc = makeElement('document');
  doc.head = makeElement('head');
  doc.body = makeElement('body');

  const anchor = makeElement('div');
  anchor.attrs.id = 'intelligence-index-vs-cost-per-intelligence-index-task';
  const header = makeElement('div');
  const h3 = makeElement('h3');
  h3.textContent = 'Intelligence Index vs. Cost per Intelligence Index Task';
  header.appendChild(h3);
  anchor.appendChild(header);
  const plot = makeElement('div');
  plot.classList.add('recharts-responsive-container');
  plot.rect = { left: 0, top: 40, width: 800, height: 480 };
  anchor.appendChild(plot);
  anchor.rect = { left: 0, top: 0, width: 800, height: 560 };
  doc.body.appendChild(anchor);
  const release = makeElement('div');
  release.attrs.id = anchor.attrs.id + '-by-model-release';
  doc.body.appendChild(release);

  doc.documentElement = makeElement('html');
  doc.documentElement.children = [doc.head, doc.body];
  doc.documentElement.contains = () => true;

  doc.getElementById = () => null;
  doc.createElement = (t) => makeElement(t);
  doc.createElementNS = (ns, t) => makeElement(t);
  doc.querySelectorAll = (sel) => {
    if (sel.indexOf('script[type="application/ld+json"]') !== -1) return ldJsonScripts;
    if (sel.startsWith('[id^=')) return [anchor, release];
    if (sel.startsWith('[id=')) return [anchor, release].filter(e => sel.includes('[id="' + e.attrs.id + '"]'));
    if (sel.startsWith('span')) return [];
    return [];
  };
  doc.querySelector = (sel) => (doc.querySelectorAll(sel)[0] || null);
  doc.addEventListener = () => {};
  return { doc, anchor, plot, release };
}

function run(file, ctx) {
  const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  vm.runInContext(code, ctx, { filename: file });
}

async function main() {
  const models = [
    { label: 'Claude Opus 5 (max)', intelligenceIndex: 63.05, costPerIntelligenceIndexTask: 2.3368, detailsUrl: '/models/claude-opus-5' },
    { label: 'GPT-5.6 Sol (max)', intelligenceIndex: 60.92, costPerIntelligenceIndexTask: 1.0056, detailsUrl: '/models/gpt-5-6-sol' },
    { label: 'GLM-5.3 (max)', intelligenceIndex: 59.51, costPerIntelligenceIndexTask: 0.6829, detailsUrl: '/models/glm-5-3' },
    { label: 'DeepSeek V4 Pro 0813 (max)', intelligenceIndex: 53.19, costPerIntelligenceIndexTask: 0.2652, detailsUrl: '/models/deepseek-v4-pro' },
    { label: 'DeepSeek V4.1 Flash (max)', intelligenceIndex: 54.5, costPerIntelligenceIndexTask: 2, detailsUrl: '/models/deepseek-v4-1-flash' },
    { label: 'GPT-5.6 Luna (max)', intelligenceIndex: 52.31, costPerIntelligenceIndexTask: 0.0486, detailsUrl: '/models/gpt-5-6-luna' }
  ];
  const scripts = [
    { textContent: JSON.stringify({ '@type': 'Dataset', name: 'IQ', data: models.map(m => ({ label: m.label, intelligenceIndex: m.intelligenceIndex, detailsUrl: m.detailsUrl })) }) },
    { textContent: JSON.stringify({ '@type': 'Dataset', name: 'COST', data: models.map(m => ({ label: m.label, costPerIntelligenceIndexTask: m.costPerIntelligenceIndexTask, detailsUrl: m.detailsUrl })) }) }
  ];

  const { doc, anchor, plot, release } = makeDoc(scripts);

  const localStorageStub = (() => {
    const store = {};
    return {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    };
  })();

  const listeners = {};
  const ctx = {
    console,
    document: doc,
    localStorage: localStorageStub,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    MutationObserver: function () { this.observe = () => {}; },
    ResizeObserver: function () { this.observe = () => {}; },
    CustomEvent: function (type, opts) { this.type = type; this.detail = opts && opts.detail; },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: () => {},
    dispatchEvent: (ev) => { (listeners[ev.type] || []).forEach((fn) => fn(ev)); }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.__RAA_DISABLE_REMOTE__ = true;   // keep integration test offline
  vm.createContext(ctx);

  for (const f of [
    'src/lib/pricing.js', 'src/lib/pareto.js', 'src/lib/storage.js', 'src/lib/colors.js',
    'src/lib/registry.js', 'src/lib/remotesources.js', 'src/data/sources.js',
    'src/content/extract.js', 'src/content/state.js', 'src/content/chart-integration.js'
  ]) {
    run(f, ctx);
  }

  await new Promise((r) => setTimeout(r, 50));
  const R = ctx.RepriceAA;
  const extraction1 = R.extract.extractModelsDetailed(doc);
  assert.strictEqual(R.extract.extractModelsDetailed(doc), extraction1, 'unchanged serialized data reuses extraction');
  scripts[0].textContent += ' ';
  assert.notStrictEqual(R.extract.extractModelsDetailed(doc), extraction1, 'changed scripts invalidate extraction cache');
  const contexts = R.integration._contexts();
  assert.strictEqual(contexts.length, 2, 'normal and release charts have separate contexts');
  const ctxA = contexts[0];

  assert.ok(anchor.children.some(c => c.classList._set.has('raa-bar')), 'price source bar mounted');
  assert.ok(!ctxA.svg, 'no overlay in AA mode');

  const glmId = 'glm-5-3';
  R.state.setSource('__aa__');

  R.state.setSource('opencode-go-example');
  await new Promise((r) => setTimeout(r, 50));

  assert.strictEqual(R.state.getSourceMode(), 'repriced', 'source mode repriced');
  assert.strictEqual(ctxA.select.value, 'opencode-go-example', 'select reflects profile');
  assert.ok(ctxA.svg, 'overlay svg created in repriced mode');
  assert.strictEqual(ctxA.wrap.style.display, '', 'overlay visible in repriced mode');
  assert.strictEqual(ctxA.path.attrs['stroke-dasharray'], '0.1 6', 'Pareto line dotted like AA legend');
  assert.ok(ctxA.gAxis._innerHTML.indexOf('fill="rgb(144, 238, 144)" fill-opacity="0.25"') !== -1, 'MAQ shading visible');
  assert.ok(ctxA.gAxis._innerHTML.includes('fill="rgb(235, 235, 235)" fill-opacity="0.25"'), 'native lower-right quadrant shading');
  Object.values(ctxA.nodes).forEach(g => {
    assert.strictEqual(g.children[0].attrs.r, '6', 'native point radius survives rerenders');
    assert.strictEqual(g.children[0].attrs.stroke, 'none', 'native dots have no white outline');
  });
  assert.ok(ctxA.gAxis._innerHTML.indexOf('$0.05') !== -1, 'exact log cost ticks');
  assert.ok(ctxA.gAxis._innerHTML.indexOf('>Artificial Analysis Intelligence Index<') !== -1, 'y-axis title matches AA');
  assert.ok(ctxA.gAxis._innerHTML.indexOf('<line') === -1, 'no spines/gridlines like AA');
  assert.ok(ctxA.gAxis._innerHTML.indexOf('Most attractive quadrant') === -1, 'no stray MAQ caption in plot');
  assert.ok(ctxA.gLbl && ctxA.gLbl._innerHTML.indexOf('GLM-5.3 (max)') !== -1, 'side model labels rendered');
  const leaders = [...ctxA.gLbl.innerHTML.matchAll(/<line ([^>]+)>/g)].map(match => {
    const attrs = Object.fromEntries([...match[1].matchAll(/(x1|y1|x2|y2)="([^"]+)"/g)].map(a => [a[1], Number(a[2])]));
    assert.ok(Math.hypot(attrs.x2 - attrs.x1, attrs.y2 - attrs.y1) <= 48, 'label leaders stay local to their point');
    return attrs;
  });
  const side = (a, x, y) => (a.x2 - a.x1) * (y - a.y1) - (a.y2 - a.y1) * (x - a.x1);
  for (let i = 0; i < leaders.length; i++) for (let j = i + 1; j < leaders.length; j++) {
    const a = leaders[i], b = leaders[j];
    assert.ok(!(side(a, b.x1, b.y1) * side(a, b.x2, b.y2) < 0 &&
      side(b, a.x1, a.y1) * side(b, a.x2, a.y2) < 0), 'label leaders do not cross each other');
  }
  assert.ok(ctxA.gLbl._innerHTML.indexOf('>DeepSeek V4 Pro 0813 (max)<') !== -1, 'all model labels rendered');
  assert.ok(ctxA.gAxis._innerHTML.indexOf('>Intelligence Index<') === -1, 'short y title removed');
  assert.ok(!ctxA.nodes['glm-5-3'].querySelector('.ring'), 'no highlight rings');

  const glmNode = ctxA.nodes['glm-5-3'];
  assert.ok(glmNode, 'GLM point node exists');
  const glmX = parseX(glmNode.style.transform).x;

  const dsNode = ctxA.nodes['deepseek-v4-pro'];
  const dsX1 = parseX(dsNode.style.transform).x;
  assert.ok(glmX > dsX1, `log x-axis orders by cost: GLM x=${glmX.toFixed(1)} right of DeepSeek x=${dsX1.toFixed(1)}`);

  // ---- single-source mode must resolve through the same engine as Auto-best ----
  // Regression guard: this mode used the legacy applyProfile path, which ignored
  // subscription coverage, fallbackTo/basedOn, promos and until.
  const profileList = R.state.cache.profiles;
  Object.keys(ctxA.dataById).forEach((id) => {
    const shown = ctxA.dataById[id];
    const expected = R.pricing.resolvePrice(shown, 'opencode-go-example', R.pricing.makeCtx(profileList));
    assert.strictEqual(shown.repricedCost, expected.price, id + ' chart price equals resolvePrice');
  });
  const goProfile = profileList.find(p => p.id === 'opencode-go-example');
  const claudeShown = ctxA.dataById['claude-opus-5'];
  assert.strictEqual(claudeShown.repricedCost, 2.3368,
    'uncovered Claude keeps the AA list price under single-source mode');
  assert.strictEqual(claudeShown.estimate, undefined, 'uncovered model is not a subscription estimate');
  const dsFlash = ctxA.dataById['deepseek-v4-1-flash'];
  const dsPromo = (goProfile.promos || []).find(p => p.match === 'deepseek v4.1 flash');
  const dsPromoActive = !!(dsPromo && R.pricing.promoActive(dsPromo, R.pricing.todayStr()));
  // The scheduled preset update made the former promotional rate permanent.
  const dsExpected = 2 * (dsPromoActive ? dsPromo.rule.value : 0.167);
  assert.ok(Math.abs(dsFlash.repricedCost - dsExpected) < 1e-9,
    'promo-aware DeepSeek V4.1 Flash price, got ' + dsFlash.repricedCost);
  assert.strictEqual(dsFlash.estimate, 'full-quota', 'subscription price labelled as full-quota estimate');

  R.state.setSource('command-code-goat');
  await new Promise((r) => setTimeout(r, 50));
  const dsX2 = parseX(ctxA.nodes['deepseek-v4-pro'].style.transform).x;
  const glmX2 = parseX(ctxA.nodes['glm-5-3'].style.transform).x;
  assert.ok(dsX2 < dsX1 - 3, `DeepSeek moves left under GOAT's lower ratio: ${dsX1.toFixed(1)} -> ${dsX2.toFixed(1)}`);
  assert.ok(glmX2 > dsX2, `GLM still right of DeepSeek under GOAT (x=${glmX2.toFixed(1)} vs ${dsX2.toFixed(1)})`);

  R.state.setSource('__aa__');
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(ctxA.wrap.style.display, 'none', 'overlay hidden again in AA mode');

  // ---- best-of mode: subscription + derived batch source ----
  R.state.upsertProfile({
    id: 'claude-max', name: 'Claude Max', kind: 'subscription',
    monthlyFee: 20, monthlyQuotaTokens: 4.33e6, refBlendedPrice: 9,
    fallbackTo: 'openrouter-x', defaultRule: { type: 'multiplier', value: 1 },
    rules: {}, nameIncludes: [{ match: 'claude', rule: { type: 'multiplier', value: 0.3 } }]
  });
  R.state.upsertProfile({
    id: 'openrouter-x', name: 'OpenRouter', kind: 'usage',
    defaultRule: { type: 'multiplier', value: 1.055 }, rules: {}, nameIncludes: []
  });
  R.state.upsertProfile({
    id: 'or-batch', name: 'OpenRouter@Batch', kind: 'usage', basedOn: 'openrouter-x',
    defaultRule: { type: 'multiplier', value: 0.5 }, rules: {}, nameIncludes: []
  });
  R.state.setBestSources(['claude-max', 'openrouter-x', 'or-batch']);
  R.state.setSource('__best__');
  await new Promise((r) => setTimeout(r, 50));

  assert.strictEqual(R.state.getSourceMode(), 'best', 'source mode best');
  assert.strictEqual(ctxA.select.value, '__best__', 'select reflects best mode');
  assert.ok(ctxA.wrap.style.display === '', 'overlay visible in best mode');

  // Claude models: covered by Max -> the pattern's own per-model ratio (×0.3)
  // is the effective price; beats OpenRouter & Batch
  const claude = R.pricing.applyBest(
    [{ id: 'claude-opus-5', label: 'Claude Opus 5 (max)', intelligence: 63.05, aaCost: 2.3368 }],
    ['claude-max', 'openrouter-x', 'or-batch'],
    R.state.cache.profiles
  )[0];
  assert.ok(Math.abs(claude.repricedCost - 2.3368 * 0.3) < 1e-6, 'covered claude uses the pattern ratio');
  assert.strictEqual(claude.winnerSourceId, 'claude-max', 'subscription wins for covered model');

  // GPT model: not covered by Max -> falls back to OpenRouter (4.22) ties with Batch (4.22);
  // Batch derived price = 1.055*0.5 = 0.5275x -> cheaper, batch wins
  const gpt = R.pricing.applyBest(
    [{ id: 'gpt-5-6-sol', label: 'GPT-5.6 Sol (max)', intelligence: 60.92, aaCost: 1.0056 }],
    ['claude-max', 'openrouter-x', 'or-batch'],
    R.state.cache.profiles
  )[0];
  assert.ok(Math.abs(gpt.repricedCost - 1.0056 * 1.055 * 0.5) < 1e-9, 'batch derived price wins for gpt');
  assert.strictEqual(gpt.winnerSourceId, 'or-batch', 'derived batch wins for uncovered model');

  assert.ok(ctxA.gAxis._innerHTML.indexOf('Auto-best') !== -1, 'axis label mentions Auto-best');
  assert.ok(ctxA.nodes['glm-5-3'], 'GLM point still rendered in best mode');

  const logAxes = ctxA.gAxis._innerHTML;
  R.state.setLogScale(false);
  assert.notStrictEqual(ctxA.gAxis._innerHTML, logAxes, 'scale preference redraws axes');
  R.state.setLogScale(true);
  const originalExtract = R.extract.extractModelsDetailed;
  R.extract.extractModelsDetailed = function (d) {
    const result = originalExtract(d);
    result.chartIds = { 'uuid-glm': 'glm-5-3', 'uuid-claude': 'claude-opus-5' };
    return result;
  };
  let nativeIds = ['uuid-glm'];
  let referenceIds = [];
  const originalQuery = plot.querySelectorAll;
  plot.querySelectorAll = function (sel) {
    return sel === '[data-chart-item-id]' ? nativeIds.concat(referenceIds).map(id => ({
      getAttribute: name => name === 'data-chart-item-id' ? id : (referenceIds.includes(id) ? '0.25' : '1')
    })) : originalQuery(sel);
  };
  R.integration.renderAllBars();
  assert.deepStrictEqual(Object.keys(ctxA.dataById), ['glm-5-3'], 'native selection controls overlay');
  referenceIds = ['uuid-claude'];
  R.integration.renderAllBars();
  assert.deepStrictEqual(Object.keys(ctxA.dataById), ['glm-5-3'], 'unselected reference dots do not enter overlay');
  referenceIds = [];
  nativeIds = ['uuid-claude'];
  R.integration.renderAllBars();
  assert.deepStrictEqual(Object.keys(ctxA.dataById), ['claude-opus-5'], 'same-size selection replacement updates overlay');
  nativeIds = ['unknown-uuid'];
  R.integration.renderAllBars();
  assert.strictEqual(Object.keys(ctxA.dataById).length, 0, 'unknown selection does not display unrelated models');
  plot.querySelectorAll = originalQuery;
  ctx.URLSearchParams = URLSearchParams;
  ctx.location = { search: '?models=' };
  R.integration.renderAllBars();
  assert.strictEqual(Object.keys(ctxA.dataById).length, 0, 'empty selection stays empty');
  ctx.location.search = '?models=not-loaded';
  R.integration.renderAllBars();
  assert.strictEqual(Object.keys(ctxA.dataById).length, 0, 'missing slug does not restore all models');
  ctx.location.search = '';
  R.extract.extractModelsDetailed = originalExtract;

  // Reuse a catalogue response before requesting another large page. Keep
  // the native chart until all selected models are resolved or failed.
  const pendingDetails = {};
  const originalDetailExtract = R.extract.extractModelDetailsFromHtml;
  ctx.fetch = url => new Promise((resolve, reject) => {
    pendingDetails[url.split('/').pop()] = { resolve, reject };
  });
  R.extract.extractModelDetailsFromHtml = (html, wanted) => html.split(',').filter(id => wanted.includes(id)).map(id => ({
    id, label: id, aaCost: id === 'batch-unavailable' ? null : 1, intelligence: 50, provider: 'OpenAI'
  }));
  ctx.location.search = '?models=batch-a,batch-b,batch-c,batch-failed,batch-unavailable';
  R.integration.renderAllBars();
  assert.strictEqual(ctxA.wrap.style.display, 'none', 'keep original chart while details are pending');
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.strictEqual(Object.keys(pendingDetails).length, 1, 'only one large page fetches at a time');
  pendingDetails['batch-a'].resolve({ ok: true, text: async () => 'batch-a,batch-b,batch-unavailable,unrelated' });
  await new Promise(resolve => setTimeout(resolve, 10));
  R.integration.renderAllBars();
  assert.strictEqual(ctxA.wrap.style.display, 'none', 'first response does not reveal a partial overlay');
  assert.ok(!pendingDetails['batch-b'], 'shared response avoids a redundant model request');
  assert.ok(pendingDetails['batch-c'], 'queue continues for a model absent from the first response');
  assert.ok(!R.registry.all().some(m => m.id === 'unrelated'), 'unrequested catalogue data never enters registry');
  R.state.setSource('__aa__');
  R.state.setSource('__best__');
  assert.strictEqual(ctxA.wrap.style.display, 'none', 'switching sources does not bypass pending batch');
  pendingDetails['batch-c'].resolve({ ok: true, text: async () => 'batch-c' });
  await new Promise(resolve => setTimeout(resolve, 10));
  pendingDetails['batch-failed'].reject(new Error('offline'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.strictEqual(ctxA.wrap.style.display, '', 'failed request cannot leave the chart stuck loading');
  assert.ok(!pendingDetails['batch-unavailable'], 'explicit unavailable values do not trigger another catalogue request');
  assert.deepStrictEqual(Object.keys(ctxA.dataById).sort(), ['batch-a', 'batch-b', 'batch-c'], 'successful results appear together');
  delete ctx.fetch;
  ctx.location.search = '';
  R.extract.extractModelDetailsFromHtml = originalDetailExtract;

  // Release variants share a group, never a cost or identity. Exercise the same
  // chunk boundaries and nested evaluation objects used by the live Flight data.
  const variant = (id, cost, effort) => ({ id: 'uuid-' + id, slug: id, name: id,
    shortName: id, release: { slug: 'claude-test', name: 'Claude Test' },
    effort: { level: effort }, intelligenceIndex: 40 + effort,
    intelligenceIndexCostPerTask: { cost: { total: cost } },
    intelligenceIndexEvaluations: [{ slug: 'nested', name: 'Nested', intelligenceIndex: 99 }],
    creator: { name: 'Anthropic' } });
  const flight = 'a:' + JSON.stringify({ initialData: [variant('claude-low', 1, 1), variant('claude-high', 3, 2)] }) + '\n';
  const html = 'self.__next_f.push([1,' + JSON.stringify(flight.slice(0, 250)) + ']);' +
    'self.__next_f.push([1,' + JSON.stringify(flight.slice(250)) + ']);';
  const releaseData = R.extract.extractReleaseDataFromHtml(html);
  assert.strictEqual(releaseData.models.length, 2, 'release variants do not collapse');
  assert.strictEqual(releaseData.models[1].aaCost, 3, 'nested evaluations do not corrupt variant cost');
  assert.strictEqual(releaseData.models[0].releaseId, 'claude-test');
  const details = R.extract.extractModelDetailsFromHtml(html, ['claude-high', 'missing']);
  assert.strictEqual(details.length, 1, 'detail catalogue only returns requested models');
  assert.strictEqual(details[0].id, 'claude-high');
  assert.strictEqual(details[0].aaCost, 3, 'detail parser preserves each variant cost');
  assert.strictEqual(details[0].intelligence, 42, 'nested evaluation scores are not model scores');
  const releasePlot = makeElement('div');
  releasePlot.className = 'recharts-responsive-container';
  releasePlot.rect = plot.rect;
  release.rect = anchor.rect;
  release.appendChild(releasePlot);
  let releaseIds = ['uuid-claude-low', 'uuid-claude-high'];
  let releaseReferences = [];
  releasePlot.querySelectorAll = sel => sel === '[data-chart-item-id]' ? releaseIds.concat(releaseReferences).map(id => ({
    getAttribute: key => key === 'data-chart-item-id' ? id : (releaseReferences.includes(id) ? '0.25' : '1')
  })) : [];
  R.extract.extractModelsDetailed = d => Object.assign({}, originalExtract(d), { releaseData });
  ctx.location.search = '?models=unrelated';
  R.integration.renderAllBars();
  const ctxRelease = contexts[1];
  assert.deepStrictEqual(Object.keys(ctxRelease.dataById), ['claude-low', 'claude-high'], 'release selection ignores global model URL');
  assert.ok(ctxRelease.gReleases.innerHTML.includes('<path'), 'same-release variants are connected');
  assert.strictEqual((ctxRelease.gLbl.innerHTML.match(/<text /g) || []).length, 1, 'one label per release instead of one per effort variant');
  assert.ok(ctxRelease.gLbl.innerHTML.includes('>Claude Test</text>'), 'release label uses the native group name');
  assert.ok(ctxRelease.gLbl.innerHTML.includes('data-model-id="claude-high"'), 'release label anchors to highest-intelligence visible variant');
  assert.strictEqual(Object.keys(ctxRelease.nodes).length, 2, 'both effort points retain tooltip targets');
  releaseIds = ['uuid-claude-high'];
  releaseReferences = ['uuid-claude-low'];
  R.integration.renderAllBars();
  assert.deepStrictEqual(Object.keys(ctxRelease.dataById), ['claude-high'], 'release reference dots stay excluded');
  assert.strictEqual(ctxRelease.gReleases.innerHTML, '', 'single variant has no stale connector');
  releaseIds = ['unknown'];
  R.integration.renderAllBars();
  assert.strictEqual(ctxRelease.wrap.style.display, 'none', 'missing variant data preserves native chart');
  let detailCalls = 0;
  ctx.location.search = '';
  ctx.fetch = async url => {
    detailCalls++;
    assert.strictEqual(url, '/models/releases/claude-test');
    return { ok: true, text: async () => html };
  };
  R.extract.extractModelsDetailed = d => Object.assign({}, originalExtract(d), {
    releaseData: { models: releaseData.models.slice(0, 1), releases: releaseData.releases }
  });
  releaseIds = ['uuid-claude-low', 'uuid-claude-high'];
  releaseReferences = [];
  R.integration.renderAllBars();
  assert.strictEqual(ctxRelease.wrap.style.display, 'none', 'native chart remains during async hydration');
  await new Promise(resolve => setTimeout(resolve, 100));
  R.integration.renderAllBars();
  assert.deepStrictEqual(Object.keys(ctxRelease.dataById), ['claude-low', 'claude-high'], 'detail fetch restores every selected variant');
  assert.strictEqual(ctxRelease.wrap.style.display, '', 'complete hydrated overlay is displayed');
  assert.strictEqual(detailCalls, 1, 'release detail requests are deduplicated and cached');
  delete ctx.fetch;
  ctx.location.search = '';
  R.extract.extractModelsDetailed = originalExtract;

  R.state.setSource('__aa__');
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(ctxA.wrap.style.display, 'none', 'overlay hidden in AA mode after best');

  // ---- coding plan preset library sanity ----
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  // Scheduled data maintenance may legitimately change every estimate.
  // Verify that state preserves the bundled values instead of pinning old prices.
  for (const preset of R.SOURCES.filter(s => s.kind === 'subscription')) {
    const { id, manualRatio: ratio } = preset;
    const p = R.state.cache.profiles.find(q => q.id === id);
    assert.ok(p, `preset source exists: ${id}`);
    assert.strictEqual(p.kind, 'subscription', `${id} kind subscription`);
    assert.ok(R.pricing.computeSubscriptionRatio(p) != null, `${id} ratio computable`);
    assert.ok(Number.isFinite(ratio) && ratio > 0 && ratio <= 1, `${id} ratio in supported range`);
    assert.ok(Math.abs(R.pricing.computeSubscriptionRatio(p) - ratio) < 1e-9, `${id} ratio = x${ratio}`);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(p.nameIncludes)), JSON.parse(JSON.stringify(preset.nameIncludes)), `${id} model-specific rules preserved`);
    assert.ok(p.asOf && DATE_RE.test(p.asOf), `${id} asOf date present`);
  }

  // GOAT covers a broad model family list; Codex/Claude/GLM/Kimi cover their own
  const goat = R.state.cache.profiles.find(q => q.id === 'command-code-goat');
  assert.ok(goat.nameIncludes.length >= 7, 'GOAT has broad family patterns');

  console.log('integration test passed: bar mounts; repriced switch moves GLM to x=' +
    glmX.toFixed(0) + ', DeepSeek ' + dsX1.toFixed(0) + 'px -> ' + dsX2.toFixed(0) +
    'px across profiles, overlay restores in AA mode; best-of mode composes subscription+derived sources; coding plan presets valid');
}

main().catch((e) => { console.error(e); process.exit(1); });
