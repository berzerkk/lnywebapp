/* ============================================================================
   L&S — Mappemonde animée (Canvas 2D)
   Planisphère (frontières orange-rosé) + faisceaux point A -> point B avec
   une petite explosion de lumière à l'arrivée. Boucle continue.
   ============================================================================ */
(function () {
  'use strict';
  var stage = document.getElementById('worldmap-stage');
  if (!stage) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  var canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  stage.appendChild(canvas);
  var ctx = canvas.getContext('2d');
  var borders = document.createElement('canvas');
  var bctx = borders.getContext('2d');

  var ACCENT = [190, 110, 84], BLUSH = [243, 173, 153], LIGHT = [255, 240, 205];
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  var W = 1, H = 1, PW = 1, PH = 1, mapW = 1, mapH = 1, mapX0 = 0, mapY0 = 0, mapCx = 0, mesh = null;
  // projection courbée (pseudo-3D) : centrée, bords resserrés + bombés
  var centerLon = 12, spanLon = 150, curveX = 0.92, bowY = 0.12;

  // quelques villes (lon, lat) — Nice inclus (siège L&S)
  var cities = [
    [2.35, 48.85], [-0.13, 51.5], [-74.0, 40.7], [-118.2, 34.0], [139.7, 35.7],
    [116.4, 39.9], [151.2, -33.9], [55.3, 25.2], [-46.6, -23.5], [18.4, -33.9],
    [37.6, 55.75], [103.8, 1.35], [7.27, 43.7], [-73.6, 45.5], [72.8, 19.1],
    [13.4, 52.5], [-99.1, 19.4], [28.0, -26.2], [121.5, 31.2], [-122.4, 37.8]
  ];
  var cityPx = [];

  function project(lon, lat) {
    var dl = lon - centerLon; while (dl > 180) dl -= 360; while (dl < -180) dl += 360;
    var nx = dl / spanLon;
    var k = Math.sin((Math.PI / 2) * curveX);
    var px = mapCx + Math.sin(nx * (Math.PI / 2) * curveX) / k * (mapW / 2);
    var py = mapY0 + (90 - lat) / 180 * mapH + bowY * nx * nx * mapH;
    var out = (Math.abs(nx) > 1) || lat < -58 || lat > 84;
    return [px, py, out];
  }

  function size() {
    var r = stage.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    PW = Math.round(W * dpr); PH = Math.round(H * dpr);
    canvas.width = PW; canvas.height = PH; borders.width = PW; borders.height = PH;
    mapW = PW; mapH = mapW * 0.6;
    if (mapH * (1 + bowY) > PH) { mapH = PH / (1 + bowY); mapW = mapH / 0.6; }
    mapCx = PW / 2; mapX0 = 0; mapY0 = (PH - mapH) / 2 - bowY * mapH * 0.5;
    cityPx = cities.map(function (c) { return project(c[0], c[1]); });
    renderBorders();
  }

  function renderBorders() {
    bctx.clearRect(0, 0, PW, PH);
    if (!mesh) return;
    bctx.lineWidth = Math.max(0.7, 1.0 * dpr);
    bctx.strokeStyle = rgba(ACCENT, 0.55);
    bctx.lineJoin = 'round'; bctx.lineCap = 'round';
    bctx.beginPath();
    mesh.coordinates.forEach(function (line) {
      var pen = false;
      for (var i = 0; i < line.length; i++) {
        var lon = line[i][0], lat = line[i][1];
        var jump = (i > 0 && Math.abs(lon - line[i - 1][0]) > 170);
        var p = project(lon, lat);
        if (p[2] || jump) { pen = false; continue; }
        if (!pen) { bctx.moveTo(p[0], p[1]); pen = true; } else bctx.lineTo(p[0], p[1]);
      }
    });
    bctx.stroke();
    bctx.fillStyle = rgba(BLUSH, 0.45);
    cityPx.forEach(function (p) { bctx.beginPath(); bctx.arc(p[0], p[1], 1.5 * dpr, 0, 7); bctx.fill(); });
  }

  // ---- faisceaux + explosions ---------------------------------------------
  var arcs = [], bursts = [], lastSpawn = 0, SPAWN = 620, MAXARCS = 5;
  function spawnArc() {
    if (cityPx.length < 2) return;
    var ai = (Math.random() * cityPx.length) | 0, bi;
    do { bi = (Math.random() * cityPx.length) | 0; } while (bi === ai);
    var A = cityPx[ai], B = cityPx[bi];
    var mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
    var d = Math.hypot(B[0] - A[0], B[1] - A[1]);
    arcs.push({ A: A, B: B, cx: mx, cy: my - d * 0.32 - 18 * dpr, t: 0, dur: 1700 + Math.random() * 900 });
  }
  function bez(A, cx, cy, B, t) { var u = 1 - t; return [u * u * A[0] + 2 * u * t * cx + t * t * B[0], u * u * A[1] + 2 * u * t * cy + t * t * B[1]]; }

  function drawArc(a, dt) {
    a.t += dt / a.dur;
    var t = Math.min(1, a.t), N = 26;
    ctx.lineCap = 'round';
    for (var i = 1; i <= N; i++) {
      var p1 = bez(a.A, a.cx, a.cy, a.B, t * (i - 1) / N), p2 = bez(a.A, a.cx, a.cy, a.B, t * i / N);
      var f = i / N;
      ctx.strokeStyle = rgba(BLUSH, 0.07 + 0.5 * f);
      ctx.lineWidth = (0.6 + 1.8 * f) * dpr;
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
    }
    var hp = bez(a.A, a.cx, a.cy, a.B, t);
    ctx.save();
    ctx.shadowColor = rgba(LIGHT, 0.9); ctx.shadowBlur = 10 * dpr;
    ctx.fillStyle = rgba(LIGHT, 0.95);
    ctx.beginPath(); ctx.arc(hp[0], hp[1], 2.4 * dpr, 0, 7); ctx.fill();
    ctx.restore();
    if (a.t >= 1) { bursts.push({ x: a.B[0], y: a.B[1], t: 0 }); return false; }
    return true;
  }

  function drawBurst(b, dt) {
    b.t += dt / 620;
    var t = Math.min(1, b.t), e = 1 - Math.pow(1 - t, 3), R = e * 24 * dpr;
    ctx.save();
    ctx.strokeStyle = rgba(BLUSH, (1 - t) * 0.8); ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, 7); ctx.stroke();
    ctx.strokeStyle = rgba(ACCENT, (1 - t) * 0.5); ctx.lineWidth = 1.4 * dpr;
    ctx.beginPath(); ctx.arc(b.x, b.y, R * 0.58, 0, 7); ctx.stroke();
    ctx.shadowColor = rgba(LIGHT, 1); ctx.shadowBlur = 18 * dpr * (1 - t);
    ctx.fillStyle = rgba(LIGHT, (1 - t) * 0.95);
    ctx.beginPath(); ctx.arc(b.x, b.y, (1 - t) * 5 * dpr + 1, 0, 7); ctx.fill();
    ctx.restore();
    return b.t < 1;
  }

  var last = 0;
  function frame(now) {
    var dt = last ? now - last : 16; last = now; if (dt > 60) dt = 60;
    ctx.clearRect(0, 0, PW, PH);
    ctx.drawImage(borders, 0, 0);
    if (!reduce) {
      if (now - lastSpawn > SPAWN && arcs.length < MAXARCS) { spawnArc(); lastSpawn = now; }
      arcs = arcs.filter(function (a) { return drawArc(a, dt); });
      bursts = bursts.filter(function (b) { return drawBurst(b, dt); });
    }
    requestAnimationFrame(frame);
  }

  function start() { size(); requestAnimationFrame(frame); }

  fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
    .then(function (r) { return r.json(); })
    .then(function (topo) {
      if (typeof topojson !== 'undefined' && topo && topo.objects) { mesh = topojson.mesh(topo, topo.objects.countries); }
      start();
    })
    .catch(function () { start(); });

  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(size, 180); });
})();
