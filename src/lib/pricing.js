(function (root) {
  'use strict';

  var EPS = 1e-9;

  function num(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function normalizeRule(rule) {
    if (!rule || typeof rule !== 'object') {
      return { type: 'multiplier', value: 1 };
    }
    if (rule.type === 'absolute' && num(rule.value)) {
      return { type: 'absolute', value: Math.max(0, rule.value) };
    }
    if (num(rule.value)) {
      return { type: 'multiplier', value: Math.max(0, rule.value) };
    }
    return { type: 'multiplier', value: 1 };
  }

  function nameMatchValue(profile, modelId, label) {
    if (!profile || !Array.isArray(profile.nameIncludes)) return null;
    var idLower = String(modelId).toLowerCase();
    var labelLower = String(label).toLowerCase();
    for (var i = 0; i < profile.nameIncludes.length; i++) {
      var entry = profile.nameIncludes[i];
      if (!entry || !entry.match) continue;
      var m = entry.match.toLowerCase();
      if ((m.indexOf('/') === 0 ? idLower.indexOf(m.slice(1)) : labelLower.indexOf(m)) !== -1) {
        return entry.rule;
      }
    }
    return null;
  }

  function resolveRule(modelId, label, profile) {
    if (profile && profile.rules && Object.prototype.hasOwnProperty.call(profile.rules, modelId)) {
      return { rule: normalizeRule(profile.rules[modelId]), source: 'override' };
    }
    var matched = nameMatchValue(profile, modelId, label);
    if (matched !== null) {
      return { rule: normalizeRule(matched), source: 'nameMatch:' + (profile._matchTexts ? profile._matchTexts[modelId] : '') };
    }
    return { rule: normalizeRule(profile ? profile.defaultRule : null), source: 'default' };
  }

  function describeRule(rule) {
    var r = normalizeRule(rule);
    if (r.type === 'absolute') {
      return '$' + trimNum(r.value) + '/task';
    }
    return trimNum(r.value) + '\u00D7';
  }

  function trimNum(v) {
    var n = Number(v);
    if (!isFinite(n)) return String(v);
    var s = n.toFixed(4);
    s = s.replace(/\.?0+$/, '');
    return s;
  }

  function priceModel(model, profile) {
    var aaCost = num(model.aaCost) ? model.aaCost : null;
    var resolved = resolveRule(model.id, model.label, profile);
    var r = resolved.rule;
    var repriced = null;
    if (aaCost !== null) {
      repriced = r.type === 'absolute' ? r.value : aaCost * r.value;
      repriced = Math.max(0, repriced);
    }
    return Object.assign({}, model, {
      repricedCost: repriced,
      ruleDescription: describeRule(r),
      ruleType: r.type,
      ruleValue: r.value,
      ruleSource: resolved.source
    });
  }

  function applyProfile(models, profile) {
    var list = Array.isArray(models) ? models : [];
    return list.map(function (m) {
      return priceModel(m, profile);
    });
  }

  function savingsFraction(aaCost, repriced) {
    if (!num(aaCost) || !num(repriced) || aaCost <= EPS) return null;
    return 1 - repriced / aaCost;
  }

  root.RepriceAA = root.RepriceAA || {};
  root.RepriceAA.pricing = {
    num: num,
    normalizeRule: normalizeRule,
    resolveRule: resolveRule,
    describeRule: describeRule,
    trimNum: trimNum,
    priceModel: priceModel,
    applyProfile: applyProfile,
    savingsFraction: savingsFraction
  };
})(typeof window !== 'undefined' ? window : globalThis);
