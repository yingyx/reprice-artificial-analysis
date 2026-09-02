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

console.log(passed + ' tests passed');
