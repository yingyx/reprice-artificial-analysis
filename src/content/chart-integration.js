(function (root) {
  'use strict';

  var RAA = root.RepriceAA;

  var INTEGRATION_CSS = [
    '.raa-bar{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}',
    '.raa-bartitle{font-size:13px;color:#737373}',
    '.raa-srcselect{height:34px;border:1px solid #e5e5e5;border-radius:8px;background:#fff;color:#171717;',
    'font-size:13px;padding:0 28px 0 10px;cursor:pointer;max-width:260px;-webkit-appearance:auto;appearance:auto;outline:none;',
    'transition:border-color .15s ease}',
    '.raa-srcselect:hover{border-color:#8c8c8c}',
    '.raa-srcselect:focus-visible{border-color:#171717}',
    '.raa-prov{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#5b21b6;background:#f5f2fc;',
    'border:1px solid #e7defa;border-radius:999px;padding:3px 9px;line-height:1.4}',
    '.raa-integrated{position:relative !important}',
    '.raa-chartwrap{position:absolute;z-index:40;background:#ffffff;border-radius:8px;overflow:hidden}',
    '.raa-chartwrap.static{position:relative;left:auto !important;top:auto !important;width:100% !important;height:420px !important;margin-top:6px}',
    '.raa-chartwrap svg{display:block;width:100%;height:100%}',
    '.raa-prov{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#5b21b6;background:#f5f2fc;',
    'border:1px solid #e7defa;border-radius:999px;padding:3px 9px;line-height:1.4;cursor:default}',
    '.raa-prov b{color:#111827;font-weight:600}',
    '.raa-pt{transition:transform .55s cubic-bezier(.22,.9,.24,1);will-change:transform;cursor:default}',
    '.raa-pt.raa-noanim{transition:none}',
    '.raa-pt.raa-cached circle.body{opacity:.55}',
    '.raa-pt:hover circle.body{stroke-width:1.6;filter:brightness(.92)}',
    '.raa-tip{position:absolute;pointer-events:none;background:#fff;border:1px solid #e5e7eb;border-radius:8px;',
    'box-shadow:0 6px 20px rgba(0,0,0,.12);padding:8px 10px;font-size:12px;color:#26272b;display:none;z-index:50;',
    'line-height:1.55;min-width:190px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
    '.raa-tip b{font-size:12.5px}',
    '.raa-tip .row{display:flex;justify-content:space-between;gap:16px}',
    '.raa-tip .k{color:#6f7076}',
    '.raa-tip .v{font-weight:600;text-align:right}',
    '.raa-tip .rule{color:#5b21b6}',
    '.raa-wm{display:none}',
    '.raa-msg{padding:40px 0;text-align:center;color:#8a8f98;font-size:13px}'
  ].join('\n');

  function cssInjected() {
    return !!document.getElementById('raa-css');
  }

  function injectCss() {
    if (cssInjected()) return;
    var st = document.createElement('style');
    st.id = 'raa-css';
    st.textContent = INTEGRATION_CSS;
    document.head.appendChild(st);
  }

  var ANCHOR_SELECTOR = '[id^="intelligence-index-vs-cost"], [id^="intelligence-vs-cost"]';

  function findAnchors(doc) {
    try {
      return Array.prototype.slice.call((doc || document).querySelectorAll(ANCHOR_SELECTOR));
    } catch (e) {
      return [];
    }
  }

  function findPlotEl(anchorEl) {
    try {
      return anchorEl.querySelector('.recharts-responsive-container, .recharts-wrapper');
    } catch (e) {
      return null;
    }
  }

  function findBlockEl(anchorEl) {
    var plot = findPlotEl(anchorEl);
    if (!plot) return null;
    var pr = plot.getBoundingClientRect();
    if (pr.width < 60 || pr.height < 120) return null;
    var best = plot, el = plot;
    while (el.parentNode && el.parentNode !== anchorEl && el.parentNode !== document.documentElement) {
      el = el.parentNode;
      var r = el.getBoundingClientRect();
      if (r.height > pr.height + 60 || r.width > pr.width + 2) break;
      best = el;
    }
    return best;
  }

  function measurePlot(ctx) {
    var block = findBlockEl(ctx.anchor);
    ctx.plotEl = block;
    if (block) trackPlot(block);
    if (!block) return null;
    var ar = ctx.anchor.getBoundingClientRect();
    var br = block.getBoundingClientRect();
    if (br.width < 60 || br.height < 120) return null;
    return {
      left: br.left - ar.left,
      top: br.top - ar.top,
      w: Math.round(br.width),
      h: Math.round(br.height)
    };
  }

  function countNativeDots(anchorEl) {
    try {
      var plot = findPlotEl(anchorEl);
      if (!plot) return null;
      var n = plot.querySelectorAll('circle').length;
      if (!n) n = plot.querySelectorAll('path.recharts-symbol').length;
      return n > 0 ? n : null;
    } catch (e) {
      return null;
    }
  }

  function urlSelectedIds() {
    try {
      var v = new URLSearchParams(root.location.search).get('models');
      if (!v) return null;
      var ids = v.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      return ids.length ? ids : null;
    } catch (e) {
      return null;
    }
  }

  function aaLikeProfile(name) {
    return {
      id: '__aa_identity__',
      name: name,
      builtin: true,
      locked: true,
      defaultRule: { type: 'multiplier', value: 1 },
      rules: {},
      nameIncludes: []
    };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtMoney(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '\u2014';
    var d = v >= 1 ? 2 : v >= 0.1 ? 3 : 4;
    return '$' + Number(v.toFixed(d));
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  var contexts = [];

  var ro = null;
  var roTracked = null;
  function trackPlot(el) {
    if (!ro) {
      ro = new ResizeObserver(function () { scheduleScan(120); });
      roTracked = new WeakSet();
    }
    try {
      if (!roTracked.has(el)) {
        roTracked.add(el);
        ro.observe(el);
      }
    } catch (e) { /* ignore */ }
  }

  function createContext(anchorEl) {
    var ctx = {
      anchor: anchorEl,
      bar: null,
      select: null,
      prov: null,
      wrap: null,
      svg: null,
      gPts: null,
      path: null,
      tip: null,
      nodes: {},
      gLbl: null,
      lastSig: '',
      lastW: 0,
      lastH: 0
    };
    contexts.push(ctx);
    return ctx;
  }

  function pruneContexts() {
    contexts = contexts.filter(function (ctx) {
      return document.documentElement.contains(ctx.anchor);
    });
  }

  function ensureCssElements(ctx) {
    if (!ctx.bar) {
      ctx.bar = document.createElement('div');
      ctx.bar.className = 'raa-bar';

      var title = document.createElement('span');
      title.className = 'raa-bartitle';
      title.textContent = 'Price Source';
      ctx.bar.appendChild(title);

      ctx.select = document.createElement('select');
      ctx.select.className = 'raa-srcselect';
      ctx.select.setAttribute('aria-label', 'Price Source');
      ctx.bar.appendChild(ctx.select);

      ctx.prov = document.createElement('span');
      ctx.prov.className = 'raa-prov';
      ctx.prov.textContent = 'Repriced by RepriceAA';
      ctx.prov.style.display = 'none';
      ctx.bar.appendChild(ctx.prov);

      ctx.select.addEventListener('change', function () {
        var v = ctx.select.value;
        if (v === '__customize__') {
          syncSelectValues();
          root.dispatchEvent(new CustomEvent('repriceaa:open-editor'));
          return;
        }
        RAA.state.setSource(v);
        renderAllBars();
      });

      ctx.anchor.insertBefore(ctx.bar, ctx.anchor.firstChild);
    }
    if (!ctx.tip) {
      ctx.tip = document.createElement('div');
      ctx.tip.className = 'raa-tip';
    }
  }

  function populateSelect(select) {
    var desired = RAA.state.getSourceId();
    var opts = ['<option value="__aa__">Artificial Analysis</option>'];
    RAA.state.cache.profiles.forEach(function (p) {
      opts.push('<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>');
    });
    opts.push('<option value="__customize__">\u2026 Custom</option>');
    var html = opts.join('');
    if (select.dataset.sig !== html) {
      select.innerHTML = html;
      select.dataset.sig = html;
    }
    if (select.value !== desired) select.value = desired;
  }

  function syncSelectValues() {
    contexts.forEach(function (ctx) {
      if (ctx.select) populateSelect(ctx.select);
    });
  }

  function ensureOverlay(ctx, box) {
    if (!ctx.wrap || !document.documentElement.contains(ctx.wrap)) {
      ctx.wrap = document.createElement('div');
      ctx.wrap.className = 'raa-chartwrap';
      ctx.anchor.appendChild(ctx.wrap);
      ctx.nodes = {};
      ctx.svg = null;
    }
    if (box) {
      ctx.wrap.classList.remove('static');
      ctx.wrap.style.position = '';
      ctx.wrap.style.left = box.left + 'px';
      ctx.wrap.style.top = box.top + 'px';
      ctx.wrap.style.width = box.w + 'px';
      ctx.wrap.style.height = box.h + 'px';
      ctx.lastW = Math.max(box.w, 320);
      ctx.lastH = Math.max(box.h, 200);
    } else {
      ctx.wrap.classList.add('static');
      ctx.wrap.style.position = '';
      ctx.wrap.style.left = '';
      ctx.wrap.style.top = '';
      ctx.wrap.style.width = '';
      ctx.wrap.style.height = '';
      ctx.lastW = Math.max(Math.round(ctx.anchor.getBoundingClientRect().width), 320);
      ctx.lastH = 420;
    }

    ctx.wrap.style.display = '';
    if (!ctx.svg) {
      while (ctx.wrap.firstChild) ctx.wrap.removeChild(ctx.wrap.firstChild);
      ctx.nodes = {};
      ctx.tip = document.createElement('div');
      ctx.tip.className = 'raa-tip';
      ctx.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ctx.gLgd = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      ctx.gAxis = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      ctx.path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      ctx.path.setAttribute('fill', 'none');
      ctx.path.setAttribute('stroke', '#565a61');
      ctx.path.setAttribute('stroke-width', '2.5');
      ctx.path.setAttribute('stroke-dasharray', '0.1 7');
      ctx.path.setAttribute('stroke-linecap', 'round');
      ctx.gPts = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      ctx.gLbl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      ctx.svg.appendChild(ctx.gLgd);
      ctx.svg.appendChild(ctx.gAxis);
      ctx.svg.appendChild(ctx.path);
      ctx.svg.appendChild(ctx.gPts);
      ctx.svg.appendChild(ctx.gLbl);
      ctx.wrap.appendChild(ctx.svg);
      ctx.wrap.appendChild(ctx.tip);
    }
    ctx.svg.setAttribute('viewBox', '0 0 ' + Math.round(ctx.lastW) + ' ' + Math.round(ctx.lastH));
    ctx.svg.setAttribute('width', Math.round(ctx.lastW));
    ctx.svg.setAttribute('height', Math.round(ctx.lastH));
  }

  function layoutFor(ctx, priced) {
    var W = ctx.lastW, H = ctx.lastH;
    var legendH = arguments.length > 2 ? arguments[2] : 0;
    var L = 48, Rp = 24, T = legendH + 12, B = 46;
    var iw = W - L - Rp, ih = H - T - B;

    var iqMin = Infinity, iqMax = -Infinity, cMin = Infinity, cMax = -Infinity;
    priced.forEach(function (m) {
      if (isNum(m.intelligence) && isNum(m.repricedCost)) {
        iqMin = Math.min(iqMin, m.intelligence);
        iqMax = Math.max(iqMax, m.intelligence);
      }
      if (isNum(m.intelligence) && isNum(m.repricedCost) && m.repricedCost > 0) {
        cMin = Math.min(cMin, m.repricedCost);
        cMax = Math.max(cMax, m.repricedCost);
      }
      if (isNum(m.aaCost) && m.aaCost > 0) {
        cMin = Math.min(cMin, m.aaCost);
        cMax = Math.max(cMax, m.aaCost);
      }
    });
    if (iqMin === Infinity) return null;
    if (cMin === Infinity) { cMin = 0.01; cMax = 1; }

    var log = RAA.state.isLogScale() && cMin > 0;
    var xLo, xHi;
    if (log) {
      xLo = Math.log10(Math.max(cMin * 0.55, 1e-9));
      xHi = Math.log10(cMax * 1.6);
    } else {
      xLo = 0;
      xHi = cMax * 1.15 || 1;
    }
    var yLo = Math.floor(iqMin - 3), yHi = Math.ceil(iqMax + 3);

    function sx(c) {
      if (log && c <= 0) return L + 2;
      var t = log ? (Math.log10(c) - xLo) / ((xHi - xLo) || 1) : (c - xLo) / ((xHi - xLo) || 1);
      return L + t * iw;
    }
    function sy(q) {
      return T + (1 - (q - yLo) / ((yHi - yLo) || 1)) * ih;
    }
    return { W: W, H: H, L: L, T: T, B: B, iw: iw, ih: ih, sx: sx, sy: sy, log: log, xLo: xLo, xHi: xHi, yLo: yLo, yHi: yHi };
  }

  function niceStep(range, maxTicks) {
    var raw = range / Math.max(1, maxTicks);
    if (raw <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return step * mag;
  }

  function trimMoney(v) {
    if (v === 0) return '0';
    if (v >= 0.1) {
      return v.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    }
    return v.toPrecision(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function drawAxes(ctx, lay, priced) {
    var s = '';
    var gridX = [], gridY = [];

    var xMid = lay.log ? Math.pow(10, (lay.xLo + lay.xHi) / 2) : (lay.xLo + lay.xHi) / 2;
    var yMid = (lay.yLo + lay.yHi) / 2;
    var qx = lay.sx(xMid), qy = lay.sy(yMid);
    s += '<rect x="' + lay.L + '" y="' + lay.T + '" width="' + (qx - lay.L).toFixed(1) +
      '" height="' + (qy - lay.T).toFixed(1) + '" fill="#34A853" fill-opacity="0.2"/>';

    var yStep = niceStep(lay.yHi - lay.yLo, 4);
    var yStart = Math.ceil(lay.yLo / yStep) * yStep;
    for (var yv = yStart; yv <= lay.yHi; yv += yStep) gridY.push(yv);

    var xTicks = [];
    if (lay.log) {
      [0.05, 0.06, 0.08, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 2, 3, 5, 8, 10, 20].forEach(function (v) {
        var lo = Math.pow(10, lay.xLo), hi = Math.pow(10, lay.xHi);
        if (v >= lo * 1.0001 && v <= hi * 0.9999) xTicks.push(v);
      });
    } else {
      var xStep = niceStep(lay.xHi - lay.xLo, 6);
      var xStart = Math.ceil(lay.xLo / xStep) * xStep;
      for (var xv2 = xStart; xv2 <= lay.xHi + 1e-9; xv2 += xStep) xTicks.push(xv2);
    }

    gridY.forEach(function (yv) {
      var yy = lay.sy(yv);
      if (yy > lay.T + 1 && yy < lay.T + lay.ih - 1) {
        s += '<text x="' + (lay.L - 9) + '" y="' + (yy + 3.5).toFixed(1) +
          '" font-size="11" fill="#737373" text-anchor="end">' + yv + '</text>';
      }
    });
    xTicks.forEach(function (xv) {
      var xx = lay.sx(xv);
      if (xx >= lay.L - 1 && xx <= lay.L + lay.iw + 1) {
        var label = '$' + trimMoney(xv);
        s += '<text x="' + xx.toFixed(1) + '" y="' + (lay.T + lay.ih + 18) +
          '" font-size="11" fill="#737373" text-anchor="middle">' + esc(label) + '</text>';
      }
    });

    var repriced = RAA.state.getSourceMode() === 'repriced';
    var xlabel = (lay.log ? 'Cost per Task (USD, Log Scale)' : 'Cost per Task (USD)') +
      (repriced ? ' \u00B7 Repriced' : '');
    s += '<text x="' + (lay.L + lay.iw / 2).toFixed(1) + '" y="' + (lay.H - 10) +
      '" font-size="12" fill="#565a61" text-anchor="middle">' + esc(xlabel) + '</text>';
    s += '<text x="14" y="' + (lay.T + lay.ih / 2).toFixed(1) + '" font-size="12" fill="#565a61" text-anchor="middle"' +
      ' transform="rotate(-90 14 ' + (lay.T + lay.ih / 2).toFixed(1) + ')">Artificial Analysis Intelligence Index</text>';
    ctx.gAxis.innerHTML = s;
  }

  function makePointNode(ctx, p, color) {
    var NS = 'http://www.w3.org/2000/svg';
    var g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'raa-pt raa-noanim' + (p.m._cached ? ' raa-cached' : ''));
    var circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('class', 'body');
    circle.setAttribute('r', '4.5');
    circle.setAttribute('fill', color);
    circle.setAttribute('stroke', '#ffffff');
    circle.setAttribute('stroke-width', '1');
    g.appendChild(circle);
    ctx.gPts.appendChild(g);
    bindTip(ctx, g, p.m.id);
    return g;
  }

  function bindTip(ctx, g, modelId) {
    function move(ev) {
      showTip(ctx, modelId, ev);
    }
    g.addEventListener('mouseenter', function (ev) { showTip(ctx, modelId, ev); });
    g.addEventListener('mousemove', move);
    g.addEventListener('mouseleave', function () {
      ctx.tip.style.display = 'none';
    });
  }

  function showTip(ctx, modelId, ev) {
    var m = ctx.dataById[modelId];
    if (!m) return;
    var profileName = ctx.profile ? ctx.profile.name : 'Artificial Analysis';
    var sav = RAA.pricing.savingsFraction(m.aaCost, m.repricedCost);
    var rows = '';
    rows += row('Intelligence Index', isNum(m.intelligence) ? m.intelligence.toFixed(1) : '?');
    rows += row('AA Cost / Task', fmtMoney(m.aaCost));
    if (RAA.state.getSourceMode() === 'repriced') {
      rows += row('Repriced Cost / Task', '<span class="rule">' + fmtMoney(m.repricedCost) + '</span>');
      rows += row('Pricing Profile', esc(profileName));
      rows += row('Rule', '<span class="rule">' + esc(m.ruleDescription) + '</span>');
      if (sav !== null) {
        rows += row('vs AA Cost', (sav >= 0 ? '\u2212' : '+') + Math.abs(Math.round(sav * 100)) + '%');
      }
    }
    ctx.tip.innerHTML = '<b>' + esc(m.label) + '</b>' + rows;
    ctx.tip.style.display = 'block';
    var wrapRect = ctx.wrap.getBoundingClientRect();
    var tx = ev.clientX - wrapRect.left + 14;
    var ty = ev.clientY - wrapRect.top + 12;
    var tw = ctx.tip.offsetWidth, th = ctx.tip.offsetHeight;
    if (tx + tw > wrapRect.width - 4) tx = ev.clientX - wrapRect.left - tw - 14;
    if (ty + th > wrapRect.height - 4) ty = ev.clientY - wrapRect.top - th - 12;
    ctx.tip.style.left = Math.max(2, tx) + 'px';
    ctx.tip.style.top = Math.max(2, ty) + 'px';
  }

  function row(k, v) {
    return '<div class="row"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
  }

  function computePriced() {
    var bundle = RAA.extract.extractModelsDetailed(document);
    var merged = RAA.registry.merge(bundle.models);
    var selectedIds = urlSelectedIds();
    if (selectedIds) {
      var wanted = {};
      selectedIds.forEach(function (id) { wanted[id] = true; });
      var filtered = merged.filter(function (m) { return wanted[m.id]; });
      if (filtered.length) merged = filtered;
    } else {
      merged = merged.filter(function (m) { return !m._cached; });
    }
    var profile = RAA.state.activePricingProfile() || aaLikeProfile('Artificial Analysis');
    return {
      priced: RAA.pricing.applyProfile(merged, profile).filter(function (m) {
        return isNum(m.intelligence) && isNum(m.repricedCost);
      }),
      profileName: profile.name,
      source: bundle.source,
      pageCoverage: bundle.coverage,
      selectedIds: selectedIds,
      knownIds: merged.map(function (m) { return m.id; }),
      incompleteIds: merged.filter(function (m) {
        return !isNum(m.intelligence) || !isNum(m.aaCost);
      }).map(function (m) { return m.id; })
    };
  }

  var fetchState = {};

  function fetchModelDetail(id) {
    root.fetch('/models/' + encodeURIComponent(id)).then(function (r) {
      return r.ok ? r.text() : null;
    }).then(function (html) {
      if (!html) { fetchState[id] = 'failed'; return; }
      var models = RAA.extract.extractFlightModelsFromHtml(html);
      if (models.length) {
        RAA.registry.upsertModels(models);
        fetchState[id] = 'done';
        renderAllBars();
      } else {
        fetchState[id] = 'failed';
      }
    }).catch(function () {
      fetchState[id] = 'failed';
    });
  }

  function maybeFetchMissing(bundle) {
    if (!bundle.selectedIds || !bundle.selectedIds.length) return;
    if (typeof root.fetch !== 'function') return;
    var selected = {};
    bundle.selectedIds.forEach(function (id) { selected[id] = true; });
    var knownOk = {};
    bundle.knownIds.forEach(function (id) { knownOk[id] = true; });
    var incomplete = {};
    (bundle.incompleteIds || []).forEach(function (id) { incomplete[id] = true; });
    var missing = bundle.selectedIds.filter(function (id) {
      if (fetchState[id] === 'pending' || fetchState[id] === 'done') return false;
      if (!knownOk[id]) return true;
      if (incomplete[id]) {
        var entry = null;
        RAA.registry.all().forEach(function (m) { if (m.id === id) entry = m; });
        return !entry || !RAA.pricing.num(entry.aaCost) || !RAA.pricing.num(entry.intelligence);
      }
      return false;
    });
    if (!missing.length) return;
    missing.forEach(function (id) { fetchState[id] = 'pending'; });
    setTimeout(function () {
      missing.forEach(fetchModelDetail);
    }, 400);
  }

  function dataSig(bundle, nativeDots, box) {
    var head = (box ? 'R' + box.w + 'x' + box.h + '@' + box.left + ',' + box.top : 'P') +
      '|' + bundle.profileName + '|' + bundle.source + '|' +
      (bundle.selectedIds ? bundle.selectedIds.join(',') : '') + '|' +
      (nativeDots == null ? '?' : nativeDots) + '|';
    return head + bundle.priced.map(function (m) {
      return m.id + ':' + m.intelligence + ':' + m.repricedCost;
    }).join(';');
  }

  function providerList(priced) {
    var internals = RAA.colors._internals;
    var seen = {};
    var items = [];
    priced.forEach(function (m) {
      var p = internals.inferProviderName(m.label, m.id) || 'Other';
      if (!seen[p]) {
        seen[p] = true;
        items.push({ name: p, color: RAA.colors.colorFor(m.label, m.id) });
      }
    });
    return items;
  }

  function buildLegend(ctx, priced) {
    var W = ctx.lastW;
    var s = '';
    var x = 2, y = 12;
    var rowH = 27;
    function need(w) {
      if (x + w > W - 8) { x = 2; y += rowH; }
    }
    need(196);
    s += '<rect x="' + x + '" y="' + y + '" width="14" height="14" rx="3" fill="#34A853" fill-opacity="0.35"/>';
    s += '<text x="' + (x + 21) + '" y="' + (y + 11.5) + '" font-size="12.5" fill="#26272b">Most attractive quadrant</text>';
    x += 196;
    need(122);
    s += '<line x1="' + (x + 2) + '" y1="' + (y + 5.5) + '" x2="' + (x + 28) + '" y2="' + (y + 5.5) +
      '" stroke="#565a61" stroke-width="2.5" stroke-dasharray="0.1 7" stroke-linecap="round"/>';
    s += '<text x="' + (x + 36) + '" y="' + (y + 11.5) + '" font-size="12.5" fill="#26272b">Pareto line</text>';
    x += 122;
    providerList(priced).forEach(function (it) {
      var w = 34 + it.name.length * 7.2 + 22;
      need(w);
      s += '<circle cx="' + (x + 6) + '" cy="' + (y + 5.5) + '" r="5.5" fill="' + it.color + '"/>';
      s += '<text x="' + (x + 17) + '" y="' + (y + 11.5) + '" font-size="12.5" fill="#26272b">' + esc(it.name) + '</text>';
      x += w;
    });
    ctx.gLgd.innerHTML = s;
    return y + rowH;
  }

  function updateProv(ctx, bundle, nativeDots) {
    if (!ctx.prov) return;
    var n = bundle.priced.length;
    var total = null;
    if (bundle.selectedIds) total = bundle.selectedIds.length;
    else if (nativeDots) total = nativeDots;
    var label = 'Repriced by RepriceAA';
    if (total && total >= n) label += ' \u00B7 <b>' + n + '</b> / ' + total + ' models';
    else label += ' \u00B7 <b>' + n + '</b> models';
    var pc = bundle.pageCoverage;
    var tip = 'Points come from data serialized into the page (' +
      (bundle.source || 'page data') + ')';
    if (pc) tip += ': ' + pc.withCost + '/' + pc.total + ' models carry an AA cost';
    if (total && total > n) {
      tip += '. The model selector currently covers ' + total +
        ' models; the rest lack usable cost data in the page payload and are hidden here.';
    }
    ctx.prov.innerHTML = label;
    ctx.prov.title = tip;
  }

  function renderOverlay(ctx, bundle) {
    RAA.colors.refresh(document);
    var priced = bundle.priced;
    ctx.profile = RAA.state.activePricingProfile() || aaLikeProfile('Artificial Analysis');
    ctx.dataById = {};
    priced.forEach(function (m) { ctx.dataById[m.id] = m; });

    updateProv(ctx, bundle, countNativeDots(ctx.anchor));

    if (!priced.length) {
      ctx.svg = null;
      ctx.wrap.innerHTML = '';
      var msg = document.createElement('div');
      msg.className = 'raa-msg';
      msg.textContent = 'No Intelligence vs Cost data found yet. RepriceAA will appear here.';
      ctx.wrap.appendChild(msg);
      return;
    }

    var legendH = buildLegend(ctx, priced);
    var lay = layoutFor(ctx, priced, legendH);
    if (!lay || ctx.lastH < legendH + 240) {
      ctx.lastH = legendH + 300;
      ctx.svg.setAttribute('viewBox', '0 0 ' + Math.round(ctx.lastW) + ' ' + Math.round(ctx.lastH));
      ctx.svg.setAttribute('width', Math.round(ctx.lastW));
      ctx.svg.setAttribute('height', Math.round(ctx.lastH));
      lay = layoutFor(ctx, priced, legendH);
    }

    drawAxes(ctx, lay, priced);

    var frontierIdx = {};
    RAA.pareto.paretoFrontierIndices(
      priced.map(function (m) { return { intelligence: m.intelligence, cost: m.repricedCost }; })
    ).forEach(function (i) { frontierIdx[i] = true; });

    var fpts = [];
    priced.forEach(function (m, i) { if (frontierIdx[i]) fpts.push(m); });
    if (fpts.length > 1) {
      ctx.path.setAttribute('d', 'M' + fpts.map(function (m) {
        return lay.sx(m.repricedCost).toFixed(1) + ',' + lay.sy(m.intelligence).toFixed(1);
      }).join(' L'));
      ctx.path.setAttribute('visibility', 'visible');
    } else {
      ctx.path.setAttribute('visibility', 'hidden');
    }

    var seen = {};
    priced.forEach(function (m) {
      seen[m.id] = true;
      var x = lay.sx(m.repricedCost), y = lay.sy(m.intelligence);
      var g = ctx.nodes[m.id];
      if (!g) {
        g = makePointNode(ctx, { m: m }, RAA.colors.colorFor(m.label, m.id));
        ctx.nodes[m.id] = g;
        applyPos(g, isNum(m.aaCost) ? lay.sx(m.aaCost) : x, y);
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            g.classList.remove('raa-noanim');
            applyPos(g, x, y);
          });
        });
      } else {
        applyPos(g, x, y);
        var body = g.querySelector('circle.body');
        if (body) body.setAttribute('fill', RAA.colors.colorFor(m.label, m.id));
      }
    });
    Object.keys(ctx.nodes).forEach(function (id) {
      if (!seen[id]) {
        ctx.nodes[id].remove();
        delete ctx.nodes[id];
      }
    });

    var polyPts = fpts.map(function (m) {
      return { x: lay.sx(m.repricedCost), y: lay.sy(m.intelligence) };
    });
    drawLabels(ctx, lay, priced, polyPts);

    ctx.prov.style.display = RAA.state.getSourceMode() === 'repriced' ? '' : 'none';
  }

  function truncateLabel(t) {
    t = String(t == null ? '' : t);
    return t.length > 30 ? t.slice(0, 29) + '\u2026' : t;
  }

  function drawLabels(ctx, lay, priced, polyPts) {
    var placed = [];
    var s = '';
    var dotBoxes = priced.map(function (m) {
      var cx = lay.sx(m.repricedCost), cy = lay.sy(m.intelligence);
      return { x1: cx - 7, y1: cy - 7, x2: cx + 7, y2: cy + 7 };
    });

    function segSeg(ax, ay, bx, by, cx2, cy2, dx, dy) {
      var d1 = (bx - ax) * (cy2 - ay) - (by - ay) * (cx2 - ax);
      var d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
      var d3 = (dx - cx2) * (ay - cy2) - (dy - cy2) * (ax - cx2);
      var d4 = (dx - cx2) * (by - cy2) - (dy - cy2) * (bx - cx2);
      return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
    }

    function segHitsRect(ax, ay, bx, by, x1, y1, x2, y2) {
      if (ax >= x1 && ax <= x2 && ay >= y1 && ay <= y2) return true;
      if (bx >= x1 && bx <= x2 && by >= y1 && by <= y2) return true;
      return segSeg(ax, ay, bx, by, x1, y1, x2, y1) ||
        segSeg(ax, ay, bx, by, x2, y1, x2, y2) ||
        segSeg(ax, ay, bx, by, x2, y2, x1, y2) ||
        segSeg(ax, ay, bx, by, x1, y2, x1, y1);
    }

    function hitsPolyline(x1, y1, x2, y2) {
      if (!polyPts || polyPts.length < 2) return false;
      for (var i = 0; i + 1 < polyPts.length; i++) {
        if (segHitsRect(polyPts[i].x, polyPts[i].y, polyPts[i + 1].x, polyPts[i + 1].y, x1, y1, x2, y2)) {
          return true;
        }
      }
      return false;
    }
    var sorted = priced.slice().sort(function (a, b) {
      var ax = lay.sx(a.repricedCost), ay = lay.sy(a.intelligence);
      var bx = lay.sx(b.repricedCost), by = lay.sy(b.intelligence);
      var da = 0, db = 0;
      priced.forEach(function (o) {
        var ox = lay.sx(o.repricedCost), oy = lay.sy(o.intelligence);
        if (Math.hypot(ox - ax, oy - ay) < 60) da++;
        if (Math.hypot(ox - bx, oy - by) < 60) db++;
      });
      if (da !== db) return db - da;
      return a.intelligence === b.intelligence
        ? a.repricedCost - b.repricedCost
        : b.intelligence - a.intelligence;
    });

    var H = 12;
    var DIRS = ['E', 'NE', 'N', 'SE', 'S', 'W', 'NW', 'SW'];
    var MAX_LEVEL = 12;

    // 8-position model: candidate box for direction dir at push level
    function candidateBox(dir, cx, cy, w, level) {
      var push = level * 13;
      var x1, y1, anchor;
      if (dir === 'E') { x1 = cx + 8 + push; y1 = cy - H / 2; anchor = 'start'; }
      else if (dir === 'NE') { x1 = cx + 7 + push * 0.7; y1 = cy - 7 - H - push * 0.7; anchor = 'start'; }
      else if (dir === 'N') { x1 = cx - w / 2; y1 = cy - 9 - H - push; anchor = 'middle'; }
      else if (dir === 'SE') { x1 = cx + 7 + push * 0.7; y1 = cy + 7 + push * 0.7; anchor = 'start'; }
      else if (dir === 'S') { x1 = cx - w / 2; y1 = cy + 9 + push; anchor = 'middle'; }
      else if (dir === 'W') { x1 = cx - 8 - w - push; y1 = cy - H / 2; anchor = 'end'; }
      else if (dir === 'NW') { x1 = cx - 7 - w - push * 0.7; y1 = cy - 7 - H - push * 0.7; anchor = 'end'; }
      else { x1 = cx - 7 - w - push * 0.7; y1 = cy + 7 + push * 0.7; anchor = 'end'; }
      return { x1: x1, y1: y1, x2: x1 + w, y2: y1 + H, anchor: anchor };
    }

    function collides(x1, y1, x2, y2) {
      for (var i = 0; i < placed.length; i++) {
        var b = placed[i];
        if (x1 < b.x2 && x2 > b.x1 && y1 < b.y2 && y2 > b.y1) return true;
      }
      for (var j = 0; j < dotBoxes.length; j++) {
        var d = dotBoxes[j];
        if (x1 < d.x2 && x2 > d.x1 && y1 < d.y2 && y2 > d.y1) return true;
      }
      if (hitsPolyline(x1 - 2, y1 - 2, x2 + 2, y2 + 2)) return true;
      return false;
    }

    function overlapsCount(x1, y1, x2, y2) {
      var n = 0;
      for (var i = 0; i < placed.length; i++) {
        var b = placed[i];
        if (x1 < b.x2 && x2 > b.x1 && y1 < b.y2 && y2 > b.y1) n++;
      }
      for (var j = 0; j < dotBoxes.length; j++) {
        var d = dotBoxes[j];
        if (x1 < d.x2 && x2 > d.x1 && y1 < d.y2 && y2 > d.y1) n++;
      }
      return n;
    }

    sorted.forEach(function (m) {
      var cx = lay.sx(m.repricedCost), cy = lay.sy(m.intelligence);
      var text = truncateLabel(m.label);
      var w = text.length * 6.1 + 4;

      var best = null, bestLevel = 0;
      for (var level = 0; level <= MAX_LEVEL && !best; level++) {
        for (var di = 0; di < DIRS.length; di++) {
          var c = candidateBox(DIRS[di], cx, cy, w, level);
          if (c.x1 < lay.L + 2 || c.x2 > lay.L + lay.iw - 1) continue;
          if (c.y1 < lay.T + 1 || c.y2 > lay.T + lay.ih - 1) continue;
          if (collides(c.x1 - 1, c.y1 - 1, c.x2 + 1, c.y2 + 1)) continue;
          best = c;
          bestLevel = level;
          break;
        }
      }

      if (!best) {
        var minOverlap = Infinity;
        for (var lv2 = 0; lv2 <= MAX_LEVEL; lv2++) {
          for (var di2 = 0; di2 < DIRS.length; di2++) {
            var c2 = candidateBox(DIRS[di2], cx, cy, w, lv2);
            if (c2.x1 < lay.L + 2 || c2.x2 > lay.L + lay.iw - 1) continue;
            if (c2.y1 < lay.T + 1 || c2.y2 > lay.T + lay.ih - 1) continue;
            var ov = overlapsCount(c2.x1, c2.y1, c2.x2, c2.y2) +
              (hitsPolyline(c2.x1 - 2, c2.y1 - 2, c2.x2 + 2, c2.y2 + 2) ? 100 : 0);
            if (ov < minOverlap) {
              minOverlap = ov;
              best = c2;
              bestLevel = lv2;
              if (ov === 0) break;
            }
          }
          if (minOverlap === 0) break;
        }
        if (minOverlap >= 100) return;
      }
      if (!best || minOverlap > 0) return;
      placed.push({ x1: best.x1, y1: best.y1, x2: best.x2, y2: best.y2 });

      var line = '';
      if (bestLevel > 0) {
        var bx = (best.x1 + best.x2) / 2, by = (best.y1 + best.y2) / 2;
        var vx = bx - cx, vy = by - cy;
        var len = Math.sqrt(vx * vx + vy * vy) || 1;
        var ux = vx / len, uy = vy / len;
        var nx = Math.max(best.x1, Math.min(cx, best.x2));
        var ny = Math.max(best.y1, Math.min(cy, best.y2));
        line = '<line x1="' + (cx + ux * 6).toFixed(1) + '" y1="' + (cy + uy * 6).toFixed(1) +
          '" x2="' + (nx - ux * 1.5).toFixed(1) + '" y2="' + (ny - uy * 1.5).toFixed(1) +
          '" stroke="#9ca3af" stroke-width="1" opacity="0.85"/>';
      }

      var tx = best.anchor === 'start' ? best.x1 : best.anchor === 'end' ? best.x2 : best.x1 + w / 2;
      var ty = best.y1 + H / 2 + 3.5;
      s += line + '<text x="' + tx.toFixed(1) + '" y="' + ty.toFixed(1) +
        '" font-size="11" fill="#404040" text-anchor="' + best.anchor + '">' +
        esc(text) + '</text>';
    });
    ctx.gLbl.innerHTML = s;
  }

  function applyPos(g, x, y) {
    g.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
  }

  function isActiveSource(stateApi) {
    return stateApi.getSourceMode() === 'repriced';
  }

  function syncVisibility(ctx) {
    ctx.anchor.classList.add('raa-integrated');
    var active = isActiveSource(RAA.state);
    if (!active) {
      if (ctx.wrap) ctx.wrap.style.display = 'none';
      if (ctx.prov) ctx.prov.style.display = 'none';
      return;
    }
    var box = measurePlot(ctx);
    var bundle = computePriced();
    maybeFetchMissing(bundle);
    var sig = dataSig(bundle, countNativeDots(ctx.anchor), box);
    if (!ctx.svg || sig !== ctx.lastSig) {
      ctx.lastSig = sig;
      ensureOverlay(ctx, box);
      renderOverlay(ctx, bundle);
    }
    if (ctx.wrap) ctx.wrap.style.display = '';
    if (ctx.prov) ctx.prov.style.display = '';
  }

  function renderAllBars() {
    pruneContexts();
    findAnchors(document).forEach(function (anchorEl) {
      var existing = false;
      contexts.forEach(function (ctx) { if (ctx.anchor === anchorEl) existing = true; });
      if (!existing) createContext(anchorEl);
    });
    contexts.forEach(function (ctx) {
      ensureCssElements(ctx);
      populateSelect(ctx.select);
      syncVisibility(ctx);
    });
    syncLauncherVisibility();
  }

  function scanAndMount() {
    renderAllBars();
  }

  var mutationsPaused = false;
  function withPausedObservation(fn) {
    mutationsPaused = true;
    try { fn(); } finally {
      setTimeout(function () { mutationsPaused = false; }, 50);
    }
  }

  function scheduleScan(delayMs) {
    if (scanTimer) return;
    scanTimer = setTimeout(function () {
      scanTimer = null;
      scanAndMount();
    }, delayMs == null ? 500 : delayMs);
  }
  var scanTimer = null;

  function syncLauncherVisibility() {
    root.dispatchEvent(new CustomEvent('repriceaa:bars-present', {
      detail: { count: contexts.length }
    }));
  }

  var mo = null;
  function observePage() {
    mo = new MutationObserver(function () {
      if (mutationsPaused) return;
      scheduleScan();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('popstate', function () { scheduleScan(100); });
  }

  RAA.state.onProfilesChanged(function () {
    renderAllBars();
  });

  root.addEventListener('repriceaa:refresh', function () {
    renderAllBars();
  });

  function start() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', start);
      return;
    }
    injectCss();
    withPausedObservation(function () { renderAllBars(); });
    observePage();
    setTimeout(function () { scheduleScan(0); }, 1500);
    setTimeout(function () { scheduleScan(0); }, 4000);
  }

  RAA.state.load().then(function () {
    return RAA.registry.load();
  }).then(function () {
    start();
  });

  RAA.integration = {
    renderAllBars: renderAllBars,
    _contexts: function () { return contexts; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
