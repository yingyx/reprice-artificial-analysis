(function (root) {
  'use strict';

  function slugFromDetailsUrl(url) {
    if (!url) return null;
    return String(url).replace(/^\/models\//, '').replace(/\/$/, '');
  }

  function parseLdJsonDatasets(doc) {
    var out = [];
    var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      try {
        var parsed = JSON.parse(scripts[i].textContent);
        if (Array.isArray(parsed)) {
          for (var j = 0; j < parsed.length; j++) if (parsed[j]) out.push(parsed[j]);
        } else if (parsed) {
          out.push(parsed);
        }
      } catch (e) { }
    }
    return out.filter(function (d) {
      return d && Array.isArray(d.data);
    });
  }

  function num(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function pickBestDataset(datasets, key) {
    var best = null;
    for (var i = 0; i < datasets.length; i++) {
      var rows = datasets[i].data.filter(function (r) {
        return r && num(r[key]);
      });
      if (!best || rows.length > best.rows.length) {
        best = { rows: rows, name: datasets[i].name || '' };
      }
    }
    return best;
  }

  function extractFromLdJson(doc) {
    var datasets = parseLdJsonDatasets(doc);
    if (!datasets.length) return [];

    var iq = pickBestDataset(datasets, 'intelligenceIndex');
    var cost = pickBestDataset(datasets, 'costPerIntelligenceIndexTask');

    var byId = {};
    if (iq) {
      iq.rows.forEach(function (r) {
        var id = slugFromDetailsUrl(r.detailsUrl);
        if (!id) return;
        byId[id] = { id: id, label: r.label || id, intelligence: r.intelligenceIndex, aaCost: null };
      });
    }
    if (cost) {
      cost.rows.forEach(function (r) {
        var id = slugFromDetailsUrl(r.detailsUrl);
        if (!id) return;
        if (byId[id]) {
          byId[id].aaCost = r.costPerIntelligenceIndexTask;
          if (r.label && !byId[id].label) byId[id].label = r.label;
        } else {
          byId[id] = {
            id: id,
            label: r.label || id,
            intelligence: null,
            aaCost: r.costPerIntelligenceIndexTask
          };
        }
      });
    }

    return Object.keys(byId)
      .map(function (k) { return byId[k]; })
      .sort(function (a, b) {
        return (b.intelligence != null ? b.intelligence : -1) - (a.intelligence != null ? a.intelligence : -1);
      });
  }

  var SLUG_RE = /^[a-z0-9][a-z0-9._\-]{0,79}$/i;
  var NUM_RE = '-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';

  function flightChunksFromString(raw) {
    var parts = [];
    var re = /\[1,\s*("(?:[^"\\]|\\.)*")\s*\]/g;
    var m;
    while ((m = re.exec(raw))) {
      try {
        var s = JSON.parse(m[1]);
        if (typeof s === 'string' && s.length > 50) parts.push(s);
      } catch (e) { }
    }
    return parts.join('');
  }

  function flightText(doc) {
    var scripts;
    try {
      scripts = doc.querySelectorAll('script:not([src])');
    } catch (e) {
      return '';
    }
    var parts = [];
    for (var i = 0; i < scripts.length; i++) {
      var t = scripts[i].textContent || '';
      if (t.indexOf('__next_f') === -1) continue;
      parts.push(t);
    }
    return flightChunksFromString(parts.join('\n'));
  }

  function modelBoundary(text, from) {
    var cands = [
      text.indexOf('},{"id":"', from),
      text.indexOf('},{"slug":"', from),
      text.indexOf('},{"release":{', from)
    ].filter(function (c) { return c > 0; });
    if (!cands.length) return Math.min(text.length, from + 20000);
    return Math.min.apply(null, cands.concat([Math.min(text.length, from + 20000)]));
  }

  function scanFlightModelsTopSlug(text) {
    if (text.length < 200) return [];

    var byId = {};
    var re = new RegExp(
      '"slug":"([a-z0-9._\\-]+)","name":"((?:[^"\\\\]|\\\\.)*)"' +
      '(?:(?!\\},\\{)(?!"intelligenceIndex":).){0,6000}?"intelligenceIndex":(' + NUM_RE + ')', 'g');
    var m;
    while ((m = re.exec(text))) {
      var id = m[1];
      if (!SLUG_RE.test(id)) continue;
      var label = m[2].replace(/\\u([\dA-Fa-f]{4})/g, function (all, hex) {
        return String.fromCharCode(parseInt(hex, 16));
      }).replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim() || id;
      var segEnd = modelBoundary(text, re.lastIndex);
      var seg = text.slice(re.lastIndex, segEnd);
      var costM = new RegExp('"intelligenceIndexCostPerTask":\\{"cost":\\{"total":(' + NUM_RE + ')').exec(seg);
      var cost = costM ? parseFloat(costM[1]) : null;
      var provM = new RegExp('"creator":\\{[^}]*?"name":"([^"\\\\]+)"').exec(seg);
      byId[id] = { id: id, label: label, intelligence: parseFloat(m[3]), aaCost: cost, provider: provM ? provM[1] : null };
    }
    return Object.keys(byId).map(function (k) { return byId[k]; });
  }

  function scanFlightModelsReleaseSlug(text) {
    if (text.length < 200) return [];

    var byId = {};
    var re = new RegExp(
      '"release":\\{"slug":"([a-z0-9._\\-]+)","name":"((?:[^"\\\\]|\\\\.)*)"' +
      '(?:(?!"release":\\{").){0,3000}?"intelligenceIndex":(' + NUM_RE + ')', 'g');
    var m;
    while ((m = re.exec(text))) {
      var id = m[1];
      if (!SLUG_RE.test(id)) continue;
      var label = m[2].replace(/\\u([\dA-Fa-f]{4})/g, function (all, hex) {
        return String.fromCharCode(parseInt(hex, 16));
      }).replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim() || id;
      var segEnd = text.indexOf('"release":{"slug":"', re.lastIndex);
      if (segEnd === -1 || segEnd - re.lastIndex > 20000) segEnd = Math.min(text.length, re.lastIndex + 20000);
      var seg = text.slice(re.lastIndex, segEnd);
      var costM = new RegExp('"intelligenceIndexCostPerTask":\\{"cost":\\{"total":(' + NUM_RE + ')').exec(seg);
      var cost = costM ? parseFloat(costM[1]) : null;
      var provM = new RegExp('"creator":\\{[^}]*?"name":"([^"\\\\]+)"').exec(seg);
      byId[id] = { id: id, label: label, intelligence: parseFloat(m[3]), aaCost: cost, provider: provM ? provM[1] : null };
    }
    return Object.keys(byId).map(function (k) { return byId[k]; });
  }

  function extractFlightModelsFromText(chunkText) {
    return mergeModelLists(
      scanFlightModelsTopSlug(chunkText),
      scanFlightModelsReleaseSlug(chunkText)
    );
  }

  function extractFlightModels(doc) {
    return extractFlightModelsFromText(flightText(doc));
  }

  function scanEscapedFlightModels(rawHtml) {
    var unescaped = String(rawHtml || '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    return extractFlightModelsFromText(unescaped);
  }

  function extractFlightModelsFromHtml(rawHtml) {
    var raw = String(rawHtml || '');
    var fromChunks = [];
    try {
      fromChunks = extractFlightModelsFromText(flightChunksFromString(raw));
    } catch (e) { }
    var fromRaw = [];
    try {
      fromRaw = scanEscapedFlightModels(raw);
    } catch (e) { }
    return mergeModelLists(fromChunks, fromRaw);
  }

  function mergeModelLists(primary, secondary) {
    var byId = {};
    (secondary || []).forEach(function (m) {
      byId[m.id] = { id: m.id, label: m.label || m.id, intelligence: m.intelligence, aaCost: m.aaCost, provider: m.provider || null };
    });
    (primary || []).forEach(function (m) {
      var prev = byId[m.id];
      byId[m.id] = {
        id: m.id,
        label: m.label || (prev && prev.label) || m.id,
        intelligence: num(m.intelligence) ? m.intelligence : (prev ? prev.intelligence : null),
        aaCost: num(m.aaCost) ? m.aaCost : (prev ? prev.aaCost : null),
        provider: m.provider || (prev ? prev.provider : null)
      };
    });
    return Object.keys(byId)
      .map(function (k) { return byId[k]; })
      .sort(function (a, b) {
        return (b.intelligence != null ? b.intelligence : -1) - (a.intelligence != null ? a.intelligence : -1);
      });
  }

  function extractModelsDetailed(doc) {
    doc = doc || document;
    var flight = [];
    try {
      flight = extractFlightModels(doc);
    } catch (e) {
      flight = [];
    }
    var ldjson = [];
    try {
      ldjson = extractFromLdJson(doc);
    } catch (e) {
      ldjson = [];
    }
    var models, source;
    if (flight.length >= ldjson.length && flight.length > 0) {
      models = mergeModelLists(flight, ldjson);
      source = ldjson.length ? 'flight+ldjson' : 'flight';
    } else {
      models = mergeModelLists(ldjson, flight);
      source = ldjson.length ? 'ldjson' : (flight.length ? 'flight' : 'none');
    }
    var withCost = models.filter(function (m) { return num(m.aaCost); }).length;
    return {
      models: models,
      source: source,
      coverage: { total: models.length, withCost: withCost }
    };
  }

  function extractModels(doc) {
    return extractModelsDetailed(doc).models;
  }

  root.RepriceAA = root.RepriceAA || {};
  root.RepriceAA.extract = {
    parseLdJsonDatasets: parseLdJsonDatasets,
    pickBestDataset: pickBestDataset,
    extractFromLdJson: extractFromLdJson,
    extractFlightModels: extractFlightModels,
    extractFlightModelsFromHtml: extractFlightModelsFromHtml,
    extractModelsDetailed: extractModelsDetailed,
    extractModels: extractModels
  };
})(typeof window !== 'undefined' ? window : globalThis);
