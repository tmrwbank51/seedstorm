// Destructible terrain for SEEDSTORM: a soil heightmap, one surface height per
// horizontal pixel. Explosions carve craters into it; ants standing on removed
// soil fall, and soil carved all the way through opens a pit an ant can fall
// into and be eliminated. Decor (grass, flowers, twigs) is anchored to the
// surface and vanishes where the ground is destroyed.
const TERRAIN_WIDTH = 1280;
const TERRAIN_BOTTOM = 720;
const PIT_Y = 760;

function Terrain(rng, levelDef, width) {
  this.width = width || TERRAIN_WIDTH;
  this.h = new Array(this.width);
  this.origH = new Array(this.width);
  this.levelDef = levelDef;
  this.speckles = [];
  this.decor = [];
  this.generate(rng);
}

Terrain.prototype.generate = function (rng) {
  const w = this.width;
  // Rolling garden soil: layered sine hills plus value noise, with a raised
  // plateau on each side where the colonies start and a dip in the middle.
  const p1 = rng.range(0, Math.PI * 2);
  const p2 = rng.range(0, Math.PI * 2);
  const p3 = rng.range(0, Math.PI * 2);
  const base = 430;
  const noise = [];
  let nv = 0;
  for (let x = 0; x < w; x += 32) { nv += rng.range(-26, 26); nv *= 0.72; noise.push(nv); }
  for (let x = 0; x < w; x++) {
    const t = x / w;
    let y = base
      + Math.sin(t * Math.PI * 2.2 + p1) * 34
      + Math.sin(t * Math.PI * 5.1 + p2) * 16
      + Math.sin(t * Math.PI * 11.0 + p3) * 7;
    const ni = Math.min(noise.length - 1, Math.floor(x / 32));
    const frac = (x % 32) / 32;
    const n0 = noise[ni], n1 = noise[Math.min(noise.length - 1, ni + 1)];
    y += n0 + (n1 - n0) * frac;
    // Plateaus: gentle mounds near each colony's ground.
    y -= 26 * Math.exp(-Math.pow((x - 170) / 130, 2));
    y -= 26 * Math.exp(-Math.pow((x - (w - 170)) / 130, 2));
    // A soft central dip so the middle reads as a little valley.
    y += 18 * Math.exp(-Math.pow((x - w / 2) / 170, 2));
    y = Math.max(300, Math.min(560, y));
    this.h[x] = y;
    this.origH[x] = y;
  }
  // Deterministic speckles inside the soil for texture.
  for (let i = 0; i < 520; i++) {
    const x = rng.int(0, w - 1);
    const y = this.h[x] + rng.range(14, 240);
    if (y < TERRAIN_BOTTOM - 4) {
      this.speckles.push({ x: x, dy: y - this.h[x], r: rng.range(1.5, 3.6), shade: rng.pick([0, 1, 2]) });
    }
  }
  // Decor anchored to the surface.
  const kinds = ['grass', 'grass', 'grass', 'flower', 'twig', 'pebble', 'clover', 'mushroom'];
  const count = Math.floor(w / 26 * (this.levelDef.decorDensity || 1));
  for (let i = 0; i < count; i++) {
    const x = rng.int(8, w - 9);
    this.decor.push({
      x: x, kind: rng.pick(kinds), variant: rng.int(0, 2),
      sway: rng.range(0, Math.PI * 2), scale: rng.range(0.8, 1.35),
      origY: this.h[x]
    });
  }
};

Terrain.prototype.surfaceY = function (x) {
  const xi = Math.max(0, Math.min(this.width - 1, Math.round(x)));
  return this.h[xi];
};

Terrain.prototype.isHole = function (x) {
  return this.surfaceY(x) >= TERRAIN_BOTTOM - 2;
};

// Carve a circular crater centred at (cx, cy). Soil above the circle's bottom
// edge is removed; columns whose surface drops past the bottom become pits.
Terrain.prototype.carve = function (cx, cy, r) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(this.width - 1, Math.ceil(cx + r));
  for (let x = x0; x <= x1; x++) {
    const dx = x - cx;
    const dy = Math.sqrt(Math.max(0, r * r - dx * dx));
    const top = cy - dy;
    const bottom = cy + dy;
    if (top <= this.h[x] + 2) {
      if (bottom > this.h[x]) this.h[x] = Math.min(TERRAIN_BOTTOM, bottom);
    }
  }
};

// How much solid ground remains, as a fraction (used by the probe API).
Terrain.prototype.remaining = function () {
  let sum = 0;
  for (let x = 0; x < this.width; x++) sum += Math.max(0, TERRAIN_BOTTOM - this.h[x]);
  let total = 0;
  for (let x = 0; x < this.width; x++) total += Math.max(0, TERRAIN_BOTTOM - this.origH[x]);
  return total > 0 ? sum / total : 0;
};

Terrain.prototype.drawSoil = function (ctx, def) {
  const w = this.width;
  const grad = ctx.createLinearGradient(0, 280, 0, TERRAIN_BOTTOM);
  grad.addColorStop(0, def.soilTop);
  grad.addColorStop(0.35, def.soilMid);
  grad.addColorStop(1, def.soilBottom);
  ctx.beginPath();
  ctx.moveTo(-4, TERRAIN_BOTTOM + 4);
  ctx.lineTo(-4, this.h[0]);
  for (let x = 0; x < w; x += 4) ctx.lineTo(x, this.h[x]);
  ctx.lineTo(w + 4, this.h[w - 1]);
  ctx.lineTo(w + 4, TERRAIN_BOTTOM + 4);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  // Grass fringe along the living surface.
  ctx.strokeStyle = def.grass;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  let penDown = false;
  for (let x = 0; x < w; x += 4) {
    if (this.h[x] >= TERRAIN_BOTTOM - 2) { penDown = false; continue; }
    if (!penDown) { ctx.moveTo(x, this.h[x] + 1); penDown = true; }
    else ctx.lineTo(x, this.h[x] + 1);
  }
  ctx.stroke();
  // Lighter topsoil rim.
  ctx.strokeStyle = def.soilRim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  penDown = false;
  for (let x = 0; x < w; x += 4) {
    if (this.h[x] >= TERRAIN_BOTTOM - 2) { penDown = false; continue; }
    if (!penDown) { ctx.moveTo(x, this.h[x] + 5); penDown = true; }
    else ctx.lineTo(x, this.h[x] + 5);
  }
  ctx.stroke();
  // Speckles, drawn relative to each column's ORIGINAL surface so craters
  // expose clean soil instead of floating dots.
  for (const s of this.speckles) {
    const y = this.h[s.x] + s.dy;
    if (y >= TERRAIN_BOTTOM - 2) continue;
    if (this.h[s.x] > this.origH[s.x] + 4 && s.dy < 40) continue;
    ctx.fillStyle = s.shade === 0 ? 'rgba(0,0,0,0.16)' : (s.shade === 1 ? 'rgba(255,235,200,0.12)' : 'rgba(0,0,0,0.08)');
    ctx.beginPath();
    ctx.arc(s.x, y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
};

Terrain.prototype.drawDecor = function (ctx, time, wind) {
  for (const d of this.decor) {
    const sy = this.h[d.x];
    if (sy >= TERRAIN_BOTTOM - 2) continue;
    if (sy > d.origY + 26) continue; // ground destroyed beneath it
    const sway = Math.sin(time * 1.4 + d.sway) * 1.6 + wind * 0.9;
    const x = d.x, y = sy + 2, s = d.scale;
    if (d.kind === 'grass') {
      ctx.strokeStyle = this.levelDef.grassBlade;
      ctx.lineWidth = 2;
      for (let b = -1; b <= 1; b++) {
        ctx.beginPath();
        ctx.moveTo(x + b * 3, y);
        ctx.quadraticCurveTo(x + b * 4 + sway, y - 9 * s, x + b * 5 + sway * 1.6, y - 15 * s);
        ctx.stroke();
      }
    } else if (d.kind === 'flower') {
      const cols = ['#ff8fb2', '#ffd166', '#c39bd3'];
      ctx.strokeStyle = '#4e8c3f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + sway * 0.5, y - 8 * s, x + sway, y - 14 * s);
      ctx.stroke();
      ctx.fillStyle = cols[d.variant];
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + sway + Math.cos(a) * 4 * s, y - 14 * s + Math.sin(a) * 4 * s, 3 * s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fff3b0';
      ctx.beginPath();
      ctx.arc(x + sway, y - 14 * s, 2.6 * s, 0, Math.PI * 2);
      ctx.fill();
    } else if (d.kind === 'twig') {
      ctx.strokeStyle = '#6b4a2a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - 9 * s, y - 1);
      ctx.lineTo(x + 9 * s, y - 4 * s);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 1, y - 2);
      ctx.lineTo(x + 5 * s, y - 8 * s);
      ctx.stroke();
    } else if (d.kind === 'pebble') {
      ctx.fillStyle = '#9a938a';
      ctx.beginPath();
      ctx.ellipse(x, y - 3 * s, 6 * s, 4 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.ellipse(x - 2 * s, y - 5 * s, 2.4 * s, 1.4 * s, -0.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (d.kind === 'clover') {
      ctx.fillStyle = '#5da24a';
      for (let p = 0; p < 4; p++) {
        const a = (p / 4) * Math.PI * 2 + 0.4;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * 3.4 * s, y - 4 * s + Math.sin(a) * 3.4 * s, 3 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (d.kind === 'mushroom') {
      ctx.fillStyle = '#f2e8d5';
      ctx.fillRect(x - 1.6 * s, y - 7 * s, 3.2 * s, 7 * s);
      ctx.fillStyle = d.variant === 1 ? '#d64545' : '#c96f2e';
      ctx.beginPath();
      ctx.arc(x, y - 7 * s, 6 * s, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(x - 2.5 * s, y - 9 * s, 1.3 * s, 0, Math.PI * 2);
      ctx.arc(x + 2.5 * s, y - 10 * s, 1 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
};
