(function (root) {
  'use strict';

  if (root.__repriceaaBooted) return;
  root.__repriceaaBooted = true;

  var RAA = root.RepriceAA;
  var pricing = RAA.pricing;
  var pareto = RAA.pareto;
  var extract = RAA.extract;
  var stateApi = RAA.state;

  var state = {
    models: [],
    allModels: [],
    sourceInfo: null,
    editing: false,
    draft: null,
    view: 'chart',
    editingFrom: 'chart',
    selectedModelId: null,
    lastSig: '',
    integratedBars: 0
  };

  var hostEl, shadowRoot, launcherEl, panelEl;

  function activeProfileOrIdentity() {
    var p = stateApi.activePricingProfile();
    if (!p) {
      return {
        id: '__identity__',
        name: 'Artificial Analysis',
        locked: true,
        defaultRule: { type: 'multiplier', value: 1 },
        rules: {},
        nameIncludes: []
      };
    }
    return p;
  }

  function pricedModels(profile) {
    return pricing.applyProfile(state.allModels, profile || activeProfileOrIdentity());
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

  function shortMoney(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '';
    var d = v >= 1 ? 2 : v >= 0.1 ? 3 : 4;
    return '$' + Number(v.toFixed(d));
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  var ANOMALY_TEXT = {
    'zero-cost': '$0 (free model or misconfig?)',
    'formula-error': 'formula error, used base price',
    'chain-loop': 'fallback chain loop',
    'no-list-price': 'no AA list price',
    'no-candidate': 'no enabled source covers this model'
  };

  function anomalySummary(anomalies) {
    if (!Array.isArray(anomalies) || !anomalies.length) return '';
    return anomalies.map(function (a) { return ANOMALY_TEXT[a] || a; }).join('; ');
  }

  function currentPriced() {
    if (stateApi.getSourceMode() === 'best') {
      return pricing.applyBest(state.allModels, stateApi.getEnabledSourceIds(), stateApi.cache.profiles);
    }
    return pricedModels(activeProfileOrIdentity());
  }

  var css = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
    '.launcher{position:fixed;right:20px;bottom:20px;z-index:2147483600;width:52px;height:52px;border-radius:50%;border:none;background:#5b21b6;color:#fff;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.35)}',
    '.launcher:hover{background:#6d28d9}',
    '.panel{position:fixed;right:20px;bottom:84px;z-index:2147483600;width:min(640px,calc(100vw - 40px));max-height:min(82vh,760px);overflow:auto;background:#fff;color:#1f2937;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.25);font-size:13px}',
    '.head{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #eef0f2}',
    '.head .dot{width:10px;height:10px;border-radius:50%;background:#5b21b6}',
    '.head h1{font-size:14px;margin:0;font-weight:700;flex:1}',
    '.body{padding:12px 16px 16px}',
    '.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}',
    '.controls select{padding:5px 8px;border-radius:6px;border:1px solid #d1d5db;background:#fff;font-size:13px;max-width:230px}',
    '.seg{display:flex;border:1px solid #d1d5db;border-radius:6px;overflow:hidden}',
    '.seg button{border:none;padding:5px 10px;background:#fff;cursor:pointer;font-size:12px;color:#374151}',
    '.seg button.on{background:#5b21b6;color:#fff}',
    '.btn{border:1px solid #d1d5db;background:#fff;color:#374151;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:12px}',
    '.btn:hover{background:#f9fafb}',
    '.btn.primary{background:#5b21b6;border-color:#5b21b6;color:#fff}',
    '.btn.primary:hover{background:#6d28d9}',
    '.btn.danger{color:#b91c1c;border-color:#fecaca}',
    '.msg{padding:24px 0;text-align:center;color:#6b7280}',
    'svg{display:block;width:100%;height:auto}',
    '.legend{display:flex;gap:16px;align-items:center;color:#6b7280;font-size:11px;margin-top:6px}',
    '.legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px}',
    '.detail{margin-top:10px;padding:10px 12px;border:1px solid #eef0f2;border-radius:8px;background:#fafafa;line-height:1.7}',
    '.detail b{font-size:13px}',
    '.kv{display:inline-block;margin-right:18px;color:#374151;font-size:12px}',
    '.kv span{color:#111827;font-weight:600}',
    '.save-pct{color:#047857;font-weight:600}',
    '.src-chip{display:inline-flex;align-items:center;font-size:12px;color:#5b21b6;background:#f5f2fc;border:1px solid #e7defa;border-radius:999px;padding:4px 10px}',
    '.data-line{color:#9ca3af;font-size:11px}',
    '.editor .row{display:flex;gap:6px;align-items:center;padding:4px 0}',
    '.editor .row .mname{flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}',
    '.editor .row.dim .mname{color:#9ca3af}',
    '.editor select,.editor input[type=number],.editor input[type=text],.editor input[type=date]{padding:4px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:12px}',
    '.editor input[type=date]{width:118px}',
    '.editor input[type=number]{width:82px}',
    '.editor input[type=text].expr{flex:1;min-width:110px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}',
    '.editor .preview{width:84px;text-align:right;color:#6b7280;font-size:12px;font-variant-numeric:tabular-nums}',
    '.editor h3,.editor h4{margin:12px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}',
    '.actions{display:flex;gap:8px;margin-top:14px;align-items:center}',
    '.headclose{border:none;background:transparent;color:#6b7280;font-size:14px;cursor:pointer;padding:2px 6px;border-radius:6px;line-height:1}',
    '.headclose:hover{background:#f3f4f6;color:#111827}',
    '.srclist{display:flex;flex-direction:column;gap:4px}',
    '.srcrow{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #eef0f2;border-radius:8px;background:#fafafa}',
    '.srcrow.dim{background:#fcfcfd}',
    '.srcname{font-size:13px;font-weight:600;color:#1f2937;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.foot{padding:8px 16px;border-top:1px solid #eef0f2;color:#9ca3af;font-size:11px}'
  ].join('\n');

  function sortedModelsForDisplay(models) {
    return models.slice().sort(function (a, b) {
      return ((isNum(b.intelligence) ? b.intelligence : -Infinity) -
              (isNum(a.intelligence) ? a.intelligence : -Infinity));
    });
  }

  function chartSvg(priced) {
    var W = 560, H = 360, L = 58, Rp = 18, T = 16, B = 46;
    var iw = W - L - Rp, ih = H - T - B;
    var pts = [];
    for (var i = 0; i < priced.length; i++) {
      var m = priced[i];
      if (isNum(m.intelligence) && isNum(m.repricedCost)) {
        pts.push({ m: m, cost: m.repricedCost });
      }
    }
    if (!pts.length) {
      return '<div class="msg">No benchmark data found on this page.</div>';
    }

    var iqMin = Infinity, iqMax = -Infinity, cMin = Infinity, cMax = -Infinity;
    pts.forEach(function (p) {
      iqMin = Math.min(iqMin, p.m.intelligence); iqMax = Math.max(iqMax, p.m.intelligence);
      cMin = Math.min(cMin, p.cost); cMax = Math.max(cMax, p.cost);
    });
    // log scale needs the smallest POSITIVE cost; zero-cost points pin to the left edge
    var cMinPositive = Infinity;
    pts.forEach(function (p) { if (p.cost > 0) cMinPositive = Math.min(cMinPositive, p.cost); });

    var log = stateApi.isLogScale() && cMinPositive > 0 && cMinPositive < Infinity;
    function sx(c) {
      if (log) {
        if (!(c > 0)) return L + 2;
        var lo = Math.log10(Math.max(cMinPositive * 0.55, 1e-9));
        var hi = Math.log10(cMax * 1.5);
        return L + ((Math.log10(c) - lo) / (hi - lo || 1)) * iw;
      }
      var lo2 = 0, hi2 = cMax * 1.15 || 1;
      return L + ((c - lo2) / (hi2 - lo2 || 1)) * iw;
    }
    function sy(q) {
      var lo = Math.floor(iqMin - 3), hi = Math.ceil(iqMax + 3);
      return T + (1 - (q - lo) / (hi - lo || 1)) * ih;
    }

    var frontierIdx = pareto.paretoFrontierIndices(
      pts.map(function (p) { return { intelligence: p.m.intelligence, cost: p.cost }; })
    );
    var onFrontier = {};
    frontierIdx.forEach(function (ix) { onFrontier[ix] = true; });

    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="RepriceAA comparison chart">';
    s += '<rect x="' + L + '" y="' + T + '" width="' + iw + '" height="' + ih + '" fill="#fcfcfd" stroke="#eef0f2"/>';

    s += '<g font-size="10" fill="#9ca3af" font-variant-numeric="tabular-nums">';
    for (var yv = Math.floor(iqMin - 3); yv <= Math.ceil(iqMax + 3); yv += 5) {
      var yy = sy(yv);
      if (yy > T + 2 && yy < T + ih - 2) {
        s += '<line x1="' + L + '" y1="' + yy + '" x2="' + (L + iw) + '" y2="' + yy + '" stroke="#eef0f2"/>';
        s += '<text x="' + (L - 6) + '" y="' + (yy + 3) + '" text-anchor="end">' + yv + '</text>';
      }
    }
    if (log) {
      var decMin = Math.floor(Math.log10(Math.max(cMin * 0.55, 1e-9)));
      var decMax = Math.ceil(Math.log10(cMax * 1.5));
      for (var d = decMin; d <= decMax; d++) {
        var v = Math.pow(10, d);
        var xx = sx(v);
        if (xx >= L && xx <= L + iw) {
          s += '<line x1="' + xx + '" y1="' + T + '" x2="' + xx + '" y2="' + (T + ih) + '" stroke="#eef0f2"/>';
          s += '<text x="' + xx + '" y="' + (H - B + 16) + '" text-anchor="middle">$' + (v >= 1 ? v : String(v).replace('0.', '.')) + '</text>';
        }
      }
    } else {
      for (var k = 0; k <= 4; k++) {
        var v2 = (cMax * 1.15 / 4) * k;
        var xx2 = sx(v2);
        s += '<line x1="' + xx2 + '" y1="' + T + '" x2="' + xx2 + '" y2="' + (T + ih) + '" stroke="#eef0f2"/>';
        s += '<text x="' + xx2 + '" y="' + (H - B + 16) + '" text-anchor="middle">' + shortMoney(v2) + '</text>';
      }
    }
    s += '</g>';

    var mode = stateApi.getSourceMode();
    var profile = activeProfileOrIdentity();
    var axisLabel = mode === 'best' ? 'Repriced Cost per Task (best of enabled sources)'
      : profile.id === '__identity__' ? 'AA Cost per Task' : 'Repriced Cost per Task';
    s += '<text x="' + (L + iw / 2) + '" y="' + (H - 8) + '" font-size="11" fill="#6b7280" text-anchor="middle">' +
      axisLabel + (log ? ' (log)' : '') + '</text>';
    s += '<text x="14" y="' + (T + ih / 2) + '" font-size="11" fill="#6b7280" text-anchor="middle" transform="rotate(-90 14 ' + (T + ih / 2) + ')">AA Intelligence Index</text>';

    var fpts = frontierIdx.map(function (ix) { return pts[ix]; });
    if (fpts.length > 1) {
      s += '<polyline fill="none" stroke="#7c3aed" stroke-width="1.5" stroke-dasharray="5 3" opacity=".7" points="' +
        fpts.map(function (p) { return sx(p.cost).toFixed(1) + ',' + sy(p.m.intelligence).toFixed(1); }).join(' ') + '"/>';
    }

    pts.forEach(function (p, ix) {
      var cx = sx(p.cost), cy = sy(p.m.intelligence);
      var f = !!onFrontier[ix];
      var sav = pricing.savingsFraction(p.m.aaCost, p.m.repricedCost);
      var tip = p.m.label +
        '\nIntelligence: ' + (isNum(p.m.intelligence) ? p.m.intelligence.toFixed(1) : '?') +
        '\nAA Cost: ' + fmtMoney(p.m.aaCost) +
        '\nRepriced: ' + fmtMoney(p.m.repricedCost);
      if (p.m.winnerSourceName) {
        tip += '\n\u2190 ' + p.m.winnerSourceName + ': ' + p.m.ruleDescription;
      } else {
        tip += '\nRule (' + profile.name + '): ' + p.m.ruleDescription;
      }
      var anom = anomalySummary(p.m.anomalies);
      if (anom) tip += '\n\u26A0 ' + anom;
      tip += (sav === null ? '' : '\nvs AA: ' + (sav >= 0 ? '-' : '+') + Math.abs(Math.round(sav * 100)) + '%');
      s += '<circle data-mid="' + esc(p.m.id) + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (f ? 5 : 4) +
        '" fill="' + (f ? '#7c3aed' : '#cbd5e1') + '"' + (p.m._cached ? ' fill-opacity=".5"' : '') +
        ' stroke="' + (state.selectedModelId === p.m.id ? '#111827' : '#fff') +
        '" stroke-width="1.5" style="cursor:pointer"><title>' + esc(tip) + '</title></circle>';
    });

    s += '</svg>';
    return s;
  }

  function detailHtml(m, profile) {
    if (!m) return '';
    var sav = pricing.savingsFraction(m.aaCost, m.repricedCost);
    var pricingLine = m.winnerSourceName
      ? '<span class="kv">Won by <span>' + esc(m.winnerSourceName) + '</span></span>' +
        '<span class="kv">Rule <span>' + esc(m.ruleDescription || '') + '</span></span>'
      : '<span class="kv">Pricing <span>' + esc(profile.name) + '</span></span>' +
        '<span class="kv">Rule <span>' + esc(m.ruleDescription) + '</span></span>';
    var candHtml = '';
    if (Array.isArray(m.candidates) && m.candidates.length > 1) {
      candHtml = '<br><span class="kv">Candidates</span>' +
        '<div style="font-size:11px;color:#6b7280;line-height:1.6">' +
        m.candidates.map(function (c) {
          return esc(c.sourceName) + ': ' + fmtMoney(c.price) +
            (c.sourceId === m.winnerSourceId ? ' \u2713' : '');
        }).join('<br>') + '</div>';
    }
    var anom = anomalySummary(m.anomalies);
    return (
      '<div class="detail"><b>' + esc(m.label) + '</b><br>' +
      '<span class="kv">Intelligence <span>' + (isNum(m.intelligence) ? m.intelligence.toFixed(1) : '?') + '</span></span>' +
      '<span class="kv">AA Cost / Task <span>' + fmtMoney(m.aaCost) + '</span></span>' +
      '<span class="kv">Repriced Cost <span>' + fmtMoney(m.repricedCost) + '</span></span><br>' +
      pricingLine +
      (sav === null ? '' :
        '<span class="save-pct">' + (sav >= 0 ? '\u2212' : '+') + Math.abs(Math.round(sav * 100)) + '% vs AA</span>') +
      (anom ? '<br><span style="color:#b45309">\u26A0 ' + esc(anom) + '</span>' : '') +
      candHtml +
      '</div>'
    );
  }

  function mainViewHtml() {
    var mode = stateApi.getSourceMode();
    var profile = activeProfileOrIdentity();
    var priced = sortedModelsForDisplay(currentPriced());

    var inPageControl = state.integratedBars > 0;
    var sourceControl;
    if (mode === 'best') {
      var boxes = stateApi.cache.profiles.filter(function (p) { return !p.locked; });
      var enabled = {};
      stateApi.getEnabledSourceIds().forEach(function (id) { enabled[id] = true; });
      var boxHtml = boxes.map(function (p) {
        return '<label style="font-size:12px;color:#374151;display:inline-flex;align-items:center;gap:3px">' +
          '<input type="checkbox" class="raa-best-src" data-sid="' + esc(p.id) + '"' +
          (enabled[p.id] ? ' checked' : '') + '> ' + esc(p.name) + '</label>';
      }).join('');
      sourceControl = '<span style="font-size:12px;color:#6b7280">Take the cheapest of:</span>' +
        (boxHtml || '<span style="font-size:12px;color:#9ca3af">no sources yet</span>');
    } else if (inPageControl) {
      sourceControl = '<span class="src-chip" title="Use the Price Source selector on the chart to switch profiles">' +
        'Source: ' + esc(profile.name) + '</span>';
    } else {
      var opts = ['<option value="__aa__"' + (mode === 'aa' ? ' selected' : '') + '>Artificial Analysis</option>'];
      opts.push('<option disabled>\u2500\u2500\u2500</option>');
      stateApi.cache.profiles.forEach(function (p) {
        opts.push('<option value="' + esc(p.id) + '"' + (stateApi.getSourceId() === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>');
      });
      sourceControl = '<select id="raa-profile">' + opts.join('') + '</select>';
    }

    var seg =
      '<div class="seg">' +
      '<button id="raa-mode-single" class="' + (mode !== 'best' ? 'on' : '') + '" title="Price everything by one source">Single</button>' +
      '<button id="raa-mode-best" class="' + (mode === 'best' ? 'on' : '') + '" title="Take the cheapest across enabled sources">Best</button>' +
      '</div>';

    var html =
      '<div class="controls">' +
      seg +
      sourceControl +
      '<label style="font-size:12px;color:#6b7280"><input type="checkbox" id="raa-log"' + (stateApi.isLogScale() ? ' checked' : '') + '> Log cost</label>' +
      '<span style="flex:1"></span>' +
      '<button class="btn primary" id="raa-manage" title="Manage price sources">⚙ Sources</button>' +
      '</div>';

    html += chartSvg(priced);

    var si = state.sourceInfo;
    var dataLine = '';
    if (si && si.coverage && si.coverage.total) {
      dataLine = '<span class="data-line">' + si.coverage.withCost + '/' + si.coverage.total +
        ' models from page (' + esc(si.source) + ')' +
        (si.indexVersion ? ' \u00B7 AA Index v' + esc(si.indexVersion) : '') +
        ', cached models dimmed</span>';
    }
    html += '<div class="legend">' +
      '<span><i style="background:#7c3aed"></i>Pareto frontier</span>' +
      '<span><i style="background:#cbd5e1"></i>Dominated</span>' +
      (dataLine ? '<span style="margin-left:auto">' + dataLine + '</span>' : '<span style="margin-left:auto">Click a point for details</span>') +
      '</div>';

    var sel = null;
    for (var i = 0; i < priced.length; i++) {
      if (priced[i].id === state.selectedModelId) sel = priced[i];
    }
    html += detailHtml(sel, profile);
    return html;
  }

  function sourceChip(p) {
    var bits = [];
    if (p.builtin) bits.push('built-in');
    if (p.kind === 'subscription') bits.push('subscription' + (isNum(p.monthlyFee) ? ' $' + p.monthlyFee + '/mo' : ''));
    if (p.basedOn) {
      var parent = null;
      stateApi.cache.profiles.forEach(function (q) { if (q.id === p.basedOn) parent = q; });
      bits.push('derived' + (parent ? ' from ' + parent.name : ''));
    }
    if (p.fallbackTo) {
      var fb = null;
      stateApi.cache.profiles.forEach(function (q) { if (q.id === p.fallbackTo) fb = q; });
      bits.push('fallback: ' + (fb ? fb.name : 'AA'));
    }
    return bits.length ? '<span style="font-size:10px;color:#8b5cf6;background:#f5f2fc;border-radius:999px;padding:1px 7px;margin-left:6px">' +
      esc(bits.join(' \u00B7 ')) + '</span>' : '';
  }

  function manageViewHtml() {
    var enabled = {};
    stateApi.getEnabledSourceIds().forEach(function (id) { enabled[id] = true; });
    var html = '<div class="controls">' +
      '<button class="btn" id="raa-back">\u2190 Back</button>' +
      '<span style="flex:1"></span>' +
      '<button class="btn primary" id="raa-new">+ New source</button>' +
      '</div>';
    html += '<div style="font-size:11px;color:#6b7280;margin:2px 0 8px">Tick a source to include it in <b>Best</b> (auto-cheapest). Built-in sources cannot be modified.</div>';
    html += '<div class="srclist">';
    stateApi.cache.profiles.forEach(function (p) {
      var locked = !!p.builtin;
      html += '<div class="srcrow' + (locked ? ' dim' : '') + '">' +
        '<input type="checkbox" class="raa-best-src" data-sid="' + esc(p.id) + '"' + (enabled[p.id] ? ' checked' : '') + '>' +
        '<span class="srcname" title="' + esc(p.id) + '">' + esc(p.name) + '</span>' +
        sourceChip(p) +
        '<span style="flex:1"></span>' +
        (!locked ? '<button class="btn" data-edit="' + esc(p.id) + '">Edit</button>' : '') +
        (!locked ? '<button class="btn danger" data-del="' + esc(p.id) + '">\u2715</button>' : '') +
        '</div>';
    });
    html += '<div class="srcrow dim">' +
      '<span style="width:14px"></span>' +
      '<span class="srcname">Artificial Analysis</span>' +
      '<span style="font-size:10px;color:#9ca3af;margin-left:6px">reference list price (always available in the source dropdown)</span>' +
      '</div>';
    html += '</div>';
    return html;
  }

  function bindManageEvents(rootEl) {
    rootEl.querySelector('#raa-back').addEventListener('click', function () {
      state.view = 'chart';
      rerender();
    });
    rootEl.querySelector('#raa-new').addEventListener('click', function () {
      enterEditor(true, 'manage');
    });
    rootEl.querySelectorAll('.raa-best-src').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var ids = stateApi.getEnabledSourceIds().slice();
        var sid = cb.getAttribute('data-sid');
        if (cb.checked) {
          if (ids.indexOf(sid) === -1) ids.push(sid);
        } else {
          ids = ids.filter(function (x) { return x !== sid; });
        }
        stateApi.setBestSources(ids);
      });
    });
    rootEl.querySelectorAll('[data-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = stateApi.getProfileById(btn.getAttribute('data-edit'));
        if (p && !p.builtin) enterEditor(false, 'manage', p);
      });
    });
    rootEl.querySelectorAll('[data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-del');
        var p = stateApi.getProfileById(id);
        if (!p || p.builtin) return;
        if (!confirm('Delete source "' + p.name + '"?')) return;
        stateApi.removeProfile(id);
        rerender();
      });
    });
  }

  function editorViewHtml() {
    var d = state.draft;
    var onPageIds = {};
    state.models.forEach(function (m) { onPageIds[m.id] = true; });

    var extraRules = Object.keys(d.rules || {}).filter(function (id) { return !onPageIds[id]; });

    function ruleRow(id, labelText, dim, rule) {
      var t = rule && rule.type ? rule.type : 'multiplier';
      var typeOpts =
        '<option value="multiplier"' + (t === 'multiplier' ? ' selected' : '') + '>\u00D7</option>' +
        '<option value="absolute"' + (t === 'absolute' ? ' selected' : '') + '>$</option>' +
        '<option value="exclude"' + (t === 'exclude' ? ' selected' : '') + '>excl</option>' +
        '<option value="formula"' + (t === 'formula' ? ' selected' : '') + '>f()</option>';
      var valInput = '';
      if (t === 'formula') {
        valInput = '<input type="text" class="expr" placeholder="aaCost*0.5" data-target="' + id + '" data-fld="expr" value="' + esc(rule && rule.expr ? rule.expr : '') + '">';
      } else if (t !== 'exclude') {
        valInput = '<input type="number" min="0" step="0.01" data-target="' + id + '" data-fld="value" value="' +
          (rule && typeof rule.value === 'number' && isFinite(rule.value) ? rule.value : (t === 'absolute' ? '0' : '1')) + '">';
      }
      return '<div class="row' + (dim ? ' dim' : '') + '">' +
        '<span class="mname" title="' + esc(labelText) + '">' + esc(labelText) + (dim ? ' \u00B7 off-page' : '') + '</span>' +
        '<select data-target="' + id + '" data-fld="type">' + typeOpts + '</select>' +
        valInput +
        '<span class="preview" data-prev="' + id + '"></span>' +
        '</div>';
    }

    var html = '<div class="editor">';

    if (d._pickTemplate) {
      var tpls = stateApi.sourceTemplates();
      html += '<h4>New source</h4><input type="text" id="raa-name" style="width:60%" maxlength="60" placeholder="Source name" value="' + esc(d.name) + '">';
      html += '<h3>Pick a template</h3>';
      tpls.forEach(function (t) {
        html += '<div class="row">' +
          '<button class="btn" data-tpl="' + esc(t.key) + '" style="min-width:170px">' + esc(t.label) + '</button>' +
          '<span style="font-size:11px;color:#9ca3af">' + esc(t.description) + '</span></div>';
      });
      html += '<div class="actions"><button class="btn" id="raa-cancel">Cancel</button></div></div>';
      return html;
    }

    html += '<h4>Source</h4><input type="text" id="raa-name" style="width:60%" maxlength="60" value="' + esc(d.name) + '">';

    if (d.kind === 'subscription') {
      var ratio = pricing.computeSubscriptionRatio(d);
      html += '<h3>Subscription</h3>';
      html += '<div class="row"><span class="mname">Monthly fee ($)</span>' +
        '<input type="number" min="0" step="1" id="raa-fee" value="' + (isNum(d.monthlyFee) ? d.monthlyFee : '') + '"></div>';
      html += '<div class="row"><span class="mname">Monthly quota (M tokens)</span>' +
        '<input type="number" min="0" step="0.1" id="raa-quota" value="' + (isNum(d.monthlyQuotaTokens) ? d.monthlyQuotaTokens / 1e6 : '') + '"></div>';
      html += '<div class="row"><span class="mname">Ref blended price ($/M)</span>' +
        '<input type="number" min="0" step="0.1" id="raa-ref" value="' + (isNum(d.refBlendedPrice) ? d.refBlendedPrice : '') + '"></div>';
      html += '<div class="row"><span class="mname">Manual ratio (overrides)</span>' +
        '<input type="number" min="0" step="0.05" id="raa-mratio" value="' + (isNum(d.manualRatio) ? d.manualRatio : '') + '"></div>';
      html += '<div class="row"><span class="mname">Ratio preview</span>' +
        '<span class="preview" id="raa-ratio-preview">' + (ratio ? pricing.trimNum(ratio) + '\u00D7' : '\u2014') + '</span></div>';
    }
    if (d.basedOn === '__pick__') {
      var parentOpts = ['<option value="">\u2014 pick parent \u2014</option>'];
      stateApi.cache.profiles.forEach(function (p) {
        if (p.id !== d.id && !p.locked) {
          parentOpts.push('<option value="' + esc(p.id) + '"' + (d.basedOnPick === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>');
        }
      });
      html += '<h3>Derived source</h3>';
      html += '<div class="row"><span class="mname">Based on</span><select id="raa-parent">' + parentOpts.join('') + '</select></div>';
    } else if (d.basedOn) {
      var parent = null;
      stateApi.cache.profiles.forEach(function (p) { if (p.id === d.basedOn) parent = p; });
      html += '<h3>Derived source</h3>' +
        '<div style="font-size:11px;color:#6b7280;margin-bottom:4px">Based on "' + esc(parent ? parent.name : d.basedOn) +
        '" \u2014 the default rule below applies on top of its price. Edit the parent to change its rules.</div>';
    }

    if (d.kind === 'subscription' || d.basedOn) {
      var fbOpts = ['<option value=""' + (!d.fallbackTo ? ' selected' : '') + '>None (AA list price)</option>'];
      stateApi.cache.profiles.forEach(function (p) {
        if (p.id !== d.id && !p.locked) {
          fbOpts.push('<option value="' + esc(p.id) + '"' + (d.fallbackTo === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>');
        }
      });
      html += '<div class="row"><span class="mname">' +
        (d.kind === 'subscription' ? 'Uncovered models fall back to' : 'Unchanged models fall back to') +
        '</span><select id="raa-fb">' + fbOpts.join('') + '</select></div>';
    }
    if (d.kind === 'subscription') {
      html += '<div style="font-size:11px;color:#6b7280;margin:2px 0 4px">Models matching a name rule below are covered by the plan; everything else falls back.</div>';
    }
    if (d.kind !== 'subscription') {
      html += '<h3>Default for all other models</h3>';
      html += ruleRow('__default__', '', false, d.defaultRule);
    }
    html += '<h3>Models (current page)</h3>';
    sortedModelsForDisplay(state.models.slice()).forEach(function (m) {
      html += ruleRow(m.id, m.label, false, (d.rules || {})[m.id]);
    });
    extraRules.forEach(function (id) {
      html += ruleRow(id, id, true, d.rules[id]);
    });

    html += '<h3>Name matches</h3>';
    var subRatio = d.kind === 'subscription' ? pricing.computeSubscriptionRatio(d) : null;
    if (d.kind === 'subscription' && subRatio !== null) {
      html += '<div style="font-size:11px;color:#047857;margin:2px 0 4px">Covered models use the amortized ratio \u00D7' +
        pricing.trimNum(subRatio) + ' (per-model values below are ignored).</div>';
    }
    (d.nameIncludes || []).forEach(function (nm, ix) {
      var t = nm.rule && nm.rule.type === 'absolute';
      var auto = subRatio !== null;
      html += '<div class="row">' +
        '<input type="text" style="flex:1" placeholder="matches part of model name / slug" data-nm="' + ix + '" data-fld="match" value="' + esc(nm.match) + '"' + (auto ? ' title="Covered models get the amortized ratio"' : '') + '>' +
        (auto
          ? '<span class="preview" style="min-width:64px;text-align:right">\u2192 \u00D7' + pricing.trimNum(subRatio) + '</span>'
          : '<select data-nm="' + ix + '" data-fld="nmType">' +
            '<option value="multiplier"' + (!t ? ' selected' : '') + '>\u00D7</option>' +
            '<option value="absolute"' + (t ? ' selected' : '') + '>$</option></select>' +
            '<input type="number" min="0" step="0.01" data-nm="' + ix + '" data-fld="nmValue" value="' + ((nm.rule && typeof nm.rule.value === 'number' && isFinite(nm.rule.value)) ? nm.rule.value : 1) + '">') +
        '<input type="date" title="Promo ends (optional)" data-nm="' + ix + '" data-fld="nmUntil" value="' + esc(nm.rule && nm.rule.until ? nm.rule.until : '') + '">' +
        '<button class="btn danger" data-delnm="' + ix + '">\u2715</button></div>';
    });
    html += '<button class="btn" id="raa-addnm" style="margin-top:4px">+ name match</button>';

    html += '<div class="actions">' +
      '<button class="btn primary" id="raa-save">Save</button>' +
      '<button class="btn" id="raa-cancel">Cancel</button>' +
      (!d.locked ? '<button class="btn danger" id="raa-delete" style="margin-left:auto">Delete source</button>' : '') +
      '</div></div>';
    return html;
  }

  function updatePreviews(rootEl) {
    var d = state.draft;
    rootEl.querySelectorAll('[data-prev]').forEach(function (el) {
      var id = el.getAttribute('data-prev');
      var model = null;
      state.models.forEach(function (m) { if (m.id === id) model = m; });
      var profileLike = { defaultRule: d.defaultRule, rules: d.rules, nameIncludes: d.nameIncludes };
      if (!model) { el.textContent = ''; return; }
      var out = pricing.priceModel(model, profileLike);
      el.textContent = fmtMoney(out.repricedCost);
    });
  }

  function bindEditorEvents(rootEl) {
    updatePreviews(rootEl);

    var nameEl = rootEl.querySelector('#raa-name');
    if (nameEl) {
      nameEl.addEventListener('input', function (e) {
        state.draft.name = e.target.value;
      });
    }

    rootEl.querySelectorAll('[data-tpl]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyTemplate(btn.getAttribute('data-tpl'));
      });
    });

    function bindNum(id, field, transform) {
      var el = rootEl.querySelector('#' + id);
      if (!el) return;
      el.addEventListener('change', function () {
        var v = parseFloat(el.value);
        state.draft[field] = isNaN(v) ? null : (transform ? transform(v) : v);
        var ratioEl = rootEl.querySelector('#raa-ratio-preview');
        if (ratioEl) {
          var ratio = pricing.computeSubscriptionRatio(state.draft);
          ratioEl.textContent = ratio ? pricing.trimNum(ratio) + '\u00D7' : '\u2014';
        }
      });
    }
    bindNum('raa-fee', 'monthlyFee');
    bindNum('raa-quota', 'monthlyQuotaTokens', function (v) { return v * 1e6; });
    bindNum('raa-ref', 'refBlendedPrice');
    bindNum('raa-mratio', 'manualRatio');

    var fbSel = rootEl.querySelector('#raa-fb');
    if (fbSel) {
      fbSel.addEventListener('change', function () {
        state.draft.fallbackTo = fbSel.value || null;
      });
    }
    var parentSel = rootEl.querySelector('#raa-parent');
    if (parentSel) {
      parentSel.addEventListener('change', function () {
        state.draft.basedOnPick = parentSel.value || null;
      });
    }

    rootEl.querySelectorAll('select[data-target]').forEach(function (el) {
      el.addEventListener('change', function () {
        setDraftRule(el.getAttribute('data-target'), 'type', el.value);
        rerender();
      });
    });
    rootEl.querySelectorAll('input[type=number][data-target]').forEach(function (el) {
      el.addEventListener('input', function () {
        setDraftRule(el.getAttribute('data-target'), 'value', parseFloat(el.value));
        updatePreviews(rootEl);
      });
    });
    rootEl.querySelectorAll('input.expr[data-target]').forEach(function (el) {
      el.addEventListener('input', function () {
        setDraftRule(el.getAttribute('data-target'), 'expr', el.value);
        updatePreviews(rootEl);
      });
    });

    rootEl.querySelectorAll('[data-nm]').forEach(function (el) {
      var handler = function () {
        var ix = Number(el.getAttribute('data-nm'));
        var fld = el.getAttribute('data-fld');
        var nm = state.draft.nameIncludes && state.draft.nameIncludes[ix];
        if (!nm) return;
        nm.rule = nm.rule || { type: 'multiplier', value: 1 };
        if (fld === 'match') {
          nm.match = el.value;
        } else if (fld === 'nmType') {
          var pv = nm.rule.value;
          nm.rule.type = el.value;
          nm.rule.value = pv != null && isFinite(pv) ? pv : (el.value === 'multiplier' ? 1 : 0);
        } else if (fld === 'nmValue') {
          var v = parseFloat(el.value);
          nm.rule.value = isNaN(v) ? nm.rule.value : Math.max(0, v);
        } else if (fld === 'nmUntil') {
          if (el.value && /^\d{4}-\d{2}-\d{2}$/.test(el.value)) nm.rule.until = el.value;
          else delete nm.rule.until;
        }
        updatePreviews(rootEl);
      };
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', handler);
    });

    rootEl.onclick = function (ev) {
      var delBtn = ev.target.closest('[data-delnm]');
      if (delBtn) {
        state.draft.nameIncludes.splice(Number(delBtn.getAttribute('data-delnm')), 1);
        rerender();
        return;
      }
      if (ev.target.closest('#raa-addnm')) {
        state.draft.nameIncludes.push({ match: '', rule: { type: 'multiplier', value: 1 } });
        rerender();
        return;
      }
      if (ev.target.closest('#raa-save')) { saveDraft(); return; }
      if (ev.target.closest('#raa-cancel')) { exitEditor(); return; }
      if (ev.target.closest('#raa-delete')) { deleteDraftProfile(); }
    };
  }

  function applyTemplate(key) {
    var tpl = null;
    stateApi.sourceTemplates().forEach(function (t) { if (t.key === key) tpl = t; });
    if (!tpl) return;
    var d = JSON.parse(JSON.stringify(tpl.profile));
    d.id = state.draft && state.draft.id ? state.draft.id : stateApi.nextFreshId();
    d.name = state.draft && state.draft.name ? state.draft.name : '';
    d.builtin = false;
    d.locked = false;
    d._pickTemplate = false;
    d.rules = d.rules || {};
    d.nameIncludes = d.nameIncludes || [];
    state.draft = d;
    rerender();
  }

  function setDraftRule(key, field, val) {
    var d = state.draft;
    if (key === '__default__') {
      var def = d.defaultRule = d.defaultRule || { type: 'multiplier', value: 1 };
      setRuleObj(def, field, val);
      return;
    }
    var tgt = d.rules[key] = d.rules[key] || {};
    setRuleObj(tgt, field, val);
  }

  function setRuleObj(obj, field, val) {
    if (field === 'type') {
      var prevValue = obj.value;
      obj.type = val;
      if (val === 'exclude') {
        delete obj.value;
        delete obj.expr;
      } else if (val === 'formula') {
        delete obj.value;
        if (typeof obj.expr !== 'string') obj.expr = 'aaCost';
      } else {
        delete obj.expr;
        obj.value = prevValue != null && isFinite(prevValue) ? prevValue : (val === 'multiplier' ? 1 : 0);
      }
      return;
    }
    if (field === 'expr') {
      obj.expr = String(val == null ? '' : val);
      return;
    }
    obj.value = isNaN(val) ? obj.value : Math.max(0, val);
  }

  function saveDraft() {
    var d = state.draft;
    if (d._pickTemplate) { alert('Pick a template first.'); return; }
    var name = (d.name || '').trim();
    if (!name) { alert('Please enter a source name.'); return; }
    if (d.basedOn === '__pick__' && !d.basedOnPick) {
      alert('Pick a parent source for this derived source.');
      return;
    }
    var clean = {
      id: d.id,
      name: name,
      builtin: !!d.builtin,
      locked: !!d.locked,
      kind: d.kind === 'subscription' ? 'subscription' : 'usage',
      defaultRule: pricing.normalizeRule(d.defaultRule),
      rules: {},
      nameIncludes: []
    };
    (d.nameIncludes || []).forEach(function (nm) {
      if (nm.match && nm.match.trim()) {
        var rule = pricing.normalizeRule(nm.rule);
        clean.nameIncludes.push({ match: nm.match.trim(), rule: rule });
      }
    });
    if (clean.kind === 'subscription') {
      clean.monthlyFee = isNum(d.monthlyFee) && d.monthlyFee > 0 ? d.monthlyFee : null;
      clean.monthlyQuotaTokens = isNum(d.monthlyQuotaTokens) && d.monthlyQuotaTokens > 0 ? d.monthlyQuotaTokens : null;
      clean.refBlendedPrice = isNum(d.refBlendedPrice) && d.refBlendedPrice > 0 ? d.refBlendedPrice : null;
      clean.manualRatio = isNum(d.manualRatio) && d.manualRatio > 0 ? d.manualRatio : null;
      clean.fallbackTo = d.fallbackTo && d.fallbackTo !== d.id ? d.fallbackTo : null;
      if (!clean.nameIncludes.length) {
        alert('Add at least one name match to mark models covered by the plan.');
        return;
      }
      if (!pricing.computeSubscriptionRatio(clean) && !clean.nameIncludes.some(function (nm) { return nm.rule.type !== 'multiplier' || nm.rule.value !== 1; })) {
        if (!confirm('The amortized ratio cannot be computed (fill monthly fee / quota / reference price, or set a manual ratio). Save anyway?')) return;
      }
    } else {
      var bo = d.basedOn === '__pick__' ? d.basedOnPick : d.basedOn;
      clean.basedOn = bo && bo !== d.id ? bo : null;
    }
    Object.keys(d.rules || {}).forEach(function (id) {
      var r = pricing.normalizeRule(d.rules[id]);
      if (!(r.type === 'multiplier' && r.value === 1)) clean.rules[id] = r;
    });
    if (!clean.builtin) {
      clean.id = clean.id || stateApi.nextFreshId();
    }
    stateApi.upsertProfile(clean);
    stateApi.setSource(clean.id);
    exitEditor();
  }

  function deleteDraftProfile() {
    var d = state.draft;
    if (!confirm('Delete source "' + d.name + '"?')) return;
    if (d.builtin) stateApi.markBuiltinDeleted(d.id);
    stateApi.removeProfile(d.id);
    exitEditor();
  }

  function enterEditor(forceNew, from, srcOverride) {
    var current = forceNew ? null : (srcOverride || stateApi.activePricingProfile());
    var src;
    if (current && !current.builtin && !current.locked) {
      src = current;
    } else {
      src = {
        id: stateApi.nextFreshId(),
        name: 'My Source',
        builtin: false,
        locked: false,
        kind: 'usage',
        defaultRule: { type: 'multiplier', value: 1 },
        rules: {},
        nameIncludes: [],
        _pickTemplate: true
      };
    }
    var d = JSON.parse(JSON.stringify(src));
    d.nameIncludes = d.nameIncludes || [];
    d.rules = d.rules || {};
    state.draft = d;
    state.editing = true;
    state.editingFrom = from || 'chart';
    state.view = 'editor';
    openPanel();
    rerender();
  }

  function exitEditor() {
    state.editing = false;
    state.draft = null;
    state.view = state.editingFrom === 'manage' ? 'manage' : 'chart';
    rerender();
  }

  function openManage() {
    state.view = 'manage';
    state.editing = false;
    state.draft = null;
    openPanel();
    rerender();
  }

  function bindMainEvents(rootEl) {
    var modeSingle = rootEl.querySelector('#raa-mode-single');
    var modeBest = rootEl.querySelector('#raa-mode-best');
    if (modeSingle) {
      modeSingle.addEventListener('click', function () {
        stateApi.setSource(stateApi.cache.activeProfileId);
      });
    }
    if (modeBest) {
      modeBest.addEventListener('click', function () {
        if (stateApi.getEnabledSourceIds().length === 0) {
          var all = stateApi.cache.profiles.filter(function (p) { return !p.locked; })
            .map(function (p) { return p.id; });
          stateApi.setBestSources(all);
        }
        stateApi.setSource('__best__');
      });
    }
    rootEl.querySelectorAll('.raa-best-src').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var ids = stateApi.getEnabledSourceIds().slice();
        var sid = cb.getAttribute('data-sid');
        if (cb.checked) {
          if (ids.indexOf(sid) === -1) ids.push(sid);
        } else {
          ids = ids.filter(function (x) { return x !== sid; });
        }
        stateApi.setBestSources(ids);
      });
    });
    var profileSelect = rootEl.querySelector('#raa-profile');
    if (profileSelect) {
      profileSelect.addEventListener('change', function (e) {
        stateApi.setSource(e.target.value);
      });
    }
    rootEl.querySelector('#raa-log').addEventListener('change', function (e) {
      stateApi.setLogScale(e.target.checked);
    });
    rootEl.querySelector('#raa-manage').addEventListener('click', function () { openManage(); });
    rootEl.querySelectorAll('circle[data-mid]').forEach(function (c) {
      c.addEventListener('click', function () {
        state.selectedModelId = c.getAttribute('data-mid');
        rerender();
      });
    });
  }

  function uiHtml() {
    var inner = renderBody();
    return (
      '<style>' + css + '</style>' +
      '<button class="launcher" title="Toggle RepriceAA">RAA</button>' +
      '<div class="panel" style="display:none">' +
      '<div class="head"><span class="dot"></span><h1>RepriceAA</h1>' +
      '<button class="btn headclose" id="raa-close" title="Close">\u2715</button></div>' +
      '<div class="body" id="raa-content">' + inner + '</div>' +
      '<div class="foot">Intelligence Index &amp; benchmarks stay Artificial Analysis\u2019s. Costs are transformed locally by your pricing sources.</div>' +
      '</div>'
    );
  }

  function buildUi() {
    hostEl = document.createElement('div');
    hostEl.id = 'repriceaa-host';
    shadowRoot = hostEl.attachShadow({ mode: 'open' });
    document.body.appendChild(hostEl);
    try {
      var remountObs = new MutationObserver(function (muts) {
        var removed = false;
        muts.forEach(function (m) {
          Array.prototype.forEach.call(m.removedNodes, function (n) {
            if (n === hostEl) removed = true;
          });
        });
        if (removed && !hostEl.isConnected) {
          console.debug('[RepriceAA] host was removed; remounting');
          (document.body || document.documentElement).appendChild(hostEl);
        }
      });
      remountObs.observe(document.documentElement, { childList: true, subtree: false });
      if (document.body) remountObs.observe(document.body, { childList: true, subtree: false });
    } catch (e) { /* ignore */ }
    shadowRoot.innerHTML = uiHtml();
    launcherEl = shadowRoot.querySelector('.launcher');
    panelEl = shadowRoot.querySelector('.panel');
    launcherEl.addEventListener('click', function () {
      stateApi.setPanelOpen(!stateApi.isPanelOpen());
      syncPanelVisibility();
    });
    var closeBtn = shadowRoot.querySelector('#raa-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        stateApi.setPanelOpen(false);
        syncPanelVisibility();
      });
    }
    syncPanelVisibility();
    syncLauncherVisibility();
    bindMainEvents(shadowRoot.querySelector('#raa-content'));
  }

  function syncPanelVisibility() {
    panelEl.style.display = stateApi.isPanelOpen() ? 'block' : 'none';
  }

  function openPanel() {
    stateApi.setPanelOpen(true);
    if (panelEl) syncPanelVisibility();
  }

  function syncLauncherVisibility() {
    if (!launcherEl) return;
    // the injected Price Source bar carries its own RepriceAA entry button on
    // chart pages; the floating launcher covers everything else
    var hide = state.integratedBars > 0;
    launcherEl.style.display = hide ? 'none' : '';
  }

  function renderBody() {
    if (state.view === 'editor' && state.editing) return editorViewHtml();
    if (state.view === 'manage' && !state.editing) return manageViewHtml();
    return mainViewHtml();
  }

  function rerender() {
    var content = shadowRoot.querySelector('#raa-content');
    if (!content) return;
    content.innerHTML = renderBody();
    if (state.editing && state.view === 'editor') bindEditorEvents(content);
    else if (state.view === 'manage') bindManageEvents(content);
    else bindMainEvents(content);
  }

  function refreshModels() {
    try {
      var bundle = extract.extractModelsDetailed(document);
      var models = bundle.models;
      var sig = models.map(function (m) { return m.id + ':' + m.intelligence + ':' + m.aaCost; }).join('|') +
        '#' + bundle.source + '#' + (bundle.indexVersion || '');
      var changed = sig !== state.lastSig;
      if (changed) {
        state.lastSig = sig;
        state.models = models;
        state.sourceInfo = { source: bundle.source, coverage: bundle.coverage, indexVersion: bundle.indexVersion };
      }
      state.allModels = RAA.registry.merge(models, bundle.indexVersion);
      return changed;
    } catch (e) {
      return false;
    }
  }

  var pendingRefresh = null;
  function scheduleRefresh() {
    if (pendingRefresh) return;
    pendingRefresh = setTimeout(function () {
      pendingRefresh = null;
      if (refreshModels()) rerender();
    }, 600);
  }

  function observePageChanges() {
    var mo = new MutationObserver(scheduleRefresh);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', scheduleRefresh);
  }

  stateApi.onProfilesChanged(function () {
    if (shadowRoot) rerender();
  });

  root.addEventListener('repriceaa:bars-present', function (ev) {
    var count = ev.detail && ev.detail.count ? ev.detail.count : 0;
    var changed = count !== state.integratedBars;
    state.integratedBars = count;
    syncLauncherVisibility();
    if (changed && shadowRoot && !state.editing) rerender();
  });

  root.addEventListener('repriceaa:open-editor', function () {
    refreshModels();
    openManage();
  });

  root.addEventListener('repriceaa:open-panel', function () {
    refreshModels();
    openPanel();
    rerender();
  });

  stateApi.load().then(function () {
    return RAA.registry.load();
  }).then(function () {
    try {
      console.debug('[RepriceAA] panel booting, models:', refreshModels() ? 'changed' : 'same');
      buildUi();
      console.debug('[RepriceAA] panel UI built');
      observePageChanges();
    } catch (e) {
      console.error('[RepriceAA] panel boot failed:', e);
    }
  }, function (err) {
    console.error('[RepriceAA] panel load rejected:', err);
  });
})(typeof window !== 'undefined' ? window : globalThis);
