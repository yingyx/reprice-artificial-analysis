'use strict';

// Fetches provider pages listed in data/providers.json and reports which
// source presets have changed since the last run. The changed list gates the
// scheduled opencode agent run so LLM calls only happen when provider pricing
// actually changed. Zero dependencies (Node >= 18 global fetch).
//
// Two hashes per page, both computed over the same normalized rendered text:
//   full  - sha256 of all rendered text. Changes on any content touch,
//           including noise (footer timestamps, release counters).
//   price - sha256 of the sorted multiset of price-signal tokens
//           (currency amounts, percentages, quota multipliers like "4x",
//           "free"). Every pricing change manifests in these tokens; the
//           noise never produces them. This is a global rule - no per-page
//           configuration.
// The agent fires when the price hash changed, or when the full hash changed
// on >= DRIFT_LIMIT consecutive runs with an unchanged price hash (escape
// hatch for structural changes that carry no price token). A page seen for
// the first time only records hashes and does not fire the agent.
//
// Usage:
//   node scripts/check-providers.js            # compare + persist state
//   node scripts/check-providers.js --dry-run  # compare only, do not persist
//   node scripts/check-providers.js --force    # mark every provider changed

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const argv = new Set(process.argv.slice(2));
const dryRun = argv.has('--dry-run');
const force = argv.has('--force');

const repoRoot = path.join(__dirname, '..');
const providersPath = path.join(repoRoot, 'data', 'providers.json');
const statePath = path.join(repoRoot, 'data', '.state', 'page-hashes.json');

// Full-hash-only drift (no price signal) must persist this many consecutive
// runs before the agent fires, so daily page jitter does not trigger it.
const DRIFT_LIMIT = 2;

const USER_AGENT =
  'Mozilla/5.0 (compatible; RepriceAA-source-updater/0.1; +' +
  'https://github.com/yingyx/reprice-artificial-analysis)';

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

// State v2 shape: { version: 2, pages: { url: { full, price, tokens, drift } } }.
// v1 was a flat map of url -> full-hash; migrate silently (price unknown ->
// first-sight rules apply, no agent fire).
function loadPages(state) {
  if (state && state.version === 2 && state.pages && typeof state.pages === 'object') {
    return state.pages;
  }
  const pages = {};
  if (state && typeof state === 'object') {
    for (const [url, v] of Object.entries(state)) {
      if (typeof v === 'string') pages[url] = { full: v, price: null, tokens: 0, drift: 0 };
    }
  }
  return pages;
}

function fetchText(url) {
  return fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' })
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
}

function hash16(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// Pages embed volatile <script> payload (Astro flight data: latest release
// info, build ids). Hash only the rendered text: prices, limits and promo
// banners live there, and it is stable across builds.
function normalizeHtml(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ');
}

// Price-signal tokens: currency amounts ($1,145, ¥199, €9), percentages
// ("50% off", "20%/5h"), quota multipliers ("7x", "4×") and free offers.
// Pricing tables on subscription pages are always denominated in these;
// volatile chrome (dates, release counts, star counters) is not.
function extractPriceSignals(text) {
  const matches = text.match(/[$¥€£][\d.,]+|\d+(?:\.\d+)?%|\b\d+(?:\.\d+)?[x×](?![\w×])|\bfree\b/gi);
  return matches ? matches.map(t => t.toLowerCase()) : [];
}

function hashPriceSignals(tokens) {
  if (!tokens.length) return null;
  return hash16(tokens.slice().sort().join(' '));
}

async function main() {
  const config = JSON.parse(fs.readFileSync(providersPath, 'utf8'));
  const providers = config.providers || [];
  const prevState = loadState();
  const prev = loadPages(prevState);
  const nextPages = {};
  const changed = [];
  const failures = [];
  const warnings = [];
  const lines = [];

  // Force-listed source ids (dispatch input): the agent task fires for
  // them regardless of page changes - for providers that publish no
  // hash-detectable pages. Unknown ids pass through so a manually
  // dispatched research task can be briefed on any source.
  const forceSources = (process.env.FORCE_SOURCES || '').split(/\s+/).filter(Boolean);

  for (const p of providers) {
    const marks = [];
    const tokenCounts = [];
    for (const page of p.pages || []) {
      const before = prev[page.url];
      try {
        const text = normalizeHtml(await fetchText(page.url));
        const full = hash16(text);
        const tokens = extractPriceSignals(text);
        tokenCounts.push(tokens.length);
        const price = hashPriceSignals(tokens);
        nextPages[page.url] = { full: full, price: price, tokens: tokens.length, drift: 0 };

        if (!before || !before.full) {
          // Newly monitored page: record hashes, let the agent review it once.
          marks.push('new:' + page.url);
        } else if (before.price != null && price != null && before.price !== price) {
          // Price signal moved - always the agent.
          marks.push('price-change:' + page.url);
        } else if (before.price != null && price == null) {
          // Page stopped exposing price text (restructure or CSR conversion):
          // do not loop the agent on it; surface a warning instead.
          warnings.push(page.url + ' no longer exposes any price-signal tokens'
            + ' (client-rendered page? hash detection is unreliable for it)');
        } else if (price != null && before.price == null) {
          // First successful price extraction (migration or recovery):
          // adopt silently unless the full hash also moved.
          if (before.full !== full) marks.push('changed:' + page.url);
        } else if (before.full !== full) {
          // Full text moved without any price signal: drift counter.
          const drift = (before.drift || 0) + 1;
          nextPages[page.url].drift = drift;
          if (drift >= DRIFT_LIMIT) {
            marks.push('structural-drift(' + drift + '):' + page.url);
          }
        }
      } catch (e) {
        // Keep the previous state on fetch failure so a transient network
        // blip retries next run; persist an error marker only after the
        // first failure so permanently dead pages go quiet instead of
        // firing the agent forever.
        nextPages[page.url] = before || { full: 'error', price: null, tokens: 0, drift: 0 };
        if (!before || before.full !== 'error') marks.push('fetch-failed:' + page.url);
        failures.push(page.url + ' fetch failed: ' + e.message);
      }
    }
    // A source needs the agent when any page changed (or fetch broke) - a
    // stable "error" hash avoids re-firing on permanently dead pages.
    const isChanged = force || marks.length > 0;
    lines.push({
      sourceId: p.sourceId,
      label: p.label,
      status: isChanged ? 'changed' : 'unchanged',
      detail: (marks.length ? marks.join(', ') : 'unchanged')
        + ' (' + tokenCounts.join('+') + ' price tokens)'
    });
    if (isChanged) changed.push(p.sourceId);
  }

  for (const id of forceSources) {
    if (!changed.includes(id)) changed.push(id);
    if (!providers.some(p => p.sourceId === id)) {
      lines.push({
        sourceId: id,
        label: '(forced)',
        status: 'changed',
        detail: 'no provider pages - agent researches its own sources'
      });
    }
  }

  // Agent runtime config comes from repo variables (Settings > Secrets and
  // variables > Actions), mapped to env by the workflow: AGENT_MODEL
  // ('provider/model'), optional AGENT_PROVIDER_ID and AGENT_BASE_URL. The
  // API key is the generic AGENT_API_KEY secret, wired into opencode via
  // OPENCODE_CONFIG_CONTENT ({env:...} interpolation). Validated only when
  // the agent is about to run, and always before state is persisted so a
  // misconfigured run retries instead of silently skipping the change.
  const agentModel = process.env.AGENT_MODEL || '';
  const providerId = process.env.AGENT_PROVIDER_ID || (agentModel ? String(agentModel).split('/')[0] : '');
  const options = { apiKey: '{env:AGENT_API_KEY}' };
  if (process.env.AGENT_BASE_URL) options.baseURL = process.env.AGENT_BASE_URL;
  const opencodeConfig = JSON.stringify({
    provider: {
      [providerId]: { options: options }
    }
  });

  if (changed.length > 0 && (!agentModel || agentModel.indexOf('/') === -1)) {
    throw new Error('AGENT_MODEL repo variable is missing or not in "provider/model" form'
      + ' (Settings > Secrets and variables > Actions > Variables)');
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ version: 2, pages: nextPages }, null, 2) + '\n');
  }

  console.log('page change detection' + (dryRun ? ' (dry run)' : '') + ':');
  for (const l of lines) {
    console.log((l.status === 'changed' ? 'x ' : '- ') + l.sourceId + ' (' + l.label
      + ') ' + l.detail);
  }
  warnings.forEach(w => console.log('  ~ ' + w));
  failures.forEach(f => console.log('  ! ' + f));
  console.log('agent model: ' + (agentModel || '(AGENT_MODEL variable not set)'));
  console.log('changed: ' + (changed.join(' ') || '(none)'));

  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = [
      '## Provider page change detection' + (dryRun ? ' (dry run)' : ''),
      '',
      '| Status | Source | Label | Detail |',
      '|--------|--------|-------|--------|'
    ];
    for (const l of lines) {
      summary.push('| ' + l.status + ' | `' + l.sourceId + '` | ' + l.label
        + ' | ' + String(l.detail).replace(/</g, '&lt;') + ' |');
    }
    if (warnings.length) {
      summary.push('', '**Warnings**');
      warnings.forEach(w => summary.push('- ' + w.replace(/</g, '&lt;')));
    }
    if (failures.length) {
      summary.push('', '**Fetch failures**');
      failures.forEach(f => summary.push('- `' + f + '`'));
    }
    summary.push('', 'Agent model: `' + (agentModel || '(AGENT_MODEL variable not set)') + '`');
    summary.push('', 'Changed sources: ' + (changed.length ? changed.map(c => '`' + c + '`').join(' ') : '(none)'));
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'changed=' + changed.join(' ') + '\n');
    if (agentModel) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'model=' + agentModel + '\n');
    if (changed.length > 0) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, 'opencode_config=' + opencodeConfig + '\n');
    }
  }
  if (changed.length === 0) {
    console.log('nothing to do; agent skipped');
  }
}

module.exports = {
  normalizeHtml,
  extractPriceSignals,
  hashPriceSignals,
  hash16,
  loadPages,
  DRIFT_LIMIT
};

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
