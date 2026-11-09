const fs = require('node:fs');
const path = require('node:path');
const { stripVTControlCharacters } = require('node:util');

function readJson(dir, file) {
  return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
}

function readBaseline(dir) {
  const confirmed = new Set(readJson(dir, 'confirmed.json'));
  const retry = readJson(dir, 'retry/report.json');
  const byFailure = new Map();
  for (const chart of retry.charts) {
    if (!confirmed.has(chart.chart) || chart.status !== 'regression') continue;
    const key = JSON.stringify([chart.stage, chart.anchor || chart.chart]);
    if (!byFailure.has(key)) byFailure.set(key, []);
    byFailure.get(key).push(chart);
  }
  const groups = [...byFailure.values()].sort((a, b) => b.length - a.length);
  return { retry, groups };
}

function writeTriage(before, output) {
  const { retry, groups } = readBaseline(before);
  const lines = groups.map(([sample, ...others], index) => {
    const page = retry.pages.find(page => sample.evidence.startsWith(page.evidence + '/'));
    return JSON.stringify({
      target: index + 1,
      stage: sample.stage,
      anchor: sample.anchor,
      occurrences: 1 + others.length,
      chart: sample.chart,
      axes: sample.axes,
      badge: sample.badge,
      nativeId: sample.sampleNativeId,
      html: `retry/${sample.evidence}/chart.html`,
      payload: page && `retry/${page.evidence}/aa-payload.txt`,
      publicData: page?.publicData,
      extraction: page?.extraction
    });
  });
  fs.writeFileSync(output, lines.join('\n') + '\n');
}

function verify(before, afterDir, log) {
  const { retry, groups } = readBaseline(before);
  const after = readJson(afterDir, 'report.json');
  const agentLog = stripVTControlCharacters(fs.readFileSync(log, 'utf8'));
  const markers = [...new Set(agentLog.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^AA_UI_TARGET=[1-9]\d*$/.test(line)))];
  const target = markers.length === 1 && Number(markers[0].split('=')[1]);
  const selected = groups[target - 1];
  if (!selected) throw new Error('OpenCode did not identify one confirmed repair target.');
  if (!['pass', 'regression'].includes(after.status) || after.discovery.error ||
      after.pages.some(page => page.issues.length) ||
      after.charts.some(chart => !['pass', 'regression'].includes(chart.status))) {
    throw new Error('The after-scan could not inspect all discovered pages and charts.');
  }

  const afterById = new Map(after.charts.map(chart => [chart.chart, chart]));
  const beforeById = new Map(retry.charts.map(chart => [chart.chart, chart]));
  for (const chart of selected) {
    if (afterById.get(chart.chart)?.status !== 'pass') {
      throw new Error('A selected chart did not pass the after-scan: ' + chart.chart);
    }
  }
  for (const chart of retry.charts) {
    const observed = afterById.get(chart.chart);
    if (['pass', 'regression'].includes(chart.status) && !observed) {
      throw new Error('A previously inspected chart disappeared: ' + chart.chart);
    }
    if (chart.status === 'pass' && observed.status !== 'pass') {
      throw new Error('A previously passing chart failed: ' + chart.chart);
    }
    if (chart.status === 'regression' && chart.stage === 'repricing' && observed.stage === 'mount') {
      throw new Error('An existing repricing failure now fails to mount: ' + chart.chart);
    }
  }
  const remaining = after.charts.filter(chart => chart.status === 'regression');
  for (const chart of remaining) {
    if (beforeById.get(chart.chart)?.status !== 'regression') {
      throw new Error('The after-scan found a new regression: ' + chart.chart);
    }
  }
  return { fixed: selected.length, remaining: remaining.length };
}

if (require.main === module) {
  const [, , mode, before, output, log] = process.argv;
  try {
    if (mode === 'triage') writeTriage(before, output);
    else if (mode === 'verify') {
      const { fixed, remaining } = verify(before, output, log);
      console.log(`Verified the selected repair on ${fixed} chart(s). Existing unresolved regressions: ${remaining}.`);
    } else throw new Error('Expected the triage or verify command.');
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = { writeTriage, verify };
