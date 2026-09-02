(function (root) {
  'use strict';

  var EPS = 1e-9;

  function num(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function dominates(a, b) {
    var ge = a.intelligence >= b.intelligence - EPS;
    var le = a.cost <= b.cost + EPS;
    var strict = a.intelligence > b.intelligence + EPS || a.cost < b.cost - EPS;
    return ge && le && strict;
  }

  function paretoFrontierIndices(points) {
    var pts = (points || []).map(function (p, i) {
      return { intelligence: p.intelligence, cost: p.cost, index: i };
    }).filter(function (p) {
      return num(p.intelligence) && num(p.cost) && p.cost >= 0;
    });

    pts.sort(function (a, b) {
      if (Math.abs(a.cost - b.cost) > EPS) return a.cost - b.cost;
      return b.intelligence - a.intelligence;
    });

    var out = [];
    var maxIq = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.intelligence > maxIq + EPS) {
        out.push(p.index);
        maxIq = p.intelligence;
      } else if (p.intelligence >= maxIq - EPS && maxIq === -Infinity) {
        out.push(p.index);
        maxIq = p.intelligence;
      }
    }
    return out.sort(function (a, b) { return a - b; });
  }

  function paretoFrontierPoints(points) {
    var idx = paretoFrontierIndices(points);
    var seen = {};
    return idx.map(function (i) {
      seen[i] = true;
      return points[i];
    });
  }

  root.RepriceAA = root.RepriceAA || {};
  root.RepriceAA.pareto = {
    dominates: dominates,
    paretoFrontierIndices: paretoFrontierIndices
  };
})(typeof window !== 'undefined' ? window : globalThis);
