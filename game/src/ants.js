// Ant fighters for SEEDSTORM: one class for both colonies. Ants are drawn
// procedurally (three body segments, six animated legs, wobbling antennae, a
// leaf helmet), fall with gravity when the ground beneath them is destroyed,
// take damage from long falls, and are eliminated instantly when they drop
// into a pit below the world.
const ANT_GRAVITY = 1400;
const ANT_FALL_HURT_VY = 520; // landing faster than this hurts
const ANT_NAMES = {
  amber: ['Pip', 'Nib', 'Zara'],
  crimson: ['Rux', 'Vexa', 'Krag']
};
const ANT_COLORS = {
  amber: { body: '#e8912d', dark: '#b96a17', light: '#f7b95c', belly: '#f9d9a0', rim: '#7a4a12' },
  crimson: { body: '#d63d3d', dark: '#a32424', light: '#f06a5e', belly: '#f6b8a8', rim: '#6e1414' }
};

function Ant(team, index, x, terrain) {
  this.team = team; // 'amber' (player) or 'crimson' (AI)
  this.index = index;
  this.name = ANT_NAMES[team][index];
  this.colors = ANT_COLORS[team];
  this.x = x;
  this.y = terrain.surfaceY(x);
  this.vy = 0;
  this.falling = false;
  this.fallStartY = this.y;
  this.hp = 100;
  this.maxHp = 100;
  this.alive = true;
  this.facing = team === 'amber' ? 1 : -1;
  this.frozen = 0; // turns remaining frozen
  this.honeyed = 0; // turns remaining slowed by honey
  this.walkPhase = Math.random() * Math.PI * 2;
  this.moving = false;
  this.squash = 0; // squash-and-stretch impulse, decays to 0
  this.hurtFlash = 0;
  this.spawnX = x;
}

Ant.prototype.groundY = function (terrain) {
  return terrain.surfaceY(this.x);
};

// Gravity + landing. A column carved all the way through is a pit: there is
// no ground there, so the ant keeps falling until it drops out of the world.
// Returns an event object when something notable happens:
// {landed, fallDamage} or {pit} when the ant falls out of the world.
Ant.prototype.updatePhysics = function (dt, terrain) {
  if (!this.alive) return null;
  const hole = terrain.isHole(this.x);
  const gy = hole ? PIT_Y + 60 : terrain.surfaceY(this.x);
  if (this.y < gy - 1 || this.falling) {
    if (!this.falling) { this.falling = true; this.fallStartY = this.y; this.vy = 0; }
    this.vy += ANT_GRAVITY * dt;
    this.y += this.vy * dt;
    if (this.y >= gy) {
      this.y = gy;
      this.falling = false;
      const impact = this.vy;
      this.vy = 0;
      this.squash = Math.min(0.5, impact / 1600);
      if (impact > ANT_FALL_HURT_VY) {
        const dmg = Math.round((impact - ANT_FALL_HURT_VY) / 26);
        return { landed: true, fallDamage: dmg, impact: impact };
      }
      return { landed: true, fallDamage: 0, impact: impact };
    }
    if (this.y > PIT_Y) {
      this.alive = false;
      return { pit: true };
    }
    return null;
  }
  // Resting on the ground: snap to the surface (terrain may have shifted).
  this.y = gy;
  this.vy = 0;
  return null;
};

Ant.prototype.walk = function (dx, terrain) {
  if (!this.alive || this.falling) return 0;
  const speed = this.honeyed > 0 ? 0.55 : 1;
  const step = dx * speed;
  const nx = Math.max(14, Math.min(1266, this.x + step));
  const ny = terrain.surfaceY(nx);
  // Ants climb gentle slopes but not cliffs: a rise of more than 26 px in one
  // step blocks the walk (the ant must jump instead).
  if (ny < this.y - 26) return 0;
  const moved = Math.abs(nx - this.x);
  this.x = nx;
  this.y = ny;
  if (moved > 0.01) {
    this.facing = step > 0 ? 1 : -1;
    this.moving = true;
    this.walkPhase += moved * 0.09;
  }
  return moved;
};

Ant.prototype.jump = function () {
  if (!this.alive || this.falling) return false;
  this.falling = true;
  this.fallStartY = this.y;
  this.vy = -420;
  this.y -= 2;
  this.squash = -0.25;
  return true;
};

Ant.prototype.damage = function (amount) {
  if (!this.alive) return 0;
  const dealt = Math.min(this.hp, Math.max(0, Math.round(amount)));
  this.hp -= dealt;
  this.hurtFlash = 0.35;
  this.squash = Math.min(0.5, this.squash + 0.25);
  if (this.hp <= 0) { this.hp = 0; this.alive = false; }
  return dealt;
};

Ant.prototype.heal = function (amount) {
  if (!this.alive) return 0;
  const healed = Math.min(this.maxHp - this.hp, amount);
  this.hp += healed;
  return healed;
};

Ant.prototype.updateVisual = function (dt) {
  this.squash *= Math.max(0, 1 - dt * 6);
  this.hurtFlash = Math.max(0, this.hurtFlash - dt);
  if (!this.moving) this.walkPhase += dt * 1.2; // idle leg shuffle
  this.moving = false;
};

// The muzzle point for shots: just ahead of the head, at head height.
Ant.prototype.muzzle = function () {
  return { x: this.x + this.facing * 16, y: this.y - 30 };
};

Ant.prototype.draw = function (ctx, time, isActive) {
  if (!this.alive) return;
  const c = this.colors;
  const sq = this.squash;
  ctx.save();
  ctx.translate(this.x, this.y);
  // Soft shadow on the ground.
  ctx.fillStyle = 'rgba(20,10,4,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 2, 20, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.scale(1 + sq * 0.5, 1 - sq * 0.5);
  if (this.facing < 0) ctx.scale(-1, 1);
  const legSwing = Math.sin(this.walkPhase) * 4;
  const legSwing2 = Math.sin(this.walkPhase + Math.PI) * 4;
  // Legs (behind the body).
  ctx.strokeStyle = c.dark;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  const legSets = [[-8, legSwing], [0, legSwing2], [8, legSwing]];
  for (const pair of legSets) {
    const lx = pair[0], sw = pair[1];
    ctx.beginPath();
    ctx.moveTo(lx, -10);
    ctx.lineTo(lx + sw * 0.5 - 4, -3);
    ctx.lineTo(lx + sw - 7, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(lx, -10);
    ctx.lineTo(lx + sw * 0.5 + 5, -2);
    ctx.lineTo(lx + sw + 8, 0);
    ctx.stroke();
  }
  // Abdomen (rear).
  const grad = ctx.createRadialGradient(-14, -20, 2, -14, -18, 16);
  grad.addColorStop(0, c.light);
  grad.addColorStop(0.6, c.body);
  grad.addColorStop(1, c.dark);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(-15, -17, 13, 11, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = c.rim;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // Abdomen stripes.
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(-15, -17, 8.5, -0.6, 0.9); ctx.stroke();
  ctx.beginPath(); ctx.arc(-15, -17, 5, -0.6, 0.9); ctx.stroke();
  // Thorax (middle).
  ctx.fillStyle = c.body;
  ctx.beginPath();
  ctx.ellipse(-1, -14, 8, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = c.rim;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // Head.
  const headGrad = ctx.createRadialGradient(10, -24, 2, 10, -22, 12);
  headGrad.addColorStop(0, c.light);
  headGrad.addColorStop(0.7, c.body);
  headGrad.addColorStop(1, c.dark);
  ctx.fillStyle = headGrad;
  ctx.beginPath();
  ctx.arc(10, -22, 9.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = c.rim;
  ctx.stroke();
  // Antennae, wobbling with idle life.
  const wob = Math.sin(time * 3.1 + this.index * 1.7) * 0.16;
  ctx.strokeStyle = c.dark;
  ctx.lineWidth = 1.8;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(10 + side * 3, -30);
    ctx.quadraticCurveTo(13 + side * 4, -40 - wob * 8, 17 + side * 6 + wob * 10, -43);
    ctx.stroke();
    ctx.fillStyle = c.dark;
    ctx.beginPath();
    ctx.arc(17 + side * 6 + wob * 10, -43, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  // Leaf helmet: the colony's mark, amber leaf for amber, red leaf for crimson.
  ctx.fillStyle = this.team === 'amber' ? '#7fb069' : '#c65b4e';
  ctx.beginPath();
  ctx.ellipse(8, -30, 8, 4.5, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Eye.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(13, -23, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1d1206';
  ctx.beginPath();
  ctx.arc(14, -23, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(14.8, -24, 0.8, 0, Math.PI * 2);
  ctx.fill();
  // Mandibles.
  ctx.strokeStyle = c.dark;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(18, -18);
  ctx.quadraticCurveTo(23, -16, 22, -12);
  ctx.stroke();
  // Hurt flash.
  if (this.hurtFlash > 0) {
    ctx.globalAlpha = Math.min(0.7, this.hurtFlash * 2);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(-2, -18, 24, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  // Frozen overlay: ice shell + crystals.
  if (this.frozen > 0) {
    ctx.save();
    ctx.translate(this.x, this.y - 18);
    ctx.fillStyle = 'rgba(170,220,255,0.4)';
    ctx.strokeStyle = 'rgba(230,248,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 26, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-18, -14); ctx.lineTo(-10, -20); ctx.lineTo(-14, -10);
    ctx.moveTo(16, -18); ctx.lineTo(10, -24); ctx.lineTo(8, -14);
    ctx.stroke();
    ctx.restore();
  }
  // Honey overlay: amber drips.
  if (this.honeyed > 0) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.fillStyle = 'rgba(240,170,40,0.55)';
    ctx.beginPath();
    ctx.ellipse(0, -30, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-7, -30, 3, 12);
    ctx.fillRect(3, -30, 2.4, 17);
    ctx.beginPath();
    ctx.arc(-5.5, -17, 2.4, 0, Math.PI * 2);
    ctx.arc(4.2, -12, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Active-ant arrow + ring.
  if (isActive) {
    const bob = Math.sin(time * 4) * 3;
    ctx.save();
    ctx.translate(this.x, this.y - 56 + bob);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(30,18,8,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.lineTo(-8, -4);
    ctx.lineTo(8, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 2, 24, 6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Small HP bar above the ant.
  if (this.hp < this.maxHp || isActive) {
    const w = 38, h = 5;
    const bx = this.x - w / 2, by = this.y - 50;
    ctx.fillStyle = 'rgba(20,12,6,0.75)';
    ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
    const frac = this.hp / this.maxHp;
    ctx.fillStyle = frac > 0.5 ? '#7bc950' : (frac > 0.25 ? '#ffb627' : '#e5484d');
    ctx.fillRect(bx, by, w * frac, h);
  }
};
