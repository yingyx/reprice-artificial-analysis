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
  var INDEX_VER_RE = /Intelligence Index v(\d+\.\d+(?:\.\d+)?)/;

  function extractIndexVersionFromText(text) {
    var m = INDEX_VER_RE.exec(String(text || ''));
    return m ? m[1] : null;
  }

  function extractIndexVersion(doc) {
    try {
      var v = extractIndexVersionFromText(flightText(doc));
      if (v) return v;
    } catch (e) { }
    try {
      var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < scripts.length; i++) {
        var v2 = extractIndexVersionFromText(scripts[i].textContent);
        if (v2) return v2;
      }
    } catch (e) { }
    return null;
  }

  function flightChunksFromString(raw) {
    var parts = [];
    var re = /\[1,\s*("(?:[^"\\]|\\.)*")\s*\]/g;
    var m;
    while ((m = re.exec(raw))) {
      try {
        var s = JSON.parse(m[1]);
        // Flight chunk boundaries are arbitrary, including short closing tails.
        if (typeof s === 'string') parts.push(s);
      } catch (e) { }
    }
    return parts.join('');
  }

  var flightCache = new WeakMap();
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
    var cached = flightCache.get(doc);
    if (cached && parts.length === cached.parts.length && parts.every(function (p, i) { return p === cached.parts[i]; })) {
      return cached.text;
    }
    var text = flightChunksFromString(parts.join('\n'));
    flightCache.set(doc, { parts: parts, text: text });
    return text;
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

  var detailedCache = new WeakMap();
  function flightRecords(text) {
    var records = Object.create(null), order = [];
    String(text || '').split('\n').forEach(function (line) {
      var colon = line.indexOf(':');
      if (colon < 0) return;
      try {
        var id = line.slice(0, colon);
        records[id] = JSON.parse(line.slice(colon + 1));
        order.push(id);
      } catch (e) { }
    });
    function dereference(value, seen) {
      if (typeof value !== 'string' || !/^\$[\da-f]+(?::[^\s]+)*$/i.test(value)) return value;
      if (seen[value]) return value;
      seen[value] = true;
      var path = value.slice(1).split(':'), target = records[path.shift()];
      for (var i = 0; i < path.length && target != null; i++) {
        target = dereference(target, seen);
        target = Array.isArray(target) && path[i] === 'props' ? target[3] : target[path[i]];
      }
      return target === undefined ? value : dereference(target, seen);
    }
    var copies = new WeakMap();
    function expand(value) {
      value = dereference(value, Object.create(null));
      if (!value || typeof value !== 'object') return value;
      if (copies.has(value)) return copies.get(value);
      var copy = Array.isArray(value) ? [] : Object.create(null);
      copies.set(value, copy);
      Object.keys(value).forEach(function (key) { copy[key] = expand(value[key]); });
      return copy;
    }
    return order.map(function (id) { return expand(records[id]); });
  }

  // Parse complete Flight records instead of matching across nested model objects.
  // Release variants keep their own slug, UUID and cost; the release is only a group.
  function extractReleaseData(text) {
    var models = Object.create(null), releases = Object.create(null), charts = Object.create(null);
    var visited = new WeakSet();
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (visited.has(value)) return;
      visited.add(value);
      var codingRows = Array.isArray(value.benchmarkRows) ? value.benchmarkRows : value.rows;
      if (Array.isArray(codingRows) && codingRows.some(function (r) { return r && r.agentName && r.display && r.mean && num(r.indexScore); }) &&
          (!charts.coding || codingRows.length > charts.coding.length)) {
        // The dedicated agents page also carries a smaller highlights table.
        // Its benchmarkRows catalogue, not that table, backs the scatter plot.
        charts.coding = codingRows.filter(function (r) { return r && r.id && r.display && r.mean; }).map(function (r) {
          var creators = r.modelCreators || [];
          var label = r.display.model || '';
          if (creators.length === 1 && creators[0].slug === 'anthropic' && !/^Claude\b/i.test(label)) label = 'Claude ' + label;
          return { id: r.id, chartId: r.id, label: r.display.agent + ' - ' + r.display.model,
            pricingLabel: label, intelligence: num(r.indexScore) ? r.indexScore * 100 : null,
            aaCost: r.mean.costUsd, provider: creators.map(function (c) { return c.name; }).join(' + '),
            pricingUnsupported: creators.length !== 1 || /\+/.test(label),
            pricingNote: creators.length !== 1 || /\+/.test(label) ? 'Mixed-model cost split unavailable; AA price retained' : null };
        });
      }
      if (typeof value.evalSlug === 'string' && Array.isArray(value.models)) {
        var scale = value.evalSlug === 'artificial-analysis-cyber-index' ? 1 : 100;
        charts[value.evalSlug] = value.models.filter(function (m) { return m && m.slug && m.id && 'costPerTask' in m; }).map(function (m) {
          return { id: m.slug, chartId: m.id, label: m.shortName || m.name,
            intelligence: num(m.score) ? m.score * scale : null, aaCost: m.costPerTask, provider: m.creatorName };
        });
      }
      if (!Array.isArray(value) && SLUG_RE.test(value.slug || '') && value.name) {
        if (value.id && value.release && value.release.slug) {
          var cost = value.intelligenceIndexCostPerTask;
          var prev = models[value.slug];
          models[value.slug] = {
            id: value.slug, chartId: value.id, label: value.shortName || value.name,
            intelligence: 'intelligenceIndex' in value ? value.intelligenceIndex : (prev ? prev.intelligence : null),
            aaCost: 'intelligenceIndexCostPerTask' in value ? (cost && cost.cost ? cost.cost.total : null) : (prev ? prev.aaCost : null),
            provider: value.creator && value.creator.name,
            releaseId: value.release.slug, releaseLabel: value.release.name,
            effort: value.effort && value.effort.level
          };
          releases[value.release.slug] = { id: value.release.slug, label: value.release.name };
        } else if (!value.id && value.creator && value.releaseDate) {
          releases[value.slug] = { id: value.slug, label: value.name };
        }
      }
      Object.keys(value).forEach(function (key) { visit(value[key]); });
    }
    flightRecords(text).forEach(visit);
    return { models: Object.keys(models).map(function (id) { return models[id]; }),
      releases: Object.keys(releases).map(function (id) { return releases[id]; }), charts: charts };
  }

  function extractReleaseDataFromHtml(html) {
    return extractReleaseData(flightChunksFromString(String(html || '')));
  }

  function extractModelDetailsFromHtml(html, requestedIds) {
    // A detail page can contain the full model catalogue. Parse its complete
    // JSON records once, without the two legacy whole-page regex scans.
    var models = extractReleaseDataFromHtml(html).models;
    if (!models.length) models = extractFlightModelsFromHtml(html);
    var wanted = Object.create(null);
    requestedIds.forEach(function (id) { wanted[id] = true; });
    return models.filter(function (m) { return wanted[m.id]; });
  }

  function extractModelsDetailed(doc) {
    doc = doc || document;
    var serialized = flightText(doc);
    var ldTexts = Array.prototype.map.call(doc.querySelectorAll('script[type="application/ld+json"]'), function (s) { return s.textContent; });
    var cached = detailedCache.get(doc);
    if (cached && cached.serialized === serialized && ldTexts.length === cached.ldTexts.length &&
      ldTexts.every(function (t, i) { return t === cached.ldTexts[i]; })) return cached.result;
    var releaseData = extractReleaseData(serialized);
    var flight = [];
    try {
      // The structured catalogue is authoritative and much cheaper to parse.
      flight = releaseData.models.length ? releaseData.models : extractFlightModels(doc);
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
    models = mergeModelLists(releaseData.models, models);
    var withCost = models.filter(function (m) { return num(m.aaCost); }).length;
    var chartIds = Object.create(null);
    var pairs = /"id":"([^"\\]+)","slug":"([a-z0-9._-]+)"/g;
    var pair;
    while ((pair = pairs.exec(serialized))) chartIds[pair[1]] = pair[2];
    releaseData.models.forEach(function (m) { chartIds[m.chartId] = m.id; });
    var result = {
      models: models,
      releaseData: releaseData,
      charts: releaseData.charts,
      chartIds: chartIds,
      source: source,
      indexVersion: extractIndexVersion(doc),
      coverage: { total: models.length, withCost: withCost }
    };
    detailedCache.set(doc, { serialized: serialized, ldTexts: ldTexts, result: result });
    return result;
  }

  function extractModels(doc) {
    return extractModelsDetailed(doc).models;
  }

  function extractPageFromHtml(html) {
    var ld = [], match;
    var re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    while ((match = re.exec(html))) ld.push({ textContent: match[1] });
    return extractModelsDetailed({ querySelectorAll: function (selector) {
      return selector === 'script[type="application/ld+json"]' ? ld : [{ textContent: html }];
    } });
  }

  root.RepriceAA = root.RepriceAA || {};
  root.RepriceAA.extract = {
    extractPageFromHtml: extractPageFromHtml,
    extractReleaseDataFromHtml: extractReleaseDataFromHtml,
    parseLdJsonDatasets: parseLdJsonDatasets,
    pickBestDataset: pickBestDataset,
    extractFromLdJson: extractFromLdJson,
    extractFlightModels: extractFlightModels,
    extractFlightModelsFromHtml: extractFlightModelsFromHtml,
    extractModelDetailsFromHtml: extractModelDetailsFromHtml,
    extractIndexVersionFromText: extractIndexVersionFromText,
    extractIndexVersion: extractIndexVersion,
    extractModelsDetailed: extractModelsDetailed,
    extractModels: extractModels
  };
})(typeof window !== 'undefined' ? window : globalThis);
