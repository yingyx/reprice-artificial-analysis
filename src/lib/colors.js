(function (root) {
  'use strict';

  var FALLBACK_PALETTE = [
    '#1f1f1f', '#cc785c', '#34A853', '#2243e6', '#ff7018', '#0089f4',
    '#736cd3', '#EB3568', '#76b900', '#047AFE', '#8341F0', '#F54F35',
    '#005597', '#17D766', '#D18EE2', '#f59e0b'
  ];

  var PROVIDER_KEYWORDS = [
    ['openai', 'OpenAI'], ['gpt-', 'OpenAI'], ['chatgpt', 'OpenAI'], ['o3', 'OpenAI'], ['o4', 'OpenAI'],
    ['claude', 'Anthropic'], ['anthropic', 'Anthropic'],
    ['gemini', 'Google'], ['gemma', 'Google'], ['google', 'Google'], ['palm', 'Google'],
    ['llama', 'Meta'], [' meta ', 'Meta'],
    ['deepseek', 'DeepSeek'],
    ['qwen', 'Alibaba'], ['alibaba', 'Alibaba'], ['qwq', 'Alibaba'],
    ['glm', 'Z AI'], ['zhipu', 'Z AI'], ['z-ai', 'Z AI'],
    ['kimi', 'Kimi'], ['moonshot', 'Kimi'],
    ['minimax', 'MiniMax'],
    ['grok', 'SpaceXAI'], ['xai', 'SpaceXAI'], ['spacexai', 'SpaceXAI'],
    ['mistral', 'Mistral'], ['mixtral', 'Mistral'],
    ['nemotron', 'NVIDIA'], ['nvidia', 'NVIDIA'],
    ['cohere', 'Cohere'], ['command-r', 'Cohere'],
    ['nova', 'Amazon'], ['amazon', 'Amazon'],
    ['phi-', 'Microsoft']
  ];

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase();
  }

  function inferProviderName(label, id) {
    var l = ' ' + norm(label) + ' / ' + norm(id) + ' ';
    for (var i = 0; i < PROVIDER_KEYWORDS.length; i++) {
      if (l.indexOf(PROVIDER_KEYWORDS[i][0]) !== -1) return PROVIDER_KEYWORDS[i][1];
    }
    return null;
  }

  function harvestLegendColors(doc) {
    doc = doc || document;
    var map = {};
    try {
      var nodes = doc.querySelectorAll('span[style*="background-color:#"]');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var m = /background-color:\s*(#[0-9a-fA-F]{3,8})/.exec(el.getAttribute('style') || '');
        if (!m) continue;
        var nameEl = el.nextElementSibling;
        if (!nameEl) continue;
        var text = (nameEl.textContent || '').trim();
        if (!text || text.length > 60) continue;
        map[norm(text)] = m[1];
      }
    } catch (e) { /* ignore */ }
    return map;
  }

  function createColorService() {
    var harvested = {};
    var assigned = {};

    function refresh(doc) {
      harvested = harvestLegendColors(doc);
    }

    function providerHex(providerName) {
      if (!providerName) return null;
      if (harvested[norm(providerName)]) return harvested[norm(providerName)];
      var keys = Object.keys(harvested);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf(norm(providerName)) !== -1) return harvested[keys[i]];
      }
      return null;
    }

    function colorFor(label, id) {
      var key = String(id || label);
      if (assigned[key]) return assigned[key];
      var provider = inferProviderName(label, id);
      var hex = provider ? providerHex(provider) : null;
      if (!hex) {
        var h = 0;
        for (var j = 0; j < key.length; j++) {
          h = ((h << 5) - h + key.charCodeAt(j)) | 0;
        }
        hex = FALLBACK_PALETTE[Math.abs(h) % FALLBACK_PALETTE.length];
      }
      assigned[key] = hex;
      return hex;
    }

    return {
      refresh: refresh,
      colorFor: colorFor,
      _internals: {
        inferProviderName: inferProviderName,
        harvestLegendColors: harvestLegendColors,
        FALLBACK_PALETTE: FALLBACK_PALETTE
      }
    };
  }

  root.RepriceAA = root.RepriceAA || {};
  root.RepriceAA.colors = createColorService();
})(typeof window !== 'undefined' ? window : globalThis);
