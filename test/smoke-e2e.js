const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlFile = path.join(process.env.TEMP, 'opencode', 'aa-home.html');
if (!fs.existsSync(htmlFile)) {
  console.log('skip smoke-e2e: ' + htmlFile + ' not found (run the page capture first)');
  process.exit(0);
}
const html = fs.readFileSync(htmlFile, 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => ({ textContent: m[1] }));
const doc = { querySelectorAll: sel => (sel === 'script:not([src])' ? scripts : []) };

const ctx = { console, document: doc };
vm.createContext(ctx);
for (const f of ['src/lib/pricing.js', 'src/lib/pareto.js', 'src/lib/colors.js', 'src/content/extract.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
}
const R = ctx.RepriceAA;
const { num } = R.pricing;

const detailed = R.extract.extractModelsDetailed(doc);
console.log('detailed extraction: source =', detailed.source, '| coverage =', JSON.stringify(detailed.coverage));

const { models } = detailed;
console.log('models extracted:', models.length, '| with AA cost:', models.filter(m => num(m.aaCost)).length);
if (detailed.source === 'ldjson' || models.length < 20) {
  console.error('FAIL: expected flight payload extraction (>=20 models), got', models.length, detailed.source);
  process.exit(1);
}

const priced = R.pricing.applyProfile(
  models,
  { defaultRule: { type: 'multiplier', value: 1 }, nameIncludes: [{ match: 'glm', rule: { type: 'multiplier', value: 0.3 } }] }
).filter(m => num(m.repricedCost));

console.log('\nrepriced sample (glm at 0.30x):');
priced.filter(p => /glm/i.test(p.label)).forEach(p =>
  console.log(`  ${p.label}: AA ${p.aaCost.toFixed(3)} -> ${p.repricedCost.toFixed(3)} (${p.ruleDescription})`)
);

const frontierIdx = R.pareto.paretoFrontierIndices(
  priced.map(p => ({ intelligence: p.intelligence, cost: p.repricedCost }))
);
console.log('\nPareto frontier (repriced):');
frontierIdx.forEach(i => {
  const p = priced[i];
  console.log(`  ${p.label} @ $${p.repricedCost.toFixed(3)} (IQ ${p.intelligence.toFixed(1)})`);
});

function legendEl(style, text) {
  return { getAttribute: () => style, nextElementSibling: { textContent: ' ' + text } };
}
const fakeDoc = {
  querySelectorAll: () => [
    legendEl('background-color:#1f1f1f', 'OpenAI'),
    legendEl('background-color:#cc785c', 'Anthropic'),
    legendEl('background-color:#2243e6', 'DeepSeek')
  ]
};
R.colors.refresh(fakeDoc);
const cSol = R.colors.colorFor('GPT-5.6 Sol (max)', 'gpt-5-6-sol');
const cCl = R.colors.colorFor('Claude Opus 5 (max)', 'claude-opus-5');
const cX = R.colors.colorFor('Mystery Model Z', 'mystery-z');
console.log('\ncolors: gpt =>', cSol, '| claude =>', cCl, '| fallback(hash) =>', cX,
  '| stable:', cX === R.colors.colorFor('Mystery Model Z again', 'mystery-z'));
