// Weapons, projectiles and explosions for SEEDSTORM. Each weapon has a clear
// role: digging, direct damage, spread, control or a rage-powered finisher.
// Projectiles fly with gravity plus horizontal wind drift; the same physics
// drives the aiming preview and the AI, so what the player sees is what the
// shot does.
const PROJECTILE_GRAVITY = 880;
const WIND_ACCEL = 26; // px/s^2 per unit of wind

const WEAPONS = [
  {
    id: 'bazooka', name: 'Seed Bazooka', key: '1',
    desc: 'Balanced shot. Medium crater, medium damage.',
    damage: 34, radius: 46, crater: 34, speed: 1.0, count: 1,
    color: '#8bc34a', trail: '#c5e1a5', size: 6, shake: 0.35
  },
  {
    id: 'durian', name: 'Durian Bomb', key: '2',
    desc: 'Heavy lob. Huge crater, high damage, slow arc.',
    damage: 48, radius: 58, crater: 48, speed: 0.86, count: 1,
    color: '#c9a227', trail: '#e6cf7a', size: 8, shake: 0.55
  },
  {
    id: 'thorns', name: 'Thorn Volley', key: '3',
    desc: 'Three darts in a spread. Direct damage, small craters.',
    damage: 16, radius: 30, crater: 20, speed: 1.12, count: 3,
    color: '#9c6bc4', trail: '#d1b3e8', size: 4, shake: 0.25, spread: 0.09
  },
  {
    id: 'honey', name: 'Honey Glob', key: '4',
    desc: 'Sticky: caught ants lose stamina and move slowly next turn.',
    damage: 14, radius: 44, crater: 16, speed: 0.95, count: 1,
    color: '#f0a828', trail: '#ffd97a', size: 7, shake: 0.2, honey: true
  },
  {
    id: 'acorn', name: 'Acorn Mortar', key: '5',
    desc: 'Steep arc that splits into 3 bomblets at its peak.',
    damage: 20, radius: 34, crater: 24, speed: 1.0, count: 1,
    color: '#a9743b', trail: '#d9b382', size: 6, shake: 0.3, splitAtApex: true
  },
  {
    id: 'rage', name: 'Rage Burst', key: '6', rageOnly: true,
    desc: 'POW! Only when the rage bar is full. Massive damage, huge crater.',
    damage: 70, radius: 78, crater: 62, speed: 1.05, count: 1,
    color: '#ff5252', trail: '#ffb3a0', size: 9, shake: 0.8
  }
];

function weaponById(id) {
  for (const w of WEAPONS) if (w.id === id) return w;
  return WEAPONS[0];
}

// Aim angle in degrees, measured from horizontal; the shot always leaves
// upward. Facing flips the horizontal direction. Top speed gives a flat
// 45-degree range of about 860 px, so shots can cross the gap between the
// colonies from their starting ground.
function aimVelocity(angleDeg, power, facing, weapon) {
  const speed = (250 + power * 6.2) * (weapon ? weapon.speed : 1);
  const a = angleDeg * Math.PI / 180;
  return { vx: Math.cos(a) * speed * facing, vy: -Math.sin(a) * speed };
}

function Projectile(x, y, vx, vy, weapon, owner, opts) {
  this.x = x; this.y = y; this.vx = vx; this.vy = vy;
  this.weapon = weapon;
  this.owner = owner; // the Ant that fired
  this.dead = false;
  this.trailTimer = 0;
  this.splitDone = false;
  this.splitArmed = !!(opts && opts.splitArmed);
  this.bomblet = !!(opts && opts.bomblet);
  this.age = 0;
}

Projectile.prototype.update = function (dt, wind, terrain, ants, game) {
  this.age += dt;
  this.vx += wind * WIND_ACCEL * dt;
  this.vy += PROJECTILE_GRAVITY * dt;
  this.x += this.vx * dt;
  this.y += this.vy * dt;
  // Apex split: acorn mortar and the Triple Split item.
  if (this.splitArmed && !this.splitDone && this.vy > 0 && this.age > 0.25) {
    this.splitDone = true;
    game.splitProjectile(this);
    return null;
  }
  this.trailTimer -= dt;
  if (this.trailTimer <= 0) {
    this.trailTimer = 0.03;
    Particles.burst(this.x, this.y, {
      count: 1, speed: 6, size: 3, life: 0.35, gravity: 0,
      color: this.weapon.trail, drag: 0
    });
  }
  // Out of the world sideways or below: fizzle.
  if (this.x < -30 || this.x > 1310 || this.y > PIT_Y + 40) {
    this.dead = true;
    return { fizzle: true };
  }
  // Direct hit on an ant (not the firer, and not in the first 0.15 s).
  if (this.age > 0.15) {
    for (const ant of ants) {
      if (!ant.alive || ant === this.owner) continue;
      const dx = this.x - ant.x, dy = this.y - (ant.y - 18);
      if (dx * dx + dy * dy < 24 * 24) {
        this.dead = true;
        return { hitAnt: ant, x: this.x, y: this.y };
      }
    }
  }
  // Terrain hit.
  if (this.y >= terrain.surfaceY(this.x)) {
    this.dead = true;
    return { hitGround: true, x: this.x, y: this.y };
  }
  return null;
};

// Simulate a shot without side effects: the aiming preview and the AI share
// this, so the preview is honest. Returns {points, hit} where hit describes
// what the simulated shot reaches first.
function simulateShot(x, y, angleDeg, power, facing, wind, weapon, terrain, ants, owner) {
  const v = aimVelocity(angleDeg, power, facing, weapon);
  let px = x, py = y, vx = v.vx, vy = v.vy;
  const points = [];
  const dt = 1 / 60;
  let hit = null;
  for (let i = 0; i < 300; i++) {
    vx += wind * WIND_ACCEL * dt;
    vy += PROJECTILE_GRAVITY * dt;
    px += vx * dt;
    py += vy * dt;
    if (i % 3 === 0) points.push({ x: px, y: py });
    if (px < -20 || px > 1300 || py > PIT_Y + 30) { hit = { kind: 'out' }; break; }
    if (i > 9) {
      for (const ant of ants) {
        if (!ant.alive || ant === owner) continue;
        const dx = px - ant.x, dy = py - (ant.y - 18);
        if (dx * dx + dy * dy < 24 * 24) { hit = { kind: 'ant', ant: ant }; break; }
      }
      if (hit) break;
    }
    if (py >= terrain.surfaceY(px)) { hit = { kind: 'ground', x: px, y: py }; break; }
  }
  return { points: points, hit: hit };
}

// Resolve an explosion: carve the crater, damage ants with falloff, apply
// honey, award rage and score. Returns the list of {ant, damage} hits.
function explode(game, x, y, weapon, owner) {
  const terrain = game.terrain;
  terrain.carve(x, y, weapon.crater);
  Particles.soilBurst(x, y, weapon.crater);
  Particles.addTrauma(weapon.shake);
  Sfx.play(weapon.id === 'rage' ? 'bigExplosion' : 'explosion');
  const hits = [];
  for (const ant of game.ants) {
    if (!ant.alive) continue;
    const dx = ant.x - x, dy = (ant.y - 18) - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > weapon.radius + 18) continue;
    const falloff = 1 - Math.max(0, (dist - 10) / (weapon.radius + 18)) * 0.75;
    const raw = weapon.damage * falloff * game.damageMul;
    const dealt = ant.damage(raw);
    if (dealt > 0) {
      hits.push({ ant: ant, damage: dealt });
      Particles.floatText(ant.x, ant.y - 62, '-' + dealt, ant.team === owner.team ? '#ffd166' : '#ff6b6b', 22);
      Particles.burst(ant.x, ant.y - 20, { count: 8, speed: 130, size: 3.5, life: 0.5, color: ['#ff8a80', '#ffffff'] });
      if (weapon.honey) {
        ant.honeyed = 2;
        Particles.floatText(ant.x, ant.y - 84, 'HONEYED!', '#f0a828', 16);
      }
      if (ant.team !== owner.team) {
        game.addRage(Math.min(34, dealt * 0.55));
        game.addScore(dealt * 10, 'damage');
      } else {
        game.addRage(Math.min(20, dealt * 0.3));
      }
      if (!ant.alive) {
        Particles.burst(ant.x, ant.y - 18, { count: 30, speed: 200, size: 4, life: 0.9, color: [ant.colors.body, '#ffffff', '#ffd166'] });
        Particles.floatText(ant.x, ant.y - 70, ant.name + ' DOWN!', '#ffffff', 24);
        Sfx.play('hurt');
        if (ant.team !== owner.team) game.addScore(500, 'elimination');
      }
    }
  }
  // A crater under a living ant drops it: physics in the update loop handles
  // the fall; mark every ant for a ground re-check.
  for (const ant of game.ants) {
    if (ant.alive && ant.y < terrain.surfaceY(ant.x) - 1) ant.falling = true;
  }
  return hits;
}
