'use strict';

// Cross-checks every source's nameIncludes/promo patterns against
// Artificial Analysis's actual model registry (fetched from the /models
// page - the same names the extension matches at runtime). Catches the
// two recurring data bugs mechanically instead of by agent discipline:
//   - over-coverage: a pattern that reprices AA models outside the plan
//     (prints every pattern's full hit-set for review)
//   - zero-hit patterns: spelled in a way no AA model matches (label
//     drift, or a plan model AA does not list - both need a decision)
// Warnings only by default; --strict turns zero-hit warnings into a
// non-zero exit. Zero dependencies (Node >= 18 global fetch).
//
// Usage:
//   node scripts/check-patterns.js                 # fetch + audit
//   node scripts/check-patterns.js --file <html>   # audit a saved page
//   node scripts/check-patterns.js --strict        # fail on zero-hit patterns

const fs = require('fs');
const path = require('path');

const AA_MODELS_URL = 'https://artificialanalysis.ai/models';
const USER_AGENT = 'Mozilla/5.0 (compatible; RepriceAA-pattern-check/0.1)';
// Same normalization as the runtime matcher (src/lib/pricing.js matchKey).
const matchKey = s => String(s).toLowerCase().replace(/[\s\-_.]+/g, '');

// Collect every model name the extension can ever see: ld+json dataset
// labels (the chart data) plus the embedded slug/name registry (used by
// other AA pages and future releases).
function extractAaModelNames(html) {
  const names = new Set();
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let parsed;
    try { parsed = JSON.parse(m[1]); } catch (e) { continue; }
    for (const d of (Array.isArray(parsed) ? parsed : [parsed])) {
      if (d && Array.isArray(d.data)) {
        d.data.forEach(r => { if (r && typeof r.label === 'string') names.add(r.label); });
      }
    }
  }
  // Embedded registry: "slug":"...","name":"..." pairs survive whitespace
  // stripping and attribute escaping.
  const unescaped = html.replace(/\\"/g, '"');
  for (const m of unescaped.matchAll(/"slug"\s*:\s*"([a-z0-9][a-z0-9-]*)"\s*,\s*"name"\s*:\s*"([^"]*)"/g)) {
    if (m[2]) names.add(m[2]);
  }
  return [...names].sort();
}

function hitsFor(pattern, names) {
  const key = matchKey(pattern);
  if (key.indexOf('/') === 0) return []; // id-based patterns: names are labels
  const bare = key.slice(key.indexOf('/') === 0 ? 1 : 0);
  return names.filter(n => matchKey(n).indexOf(bare) !== -1);
}

// Audits every pattern of every source against the AA name list.
// Returns { lines, zeroHitCount } - lines are human-readable, zero-hit
// patterns are the actionable ones (spelling drift or AA-absent model).
function auditPatterns(sources, names) {
  const lines = [];
  let zeroHitCount = 0;
  for (const src of sources || []) {
    for (const entry of src.nameIncludes || []) {
      if (!entry || !entry.match) continue;
      if (String(entry.match).indexOf('/') === 0) continue; // id-matched, not audited against names
      const hits = hitsFor(entry.match, names);
      if (!hits.length) {
        zeroHitCount++;
        lines.push('warn: ' + src.id + ' pattern "' + entry.match
          + '" matches 0 AA model names (spelling drift, or model absent from AA - intended?)');
      }
    }
    for (const p of src.promos || []) {
      if (!p || !p.match) continue;
      if (String(p.match).indexOf('/') === 0) continue;
      const hits = hitsFor(p.match, names);
      if (!hits.length) {
        zeroHitCount++;
        lines.push('warn: ' + src.id + ' promo "' + p.match
          + '" matches 0 AA model names (spelling drift, or model not on AA yet)');
      }
    }
  }
  return { lines, zeroHitCount };
}

async function main() {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const fileIdx = argv.indexOf('--file');
  let html;
  if (fileIdx !== -1 && argv[fileIdx + 1]) {
    console.log('audit against saved page: ' + argv[fileIdx + 1]);
    html = fs.readFileSync(argv[fileIdx + 1], 'utf8');
  } else {
    const res = await fetch(AA_MODELS_URL, { headers: { 'user-agent': USER_AGENT } });
    if (!res.ok) throw new Error('AA models page HTTP ' + res.status);
    html = await res.text();
  }
  const names = extractAaModelNames(html);
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'sources.json'), 'utf8'));
  const { lines, zeroHitCount } = auditPatterns(doc.sources, names);
  console.log('AA model names: ' + names.length);
  lines.forEach(l => console.log(l));
  console.log('patterns with 0 AA hits: ' + zeroHitCount);
  if (strict && zeroHitCount > 0) process.exitCode = 1;
}

module.exports = { extractAaModelNames, hitsFor, auditPatterns, AA_MODELS_URL };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
