(function (root) {
  'use strict';

  var EPS = 1e-9;
  var MAX_CHAIN_DEPTH = 3;
  var MAX_FORMULA_LEN = 240;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  var FORMULA_FUNCS = {
    abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round,
    min: Math.min, max: Math.max, pow: Math.pow, sqrt: Math.sqrt,
    log: Math.log, exp: Math.exp
  };

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

  // Preset promo overlay (e.g. "DeepSeek V4.1 Flash: limited-time 4x quota").
  // Active when startsAt <= today (if set) and today <= endsAt; endsAt null
  // means "limited time, unconfirmed end" and stays active until the page
  // says otherwise.
  function promoActive(promo, today) {
    if (!promo || typeof promo !== 'object') return false;
    if (typeof promo.startsAt === 'string' && DATE_RE.test(promo.startsAt)
      && String(today) < promo.startsAt) return false;
    if (typeof promo.endsAt === 'string' && DATE_RE.test(promo.endsAt)
      && String(today) > promo.endsAt) return false;
    return true;
  }

  // Pattern matching is punctuation-insensitive: plan pages spell models
  // "GPT 5.6 Luna" / "MiniMax M3" while AA labels read "GPT-5.6 Luna" /
  // "MiniMax-M3" (and AA itself mixes both, e.g. "LongCat 2.0" vs
  // "LongCat-2.0"). Lowercase + strip spaces/dashes/dots/underscores on
  // both sides so either spelling matches.
  function matchKey(s) {
    return String(s).toLowerCase().replace(/[\s\-_.]+/g, '');
  }

  function matchPromo(source, modelId, label, today) {
    if (!source || !Array.isArray(source.promos)) return null;
    var idKey = matchKey(modelId);
    var labelKey = matchKey(label || '');
    for (var i = 0; i < source.promos.length; i++) {
      var p = source.promos[i];
      if (!p || !p.match || !p.rule) continue;
      var m = String(p.match);
      var hit = (m.indexOf('/') === 0
        ? idKey.indexOf(matchKey(m.slice(1)))
        : labelKey.indexOf(matchKey(m))) !== -1;
      if (hit && promoActive(p, today)) return p;
    }
    return null;
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
    var idKey = matchKey(modelId);
    var labelKey = matchKey(label);
    for (var i = 0; i < profile.nameIncludes.length; i++) {
      var entry = profile.nameIncludes[i];
      if (!entry || !entry.match) continue;
      var m = matchKey(entry.match);
      if ((m.indexOf('/') === 0 ? idKey.indexOf(m.slice(1)) : labelKey.indexOf(m)) !== -1) {
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

  function isKnownFunc(name) {
    var key = name.indexOf('Math.') === 0 ? name.slice(5) : name;
    return Object.prototype.hasOwnProperty.call(FORMULA_FUNCS, key);
  }

  function isKnownFormulaName(name) {
    return name === 'aaCost' || name === 'base' || name === 'PI' || name === 'E'
      || name === 'Math.PI' || name === 'Math.E';
  }

  // Formula expressions run in the content-script origin and remote preset
  // payloads may be attacker-controlled, so expressions are parsed with a
  // strict whitelist grammar instead of new Function: numbers, aaCost/base,
  // + - * / %, parentheses, unary sign, and the Math-like helpers below.
  // Anything else (member access, calls, property tricks) fails the parse.
  function parseFormula(expr) {
    var src = String(expr == null ? '' : expr);
    if (!src.trim() || src.length > MAX_FORMULA_LEN) throw new Error('bad formula');
    var pos = 0;

    function fail() { throw new Error('bad formula'); }
    function ws() { while (pos < src.length && /\s/.test(src.charAt(pos))) pos++; }
    function eat(ch) { ws(); if (src.charAt(pos) !== ch) fail(); pos++; }

    function parseArgs() {
      var args = [];
      ws();
      if (src.charAt(pos) !== ')') {
        args.push(parseAddSub());
        ws();
        while (src.charAt(pos) === ',') {
          pos++;
          args.push(parseAddSub());
          ws();
        }
      }
      if (src.charAt(pos) !== ')') fail();
      pos++;
      return args;
    }

    function parsePrimary() {
      ws();
      var c = src.charAt(pos);
      if (c === '(') {
        pos++;
        var inner = parseAddSub();
        eat(')');
        return inner;
      }
      var numMatch = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(pos));
      if (numMatch) {
        pos += numMatch[0].length;
        return { t: 'num', v: parseFloat(numMatch[0]) };
      }
      var nameMatch = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(pos));
      if (nameMatch) {
        pos += nameMatch[0].length;
        ws();
        if (src.charAt(pos) === '(') {
          pos++;
          if (!isKnownFunc(nameMatch[0])) fail();
          return { t: 'call', name: nameMatch[0], args: parseArgs() };
        }
        if (!isKnownFormulaName(nameMatch[0])) fail();
        return { t: 'var', name: nameMatch[0] };
      }
      fail();
    }

    function parseUnary() {
      ws();
      var c = src.charAt(pos);
      if (c === '+' || c === '-') {
        pos++;
        return { t: 'unary', op: c, arg: parseUnary() };
      }
      return parsePrimary();
    }

    function parseMulDiv() {
      var node = parseUnary();
      for (;;) {
        ws();
        var c = src.charAt(pos);
        if (c !== '*' && c !== '/' && c !== '%') return node;
        pos++;
        node = { t: 'binary', op: c, l: node, r: parseUnary() };
      }
    }

    function parseAddSub() {
      var node = parseMulDiv();
      for (;;) {
        ws();
        var c = src.charAt(pos);
        if (c !== '+' && c !== '-') return node;
        pos++;
        node = { t: 'binary', op: c, l: node, r: parseMulDiv() };
      }
    }

    var ast = parseAddSub();
    ws();
    if (pos !== src.length) fail();
    return ast;
  }

  function evalAst(node, vars) {
    if (node.t === 'num') return node.v;
    if (node.t === 'var') {
      if (node.name === 'aaCost' || node.name === 'base') return vars[node.name];
      if (node.name === 'PI' || node.name === 'Math.PI') return Math.PI;
      if (node.name === 'E' || node.name === 'Math.E') return Math.E;
      throw new Error('unknown identifier');
    }
    if (node.t === 'call') {
      var fn = node.name.indexOf('Math.') === 0
        ? FORMULA_FUNCS[node.name.slice(5)] : FORMULA_FUNCS[node.name];
      if (typeof fn !== 'function') throw new Error('unknown function');
      return fn.apply(null, node.args.map(function (a) { return evalAst(a, vars); }));
    }
    if (node.t === 'unary') {
      var u = evalAst(node.arg, vars);
      return node.op === '-' ? -u : u;
    }
    var l = evalAst(node.l, vars);
    var r = evalAst(node.r, vars);
    if (node.op === '+') return l + r;
    if (node.op === '-') return l - r;
    if (node.op === '*') return l * r;
    if (node.op === '/') return l / r;
    return l % r;
  }

  function evalFormula(expr, vars) {
    try {
      var v = evalAst(parseFormula(expr), vars || {});
      return typeof v === 'number' && isFinite(v) ? Math.max(0, v) : null;
    } catch (e) {
      return null;
    }
  }

  function isFormulaSafe(expr) {
    try {
      parseFormula(expr);
      return true;
    } catch (e) {
      return false;
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

    // preset promo overlay: below user exact overrides, above name-match
    // rules and the subscription amortized ratio
    var promo = !exact ? matchPromo(source, model.id, model.label, ctx.today) : null;

    // name-match rules, first active match wins. Entries must be ordered
    // most-specific first (enforced by scripts/build-sources.js): a later
    // broader pattern must not swallow a model that an earlier specific
    // pattern prices differently.
    var matched = null;
    var matchedRaw = null;
    if (Array.isArray(source.nameIncludes)) {
      for (var i = 0; i < source.nameIncludes.length; i++) {
        var entry = source.nameIncludes[i];
        if (!entry || !entry.match) continue;
        var m = matchKey(entry.match);
        var hit = (m.indexOf('/') === 0
          ? matchKey(model.id).indexOf(m.slice(1))
          : matchKey(model.label).indexOf(m)) !== -1;
        if (hit && ruleUntilActive(normalizeRule(entry.rule), ctx.today)) {
          matchedRaw = entry.rule;
          matched = normalizeRule(entry.rule);
          break;
        }
      }
    }

    if (matched && isSubscription && matchedRaw == null) {
      // Coverage-only pattern entry (no rule value): fall back to the
      // source's amortized ratio. Entries WITH a rule keep their own value -
      // for maintained subscription presets that value is the per-model
      // effective price (monthlyFee / per-model monthly allowance), not a
      // decoration on top of the unified ratio.
      var ratio = computeSubscriptionRatio(source);
      if (ratio !== null) matched = { type: 'multiplier', value: ratio };
    }

    var own = exact || null;
    var ownIsDefault = false;
    if (!own && promo) {
      own = normalizeRule(promo.rule);
      if (typeof promo.endsAt === 'string' && DATE_RE.test(promo.endsAt)) {
        own.until = promo.endsAt;
      }
    }
    if (!own) own = matched || null;
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
      ruleDescription: describeRule(own) + (promo && !own.until ? ' \u00B7 promo' : ''),
      ruleType: own.type,
      ruleValue: own.type === 'formula' ? null : own.value,
      ruleSource: ownIsDefault ? 'default' : (promo ? 'promo' : (exact ? 'override' : 'nameMatch')),
      sourceId: source.id,
      promo: promo ? { reason: promo.reason || null, endsAt: promo.endsAt || null } : undefined,
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
    matchKey: matchKey,
    normalizeRule: normalizeRule,
    ruleUntilActive: ruleUntilActive,
    promoActive: promoActive,
    resolveRule: resolveRule,
    resolvePrice: resolvePrice,
    makeCtx: makeCtx,
    describeRule: describeRule,
    trimNum: trimNum,
    evalFormula: evalFormula,
    isFormulaSafe: isFormulaSafe,
    computeSubscriptionRatio: computeSubscriptionRatio,
    priceModel: priceModel,
    applyProfile: applyProfile,
    applySource: applySource,
    applyBest: applyBest,
    savingsFraction: savingsFraction,
    MAX_CHAIN_DEPTH: MAX_CHAIN_DEPTH
  };
})(typeof window !== 'undefined' ? window : globalThis);
