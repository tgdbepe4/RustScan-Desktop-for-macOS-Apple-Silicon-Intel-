/* Procedural Night City backdrop.
   Four depth layers of brutalist towers, neon rim light, window grids,
   haze, rain and a wet-asphalt glow. Built once per resize; per frame
   cost is a linear blit loop. Capped at ~30fps and paused when hidden. */
(function () {
  'use strict';

  const canvas = document.getElementById('city');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, DPR = 1;
  let layers = [];
  let rain = [];
  let haze = [];
  let t = 0;
  let lastFrame = 0;
  let mouseX = 0, targetMouseX = 0;
  let running = true;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let x = Math.imul(a ^ a >>> 15, 1 | a);
      x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x;
      return ((x ^ x >>> 14) >>> 0) / 4294967296;
    };
  }

  const LAYER_DEFS = [
    { depth: 0.12, count: 24, minH: 0.16, maxH: 0.38, tint: '#10151d', neon: 0.30, speed: 0.06 },
    { depth: 0.26, count: 18, minH: 0.24, maxH: 0.55, tint: '#151c25', neon: 0.50, speed: 0.12 },
    { depth: 0.46, count: 14, minH: 0.34, maxH: 0.72, tint: '#1a222d', neon: 0.72, speed: 0.20 },
    { depth: 0.72, count: 9,  minH: 0.44, maxH: 0.88, tint: '#202935', neon: 0.94, speed: 0.32 }
  ];
  const NEON = ['#fcee0a', '#00f0ff', '#ff003c', '#fcee0a', '#ff6a00', '#00f0ff'];

  function buildLayer(def, seed) {
    const rnd = mulberry32(seed);
    const arr = [];
    let x = -0.1;
    let guard = 0;
    while (x < 1.12 && guard++ < 90) {
      const w = 0.028 + rnd() * 0.075 * (0.6 + def.depth);
      const h = def.minH + rnd() * (def.maxH - def.minH);
      const b = {
        x, w, h,
        tiers: [],
        neonSide: rnd() > 0.5 ? 1 : -1,
        signY: 0.12 + rnd() * 0.55,
        signH: 0.006 + rnd() * 0.016,
        signColor: NEON[(rnd() * NEON.length) | 0],
        windows: [],
        antenna: rnd() > 0.55,
        antennaH: 0.03 + rnd() * 0.09,
        crown: rnd() > 0.72,
        flicker: rnd() * Math.PI * 2,
        flickerSpeed: 0.6 + rnd() * 2.2
      };
      const tierCount = 1 + ((rnd() * 3) | 0);
      let cursorY = 1;
      for (let k = 0; k < tierCount; k++) {
        const th = (k === 0 ? h * (0.55 + rnd() * 0.2) : h * (0.12 + rnd() * 0.18));
        const inset = k * w * 0.1 * rnd();
        b.tiers.push({ y: cursorY - th, h: th, inset, w: w - inset * 2 });
        cursorY -= th;
        if (cursorY < 1 - h) break;
      }
      b.top = cursorY;
      const rows = Math.max(4, Math.floor(h * 70));
      const cols = Math.max(3, Math.floor(w * 210));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rnd() > 0.105) continue;
          b.windows.push({
            u: (c + 0.5) / cols,
            v: (r + 0.5) / rows,
            a: 0.10 + rnd() * 0.58,
            color: rnd() > 0.88 ? '#00f0ff' : (rnd() > 0.68 ? '#fcee0a' : '#cfd6e0'),
            ph: rnd() * Math.PI * 2
          });
        }
      }
      arr.push(b);
      x += w * (0.72 + rnd() * 0.7);
    }
    return arr;
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    layers = LAYER_DEFS.map((def, idx) => ({
      def,
      buildings: buildLayer(def, 9137 + idx * 771),
      offset: 0
    }));

    rain = [];
    const drops = Math.round(Math.min(110, W / 14));
    const rnd = mulberry32(4242);
    for (let i = 0; i < drops; i++) {
      rain.push({
        x: rnd() * W,
        y: rnd() * H,
        len: 8 + rnd() * 24,
        speed: 220 + rnd() * 480,
        alpha: 0.04 + rnd() * 0.13,
        skew: -0.12 - rnd() * 0.18
      });
    }

    haze = [];
    const rnd2 = mulberry32(777);
    for (let j = 0; j < 4; j++) {
      haze.push({
        x: rnd2() * W,
        y: H * (0.20 + rnd2() * 0.5),
        r: Math.min(W, H) * (0.24 + rnd2() * 0.3),
        color: j % 2 ? '0,240,255' : '252,238,10',
        a: 0.035 + rnd2() * 0.05,
        drift: 6 + rnd2() * 16
      });
    }
  }

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#05060a');
    g.addColorStop(0.42, '#080b12');
    g.addColorStop(0.72, '#0b0e16');
    g.addColorStop(1, '#050506');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const fog = ctx.createLinearGradient(0, H * 0.18, 0, H);
    fog.addColorStop(0, 'rgba(26,34,46,0)');
    fog.addColorStop(0.34, 'rgba(30,40,54,0.34)');
    fog.addColorStop(0.62, 'rgba(36,44,56,0.52)');
    fog.addColorStop(0.86, 'rgba(18,20,26,0.4)');
    fog.addColorStop(1, 'rgba(5,6,9,0)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, W, H);

    const dome = ctx.createRadialGradient(W * 0.64, H * 0.84, 0, W * 0.64, H * 0.84, H * 0.95);
    dome.addColorStop(0, 'rgba(252,238,10,0.09)');
    dome.addColorStop(0.35, 'rgba(255,106,0,0.04)');
    dome.addColorStop(0.7, 'rgba(0,240,255,0.026)');
    dome.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = dome;
    ctx.fillRect(0, 0, W, H);
  }

  function drawHaze() {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < haze.length; i++) {
      const s = haze[i];
      const dx = Math.sin(t * 0.00012 + i) * s.drift;
      const g = ctx.createRadialGradient(s.x + dx, s.y, 0, s.x + dx, s.y, s.r);
      g.addColorStop(0, 'rgba(' + s.color + ',' + s.a + ')');
      g.addColorStop(0.55, 'rgba(' + s.color + ',' + (s.a * 0.35) + ')');
      g.addColorStop(1, 'rgba(' + s.color + ',0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x + dx, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawLayer(layer, horizon, parallax) {
    const def = layer.def;
    const off = parallax * def.depth * 30 + layer.offset;
    const baseY = horizon + def.depth * 22;

    for (let i = 0; i < layer.buildings.length; i++) {
      const b = layer.buildings[i];
      const bx = b.x * W + off;
      const bw = b.w * W;
      if (bx + bw < -80 || bx > W + 80) continue;

      const topY = baseY - b.h * (baseY * 0.96);
      const bg = ctx.createLinearGradient(0, topY, 0, baseY);
      bg.addColorStop(0, def.tint);
      bg.addColorStop(0.55, def.tint);
      bg.addColorStop(1, '#06070a');
      ctx.fillStyle = bg;

      for (let k = 0; k < b.tiers.length; k++) {
        const tr = b.tiers[k];
        const tx = bx + tr.inset * W * 0.5;
        const tw = tr.w * W;
        const ty = baseY - (1 - tr.y) * (baseY * 0.96) - tr.h * (baseY * 0.96);
        ctx.fillRect(tx, ty, tw, tr.h * (baseY * 0.96) + 1);
      }

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const edgeX = b.neonSide > 0 ? bx + bw - 1.2 : bx;
      const edgeRGB = b.signColor === '#00f0ff' ? '0,240,255' : '252,238,10';
      const eg = ctx.createLinearGradient(0, topY, 0, baseY);
      eg.addColorStop(0, 'rgba(' + edgeRGB + ',' + (0.38 * def.neon) + ')');
      eg.addColorStop(0.45, 'rgba(' + edgeRGB + ',' + (0.14 * def.neon) + ')');
      eg.addColorStop(1, 'rgba(' + edgeRGB + ',0)');
      ctx.fillStyle = eg;
      ctx.fillRect(edgeX - 0.5, topY, 2, baseY - topY);
      ctx.fillStyle = 'rgba(180,205,230,' + (0.05 + def.neon * 0.06) + ')';
      ctx.fillRect(bx, topY, bw, 1);
      ctx.restore();

      ctx.save();
      for (let wi = 0; wi < b.windows.length; wi++) {
        const w = b.windows[wi];
        const wx = bx + w.u * bw;
        const wy = topY + w.v * (baseY - topY);
        const flick = reduce ? 1 : (0.75 + 0.25 * Math.sin(t * 0.0016 + w.ph));
        ctx.globalAlpha = w.a * flick * (0.42 + def.neon * 0.55);
        ctx.fillStyle = w.color;
        ctx.fillRect(wx, wy, Math.max(1, bw * 0.011), Math.max(1, (baseY - topY) * 0.006));
      }
      ctx.restore();

      if (def.neon > 0.4) {
        const sy = topY + b.signY * (baseY - topY);
        const sh = b.signH * (baseY - topY) * 3;
        const sx = b.neonSide > 0 ? bx + bw * 0.18 : bx + bw * 0.78;
        const flicker = reduce ? 1 : (0.72 + 0.28 * Math.sin(t * 0.0021 * b.flickerSpeed + b.flicker));
        if (flicker > 0.55) {
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = 0.45 * def.neon * flicker;
          ctx.fillStyle = b.signColor;
          ctx.fillRect(sx, sy, Math.max(2, bw * 0.028), sh);
          ctx.globalAlpha = 0.14 * def.neon * flicker;
          ctx.fillRect(sx - 3, sy - 3, Math.max(2, bw * 0.028) + 6, sh + 6);
          ctx.restore();
        }
      }

      if (b.crown && def.neon > 0.5) {
        const cx = bx + bw * 0.5;
        const cy = topY - 3;
        const blink = reduce ? 1 : (Math.sin(t * 0.0032 + b.flicker) > 0.3 ? 1 : 0.15);
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.8 * blink;
        ctx.fillStyle = '#ff003c';
        ctx.fillRect(cx - 1, cy - 2, 2, 2);
        ctx.globalAlpha = 0.18 * blink;
        ctx.beginPath();
        ctx.arc(cx, cy - 1, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (b.antenna) {
        const ax = bx + bw * (b.neonSide > 0 ? 0.28 : 0.68);
        const ah = b.antennaH * (baseY * 0.96);
        ctx.strokeStyle = 'rgba(160,170,185,' + (0.14 + def.depth * 0.18) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ax, topY);
        ctx.lineTo(ax, topY - ah);
        ctx.moveTo(ax - 5, topY - ah * 0.55);
        ctx.lineTo(ax + 5, topY - ah * 0.55);
        ctx.stroke();
      }
    }
  }

  function drawRain(dt) {
    ctx.save();
    ctx.strokeStyle = 'rgba(200,220,235,0.5)';
    ctx.lineWidth = 1;
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < rain.length; i++) {
      const d = rain[i];
      d.y += d.speed * dt;
      d.x += d.speed * d.skew * dt;
      if (d.y > H + 40) { d.y = -40; d.x = Math.random() * W; }
      if (d.x < -20) d.x = W + 10;
      ctx.globalAlpha = d.alpha;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + d.len * d.skew, d.y + d.len);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(W * 0.5, H * 0.45, H * 0.15, W * 0.5, H * 0.5, H * 0.92);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.72, 'rgba(0,0,0,0.30)');
    g.addColorStop(1, 'rgba(0,0,0,0.86)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!running) { lastFrame = now; return; }
    if (now - lastFrame < 33) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0.03);
    lastFrame = now;
    t = now;
    mouseX += (targetMouseX - mouseX) * 0.045;

    drawSky();
    drawHaze();
    const horizon = H * 0.995;
    for (let i = 0; i < layers.length; i++) {
      layers[i].offset = Math.sin(t * 0.00006 + i) * (4 + i * 3);
      drawLayer(layers[i], horizon, mouseX);
    }
    if (!reduce) drawRain(dt);
    drawVignette();

    const refl = ctx.createLinearGradient(0, H * 0.88, 0, H);
    refl.addColorStop(0, 'rgba(252,238,10,0.045)');
    refl.addColorStop(0.4, 'rgba(0,240,255,0.018)');
    refl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = refl;
    ctx.fillRect(0, H * 0.88, W, H * 0.12);
  }

  window.addEventListener('pointermove', (e) => {
    targetMouseX = (e.clientX / window.innerWidth - 0.5) * 2;
  }, { passive: true });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 160);
  });
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) lastFrame = performance.now();
  });

  if (reduce) {
    canvas.style.opacity = '0.35';
  }
  resize();
  requestAnimationFrame(frame);
})();
