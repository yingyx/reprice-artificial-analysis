'use strict';

// Fetches provider pages listed in data/providers.json and reports which
// source presets have changed since the last run (sha256 of page HTML).
// The changed list gates the scheduled opencode agent run so LLM calls only
// happen when a provider page actually changed. Zero dependencies (Node >= 18
// global fetch).
//
// Usage:
//   node scripts/check-providers.js            # compare + persist hashes
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

const USER_AGENT =
  'Mozilla/5.0 (compatible; RepriceAA-source-updater/0.1; +' +
  'https://github.com/yingyx/reprice-artificial-analysis)';

function loadPreviousHashes() {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (e) {
    return {};
  }
}

function fetchText(url) {
  return fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' })
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
}

function hashHtml(html) {
  return crypto
    .createHash('sha256')
    .update(normalizeHtml(html))
    .digest('hex')
    .slice(0, 16);
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

async function main() {
  const config = JSON.parse(fs.readFileSync(providersPath, 'utf8'));
  const providers = config.providers || [];  const prev = loadPreviousHashes();
  const next = {};
  const changed = [];
  const lines = [];

  for (const p of providers) {
    const marks = [];
    for (const page of p.pages || []) {
      try {
        const hash = hashHtml(await fetchText(page.url));
        next[page.url] = hash;
        const before = prev[page.url];
        if (before == null || before === 'error') {
          marks.push('new:' + page.url);
        } else if (before !== hash) {
          marks.push('changed:' + page.url);
        }
      } catch (e) {
        // Keep the previous hash on fetch failure so a transient network
        // blip retries next run; persist 'error' only after the first
        // failure so permanently dead pages go quiet instead of firing
        // the agent forever.
        const before = prev[page.url];
        next[page.url] = before != null ? before : 'error';
        if (before !== 'error') marks.push('fetch-failed:' + page.url);
        lines.push('  ! ' + page.url + ' fetch failed: ' + e.message);
      }
    }
    // A source needs the agent when any page changed (or fetch broke) - a
    // stable "error" hash avoids re-firing on permanently dead pages.
    const isChanged = force || marks.length > 0;
    lines.push((isChanged ? 'x ' : '- ') + p.sourceId + ' (' + p.label + ')'
      + (marks.length ? ' ' + marks.join(', ') : ' unchanged'));
    if (isChanged) changed.push(p.sourceId);
  }

  // Agent runtime config comes from repo variables (Settings > Secrets and
  // variables > Actions), mapped to env by the workflow: AGENT_MODEL
  // ('provider/model'), optional AGENT_PROVIDER_ID and AGENT_BASE_URL. The
  // API key is the generic AGENT_API_KEY secret, wired into opencode via
  // OPENCODE_CONFIG_CONTENT ({env:...} interpolation). Validated only when
  // the agent is about to run, and always before hashes are persisted so a
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
    fs.writeFileSync(statePath, JSON.stringify(next, null, 2) + '\n');
  }

  console.log('page change detection' + (dryRun ? ' (dry run)' : '') + ':');
  lines.forEach(l => console.log(l));
  console.log('agent model: ' + (agentModel || '(AGENT_MODEL variable not set)'));
  console.log('changed: ' + (changed.join(' ') || '(none)'));

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

main().catch(e => {
  console.error(e);
  process.exit(1);
});
