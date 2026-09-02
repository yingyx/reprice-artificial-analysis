(function (root) {
  'use strict';

  var RAA = root.RepriceAA;
  var storageApi = RAA.storage;

  function builtinProfiles() {
    return [
      {
        id: 'aa-default',
        name: 'AA Cost',
        builtin: true,
        locked: true,
        defaultRule: { type: 'multiplier', value: 1 },
        rules: {},
        nameIncludes: []
      },
      {
        id: 'opencode-go-example',
        name: 'OpenCode Go (example)',
        builtin: true,
        defaultRule: { type: 'multiplier', value: 1 },
        rules: {},
        nameIncludes: [
          { match: 'glm', rule: { type: 'multiplier', value: 0.3 } },
          { match: 'deepseek', rule: { type: 'multiplier', value: 0.45 } }
        ]
      },
      {
        id: 'deepseek-offpeak-example',
        name: 'DeepSeek Off-Peak (example)',
        builtin: true,
        defaultRule: { type: 'multiplier', value: 1 },
        rules: {},
        nameIncludes: [{ match: 'deepseek', rule: { type: 'multiplier', value: 0.55 } }]
      }
    ];
  }

  var cache = {
    profiles: [],
    activeProfileId: 'aa-default',
    sourceMode: 'aa',
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
      seeded.forEach(function (p) { if (p.id === bp.id) found = true; });
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
      cache.profiles = seedProfiles(res[storageApi.KEYS.profiles], goneIds);
      var aid = res[storageApi.KEYS.activeProfileId];
      var ok = false;
      cache.profiles.forEach(function (p) { if (p.id === aid) ok = true; });
      cache.activeProfileId = ok ? aid : 'aa-default';
      var prefs = res[storageApi.KEYS.prefs] || {};
      if (prefs.mode === 'aa' || prefs.mode === 'repriced') state.sourceMode = prefs.mode;
      cache.logScale = prefs.logScale !== false;
      cache.panelOpen = !!prefs.panelOpen;
      var sm = res[storageApi.KEYS.sourceMode];
      state.sourceMode = sm === 'repriced' ? sm : sm === 'aa' ? 'aa' : state.sourceMode;
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
      cache.activeProfileId = 'aa-default';
      state.sourceMode = 'aa';
    }
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
    if (sourceId === '__aa__' || sourceId == null) {
      state.sourceMode = 'aa';
    } else {
      state.sourceMode = 'repriced';
      cache.activeProfileId = sourceId;
    }
    persistAll();
    notify('source');
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
    storageApi.set(storageApi.KEYS.prefs, { logScale: cache.logScale, panelOpen: cache.panelOpen });
  }

  function persistAll() {
    persistProfiles();
    persistPrefs();
  }

  var state = {
    cache: cache,
    load: load,
    onProfilesChanged: function (fn) {
      listeners.push(fn);
    },
    getSourceMode: function () { return state.sourceMode; },
    getSourceId: function () { return state.sourceMode === 'repriced' ? cache.activeProfileId : '__aa__'; },
    activePricingProfile: activePricingProfile,
    setSource: setSource,
    setLogScale: setLogScale,
    setPanelOpen: setPanelOpen,
    isPanelOpen: function () { return cache.panelOpen; },
    isLogScale: function () { return cache.logScale; },
    upsertProfile: upsertProfile,
    removeProfile: removeProfile,
    markBuiltinDeleted: markBuiltinDeleted,
    nextFreshId: function () { return 'p-' + Date.now(); }
  };

  root.RepriceAA.state = state;
})(typeof window !== 'undefined' ? window : globalThis);
