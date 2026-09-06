(function (root) {
  'use strict';

  var RAA = root.RepriceAA;
  var storageApi = RAA.storage;

  var KEY = 'repriceaa.modelRegistry';
  var MAX_ENTRIES = 600;
  var STALE_MS = 14 * 24 * 60 * 60 * 1000;
  var SAVE_DEBOUNCE_MS = 1500;

  function num(v) {
    return typeof v === 'number' && isFinite(v);
  }

  var cache = null;
  var loadPromise = null;
  var saveTimer = null;

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = storageApi.get([KEY]).then(function (res) {
      var stored = res[KEY];
      cache = {};
      if (stored && typeof stored === 'object') {
        Object.keys(stored).forEach(function (id) {
          var e = stored[id];
          if (e && typeof e.id === 'string' && typeof e.lastSeen === 'number') {
            cache[id] = e;
          }
        });
      }
    }, function () {
      cache = {};
    });
    return loadPromise;
  }

  function prune() {
    var ids = Object.keys(cache);
    if (ids.length <= MAX_ENTRIES) return;
    ids.sort(function (a, b) { return cache[a].lastSeen - cache[b].lastSeen; });
    var excess = ids.length - MAX_ENTRIES;
    for (var i = 0; i < excess; i++) delete cache[ids[i]];
  }

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      prune();
      var items = {};
      items[KEY] = cache;
      storageApi.set(items);
    }, SAVE_DEBOUNCE_MS);
  }

  function merge(pageModels, pageVersion) {
    if (!cache) cache = {};
    var now = Date.now();
    var pageIds = {};
    (pageModels || []).forEach(function (m) {
      if (!m || typeof m.id !== 'string') return;
      pageIds[m.id] = true;
      var prev = cache[m.id];
      cache[m.id] = {
        id: m.id,
        label: m.label || (prev && prev.label) || m.id,
        intelligence: num(m.intelligence) ? m.intelligence : (prev ? prev.intelligence : null),
        aaCost: num(m.aaCost) ? m.aaCost : (prev ? prev.aaCost : null),
        provider: m.provider || (prev ? prev.provider : null),
        ver: pageVersion != null ? pageVersion : ((prev && prev.ver) || null),
        lastSeen: now
      };
    });

    var out = [];
    Object.keys(cache).forEach(function (id) {
      var e = cache[id];
      if (pageIds[id]) {
        out.push(Object.assign({}, e));
      } else if (now - e.lastSeen < STALE_MS) {
        // Cached entries only carry values from the page that captured them.
        // When the current page declares an Intelligence Index version, an
        // entry captured under a different (or unknown) version is stale —
        // e.g. AA bumping v4.1.1 -> v4.2 re-scores every model.
        if (pageVersion != null && (!e.ver || e.ver !== pageVersion)) return;
        out.push(Object.assign({}, e, { _cached: true }));
      }
    });
    out.sort(function (a, b) {
      return (b.intelligence != null ? b.intelligence : -1) - (a.intelligence != null ? a.intelligence : -1);
    });
    scheduleSave();
    return out;
  }

  function upsertModels(models, version) {
    if (!cache) cache = {};
    var now = Date.now();
    (models || []).forEach(function (m) {
      if (!m || typeof m.id !== 'string') return;
      var prev = cache[m.id];
      cache[m.id] = {
        id: m.id,
        label: m.label || (prev && prev.label) || m.id,
        intelligence: num(m.intelligence) ? m.intelligence : (prev ? prev.intelligence : null),
        aaCost: num(m.aaCost) ? m.aaCost : (prev ? prev.aaCost : null),
        provider: m.provider || (prev ? prev.provider : null),
        ver: version != null ? version : ((prev && prev.ver) || null),
        lastSeen: now
      };
    });
    scheduleSave();
  }

  function all() {
    return Object.keys(cache || {}).map(function (id) { return cache[id]; });
  }

  root.RepriceAA.registry = {
    load: load,
    merge: merge,
    upsertModels: upsertModels,
    all: all,
    _cache: function () { return cache; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
