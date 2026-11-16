// SEEDSTORM — turn-based ant artillery across a destructible garden.
// Main game: state machine, turns, input, campaign. Rendering of the HUD and
// screens lives in the second half of this file; the world simulation lives
// in terrain.js, ants.js and weapons.js; the opponent in ai.js.
const W = 1280;
const H = 720;
const DEFAULT_SEED = 20261116;
const STAMINA_MAX = 100;
const FIRE_COST = 30;
const JUMP_COST = 20;
const WALK_DRAIN = 0.32; // stamina per pixel walked

function urlParams() {
  const out = {};
  try {
    const q = window.location.search.replace(/^\?/, '');
    for (const part of q.split('&')) {
      if (!part) continue;
      const kv = part.split('=');
      out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    }
  } catch (e) { /* file protocol without query support */ }
  return out;
}

const PARAMS = urlParams();
const GAME_SEED = (parseInt(PARAMS.seed, 10) || DEFAULT_SEED) >>> 0;

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const G = {
  screen: 'title', // title | howto | playing | paused | upgrade | levelEnd | campaignWin
  phase: 'aim', // intro | aim | flying | settling | ai | done
  prevScreen: 'title',
  showHelp: false,
  time: 0,
  seed: GAME_SEED,
  rng: makeRng(GAME_SEED),
  levelIndex: 0,
  levelDef: LEVELS[0],
  terrain: null,
  ants: [],
  projectiles: [],
  crates: [],
  turn: 'amber',
  turnCount: 0,
  activeAnt: null,
  antCycle: { amber: 0, crimson: 0 },
  stamina: STAMINA_MAX,
  rage: { amber: 0, crimson: 0 },
  wind: 0,
  score: 0,
  bestScore: 0,
  campaign: newCampaign(),
  difficultyMode: 'classic', // relaxed | classic | expert
  aiLevel: 'scout',
  damageMul: 1,
  selectedWeapon: 'bazooka',
  selectedItem: null,
  targeting: null, // 'freeze' | 'glider' | null
  pendingSplit: false,
  extraShot: false,
  items: { amber: {}, crimson: {} },
  levelStats: { damage: 0, kills: 0, shots: 0, hits: 0 },
  volleyId: 0,
  lastHitVolley: -1,
  banner: null,
  message: null,
  clouds: [],
  ambient: [],
  aiPlan: null,
  aiTimer: 0,
  aiStep: 0,
  skipTimer: 0,
  settleTimer: 0,
  introTimer: 0,
  endInfo: null,
  upgradeChoices: [],
  mouse: { x: 0, y: 0, down: false },
  keys: {},
  drag: null,
  touch: { left: false, right: false, fire: false },
  touchButtons: [],
  activePointers: {},
  aim: { angle: 58, power: 62 },
  uiButtons: [],
  readyAt: -1,
  shotReady: false,
  scenePreset: PARAMS.scene || null,
  muted: false
};

try {
  const saved = window.localStorage.getItem('seedstorm_best');
  if (saved) G.bestScore = parseInt(saved, 10) || 0;
} catch (e) { /* storage unavailable: best score stays session-only */ }

function saveBest() {
  if (G.score <= G.bestScore) return;
  G.bestScore = G.score;
  try { window.localStorage.setItem('seedstorm_best', String(G.bestScore)); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function fitCanvas() {
  const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.style.width = Math.floor(W * scale) + 'px';
  canvas.style.height = Math.floor(H * scale) + 'px';
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

// Touch devices get on-screen walk/jump/fire buttons; desktop keeps
// mouse + keyboard only and never sees them.
const IS_TOUCH = ('ontouchstart' in window) || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);

function canvasPos(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (clientX - r.left) * (W / r.width),
    y: (clientY - r.top) * (H / r.height)
  };
}

// ---------------------------------------------------------------------------
// Background: sky, sun/moon, hills, clouds, weather ambience
// ---------------------------------------------------------------------------
function buildSky(levelDef, rng) {
  G.clouds = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    G.clouds.push({
      x: rng.range(0, W), y: rng.range(36, 170),
      scale: rng.range(0.7, 1.5), speed: rng.range(3, 9)
    });
  }
  G.ambient = [];
  const amb = levelDef.ambient;
  const count = amb === 'rain' ? 130 : 46;
  for (let i = 0; i < count; i++) {
    G.ambient.push({
      x: rng.range(0, W), y: rng.range(0, H),
      s: rng.range(1, 3), ph: rng.range(0, Math.PI * 2),
      vy: amb === 'rain' ? rng.range(420, 620) : rng.range(6, 18)
    });
  }
}

function drawCloud(ctx2, x, y, s, color) {
  ctx2.fillStyle = color;
  ctx2.beginPath();
  ctx2.arc(x, y, 20 * s, 0, Math.PI * 2);
  ctx2.arc(x + 24 * s, y - 8 * s, 24 * s, 0, Math.PI * 2);
  ctx2.arc(x + 52 * s, y, 19 * s, 0, Math.PI * 2);
  ctx2.arc(x + 26 * s, y + 8 * s, 22 * s, 0, Math.PI * 2);
  ctx2.fill();
}

function drawHills(ctx2, def, time) {
  // Far hills.
  ctx2.fillStyle = def.hillFar;
  ctx2.beginPath();
  ctx2.moveTo(0, 470);
  for (let x = 0; x <= W; x += 16) {
    ctx2.lineTo(x, 430 - Math.sin(x * 0.006 + 1.2) * 42 - Math.sin(x * 0.013) * 18);
  }
  ctx2.lineTo(W, 560);
  ctx2.lineTo(0, 560);
  ctx2.closePath();
  ctx2.fill();
  // Near hills.
  ctx2.fillStyle = def.hillNear;
  ctx2.beginPath();
  ctx2.moveTo(0, 520);
  for (let x = 0; x <= W; x += 16) {
    ctx2.lineTo(x, 490 - Math.sin(x * 0.008 + 4.0) * 34 - Math.sin(x * 0.02 + 1.0) * 10);
  }
  ctx2.lineTo(W, 600);
  ctx2.lineTo(0, 600);
  ctx2.closePath();
  ctx2.fill();
}

function drawBackground(dt) {
  const def = G.levelDef;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, def.skyTop);
  grad.addColorStop(0.55, def.skyMid);
  grad.addColorStop(1, def.skyBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // Stars on the night garden.
  if (def.weather === 'night' || def.weather === 'dusk') {
    ctx.fillStyle = def.weather === 'night' ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 60; i++) {
      const sx = (i * 173 + 41) % W;
      const sy = (i * 97 + 13) % 210;
      const tw = 0.6 + 0.4 * Math.sin(G.time * 2 + i);
      ctx.globalAlpha = tw * (def.weather === 'night' ? 0.9 : 0.4);
      ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
  // Sun or moon with glow.
  if (def.sun) {
    const s = def.sun;
    const glow = ctx.createRadialGradient(s.x, s.y, 8, s.x, s.y, 120);
    glow.addColorStop(0, s.glow);
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(s.x - 120, s.y - 120, 240, 240);
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.moon ? 34 : 40, 0, Math.PI * 2);
    ctx.fill();
    if (s.moon) {
      ctx.fillStyle = 'rgba(120,130,170,0.5)';
      ctx.beginPath();
      ctx.arc(s.x - 10, s.y - 6, 7, 0, Math.PI * 2);
      ctx.arc(s.x + 12, s.y + 10, 5, 0, Math.PI * 2);
      ctx.arc(s.x + 8, s.y - 14, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Clouds drift with the wind.
  const cloudColor = def.weather === 'night' ? 'rgba(90,100,150,0.5)' : (def.weather === 'rain' ? 'rgba(210,220,225,0.75)' : 'rgba(255,255,255,0.85)');
  for (const c of G.clouds) {
    c.x += (c.speed + G.wind * 4) * dt;
    if (c.x > W + 90) c.x = -90;
    if (c.x < -100) c.x = W + 80;
    drawCloud(ctx, c.x, c.y, c.scale, cloudColor);
  }
  drawHills(ctx, def, G.time);
  // Weather ambience.
  if (def.ambient === 'rain') {
    ctx.strokeStyle = 'rgba(200,220,235,0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const p of G.ambient) {
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 3 - G.wind, p.y + 14);
    }
    ctx.stroke();
  } else if (def.ambient === 'fireflies') {
    for (const p of G.ambient) {
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(G.time * 1.5 + p.ph));
      ctx.fillStyle = 'rgba(255,240,150,' + (0.75 * tw).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(p.x + Math.sin(G.time * 0.6 + p.ph) * 14, p.y + Math.cos(G.time * 0.8 + p.ph) * 8, p.s + 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (def.ambient === 'dust') {
    ctx.fillStyle = 'rgba(230,200,140,0.35)';
    for (const p of G.ambient) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Pollen sparkles.
    for (const p of G.ambient) {
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(G.time + p.ph));
      ctx.fillStyle = 'rgba(255,250,210,' + (0.6 * tw).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function updateAmbient(dt) {
  const def = G.levelDef;
  for (const p of G.ambient) {
    p.x += G.wind * 10 * dt + (def.ambient === 'dust' ? 14 * dt : 0);
    p.y += p.vy * dt;
    if (def.ambient === 'rain') {
      if (p.y > H) { p.y = -10; p.x = Math.random() * W; }
    } else {
      if (p.y > H) p.y = -6;
    }
    if (p.x > W + 10) p.x = -10;
    if (p.x < -10) p.x = W + 10;
  }
}

// ---------------------------------------------------------------------------
// Level setup
// ---------------------------------------------------------------------------
function aiLevelFor(levelDef) {
  if (G.difficultyMode === 'relaxed') return 'scout';
  if (G.difficultyMode === 'expert') return 'general';
  return levelDef.aiLevel;
}

function startLevel(index) {
  G.levelIndex = index;
  G.levelDef = LEVELS[index];
  G.aiLevel = aiLevelFor(G.levelDef);
  const genRng = makeRng((G.seed + index * 104729) >>> 0);
  G.terrain = new Terrain(genRng, G.levelDef, W);
  buildSky(G.levelDef, genRng);
  G.ants = [];
  const camps = { amber: [150, 235, 320], crimson: [960, 1045, 1130] };
  for (let i = 0; i < 3; i++) {
    const a = new Ant('amber', i, camps.amber[i] + genRng.int(-14, 14), G.terrain);
    a.maxHp = 100 + G.campaign.hpBonus;
    a.hp = a.maxHp;
    G.ants.push(a);
  }
  for (let i = 0; i < 3; i++) {
    const a = new Ant('crimson', i, camps.crimson[i] + genRng.int(-14, 14), G.terrain);
    G.ants.push(a);
  }
  G.projectiles = [];
  G.crates = [];
  G.items = {
    amber: { double: 1, split: G.campaign.startSplit, freeze: 1, glider: 1, repair: 1 + G.campaign.startRepair },
    crimson: { double: 1, split: 0, freeze: 1, glider: 0, repair: 1 }
  };
  G.rage = { amber: 0, crimson: 0 };
  G.turn = 'amber';
  G.turnCount = 0;
  G.antCycle = { amber: 0, crimson: 0 };
  G.levelStats = { damage: 0, kills: 0, shots: 0, hits: 0 };
  G.volleyId = 0;
  G.lastHitVolley = -1;
  G.selectedWeapon = 'bazooka';
  G.selectedItem = null;
  G.targeting = null;
  G.pendingSplit = false;
  G.extraShot = false;
  G.endInfo = null;
  Particles.clear();
  rollWind();
  G.screen = 'playing';
  G.phase = 'intro';
  G.introTimer = 2.0;
  G.banner = { text: 'LEVEL ' + (index + 1) + ': ' + G.levelDef.name, sub: G.levelDef.subtitle, timer: 2.2 };
  G.activeAnt = G.ants[0];
  G.stamina = staminaMax();
  G.damageMul = 1 + G.campaign.damageBonus;
}

function staminaMax() {
  return STAMINA_MAX + G.campaign.staminaBonus;
}

function rollWind() {
  const max = G.levelDef.windMax;
  G.wind = G.rng.int(-max, max);
}

function livingAnts(team) {
  return G.ants.filter(function (a) { return a.alive && a.team === team; });
}

function nextAnt(team) {
  const alive = livingAnts(team);
  if (alive.length === 0) return null;
  G.antCycle[team] = G.antCycle[team] % alive.length;
  const ant = alive[G.antCycle[team]];
  G.antCycle[team] = (G.antCycle[team] + 1) % alive.length;
  return ant;
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------
function startTurn() {
  G.turnCount++;
  G.activeAnt = nextAnt(G.turn);
  if (!G.activeAnt) { checkLevelEnd(); return; }
  rollWind();
  G.stamina = G.activeAnt.honeyed > 0 ? Math.round(staminaMax() * 0.7) : staminaMax();
  if (G.activeAnt.honeyed > 0) G.activeAnt.honeyed--;
  G.damageMul = G.turn === 'amber' ? 1 + G.campaign.damageBonus : 1;
  G.selectedWeapon = 'bazooka';
  G.selectedItem = null;
  G.targeting = null;
  G.pendingSplit = false;
  G.extraShot = false;
  G.aim.angle = 58;
  G.aim.power = 62;
  // Frozen ants lose the turn.
  if (G.activeAnt.frozen > 0) {
    G.activeAnt.frozen--;
    G.banner = { text: G.activeAnt.name + ' IS FROZEN!', sub: 'The turn passes...', timer: 1.4 };
    Sfx.play('freeze');
    G.skipTimer = 1.4;
    G.phase = 'settling';
    return;
  }
  G.banner = {
    text: (G.turn === 'amber' ? 'YOUR TURN — ' : 'ENEMY TURN — ') + G.activeAnt.name,
    sub: G.turn === 'amber' ? 'Move, aim, fire!' : 'The crimson colony plots...',
    timer: 1.3
  };
  Sfx.play('turn');
  if (G.turn === 'amber') {
    G.phase = 'aim';
  } else {
    G.phase = 'ai';
    G.aiPlan = planAiTurn(G, G.activeAnt);
    G.aiTimer = AI_DIFFICULTY[G.aiLevel].thinkMs / 1000;
    G.aiStep = 0;
  }
  // Supply crate schedule: every 3rd turn, or every 2nd with Supply Lines.
  const every = G.campaign.crateBonus > 0 ? 2 : 3;
  if (G.turnCount % every === 0 && G.crates.length < 2) spawnCrate();
}

function endTurn() {
  if (G.phase === 'done') return;
  if (checkLevelEnd()) return;
  G.turn = G.turn === 'amber' ? 'crimson' : 'amber';
  startTurn();
}

function checkLevelEnd() {
  const amberAlive = livingAnts('amber').length;
  const crimsonAlive = livingAnts('crimson').length;
  if (amberAlive === 0 || crimsonAlive === 0) {
    G.phase = 'done';
    const won = crimsonAlive === 0;
    const stars = won ? (amberAlive === 3 ? 3 : (amberAlive === 2 ? 2 : 1)) : 0;
    let bonus = 0;
    if (won) {
      bonus = 1000 + stars * 250;
      const acc = G.levelStats.shots > 0 ? G.levelStats.hits / G.levelStats.shots : 0;
      if (acc >= 0.6) bonus += 300;
      G.score += bonus;
      G.campaign.stars[G.levelIndex] = Math.max(G.campaign.stars[G.levelIndex], stars);
    }
    saveBest();
    G.endInfo = {
      won: won, stars: stars, bonus: bonus,
      stats: { damage: G.levelStats.damage, kills: G.levelStats.kills, shots: G.levelStats.shots, hits: G.levelStats.hits }
    };
    Sfx.play(won ? 'victory' : 'defeat');
    G.screen = 'levelEnd';
    return true;
  }
  return false;
}

function addScore(points, kind) {
  G.score += points;
  if (kind === 'damage') G.levelStats.damage += Math.round(points / 10);
  if (kind === 'elimination') G.levelStats.kills++;
}

function addRage(amount) {
  const mul = G.turn === 'amber' ? 1 + G.campaign.rageBonus : 1;
  G.rage[G.turn] = Math.min(100, G.rage[G.turn] + amount * mul);
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------
function canFire() {
  return G.phase === 'aim' && G.turn === 'amber' && G.activeAnt && G.activeAnt.alive && G.stamina >= FIRE_COST;
}

function fire(angleDeg, power, weaponId) {
  const ant = G.activeAnt;
  if (!ant || !ant.alive) return false;
  const weapon = weaponById(weaponId || G.selectedWeapon);
  if (weapon.rageOnly && G.rage[G.turn] < 100) return false;
  if (G.turn === 'amber' && G.stamina < FIRE_COST) {
    G.message = { text: 'Not enough stamina to fire!', timer: 1.4 };
    return false;
  }
  if (G.turn === 'amber') G.stamina -= FIRE_COST;
  if (weapon.rageOnly) G.rage[G.turn] = 0;
  const muzzle = ant.muzzle();
  ant.facing = (ant.facing === 0) ? 1 : ant.facing;
  const facing = ant.facing;
  const count = weapon.count;
  for (let i = 0; i < count; i++) {
    let a = angleDeg;
    if (count > 1) a = angleDeg + (i - (count - 1) / 2) * (weapon.spread || 0.09) * 57.3;
    const v = aimVelocity(a, power, facing, weapon);
    const splitArmed = G.pendingSplit || !!weapon.splitAtApex;
    G.projectiles.push(new Projectile(muzzle.x, muzzle.y, v.vx, v.vy, weapon, ant, { splitArmed: splitArmed }));
  }
  G.pendingSplit = false;
  G.volleyId++;
  G.levelStats.shots++;
  ant.squash = 0.4;
  Particles.burst(muzzle.x, muzzle.y, { count: 10, speed: 120, size: 4, life: 0.3, color: ['#fff3c4', '#ffd27a'], gravity: 0 });
  Sfx.play('launch');
  G.phase = 'flying';
  G.drag = null;
  return true;
}

// Split one projectile into three bomblets at its apex (Acorn Mortar and the
// Triple Split item). The original projectile is consumed.
function splitProjectile(proj) {
  proj.dead = true;
  const weapon = proj.weapon;
  const bombletWeapon = {
    id: weapon.id + '-bit', name: weapon.name, key: weapon.key,
    damage: Math.max(8, Math.round(weapon.damage * 0.55)), radius: Math.max(24, weapon.radius - 8),
    crater: Math.max(14, weapon.crater - 8), speed: 1, count: 1,
    color: weapon.color, trail: weapon.trail, size: 4, shake: 0.2,
    honey: !!weapon.honey
  };
  for (let i = -1; i <= 1; i++) {
    const vx = proj.vx * 0.55 + i * 90;
    const vy = -40 - Math.abs(i) * 30;
    G.projectiles.push(new Projectile(proj.x, proj.y, vx, vy, bombletWeapon, proj.owner, { bomblet: true }));
  }
  Particles.burst(proj.x, proj.y, { count: 12, speed: 90, size: 3, life: 0.4, color: [weapon.trail, '#ffffff'], gravity: 0 });
  Sfx.play('ui');
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------
const ITEM_DEFS = {
  double: { name: 'Double Shot', icon: '+1', desc: 'Fire twice this turn.' },
  split: { name: 'Triple Split', icon: '∴', desc: 'Next shot splits into 3 mid-flight.' },
  freeze: { name: 'Frost Nectar', icon: '❄', desc: 'Freeze one enemy for its next turn.' },
  glider: { name: 'Leaf Glider', icon: '➶', desc: 'Teleport the active ant to clicked ground.' },
  repair: { name: 'Repair Nectar', icon: '+', desc: 'Heal the active ant for 30 HP.' }
};

function useItem(itemId, targetX, targetY) {
  const team = G.turn;
  const inv = G.items[team];
  if (!inv || !inv[itemId] || inv[itemId] <= 0) return false;
  const ant = G.activeAnt;
  if (!ant || !ant.alive) return false;
  if (itemId === 'double') {
    inv.double--;
    G.extraShot = true;
    G.message = { text: 'Double Shot armed — fire twice!', timer: 1.6 };
    Sfx.play('pickup');
    return true;
  }
  if (itemId === 'split') {
    inv.split--;
    G.pendingSplit = true;
    G.message = { text: 'Triple Split armed — next shot splits!', timer: 1.6 };
    Sfx.play('pickup');
    return true;
  }
  if (itemId === 'repair') {
    if (ant.hp >= ant.maxHp) { G.message = { text: ant.name + ' is already at full health.', timer: 1.4 }; return false; }
    inv.repair--;
    const healed = ant.heal(30);
    Particles.floatText(ant.x, ant.y - 62, '+' + healed + ' HP', '#7bc950', 22);
    Particles.burst(ant.x, ant.y - 20, { count: 16, speed: 80, size: 3.5, life: 0.7, color: ['#7bc950', '#d8f3c0'], gravity: -40 });
    Sfx.play('heal');
    return true;
  }
  if (itemId === 'freeze') {
    if (targetX === undefined) { G.targeting = 'freeze'; G.selectedItem = 'freeze'; return true; }
    const foe = G.ants.find(function (a) { return a.alive && a.team !== team && Math.hypot(a.x - targetX, (a.y - 18) - targetY) < 34; });
    if (!foe) { G.message = { text: 'Click an enemy ant to freeze it.', timer: 1.4 }; return false; }
    inv.freeze--;
    foe.frozen = 1;
    Particles.floatText(foe.x, foe.y - 62, 'FROZEN!', '#aadcff', 20);
    Particles.burst(foe.x, foe.y - 18, { count: 20, speed: 110, size: 3.5, life: 0.6, color: ['#aadcff', '#ffffff'] });
    Sfx.play('freeze');
    G.targeting = null;
    G.selectedItem = null;
    return true;
  }
  if (itemId === 'glider') {
    if (targetX === undefined) { G.targeting = 'glider'; G.selectedItem = 'glider'; return true; }
    if (G.stamina < 10) { G.message = { text: 'Not enough stamina to glide.', timer: 1.4 }; return false; }
    const nx = Math.max(14, Math.min(1266, targetX));
    if (G.terrain.isHole(nx)) { G.message = { text: 'No ground there to land on!', timer: 1.4 }; return false; }
    inv.glider--;
    G.stamina -= 10;
    Particles.burst(ant.x, ant.y - 18, { count: 18, speed: 100, size: 3.5, life: 0.6, color: ['#a7c957', '#ffffff'] });
    ant.x = nx;
    ant.y = G.terrain.surfaceY(nx);
    ant.falling = false;
    ant.vy = 0;
    Particles.burst(ant.x, ant.y - 18, { count: 18, speed: 100, size: 3.5, life: 0.6, color: ['#a7c957', '#ffffff'] });
    Sfx.play('teleport');
    G.targeting = null;
    G.selectedItem = null;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Supply crates: parachute down pushed by the wind, grant a random item.
// ---------------------------------------------------------------------------
function spawnCrate() {
  const x = G.rng.range(140, W - 140);
  G.crates.push({
    x: x, y: -30, vy: 0, landed: false, age: 0,
    item: G.rng.pick(['double', 'split', 'freeze', 'glider', 'repair']),
    sway: G.rng.range(0, Math.PI * 2)
  });
  G.message = { text: 'A supply crate is drifting down!', timer: 1.8 };
}

function updateCrates(dt) {
  for (let i = G.crates.length - 1; i >= 0; i--) {
    const c = G.crates[i];
    c.age += dt;
    if (!c.landed) {
      c.vy = Math.min(95, c.vy + 160 * dt);
      c.y += c.vy * dt;
      c.x += (G.wind * 16 + Math.sin(G.time * 2 + c.sway) * 12) * dt;
      c.x = Math.max(20, Math.min(W - 20, c.x));
      const gy = G.terrain.surfaceY(c.x);
      if (c.y >= gy - 14) {
        c.y = gy - 14;
        c.landed = true;
        Particles.burst(c.x, gy, { count: 8, speed: 70, size: 3, life: 0.5, color: ['#c9a06a', '#8a5a33'] });
      }
    } else {
      // Pickup: any living ant walking over it claims the item for its team.
      for (const ant of G.ants) {
        if (!ant.alive) continue;
        if (Math.abs(ant.x - c.x) < 26 && Math.abs(ant.y - 14 - c.y) < 30) {
          G.items[ant.team][c.item] = (G.items[ant.team][c.item] || 0) + 1;
          Particles.floatText(c.x, c.y - 20, ITEM_DEFS[c.item].name + '!', '#ffd166', 18);
          Particles.burst(c.x, c.y, { count: 16, speed: 110, size: 3.5, life: 0.6, color: ['#ffd166', '#ffffff'] });
          Sfx.play('pickup');
          G.crates.splice(i, 1);
          break;
        }
      }
      if (c.age > 26) G.crates.splice(i, 1); // stale crates fade away
    }
  }
}

function drawCrates() {
  for (const c of G.crates) {
    if (!c.landed) {
      // Parachute canopy.
      ctx.fillStyle = '#e8e0d0';
      ctx.strokeStyle = 'rgba(60,40,20,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(c.x, c.y - 22, 20, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d64545';
      ctx.beginPath();
      ctx.arc(c.x, c.y - 22, 20, Math.PI * 1.25, Math.PI * 1.75);
      ctx.lineTo(c.x, c.y - 22);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,40,20,0.6)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(c.x - 18, c.y - 22); ctx.lineTo(c.x - 9, c.y - 8);
      ctx.moveTo(c.x + 18, c.y - 22); ctx.lineTo(c.x + 9, c.y - 8);
      ctx.stroke();
    }
    // Wooden box with a glowing item glyph.
    ctx.fillStyle = '#a9743b';
    ctx.strokeStyle = '#5d3d22';
    ctx.lineWidth = 2;
    ctx.fillRect(c.x - 11, c.y - 10, 22, 20);
    ctx.strokeRect(c.x - 11, c.y - 10, 22, 20);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.moveTo(c.x - 11, c.y); ctx.lineTo(c.x + 11, c.y);
    ctx.stroke();
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 13px Trebuchet MS, Verdana, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('?', c.x, c.y + 5);
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  KeyQ: 'powerDown', KeyE: 'powerUp'
};

document.addEventListener('keydown', function (e) {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
  Sfx.unlock();
  G.keys[e.code] = true;
  const mapped = KEYMAP[e.code];
  if (mapped) G.keys[mapped] = true;
  if (e.code === 'KeyM') { G.muted = Sfx.toggleMuted(); return; }
  if (e.code === 'KeyH') { toggleHelp(); return; }
  if (e.code === 'Escape') {
    if (G.showHelp) { G.showHelp = false; return; }
    if (G.targeting) { G.targeting = null; G.selectedItem = null; return; }
    togglePause();
    return;
  }
  if (e.code === 'KeyP') { togglePause(); return; }
  if (G.screen !== 'playing' || G.showHelp) return;
  if (e.code === 'Space') {
    if (canFire()) fire(G.aim.angle, G.aim.power, G.selectedWeapon);
    return;
  }
  if (e.code === 'Enter' || e.code === 'KeyN') {
    if (G.phase === 'aim' && G.turn === 'amber') endTurn();
    return;
  }
  if (e.code === 'KeyJ' || e.code === 'KeyX') {
    if (G.phase === 'aim' && G.activeAnt && G.stamina >= JUMP_COST && G.activeAnt.jump()) {
      G.stamina -= JUMP_COST;
      Sfx.play('jump');
    }
    return;
  }
  if (e.code === 'KeyF' && G.phase === 'aim' && G.activeAnt) {
    G.activeAnt.facing *= -1;
    return;
  }
  if (e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5), 10);
    if (n >= 1 && n <= 6 && G.phase === 'aim') {
      const w = WEAPONS[n - 1];
      if (w.rageOnly && G.rage[G.turn] < 100) {
        G.message = { text: 'Rage Burst needs a full rage bar!', timer: 1.4 };
      } else {
        G.selectedWeapon = w.id;
        Sfx.play('ui');
      }
    }
    return;
  }
  if (e.code === 'Tab' && G.phase === 'aim') {
    cycleItem();
    return;
  }
  if (e.code === 'KeyU' && G.phase === 'aim' && G.selectedItem) {
    useItem(G.selectedItem);
    return;
  }
});

document.addEventListener('keyup', function (e) {
  G.keys[e.code] = false;
  const mapped = KEYMAP[e.code];
  if (mapped) G.keys[mapped] = false;
});

function cycleItem() {
  const inv = G.items.amber;
  const ids = Object.keys(ITEM_DEFS).filter(function (id) { return inv[id] > 0; });
  if (ids.length === 0) return;
  const cur = ids.indexOf(G.selectedItem);
  G.selectedItem = ids[(cur + 1) % ids.length];
  Sfx.play('ui');
}

function toggleHelp() {
  if (G.screen === 'playing' || G.screen === 'paused') {
    G.showHelp = !G.showHelp;
    Sfx.play('ui');
  } else if (G.screen === 'title') {
    G.screen = 'howto';
  } else if (G.screen === 'howto') {
    G.screen = 'title';
  }
}

function togglePause() {
  if (G.screen === 'playing') { G.screen = 'paused'; Sfx.play('ui'); }
  else if (G.screen === 'paused') { G.screen = 'playing'; Sfx.play('ui'); }
}

// Pointer input: mouse, touch and pen share one path. Touch controls are
// hit first, then UI buttons, then targeting clicks, then a slingshot drag.
// Pointer capture keeps a drag alive outside the canvas; pointercancel
// drops the drag without firing. Each pointer is tracked by id so two
// thumbs (hold-to-walk + fire) work at the same time.
function hitTouchButton(p) {
  for (let i = G.touchButtons.length - 1; i >= 0; i--) {
    const b = G.touchButtons[i];
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return b;
  }
  return null;
}

function pressTouchButton(b) {
  if (b.role === 'left') G.touch.left = true;
  else if (b.role === 'right') G.touch.right = true;
  else if (b.role === 'jump') {
    if (G.phase === 'aim' && G.activeAnt && G.stamina >= JUMP_COST && G.activeAnt.jump()) {
      G.stamina -= JUMP_COST;
      Sfx.play('jump');
    }
  } else if (b.role === 'fire') {
    G.touch.fire = true;
    if (canFire()) fire(G.aim.angle, G.aim.power, G.selectedWeapon);
  }
}

function releaseTouchButton(role) {
  if (role === 'left') G.touch.left = false;
  else if (role === 'right') G.touch.right = false;
  else if (role === 'fire') G.touch.fire = false;
}

function capturePointer(e) {
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture unavailable: the drag still works inside the canvas */ }
}

canvas.addEventListener('pointerdown', function (e) {
  if (e.button !== 0) return;
  e.preventDefault();
  Sfx.unlock();
  const p = canvasPos(e.clientX, e.clientY);
  G.mouse.x = p.x;
  G.mouse.y = p.y;
  G.mouse.down = true;
  // Touch controls first: a tap on one must never start a drag-aim.
  const tb = hitTouchButton(p);
  if (tb) {
    G.activePointers[e.pointerId] = tb.role;
    capturePointer(e);
    pressTouchButton(tb);
    return;
  }
  // Buttons next (registered during the last draw).
  for (let i = G.uiButtons.length - 1; i >= 0; i--) {
    const b = G.uiButtons[i];
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
      Sfx.play('ui');
      b.action();
      return;
    }
  }
  if (G.screen !== 'playing' || G.showHelp) return;
  if (G.phase !== 'aim' || G.turn !== 'amber') return;
  if (G.targeting && G.selectedItem) {
    useItem(G.selectedItem, p.x, p.y);
    return;
  }
  if (G.drag) return; // one drag at a time; extra pointers are ignored
  G.activePointers[e.pointerId] = 'drag';
  capturePointer(e);
  G.drag = { sx: p.x, sy: p.y, x: p.x, y: p.y, pointerId: e.pointerId };
});

canvas.addEventListener('pointermove', function (e) {
  const p = canvasPos(e.clientX, e.clientY);
  G.mouse.x = p.x;
  G.mouse.y = p.y;
  if (G.drag && e.pointerId === G.drag.pointerId) {
    e.preventDefault();
    G.drag.x = p.x;
    G.drag.y = p.y;
    updateDragAim();
  }
});

function endPointer(e, cancelled) {
  const role = G.activePointers[e.pointerId];
  delete G.activePointers[e.pointerId];
  if (Object.keys(G.activePointers).length === 0) G.mouse.down = false;
  if (role === 'left' || role === 'right' || role === 'fire') {
    releaseTouchButton(role);
    return;
  }
  if (!G.drag || e.pointerId !== G.drag.pointerId) return;
  const dx = G.drag.sx - G.drag.x;
  const dy = G.drag.sy - G.drag.y;
  const mag = Math.hypot(dx, dy);
  G.drag = null;
  if (cancelled) return;
  if (G.screen !== 'playing' || G.phase !== 'aim' || G.turn !== 'amber') return;
  if (mag >= 24 && canFire()) {
    fire(G.aim.angle, G.aim.power, G.selectedWeapon);
  }
}

canvas.addEventListener('pointerup', function (e) { endPointer(e, false); });
canvas.addEventListener('pointercancel', function (e) { endPointer(e, true); });
canvas.addEventListener('pointerleave', function (e) {
  // With capture this fires only after release (drag already null); without
  // capture it cancels a drag that left the canvas, as before.
  if (G.drag && e.pointerId === G.drag.pointerId) endPointer(e, true);
});
canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

canvas.addEventListener('wheel', function (e) {
  if (G.screen === 'playing' && G.phase === 'aim' && G.turn === 'amber') {
    e.preventDefault();
    G.aim.power = Math.max(15, Math.min(100, G.aim.power + (e.deltaY < 0 ? 3 : -3)));
  }
}, { passive: false });

function updateDragAim() {
  const dx = G.drag.sx - G.drag.x;
  const dy = G.drag.sy - G.drag.y;
  const mag = Math.hypot(dx, dy);
  if (mag < 10) return;
  const angle = Math.atan2(-dy, Math.abs(dx)) * 180 / Math.PI;
  G.aim.angle = Math.max(15, Math.min(88, angle));
  G.aim.power = Math.max(15, Math.min(100, mag / 3.2));
  if (G.activeAnt && Math.abs(dx) > 8) G.activeAnt.facing = dx >= 0 ? 1 : -1;
}

// ---------------------------------------------------------------------------
// Fixed-step update
// ---------------------------------------------------------------------------
const STEP = 1 / 60;

function stepGame(dt) {
  G.time += dt;
  updateAmbient(dt);
  Particles.update(dt);
  for (const ant of G.ants) ant.updateVisual(dt);
  // Ant physics: falls, landings, pits.
  for (const ant of G.ants) {
    const ev = ant.updatePhysics(dt, G.terrain);
    if (!ev) continue;
    if (ev.pit) {
      Particles.floatText(ant.x, 640, ant.name + ' FELL INTO THE PIT!', '#ffffff', 22);
      Particles.burst(ant.x, 690, { count: 24, speed: 160, size: 4, life: 0.8, color: [ant.colors.body, '#ffffff'] });
      Sfx.play('fall');
    } else if (ev.landed && ev.fallDamage > 0) {
      const dealt = ant.damage(ev.fallDamage);
      if (dealt > 0) {
        Particles.floatText(ant.x, ant.y - 62, '-' + dealt + ' FALL', '#ffb627', 18);
        Sfx.play('hurt');
        if (!ant.alive) {
          Particles.burst(ant.x, ant.y - 18, { count: 26, speed: 190, size: 4, life: 0.9, color: [ant.colors.body, '#ffffff'] });
          Particles.floatText(ant.x, ant.y - 70, ant.name + ' DOWN!', '#ffffff', 24);
        }
      }
    }
  }
  updateCrates(dt);
  if (G.banner) { G.banner.timer -= dt; if (G.banner.timer <= 0) G.banner = null; }
  if (G.message) { G.message.timer -= dt; if (G.message.timer <= 0) G.message = null; }
  if (G.presetHold) return;

  if (G.phase === 'intro') {
    G.introTimer -= dt;
    if (G.introTimer <= 0) startTurn();
    return;
  }
  if (G.phase === 'aim') {
    updateAimInput(dt);
    return;
  }
  if (G.phase === 'flying') {
    updateProjectiles(dt);
    return;
  }
  if (G.phase === 'settling') {
    if (G.skipTimer > 0) {
      G.skipTimer -= dt;
      if (G.skipTimer <= 0) { G.skipTimer = 0; endTurn(); }
      return;
    }
    G.settleTimer -= dt;
    const anyFalling = G.ants.some(function (a) { return a.alive && a.falling; });
    if (G.settleTimer <= 0 && !anyFalling) resolveTurn();
    return;
  }
  if (G.phase === 'ai') {
    runAiStep(dt);
    return;
  }
}

function updateAimInput(dt) {
  const ant = G.activeAnt;
  if (!ant || !ant.alive || G.turn !== 'amber') return;
  let move = 0;
  if (G.keys.left || G.touch.left) move -= 1;
  if (G.keys.right || G.touch.right) move += 1;
  if (move !== 0 && G.stamina > 0) {
    const maxMove = G.stamina / WALK_DRAIN;
    const want = 115 * dt;
    const step = Math.min(want, maxMove);
    const moved = ant.walk(move * step, G.terrain);
    if (moved > 0) G.stamina = Math.max(0, G.stamina - moved * WALK_DRAIN);
  }
  if (G.keys.up) G.aim.angle = Math.min(88, G.aim.angle + 48 * dt);
  if (G.keys.down) G.aim.angle = Math.max(15, G.aim.angle - 48 * dt);
  if (G.keys.powerUp) G.aim.power = Math.min(100, G.aim.power + 55 * dt);
  if (G.keys.powerDown) G.aim.power = Math.max(15, G.aim.power - 55 * dt);
}

function updateProjectiles(dt) {
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const proj = G.projectiles[i];
    const ev = proj.update(dt, G.wind, G.terrain, G.ants, G);
    if (proj.dead) G.projectiles.splice(i, 1);
    if (!ev) continue;
    if (ev.hitAnt || ev.hitGround) {
      const hits = explode(G, ev.x, ev.y, proj.weapon, proj.owner);
      const hurtFoe = hits.some(function (h) { return h.ant.team !== proj.owner.team; });
      if (hurtFoe && G.lastHitVolley !== G.volleyId) {
        G.levelStats.hits++;
        G.lastHitVolley = G.volleyId;
      }
    }
  }
  // Split bomblets are appended during iteration; they resolve next steps.
  if (G.projectiles.length === 0) {
    G.phase = 'settling';
    G.settleTimer = 0.55;
  }
}

function resolveTurn() {
  if (checkLevelEnd()) return;
  if (G.extraShot && G.activeAnt && G.activeAnt.alive) {
    G.extraShot = false;
    G.stamina = Math.max(G.stamina, FIRE_COST);
    G.message = { text: 'Second shot — make it count!', timer: 1.4 };
    if (G.turn === 'amber') {
      G.phase = 'aim';
    } else {
      G.phase = 'ai';
      G.aiPlan = planAiTurn(G, G.activeAnt);
      G.aiTimer = 0.4;
      G.aiStep = 3;
    }
    return;
  }
  endTurn();
}

// AI turn choreography: think, use an item, reposition, aim, fire.
function runAiStep(dt) {
  const ant = G.activeAnt;
  if (!ant || !ant.alive) { endTurn(); return; }
  const plan = G.aiPlan;
  if (!plan) { endTurn(); return; }
  if (G.aiStep === 0) {
    G.aiTimer -= dt;
    if (G.aiTimer <= 0) {
      if (plan.item) {
        if (plan.item === 'freeze') {
          const foe = plan.target;
          useItem('freeze', foe.x, foe.y - 18);
        } else {
          useItem(plan.item);
        }
      }
      G.aiStep = 1;
      G.aiTimer = 0.35;
      G.aiMoved = 0;
    }
    return;
  }
  if (G.aiStep === 1) {
    G.aiTimer -= dt;
    if (G.aiTimer <= 0) G.aiStep = 2;
    return;
  }
  if (G.aiStep === 2) {
    const target = Math.abs(plan.move);
    if (target <= 0 || G.aiMoved >= target) { G.aiStep = 3; G.aiTimer = 0.55; return; }
    const dir = plan.move > 0 ? 1 : -1;
    const moved = ant.walk(dir * 115 * dt, G.terrain);
    G.aiMoved += moved;
    if (moved <= 0) { G.aiStep = 3; G.aiTimer = 0.55; }
    return;
  }
  if (G.aiStep === 3) {
    G.aim.angle = plan.angle;
    G.aim.power = plan.power;
    G.selectedWeapon = plan.weaponId;
    G.aiTimer -= dt;
    if (G.aiTimer <= 0) {
      fire(plan.angle, plan.power, plan.weaponId);
    }
    return;
  }
}

// The projectile and explosion code calls these through the game object;
// bind the shared functions so `game.addRage`, `game.addScore` and
// `game.splitProjectile` all resolve.
G.splitProjectile = splitProjectile;
G.addRage = addRage;
G.addScore = addScore;

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

function drawText(str, x, y, size, color, align, weight, shadow) {
  ctx.font = (weight || 'bold') + ' ' + size + 'px Trebuchet MS, Verdana, sans-serif';
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'alphabetic';
  if (shadow !== false) {
    ctx.lineWidth = Math.max(3, size / 6);
    ctx.strokeStyle = 'rgba(28,17,8,0.8)';
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function panel(x, y, w, h, fill, stroke, radius) {
  ctx.fillStyle = fill || 'rgba(24,16,9,0.82)';
  roundRect(x, y, w, h, radius === undefined ? 12 : radius);
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function button(x, y, w, h, label, action, opts) {
  const o = opts || {};
  const hover = G.mouse.x >= x && G.mouse.x <= x + w && G.mouse.y >= y && G.mouse.y <= y + h;
  const fill = o.fill || (hover ? '#f7b95c' : '#e8912d');
  const textColor = o.textColor || '#2a1a08';
  ctx.fillStyle = 'rgba(20,12,5,0.35)';
  roundRect(x + 2, y + 3, w, h, 10);
  ctx.fill();
  ctx.fillStyle = fill;
  roundRect(x, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = o.stroke || 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
  drawText(label, x + w / 2, y + h / 2 + (o.fontSize || 17) / 3, o.fontSize || 17, textColor, 'center', 'bold', false);
  G.uiButtons.push({ x: x, y: y, w: w, h: h, action: action, label: label });
  return hover;
}

function drawWeaponGlyph(id, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  if (id === 'bazooka') {
    ctx.fillStyle = '#8bc34a';
    ctx.beginPath(); ctx.arc(0, 0, 9 * s, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#33691e'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = '#558b2f'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(2, -8 * s); ctx.quadraticCurveTo(8 * s, -16 * s, 13 * s, -15 * s); ctx.stroke();
  } else if (id === 'durian') {
    ctx.fillStyle = '#c9a227';
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 7 * s, Math.sin(a) * 7 * s);
      ctx.lineTo(Math.cos(a) * 13 * s, Math.sin(a) * 13 * s);
      ctx.lineTo(Math.cos(a + 0.3) * 7 * s, Math.sin(a + 0.3) * 7 * s);
      ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, 0, 8 * s, 0, Math.PI * 2); ctx.fill();
  } else if (id === 'thorns') {
    ctx.strokeStyle = '#9c6bc4'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 7 * s, 9 * s);
      ctx.lineTo(i * 9 * s, -9 * s);
      ctx.stroke();
    }
  } else if (id === 'honey') {
    ctx.fillStyle = '#f0a828';
    ctx.beginPath();
    ctx.moveTo(0, -11 * s);
    ctx.quadraticCurveTo(9 * s, 0, 7 * s, 6 * s);
    ctx.quadraticCurveTo(4 * s, 11 * s, 0, 11 * s);
    ctx.quadraticCurveTo(-4 * s, 11 * s, -7 * s, 6 * s);
    ctx.quadraticCurveTo(-9 * s, 0, 0, -11 * s);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(-3 * s, 1, 2.4 * s, 0, Math.PI * 2); ctx.fill();
  } else if (id === 'acorn') {
    ctx.fillStyle = '#a9743b';
    ctx.beginPath(); ctx.arc(0, 2 * s, 8 * s, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#7a5230';
    ctx.beginPath(); ctx.arc(0, 1 * s, 8 * s, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = '#4a2f1a'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(0, -7 * s); ctx.lineTo(3 * s, -12 * s); ctx.stroke();
  } else if (id === 'rage') {
    ctx.fillStyle = '#ff5252';
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = i % 2 === 0 ? 12 * s : 5.5 * s;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(0, 0, 4.5 * s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// World drawing
// ---------------------------------------------------------------------------
function drawTrajectory() {
  const ant = G.activeAnt;
  if (!ant || !ant.alive) return;
  const show = (G.phase === 'aim' && G.turn === 'amber') || (G.phase === 'ai' && G.aiStep >= 3);
  if (!show || G.targeting) return;
  const weapon = weaponById(G.selectedWeapon);
  const muzzle = ant.muzzle();
  const sim = simulateShot(muzzle.x, muzzle.y, G.aim.angle, G.aim.power, ant.facing, G.wind, weapon, G.terrain, G.ants, ant);
  // Thick direction arrow from the muzzle along the aim angle, so the shot
  // direction reads at a glance even on a small phone screen.
  const aimRad = G.aim.angle * Math.PI / 180;
  const ax = ant.facing * Math.cos(aimRad);
  const ay = -Math.sin(aimRad);
  const ax0 = muzzle.x + ax * 16, ay0 = muzzle.y + ay * 16;
  const ax1 = muzzle.x + ax * 60, ay1 = muzzle.y + ay * 60;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(28,17,8,0.8)';
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(ax0, ay0); ctx.lineTo(ax1, ay1); ctx.stroke();
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(ax0, ay0); ctx.lineTo(ax1, ay1); ctx.stroke();
  const px2 = -ay, py2 = ax;
  ctx.fillStyle = '#ffd166';
  ctx.strokeStyle = 'rgba(28,17,8,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ax1 + ax * 13, ay1 + ay * 13);
  ctx.lineTo(ax1 + px2 * 8 - ax * 2, ay1 + py2 * 8 - ay * 2);
  ctx.lineTo(ax1 - px2 * 8 - ax * 2, ay1 - py2 * 8 - ay * 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < sim.points.length; i += 2) {
    const p = sim.points[i];
    const fade = 1 - i / sim.points.length;
    ctx.globalAlpha = 0.45 + fade * 0.55;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(28,17,8,0.7)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (sim.hit && sim.hit.kind !== 'out') {
    const hx = sim.hit.kind === 'ant' ? sim.hit.ant.x : sim.hit.x;
    const hy = sim.hit.kind === 'ant' ? sim.hit.ant.y - 18 : sim.hit.y;
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(hx, hy, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hx - 7, hy - 7); ctx.lineTo(hx + 7, hy + 7);
    ctx.moveTo(hx + 7, hy - 7); ctx.lineTo(hx - 7, hy + 7);
    ctx.stroke();
  }
  // Aiming readout pill near the muzzle.
  const label = Math.round(G.aim.angle) + '° · PWR ' + Math.round(G.aim.power);
  ctx.font = 'bold 15px Trebuchet MS, Verdana, sans-serif';
  const tw = ctx.measureText(label).width + 18;
  const px = Math.max(8, Math.min(W - tw - 8, muzzle.x - tw / 2));
  const py = Math.max(52, muzzle.y - 78);
  panel(px, py, tw, 26, 'rgba(24,16,9,0.78)', 'rgba(255,255,255,0.35)', 8);
  drawText(label, px + tw / 2, py + 18, 15, '#ffffff', 'center', 'bold', false);
}

function drawWorld() {
  const shake = Particles.shakeOffset();
  ctx.save();
  ctx.translate(shake.x, shake.y);
  drawBackground(STEP);
  G.terrain.drawSoil(ctx, G.levelDef);
  G.terrain.drawDecor(ctx, G.time, G.wind);
  drawCrates();
  for (const ant of G.ants) ant.draw(ctx, G.time, ant === G.activeAnt && G.screen === 'playing');
  // Projectiles.
  for (const proj of G.projectiles) {
    ctx.fillStyle = proj.weapon.color;
    ctx.strokeStyle = 'rgba(30,18,8,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, proj.weapon.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(proj.x - proj.weapon.size * 0.3, proj.y - proj.weapon.size * 0.3, proj.weapon.size * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  Particles.draw(ctx);
  drawTrajectory();
  // Drag band while slingshot-aiming.
  if (G.drag && G.activeAnt) {
    const muzzle = G.activeAnt.muzzle();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(muzzle.x, muzzle.y);
    ctx.lineTo(G.drag.x, G.drag.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(G.drag.x, G.drag.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Targeting hint.
  if (G.targeting === 'freeze') {
    drawText('Click an enemy ant to freeze it', W / 2, 96, 20, '#aadcff', 'center');
  } else if (G.targeting === 'glider') {
    drawText('Click the ground to glide there', W / 2, 96, 20, '#d8f3c0', 'center');
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function drawWindGauge(cx, y) {
  const w = G.wind;
  drawText('WIND', cx - 100, y + 6, 14, '#ffffff', 'left');
  const dir = w === 0 ? 0 : (w > 0 ? 1 : -1);
  ctx.fillStyle = '#ffffff';
  ctx.save();
  ctx.translate(cx - 12, y);
  if (dir !== 0) {
    ctx.beginPath();
    ctx.moveTo(dir * 26, 0);
    ctx.lineTo(dir * 8, -8);
    ctx.lineTo(dir * 8, -3);
    ctx.lineTo(-dir * 14, -3);
    ctx.lineTo(-dir * 14, 3);
    ctx.lineTo(dir * 8, 3);
    ctx.lineTo(dir * 8, 8);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < Math.abs(w) ? '#ffd166' : 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(cx + 30 + i * 14, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  if (G.campaign.fineGauge) {
    drawText((w > 0 ? '+' : '') + w, cx + 108, y + 5, 14, '#ffd166', 'left');
  }
}

function drawTeamPanel(team, x, alignRight) {
  const ants = G.ants.filter(function (a) { return a.team === team; });
  const w = 178, h = 92;
  const px = alignRight ? x - w : x;
  panel(px, 56, w, h, team === 'amber' ? 'rgba(60,38,8,0.72)' : 'rgba(60,12,10,0.72)', 'rgba(255,255,255,0.25)', 10);
  drawText(team === 'amber' ? 'YOUR COLONY' : 'CRIMSON COLONY', px + 12, 74, 12, team === 'amber' ? '#ffd166' : '#ff9a8a', 'left');
  for (let i = 0; i < ants.length; i++) {
    const ant = ants[i];
    const ry = 82 + i * 22;
    ctx.fillStyle = ant.alive ? ant.colors.body : '#555';
    ctx.beginPath();
    ctx.arc(px + 18, ry + 3, 6, 0, Math.PI * 2);
    ctx.fill();
    drawText(ant.name, px + 30, ry + 7, 13, ant.alive ? '#ffffff' : '#999999', 'left');
    const bw = 74;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(px + 82, ry, bw, 8);
    if (ant.alive) {
      const frac = ant.hp / ant.maxHp;
      ctx.fillStyle = frac > 0.5 ? '#7bc950' : (frac > 0.25 ? '#ffb627' : '#e5484d');
      ctx.fillRect(px + 82, ry, bw * frac, 8);
    }
    let status = '';
    if (!ant.alive) status = '✕';
    else if (ant.frozen > 0) status = '❄';
    else if (ant.honeyed > 0) status = '●';
    if (status) drawText(status, px + w - 16, ry + 8, 13, status === '❄' ? '#aadcff' : (status === '●' ? '#f0a828' : '#ff6b6b'), 'center');
  }
  if (G.turn === team && G.screen === 'playing') {
    ctx.strokeStyle = team === 'amber' ? '#ffd166' : '#ff8a80';
    ctx.lineWidth = 2.5;
    roundRect(px, 56, w, h, 10);
    ctx.stroke();
  }
}

function drawMinimap() {
  const mx = 1052, my = 158, mw = 218, mh = 66;
  panel(mx, my, mw, mh, 'rgba(24,16,9,0.78)', 'rgba(255,255,255,0.3)', 8);
  drawText('MAP', mx + 8, my + 14, 10, '#ffd166', 'left');
  const plotY = my + 18, plotH = mh - 30;
  // Terrain silhouette.
  ctx.fillStyle = '#8a5a33';
  ctx.beginPath();
  ctx.moveTo(mx + 4, plotY + plotH);
  for (let x = 0; x < W; x += 8) {
    const sy = G.terrain.h[x];
    const py = plotY + plotH - ((TERRAIN_BOTTOM - sy) / TERRAIN_BOTTOM) * plotH;
    ctx.lineTo(mx + 4 + (x / W) * (mw - 8), py);
  }
  ctx.lineTo(mx + mw - 4, plotY + plotH);
  ctx.closePath();
  ctx.fill();
  // Ant dots.
  for (const ant of G.ants) {
    if (!ant.alive) continue;
    ctx.fillStyle = ant.team === 'amber' ? '#ffd166' : '#ff6b6b';
    ctx.beginPath();
    ctx.arc(mx + 4 + (ant.x / W) * (mw - 8), plotY + plotH - ((TERRAIN_BOTTOM - ant.y) / TERRAIN_BOTTOM) * plotH, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Distance scale: ticks every 200 px of world.
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const sy = my + mh - 8;
  ctx.moveTo(mx + 4, sy);
  ctx.lineTo(mx + mw - 4, sy);
  for (let d = 0; d <= W; d += 200) {
    const tx = mx + 4 + (d / W) * (mw - 8);
    ctx.moveTo(tx, sy - 3);
    ctx.lineTo(tx, sy + 2);
  }
  ctx.stroke();
  drawText('200px', mx + mw - 8, sy - 5, 9, 'rgba(255,255,255,0.7)', 'right');
}

// On-screen touch controls: thumb-sized walk/jump/fire buttons, drawn only
// on touch devices during the player's aim phase. They sit above the bottom
// bar and clear of the panels, minimap and wind gauge.
function drawTouchControls() {
  if (!IS_TOUCH) return;
  if (G.screen !== 'playing' || G.showHelp) return;
  if (G.phase !== 'aim' || G.turn !== 'amber' || G.targeting) return;
  const defs = [
    { role: 'left', x: 16, y: 566, w: 58, h: 58 },
    { role: 'right', x: 82, y: 566, w: 58, h: 58 },
    { role: 'jump', x: 148, y: 566, w: 58, h: 58 },
    { role: 'fire', x: 1140, y: 556, w: 124, h: 66 }
  ];
  for (const d of defs) {
    const pressed = d.role === 'left' ? G.touch.left : d.role === 'right' ? G.touch.right : d.role === 'fire' ? G.touch.fire : false;
    ctx.fillStyle = pressed ? 'rgba(255,209,102,0.5)' : 'rgba(24,16,9,0.6)';
    roundRect(d.x, d.y, d.w, d.h, 12);
    ctx.fill();
    ctx.strokeStyle = pressed ? '#ffd166' : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    const cx = d.x + d.w / 2, cy = d.y + d.h / 2;
    if (d.role === 'left' || d.role === 'right') {
      const dir = d.role === 'left' ? -1 : 1;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cx + dir * 12, cy - 13);
      ctx.lineTo(cx + dir * 12, cy + 13);
      ctx.lineTo(cx - dir * 12, cy);
      ctx.closePath();
      ctx.fill();
    } else if (d.role === 'jump') {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - 11, cy - 2);
      ctx.lineTo(cx, cy - 13);
      ctx.lineTo(cx + 11, cy - 2);
      ctx.stroke();
      drawText('JUMP', cx, cy + 20, 11, '#ffffff', 'center', 'bold', false);
    } else {
      drawText('FIRE', cx, cy + 7, 22, '#ffd166', 'center', 'bold', false);
    }
    G.touchButtons.push({ x: d.x, y: d.y, w: d.w, h: d.h, role: d.role });
  }
}

function drawHud() {
  // Top bar.
  ctx.fillStyle = 'rgba(24,16,9,0.72)';
  ctx.fillRect(0, 0, W, 46);
  drawText('LEVEL ' + (G.levelIndex + 1) + ' · ' + G.levelDef.name.toUpperCase(), 14, 20, 15, '#ffffff', 'left');
  drawText('SCORE ' + G.score.toLocaleString('en-US'), 14, 38, 13, '#ffd166', 'left');
  drawWindGauge(W / 2 - 20, 24);
  // Top-right icon buttons.
  const btns = [
    { label: '?', action: function () { toggleHelp(); } },
    { label: G.muted ? '✕' : '♪', action: function () { G.muted = Sfx.toggleMuted(); } },
    { label: 'II', action: function () { togglePause(); } },
    { label: '↻', action: function () { startLevel(G.levelIndex); } }
  ];
  for (let i = 0; i < btns.length; i++) {
    const bx = W - 40 - (btns.length - 1 - i) * 44;
    button(bx, 6, 34, 34, btns[i].label, btns[i].action, { fontSize: 16, fill: 'rgba(255,255,255,0.14)', textColor: '#ffffff', stroke: 'rgba(255,255,255,0.35)' });
  }
  drawTeamPanel('amber', 10, false);
  drawTeamPanel('crimson', W - 10, true);
  drawMinimap();
  // Bottom bar.
  ctx.fillStyle = 'rgba(24,16,9,0.78)';
  ctx.fillRect(0, 646, W, 74);
  const ant = G.activeAnt;
  drawText(ant ? ant.name.toUpperCase() + '  ·  ' + (G.turn === 'amber' ? 'YOUR COLONY' : 'CRIMSON COLONY') : '', 14, 664, 13, '#ffffff', 'left');
  // Stamina bar.
  drawText('STAMINA', 14, 686, 11, '#c9b896', 'left');
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(80, 676, 170, 12);
  const sFrac = Math.max(0, G.stamina / staminaMax());
  ctx.fillStyle = sFrac > 0.3 ? '#7bc950' : '#ffb627';
  ctx.fillRect(80, 676, 170 * sFrac, 12);
  drawText(Math.round(G.stamina) + '', 256, 686, 11, '#ffffff', 'left');
  // Rage bar.
  drawText('RAGE', 14, 706, 11, '#c9b896', 'left');
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(80, 696, 170, 12);
  const rFrac = G.rage[G.turn] / 100;
  const pulse = G.rage[G.turn] >= 100 ? 0.75 + 0.25 * Math.sin(G.time * 6) : 1;
  ctx.globalAlpha = pulse;
  ctx.fillStyle = '#ff5252';
  ctx.fillRect(80, 696, 170 * rFrac, 12);
  ctx.globalAlpha = 1;
  drawText(G.rage[G.turn] >= 100 ? 'POW READY!' : Math.round(G.rage[G.turn]) + '', 256, 706, 11, G.rage[G.turn] >= 100 ? '#ffd166' : '#ffffff', 'left');
  // Weapon tray.
  const trayX = 330;
  for (let i = 0; i < WEAPONS.length; i++) {
    const w = WEAPONS[i];
    const sx = trayX + i * 68;
    const sy = 652;
    const selected = G.selectedWeapon === w.id;
    const locked = w.rageOnly && G.rage[G.turn] < 100;
    ctx.fillStyle = selected ? 'rgba(255,209,102,0.28)' : 'rgba(255,255,255,0.08)';
    roundRect(sx, sy, 60, 60, 8);
    ctx.fill();
    ctx.strokeStyle = selected ? '#ffd166' : 'rgba(255,255,255,0.3)';
    ctx.lineWidth = selected ? 3 : 1.5;
    ctx.stroke();
    ctx.globalAlpha = locked ? 0.35 : 1;
    drawWeaponGlyph(w.id, sx + 30, sy + 26, 1);
    ctx.globalAlpha = 1;
    drawText(w.key, sx + 6, sy + 13, 11, '#ffd166', 'left');
    drawText(locked ? 'LOCK' : w.name.split(' ')[0].toUpperCase(), sx + 30, sy + 54, 9, locked ? '#ff8a80' : '#ffffff', 'center');
    G.uiButtons.push({
      x: sx, y: sy, w: 60, h: 60,
      label: 'weapon:' + w.id,
      action: (function (id, isLocked) {
        return function () {
          if (G.phase !== 'aim') return;
          if (isLocked) { G.message = { text: 'Rage Burst needs a full rage bar!', timer: 1.4 }; return; }
          G.selectedWeapon = id;
        };
      })(w.id, locked)
    });
  }
  // Item tray.
  const itemIds = Object.keys(ITEM_DEFS);
  const itemX = 748;
  for (let i = 0; i < itemIds.length; i++) {
    const id = itemIds[i];
    const def = ITEM_DEFS[id];
    const count = G.items[G.turn][id] || 0;
    const sx = itemX + i * 54;
    const sy = 656;
    const selected = G.selectedItem === id;
    ctx.fillStyle = selected ? 'rgba(170,220,255,0.3)' : 'rgba(255,255,255,0.08)';
    roundRect(sx, sy, 46, 52, 8);
    ctx.fill();
    ctx.strokeStyle = selected ? '#aadcff' : 'rgba(255,255,255,0.3)';
    ctx.lineWidth = selected ? 3 : 1.5;
    ctx.stroke();
    ctx.globalAlpha = count > 0 ? 1 : 0.3;
    drawText(def.icon, sx + 23, sy + 24, 18, '#ffffff', 'center');
    ctx.globalAlpha = 1;
    drawText('×' + count, sx + 23, sy + 44, 11, count > 0 ? '#ffd166' : '#999999', 'center');
    G.uiButtons.push({
      x: sx, y: sy, w: 46, h: 52,
      label: 'item:' + id,
      action: (function (itemId) {
        return function () {
          if (G.phase !== 'aim' || G.turn !== 'amber') return;
          if ((G.items.amber[itemId] || 0) <= 0) { G.message = { text: 'No ' + ITEM_DEFS[itemId].name + ' left.', timer: 1.4 }; return; }
          if (itemId === 'freeze' || itemId === 'glider') {
            G.selectedItem = itemId;
            G.targeting = itemId;
          } else {
            useItem(itemId);
          }
        };
      })(id)
    });
  }
  // End Turn button.
  button(1032, 656, 118, 52, 'END TURN', function () {
    if (G.phase === 'aim' && G.turn === 'amber') endTurn();
  }, { fontSize: 15 });
  // Help hint, kept inside the canvas.
  drawText(IS_TOUCH ? 'Drag to aim · Tap FIRE to shoot' : 'Drag to aim · H for help', 1272, 712, 11, 'rgba(255,255,255,0.6)', 'right');
  drawTouchControls();
  // Turn banner.
  if (G.banner) {
    const a = Math.min(1, G.banner.timer * 2);
    ctx.globalAlpha = a;
    drawText(G.banner.text, W / 2, 250, 44, '#ffffff', 'center');
    if (G.banner.sub) drawText(G.banner.sub, W / 2, 282, 19, '#ffd166', 'center');
    ctx.globalAlpha = 1;
  }
  // Toast message.
  if (G.message) {
    const a = Math.min(1, G.message.timer * 2);
    ctx.globalAlpha = a;
    ctx.font = 'bold 16px Trebuchet MS, Verdana, sans-serif';
    const tw = ctx.measureText(G.message.text).width + 28;
    panel(W / 2 - tw / 2, 606, tw, 30, 'rgba(24,16,9,0.85)', 'rgba(255,255,255,0.35)', 9);
    drawText(G.message.text, W / 2, 626, 16, '#ffffff', 'center', 'bold', false);
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
let titleTerrain = null;
let titleAnts = [];

function buildTitleWorld() {
  const rng = makeRng(7);
  titleTerrain = new Terrain(rng, LEVELS[0], W);
  titleAnts = [];
  const spots = [150, 240, 330, 950, 1040, 1130];
  for (let i = 0; i < 6; i++) {
    const ant = new Ant(i < 3 ? 'amber' : 'crimson', i % 3, spots[i], titleTerrain);
    ant.facing = i < 3 ? 1 : -1;
    titleAnts.push(ant);
  }
  buildSky(LEVELS[0], rng);
}

function drawTitleBackdrop() {
  drawBackground(STEP);
  titleTerrain.drawSoil(ctx, LEVELS[0]);
  titleTerrain.drawDecor(ctx, G.time, 1);
  for (const ant of titleAnts) {
    ant.updateVisual(STEP);
    ant.draw(ctx, G.time, false);
  }
  ctx.fillStyle = 'rgba(20,30,20,0.18)';
  ctx.fillRect(0, 0, W, H);
}

function drawTitle() {
  drawTitleBackdrop();
  // Logo: gold fill with a thin dark outline so it reads against the sky.
  ctx.save();
  ctx.translate(W / 2, 158);
  ctx.font = 'bold 84px Trebuchet MS, Verdana, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(28,17,8,0.85)';
  ctx.strokeText('SEEDSTORM', 0, 0);
  ctx.fillStyle = '#ffd166';
  ctx.fillText('SEEDSTORM', 0, 0);
  ctx.restore();
  drawText('TURN-BASED ANT ARTILLERY', W / 2, 196, 22, '#ffffff', 'center');
  drawText('Aim with the wind. Carve the earth. Drop your rivals into the pit.', W / 2, 226, 17, '#fdf3d0', 'center');
  const cx = W / 2;
  button(cx - 150, 280, 300, 56, '▶  PLAY CAMPAIGN', function () {
    G.campaign = newCampaign();
    G.score = 0;
    startLevel(0);
  }, { fontSize: 21 });
  button(cx - 150, 350, 300, 48, 'HOW TO PLAY', function () { G.screen = 'howto'; }, { fontSize: 18, fill: '#f2e8d5', textColor: '#2a1a08' });
  // Difficulty select.
  drawText('DIFFICULTY', cx, 428, 14, '#ffffff', 'center');
  const modes = [
    { id: 'relaxed', label: 'RELAXED' },
    { id: 'classic', label: 'CLASSIC' },
    { id: 'expert', label: 'EXPERT' }
  ];
  for (let i = 0; i < modes.length; i++) {
    const bx = cx - 168 + i * 114;
    const sel = G.difficultyMode === modes[i].id;
    button(bx, 440, 104, 38, modes[i].label, (function (id) {
      return function () { G.difficultyMode = id; };
    })(modes[i].id), {
      fontSize: 14,
      fill: sel ? '#ffd166' : 'rgba(255,255,255,0.16)',
      textColor: sel ? '#2a1a08' : '#ffffff',
      stroke: sel ? '#ffffff' : 'rgba(255,255,255,0.35)'
    });
  }
  if (G.bestScore > 0) drawText('BEST SCORE  ' + G.bestScore.toLocaleString('en-US'), cx, 516, 15, '#ffd166', 'center');
  drawText('An original game built for the make.fun best-game bounty · 5 gardens · keyboard + mouse', cx, 690, 13, 'rgba(255,255,255,0.75)', 'center');
}

function drawHowTo() {
  drawTitleBackdrop();
  ctx.fillStyle = 'rgba(15,10,5,0.55)';
  ctx.fillRect(0, 0, W, H);
  panel(W / 2 - 400, 70, 800, 560, 'rgba(28,20,11,0.94)', '#ffd166', 16);
  drawText('HOW TO PLAY', W / 2, 116, 32, '#ffd166', 'center');
  const lines = [
    ['GOAL', 'Wipe out the crimson colony — or dig the ground out from under them so they fall into the pit.'],
    ['TURNS', 'Each ant has a stamina bar. Walking drains it, jumping costs 20, firing costs 30. Spend it wisely.'],
    ['AIMING', 'Drag back from your ant like a slingshot and release to fire — or use the arrow keys and Space.'],
    ['ANGLE + POWER', 'The dotted arc shows your shot, wind included. Higher angles lob over hills; flat shots fly fast.'],
    ['WIND', 'Wind bends every shot. The gauge shows its direction and strength; leaves and pollen drift with it.'],
    ['TERRAIN', 'Explosions carve craters. Ants on destroyed ground fall — long falls hurt, and the pit ends them.'],
    ['WEAPONS', 'Keys 1-6: Seed Bazooka, Durian Bomb, Thorn Volley, Honey Glob, Acorn Mortar, and Rage Burst (POW).'],
    ['ITEMS', 'Crates parachute down with items: Double Shot, Triple Split, Frost Nectar, Leaf Glider, Repair Nectar.'],
    ['RAGE', 'Dealing and taking damage fills the rage bar. At full, unleash Rage Burst for massive damage.'],
    ['CONTROLS', 'Mouse: drag to aim, click trays and buttons. Keys: Arrows/WASD move + aim, Q/E power, Space fire,'],
    ['', 'J jump, F flip facing, 1-6 weapons, Tab + U items, Enter end turn, P pause, M mute, H help.'],
    ['TOUCH', 'Touch screens: drag to aim, on-screen buttons walk, jump and fire.']
  ];
  let y = 152;
  for (const pair of lines) {
    drawText(pair[0], W / 2 - 360, y, 15, '#ffd166', 'left');
    drawText(pair[1], W / 2 - 240, y, 15, '#ffffff', 'left');
    y += 30;
  }
  button(W / 2 - 110, 560, 220, 48, 'GOT IT', function () {
    if (G.showHelp) G.showHelp = false;
    else G.screen = 'title';
  }, { fontSize: 18 });
}

function drawPaused() {
  drawWorld();
  ctx.fillStyle = 'rgba(15,10,5,0.6)';
  ctx.fillRect(0, 0, W, H);
  panel(W / 2 - 210, 190, 420, 330, 'rgba(28,20,11,0.95)', '#ffd166', 16);
  drawText('PAUSED', W / 2, 240, 36, '#ffd166', 'center');
  button(W / 2 - 150, 270, 300, 48, 'RESUME', function () { G.screen = 'playing'; }, { fontSize: 18 });
  button(W / 2 - 150, 330, 300, 48, 'RESTART LEVEL', function () { startLevel(G.levelIndex); }, { fontSize: 18, fill: '#f2e8d5', textColor: '#2a1a08' });
  button(W / 2 - 150, 390, 300, 48, 'HOW TO PLAY', function () { G.showHelp = true; }, { fontSize: 18, fill: '#f2e8d5', textColor: '#2a1a08' });
  button(W / 2 - 150, 450, 300, 48, 'QUIT TO TITLE', function () { G.screen = 'title'; G.showHelp = false; }, { fontSize: 18, fill: '#c96f2e', textColor: '#ffffff' });
}

function drawUpgrade() {
  drawWorld();
  ctx.fillStyle = 'rgba(15,10,5,0.55)';
  ctx.fillRect(0, 0, W, H);
  drawText('GARDEN CLEARED!', W / 2, 130, 40, '#ffd166', 'center');
  drawText('Choose one upgrade for the rest of the campaign', W / 2, 168, 18, '#ffffff', 'center');
  for (let i = 0; i < G.upgradeChoices.length; i++) {
    const up = G.upgradeChoices[i];
    const cx = W / 2 - 330 + i * 330;
    const cy = 220, cw = 300, ch = 240;
    const hover = G.mouse.x >= cx && G.mouse.x <= cx + cw && G.mouse.y >= cy && G.mouse.y <= cy + ch;
    panel(cx, cy, cw, ch, hover ? 'rgba(60,44,18,0.96)' : 'rgba(28,20,11,0.94)', hover ? '#ffd166' : 'rgba(255,255,255,0.4)', 14);
    drawText(up.icon, cx + cw / 2, cy + 70, 44, '#ffd166', 'center');
    drawText(up.name.toUpperCase(), cx + cw / 2, cy + 112, 20, '#ffffff', 'center');
    wrapText(up.desc, cx + 24, cy + 150, cw - 48, 16, '#fdf3d0');
    G.uiButtons.push({
      x: cx, y: cy, w: cw, h: ch, label: 'upgrade:' + up.id,
      action: (function (u) {
        return function () {
          u.apply(G.campaign);
          Sfx.play('pickup');
          startLevel(G.levelIndex + 1);
        };
      })(up)
    });
  }
}

function wrapText(text, x, y, maxW, size, color) {
  ctx.font = 'bold ' + size + 'px Trebuchet MS, Verdana, sans-serif';
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxW && line) {
      drawText(line, x + maxW / 2, yy, size, color, 'center', 'bold', false);
      line = word;
      yy += size + 8;
    } else {
      line = test;
    }
  }
  if (line) drawText(line, x + maxW / 2, yy, size, color, 'center', 'bold', false);
}

function drawStars(cx, y, stars, size) {
  for (let i = 0; i < 3; i++) {
    const sx = cx + (i - 1) * (size * 1.6);
    ctx.fillStyle = i < stars ? '#ffd166' : 'rgba(255,255,255,0.25)';
    ctx.strokeStyle = 'rgba(28,17,8,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let p = 0; p < 10; p++) {
      const a = -Math.PI / 2 + (p / 10) * Math.PI * 2;
      const r = p % 2 === 0 ? size : size * 0.45;
      const px = sx + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (p === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawLevelEnd() {
  drawWorld();
  ctx.fillStyle = 'rgba(15,10,5,0.55)';
  ctx.fillRect(0, 0, W, H);
  const info = G.endInfo || { won: false, stars: 0, bonus: 0, stats: { damage: 0, kills: 0, shots: 0, hits: 0 } };
  panel(W / 2 - 280, 130, 560, 430, 'rgba(28,20,11,0.95)', info.won ? '#ffd166' : '#ff8a80', 16);
  drawText(info.won ? 'VICTORY!' : 'DEFEAT', W / 2, 190, 44, info.won ? '#ffd166' : '#ff8a80', 'center');
  drawText(G.levelDef.name + '  ·  Level ' + (G.levelIndex + 1) + ' of 5', W / 2, 222, 16, '#ffffff', 'center');
  if (info.won) drawStars(W / 2, 268, info.stars, 24);
  const st = info.stats;
  const acc = st.shots > 0 ? Math.round(100 * st.hits / st.shots) : 0;
  const rows = [
    ['Damage dealt', st.damage + ''],
    ['Ants eliminated', st.kills + ''],
    ['Shots fired', st.shots + ''],
    ['Accuracy', acc + '%'],
    ['Level bonus', '+' + info.bonus],
    ['Total score', G.score.toLocaleString('en-US')]
  ];
  let y = info.won ? 318 : 280;
  for (const row of rows) {
    drawText(row[0], W / 2 - 190, y, 16, '#c9b896', 'left');
    drawText(row[1], W / 2 + 190, y, 16, '#ffffff', 'right');
    y += 28;
  }
  if (info.won) {
    const last = G.levelIndex >= LEVELS.length - 1;
    button(W / 2 - 150, 496, 300, 50, last ? 'FINISH CAMPAIGN' : 'CONTINUE', function () {
      if (last) {
        G.screen = 'campaignWin';
      } else {
        G.upgradeChoices = G.rng.shuffle(UPGRADES).slice(0, 3);
        G.screen = 'upgrade';
      }
    }, { fontSize: 19 });
  } else {
    button(W / 2 - 155, 496, 145, 50, 'RETRY', function () { startLevel(G.levelIndex); }, { fontSize: 18 });
    button(W / 2 + 10, 496, 145, 50, 'TITLE', function () { G.screen = 'title'; }, { fontSize: 18, fill: '#f2e8d5', textColor: '#2a1a08' });
  }
}

function drawCampaignWin() {
  drawTitleBackdrop();
  ctx.fillStyle = 'rgba(15,10,5,0.5)';
  ctx.fillRect(0, 0, W, H);
  drawText('CAMPAIGN COMPLETE!', W / 2, 180, 48, '#ffd166', 'center');
  drawText('The amber colony rules the garden, from Meadow Dawn to the Moonlit Garden.', W / 2, 220, 18, '#ffffff', 'center');
  const totalStars = G.campaign.stars.reduce(function (a, b) { return a + b; }, 0);
  drawStars(W / 2, 290, Math.min(3, Math.round(totalStars / 5)), 30);
  drawText(totalStars + ' / 15 STARS', W / 2, 340, 18, '#ffffff', 'center');
  drawText('FINAL SCORE  ' + G.score.toLocaleString('en-US'), W / 2, 380, 26, '#ffd166', 'center');
  if (G.score >= G.bestScore && G.score > 0) drawText('★ NEW BEST SCORE! ★', W / 2, 414, 17, '#ffffff', 'center');
  button(W / 2 - 150, 450, 300, 52, 'PLAY AGAIN', function () {
    G.campaign = newCampaign();
    G.score = 0;
    startLevel(0);
  }, { fontSize: 20 });
  button(W / 2 - 150, 514, 300, 48, 'TITLE SCREEN', function () { G.screen = 'title'; }, { fontSize: 18, fill: '#f2e8d5', textColor: '#2a1a08' });
}

function drawHelpOverlay() {
  ctx.fillStyle = 'rgba(15,10,5,0.6)';
  ctx.fillRect(0, 0, W, H);
  panel(W / 2 - 360, 110, 720, 470, 'rgba(28,20,11,0.96)', '#ffd166', 16);
  drawText('HOW TO PLAY', W / 2, 154, 30, '#ffd166', 'center');
  const lines = [
    'Drag back from your ant and release to fire — or aim with the arrow keys and press Space.',
    'The dotted arc shows your shot, wind included. Wind bends every shot: watch the gauge.',
    'Stamina: walking drains it, jumping costs 20, firing costs 30.',
    'Explosions carve craters. Ants on destroyed ground fall; the pit ends them instantly.',
    'Weapons (1-6): Bazooka, Durian Bomb, Thorn Volley, Honey Glob, Acorn Mortar, Rage Burst.',
    'Items: Double Shot, Triple Split, Frost Nectar, Leaf Glider, Repair Nectar.',
    'Crates parachute down with items — walk an ant over one to claim it.',
    'Keys: Arrows/WASD move + aim · Q/E power · Space fire · J jump · F flip facing',
    '1-6 weapons · Tab + U items · Enter end turn · P pause · M mute · H help.',
    'Touch: drag to aim, on-screen buttons walk, jump and fire.'
  ];
  let y = 192;
  for (const line of lines) {
    drawText(line, W / 2, y, 15, '#ffffff', 'center');
    y += 28;
  }
  button(W / 2 - 100, 500, 200, 46, 'CLOSE', function () { G.showHelp = false; }, { fontSize: 17 });
}

// ---------------------------------------------------------------------------
// Frame draw dispatch
// ---------------------------------------------------------------------------
function draw() {
  G.uiButtons = [];
  G.touchButtons = [];
  ctx.clearRect(0, 0, W, H);
  if (G.screen === 'title') {
    drawTitle();
  } else if (G.screen === 'howto') {
    drawHowTo();
  } else if (G.screen === 'paused') {
    drawPaused();
  } else if (G.screen === 'upgrade') {
    drawUpgrade();
  } else if (G.screen === 'levelEnd') {
    drawLevelEnd();
  } else if (G.screen === 'campaignWin') {
    drawCampaignWin();
  } else {
    drawWorld();
    drawHud();
  }
  if (G.showHelp && (G.screen === 'playing' || G.screen === 'paused')) {
    drawHelpOverlay();
  }
}

// ---------------------------------------------------------------------------
// Scene presets for screenshots (?scene=start|aim|blast|frozen|victory)
// ---------------------------------------------------------------------------
function applyScenePreset(scene) {
  if (scene === 'start') {
    G.readyAt = 0.4;
    return;
  }
  startLevel(0);
  G.presetHold = true;
  G.banner = null; // screenshots show clean gameplay, not the intro banner
  if (scene === 'aim') {
    G.phase = 'aim';
    G.turn = 'amber';
    G.activeAnt = G.ants[0];
    G.stamina = staminaMax();
    G.wind = 2;
    G.aim = { angle: 62, power: 74 };
    G.selectedWeapon = 'durian';
    G.items.amber = { double: 1, split: 1, freeze: 1, glider: 1, repair: 2 };
    G.rage.amber = 64;
    const crate = { x: 640, y: G.terrain.surfaceY(640) - 14, vy: 0, landed: true, age: 1, item: 'freeze', sway: 0 };
    G.crates.push(crate);
    G.readyAt = 0.4;
  } else if (scene === 'blast') {
    G.phase = 'flying';
    G.turn = 'amber';
    G.activeAnt = G.ants[0];
    const foe = G.ants[3];
    const bx = foe.x - 10, by = foe.y - 30;
    explode(G, bx, by, weaponById('durian'), G.ants[0]);
    Particles.burst(bx, by, { count: 20, speed: 200, size: 5, life: 0.6, color: ['#ffd27a', '#ff9a3d', '#fff3c4'], shape: 'star' });
    G.readyAt = 0.22;
  } else if (scene === 'frozen') {
    G.phase = 'aim';
    G.turn = 'amber';
    G.activeAnt = G.ants[1];
    G.ants[4].frozen = 1;
    G.ants[3].honeyed = 1;
    G.wind = -3;
    G.aim = { angle: 55, power: 66 };
    G.selectedWeapon = 'thorns';
    G.selectedItem = 'freeze';
    G.items.amber = { double: 2, split: 1, freeze: 2, glider: 1, repair: 1 };
    G.readyAt = 0.4;
  } else if (scene === 'victory') {
    G.phase = 'done';
    for (const ant of G.ants) {
      if (ant.team === 'crimson') { ant.alive = false; ant.hp = 0; }
    }
    G.endInfo = {
      won: true, stars: 3, bonus: 1750,
      stats: { damage: 342, kills: 3, shots: 9, hits: 7 }
    };
    G.score = 6840;
    G.screen = 'levelEnd';
    G.readyAt = 0.4;
  }
}

// ---------------------------------------------------------------------------
// Probe API (window.__game): state for automated play-testing and screenshots.
// ---------------------------------------------------------------------------
window.__game = {
  state: function () {
    return {
      screen: G.screen, phase: G.phase, turn: G.turn,
      level: G.levelIndex, levelName: G.levelDef.name,
      score: G.score, wind: G.wind, stamina: Math.round(G.stamina),
      rage: { amber: Math.round(G.rage.amber), crimson: Math.round(G.rage.crimson) },
      activeAnt: G.activeAnt ? G.activeAnt.name : null,
      selectedWeapon: G.selectedWeapon,
      items: JSON.parse(JSON.stringify(G.items)),
      projectiles: G.projectiles.length,
      crates: G.crates.length,
      terrainRemaining: G.terrain ? +G.terrain.remaining().toFixed(3) : 1,
      ants: G.ants.map(function (a) {
        return {
          name: a.name, team: a.team, hp: a.hp, maxHp: a.maxHp,
          alive: a.alive, x: Math.round(a.x), y: Math.round(a.y),
          frozen: a.frozen, honeyed: a.honeyed, falling: a.falling
        };
      })
    };
  },
  fire: function (angle, power, weaponId) {
    if (G.phase !== 'aim' || G.turn !== 'amber') return false;
    if (weaponId) G.selectedWeapon = weaponId;
    return fire(angle, power, weaponId || G.selectedWeapon);
  },
  endTurn: function () {
    if (G.phase !== 'aim' || G.turn !== 'amber') return false;
    endTurn();
    return true;
  },
  selectWeapon: function (id) { G.selectedWeapon = id; return true; },
  useItem: function (id, x, y) { return useItem(id, x, y); },
  moveAnt: function (dx) {
    if (!G.activeAnt || G.phase !== 'aim') return 0;
    const moved = G.activeAnt.walk(dx, G.terrain);
    G.stamina = Math.max(0, G.stamina - moved * WALK_DRAIN);
    return moved;
  },
  jumpAnt: function () {
    if (!G.activeAnt || G.phase !== 'aim' || G.stamina < JUMP_COST) return false;
    if (G.activeAnt.jump()) { G.stamina -= JUMP_COST; return true; }
    return false;
  },
  setAim: function (angle, power) { G.aim.angle = angle; G.aim.power = power; return true; },
  startLevel: function (i) { startLevel(i); return true; },
  startGame: function () {
    G.campaign = newCampaign();
    G.score = 0;
    startLevel(0);
    return true;
  },
  setHp: function (team, index, hp) {
    const ant = G.ants.find(function (a) { return a.team === team && a.index === index; });
    if (!ant) return false;
    ant.hp = hp;
    ant.alive = hp > 0;
    return true;
  },
  setWind: function (w) { G.wind = w; return true; },
  setRage: function (team, v) { G.rage[team] = v; return true; },
  clickButton: function (labelPart) {
    for (const b of G.uiButtons) {
      if (b.label && b.label.toLowerCase().indexOf(labelPart.toLowerCase()) >= 0) {
        b.action();
        return true;
      }
    }
    return false;
  },
  pause: function () { togglePause(); return G.screen; },
  resume: function () { if (G.screen === 'paused') G.screen = 'playing'; return G.screen; },
  setTimeScale: function (n) { G.timeScale = Math.max(1, Math.min(6, n || 1)); return G.timeScale; },
  simulate: function (angle, power, weaponId) {
    const ant = G.activeAnt;
    if (!ant) return null;
    const muzzle = ant.muzzle();
    return simulateShot(muzzle.x, muzzle.y, angle, power, ant.facing, G.wind, weaponById(weaponId || G.selectedWeapon), G.terrain, G.ants, ant);
  },
  terrainAt: function (x) {
    return G.terrain ? Math.round(G.terrain.surfaceY(x)) : -1;
  }
};
window.__shotReady = false;

// ---------------------------------------------------------------------------
// Boot + main loop
// ---------------------------------------------------------------------------
buildTitleWorld();
if (G.scenePreset) applyScenePreset(G.scenePreset);

let lastNow = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  if (G.screen === 'playing') {
    // timeScale is a probe aid (window.__game.setTimeScale): 1 in normal
    // play; automated tests may run the simulation faster than real time.
    const scale = G.timeScale || 1;
    acc += dt * scale;
    let steps = 0;
    const maxSteps = Math.round(4 * scale);
    while (acc >= STEP && steps < maxSteps) {
      stepGame(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === maxSteps) acc = 0;
  } else {
    G.time += dt;
    Particles.update(dt);
    updateAmbient(dt);
  }
  draw();
  if (!G.shotReady && G.readyAt >= 0 && G.time >= G.readyAt) {
    G.shotReady = true;
    window.__shotReady = true;
  }
}

requestAnimationFrame(frame);
