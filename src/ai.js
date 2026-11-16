// The AI opponent for SEEDSTORM. It solves the same ballistic physics the
// player aims with, then adds error scaled by difficulty, so higher
// difficulties genuinely shoot straighter. It avoids shots that would
// obviously hit its own ants, picks weapons for the situation, and uses items
// on the higher difficulties.
const AI_DIFFICULTY = {
  scout: {
    label: 'Scout', aimErr: 13, powerErr: 16, windErr: 1.6,
    useItems: false, moveChance: 0.35, thinkMs: 900
  },
  soldier: {
    label: 'Soldier', aimErr: 7.5, powerErr: 9, windErr: 0.9,
    useItems: true, moveChance: 0.55, thinkMs: 700
  },
  general: {
    label: 'General', aimErr: 3.2, powerErr: 4, windErr: 0.4,
    useItems: true, moveChance: 0.7, thinkMs: 550
  }
};

function pickTarget(game, ant) {
  const foes = game.ants.filter(function (a) { return a.alive && a.team !== ant.team; });
  if (foes.length === 0) return null;
  // Prefer the weakest foe, but sometimes pick at random for variety.
  foes.sort(function (a, b) { return a.hp - b.hp; });
  if (game.rng.chance(0.65)) return foes[0];
  return game.rng.pick(foes);
}

function pickWeapon(game, ant, target, dist) {
  const opts = ['bazooka', 'bazooka', 'durian', 'thorns', 'acorn'];
  if (dist < 220) opts.push('thorns', 'honey');
  if (dist > 520) opts.push('durian', 'acorn');
  if (game.rage >= 100 && ant.team === 'crimson') return 'rage';
  // Honey a foe that is about to act, on higher difficulties.
  const diff = AI_DIFFICULTY[game.aiLevel];
  if (diff.useItems && target.hp > 50 && game.rng.chance(0.18)) return 'honey';
  return game.rng.pick(opts);
}

// Search angle/power pairs for the one whose simulated shot lands closest to
// the target, penalising shots that would hit a friendly ant.
function solveShot(game, ant, target, weaponId, windGuess) {
  const weapon = weaponById(weaponId);
  const muzzle = ant.muzzle();
  const facing = target.x >= ant.x ? 1 : -1;
  let best = null;
  for (let angle = 25; angle <= 85; angle += 3) {
    for (let power = 25; power <= 100; power += 3) {
      const sim = simulateShot(muzzle.x, muzzle.y, angle, power, facing, windGuess, weapon, game.terrain, game.ants, ant);
      const last = sim.points[sim.points.length - 1];
      if (!last) continue;
      let score = Math.hypot(last.x - target.x, last.y - (target.y - 18));
      if (sim.hit && sim.hit.kind === 'ant') {
        score = sim.hit.ant === target ? score * 0.2 : score + 400;
      }
      if (sim.hit && sim.hit.kind === 'ground') {
        // Landing just short still hurts through the blast radius.
        const d = Math.hypot(sim.hit.x - target.x, sim.hit.y - target.y);
        score = Math.min(score, d + 20);
      }
      if (!best || score < best.score) best = { angle: angle, power: power, score: score, facing: facing };
    }
  }
  return best;
}

// Plan one full AI turn. Returns {move, angle, power, weaponId, item} where
// move is a signed pixel distance to walk before shooting.
function planAiTurn(game, ant) {
  const diff = AI_DIFFICULTY[game.aiLevel];
  const target = pickTarget(game, ant);
  if (!target) return null;
  const dist = Math.abs(target.x - ant.x);
  const weaponId = pickWeapon(game, ant, target, dist);
  // The AI estimates the wind with error: better difficulties read it better.
  const windGuess = game.wind + game.rng.range(-diff.windErr, diff.windErr);
  const solved = solveShot(game, ant, target, weaponId, windGuess);
  let angle = solved ? solved.angle : 55;
  let power = solved ? solved.power : 60;
  angle += game.rng.range(-diff.aimErr, diff.aimErr);
  power += game.rng.range(-diff.powerErr, diff.powerErr);
  angle = Math.max(15, Math.min(88, angle));
  power = Math.max(15, Math.min(100, power));
  // Re-face toward the target if the solve says so.
  if (solved) ant.facing = solved.facing;
  // Optional repositioning: usually walk toward the target so the fight
  // stays in range, sometimes wander. Pure random walks let ants drift to
  // the map edges and stall the match out of weapon range.
  let move = 0;
  if (game.rng.chance(diff.moveChance)) {
    const toward = target.x >= ant.x ? 1 : -1;
    const dir = game.rng.chance(0.7) ? toward : game.rng.sign();
    move = dir * game.rng.int(20, 90);
  }
  // Item use on higher difficulties.
  let item = null;
  if (diff.useItems) {
    const inv = game.items.crimson;
    if (ant.hp <= 45 && inv.repair > 0) item = 'repair';
    else if (inv.freeze > 0 && game.rng.chance(0.3)) item = 'freeze';
    else if (inv.double > 0 && game.rng.chance(0.22)) item = 'double';
  }
  return { move: move, angle: angle, power: power, weaponId: weaponId, item: item, target: target };
}
