'use strict';

// Generates src/data/sources.js from data/sources.json (which doubles as the
// runtime remote-update payload fetched by src/lib/remotesources.js).
// data/sources.json is the single source of truth for built-in presets; the
// generated module is committed because both the MV3 extension and the
// userscript build (manifest.json js list) need a plain JS file to
// concatenate. Zero dependencies.

const fs = require('fs');
const path = require('path');

const SOURCES_PATH = path.join('data', 'sources.json');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RULE_TYPES = ['multiplier', 'absolute', 'formula', 'exclude'];
const SAFE_FORMULA_RE = /^[0-9A-Za-z_+\-*/%().,\s]+$/;
const MAX_FORMULA_LEN = 240;

// Mirrors the runtime rule contract (src/lib/pricing.js normalizeRule and
// src/lib/remotesources.js isRule): malformed values must fail the build
// instead of being silently clamped or reinterpreted at runtime.
function isFormulaSafe(expr) {
  return typeof expr === 'string' && !!expr.trim() && expr.length <= MAX_FORMULA_LEN
    && SAFE_FORMULA_RE.test(expr);
}

function isRule(r) {
  if (!r || typeof r !== 'object' || RULE_TYPES.indexOf(r.type) === -1) return false;
  if (r.type === 'exclude') return true;
  if (r.type === 'formula') return isFormulaSafe(r.expr);
  return typeof r.value === 'number' && isFinite(r.value) && r.value >= 0;
}

function isDate(v) {
  return v == null || DATE_RE.test(v);
}

// First match wins, so a later pattern that is matched by everything an
// earlier broader pattern already catches can never apply. The concrete
// failure mode is "mimo-v2.5-pro" placed after "mimo": the specific entry
// becomes dead code and its value never reaches the runtime. Comparison is
// punctuation-insensitive (matchKey), consistent with the runtime matcher,
// so "gpt-5.6 luna" and "gpt 5.6 luna" count as duplicates too.
function checkShadowing(entries, where) {
  const key = m => String(m).toLowerCase().replace(/[\s\-_.]+/g, '');
  const seen = [];
  for (const entry of entries) {
    const m = key(entry.match);
    if (seen.some(s => s.raw === m)) {
      throw new Error(where + ': duplicate match pattern: "' + entry.match + '"');
    }
    for (const prev of seen) {
      if (m.indexOf(prev.raw) !== -1) {
        throw new Error(where + ': pattern "' + entry.match + '" is shadowed by the earlier, broader pattern "'
          + prev.display + '" - order entries most-specific first');
      }
    }
    seen.push({ raw: m, display: String(entry.match) });
  }
}

function validateProfile(profile, where) {
  if (!profile || typeof profile !== 'object') throw new Error(where + ': not an object');
  if (typeof profile.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(profile.id)) {
    throw new Error(where + ': missing/invalid id');
  }
  if (typeof profile.name !== 'string' || !profile.name) throw new Error(where + ': missing name');
  if (typeof profile.asOf !== 'string' || !DATE_RE.test(profile.asOf)) {
    throw new Error(where + ': missing/invalid asOf (monotonic preset guard)');
  }
  if (!isRule(profile.defaultRule)) throw new Error(where + ': invalid defaultRule');
  if (profile.rules && (typeof profile.rules !== 'object'
    || Object.values(profile.rules).some(r => !isRule(r)))) {
    throw new Error(where + ': invalid rules entry');
  }
  if (profile.nameIncludes && (!Array.isArray(profile.nameIncludes)
    || profile.nameIncludes.some(e => typeof e.match !== 'string' || !isRule(e.rule)))) {
    throw new Error(where + ': invalid nameIncludes entry');
  }
  if (Array.isArray(profile.nameIncludes)) {
    checkShadowing(profile.nameIncludes, where + ' nameIncludes');
  }
  if (profile.promos && (!Array.isArray(profile.promos)
    || profile.promos.some(p => !p || typeof p.match !== 'string' || !isRule(p.rule)
      || !isDate(p.startsAt) || !isDate(p.endsAt)
      || (p.reason != null && typeof p.reason !== 'string')))) {
    throw new Error(where + ': invalid promos entry');
  }
  if (Array.isArray(profile.promos)) {
    checkShadowing(profile.promos, where + ' promos');
  }
}

// Broad patterns (short or without any digit/version token) are the classic
// source of "non-plan model repriced at the plan ratio" errors. They are
// legal when the plan genuinely includes the whole family (claude, codex
// plans), so this is a warning for reviewers, never a build failure.
function lintPatternWarnings(profiles) {
  const warnings = [];
  for (const profile of profiles) {
    for (const entry of profile.nameIncludes || []) {
      const m = String(entry.match);
      if (m.length < 5 || !/\d/.test(m)) {
        warnings.push(profile.id + ': broad pattern "' + m
          + '" - keep only if every AA model it matches is in the plan');
      }
    }
  }
  return warnings;
}

function loadSourceProfiles(repoRoot) {
  const doc = JSON.parse(fs.readFileSync(path.join(repoRoot, SOURCES_PATH), 'utf8'));
  if (!doc || doc.schema !== 1 || !Array.isArray(doc.sources)) {
    throw new Error(SOURCES_PATH + ': expected { "schema": 1, "sources": [...] }');
  }
  const seen = new Set();
  return doc.sources.map(profile => {
    validateProfile(profile, SOURCES_PATH + ' entry');
    if (seen.has(profile.id)) throw new Error(SOURCES_PATH + ': duplicate source id: ' + profile.id);
    seen.add(profile.id);
    // Everything in data/sources.json is a built-in preset; the flag is
    // injected here so the JSON stays pure pricing data.
    profile.builtin = true;
    return profile;
  });
}

function buildSourcesModule(repoRoot) {
  const profiles = loadSourceProfiles(repoRoot);
  const warnings = lintPatternWarnings(profiles);
  warnings.forEach(w => console.warn('warn - ' + w));
  const body = profiles
    .map(p => '    ' + JSON.stringify(p, null, 2).replace(/\n/g, '\n    '))
    .join(',\n');

  return [
    '// GENERATED by scripts/build-sources.js from data/sources.json - do not edit by hand.',
    '// Regenerate with: node scripts/build-sources.js',
    "(function (root) {",
    "  'use strict';",
    "  root.RepriceAA = root.RepriceAA || {};",
    '  root.RepriceAA.SOURCES = [',
    body,
    '  ];',
    '})(typeof window !== \'undefined\' ? window : globalThis);',
    ''
  ].join('\n');
}

module.exports = { buildSourcesModule, loadSourceProfiles, lintPatternWarnings };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const outPath = path.join(root, 'src', 'data', 'sources.js');
  const code = buildSourcesModule(root);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, code);
  console.log('wrote ' + path.relative(root, outPath) + ' (' + code.length + ' bytes)');
}
