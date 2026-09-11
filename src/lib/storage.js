(function (root) {
  'use strict';

  var KEYS = {
    profiles: 'repriceaa.profiles',
    activeProfileId: 'repriceaa.activeProfileId',
    prefs: 'repriceaa.prefs',
    deletedBuiltins: 'repriceaa.deletedBuiltinIds',
    sourceMode: 'repriceaa.sourceMode',
    remoteSources: 'repriceaa.remoteSources'
  };

  function hasChromeStorage() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  function get(keys) {
    if (Array.isArray(keys)) {
      keys = keys.filter(function (k) { return typeof k === 'string' && k; });
    }
    if (hasChromeStorage()) {
      return new Promise(function (resolve, reject) {
        chrome.storage.local.get(keys, function (res) {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(res);
        });
      });
    }
    var fallback = {};
    keys.forEach(function (k) {
      try {
        var raw = localStorage.getItem(k);
        if (raw !== null) fallback[k] = JSON.parse(raw);
      } catch (e) { }
    });
    return Promise.resolve(fallback);
  }

  function set(keyOrItems, maybeValue) {
    var items;
    if (typeof keyOrItems === 'string') {
      items = {};
      items[keyOrItems] = maybeValue;
    } else {
      items = keyOrItems;
    }
    if (hasChromeStorage()) {
      return new Promise(function (resolve, reject) {
        chrome.storage.local.set(items, function () {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve();
        });
      });
    }
    Object.keys(items).forEach(function (k) {
      try {
        localStorage.setItem(k, JSON.stringify(items[k]));
      } catch (e) { }
    });
    return Promise.resolve();
  }

  root.RepriceAA = root.RepriceAA || {};
  root.RepriceAA.storage = { KEYS: KEYS, get: get, set: set };
})(typeof window !== 'undefined' ? window : globalThis);

