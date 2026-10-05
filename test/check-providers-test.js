// A new tier must be researched even when its sibling's pages are unchanged.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const helpers = require('../scripts/check-providers.js');
const html = '<p>Plan $10 per month; allowance $60</p>';
const text = helpers.normalizeHtml(html);
const tokens = helpers.extractPriceSignals(text);
const url = 'https://example.com/plans';
const outputs = [];
let requests = 0;
const fixtures = {
  'providers.json': { providers: ['existing', 'new-tier'].map(sourceId => ({ sourceId, label: sourceId, pages: [{ url }] })) },
  'sources.json': { sources: [{ id: 'existing' }] },
  'page-hashes.json': { version: 2, pages: { [url]: { full: helpers.hash16(text), price: helpers.hashPriceSignals(tokens), tokens: tokens.length, drift: 0 } } }
};
const fakeFs = {
  existsSync: () => true,
  readFileSync: filename => {
    const fixture = fixtures[path.basename(filename)];
    assert.ok(fixture, 'unexpected file read: ' + filename);
    return JSON.stringify(fixture);
  }
};
const context = vm.createContext({
  require: name => name === 'fs' ? fakeFs : require(name), module: { exports: {} },
  __dirname: path.resolve(__dirname, '../scripts'),
  process: { argv: ['node', 'check-providers.js', '--dry-run'], env: { AGENT_MODEL: 'test/test' } },
  console: { log: line => outputs.push(line), warn: line => outputs.push(line) },
  fetch: async () => { requests++; return { ok: true, text: async () => html }; }, AbortSignal, URL
});
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../scripts/check-providers.js'), 'utf8') + '\nmain()', context)
  .then(() => {
    assert.ok(outputs.includes('changed: new-tier'), outputs.join('\n'));
    assert.ok(outputs.some(line => line.includes('new-source:new-tier')));
    assert.strictEqual(requests, 1, 'shared tier evidence is fetched once per run');
    console.log('provider bootstrap test passed: unchanged shared pages still trigger missing tier');
  }).catch(error => { console.error(error); process.exitCode = 1; });
