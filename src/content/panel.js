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
    '.editor select,.editor input[type=number],.editor input[type=text]{padding:4px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:12px}',
    '.editor input[type=number]{width:82px}',
    '.editor .preview{width:84px;text-align:right;color:#6b7280;font-size:12px;font-variant-numeric:tabular-nums}',
    '.editor h3,.editor h4{margin:12px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}',
    '.actions{display:flex;gap:8px;margin-top:14px;align-items:center}',
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

    var log = stateApi.isLogScale() && cMin > 0;
    function sx(c) {
      if (log) {
        var lo = Math.log10(Math.max(cMin * 0.55, 1e-9));
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

    var profile = activeProfileOrIdentity();
    s += '<text x="' + (L + iw / 2) + '" y="' + (H - 8) + '" font-size="11" fill="#6b7280" text-anchor="middle">' +
      (profile.id === '__identity__' ? 'AA Cost per Task' : 'Repriced Cost per Task') +
      (log ? ' (log)' : '') + '</text>';
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
        '\nRule (' + profile.name + '): ' + p.m.ruleDescription +
        '\nRepriced: ' + fmtMoney(p.m.repricedCost) +
        (sav === null ? '' : '\nvs AA: ' + (sav >= 0 ? '-' : '+') + Math.abs(Math.round(sav * 100)) + '%');
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
    return (
      '<div class="detail"><b>' + esc(m.label) + '</b><br>' +
      '<span class="kv">Intelligence <span>' + (isNum(m.intelligence) ? m.intelligence.toFixed(1) : '?') + '</span></span>' +
      '<span class="kv">AA Cost / Task <span>' + fmtMoney(m.aaCost) + '</span></span>' +
      '<span class="kv">Repriced Cost <span>' + fmtMoney(m.repricedCost) + '</span></span><br>' +
      '<span class="kv">Pricing <span>' + esc(profile.name) + '</span></span>' +
      '<span class="kv">Rule <span>' + esc(m.ruleDescription) + '</span></span>' +
      (sav === null ? '' :
        '<span class="save-pct">' + (sav >= 0 ? '\u2212' : '+') + Math.abs(Math.round(sav * 100)) + '% vs AA</span>') +
      '</div>'
    );
  }

  function mainViewHtml() {
    var profile = activeProfileOrIdentity();
    var priced = sortedModelsForDisplay(pricedModels(profile));

    var inPageControl = state.integratedBars > 0;
    var sourceControl;
    if (inPageControl) {
      sourceControl = '<span class="src-chip" title="Use the Price Source selector on the chart to switch profiles">' +
        'Source: ' + esc(profile.name) + '</span>';
    } else {
      var opts = ['<option value="__aa__"' + (stateApi.getSourceMode() === 'aa' ? ' selected' : '') + '>Artificial Analysis</option>'];
      opts.push('<option disabled>\u2500\u2500\u2500</option>');
      stateApi.cache.profiles.forEach(function (p) {
        opts.push('<option value="' + esc(p.id) + '"' + (stateApi.getSourceId() === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>');
      });
      sourceControl = '<select id="raa-profile">' + opts.join('') + '</select>';
    }

    var html =
      '<div class="controls">' +
      sourceControl +
      '<label style="font-size:12px;color:#6b7280"><input type="checkbox" id="raa-log"' + (stateApi.isLogScale() ? ' checked' : '') + '> Log cost</label>' +
      '<span style="flex:1"></span>' +
      '<button class="btn primary" id="raa-customize">Customize</button>' +
      '</div>';

    html += chartSvg(priced);

    var si = state.sourceInfo;
    var dataLine = '';
    if (si && si.coverage && si.coverage.total) {
      dataLine = '<span class="data-line">' + si.coverage.withCost + '/' + si.coverage.total +
        ' models from page (' + esc(si.source) + '), cached models dimmed</span>';
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

  function editorViewHtml() {
    var d = state.draft;
    var onPageIds = {};
    state.models.forEach(function (m) { onPageIds[m.id] = true; });

    var extraRules = Object.keys(d.rules || {}).filter(function (id) { return !onPageIds[id]; });

    function ruleRow(id, labelText, dim, rule) {
      var mult = !(rule && rule.type === 'absolute');
      return '<div class="row' + (dim ? ' dim' : '') + '">' +
        '<span class="mname" title="' + esc(labelText) + '">' + esc(labelText) + (dim ? ' \u00B7 off-page' : '') + '</span>' +
        '<select data-target="' + id + '" data-fld="type">' +
        '<option value="multiplier"' + (mult ? ' selected' : '') + '>\u00D7</option>' +
        '<option value="absolute"' + (!mult ? ' selected' : '') + '>$</option></select>' +
        '<input type="number" min="0" step="0.01" data-target="' + id + '" data-fld="value" value="' +
        (rule && typeof rule.value === 'number' && isFinite(rule.value) ? rule.value : (mult ? '1' : '0')) + '">' +
        '<span class="preview" data-prev="' + id + '"></span>' +
        '</div>';
    }

    var html = '<div class="editor">';
    html += '<h4>Profile</h4><input type="text" id="raa-name" style="width:60%" maxlength="60" value="' + esc(d.name) + '">';
    html += '<h3>Default for all other models</h3>';
    html += ruleRow('__default__', '', false, d.defaultRule);
    html += '<h3>Models (current page)</h3>';
    sortedModelsForDisplay(state.models.slice()).forEach(function (m) {
      html += ruleRow(m.id, m.label, false, (d.rules || {})[m.id]);
    });
    extraRules.forEach(function (id) {
      html += ruleRow(id, id, true, d.rules[id]);
    });

    html += '<h3>Name matches</h3>';
    (d.nameIncludes || []).forEach(function (nm, ix) {
      var t = nm.rule && nm.rule.type === 'absolute';
      html += '<div class="row">' +
        '<input type="text" style="flex:1" placeholder="matches part of model name / slug" data-nm="' + ix + '" data-fld="match" value="' + esc(nm.match) + '">' +
        '<select data-nm="' + ix + '" data-fld="nmType">' +
        '<option value="multiplier"' + (!t ? ' selected' : '') + '>\u00D7</option>' +
        '<option value="absolute"' + (t ? ' selected' : '') + '>$</option></select>' +
        '<input type="number" min="0" step="0.01" data-nm="' + ix + '" data-fld="nmValue" value="' + ((nm.rule && typeof nm.rule.value === 'number' && isFinite(nm.rule.value)) ? nm.rule.value : 1) + '">' +
        '<button class="btn danger" data-delnm="' + ix + '">\u2715</button></div>';
    });
    html += '<button class="btn" id="raa-addnm" style="margin-top:4px">+ name match</button>';

    html += '<div class="actions">' +
      '<button class="btn primary" id="raa-save">Save</button>' +
      '<button class="btn" id="raa-cancel">Cancel</button>' +
      (!d.locked ? '<button class="btn danger" id="raa-delete" style="margin-left:auto">Delete profile</button>' : '') +
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

    rootEl.querySelector('#raa-name').addEventListener('input', function (e) {
      state.draft.name = e.target.value;
    });

    rootEl.querySelectorAll('select[data-target]').forEach(function (el) {
      el.addEventListener('change', function () {
        setDraftRule(el.getAttribute('data-target'), 'type', el.value);
        updatePreviews(rootEl);
      });
    });
    rootEl.querySelectorAll('input[type=number][data-target]').forEach(function (el) {
      el.addEventListener('input', function () {
        setDraftRule(el.getAttribute('data-target'), 'value', parseFloat(el.value));
        updatePreviews(rootEl);
      });
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

  function setDraftRule(key, field, val) {
    var d = state.draft;
    if (key === '__default__') {
      var def = d.defaultRule;
      if (field === 'type') {
        var pv = def.value;
        def.type = val;
        def.value = pv != null && isFinite(pv) ? pv : (val === 'multiplier' ? 1 : 0);
      } else {
        def.value = isNaN(val) ? def.value : Math.max(0, val);
      }
      return;
    }
    var tgt = d.rules[key] = d.rules[key] || {};
    if (field === 'type') {
      var prevValue = tgt.value;
      tgt.type = val;
      tgt.value = prevValue != null && isFinite(prevValue) ? prevValue : (val === 'multiplier' ? 1 : 0);
    } else {
      tgt.value = isNaN(val) ? tgt.value : Math.max(0, val);
    }
  }

  function saveDraft() {
    var d = state.draft;
    var name = (d.name || '').trim();
    if (!name) { alert('Please enter a profile name.'); return; }
    var clean = {
      id: d.id,
      name: name,
      builtin: !!d.builtin,
      locked: !!d.locked,
      defaultRule: pricing.normalizeRule(d.defaultRule),
      rules: {},
      nameIncludes: []
    };
    Object.keys(d.rules || {}).forEach(function (id) {
      var r = pricing.normalizeRule(d.rules[id]);
      if (!(r.type === 'multiplier' && r.value === 1)) clean.rules[id] = r;
    });
    (d.nameIncludes || []).forEach(function (nm) {
      if (nm.match && nm.match.trim()) {
        clean.nameIncludes.push({ match: nm.match.trim(), rule: pricing.normalizeRule(nm.rule) });
      }
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
    if (!confirm('Delete profile "' + d.name + '"?')) return;
    if (d.builtin) stateApi.markBuiltinDeleted(d.id);
    stateApi.removeProfile(d.id);
    exitEditor();
  }

  function enterEditor() {
    var current = stateApi.activePricingProfile();
    var src;
    if (current && !current.locked) {
      src = current;
    } else {
      src = {
        id: stateApi.nextFreshId(),
        name: 'My Pricing',
        builtin: false,
        locked: false,
        defaultRule: { type: 'multiplier', value: 1 },
        rules: {},
        nameIncludes: []
      };
    }
    var d = JSON.parse(JSON.stringify(src));
    d.nameIncludes = d.nameIncludes || [];
    d.rules = d.rules || {};
    state.draft = d;
    state.editing = true;
    openPanel();
    rerender();
  }

  function exitEditor() {
    state.editing = false;
    state.draft = null;
    rerender();
  }

  function bindMainEvents(rootEl) {
    var profileSelect = rootEl.querySelector('#raa-profile');
    if (profileSelect) {
      profileSelect.addEventListener('change', function (e) {
        stateApi.setSource(e.target.value);
      });
    }
    rootEl.querySelector('#raa-log').addEventListener('change', function (e) {
      stateApi.setLogScale(e.target.checked);
    });
    rootEl.querySelector('#raa-customize').addEventListener('click', function () { enterEditor(); });
    rootEl.querySelectorAll('circle[data-mid]').forEach(function (c) {
      c.addEventListener('click', function () {
        state.selectedModelId = c.getAttribute('data-mid');
        rerender();
      });
    });
  }

  function uiHtml() {
    var inner = state.editing ? editorViewHtml() : mainViewHtml();
    return (
      '<style>' + css + '</style>' +
      '<button class="launcher" title="Toggle RepriceAA">RAA</button>' +
      '<div class="panel" style="display:none">' +
      '<div class="head"><span class="dot"></span><h1>RepriceAA</h1></div>' +
      '<div class="body" id="raa-content">' + inner + '</div>' +
      '<div class="foot">Intelligence Index &amp; benchmarks stay Artificial Analysis\u2019s. Costs are transformed locally by your pricing profile.</div>' +
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
    var hide = state.integratedBars > 0 && !stateApi.isPanelOpen();
    launcherEl.style.display = hide ? 'none' : '';
  }

  function rerender() {
    var content = shadowRoot.querySelector('#raa-content');
    if (!content) return;
    content.innerHTML = state.editing ? editorViewHtml() : mainViewHtml();
    if (state.editing) bindEditorEvents(content);
    else bindMainEvents(content);
  }

  function refreshModels() {
    try {
      var bundle = extract.extractModelsDetailed(document);
      var models = bundle.models;
      var sig = models.map(function (m) { return m.id + ':' + m.intelligence + ':' + m.aaCost; }).join('|') +
        '#' + bundle.source;
      var changed = sig !== state.lastSig;
      if (changed) {
        state.lastSig = sig;
        state.models = models;
        state.sourceInfo = { source: bundle.source, coverage: bundle.coverage };
      }
      state.allModels = RAA.registry.merge(models);
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
    enterEditor();
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
