(function (root) {
  'use strict';

  var RAA = root.RepriceAA || (root.RepriceAA = {});
  var storageApi = RAA.storage;

  // Remote preset updates: keeps data/sources fresh without an extension or
  // script release. Candidate mirrors are tried in order (GitHub raw is
  // authoritative; jsDelivr fastly/testingcf domains are the usual
  // mainland-China-reachable fallbacks). Successful URL is remembered so
  // subsequent refreshes skip dead mirrors. All failures degrade silently
  // to the bundled snapshot in RAA.SOURCES.
  var REMOTE_URLS = [
    'https://raw.githubusercontent.com/yingyx/reprice-artificial-analysis/main/data/sources.json',
    'https://fastly.jsdelivr.net/gh/yingyx/reprice-artificial-analysis@main/data/sources.json',
    'https://testingcf.jsdelivr.net/gh/yingyx/reprice-artificial-analysis@main/data/sources.json'
  ];

  var TTL_MS = 24 * 60 * 60 * 1000;   // self-check at most once a day (Greasyfork rule)
  var TIMEOUT_MS = 8000;
  var MAX_SOURCES = 100;

  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var RULE_TYPES = ['multiplier', 'absolute', 'formula', 'exclude'];
  var SAFE_FORMULA_RE = /^[0-9A-Za-z_+\-*/%().,\s]+$/;
  var MAX_FORMULA_LEN = 240;

  // Runtime rules never accept anything the pricing engine would silently
  // reinterpret, so validation mirrors src/lib/pricing.js normalizeRule:
  // values are finite and non-negative, formulas must parse, and percentOff
  // is not a runtime rule type (the UI converts it before storage).
  function isFormulaSafe(expr) {
    if (typeof expr !== 'string' || !expr.trim() || expr.length > MAX_FORMULA_LEN) return false;
    if (RAA.pricing && typeof RAA.pricing.isFormulaSafe === 'function') {
      return RAA.pricing.isFormulaSafe(expr);
    }
    return SAFE_FORMULA_RE.test(expr);
  }

  function isRule(r) {
    if (!r || typeof r !== 'object' || RULE_TYPES.indexOf(r.type) === -1) return false;
    if (r.type === 'exclude') return true;
    if (r.type === 'formula') return isFormulaSafe(r.expr);
    return typeof r.value === 'number' && isFinite(r.value) && r.value >= 0;
  }

  function isOptionalRuleMap(map) {
    if (map == null) return true;
    if (typeof map !== 'object' || Array.isArray(map)) return false;
    return Object.keys(map).every(function (k) { return isRule(map[k]); });
  }

  function isOptionalDate(v) {
    return v == null || (typeof v === 'string' && DATE_RE.test(v));
  }

  // Same guarantees as the CI schema tests: a remote payload that fails
  // validation is treated like a failed download, never applied.
  function validatePayload(payload) {
    if (!payload || typeof payload !== 'object') return 'not an object';
    if (payload.schema !== 1) return 'unsupported schema';
    if (!Array.isArray(payload.sources) || !payload.sources.length) return 'no sources';
    if (payload.sources.length > MAX_SOURCES) return 'too many sources';
    var seen = {};
    for (var i = 0; i < payload.sources.length; i++) {
      var p = payload.sources[i];
      if (!p || typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(p.id)) return 'bad id @' + i;
      if (seen[p.id]) return 'duplicate id: ' + p.id;
      seen[p.id] = true;
      if (typeof p.name !== 'string' || !p.name) return 'bad name @' + p.id;
      // asOf feeds the monotonic-version guard in state.applyRemoteSources;
      // a payload without it could silently replace newer presets.
      if (typeof p.asOf !== 'string' || !DATE_RE.test(p.asOf)) return 'bad asOf @' + p.id;
      if (!isRule(p.defaultRule)) return 'bad defaultRule @' + p.id;
      if (!isOptionalRuleMap(p.rules)) return 'bad rules @' + p.id;
      if (!Array.isArray(p.nameIncludes)) return 'missing nameIncludes @' + p.id;
      for (var j = 0; j < p.nameIncludes.length; j++) {
        var e = p.nameIncludes[j];
        if (!e || typeof e.match !== 'string' || !e.match || !isRule(e.rule)) {
          return 'bad nameIncludes @' + p.id;
        }
      }
      if (p.promos != null) {
        if (!Array.isArray(p.promos)) return 'bad promos @' + p.id;
        for (var k = 0; k < p.promos.length; k++) {
          var po = p.promos[k];
          if (!po || typeof po.match !== 'string' || !po.match || !isRule(po.rule)) {
            return 'bad promo rule @' + p.id;
          }
          if (!isOptionalDate(po.startsAt) || !isOptionalDate(po.endsAt)) {
            return 'bad promo date @' + p.id;
          }
          if (po.reason != null && typeof po.reason !== 'string') return 'bad promo reason @' + p.id;
        }
      }
      if (p.fallbackTo != null && typeof p.fallbackTo !== 'string') return 'bad fallbackTo @' + p.id;
      if (p.basedOn != null && typeof p.basedOn !== 'string') return 'bad basedOn @' + p.id;
      if (p.kind === 'subscription' && !(p.manualRatio > 0)) return 'bad manualRatio @' + p.id;
    }
    return null;
  }

  function fetchViaGM(url) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        timeout: TIMEOUT_MS,
        headers: { 'accept': 'application/json' },
        onload: function (res) {
          if (res.status >= 200 && res.status < 300) resolve(res.responseText);
          else reject(new Error('HTTP ' + res.status));
        },
        onerror: function () { reject(new Error('network error')); },
        ontimeout: function () { reject(new Error('timeout')); }
      });
    });
  }

  function fetchViaPage(url) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    return fetch(url, { redirect: 'follow', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .finally(function () { clearTimeout(timer); });
  }

  function fetchText(url) {
    var viaGM = typeof GM_xmlhttpRequest === 'function' ? fetchViaGM : null;
    return (viaGM ? viaGM(url) : fetchViaPage(url));
  }

// Cache-busting stamp appended to branch-based mirror URLs. jsDelivr
// treats different query strings as different resources: a UTC-day stamp
// forces each day's first fetch past any edge holding a days-old copy of
// @main while keeping within-day caching intact; a forced refresh (panel
// button) uses a one-time nonce so it always bypasses the edge cache.
function cacheBustFor(url, force) {
  if (url.indexOf('jsdelivr') === -1) return url;
  var stamp = force ? String(Date.now()) : new Date().toISOString().slice(0, 10);
  return url + '?t=' + stamp;
}

function tryUrls(urls, force) {
  return urls.reduce(function (chain, url) {
    return chain.catch(function () {
      var target = cacheBustFor(url, force);
      return fetchText(target).then(function (text) { return { url: target, text: text }; });
    });
  }, Promise.reject());
}

  function readCache() {
    return storageApi.get([storageApi.KEYS.remoteSources]).then(function (res) {
      var c = res[storageApi.KEYS.remoteSources];
      return c && typeof c === 'object' ? c : null;
    });
  }

  function writeCache(cache) {
    return storageApi.set(storageApi.KEYS.remoteSources, cache).catch(function () { });
  }

  function orderUrls(lastGoodUrl) {
    if (!lastGoodUrl) return REMOTE_URLS;
    return REMOTE_URLS.slice().sort(function (a, b) {
      return (a === lastGoodUrl ? -1 : 0) - (b === lastGoodUrl ? -1 : 0);
    });
  }

  var lastError = null;

  // Refreshes the remote payload if the cached copy is older than TTL.
  // Resolves with { applied, status } where status describes where the
  // preset data currently comes from; never rejects, never blocks for
  // longer than one URL timeout per candidate.
  function maybeRefresh(force) {
    return readCache().then(function (cached) {
      var fresh = cached && (Date.now() - (cached.fetchedAt || 0)) < TTL_MS;
      if (fresh && !force) {
        lastError = null;
        return { applied: false, status: status('cache', cached) };
      }
      return tryUrls(orderUrls(cached && cached.lastGoodUrl), force)
        .then(function (hit) {
          var payload;
          try { payload = JSON.parse(hit.text); } catch (e) { throw new Error('invalid JSON'); }
          var err = validatePayload(payload);
          if (err) throw new Error('schema: ' + err);
          var next = {
            schema: 1,
            generatedAt: payload.generatedAt,
            sources: payload.sources,
            fetchedAt: Date.now(),
            lastGoodUrl: hit.url
          };
          lastError = null;
          return writeCache(next).then(function () {
            return install(payload.sources).then(function (applied) {
              return { applied: applied, status: status('remote', next) };
            });
          });
        })
        .catch(function (e) {
          lastError = e && e.message ? e.message : String(e);
          return { applied: false, status: status(cached ? 'cache' : 'builtin', cached) };
        });
    });
  }

  // Swaps RAA.SOURCES for the remote set and re-seeds profile state. Deep
  // clones so nothing holds references into the fetched payload.
  function install(remoteSources) {
    if (!RAA.state || typeof RAA.state.applyRemoteSources !== 'function') {
      RAA.SOURCES = JSON.parse(JSON.stringify(remoteSources));
      return Promise.resolve(true);
    }
    return RAA.state.applyRemoteSources(JSON.parse(JSON.stringify(remoteSources)));
  }

  function status(where, cache) {
    return {
      where: where,                       // 'remote' | 'cache' | 'builtin'
      generatedAt: cache ? cache.generatedAt || null : null,
      fetchedAt: cache ? cache.fetchedAt || null : null,
      lastGoodUrl: cache ? cache.lastGoodUrl || null : null,
      lastError: lastError,
      ttlMs: TTL_MS
    };
  }

  function getStatus() {
    return readCache().then(function (cached) {
      var where = cached ? 'cache' : 'builtin';
      if (cached && RAA.SOURCES && RAA.SOURCES.length
        && cached.sources && cached.sources.length) {
        var bundled = JSON.stringify(RAA.SOURCES);
        if (bundled === JSON.stringify(cached.sources)) where = 'builtin';
        else where = 'remote';
      }
      return status(where, cached);
    });
  }

  RAA.remotesources = {
    REMOTE_URLS: REMOTE_URLS,
    TTL_MS: TTL_MS,
    cacheBustFor: cacheBustFor,
    validatePayload: validatePayload,
    maybeRefresh: maybeRefresh,
    getStatus: getStatus,
    install: install
  };
})(typeof window !== 'undefined' ? window : globalThis);
