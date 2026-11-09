const fs = require('node:fs');
const path = require('node:path');
require('../src/content/extract.js');
const { readFlightRecords } = globalThis.RepriceAA.extract;
const pixelTolerance = 2;

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

function readEvidence(before, file) {
  return file && fs.existsSync(path.join(before, file)) ? fs.readFileSync(path.join(before, file), 'utf8') : '';
}

function attribute(tag, name) {
  return tag.match(new RegExp(' ' + name + '="([^"]+)"'))?.[1];
}

function fitAxis(ticks, logarithmic) {
  if (ticks.length < 2) return null;
  const transform = logarithmic ? Math.log : value => value;
  const [first, last] = [ticks[0], ticks.at(-1)];
  const slope = (last.pixel - first.pixel) / (transform(last.value) - transform(first.value));
  if (!Number.isFinite(slope) || !slope) return null;
  const pixelAt = value => first.pixel + (transform(value) - transform(first.value)) * slope;
  // The native labels can be rounded. Skip axes that cannot be recovered from their ticks.
  return ticks.every(tick => Math.abs(pixelAt(tick.value) - tick.pixel) <= pixelTolerance) ? pixelAt : null;
}

function nativeGeometry(html, axes) {
  if (!axes.some(axis => /cost per .*task.*\bUSD\b/i.test(axis))) return null;
  const x = [], y = [];
  const points = new Map();
  for (const [, tag, body] of html.matchAll(/(<text\b[^>]*class="[^"]*recharts-cartesian-axis-tick-value[^"]*"[^>]*>)([\s\S]*?)<\/text>/g)) {
    const label = body.replace(/<[^>]*>/g, '').trim();
    if (!/^\$?-?\d[\d,]*(?:\.\d+)?%?$/.test(label)) continue;
    const value = Number(label.replace(/[$,%]/g, ''));
    if (label.startsWith('$')) x.push({ label, value, pixel: Number(attribute(tag, 'x')) });
    else if (attribute(tag, 'orientation') === 'left') y.push({ label, value, pixel: Number(attribute(tag, 'y')) });
  }
  for (const [tag] of html.matchAll(/<circle\b[^>]* data-chart-item-id="[^"]+"[^>]*>/g)) {
    const point = { x: Number(attribute(tag, 'cx')), y: Number(attribute(tag, 'cy')) };
    if (Number.isFinite(point.x) && Number.isFinite(point.y)) points.set(attribute(tag, 'data-chart-item-id'), point);
  }
  const costPixel = fitAxis(x, axes.some(axis => /log scale/i.test(axis)));
  const scorePixel = fitAxis(y, false);
  if (!costPixel || !scorePixel || points.size < 3) return null;
  return { points, costPixel, scorePixel, percent: y.every(tick => tick.label.endsWith('%')),
    ticks: { cost: x.map(tick => tick.label), score: y.map(tick => tick.label) } };
}

function matchesPoint(geometry, id, cost, score) {
  const point = geometry.points.get(id);
  return point && Math.abs(geometry.costPixel(cost) - point.x) <= pixelTolerance &&
    Math.abs(geometry.scorePixel(score) - point.y) <= pixelTolerance;
}

function matchRows(records, geometry) {
  const { points, costPixel, scorePixel, percent, ticks } = geometry;
  const visited = new WeakSet();
  let best;
  function visit(value, keyPath, parent) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      const matches = new Map();
      for (const row of value) {
        const point = points.get(row?.id);
        if (!point) continue;
        for (const [costField, cost] of Object.entries(row)) {
          if (!/cost|price/i.test(costField) || !Number.isFinite(cost) ||
              !(Math.abs(costPixel(cost) - point.x) <= pixelTolerance)) continue;
          for (const [scoreField, score] of Object.entries(row)) {
            if (scoreField === costField || !Number.isFinite(score)) continue;
            for (const scale of percent ? [1, 100] : [1]) {
              if (!(Math.abs(scorePixel(score * scale) - point.y) <= pixelTolerance)) continue;
              const key = JSON.stringify([costField, scoreField, scale]);
              if (!matches.has(key)) matches.set(key, new Map());
              matches.get(key).set(row.id, row);
            }
          }
        }
      }
      const ranked = [...matches].sort((a, b) => b[1].size - a[1].size);
      const [mapping, rows] = ranked[0] || [];
      if (rows && rows.size >= Math.max(3, points.size / 2) && rows.size > (ranked[1]?.[1].size || 0) &&
          rows.size > (best?.matchedPoints || 0)) {
        const [costField, scoreField, scoreScale] = JSON.parse(mapping);
        if (new Set([...rows.values()].map(row => row[scoreField])).size >= 3) {
          best = { recordPath: keyPath, containerFields: parent && !Array.isArray(parent) ? Object.keys(parent) : null,
            costField, scoreField, scoreScale, scoreUnit: percent ? '%' : null,
            matchedPoints: rows.size, nativePoints: points.size, ticks,
            rowShape: Object.fromEntries(Object.entries(rows.values().next().value).map(([key, value]) =>
              [key, value && typeof value === 'object' ? Object.keys(value).slice(0, 12) : typeof value])),
            examples: [...rows.values()].slice(0, 3).map(row => ({
              id: row.id, name: row.shortName || row.name, score: row[scoreField], costUsd: row[costField]
            })) };
        }
      }
    }
    for (const [key, child] of Object.entries(value)) visit(child, keyPath.concat(key), value);
  }
  records.forEach((record, index) => visit(record, [String(index)]));
  return best;
}

function writeTriage(before, output, targetFile) {
  const { retry, groups } = readBaseline(before);
  const evidenceByPage = new Map();
  function evidenceFor(sample) {
    const page = retry.pages.find(page => sample.evidence.startsWith(page.evidence + '/'));
    const html = `retry/${sample.evidence}/chart.html`;
    const payload = page && `retry/${page.evidence}/aa-payload.txt`;
    const geometry = nativeGeometry(readEvidence(before, html), sample.axes || []);
    let records = [];
    if (payload && geometry) {
      if (!evidenceByPage.has(payload)) {
        // Artifact wrapping inserts literal newlines; serialized Flight line breaks are escaped.
        const raw = readEvidence(before, payload).replace(/[\r\n]/g, '');
        evidenceByPage.set(payload, readFlightRecords(raw));
      }
      records = evidenceByPage.get(payload);
    }
    const mapping = geometry && matchRows(records, geometry);
    let evidenceStatus = 'matched';
    if (!geometry) evidenceStatus = 'native coordinates unavailable';
    else if (!records.length) evidenceStatus = 'inline Flight records unavailable';
    else if (!mapping) evidenceStatus = 'no unambiguous inline row mapping';
    return { chart: sample.chart, stage: sample.stage, anchor: sample.anchor, axes: sample.axes,
      badge: sample.badge, nativeId: sample.sampleNativeId,
      html, payload, evidenceStatus, mapping, publicData: page?.publicData, extraction: page?.extraction };
  }
  const triage = groups.map((charts, index) => {
    const evidence = charts.map(evidenceFor);
    return {
      target: index + 1,
      occurrences: charts.length,
      evidence
    };
  });
  const ready = triage.filter(group => group.evidence.every(chart => chart.anchor && chart.mapping));
  const selected = ready.sort((a, b) => b.occurrences - a.occurrences ||
    b.evidence[0].mapping.matchedPoints - a.evidence[0].mapping.matchedPoints)[0] || null;
  fs.writeFileSync(output, triage.map(group => JSON.stringify(group)).join('\n') + '\n');
  fs.writeFileSync(targetFile, JSON.stringify(selected, null, 2) + '\n');
  return selected;
}

function nativeIdentity(chart) {
  return chart.anchor && JSON.stringify([chart.chart.split(' | ', 1)[0], chart.kind, chart.anchor, chart.title, chart.axes]);
}

function uniqueNativeCharts(charts) {
  const byNative = new Map();
  for (const chart of charts) {
    const key = nativeIdentity(chart);
    if (key) byNative.set(key, byNative.has(key) ? null : chart);
  }
  return byNative;
}

function verify(before, afterDir, targetFile) {
  const { retry, groups } = readBaseline(before);
  const after = readJson(afterDir, 'report.json');
  const target = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
  const selected = groups[target?.target - 1];
  if (!selected || selected.length !== target.evidence?.length ||
      selected.some((chart, index) => chart.chart !== target.evidence[index].chart)) {
    throw new Error('The selected repair target does not match a confirmed failure group.');
  }
  if (!['pass', 'regression'].includes(after.status) || after.discovery.error ||
      after.pages.some(page => page.issues.length) ||
      after.charts.some(chart => !['pass', 'regression'].includes(chart.status))) {
    throw new Error('The after-scan could not inspect all discovered pages and charts.');
  }

  const afterById = new Map(after.charts.map(chart => [chart.chart, chart]));
  const beforeById = new Map(retry.charts.map(chart => [chart.chart, chart]));
  const beforeByNative = uniqueNativeCharts(retry.charts);
  const afterByNative = uniqueNativeCharts(after.charts);
  const paired = new Map();
  for (const chart of retry.charts) {
    let observed = afterById.get(chart.chart);
    if (!observed) {
      // AA can move the same scatter out of a tab, changing only its display identity.
      const key = nativeIdentity(chart);
      const sameNative = afterByNative.get(key);
      if (beforeByNative.get(key) === chart && sameNative && !beforeById.has(sameNative.chart)) observed = sameNative;
    }
    if (observed) paired.set(chart.chart, observed);
  }
  for (const chart of selected) {
    const observed = paired.get(chart.chart);
    if (observed?.status !== 'pass' || !observed.verifiedCoordinates) {
      throw new Error('A selected chart did not pass the after-scan: ' + chart.chart);
    }
  }
  const previousRegressions = new Set();
  for (const chart of retry.charts) {
    const observed = paired.get(chart.chart);
    if (['pass', 'regression'].includes(chart.status) && !observed) {
      throw new Error('A previously inspected chart disappeared: ' + chart.chart);
    }
    if (chart.status === 'pass' && observed.status !== 'pass') {
      throw new Error('A previously passing chart failed: ' + chart.chart);
    }
    if (chart.status === 'regression') {
      previousRegressions.add(observed.chart);
      if (chart.stage === 'repricing' && observed.stage === 'mount') {
        throw new Error('An existing repricing failure now fails to mount: ' + chart.chart);
      }
    }
  }
  const remaining = after.charts.filter(chart => chart.status === 'regression');
  for (const chart of remaining) {
    if (!previousRegressions.has(chart.chart)) {
      throw new Error('The after-scan found a new regression: ' + chart.chart);
    }
  }
  return { fixed: selected.length, remaining: remaining.length };
}

if (require.main === module) {
  const [, , mode, before, output, targetFile] = process.argv;
  try {
    if (mode === 'triage') {
      const selected = writeTriage(before, output, targetFile);
      console.log(selected ? 'true' : 'false');
    } else if (mode === 'verify') {
      const { fixed, remaining } = verify(before, output, targetFile);
      console.log(`Verified the selected repair on ${fixed} chart(s). Existing unresolved regressions: ${remaining}.`);
    } else throw new Error('Expected the triage or verify command.');
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = { writeTriage, verify, nativeGeometry, matchesPoint };
