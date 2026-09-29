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
    '.raa-panelbtn{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:#5b21b6;background:#f5f2fc;',
    'border:1px solid #e7defa;border-radius:8px;padding:6px 11px;cursor:pointer;line-height:1.4;transition:background .15s ease}',
    '.raa-panelbtn:hover{background:#ede7fb}',
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

  // Only task-cost charts have the units and model semantics we reprice.
  var RELEASE_ANCHOR = 'intelligence-index-vs-cost-per-intelligence-index-task-by-model-release';
  var ANCHOR_SELECTOR = '[id="intelligence-index-vs-cost-per-intelligence-index-task"], [id="intelligence-vs-cost-per-task"], [id="' + RELEASE_ANCHOR + '"]';

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
    return plot;
  }

  function measurePlot(ctx) {
    var block = findBlockEl(ctx.anchor);
    if (ro && ctx.plotEl && ctx.plotEl !== block) {
      ro.unobserve(ctx.plotEl);
      roTracked.delete(ctx.plotEl);
    }
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
      if (v === null) return null;
      var ids = v.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      return ids;
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
      isRelease: anchorEl.getAttribute('id') === RELEASE_ANCHOR,
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
      var connected = document.documentElement.contains(ctx.anchor);
      if (!connected && ro && ctx.plotEl) {
        ro.unobserve(ctx.plotEl);
        roTracked.delete(ctx.plotEl);
      }
      return connected;
    });
  }

  function ensureCssElements(ctx) {
    if (ctx.bar && !ctx.anchor.contains(ctx.bar)) ctx.bar = null;
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

      var pbtn = document.createElement('button');
      pbtn.type = 'button';
      pbtn.className = 'raa-panelbtn';
      pbtn.setAttribute('aria-label', 'Open RepriceAA sources & settings');
      pbtn.title = 'RepriceAA: manage price sources';
      pbtn.textContent = '\u2699 RepriceAA';
      pbtn.addEventListener('click', function () {
        root.dispatchEvent(new CustomEvent('repriceaa:open-panel'));
      });
      ctx.bar.appendChild(pbtn);

      ctx.select.addEventListener('change', function () {
        var v = ctx.select.value;
        if (v === '__customize__') {
          syncSelectValues();
          root.dispatchEvent(new CustomEvent('repriceaa:open-editor'));
          return;
        }
        RAA.state.setSource(v);
      });

      ctx.anchor.insertBefore(ctx.bar, ctx.anchor.firstChild);
    }
    if (!ctx.tip) {
      ctx.tip = document.createElement('div');
      ctx.tip.className = 'raa-tip';
    }
    ensureLegendHook();
  }

  var highlight = null;
  var legendHooked = false;

  function ensureLegendHook() {
    if (legendHooked) return;
    legendHooked = true;
    document.addEventListener('click', onLegendClick, true);
  }

  function onLegendClick(ev) {
    var target = ev.target;
    if (!target || !target.closest) return;
    var anchor = target.closest(ANCHOR_SELECTOR);
    if (!anchor) return;
    var btn = target.closest('button');
    if (!btn || !anchor.contains(btn)) return;
    var sws = btn.querySelectorAll('span[style*="background-color"]');
    var sw = null, m = null;
    for (var i = 0; i < sws.length; i++) {
      m = RAA.colors._internals.extractBgColor(sws[i].getAttribute('style'));
      if (m) { sw = sws[i]; break; }
    }
    if (!sw || !m) return;
    var nameEl = sw.nextElementSibling;
    var name = nameEl ? (nameEl.textContent || '').trim() : '';
    if (!name) {
      name = (btn.textContent || '').trim();
    }
    if (!name || name === 'Most attractive quadrant' || name === 'Pareto line') {
      return;
    }
    if (highlight && highlight.name === name) {
      highlight = null;
    } else {
      highlight = { name: name, color: m };
      fetchProvidersFor();
    }
    renderAllBars();
  }

  function fetchProvidersFor() {
    var selected = urlSelectedIds();
    if (!selected || !selected.length) return;
    var all = RAA.registry.all();
    var missing = selected.filter(function (id) {
      if (!fetchRetryDue(id)) return false;
      var entry = null;
      all.forEach(function (mm) { if (mm.id === id) entry = mm; });
      return entry && !entry.provider;
    });
    if (!missing.length || typeof root.fetch !== 'function') return;
    missing.forEach(function (id) { fetchState[id] = 'pending'; });
    setTimeout(function () {
      missing.forEach(fetchModelDetail);
    }, 200);
  }

  function matchesHighlight(m) {
    if (!highlight) return false;
    if (m.provider && String(m.provider).toLowerCase() === highlight.name.toLowerCase()) return true;
    if (RAA.colors._internals.inferProviderName(m.label, m.id) === highlight.name) return true;
    var c = RAA.colors._internals.normalizeCssColor(RAA.colors.colorFor(m.label, m.id, m.provider));
    return c !== null && c === highlight.color;
  }

  function isHighlighted(m) {
    return !highlight || matchesHighlight(m);
  }

  function populateSelect(select) {
    var desired = RAA.state.getSourceId();
    var opts = ['<option value="__aa__">Artificial Analysis</option>'];
    opts.push('<option value="__best__">\u2605 Auto-best (cheapest)</option>');
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
      ctx.gAxis = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      ctx.path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      ctx.path.setAttribute('fill', 'none');
      ctx.path.setAttribute('stroke', '#565a61');
      ctx.path.setAttribute('stroke-width', '2.5');
      ctx.path.setAttribute('stroke-dasharray', '0.1 7');
      ctx.path.setAttribute('stroke-linecap', 'round');
      ctx.gPts = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      ctx.gLbl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      ctx.svg.appendChild(ctx.gAxis);
      ctx.svg.appendChild(ctx.path);
      ctx.gReleases = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      ctx.svg.appendChild(ctx.gReleases);
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
      for (var exponent = Math.floor(lay.xLo); exponent <= Math.ceil(lay.xHi); exponent++) {
        [1, 2, 3, 5, 8].forEach(function (factor) {
          var v = factor * Math.pow(10, exponent);
          if (Math.log10(v) >= lay.xLo && Math.log10(v) <= lay.xHi) xTicks.push(v);
        });
      }
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
    var lastTickRight = -Infinity;
    xTicks.forEach(function (xv) {
      var xx = lay.sx(xv);
      if (xx >= lay.L - 1 && xx <= lay.L + lay.iw + 1) {
        var label = '$' + trimMoney(xv);
        var halfWidth = textWidth(label) / 2;
        if (xx - halfWidth < lastTickRight + 10) return;
        lastTickRight = xx + halfWidth;
        s += '<text x="' + xx.toFixed(1) + '" y="' + (lay.T + lay.ih + 18) +
          '" font-size="11" fill="#737373" text-anchor="middle">' + esc(label) + '</text>';
      }
    });

    var repriced = RAA.state.getSourceMode() !== 'aa';
    var xlabel = (lay.log ? 'Cost per Task (USD, Log Scale)' : 'Cost per Task (USD)') +
      (repriced ? (RAA.state.getSourceMode() === 'best' ? ' \u00B7 Repriced (Auto-best)' : ' \u00B7 Repriced') : '');
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
    var profileName = ctx.profileName || (ctx.profile ? ctx.profile.name : 'Artificial Analysis');
    var mode = ctx.mode || RAA.state.getSourceMode();
    var sav = RAA.pricing.savingsFraction(m.aaCost, m.repricedCost);
    // when no source affects this model (price == AA list price), the AA
    // original price row would just duplicate the repriced one — hide it
    var repricedBySource = !!(m.winnerSourceId || m.sourceId);
    var rows = '';
    rows += row('Intelligence Index', isNum(m.intelligence) ? m.intelligence.toFixed(1) : '?');
    if (mode === 'aa' || repricedBySource) {
      rows += row('AA Cost / Task', fmtMoney(m.aaCost));
    }
    if (mode !== 'aa') {
      rows += row('Repriced Cost / Task', '<span class="rule">' + fmtMoney(m.repricedCost) + '</span>');
      if (m.winnerSourceName) {
        rows += row('Won by', '<span class="rule">' + esc(m.winnerSourceName) + '</span>');
        rows += row('Rule', '<span class="rule">' + esc(m.ruleDescription || '') + '</span>');
      } else {
        var actualSource = m.sourceId && RAA.state.getProfileById(m.sourceId);
        rows += row('Pricing Source', esc(actualSource ? actualSource.name : 'Artificial Analysis'));
        rows += row('Rule', '<span class="rule">' + esc(m.ruleDescription) + '</span>');
      }
      if (m.estimate) {
        rows += row('Estimate', 'assumes full plan quota used');
      }
      var shownCands = (Array.isArray(m.candidates) ? m.candidates : [])
        .filter(function (c) { return !c.identity; });
      if (shownCands.length > 1) {
        rows += row('Candidates', shownCands.map(function (c) {
          return esc(c.sourceName) + ' ' + fmtMoney(c.price);
        }).join(' \u00B7 '));
      }
      var anomalyTexts = {
        'zero-cost': '$0 (free or misconfig?)',
        'formula-error': 'formula error',
        'chain-loop': 'fallback loop'
      };
      if (Array.isArray(m.anomalies) && m.anomalies.length) {
        rows += row('\u26A0', m.anomalies.map(function (a) { return anomalyTexts[a] || a; }).join('; '));
      }
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

  function nativeSelectedIds(ctx, bundle) {
    var plot = findPlotEl(ctx.anchor);
    if (!plot) return null;
    var dots = plot.querySelectorAll('[data-chart-item-id]');
    if (!dots.length) {
      var selector = ctx.anchor.querySelector('[role="combobox"]');
      return selector && /^0\s+of\s/.test((selector.textContent || '').trim()) ? [] : null;
    }
    var ids = [];
    for (var i = 0; i < dots.length; i++) {
      // AA keeps unselected comparison/preview models as quarter-opacity dots.
      // They are context, not members of the native selector's active set.
      if (dots[i].getAttribute('opacity') === '0.25') continue;
      var key = dots[i].getAttribute('data-chart-item-id');
      var id = bundle.chartIds && bundle.chartIds[key];
      // Unknown native points must not silently expand into the entire registry.
      if (id && ids.indexOf(id) === -1) ids.push(id);
    }
    return ids;
  }

  var releaseDetails = Object.create(null);
  var releaseRequests = Object.create(null);
  var releaseVersion = null;

  function releaseBundle(ctx, bundle) {
    if (releaseVersion !== bundle.indexVersion) {
      releaseVersion = bundle.indexVersion;
      releaseDetails = Object.create(null);
      releaseRequests = Object.create(null);
    }
    var data = bundle.releaseData || { models: [], releases: [] };
    var models = Object.create(null), chartIds = Object.create(null);
    data.models.forEach(function (m) { models[m.id] = m; });
    Object.keys(releaseDetails).forEach(function (id) {
      releaseDetails[id].forEach(function (m) { models[m.id] = m; });
    });
    Object.keys(models).forEach(function (id) { chartIds[models[id].chartId] = id; });
    var plot = findPlotEl(ctx.anchor);
    var dots = plot ? Array.prototype.slice.call(plot.querySelectorAll('[data-chart-item-id]')).filter(function (dot) {
      return dot.getAttribute('opacity') !== '0.25';
    }) : [];
    var groups = Object.create(null);
    dots.forEach(function (dot) {
      var m = models[chartIds[dot.getAttribute('data-chart-item-id')]];
      if (m) groups[m.releaseId] = true;
    });
    // New selections may not be in the small initialData payload. Native release
    // labels identify which public detail pages to load, never their coordinates.
    var labels = plot ? Array.prototype.map.call(plot.querySelectorAll('text'), function (el) { return el.textContent.trim(); }) : [];
    data.releases.forEach(function (release) {
      if (labels.indexOf(release.label) !== -1) groups[release.id] = true;
    });
    Object.keys(groups).forEach(function (id) {
      if (releaseDetails[id] || typeof root.fetch !== 'function') return;
      var request = releaseRequests[id];
      if (request && (request.pending || Date.now() - request.at < 60000)) return;
      var token = { pending: true, at: Date.now() };
      releaseRequests[id] = token;
      root.fetch('/models/releases/' + encodeURIComponent(id)).then(function (r) {
        if (!r.ok) throw new Error('Release detail unavailable');
        return r.text();
      }).then(function (html) {
        if (releaseRequests[id] !== token) return;
        var extracted = RAA.extract.extractReleaseDataFromHtml(html).models.filter(function (m) { return m.releaseId === id; });
        if (!extracted.length) throw new Error('Release variants unavailable');
        releaseDetails[id] = extracted;
      }).catch(function () { /* Keep the native chart visible when data is unavailable. */ }).then(function () {
        token.pending = false;
        scheduleScan(0);
      });
    });
    return {
      models: Object.keys(models).map(function (id) { return models[id]; }), chartIds: chartIds,
      loading: dots.some(function (dot) { return !chartIds[dot.getAttribute('data-chart-item-id')]; })
    };
  }

  function computePriced(ctx) {
    var bundle = RAA.extract.extractModelsDetailed(document);
    var release = ctx.isRelease ? releaseBundle(ctx, bundle) : null;
    var merged = release ? release.models : RAA.registry.merge(bundle.models, bundle.indexVersion);
    var selectedIds = nativeSelectedIds(ctx, release || bundle);
    if (selectedIds === null) selectedIds = release ? [] : urlSelectedIds();
    if (selectedIds) {
      var wanted = {};
      selectedIds.forEach(function (id) { wanted[id] = true; });
      var filtered = merged.filter(function (m) { return wanted[m.id]; });
      merged = filtered;
    } else {
      merged = merged.filter(function (m) { return !m._cached; });
    }
    var mode = RAA.state.getSourceMode();
    var profile = RAA.state.activePricingProfile() || aaLikeProfile('Artificial Analysis');
    var priced, profileName;
    if (mode === 'best') {
      var enabledIds = RAA.state.getEnabledSourceIds();
      priced = RAA.pricing.applyBest(merged, enabledIds, RAA.state.cache.profiles);
      profileName = 'Auto-best (' + enabledIds.length + ' source' + (enabledIds.length === 1 ? '' : 's') + ')';
    } else if (mode === 'repriced') {
      // Single-source mode must use the same resolver as Auto-best: applyProfile
      // is the legacy path and skips coverage/fallbackTo/basedOn/promos/until.
      priced = RAA.pricing.applySource(merged, profile, RAA.state.cache.profiles);
      profileName = profile.name;
    } else {
      priced = RAA.pricing.applyProfile(merged, profile);
      profileName = profile.name;
    }
    var finalPriced = priced.filter(function (m) {
      return isNum(m.intelligence) && isNum(m.repricedCost);
    });
    var shownIds = {};
    finalPriced.forEach(function (m) { shownIds[m.id] = true; });
    var hidden = [];
    (selectedIds || merged.map(function (m) { return m.id; })).forEach(function (id) {
      if (shownIds[id]) return;
      var mm = null;
      merged.forEach(function (x) { if (x.id === id) mm = x; });
      hidden.push({
        id: id,
        label: (mm && mm.label) || id,
        incomplete: !mm || !isNum(mm.intelligence) || !isNum(mm.aaCost)
      });
    });
    return {
      loading: release && release.loading,
      priced: finalPriced,
      profileName: profileName,
      mode: mode,
      source: bundle.source,
      pageCoverage: bundle.coverage,
      selectedIds: selectedIds,
      knownIds: merged.map(function (m) { return m.id; }),
      incompleteIds: merged.filter(function (m) {
        return !isNum(m.intelligence) || !isNum(m.aaCost);
      }).map(function (m) { return m.id; }),
      hidden: hidden
    };
  }

  var fetchState = {};
  var fetchFailAt = {};
  var FETCH_RETRY_MS = 60000;

  function fetchRetryDue(id) {
    if (fetchState[id] === 'pending' || fetchState[id] === 'done') return false;
    if (fetchState[id] === 'failed' && Date.now() - (fetchFailAt[id] || 0) < FETCH_RETRY_MS) return false;
    return true;
  }

  function fetchModelDetail(id) {
    root.fetch('/models/' + encodeURIComponent(id)).then(function (r) {
      return r.ok ? r.text() : null;
    }).then(function (html) {
      if (!html) { fetchState[id] = 'failed'; fetchFailAt[id] = Date.now(); return; }
      var models = RAA.extract.extractFlightModelsFromHtml(html);
      var target = null;
      models.forEach(function (mm) { if (mm.id === id) target = mm; });
      if (target && isNum(target.aaCost) && isNum(target.intelligence)) {
        RAA.registry.upsertModels([target], RAA.extract.extractIndexVersionFromText(html));
        fetchState[id] = 'done';
        renderAllBars();
      } else {
        fetchState[id] = 'failed';
        fetchFailAt[id] = Date.now();
      }
    }).catch(function () {
      fetchState[id] = 'failed';
      fetchFailAt[id] = Date.now();
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
      if (!fetchRetryDue(id)) return false;
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
      '|' + RAA.state.isLogScale() + '|' + bundle.mode + '|' + bundle.profileName + '|' + bundle.source + '|' +
      (bundle.selectedIds ? bundle.selectedIds.join(',') : '') + '|' +
      (nativeDots == null ? '?' : nativeDots) + '|' +
      (highlight ? highlight.name : '') + '|';
    return head + bundle.priced.map(function (m) {
      return JSON.stringify(m);
    }).join(';');
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
    if (highlight) {
      var hits = bundle.priced.filter(matchesHighlight).length;
      label += ' \u00B7 highlighting ' + esc(highlight.name) + ' (' + hits + ')';
    }
    var pc = bundle.pageCoverage;
    var tip = 'Points come from data serialized into the page (' +
      (bundle.source || 'page data') + ')';
    if (pc) tip += ': ' + pc.withCost + '/' + pc.total + ' models carry an AA cost';
    if (bundle.hidden && bundle.hidden.length) {
      var names = bundle.hidden.slice(0, 12).map(function (h) {
        return '\u00B7 ' + h.label + (h.incomplete ? ' (no usable cost/intelligence data)' : '');
      });
      if (bundle.hidden.length > 12) {
        names.push('\u00B7 \u2026 and ' + (bundle.hidden.length - 12) + ' more');
      }
      tip += '\nNot repriced / not shown here (' + bundle.hidden.length + '):\n' + names.join('\n');
    } else if (total && total > n) {
      tip += '. The model selector currently covers ' + total +
        ' models; the rest lack usable cost data in the page payload and are hidden here.';
    }
    if (highlight) {
      tip += '. Clicking the highlighted legend entry again clears the highlight.';
    }
    if (ctx._provLabel !== label) {
      ctx.prov.innerHTML = label;
      ctx._provLabel = label;
    }
    if (ctx._provTip !== tip) {
      ctx.prov.title = tip;
      ctx._provTip = tip;
    }
  }

  function renderOverlay(ctx, bundle) {
    RAA.colors.refresh(document);
    var priced = bundle.priced;
    ctx.profile = RAA.state.activePricingProfile() || aaLikeProfile('Artificial Analysis');
    ctx.profileName = bundle.profileName;
    ctx.mode = bundle.mode;
    ctx.dataById = {};
    priced.forEach(function (m) { ctx.dataById[m.id] = m; });

    if (!priced.length) {
      ctx.svg = null;
      ctx.wrap.innerHTML = '';
      var msg = document.createElement('div');
      msg.className = 'raa-msg';
      msg.textContent = 'No Intelligence vs Cost data found yet. RepriceAA will appear here.';
      ctx.wrap.appendChild(msg);
      return;
    }

    var lay = layoutFor(ctx, priced);
    if (!lay || ctx.lastH < 240) {
      ctx.lastH = 300;
      ctx.svg.setAttribute('viewBox', '0 0 ' + Math.round(ctx.lastW) + ' ' + Math.round(ctx.lastH));
      ctx.svg.setAttribute('width', Math.round(ctx.lastW));
      ctx.svg.setAttribute('height', Math.round(ctx.lastH));
      lay = layoutFor(ctx, priced);
    }

    drawAxes(ctx, lay, priced);

    var groups = Object.create(null);
    if (ctx.isRelease) priced.forEach(function (m) {
      (groups[m.releaseId] || (groups[m.releaseId] = [])).push(m);
    });
    ctx.gReleases.innerHTML = Object.keys(groups).map(function (id) {
      var points = groups[id].slice().sort(function (a, b) {
        return a.aaCost - b.aaCost || a.intelligence - b.intelligence;
      });
      if (points.length < 2) return '';
      return '<path fill="none" stroke="' + esc(RAA.colors.colorFor(points[0].label, points[0].id, points[0].provider)) +
        '" stroke-width="1.5" opacity="' + (isHighlighted(points[0]) ? '1' : '0.15') + '" d="M' + points.map(function (m) {
          return lay.sx(m.repricedCost).toFixed(1) + ',' + lay.sy(m.intelligence).toFixed(1);
        }).join(' L') + '"/>';
    }).join('');

    var frontierIdx = {};
    RAA.pareto.paretoFrontierIndices(
      priced.map(function (m) { return { intelligence: m.intelligence, cost: m.repricedCost }; })
    ).forEach(function (i) { frontierIdx[i] = true; });

    var fpts = [];
    priced.forEach(function (m, i) { if (frontierIdx[i]) fpts.push(m); });
    fpts.sort(function (a, b) { return a.repricedCost - b.repricedCost; });
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
      var dim = !isHighlighted(m);
      var g = ctx.nodes[m.id];
      if (!g) {
        g = makePointNode(ctx, { m: m }, RAA.colors.colorFor(m.label, m.id, m.provider));
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
        if (body) body.setAttribute('fill', RAA.colors.colorFor(m.label, m.id, m.provider));
      }
      g.setAttribute('opacity', dim ? '0.15' : '1');
      if (body) body.setAttribute('r', dim ? '4.5' : '5');
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
    var segments = [];
    function addSegments(points) {
      for (var i = 1; i < points.length; i++) segments.push([points[i - 1], points[i]]);
    }
    addSegments(polyPts);
    Object.keys(groups).forEach(function (id) {
      addSegments(groups[id].slice().sort(function (a, b) {
        return a.aaCost - b.aaCost || a.intelligence - b.intelligence;
      }).map(function (m) { return { x: lay.sx(m.repricedCost), y: lay.sy(m.intelligence) }; }));
    });
    var labels = priced;
    if (ctx.isRelease) labels = Object.keys(groups).map(function (id) {
      var representative = groups[id].slice().sort(function (a, b) {
        return b.intelligence - a.intelligence || a.repricedCost - b.repricedCost || a.id.localeCompare(b.id);
      })[0];
      return Object.assign({}, representative, { label: representative.releaseLabel || representative.label });
    });
    drawLabels(ctx, lay, priced, segments, labels);

    ctx.prov.style.display = RAA.state.getSourceMode() !== 'aa' ? '' : 'none';
  }

  var labelCanvas;
  function textWidth(text) {
    if (!labelCanvas) {
      var canvas = document.createElement('canvas');
      labelCanvas = canvas.getContext ? canvas.getContext('2d') : null;
    }
    if (!labelCanvas) return text.length * 6.1;
    labelCanvas.font = '11px Arial, sans-serif';
    return labelCanvas.measureText(text).width;
  }

  function drawLabels(ctx, lay, priced, segments, labels) {
    var placed = [], leaders = [], markup = '';
    var H = 12, GAP = 8, MAX_LEADER = 48;
    var dots = priced.map(function (m) {
      return { id: m.id, x: lay.sx(m.repricedCost), y: lay.sy(m.intelligence) };
    });
    function overlaps(a, b) {
      return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
    }
    function crosses(a, b, c, d) {
      function side(p, q, r) { return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x); }
      return side(a, b, c) * side(a, b, d) < -0.001 && side(c, d, a) * side(c, d, b) < -0.001;
    }
    function hitsBox(a, b, box) {
      // Liang-Barsky also handles horizontal, vertical and collinear segments.
      var lo = 0, hi = 1, dx = b.x - a.x, dy = b.y - a.y;
      var p = [-dx, dx, -dy, dy], q = [a.x - box.x1, box.x2 - a.x, a.y - box.y1, box.y2 - a.y];
      for (var i = 0; i < 4; i++) {
        if (Math.abs(p[i]) < 1e-8) { if (q[i] < 0) return false; }
        else if (p[i] < 0) lo = Math.max(lo, q[i] / p[i]);
        else hi = Math.min(hi, q[i] / p[i]);
        if (lo > hi) return false;
      }
      return true;
    }
    function dotBox(dot, radius) {
      return { x1: dot.x - radius, y1: dot.y - radius, x2: dot.x + radius, y2: dot.y + radius };
    }
    // Give highlighted and high-scoring labels first choice. Stable IDs break ties
    // so a source change does not arbitrarily reshuffle equally placed labels.
    labels.slice().sort(function (a, b) {
      return Number(isHighlighted(b)) - Number(isHighlighted(a)) || b.intelligence - a.intelligence || a.id.localeCompare(b.id);
    }).forEach(function (m) {
      var point = { x: lay.sx(m.repricedCost), y: lay.sy(m.intelligence) };
      var text = String(m.label || m.id), width = textWidth(text);
      var maxWidth = Math.max(40, lay.iw - 16);
      while (width > maxWidth && text.length > 4) {
        text = text.replace(/\u2026$/, '').slice(0, -1) + '\u2026';
        width = textWidth(text);
      }
      var candidates = [];
      // Prefer the native compact placements beside the dot; expand only locally.
      [0, 10, 20, 32].forEach(function (push) {
        var gap = GAP + push;
        [[point.x + gap, point.y - H / 2],
          [point.x + gap, point.y - H - gap],
          [point.x + gap, point.y + gap],
          [point.x - width - gap, point.y - H / 2],
          [point.x - width / 2, point.y - H - gap],
          [point.x - width / 2, point.y + gap],
          [point.x - width - gap, point.y - H - gap],
          [point.x - width - gap, point.y + gap]].forEach(function (xy, direction) {
          var box = { x1: xy[0] - 2, y1: xy[1] - 2, x2: xy[0] + width + 2, y2: xy[1] + H + 2 };
          if (box.x1 < lay.L || box.x2 > lay.L + lay.iw || box.y1 < lay.T || box.y2 > lay.T + lay.ih) return;
          if (placed.some(function (b) { return overlaps(box, b); })) return;
          if (dots.some(function (dot) { return overlaps(box, dotBox(dot, 6)); })) return;
          if (segments.concat(leaders).some(function (seg) { return hitsBox(seg[0], seg[1], box); })) return;
          var end = { x: Math.max(box.x1, Math.min(point.x, box.x2)), y: Math.max(box.y1, Math.min(point.y, box.y2)) };
          var dx = end.x - point.x, dy = end.y - point.y;
          var distance = Math.sqrt(dx * dx + dy * dy);
          if (distance > MAX_LEADER) return;
          var start = { x: point.x + dx / distance * 6, y: point.y + dy / distance * 6 };
          var leader = distance > 12 ? [start, end] : null;
          if (leader) {
            if (placed.some(function (b) { return hitsBox(start, end, b); })) return;
            if (dots.some(function (dot) { return dot.id !== m.id && hitsBox(start, end, dotBox(dot, 5)); })) return;
            if (segments.concat(leaders).some(function (seg) { return crosses(start, end, seg[0], seg[1]); })) return;
          }
          candidates.push({ box: box, x: xy[0], y: xy[1], leader: leader, score: distance + direction * 0.5 });
        });
      });
      candidates.sort(function (a, b) { return a.score - b.score; });
      var best = candidates[0];
      // Dense charts may omit a label, but all points keep their full tooltip.
      if (!best) return;
      placed.push(best.box);
      var opacity = isHighlighted(m) ? 1 : 0.2;
      if (best.leader) {
        leaders.push(best.leader);
        markup += '<line x1="' + best.leader[0].x.toFixed(1) + '" y1="' + best.leader[0].y.toFixed(1) +
          '" x2="' + best.leader[1].x.toFixed(1) + '" y2="' + best.leader[1].y.toFixed(1) +
          '" stroke="rgba(0,0,0,0.2)" stroke-width="1" opacity="' + opacity + '"/>';
      }
      markup += '<text data-model-id="' + esc(m.id) + '" x="' + best.x.toFixed(1) + '" y="' +
        (best.y + 9).toFixed(1) + '" font-family="Arial, sans-serif" font-size="11" font-weight="400"' +
        ' fill="rgba(0,0,0,0.75)" stroke="white" stroke-width="3" stroke-linejoin="round" paint-order="stroke"' +
        ' opacity="' + opacity + '">' + esc(text) + '</text>';
    });
    ctx.gLbl.innerHTML = markup;
  }

  function applyPos(g, x, y) {
    g.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
  }

  function isActiveSource(stateApi) {
    return stateApi.getSourceMode() !== 'aa';
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
    if (!box) {
      if (ctx.wrap) ctx.wrap.style.display = 'none';
      return;
    }
    var bundle = computePriced(ctx);
    if (!ctx.isRelease) maybeFetchMissing(bundle);
    if (bundle.loading) {
      if (ctx.wrap) ctx.wrap.style.display = 'none';
      ctx.prov.textContent = 'Release variants unavailable or loading · showing original AA chart';
      ctx.prov.style.display = '';
      ctx._provLabel = null;
      ctx.lastSig = '';
      return;
    }
    // refresh the badge on every scan: at page launch the native chart and the
    // async model-detail fetches land late, so the a/b counts must self-update
    updateProv(ctx, bundle, countNativeDots(ctx.anchor));
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
    mo = new MutationObserver(function (records) {
      var relevant = records.some(function (r) {
        var el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        return !el || !el.closest || !el.closest('.raa-bar, .raa-chartwrap, #repriceaa-host');
      });
      if (relevant) scheduleScan(120);
    });
    mo.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['data-chart-item-id', 'opacity', 'aria-selected', 'aria-checked']
    });
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
    renderAllBars();
    observePage();
    setTimeout(function () { scheduleScan(0); }, 1500);
    setTimeout(function () { scheduleScan(0); }, 4000);
  }

  RAA.state.load().then(function () {
    return RAA.registry.load();
  }).then(function () {
    start();
    // Non-blocking preset freshness check: on success applyRemoteSources
    // re-seeds state and notifies listeners, so charts re-render with the
    // updated ratios; on failure nothing changes (bundled snapshot stays).
    if (!root.__RAA_DISABLE_REMOTE__ && RAA.remotesources && RAA.remotesources.maybeRefresh) {
      RAA.remotesources.maybeRefresh().catch(function () { });
    }
  });

  RAA.integration = {
    renderAllBars: renderAllBars,
    _contexts: function () { return contexts; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
