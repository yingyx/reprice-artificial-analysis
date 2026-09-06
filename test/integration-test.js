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

  doc.documentElement = makeElement('html');
  doc.documentElement.children = [doc.head, doc.body];
  doc.documentElement.contains = () => true;

  doc.getElementById = () => null;
  doc.createElement = (t) => makeElement(t);
  doc.createElementNS = (ns, t) => makeElement(t);
  doc.querySelectorAll = (sel) => {
    if (sel.indexOf('script[type="application/ld+json"]') !== -1) return ldJsonScripts;
    if (sel.startsWith('[id^=')) return [anchor];
    if (sel.startsWith('span')) return [];
    return [];
  };
  doc.querySelector = (sel) => (doc.querySelectorAll(sel)[0] || null);
  doc.addEventListener = () => {};
  return { doc, anchor, plot };
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
    { label: 'GPT-5.6 Luna (max)', intelligenceIndex: 52.31, costPerIntelligenceIndexTask: 0.0486, detailsUrl: '/models/gpt-5-6-luna' }
  ];
  const scripts = [
    { textContent: JSON.stringify({ '@type': 'Dataset', name: 'IQ', data: models.map(m => ({ label: m.label, intelligenceIndex: m.intelligenceIndex, detailsUrl: m.detailsUrl })) }) },
    { textContent: JSON.stringify({ '@type': 'Dataset', name: 'COST', data: models.map(m => ({ label: m.label, costPerIntelligenceIndexTask: m.costPerIntelligenceIndexTask, detailsUrl: m.detailsUrl })) }) }
  ];

  const { doc, anchor } = makeDoc(scripts);

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
  vm.createContext(ctx);

  for (const f of [
    'src/lib/pricing.js', 'src/lib/pareto.js', 'src/lib/storage.js', 'src/lib/colors.js',
    'src/lib/registry.js',
    'src/content/extract.js', 'src/content/state.js', 'src/content/chart-integration.js'
  ]) {
    run(f, ctx);
  }

  await new Promise((r) => setTimeout(r, 50));
  const R = ctx.RepriceAA;
  const contexts = R.integration._contexts();
  assert.strictEqual(contexts.length, 1, 'one context created for anchor');
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
  assert.strictEqual(ctxA.path.attrs['stroke-dasharray'], '0.1 7', 'Pareto line dotted like AA legend');
  assert.ok(ctxA.gAxis._innerHTML.indexOf('fill-opacity="0.2"') !== -1, 'MAQ shading visible');
  assert.ok(ctxA.gAxis._innerHTML.indexOf('$0.05') !== -1, 'exact log cost ticks');
  assert.ok(ctxA.gAxis._innerHTML.indexOf('>Artificial Analysis Intelligence Index<') !== -1, 'y-axis title matches AA');
  assert.ok(ctxA.gAxis._innerHTML.indexOf('<line') === -1, 'no spines/gridlines like AA');
  assert.ok(ctxA.gAxis._innerHTML.indexOf('Most attractive quadrant') === -1, 'no stray MAQ caption in plot');
  assert.ok(ctxA.gLbl && ctxA.gLbl._innerHTML.indexOf('GLM-5.3 (max)') !== -1, 'side model labels rendered');
  assert.ok(ctxA.gLbl._innerHTML.indexOf('>DeepSeek V4 Pro 0813 (max)<') !== -1, 'all model labels rendered');
  assert.ok(ctxA.gAxis._innerHTML.indexOf('>Intelligence Index<') === -1, 'short y title removed');
  assert.ok(!ctxA.nodes['glm-5-3'].querySelector('.ring'), 'no highlight rings');

  const glmNode = ctxA.nodes['glm-5-3'];
  assert.ok(glmNode, 'GLM point node exists');
  const glmX = parseX(glmNode.style.transform).x;
  assert.ok(glmX > 340 && glmX < 356, `GLM at repriced log position x=${glmX.toFixed(1)} (expected ~348)`);

  const dsNode = ctxA.nodes['deepseek-v4-pro'];
  const dsX1 = parseX(dsNode.style.transform).x;
  assert.ok(dsX1 > 260 && dsX1 < 277, `DeepSeek at 0.45x position x=${dsX1.toFixed(1)} (expected ~268)`);

  R.state.setSource('deepseek-offpeak-example');
  await new Promise((r) => setTimeout(r, 50));
  const dsX2 = parseX(ctxA.nodes['deepseek-v4-pro'].style.transform).x;
  const glmX2 = parseX(ctxA.nodes['glm-5-3'].style.transform).x;
  assert.ok(dsX2 > dsX1 + 3, `DeepSeek moves right at 0.55x: ${dsX1.toFixed(1)} -> ${dsX2.toFixed(1)}`);
  assert.ok(Math.abs(glmX2 - 525) < 5, `GLM back at AA-cost position under DeepSeek-only profile (x=${glmX2.toFixed(1)}, expected ~525)`);

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

  // Claude models: covered by Max -> unified amortized ratio (20/4.33/9 ≈ 0.5131)
  // overrides the pattern's own ×0.3; beats OpenRouter & Batch
  const claude = R.pricing.applyBest(
    [{ id: 'claude-opus-5', label: 'Claude Opus 5 (max)', intelligence: 63.05, aaCost: 2.3368 }],
    ['claude-max', 'openrouter-x', 'or-batch'],
    R.state.cache.profiles
  )[0];
  const ratio = (20 / 4.33) / 9;
  assert.ok(Math.abs(claude.repricedCost - 2.3368 * ratio) < 1e-6, 'covered claude uses amortized ratio');
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

  R.state.setSource('__aa__');
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(ctxA.wrap.style.display, 'none', 'overlay hidden in AA mode after best');

  console.log('integration test passed: bar mounts; repriced switch moves GLM to x=' +
    glmX.toFixed(0) + ', DeepSeek ' + dsX1.toFixed(0) + 'px -> ' + dsX2.toFixed(0) +
    'px across profiles, overlay restores in AA mode; best-of mode composes subscription+derived sources');
}

main().catch((e) => { console.error(e); process.exit(1); });
