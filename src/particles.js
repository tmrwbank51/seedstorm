// Particles, floating score text and screen shake for SEEDSTORM. One system
// owns every transient visual effect so the game code only ever calls burst()
// and floatText().
const Particles = (function () {
  const list = [];
  const texts = [];
  let trauma = 0;

  function add(p) {
    if (list.length > 900) list.splice(0, list.length - 900);
    list.push(p);
  }

  function burst(x, y, opts) {
    const o = opts || {};
    const count = o.count || 20;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (o.speed || 160) * (0.3 + Math.random() * 0.9);
      add({
        x: x, y: y,
        vx: Math.cos(a) * sp + (o.vx || 0),
        vy: Math.sin(a) * sp + (o.vy || 0) - (o.up || 0),
        life: 0,
        maxLife: (o.life || 0.7) * (0.6 + Math.random() * 0.7),
        size: (o.size || 4) * (0.6 + Math.random() * 0.8),
        color: Array.isArray(o.color) ? o.color[Math.floor(Math.random() * o.color.length)] : (o.color || '#c98f4e'),
        gravity: o.gravity !== undefined ? o.gravity : 500,
        drag: o.drag !== undefined ? o.drag : 0.6,
        shape: o.shape || 'circle',
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 8
      });
    }
  }

  function soilBurst(x, y, radius) {
    burst(x, y, {
      count: Math.floor(radius * 1.1), speed: 240, size: 5, life: 1.0,
      color: ['#7a5230', '#5d3d22', '#8f6238', '#4a2f1a'], up: 120
    });
    burst(x, y, {
      count: 14, speed: 120, size: 8, life: 0.5,
      color: ['#ffd27a', '#ff9a3d', '#fff3c4'], gravity: -60, shape: 'star'
    });
  }

  function leafDrift(x, y, wind) {
    add({
      x: x, y: y, vx: wind * 14 + (Math.random() - 0.5) * 20, vy: 12 + Math.random() * 14,
      life: 0, maxLife: 2.5 + Math.random() * 2, size: 4 + Math.random() * 3,
      color: Math.random() < 0.5 ? '#7fb069' : '#a7c957', gravity: 6, drag: 0.2,
      shape: 'leaf', rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 3
    });
  }

  function floatText(x, y, text, color, size) {
    texts.push({ x: x, y: y, text: text, color: color || '#ffffff', size: size || 20, life: 0, maxLife: 1.1 });
  }

  function addTrauma(amount) {
    trauma = Math.min(1, trauma + amount);
  }

  function shakeOffset() {
    const s = trauma * trauma * 14;
    return { x: (Math.random() * 2 - 1) * s, y: (Math.random() * 2 - 1) * s };
  }

  function update(dt) {
    trauma = Math.max(0, trauma - dt * 1.6);
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life += dt;
      if (p.life >= p.maxLife) { list.splice(i, 1); continue; }
      p.vy += p.gravity * dt;
      p.vx *= (1 - p.drag * dt);
      p.vy *= (1 - p.drag * dt * 0.4);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.life += dt;
      t.y -= 42 * dt;
      if (t.life >= t.maxLife) texts.splice(i, 1);
    }
  }

  function draw(ctx) {
    for (const p of list) {
      const a = 1 - p.life / p.maxLife;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.shape === 'leaf') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (p.shape === 'star') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        const s = p.size;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2;
          const r = i % 2 === 0 ? s : s * 0.4;
          const px = Math.cos(ang) * r, py = Math.sin(ang) * r;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (p.shape === 'rect') {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const t of texts) {
      const a = 1 - t.life / t.maxLife;
      ctx.globalAlpha = Math.min(1, a * 2);
      ctx.font = 'bold ' + t.size + 'px Trebuchet MS, Verdana, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(30,18,8,0.85)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  function clear() {
    list.length = 0;
    texts.length = 0;
    trauma = 0;
  }

  return {
    burst: burst, soilBurst: soilBurst, leafDrift: leafDrift,
    floatText: floatText, addTrauma: addTrauma, shakeOffset: shakeOffset,
    update: update, draw: draw, clear: clear,
    count: function () { return list.length; }
  };
})();
