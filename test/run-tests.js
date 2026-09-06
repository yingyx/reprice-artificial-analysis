'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function load(file) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', file), 'utf8');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.RepriceAA;
}

const pricing = load('pricing.js').pricing;
const pareto = load('pareto.js').pareto;

const colors = load('colors.js').colors._internals;

// registry (needs storage.js; registry state is per-context)
function loadRegistry() {
  const store = {};
  const ctx = {
    console,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    },
    setTimeout, clearTimeout
  };
  vm.createContext(ctx);
  for (const f of ['storage.js', 'registry.js']) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', f), 'utf8');
    vm.runInContext(code, ctx);
  }
  return ctx.RepriceAA.registry;
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

test('multiplier transforms cost', () => {
  const out = pricing.applyProfile(
    [{ id: 'a', label: 'A', intelligence: 50, aaCost: 1 }],
    { defaultRule: { type: 'multiplier', value: 0.5 } }
  );
  assert.strictEqual(out[0].repricedCost, 0.5);
});

test('absolute override ignores multiplier', () => {
  const out = pricing.applyProfile(
    [{ id: 'a', label: 'A', intelligence: 50, aaCost: 2 }],
    { rules: { a: { type: 'absolute', value: 0.08 } }, defaultRule: { type: 'multiplier', value: 10 } }
  );
  assert.strictEqual(out[0].repricedCost, 0.08);
  assert.strictEqual(out[0].ruleDescription, '$0.08/task');
});

test('exact override beats name match beats default', () => {
  const p = {
    defaultRule: { type: 'multiplier', value: 3 },
    nameIncludes: [{ match: 'glm', rule: { type: 'multiplier', value: 0.3 } }],
    rules: { glmx: { type: 'multiplier', value: 9 } }
  };
  const mk = (id, label) => ({ id, label, intelligence: 50, aaCost: 1 });
  const [r1, r2, r3] = pricing.applyProfile([mk('glmx', 'GLM X'), mk('glm', 'GLM'), mk('other', 'Other')], p);
  assert.strictEqual(r1.repricedCost, 9);
  assert.strictEqual(r2.repricedCost, 0.3);
  assert.strictEqual(r3.repricedCost, 3);
});

test('slug match works for url-style ids', () => {
  const p = { nameIncludes: [{ match: '/glm', rule: { type: 'multiplier', value: 0.5 } }] };
  const out = pricing.applyProfile([{ id: 'models/glm-5-3', label: 'Something Else', intelligence: 50, aaCost: 1 }], p);
  assert.strictEqual(out[0].repricedCost, 0.5);
});

test('missing aaCost yields no repriced cost', () => {
  const out = pricing.applyProfile([{ id: 'a', label: 'A', intelligence: 50 }], { defaultRule: { type: 'multiplier', value: 2 } });
  assert.strictEqual(out[0].repricedCost, null);
});

test('negative values clamped to zero', () => {
  const out = pricing.applyProfile([{ id: 'a', label: 'A', intelligence: 50, aaCost: 1 }], { rules: { a: { type: 'multiplier', value: -5 } } });
  assert.strictEqual(out[0].repricedCost, 0);
});

test('savings fraction', () => {
  assert.strictEqual(pricing.savingsFraction(0.42, 0.13).toFixed(3), '0.690');
  assert.strictEqual(pricing.savingsFraction(0, 0), null);
});

test('pareto frontier basic', () => {
  const pts = [
    { intelligence: 60, cost: 2 },
    { intelligence: 55, cost: 1 },
    { intelligence: 45, cost: 1 },
    { intelligence: 40, cost: 0.5 }
  ];
  const idx = pareto.paretoFrontierIndices(pts);
  assert.strictEqual(JSON.stringify(idx), JSON.stringify([0, 1, 3]));
});

test('pareto handles equal-cost ties via dominance', () => {
  const pts = [
    { intelligence: 55, cost: 1 },
    { intelligence: 55, cost: 1 }
  ];
  const idx = pareto.paretoFrontierIndices(pts);
  assert.strictEqual(idx.length, 1);
});

test('pareto with empty/null data', () => {
  assert.strictEqual(pareto.paretoFrontierIndices([]).length, 0);
  assert.strictEqual(pareto.paretoFrontierIndices([{ intelligence: NaN, cost: NaN }]).length, 0);
});

test('dominates strictness rules', () => {
  const a = { intelligence: 60, cost: 1 };
  assert.ok(pareto.dominates(a, { intelligence: 59, cost: 2 }));
  assert.ok(!pareto.dominates(a, { intelligence: 60, cost: 1 }));
  assert.ok(!pareto.dominates(a, { intelligence: 61, cost: 1 }));
});

test('provider inference from labels and slugs', () => {
  assert.strictEqual(colors.inferProviderName('Claude Opus 5 (max)', 'claude-opus-5'), 'Anthropic');
  assert.strictEqual(colors.inferProviderName('GLM-5.3 (max)', 'glm-5-3'), 'Z AI');
  assert.strictEqual(colors.inferProviderName('Qwen3.8 27B', 'qwen3-8'), 'Alibaba');
  assert.strictEqual(colors.inferProviderName('DeepSeek V4', 'deepseek-v4'), 'DeepSeek');
  assert.strictEqual(colors.inferProviderName('Totally Unknown Model', 'xyz'), null);
});

// ---- source engine (basedOn / fallbackTo / subscription / best-of) ----

const mkModel = (id, label, intelligence, aaCost) => ({ id, label, intelligence, aaCost });
const OPENROUTER = {
  id: 'openrouter', name: 'OpenRouter', kind: 'usage',
  defaultRule: { type: 'multiplier', value: 1.055 }, rules: {}, nameIncludes: []
};
const SOURCES = [OPENROUTER];

test('legacy applyProfile behavior unchanged', () => {
  const out = pricing.applyProfile([mkModel('a', 'A', 50, 2)], { defaultRule: { type: 'multiplier', value: 0.5 } });
  assert.strictEqual(out[0].repricedCost, 1);
});

test('applySource with no source yields AA identity', () => {
  const out = pricing.applySource([mkModel('a', 'A', 50, 2)], null, SOURCES);
  assert.strictEqual(out[0].repricedCost, 2);
  assert.strictEqual(out[0].ruleSource, 'identity');
});

test('applySource resolves usage source default rule', () => {
  const out = pricing.applySource([mkModel('a', 'A', 50, 2)], OPENROUTER, SOURCES);
  assert.ok(Math.abs(out[0].repricedCost - 2 * 1.055) < 1e-9);
  assert.strictEqual(out[0].sourceId, 'openrouter');
});

test('basedOn composition: child multiplies parent price', () => {
  const batch = { id: 'ob', name: 'OpenRouter@Batch', basedOn: 'openrouter', defaultRule: { type: 'multiplier', value: 0.5 } };
  const out = pricing.applySource([mkModel('a', 'A', 50, 2)], batch, [...SOURCES, batch]);
  assert.ok(Math.abs(out[0].repricedCost - 2 * 1.055 * 0.5) < 1e-9);
});

test('basedOn child exact override applies to parent price', () => {
  // Grok has no batch discount: x1.0 on the parent price keeps the OpenRouter markup
  const batch = {
    id: 'ob', name: 'OpenRouter@Batch', basedOn: 'openrouter',
    defaultRule: { type: 'multiplier', value: 0.5 },
    rules: { grok: { type: 'multiplier', value: 1 } }
  };
  const out = pricing.applySource([mkModel('grok', 'Grok 4.6', 50, 2)], batch, [...SOURCES, batch]);
  assert.ok(Math.abs(out[0].repricedCost - 2 * 1.055) < 1e-9);
});

test('basedOn child absolute rule replaces parent price', () => {
  const batch = { id: 'ob', basedOn: 'openrouter', rules: { a: { type: 'absolute', value: 3 } } };
  const out = pricing.applySource([mkModel('a', 'A', 50, 2)], batch, [...SOURCES, batch]);
  assert.strictEqual(out[0].repricedCost, 3);
});

test('basedOn missing parent skips the link, own op applies to AA cost', () => {
  const orphan = { id: 'orphan', basedOn: 'gone', defaultRule: { type: 'multiplier', value: 0.5 } };
  const out = pricing.applySource([mkModel('a', 'A', 50, 2)], orphan, [orphan]);
  assert.strictEqual(out[0].repricedCost, 1);
});

test('fallbackTo: unmatched models fall through to target source', () => {
  const sub = {
    id: 'max', name: 'Claude Max', kind: 'subscription',
    nameIncludes: [{ match: 'claude', rule: { type: 'multiplier', value: 0.3 } }],
    fallbackTo: 'openrouter'
  };
  const models = [mkModel('claude-x', 'Claude X', 50, 2), mkModel('gpt', 'GPT', 50, 4)];
  const out = pricing.applySource(models, sub, [...SOURCES, sub]);
  assert.ok(Math.abs(out[0].repricedCost - 0.6) < 1e-9, 'covered model uses ratio');
  assert.ok(Math.abs(out[1].repricedCost - 4 * 1.055) < 1e-9, 'uncovered model falls back');
});

test('fallbackTo: excluded model falls back (subscription exception case)', () => {
  const sub = {
    id: 'max', kind: 'subscription',
    nameIncludes: [{ match: 'claude', rule: { type: 'multiplier', value: 0.3 } }],
    fallbackTo: 'openrouter',
    rules: { 'claude-haiku': { type: 'exclude' } }
  };
  const out = pricing.applySource([mkModel('claude-haiku', 'Claude Haiku', 50, 1)], sub, [...SOURCES, sub]);
  assert.ok(Math.abs(out[0].repricedCost - 1.055) < 1e-9);
});

test('subscription without fallback: uncovered model at AA list price', () => {
  const sub = { id: 'max', kind: 'subscription', nameIncludes: [{ match: 'claude', rule: { type: 'multiplier', value: 0.3 } }] };
  const out = pricing.applySource([mkModel('gpt', 'GPT', 50, 4)], sub, [sub]);
  assert.strictEqual(out[0].repricedCost, 4);
});

test('fallback cycle detected and guarded', () => {
  const a = { id: 'a', kind: 'subscription', fallbackTo: 'b' };
  const b = { id: 'b', kind: 'subscription', fallbackTo: 'a' };
  const out = pricing.applySource([mkModel('m', 'M', 50, 2)], a, [a, b]);
  assert.strictEqual(out[0].repricedCost, 2);
  assert.ok(out[0].anomalies.indexOf('chain-loop') !== -1);
});

test('until: active rule applies, expired rule skipped', () => {
  const src = {
    id: 'promo', name: 'Promo',
    defaultRule: { type: 'multiplier', value: 0.55, until: '2026-12-31' }
  };
  const ctx = pricing.makeCtx([src], '2026-06-01');
  const out1 = pricing.resolvePrice(mkModel('a', 'A', 50, 2), 'promo', ctx);
  assert.ok(Math.abs(out1.price - 1.1) < 1e-9);
  const ctx2 = pricing.makeCtx([src], '2027-01-01');
  const out2 = pricing.resolvePrice(mkModel('a', 'A', 50, 2), 'promo', ctx2);
  assert.strictEqual(out2.price, 2);
});

test('formula rule evaluates with aaCost and base', () => {
  const src = { id: 'f', defaultRule: { type: 'formula', expr: 'aaCost * 0.5 + 0.01' } };
  const out = pricing.applySource([mkModel('a', 'A', 50, 2)], src, [src]);
  assert.ok(Math.abs(out[0].repricedCost - 1.01) < 1e-9);
});

test('formula error falls back to base with anomaly', () => {
  const src = { id: 'f', defaultRule: { type: 'formula', expr: 'aaCost + oops)' } };
  const out = pricing.applySource([mkModel('a', 'A', 50, 2)], src, [src]);
  assert.strictEqual(out[0].repricedCost, 2);
  assert.ok(out[0].anomalies.indexOf('formula-error') !== -1);
});

test('zero-cost anomaly flagged', () => {
  const src = { id: 'free', defaultRule: { type: 'absolute', value: 0 } };
  const out = pricing.applySource([mkModel('a', 'A', 50, 2)], src, [src]);
  assert.strictEqual(out[0].repricedCost, 0);
  assert.ok(out[0].anomalies.indexOf('zero-cost') !== -1);
});

test('missing aaCost yields null with no-list-price anomaly', () => {
  const out = pricing.applySource([{ id: 'a', label: 'A', intelligence: 50 }], OPENROUTER, SOURCES);
  assert.strictEqual(out[0].repricedCost, null);
  assert.ok(out[0].anomalies.indexOf('no-list-price') !== -1);
});

test('applyBest picks min across enabled sources with provenance', () => {
  const sub = {
    id: 'max', name: 'Claude Max', kind: 'subscription',
    nameIncludes: [{ match: 'claude', rule: { type: 'multiplier', value: 0.3 } }],
    fallbackTo: 'openrouter'
  };
  const sources = [...SOURCES, sub];
  const models = [mkModel('claude-x', 'Claude X', 50, 2), mkModel('gpt', 'GPT', 50, 4)];
  const out = pricing.applyBest(models, ['max', 'openrouter'], sources);
  assert.ok(Math.abs(out[0].repricedCost - 0.6) < 1e-9);
  assert.strictEqual(out[0].winnerSourceId, 'max');
  assert.strictEqual(out[0].candidates.length, 2);
  assert.ok(Math.abs(out[1].repricedCost - 4 * 1.055) < 1e-9, 'min(4.22, 4.22) via fallback');
  assert.strictEqual(out[1].winnerSourceId, 'max', 'tie prefers earlier enabled order');
});

test('applyBest tie prefers earlier enabled order', () => {
  const s1 = { id: 's1', defaultRule: { type: 'multiplier', value: 1 } };
  const s2 = { id: 's2', defaultRule: { type: 'multiplier', value: 1 } };
  const out = pricing.applyBest([mkModel('a', 'A', 50, 2)], ['s2', 's1'], [s1, s2]);
  assert.strictEqual(out[0].winnerSourceId, 's2');
});

test('applyBest ignores disabled/unknown source ids', () => {
  const out = pricing.applyBest([mkModel('a', 'A', 50, 2)], ['openrouter', 'ghost'], SOURCES);
  assert.ok(Math.abs(out[0].repricedCost - 2.11) < 1e-9);
});

test('applyBest with no valid sources yields null price', () => {
  const out = pricing.applyBest([mkModel('a', 'A', 50, 2)], [], SOURCES);
  assert.strictEqual(out[0].repricedCost, null);
  assert.ok(out[0].anomalies.indexOf('no-candidate') !== -1);
});

test('subscription: amortized ratio overrides pattern rule values', () => {
  const sub = {
    id: 'codex', name: 'Codex Plus', kind: 'subscription',
    monthlyFee: 20, monthlyQuotaTokens: 4.33e6, refBlendedPrice: 9,
    nameIncludes: [{ match: 'gpt', rule: { type: 'multiplier', value: 0.3 } }],
    fallbackTo: 'openrouter'
  };
  const out = pricing.applySource([mkModel('gpt-x', 'GPT X', 50, 2)], sub, [...SOURCES, sub]);
  const expected = 2 * ((20 / 4.33) / 9);
  assert.ok(Math.abs(out[0].repricedCost - expected) < 1e-9, 'unified ratio applied, not 0.3');
});

test('subscription: pattern rule value used when ratio not computable', () => {
  const sub = {
    id: 'max', kind: 'subscription',
    nameIncludes: [{ match: 'claude', rule: { type: 'multiplier', value: 0.3 } }]
  };
  const out = pricing.applySource([mkModel('claude-x', 'Claude X', 50, 2)], sub, [sub]);
  assert.ok(Math.abs(out[0].repricedCost - 0.6) < 1e-9);
});

test('computeSubscriptionRatio: amortize, manual override, invalid inputs', () => {
  // $20/月 ÷ 4.33M tokens ≈ $4.618/M ÷ $9/M ≈ 0.513
  const ratio = pricing.computeSubscriptionRatio({
    kind: 'subscription', monthlyFee: 20, monthlyQuotaTokens: 4.33e6, refBlendedPrice: 9
  });
  assert.ok(Math.abs(ratio - (20 / 4.33) / 9) < 1e-9);
  assert.strictEqual(
    pricing.computeSubscriptionRatio({ kind: 'subscription', manualRatio: 0.3, monthlyFee: 20, monthlyQuotaTokens: 1, refBlendedPrice: 9 }),
    0.3, 'manual ratio wins');
  assert.strictEqual(pricing.computeSubscriptionRatio({ kind: 'subscription', monthlyFee: 20 }), null);
  assert.strictEqual(pricing.computeSubscriptionRatio({ kind: 'usage', monthlyFee: 20, monthlyQuotaTokens: 1, refBlendedPrice: 9 }), null);
});

test('normalizeRule: unknown type without value falls back; preserves valid until', () => {
  // percentOff is converted to multiplier at the UI layer before storage
  const j = (v) => JSON.stringify(v);
  assert.strictEqual(j(pricing.normalizeRule({ type: 'percentOff' })), j({ type: 'multiplier', value: 1 }));
  assert.strictEqual(
    j(pricing.normalizeRule({ type: 'multiplier', value: 0.5, until: '2026-12-31' })),
    j({ type: 'multiplier', value: 0.5, until: '2026-12-31' }));
  assert.strictEqual(
    j(pricing.normalizeRule({ type: 'multiplier', value: 0.5, until: 'not-a-date' })),
    j({ type: 'multiplier', value: 0.5 }));
});

// ---- registry: cache invalidation across Intelligence Index versions ----

test('registry: on-page models stamped with page version', () => {
  const reg = loadRegistry();
  const out = reg.merge(
    [{ id: 'astra-max', label: 'Astra Max', intelligence: 55, aaCost: 0.9 }],
    '4.2'
  );
  assert.strictEqual(out[0].ver, '4.2');
  assert.strictEqual(out[0].intelligence, 55);
  assert.strictEqual(out[0]._cached, undefined);
});

test('registry: same-version cached model still emitted', () => {
  const reg = loadRegistry();
  reg.upsertModels([{ id: 'x', label: 'X', intelligence: 61, aaCost: 1 }], '4.2');
  const out = reg.merge([{ id: 'astra-max', label: 'A', intelligence: 55, aaCost: 1 }], '4.2');
  const x = out.find(m => m.id === 'x');
  assert.ok(x && x._cached, 'cached entry kept under same version');
  assert.strictEqual(x.intelligence, 61);
});

test('registry: cached model dropped when page version differs (v4.1.1 -> v4.2)', () => {
  const reg = loadRegistry();
  reg.upsertModels([{ id: 'astra-max', label: 'Astra Max', intelligence: 61, aaCost: 0.9 }], '4.1.1');
  const out = reg.merge([{ id: 'other', label: 'Other', intelligence: 50, aaCost: 1 }], '4.2');
  assert.strictEqual(out.find(m => m.id === 'astra-max'), undefined, 'stale-version entry excluded');
  assert.strictEqual(out.find(m => m.id === 'other').id, 'other');
});

test('registry: cached model dropped when its version is unknown and page declares one', () => {
  const reg = loadRegistry();
  reg.upsertModels([{ id: 'old', label: 'Old', intelligence: 61, aaCost: 1 }]); // pre-version-scheme cache
  const out = reg.merge([{ id: 'other', label: 'Other', intelligence: 50, aaCost: 1 }], '4.2');
  assert.strictEqual(out.find(m => m.id === 'old'), undefined);
});

test('registry: no page version -> cached entries keep working', () => {
  const reg = loadRegistry();
  reg.upsertModels([{ id: 'x', label: 'X', intelligence: 61, aaCost: 1 }], '4.2');
  const out = reg.merge([{ id: 'other', label: 'Other', intelligence: 50, aaCost: 1 }]);
  assert.ok(out.find(m => m.id === 'x') && out.find(m => m.id === 'x')._cached);
});

test('registry: on-page refresh overwrites stale intelligence and version', () => {
  const reg = loadRegistry();
  reg.upsertModels([{ id: 'astra-max', label: 'Astra Max', intelligence: 61, aaCost: 0.9 }], '4.1.1');
  const out = reg.merge([{ id: 'astra-max', label: 'Astra Max', intelligence: 55, aaCost: 0.85 }], '4.2');
  const astra = out.find(m => m.id === 'astra-max');
  assert.strictEqual(astra.intelligence, 55);
  assert.strictEqual(astra.ver, '4.2');
  assert.strictEqual(astra._cached, undefined);
});

console.log(passed + ' tests passed');
