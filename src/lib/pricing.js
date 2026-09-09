(function (root) {
  'use strict';

  var EPS = 1e-9;
  var MAX_CHAIN_DEPTH = 3;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function num(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function todayStr(now) {
    var d = now instanceof Date ? now : new Date();
    var p = function (n, w) { return String(n).padStart ? String(n).padStart(w, '0') : ('0' + n).slice(-w); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1, 2) + '-' + p(d.getDate(), 2);
  }

  function ruleUntilActive(rule, today) {
    if (!rule || typeof rule.until !== 'string' || !DATE_RE.test(rule.until)) return true;
    return String(today) <= rule.until;
  }

  function normalizeRule(rule) {
    var out;
    if (!rule || typeof rule !== 'object') {
      out = { type: 'multiplier', value: 1 };
    } else if (rule.type === 'absolute' && num(rule.value)) {
      out = { type: 'absolute', value: Math.max(0, rule.value) };
    } else if (rule.type === 'exclude') {
      out = { type: 'exclude' };
    } else if (rule.type === 'formula' && typeof rule.expr === 'string' && rule.expr.trim()) {
      out = { type: 'formula', expr: rule.expr.trim() };
    } else if (num(rule.value)) {
      out = { type: 'multiplier', value: Math.max(0, rule.value) };
    } else {
      out = { type: 'multiplier', value: 1 };
    }
    if (rule && typeof rule.until === 'string' && DATE_RE.test(rule.until)) {
      out.until = rule.until;
    }
    return out;
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
    if (r.type === 'exclude') {
      return 'not covered \u2192 fallback';
    }
    if (r.type === 'formula') {
      return 'f(aaCost)';
    }
    var s = trimNum(r.value) + '\u00D7';
    if (r.until) s += ' (\u81F3 ' + r.until + ')';
    return s;
  }

  function trimNum(v) {
    var n = Number(v);
    if (!isFinite(n)) return String(v);
    var s = n.toFixed(4);
    s = s.replace(/\.?0+$/, '');
    return s;
  }

  function evalFormula(expr, vars) {
    try {
      var fn = new Function('aaCost', 'base', '"use strict"; return (' + expr + ');');
      var v = fn(vars.aaCost, vars.base);
      return typeof v === 'number' && isFinite(v) ? Math.max(0, v) : null;
    } catch (e) {
      return null;
    }
  }

  function applyOp(rule, base, aaCost) {
    var r = normalizeRule(rule);
    if (r.type === 'absolute') return r.value;
    if (r.type === 'formula') {
      var v = evalFormula(r.expr, { aaCost: aaCost, base: base });
      return v === null ? base : v;
    }
    return base * r.value;
  }

  function makeCtx(sources, today) {
    var byId = {};
    (Array.isArray(sources) ? sources : []).forEach(function (s) {
      if (s && typeof s.id === 'string') byId[s.id] = s;
    });
    return {
      sourcesById: byId,
      today: today || todayStr()
    };
  }

  function identityResult(model, anomalies) {
    return {
      price: num(model.aaCost) ? Math.max(0, model.aaCost) : null,
      ruleDescription: 'AA list price',
      ruleType: 'multiplier',
      ruleValue: 1,
      ruleSource: 'identity',
      sourceId: null,
      anomalies: anomalies || []
    };
  }

  // Resolves the price of one model under one source. Returns a result object
  // with { price, ruleDescription, ruleType, ruleValue, ruleSource, sourceId, anomalies }.
  function resolvePrice(model, sourceId, ctx, depth, anomalies) {
    if (depth === undefined) depth = 0;
    anomalies = anomalies || [];
    if (depth > MAX_CHAIN_DEPTH) {
      anomalies.push('chain-loop');
      return identityResult(model, anomalies);
    }
    if (!ctx || !ctx.sourcesById) ctx = makeCtx([], ctx && ctx.today);

    if (!num(model.aaCost)) {
      return identityResult(model, anomalies.concat(['no-list-price']));
    }
    var aaCost = Math.max(0, model.aaCost);

    var source = (sourceId && ctx.sourcesById[sourceId]) || null;
    if (!source) {
      return identityResult(model, anomalies);
    }

    var isSubscription = source.kind === 'subscription';

    // exact override
    var exact = source.rules && Object.prototype.hasOwnProperty.call(source.rules, model.id)
      ? normalizeRule(source.rules[model.id]) : null;
    if (exact && !ruleUntilActive(exact, ctx.today)) exact = null;

    // name-match rules, first active match wins
    var matched = null;
    if (Array.isArray(source.nameIncludes)) {
      for (var i = 0; i < source.nameIncludes.length; i++) {
        var entry = source.nameIncludes[i];
        if (!entry || !entry.match) continue;
        var m = entry.match.toLowerCase();
        var hit = (m.indexOf('/') === 0
          ? String(model.id).toLowerCase().indexOf(m.slice(1))
          : String(model.label || '').toLowerCase().indexOf(m)) !== -1;
        if (hit) {
          var r = normalizeRule(entry.rule);
          if (ruleUntilActive(r, ctx.today)) { matched = r; break; }
        }
      }
    }

    if (matched && isSubscription) {
      // subscription: covered models use the unified amortized ratio when it is
      // computable; the pattern's own rule value is only a fallback
      var ratio = computeSubscriptionRatio(source);
      if (ratio !== null) matched = { type: 'multiplier', value: ratio };
    }

    var own = exact || matched || null;
    var ownIsDefault = false;
    if (!own) {
      if (isSubscription) {
        own = { type: 'exclude' };
      } else {
        own = normalizeRule(source.defaultRule);
        if (ruleUntilActive(own, ctx.today)) {
          ownIsDefault = true;
        } else {
          own = { type: 'exclude' };
        }
      }
    }

    if (own.type === 'exclude') {
      if (source.fallbackTo && ctx.sourcesById[source.fallbackTo]) {
        return resolvePrice(model, source.fallbackTo, ctx, depth + 1, anomalies);
      }
      return identityResult(model, anomalies);
    }

    // base price for the op: parent price for derived sources, aaCost otherwise
    var base = aaCost;
    if (source.basedOn && ctx.sourcesById[source.basedOn]) {
      var parent = resolvePrice(model, source.basedOn, ctx, depth + 1, anomalies);
      if (parent.price === null) {
        return identityResult(model, anomalies);
      }
      base = parent.price;
    }

    var price;
    if (own.type === 'formula') {
      var v = evalFormula(own.expr, { aaCost: aaCost, base: base });
      if (v === null) {
        anomalies.push('formula-error');
        price = base;
      } else {
        price = v;
      }
    } else {
      price = applyOp(own, base, aaCost);
    }
    if (!num(price) || price < 0) price = 0;
    price = Math.max(0, price);

    if (price <= EPS && aaCost > EPS) {
      anomalies.push('zero-cost');
    }

    return {
      price: price,
      ruleDescription: describeRule(own),
      ruleType: own.type,
      ruleValue: own.type === 'formula' ? null : own.value,
      ruleSource: ownIsDefault ? 'default' : (exact ? 'override' : 'nameMatch'),
      sourceId: source.id,
      anomalies: anomalies
    };
  }

  // Applies a single source (or the AA identity when source is null) to a model list.
  function applySource(models, source, sources) {
    var ctx = makeCtx(sources || (source ? [source] : []));
    var list = Array.isArray(models) ? models : [];
    var sourceId = source && source.id;
    return list.map(function (m) {
      var res = source ? resolvePrice(m, sourceId, ctx) : identityResult(m);
      return Object.assign({}, m, {
        repricedCost: res.price,
        ruleDescription: res.ruleDescription,
        ruleType: res.ruleType,
        ruleValue: res.ruleValue,
        ruleSource: res.ruleSource,
        sourceId: res.sourceId,
        anomalies: res.anomalies
      });
    });
  }

  // Best-of mode: for each model, resolve across enabled sources and take the min.
  // Candidates that leave the model at the AA list price (source does not cover
  // it and no fallback applies) are flagged identity:true so the UI can hide
  // them; when such a candidate wins, the price is surfaced as plain "AA list
  // price" instead of being attributed to a source.
  function applyBest(models, enabledIds, sources) {
    var ctx = makeCtx(sources);
    var list = Array.isArray(models) ? models : [];
    var ids = (Array.isArray(enabledIds) ? enabledIds : []).filter(function (id) {
      return !!ctx.sourcesById[id];
    });
    return list.map(function (m) {
      var candidates = [];
      ids.forEach(function (id) {
        var res = resolvePrice(m, id, ctx);
        if (num(res.price)) {
          candidates.push({
            sourceId: id,
            sourceName: (ctx.sourcesById[id] && ctx.sourcesById[id].name) || id,
            price: res.price,
            ruleDescription: res.ruleDescription,
            anomalies: res.anomalies,
            identity: res.sourceId === null
          });
        }
      });
      var winner = null;
      candidates.forEach(function (c) {
        if (!winner || c.price < winner.price - EPS) winner = c;
      });
      if (winner && winner.identity) {
        return Object.assign({}, m, {
          repricedCost: winner.price,
          ruleDescription: 'AA list price',
          winnerSourceId: null,
          winnerSourceName: null,
          candidates: candidates,
          anomalies: winner.anomalies
        });
      }
      return Object.assign({}, m, {
        repricedCost: winner ? winner.price : null,
        ruleDescription: winner ? winner.ruleDescription : null,
        winnerSourceId: winner ? winner.sourceId : null,
        winnerSourceName: winner ? winner.sourceName : null,
        candidates: candidates,
        anomalies: winner ? winner.anomalies : ['no-candidate']
      });
    });
  }

  function computeSubscriptionRatio(profile) {
    if (!profile || profile.kind !== 'subscription') return null;
    if (num(profile.manualRatio) && profile.manualRatio > 0) return profile.manualRatio;
    var fee = profile.monthlyFee;
    var quota = profile.monthlyQuotaTokens;
    var ref = profile.refBlendedPrice;
    if (!(num(fee) && fee > 0 && num(quota) && quota > 0 && num(ref) && ref > 0)) return null;
    var amortizedPerMillion = fee / (quota / 1e6);
    if (!isFinite(amortizedPerMillion) || amortizedPerMillion <= 0) return null;
    return amortizedPerMillion / ref;
  }

  // Legacy API kept for compatibility: a bare profile behaves exactly as before.
  function priceModel(model, profile) {
    var aaCost = num(model.aaCost) ? model.aaCost : null;
    var resolved = resolveRule(model.id, model.label, profile);
    var r = resolved.rule;
    var repriced = null;
    if (aaCost !== null) {
      repriced = r.type === 'absolute' ? r.value
        : (r.type === 'formula' ? applyOp(r, aaCost, aaCost) : aaCost * r.value);
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
    todayStr: todayStr,
    normalizeRule: normalizeRule,
    ruleUntilActive: ruleUntilActive,
    resolveRule: resolveRule,
    resolvePrice: resolvePrice,
    makeCtx: makeCtx,
    describeRule: describeRule,
    trimNum: trimNum,
    evalFormula: evalFormula,
    computeSubscriptionRatio: computeSubscriptionRatio,
    priceModel: priceModel,
    applyProfile: applyProfile,
    applySource: applySource,
    applyBest: applyBest,
    savingsFraction: savingsFraction,
    MAX_CHAIN_DEPTH: MAX_CHAIN_DEPTH
  };
})(typeof window !== 'undefined' ? window : globalThis);
