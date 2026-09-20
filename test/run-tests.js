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

// ---- preset promos (limited-time offers layered on a source) ----

const GO = {
  id: 'go', name: 'Go', kind: 'subscription', monthlyFee: 60, manualRatio: 0.05,
  defaultRule: { type: 'multiplier', value: 0.05 },
  nameIncludes: [{ match: 'deepseek', rule: { type: 'multiplier', value: 0.45 } }],
  promos: [{
    match: 'deepseek', rule: { type: 'multiplier', value: 0.1125 },
    reason: 'limited-time 4x quota', startsAt: '2026-09-11', endsAt: null
  }]
};
const mkGo = (today) => pricing.makeCtx([GO], today);
const DS = () => mkModel('deepseek-v41-flash', 'DeepSeek V4.1 Flash', 50, 2);

test('promo: active promo beats name-match and subscription ratio', () => {
  const out = pricing.resolvePrice(DS(), 'go', mkGo('2026-09-20'));
  assert.ok(Math.abs(out.price - 2 * 0.1125) < 1e-9, 'promo value 0.1125x, not 0.45x or 0.05x');
  assert.strictEqual(out.ruleSource, 'promo');
  assert.ok(out.ruleDescription.indexOf('promo') !== -1, 'null endsAt marked limited');
  assert.strictEqual(out.promo.reason, 'limited-time 4x quota');
  assert.strictEqual(out.promo.endsAt, null);
});

test('promo: exact override beats promo', () => {
  const src = Object.assign({}, GO, { rules: { 'deepseek-v41-flash': { type: 'multiplier', value: 0.4 } } });
  const out = pricing.resolvePrice(DS(), 'go', pricing.makeCtx([src], '2026-09-20'));
  assert.ok(Math.abs(out.price - 2 * 0.4) < 1e-9);
  assert.strictEqual(out.ruleSource, 'override');
  assert.strictEqual(out.promo, undefined);
});

test('promo: expired endsAt and future startsAt ignored', () => {
  const expired = Object.assign({}, GO.promos[0], { endsAt: '2026-10-01' });
  const out = pricing.resolvePrice(DS(), 'go', pricing.makeCtx([GO], '2027-09-11'));
  // GO.promos has no endsAt (indefinite) - replace it with the dated one
  const goExpired = Object.assign({}, GO, { promos: [expired] });
  const out2 = pricing.resolvePrice(DS(), 'go', pricing.makeCtx([goExpired], '2027-09-11'));
  assert.ok(Math.abs(out2.price - 2 * 0.45) < 1e-9, 'falls through to the pattern rule value (per-model pricing)');
  assert.strictEqual(out2.ruleSource, 'nameMatch', 'no promo provenance');
  const future = Object.assign({}, GO, { promos: [Object.assign({}, GO.promos[0], { startsAt: '2026-12-01' })] });
  const out3 = pricing.resolvePrice(DS(), 'go', pricing.makeCtx([future], '2026-09-20'));
  assert.ok(Math.abs(out3.price - 2 * 0.45) < 1e-9, 'not started yet');
});

test('promo: dated endsAt surfaces the date in the description', () => {
  const src = Object.assign({}, GO, { promos: [Object.assign({}, GO.promos[0], { endsAt: '2026-12-31' })] });
  const out = pricing.resolvePrice(DS(), 'go', pricing.makeCtx([src], '2026-09-20'));
  assert.ok(out.ruleDescription.indexOf('2026-12-31') !== -1);
  assert.ok(out.ruleDescription.indexOf('promo') === -1, 'no limited marker when dated');
});

test('promo: applyBest winner carries promo provenance', () => {
  const out = pricing.applyBest([DS()], ['go'], [GO]);
  assert.strictEqual(out[0].winnerSourceId, 'go');
  assert.ok(out[0].ruleDescription.indexOf('promo') !== -1);
});

test('formula rule evaluates with aaCost and base', () => {
  const src = { id: 'f', defaultRule: { type: 'formula', expr: 'aaCost * 0.5 + 0.01' } };
  const out = pricing.applySource([mkModel('a', 'A', 50, 2)], src, [src]);
  assert.ok(Math.abs(out[0].repricedCost - 1.01) < 1e-9);
});

test('formula: whitelist parser rejects code execution attempts', () => {
  const attacks = [
    '(function(){ return 42; })()',
    'this.constructor.constructor("return 1")()',
    '`${1}`',
    'aaCost; globalThis.__pwned = true',
    'require("fs")',
    'process.exit(1)'
  ];
  for (const expr of attacks) {
    assert.strictEqual(pricing.evalFormula(expr, { aaCost: 1, base: 1 }), null, expr);
    assert.ok(!pricing.isFormulaSafe(expr), 'unsafe: ' + expr);
    const src = { id: 'f', defaultRule: { type: 'formula', expr: expr } };
    const out = pricing.applySource([mkModel('a', 'A', 50, 2)], src, [src]);
    assert.strictEqual(out[0].repricedCost, 2, 'falls back to base: ' + expr);
    assert.ok(out[0].anomalies.indexOf('formula-error') !== -1);
  }
});

test('formula: whitelisted helpers, constants and precedence still evaluate', () => {
  assert.ok(Math.abs(pricing.evalFormula('min(aaCost, base) + round(0.4)', { aaCost: 2, base: 1 }) - 1) < 1e-9);
  assert.ok(Math.abs(pricing.evalFormula('Math.max(aaCost * 2, 5)', { aaCost: 2, base: 1 }) - 5) < 1e-9);
  assert.ok(Math.abs(pricing.evalFormula('-(aaCost - base) % 3', { aaCost: 4, base: 1 }) - 0) < 1e-9);
  assert.ok(Math.abs(pricing.evalFormula('PI', { aaCost: 1, base: 1 }) - Math.PI) < 1e-9);
  assert.strictEqual(pricing.evalFormula('aaCost > 1 ? 1 : 0', { aaCost: 2, base: 1 }), null);
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

test('subscription: pattern rule value is the per-model price (beats amortized ratio)', () => {
  const sub = {
    id: 'codex', name: 'Codex Plus', kind: 'subscription',
    monthlyFee: 20, monthlyQuotaTokens: 4.33e6, refBlendedPrice: 9,
    nameIncludes: [{ match: 'gpt', rule: { type: 'multiplier', value: 0.3 } }],
    fallbackTo: 'openrouter'
  };
  const out = pricing.applySource([mkModel('gpt-x', 'GPT X', 50, 2)], sub, [...SOURCES, sub]);
  assert.ok(Math.abs(out[0].repricedCost - 0.6) < 1e-9, 'pattern value 0.3 wins, not the unified ratio');
});

test('subscription: coverage-only pattern (no rule) falls back to amortized ratio', () => {
  const sub = {
    id: 'codex', name: 'Codex Plus', kind: 'subscription',
    monthlyFee: 20, monthlyQuotaTokens: 4.33e6, refBlendedPrice: 9,
    nameIncludes: [{ match: 'gpt' }],
    fallbackTo: 'openrouter'
  };
  const out = pricing.applySource([mkModel('gpt-x', 'GPT X', 50, 2)], sub, [...SOURCES, sub]);
  const expected = 2 * ((20 / 4.33) / 9);
  assert.ok(Math.abs(out[0].repricedCost - expected) < 1e-9, 'rule-less entry falls back to unified ratio');
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

// ---- source presets (data/sources.json -> generated src/data/sources.js) ----

const RULE_TYPES = ['multiplier', 'absolute', 'percentOff', 'formula', 'exclude'];
const isRule = (r) => r && typeof r === 'object' && RULE_TYPES.indexOf(r.type) !== -1
  && (r.type === 'exclude' || r.type === 'formula' || typeof r.value === 'number');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function loadSourceDoc() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'sources.json'), 'utf8'));
}

const sourceDoc = loadSourceDoc();

test('sources: document shape with ordered, unique, valid entries', () => {
  assert.strictEqual(sourceDoc.schema, 1, 'schema field');
  assert.ok(Array.isArray(sourceDoc.sources) && sourceDoc.sources.length >= 10, 'preset library non-trivial');
  const ids = new Set();
  for (const profile of sourceDoc.sources) {
    const label = 'entry ' + (profile && profile.id);
    assert.ok(typeof profile.id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(profile.id), label + ' id');
    assert.ok(!ids.has(profile.id), 'unique id: ' + profile.id);
    ids.add(profile.id);
    assert.ok(typeof profile.name === 'string' && profile.name, label + ' name');
    assert.ok(isRule(profile.defaultRule), label + ' defaultRule');
    assert.strictEqual(typeof profile.rules, 'object', label + ' rules');
    for (const entry of profile.nameIncludes || []) {
      assert.ok(typeof entry.match === 'string' && isRule(entry.rule), label + ' nameIncludes entry');
    }
    if (profile.kind === 'subscription') {
      assert.ok(profile.manualRatio > 0 && profile.manualRatio <= 1, label + ' manualRatio sane');
      assert.ok(profile.monthlyFee > 0, label + ' monthlyFee sane');
    }
    if (profile.asOf) assert.ok(DATE_RE.test(profile.asOf), label + ' asOf format');
    for (const p of profile.promos || []) {
      assert.ok(typeof p.match === 'string' && isRule(p.rule), label + ' promo match/rule');
      assert.ok(p.startsAt == null || DATE_RE.test(p.startsAt), label + ' promo startsAt');
      assert.ok(p.endsAt == null || DATE_RE.test(p.endsAt), label + ' promo endsAt');
      assert.ok(p.reason == null || typeof p.reason === 'string', label + ' promo reason');
    }
    assert.strictEqual(profile.builtin, undefined, label + ' builtin is injected, not hand-written');
  }
});

test('sources: generated src/data/sources.js in sync with data/sources.json', () => {
  const { buildSourcesModule } = require('../scripts/build-sources.js');
  const repoRoot = path.join(__dirname, '..');
  const generated = fs.readFileSync(path.join(repoRoot, 'src', 'data', 'sources.js'), 'utf8')
    .replace(/\r\n/g, '\n'); // EOL-normalize: autocrlf checkouts differ from the LF build output
  assert.strictEqual(generated, buildSourcesModule(repoRoot),
    'src/data/sources.js is stale - run: node scripts/build-sources.js');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(generated, ctx);
  const sources = ctx.RepriceAA.SOURCES;
  assert.ok(Array.isArray(sources) && sources.length === sourceDoc.sources.length);
  sources.forEach(p => assert.ok(p.builtin === true, p.id + ' builtin flag injected'));
});

// ---- remote preset updates (src/lib/remotesources.js) ----

function loadRemotesources() {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'remotesources.js'), 'utf8'), ctx);
  return ctx.RepriceAA.remotesources;
}

const remotesources = loadRemotesources();

// state.js sandbox: storage stub + a preset snapshot, mirroring loadRegistry
function loadStateModule(SOURCES, seed) {
  const store = {};
  if (seed) Object.keys(seed).forEach(k => { store[k] = seed[k]; });
  const ctx = {
    console: { debug() { }, log() { }, warn() { }, error() { } },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    },
    setTimeout, clearTimeout
  };
  ctx.window = ctx;
  ctx.RepriceAA = { SOURCES: JSON.parse(JSON.stringify(SOURCES)) };
  vm.createContext(ctx);
  for (const f of ['storage.js', '../content/state.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', f), 'utf8'), ctx);
  }
  return ctx.RepriceAA;
}

const SRC = (id, asOf, name) => ({
  id, name: name || id, kind: 'subscription', manualRatio: 0.1,
  defaultRule: { type: 'multiplier', value: 0.1 }, rules: {}, nameIncludes: [], asOf
});

test('remotesources: stale payload cannot downgrade a source (monotonic asOf)', async () => {
  const R = loadStateModule([SRC('go', '2026-09-18')]);
  await R.state.applyRemoteSources([SRC('go', '2026-09-16')]);
  assert.strictEqual(R.SOURCES.length, 1);
  assert.strictEqual(R.SOURCES[0].asOf, '2026-09-18', 'kept the newer current copy');
});

test('remotesources: newer remote payload applies; bundled-only sources retained', async () => {
  const R = loadStateModule([SRC('go', '2026-09-18'), SRC('claude', '2026-09-01')]);
  await R.state.applyRemoteSources([SRC('go', '2026-09-20'), SRC('kimi', '2026-09-19')]);
  const ids = Array.from(R.SOURCES, s => s.id + ':' + s.asOf).sort();
  assert.deepStrictEqual(ids, ['claude:2026-09-01', 'go:2026-09-20', 'kimi:2026-09-19']);
});

test('remotesources: equal asOf resolves to the current bundled copy', async () => {
  const R = loadStateModule([SRC('go', '2026-09-18')]);
  await R.state.applyRemoteSources([SRC('go', '2026-09-18', 'Stale Mirror Name')]);
  assert.strictEqual(R.SOURCES[0].name, 'go', 'tie kept the current preset');
});

test('remotesources: cache-bust targets jsDelivr mirrors with a UTC-day stamp', () => {
  assert.strictEqual(
    remotesources.cacheBustFor('https://raw.githubusercontent.com/x/y/main/data/sources.json'),
    'https://raw.githubusercontent.com/x/y/main/data/sources.json',
    'raw.githubusercontent has short cache - untouched');
  const busted = remotesources.cacheBustFor('https://fastly.jsdelivr.net/gh/x/y@main/data/sources.json');
  assert.ok(/^https:\/\/fastly\.jsdelivr\.net\/gh\/x\/y@main\/data\/sources\.json\?t=\d{4}-\d{2}-\d{2}$/.test(busted));
});

test('remotesources: forced refresh bypasses the edge cache with a nonce', () => {
  const a = remotesources.cacheBustFor('https://fastly.jsdelivr.net/gh/x/y@main/data/sources.json', true);
  assert.ok(/\?t=\d{13,}$/.test(a), a);
  assert.ok(a !== remotesources.cacheBustFor('https://fastly.jsdelivr.net/gh/x/y@main/data/sources.json'),
    'background stamp (UTC day) differs from the forced nonce');
});

test('state: first run defaults Auto-best to every built-in source', async () => {
  const R = loadStateModule([SRC('go', '2026-09-18'), SRC('claude', '2026-09-01')]);
  await R.state.load();
  assert.deepStrictEqual(Array.from(R.state.getEnabledSourceIds()).sort(), ['claude', 'go']);
});

test('state: deleted builtins excluded from the default Auto-best set', async () => {
  const R = loadStateModule([SRC('go', '2026-09-18'), SRC('claude', '2026-09-01')], {
    'repriceaa.deletedBuiltinIds': JSON.stringify(['claude'])
  });
  await R.state.load();
  assert.deepStrictEqual(Array.from(R.state.getEnabledSourceIds()), ['go']);
});

test('state: explicitly emptied Auto-best list stays empty', async () => {
  const R = loadStateModule([SRC('go', '2026-09-18')], {
    'repriceaa.prefs': JSON.stringify({ enabledSourceIds: [] })
  });
  await R.state.load();
  assert.deepStrictEqual(Array.from(R.state.getEnabledSourceIds()), []);
});

test('build-sources: broad-pattern lint flags short/digit-less patterns only', () => {
  const { lintPatternWarnings } = require('../scripts/build-sources.js');
  const warns = lintPatternWarnings([
    { id: 'a', nameIncludes: [{ match: 'hy', rule: { type: 'multiplier', value: 1 } }, { match: 'gpt-5.6 luna', rule: { type: 'multiplier', value: 1 } }] },
    { id: 'b', nameIncludes: [{ match: 'muse spark 1.3 contributor', rule: { type: 'multiplier', value: 1 } }] }
  ]);
  assert.deepStrictEqual(warns, [
    'a: broad pattern "hy" - keep only if every AA model it matches is in the plan'
  ]);
});

test('pricing: pattern matching is punctuation-insensitive (plan vs AA spelling)', () => {
  const sub = {
    id: 'go', name: 'Go', kind: 'subscription',
    nameIncludes: [
      { match: 'gpt 5.6 luna', rule: { type: 'multiplier', value: 0.667 } },
      { match: 'minimax m3', rule: { type: 'multiplier', value: 0.167 } },
      { match: 'longcat-2.0', rule: { type: 'multiplier', value: 0.167 } }
    ]
  };
  const labels = [
    ['GPT-5.6 Luna (max)', 0.667],
    ['MiniMax-M3', 0.167],
    ['LongCat 2.0', 0.167],
    ['GLM-5.3-Flash', null]
  ];
  for (const [label, expected] of labels) {
    const out = pricing.applySource([mkModel('x', label, 50, 2)], sub, [sub]);
    if (expected === null) {
      assert.strictEqual(out[0].repricedCost, 2, label + ' stays uncovered');
    } else {
      assert.ok(Math.abs(out[0].repricedCost - 2 * expected) < 1e-9, label + ' matched');
    }
  }
});

test('build-sources: punctuation-equivalent patterns count as duplicates', () => {
  const { loadSourceProfiles } = require('../scripts/build-sources.js');
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'sources.json'), 'utf8'));
  doc.sources[0].nameIncludes.push({ match: 'gpt 5.6 luna', rule: { type: 'multiplier', value: 0.5 } });
  const orig = fs.readFileSync;
  fs.readFileSync = (p, ...rest) => (String(p).endsWith('sources.json') && String(p).indexOf('data') !== -1
    ? JSON.stringify(doc) : orig(p, ...rest));
  try {
    loadSourceProfiles('.');
    assert.ok(false, 'expected duplicate-pattern failure');
  } catch (e) {
    assert.ok(/duplicate match pattern/.test(e.message), e.message);
  } finally {
    fs.readFileSync = orig;
  }
});

// ---- pattern cross-check against the AA model registry ----

const checkPatterns = require('../scripts/check-patterns.js');

test('check-patterns: extracts ld+json labels and embedded registry names', () => {
  const html = '<script type="application/ld+json">{"name":"IQ","data":[{"label":"GPT-5.6 Luna (max)"}]}</script>'
    + '<script>x</script>';
  const names = checkPatterns.extractAaModelNames(html);
  assert.ok(names.indexOf('GPT-5.6 Luna (max)') !== -1);
});

test('check-patterns: zero-hit patterns flagged, dash/space spellings match', () => {
  const names = ['GPT-5.6 Luna (max)', 'MiniMax-M3', 'Muse Glimmer (high)'];
  const { lines, zeroHitCount } = checkPatterns.auditPatterns([
    {
      id: 'a',
      nameIncludes: [
        { match: 'gpt 5.6 luna', rule: { type: 'multiplier', value: 1 } },
        { match: 'minimax m3', rule: { type: 'multiplier', value: 1 } },
        { match: 'muse spark 1.3 contributor', rule: { type: 'multiplier', value: 1 } }
      ]
    }
  ], names);
  assert.strictEqual(zeroHitCount, 1, 'only the AA-absent pattern is flagged');
  assert.strictEqual(lines.length, 1);
  assert.ok(lines[0].indexOf('muse spark 1.3 contributor') !== -1, lines.join('\n'));
});

test('check-patterns: id-based patterns are not label-audited', () => {
  const names = ['Kimi K3 (max)'];
  const { zeroHitCount } = checkPatterns.auditPatterns(
    [{ id: 'a', nameIncludes: [{ match: '/kimi-k3', rule: { type: 'multiplier', value: 1 } }] }], names);
  assert.strictEqual(zeroHitCount, 0, 'slash patterns are id-matched, not audited against names');
});

test('remotesources: data/sources.json passes runtime payload validation', () => {
  const payload = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'sources.json'), 'utf8'));
  assert.strictEqual(remotesources.validatePayload(payload), null);
});

test('remotesources: bad payloads rejected with a reason', () => {
  assert.ok(remotesources.validatePayload(null), 'null rejected');
  assert.ok(remotesources.validatePayload({ schema: 2, sources: [] }), 'schema version rejected');
  assert.ok(remotesources.validatePayload({ schema: 1 }), 'missing sources rejected');
  assert.ok(remotesources.validatePayload({ schema: 1, sources: [{ id: 'Bad Id!' }] }), 'bad id rejected');
  assert.ok(remotesources.validatePayload({
    schema: 1,
    sources: [
      { id: 'a', name: 'A', defaultRule: { type: 'multiplier', value: 1 }, nameIncludes: [] },
      { id: 'a', name: 'A2', defaultRule: { type: 'multiplier', value: 1 }, nameIncludes: [] }
    ]
  }), 'duplicate ids rejected');
  assert.ok(remotesources.validatePayload({
    schema: 1,
    sources: [{ id: 'a', name: 'A', defaultRule: { type: 'banana', value: 1 }, nameIncludes: [] }]
  }), 'unknown rule type rejected');
  assert.ok(remotesources.validatePayload({
    schema: 1,
    sources: [{ id: 'sub', name: 'S', kind: 'subscription', manualRatio: 0, defaultRule: { type: 'multiplier', value: 1 }, nameIncludes: [] }]
  }), 'subscription with zero ratio rejected');
});

// ---- provider page change detection (scripts/check-providers.js) ----

const checkProviders = require('../scripts/check-providers.js');

test('check-providers: price signals exclude noise (timestamps, counters)', () => {
  const noisy = 'Last updated: Sep 16, 2026 349 releases shipped 104k developers '
    + 'Join 100K+ developers v1.54.0 © 2026 PR #101864';
  assert.deepStrictEqual(checkProviders.extractPriceSignals(noisy), []);
});

test('check-providers: price signals capture currency, percent, multipliers, free', () => {
  const toks = checkProviders.extractPriceSignals(
    '$0.15 $70 50% 20%/5h 4x \u00d7 7\u00d7 multiplier Free ~$100 eff.');
  assert.ok(toks.indexOf('$0.15') !== -1);
  assert.ok(toks.indexOf('$70') !== -1);
  assert.ok(toks.indexOf('50%') !== -1);
  assert.ok(toks.indexOf('20%') !== -1);
  assert.ok(toks.indexOf('4x') !== -1);
  assert.ok(toks.indexOf('free') !== -1);
  assert.ok(toks.indexOf('7\u00d7') !== -1);
});

test('check-providers: signal hash is order-insensitive, empty yields null', () => {
  assert.strictEqual(
    checkProviders.hashPriceSignals(['$1', '$2', 'free']),
    checkProviders.hashPriceSignals(['free', '$2', '$1']));
  assert.strictEqual(checkProviders.hashPriceSignals([]), null);
});

test('check-providers: v1 flat-hash state migrates to v2 without price knowledge', () => {
  const pages = checkProviders.loadPages({ 'https://x.example': 'abcdef1234567890' });
  assert.deepStrictEqual(pages, {
    'https://x.example': { full: 'abcdef1234567890', price: null, tokens: 0, drift: 0 }
  });
  const v2 = checkProviders.loadPages({ version: 2, pages: { 'https://y.example': { full: 'f', price: 'p', tokens: 3, drift: 1 } } });
  assert.strictEqual(v2['https://y.example'].drift, 1);
});

test('check-providers: drift limit requires repeated full-only changes', () => {
  assert.strictEqual(checkProviders.DRIFT_LIMIT, 2);
});

// ---- userscript build (single source of truth: manifest.json) ----

const { buildUserscript } = require('../scripts/build-userscript.js');

const rootDir = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
const userscript = buildUserscript(rootDir);

test('userscript: header first, version mirrors manifest', () => {
  assert.ok(userscript.startsWith('// ==UserScript==\n'), 'metadata header must come first');
  assert.ok(userscript.includes('// @version      ' + manifest.version + '\n'));
  assert.ok(userscript.includes('// @grant        GM_xmlhttpRequest\n'), 'remote preset transport');
  for (const c of ['raw.githubusercontent.com', 'fastly.jsdelivr.net', 'testingcf.jsdelivr.net']) {
    assert.ok(userscript.includes('// @connect      ' + c + '\n'), c);
  }
  assert.ok(userscript.includes('// ==/UserScript==\n'));
});

test('userscript: @match mirrors manifest matches', () => {
  for (const m of manifest.content_scripts[0].matches) {
    assert.ok(userscript.includes('// @match        ' + m + '\n'), m);
  }
});

test('userscript: embeds every manifest script in manifest order', () => {
  let cursor = userscript.indexOf('// ==/UserScript==');
  for (const rel of manifest.content_scripts[0].js) {
    const code = fs.readFileSync(path.join(rootDir, rel), 'utf8').trim();
    const idx = userscript.indexOf(code, cursor);
    assert.ok(idx >= 0, rel + ' embedded after previous module');
    cursor = idx + code.length;
  }
});

test('userscript: runs in a bare page-like sandbox (no chrome.storage)', () => {
  const store = {};
  const quiet = { debug() { }, log() { }, warn() { }, error() { } };
  const ctx = {
    console: quiet,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    },
    setTimeout, clearTimeout,
    addEventListener() { }, removeEventListener() { },
    document: { body: null, addEventListener() { }, head: null },
    CustomEvent: function CustomEvent(type) { this.type = type; },
    MutationObserver: function MutationObserver() { this.observe = () => { }; this.disconnect = () => { }; }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(userscript, ctx);
  assert.ok(ctx.RepriceAA && ctx.RepriceAA.storage, 'RepriceAA namespace mounted');
  assert.ok(ctx.RepriceAA.pricing && ctx.RepriceAA.registry, 'lib modules present');
  return ctx.RepriceAA.storage.set('repriceaa.prefs', { a: 1 }).then(() =>
    ctx.RepriceAA.storage.get(['repriceaa.prefs']).then(res => {
      assert.strictEqual(JSON.stringify(res['repriceaa.prefs']), '{"a":1}');
    }));
});

console.log(passed + ' tests passed');
