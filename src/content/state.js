(function (root) {
  'use strict';

  var RAA = root.RepriceAA;
  var storageApi = RAA.storage;

  // Built-in presets live in data/sources/*.json, compiled into RAA.SOURCES
  // by scripts/build-sources.js (see src/data/sources.js). Deep-cloned so
  // editor mutations never leak back into the shared preset definitions.
  // 'aa-default' (AA Cost) was removed: the built-in '__aa__' identity
  // option already covers plain AA list pricing.
  function builtinProfiles() {
    var sources = RAA.SOURCES || [];
    return JSON.parse(JSON.stringify(sources));
  }

  var cache = {
    profiles: [],
    activeProfileId: null,
    sourceMode: 'aa',
    enabledSourceIds: [],
    logScale: true,
    panelOpen: false
  };

  var listeners = [];

  function notify(reason) {
    listeners.forEach(function (fn) {
      try { fn(reason); } catch (e) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('RepriceAA listener error (' + reason + '):', e);
        }
      }
    });
  }

  function seedProfiles(stored, goneIds) {
    var seeded = (stored || []).slice();
    builtinProfiles().forEach(function (bp) {
      var found = false;
      seeded.forEach(function (p, i) {
        if (p.id === bp.id) {
          found = true;
          // Built-in presets are locked in the UI, so a stored copy can only
          // be stale data from an older version - the current preset wins so
          // preset updates (ratio fixes, promos, new model families) reach
          // existing users.
          seeded[i] = bp;
        }
      });
      if (!found && (!goneIds || goneIds.indexOf(bp.id) === -1)) seeded.push(bp);
    });
    return seeded;
  }

  function load() {
    return storageApi.get([
      storageApi.KEYS.profiles,
      storageApi.KEYS.activeProfileId,
      storageApi.KEYS.prefs,
      storageApi.KEYS.deletedBuiltins,
      storageApi.KEYS.sourceMode
    ]).then(function (res) {
      var goneIds = res[storageApi.KEYS.deletedBuiltins] || [];
      cache.profiles = seedProfiles(res[storageApi.KEYS.profiles], goneIds)
        .filter(function (p) { return p.id !== 'aa-default'; });
      var aid = res[storageApi.KEYS.activeProfileId];
      var ok = false;
      cache.profiles.forEach(function (p) { if (p.id === aid) ok = true; });
      cache.activeProfileId = ok ? aid : null;
      var prefs = res[storageApi.KEYS.prefs] || {};
      if (prefs.mode === 'aa' || prefs.mode === 'repriced' || prefs.mode === 'best') state.sourceMode = prefs.mode;
      if (Array.isArray(prefs.enabledSourceIds)) {
        cache.enabledSourceIds = prefs.enabledSourceIds.filter(function (id) { return typeof id === 'string'; });
      }
      cache.logScale = prefs.logScale !== false;
      cache.panelOpen = !!prefs.panelOpen;
      var sm = res[storageApi.KEYS.sourceMode];
      if (sm === 'repriced' || sm === 'best' || sm === 'aa') state.sourceMode = sm;
      if (state.sourceMode === 'repriced' && !ok) state.sourceMode = 'aa';
      return cache;
    });
  }

  function upsertProfile(profile) {
    var idx = -1;
    cache.profiles.forEach(function (p, i) { if (p.id === profile.id) idx = i; });
    if (idx >= 0) cache.profiles[idx] = profile;
    else cache.profiles.push(profile);
    persistProfiles();
    return profile;
  }

  function removeProfile(id) {
    cache.profiles = cache.profiles.filter(function (p) { return p.id !== id; });
    if (cache.activeProfileId === id) {
      cache.activeProfileId = null;
      state.sourceMode = 'aa';
    }
    // clean dangling references in remaining profiles
    cache.profiles.forEach(function (p) {
      if (p.basedOn === id) p.basedOn = null;
      if (p.fallbackTo === id) p.fallbackTo = null;
    });
    cache.enabledSourceIds = cache.enabledSourceIds.filter(function (sid) { return sid !== id; });
    persistProfiles();
  }

  function markBuiltinDeleted(id) {
    return storageApi.get([storageApi.KEYS.deletedBuiltins]).then(function (res) {
      var gone = res[storageApi.KEYS.deletedBuiltins] || [];
      if (gone.indexOf(id) === -1) {
        gone.push(id);
        return storageApi.set(storageApi.KEYS.deletedBuiltins, gone);
      }
    });
  }

  function getProfileById(id) {
    for (var i = 0; i < cache.profiles.length; i++) {
      if (cache.profiles[i].id === id) return cache.profiles[i];
    }
    return null;
  }

  function activePricingProfile() {
    if (state.sourceMode === 'repriced') {
      return getProfileById(cache.activeProfileId) || null;
    }
    return null;
  }

  function setSource(sourceId) {
    if (sourceId === '__best__') {
      state.sourceMode = 'best';
    } else if (sourceId === '__aa__' || sourceId == null) {
      state.sourceMode = 'aa';
    } else {
      state.sourceMode = 'repriced';
      cache.activeProfileId = sourceId;
    }
    persistAll();
    notify('source');
  }

  function setBestSources(ids) {
    var known = {};
    cache.profiles.forEach(function (p) { known[p.id] = true; });
    cache.enabledSourceIds = (Array.isArray(ids) ? ids : []).filter(function (id) { return known[id]; });
    if (state.sourceMode === 'best' && cache.enabledSourceIds.length === 0) {
      state.sourceMode = 'aa';
    }
    persistAll();
    notify('source');
  }

  function getEnabledSourceIds() {
    var known = {};
    cache.profiles.forEach(function (p) { known[p.id] = true; });
    return cache.enabledSourceIds.filter(function (id) { return known[id]; });
  }

  function sourceTemplates() {
    return [
      {
        key: 'blank',
        label: 'Blank (pay-as-you-go)',
        description: 'Start from scratch; default multiplier \u00D71',
        profile: { kind: 'usage', defaultRule: { type: 'multiplier', value: 1 }, rules: {}, nameIncludes: [] }
      },
      {
        key: 'gateway',
        label: 'Gateway / reseller (+5.5%)',
        description: 'Aggregated billing like OpenRouter; all models \u00D71.055',
        profile: { kind: 'usage', defaultRule: { type: 'multiplier', value: 1.055 }, rules: {}, nameIncludes: [] }
      },
      {
        key: 'batch',
        label: 'Batch (\u00D70.5, derived)',
        description: 'Half price of another source; pick the parent below',
        profile: { kind: 'usage', basedOn: '__pick__', defaultRule: { type: 'multiplier', value: 0.5 }, rules: {}, nameIncludes: [] }
      },
      {
        key: 'subscription',
        label: 'Subscription (Coding Plan)',
        description: 'Monthly fee amortized into a ratio; uncovered models fall back',
        profile: {
          kind: 'subscription', monthlyFee: null, monthlyQuotaTokens: null,
          refBlendedPrice: null, manualRatio: null, fallbackTo: '__pick__',
          defaultRule: { type: 'multiplier', value: 1 }, rules: {}, nameIncludes: []
        }
      },
      {
        key: 'local',
        label: 'Local / free ($0)',
        description: 'Self-hosted or free endpoints; all models $0',
        profile: { kind: 'usage', defaultRule: { type: 'absolute', value: 0 }, rules: {}, nameIncludes: [] }
      }
    ];
  }

  function setLogScale(v) {
    cache.logScale = !!v;
    persistPrefs();
    notify('prefs');
  }

  function setPanelOpen(v) {
    cache.panelOpen = !!v;
    persistPrefs();
  }

  function persistProfiles() {
    storageApi.set(storageApi.KEYS.profiles, cache.profiles);
    storageApi.set(storageApi.KEYS.activeProfileId, cache.activeProfileId);
    storageApi.set(storageApi.KEYS.sourceMode, state.sourceMode);
  }

  function persistPrefs() {
    storageApi.set(storageApi.KEYS.prefs, {
      logScale: cache.logScale,
      panelOpen: cache.panelOpen,
      enabledSourceIds: cache.enabledSourceIds
    });
  }

  function persistAll() {
    persistProfiles();
    persistPrefs();
  }

  // Remote preset updates (src/lib/remotesources.js): swap the bundled
  // preset definitions for a validated remote payload and re-seed state so
  // ratio/promo/model-list changes reach users without a release.
  function applyRemoteSources(remoteSources) {
    if (!Array.isArray(remoteSources) || !remoteSources.length) return Promise.resolve(false);
    RAA.SOURCES = remoteSources;
    return load().then(function () {
      notify('source');
      return true;
    });
  }

  var state = {
    cache: cache,
    load: load,
    onProfilesChanged: function (fn) {
      listeners.push(fn);
    },
    getSourceMode: function () {
      return state.sourceMode === 'best' ? 'best'
        : state.sourceMode === 'repriced' ? 'repriced' : 'aa';
    },
    getSourceId: function () { return state.sourceMode === 'repriced' ? cache.activeProfileId : (state.sourceMode === 'best' ? '__best__' : '__aa__'); },
    activePricingProfile: activePricingProfile,
    getProfileById: getProfileById,
    setSource: setSource,
    setBestSources: setBestSources,
    getEnabledSourceIds: getEnabledSourceIds,
    sourceTemplates: sourceTemplates,
    setLogScale: setLogScale,
    setPanelOpen: setPanelOpen,
    isPanelOpen: function () { return cache.panelOpen; },
    isLogScale: function () { return cache.logScale; },
    upsertProfile: upsertProfile,
    removeProfile: removeProfile,
    markBuiltinDeleted: markBuiltinDeleted,
    applyRemoteSources: applyRemoteSources,
    nextFreshId: function () { return 'p-' + Date.now(); }
  };

  root.RepriceAA.state = state;
})(typeof window !== 'undefined' ? window : globalThis);
