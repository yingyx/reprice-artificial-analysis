'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual: equal } = require('node:util');
const { loadPages } = require('./check-providers.js');

const SOURCES = 'data/sources.json';
const HASHES = 'data/.state/page-hashes.json';
const MAX_ALLOWANCE_CHANGE = 0.2;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const show = (ref, file) => JSON.parse(execFileSync('git', ['show', ref + ':' + file], { encoding: 'utf8' }));
const byId = doc => new Map(doc.sources.map(source => [source.id, source]));
const words = value => new Set((value || '').split(/\s+/).filter(Boolean));
const positive = value => Number.isFinite(value) && value > 0;

function allowance(source, rule) {
  if (source?.kind !== 'subscription' || rule?.type !== 'multiplier') return null;
  if (!positive(source.monthlyFee) || !positive(rule.value)) return null;
  const amount = source.monthlyFee / rule.value;
  return positive(amount) ? amount : null;
}

// Mask only multiplier values. Everything that controls coverage, priority,
// fees, promotions, or overrides must stay identical for an automatic merge.
function quotaShape(source) {
  const { notes, asOf, manualRatio, defaultRule, nameIncludes, ...rest } = source;
  const mask = rule => rule.type === 'multiplier' ? { ...rule, value: null } : rule;
  return {
    ...rest,
    defaultRule: mask(defaultRule),
    nameIncludes: nameIncludes?.map(entry => ({ ...entry, rule: mask(entry.rule) }))
  };
}

function reviewReason(before, after, provider, unavailable, today) {
  if (!before) return 'New pricing source';
  if (!provider || unavailable.has(after.id)) return 'Pricing evidence unavailable to the detector';
  if (before.kind !== 'subscription' || !equal(quotaShape(before), quotaShape(after))) {
    return 'Plan fee, model coverage, promotion or rule structure changed';
  }
  if (after.asOf !== today || after.asOf <= before.asOf
      || typeof after.notes !== 'string' || !after.notes.trim() || after.notes === before.notes) {
    return 'Updated review date and evidence notes required';
  }
  if (after.defaultRule.type !== 'multiplier' || after.defaultRule.value !== after.manualRatio) {
    return 'Default multiplier and summary multiplier must agree';
  }

  const pairs = [
    [{ type: 'multiplier', value: before.manualRatio }, after.defaultRule],
    [before.defaultRule, after.defaultRule]
  ];
  (before.nameIncludes || []).forEach((entry, index) => pairs.push([entry.rule, after.nameIncludes[index].rule]));
  let changed = false;
  for (const [oldRule, newRule] of pairs) {
    if (equal(oldRule, newRule)) continue;
    changed = true;
    const oldAmount = allowance(before, oldRule);
    const newAmount = allowance(after, newRule);
    if (oldAmount === null || newAmount === null) return 'Allowance could not be derived from a positive multiplier';
    if (Math.abs(newAmount / oldAmount - 1) > MAX_ALLOWANCE_CHANGE + 1e-9) {
      return 'An implied monthly allowance changed by more than 20%';
    }
  }
  return changed ? null : 'Evidence notes changed without a quota change';
}

function cell(value) {
  return String(value).replace(/[&<>`|*_\[\]\\]/g, char => '&#' + char.charCodeAt(0) + ';')
    .replace(/\r?\n/g, ' ');
}

const dollars = value => value == null ? '—' : '$' + value.toFixed(2);
const transition = (from, to) => from === to ? from : from + ' → ' + to;

function ruleLabel(entry) {
  if (!entry) return '—';
  const { rule, startsAt, endsAt } = entry;
  let label = rule.type;
  if (rule.type === 'multiplier') label = rule.value + '×';
  if (rule.type === 'absolute') label = '$' + rule.value + ' absolute';
  if (rule.type === 'formula') label = rule.expr;
  if (startsAt || endsAt) label += ' (' + (startsAt || 'open') + ' to ' + (endsAt || 'open') + ')';
  return label;
}

function ruleRows(before, after, kind, oldEntries, newEntries) {
  const oldRules = new Map(oldEntries.map(entry => [entry.match, entry]));
  const newRules = new Map(newEntries.map(entry => [entry.match, entry]));
  const rows = [];
  for (const match of new Set([...oldRules.keys(), ...newRules.keys()])) {
    const oldEntry = oldRules.get(match);
    const newEntry = newRules.get(match);
    const from = allowance(before, oldEntry?.rule);
    const to = allowance(after, newEntry?.rule);
    if (equal(oldEntry, newEntry) && from === to) continue;
    const delta = from !== null && to !== null && from !== to
      ? (to > from ? '+' : '') + ((to / from - 1) * 100).toFixed(1) + '%'
      : '—';
    const status = !oldEntry ? ' · added' : !newEntry ? ' · removed' : '';
    rows.push([match, kind + status, dollars(from), dollars(to), delta, transition(ruleLabel(oldEntry), ruleLabel(newEntry))]
      .map(cell).join(' | '));
  }
  return rows;
}

function report(title, changes, base, providers, reasons) {
  const lines = [
    title, '',
    'For subscriptions, monthly allowances are implied API-equivalent USD amounts (monthly fee ÷ multiplier).',
    'Model labels below are the stored match patterns or exact model IDs. An em dash means no amount is available.', ''
  ];
  for (const [id, after] of changes) {
    const before = base.get(id);
    lines.push('### ' + cell(after.name) + ' (`' + id + '`)', '');
    if (reasons.has(id)) lines.push('- Review: ' + reasons.get(id));
    lines.push('- Monthly fee: ' + transition(dollars(before?.monthlyFee), dollars(after.monthlyFee)));
    lines.push('- Summary multiplier: ' + transition(String(before?.manualRatio ?? '—'), String(after.manualRatio ?? '—')));
    lines.push('- Evidence date: ' + transition(before?.asOf || '—', after.asOf));
    if (!equal(before?.defaultRule, after.defaultRule)) {
      const oldDefault = before && { rule: before.defaultRule };
      lines.push('- Default rule: ' + cell(transition(ruleLabel(oldDefault), ruleLabel({ rule: after.defaultRule }))));
    }
    if (before && before.name !== after.name) lines.push('- Previous plan name: ' + cell(before.name));
    for (const { url } of providers.get(id)?.pages || []) lines.push('- Evidence: <' + url + '>');
    if (before?.notes !== after.notes) lines.push('- Evidence notes updated in `data/sources.json`.');
    for (const [field, label] of [['nameIncludes', 'Model match'], ['promos', 'Promotion']]) {
      const previous = (before?.[field] || []).map(entry => entry.match);
      const current = (after[field] || []).map(entry => entry.match);
      if (!equal(previous.filter(match => current.includes(match)), current.filter(match => previous.includes(match)))) {
        lines.push('- ' + label + ' priority changed.');
      }
    }
    const exact = source => Object.entries(source?.rules || {}).map(([match, rule]) => ({ match, rule }));
    const rows = [
      ...ruleRows(before, after, 'Model match', before?.nameIncludes || [], after.nameIncludes || []),
      ...ruleRows(before, after, 'Promotion', before?.promos || [], after.promos || []),
      ...ruleRows(before, after, 'Exact override', exact(before), exact(after))
    ];
    if (rows.length) {
      lines.push('', '| Model | Rule | Before (USD/mo) | After (USD/mo) | Change | Pricing rule |',
        '| --- | --- | ---: | ---: | ---: | --- |',
        ...rows.map(row => '| ' + row + ' |'));
    }
    lines.push('');
  }
  return lines.join('\n');
}

function main(outputDir) {
  const baseDoc = show('HEAD', SOURCES);
  const candidate = read(SOURCES);
  const base = byId(baseDoc);
  const ids = candidate.sources.map(s => s.id);
  if (!equal({ ...candidate, sources: [] }, { ...baseDoc, sources: [] })
      || !equal(ids.slice(0, base.size), [...base.keys()])) {
    throw new Error('The agent changed source order, removed a source, or edited document metadata');
  }

  const providers = new Map(read('data/providers.json').providers.map(p => [p.sourceId, p]));
  const requested = words(process.env.CHANGED_SOURCES);
  const unavailable = words(process.env.UNAVAILABLE_SOURCES);
  const today = new Date().toISOString().slice(0, 10);
  const pending = new Map();
  const reviewHead = process.env.REVIEW_HEAD;
  if (reviewHead) {
    const fork = execFileSync('git', ['merge-base', 'HEAD', reviewHead], { encoding: 'utf8' }).trim();
    const original = byId(show(fork, SOURCES));
    for (const [id, source] of byId(show(reviewHead, SOURCES))) {
      if (!equal(source, original.get(id)) && equal(base.get(id), original.get(id))) pending.set(id, source);
    }
  }

  const auto = new Map();
  const review = new Map(pending);
  const reasons = new Map([...pending.keys()].map(id => [id, 'Previously submitted for review']));
  for (const after of candidate.sources) {
    const before = base.get(after.id);
    if (equal(before, after)) continue;
    if (!requested.has(after.id) || /^glm-coding-|^kimi-allegretto$/.test(after.id)) {
      throw new Error('The agent changed a source outside its task: ' + after.id);
    }
    if (equal(before, { ...after, asOf: before?.asOf })) continue;
    const previousProposal = pending.get(after.id);
    if (previousProposal && equal(previousProposal, { ...after, asOf: previousProposal.asOf })) continue;
    const reason = process.env.GITHUB_EVENT_NAME !== 'schedule' ? 'Manually requested update'
      : reviewReason(before, after, providers.get(after.id), unavailable, today);
    if (reason || pending.has(after.id)) {
      review.set(after.id, after);
      if (reason) reasons.set(after.id, reason);
    } else {
      auto.set(after.id, after);
    }
  }

  const state = read(HASHES);
  const oldState = show('HEAD', HASHES);
  const oldPages = loadPages(oldState);
  const proposed = byId(candidate);
  const unverified = [...requested].filter(id => proposed.get(id)?.asOf !== today);
  // A shared page must be checked again until every affected plan has landed.
  for (const id of new Set([...review.keys(), ...unavailable, ...unverified])) {
    for (const { url } of providers.get(id)?.pages || []) {
      if (Object.hasOwn(oldPages, url)) state.pages[url] = oldPages[url];
      else delete state.pages[url];
    }
  }
  const write = (file, content) => fs.writeFileSync(path.join(outputDir, file), content);
  const json = (file, doc) => write(file, JSON.stringify(doc, null, 2) + '\n');
  const sources = changes => ({ ...baseDoc, sources: [...new Map([...base, ...changes]).values()] });
  fs.mkdirSync(outputDir, { recursive: true });
  if (!equal(state, oldState)) json('hashes.json', state);
  if (auto.size) {
    json('auto.json', sources(auto));
    write('auto.md', report('Validated quota adjustments eligible for automatic merge.', auto, base, providers, reasons));
  }
  if (!equal(review, pending)) {
    json('review.json', sources(review));
    json('combined.json', sources(new Map([...auto, ...review])));
    write('review.md', report('These pricing changes require human review.', review, base, providers, reasons));
  }
  for (const lane of ['auto', 'review']) {
    const body = path.join(outputDir, lane + '.md');
    if (!fs.existsSync(body)) continue;
    const markdown = fs.readFileSync(body, 'utf8');
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n' + markdown);
    if (process.env.GITHUB_RUN_ID) {
      fs.appendFileSync(body, '\n[Workflow run](' + process.env.GITHUB_SERVER_URL
        + '/' + process.env.GITHUB_REPOSITORY + '/actions/runs/' + process.env.GITHUB_RUN_ID + ')\n');
    }
  }
}

main(process.argv[2]);
