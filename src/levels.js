// Campaign levels and between-level upgrades for SEEDSTORM. Five gardens, each
// with its own palette, weather and rising wind and AI skill. Palettes are
// chosen so the two colonies stay readable in every garden.
const LEVELS = [
  {
    name: 'Meadow Dawn', subtitle: 'First light over the clover field',
    skyTop: '#8ec9e8', skyMid: '#cdeef5', skyBottom: '#fdf3d0',
    sun: { x: 1060, y: 110, color: '#fff3b0', glow: 'rgba(255,240,170,0.55)' },
    hillFar: '#a8d5a2', hillNear: '#7fb069',
    soilTop: '#8a5a33', soilMid: '#6b4423', soilBottom: '#4a2c15', soilRim: '#a9713f',
    grass: '#5da24a', grassBlade: '#6fbf5a',
    weather: 'clear', windMax: 2, aiLevel: 'scout', decorDensity: 1.0,
    ambient: 'pollen'
  },
  {
    name: 'Twilight Grove', subtitle: 'Long shadows under the old oak leaf',
    skyTop: '#5b5f9e', skyMid: '#c98bb0', skyBottom: '#ffb37a',
    sun: { x: 220, y: 150, color: '#ffd9a0', glow: 'rgba(255,180,120,0.5)' },
    hillFar: '#7a6a9e', hillNear: '#5d5484',
    soilTop: '#7d5230', soilMid: '#5e3a20', soilBottom: '#3e2512', soilRim: '#96683c',
    grass: '#4f8f5a', grassBlade: '#5da86a',
    weather: 'dusk', windMax: 3, aiLevel: 'scout', decorDensity: 0.9,
    ambient: 'fireflies'
  },
  {
    name: 'Rainy Leaf', subtitle: 'Storm runoff in the gutter garden',
    skyTop: '#4e6e7e', skyMid: '#7fa3b0', skyBottom: '#b8cdd4',
    sun: null,
    hillFar: '#6b8a7a', hillNear: '#527a68',
    soilTop: '#6f5138', soilMid: '#543c27', soilBottom: '#372617', soilRim: '#85643f',
    grass: '#4e8c4a', grassBlade: '#5da24a',
    weather: 'rain', windMax: 3, aiLevel: 'soldier', decorDensity: 0.8,
    ambient: 'rain'
  },
  {
    name: 'Cracked Earth', subtitle: 'The dry bed where the giants walked',
    skyTop: '#e8a75c', skyMid: '#f2cf8e', skyBottom: '#f7e3b0',
    sun: { x: 640, y: 90, color: '#fff0c0', glow: 'rgba(255,220,150,0.6)' },
    hillFar: '#c9a06a', hillNear: '#a8824f',
    soilTop: '#9c6b3a', soilMid: '#7a4f26', soilBottom: '#523415', soilRim: '#b5854c',
    grass: '#a8a04a', grassBlade: '#bdb255',
    weather: 'dry', windMax: 4, aiLevel: 'soldier', decorDensity: 0.6,
    ambient: 'dust'
  },
  {
    name: 'Moonlit Garden', subtitle: 'The final stand beneath the full moon',
    skyTop: '#141c3f', skyMid: '#2a3566', skyBottom: '#4a5a8e',
    sun: { x: 1080, y: 100, color: '#e8ecff', glow: 'rgba(200,215,255,0.4)', moon: true },
    hillFar: '#2c3a5e', hillNear: '#22304f',
    soilTop: '#5d4632', soilMid: '#463322', soilBottom: '#2c1f14', soilRim: '#6e5741',
    grass: '#3f7a52', grassBlade: '#4c9463',
    weather: 'night', windMax: 5, aiLevel: 'general', decorDensity: 0.9,
    ambient: 'fireflies'
  }
];

// Between-level upgrades: the player picks 1 of 3. Each is a small permanent
// campaign bonus, applied to the shared campaign object.
const UPGRADES = [
  {
    id: 'vigor', name: 'Sturdy Shells', icon: '♥',
    desc: '+25 max HP for every ant in your colony.',
    apply: function (camp) { camp.hpBonus += 25; }
  },
  {
    id: 'stamina', name: 'Long Legs', icon: '➤',
    desc: '+25 stamina every turn: walk further, aim longer.',
    apply: function (camp) { camp.staminaBonus += 25; }
  },
  {
    id: 'damage', name: 'Sharper Seeds', icon: '✦',
    desc: '+15% damage on all of your weapons.',
    apply: function (camp) { camp.damageBonus += 0.15; }
  },
  {
    id: 'medic', name: 'Nectar Reserve', icon: '+',
    desc: 'Start every level with an extra Repair Nectar.',
    apply: function (camp) { camp.startRepair += 1; }
  },
  {
    id: 'gauge', name: 'Wind Chimes', icon: '≋',
    desc: 'The wind gauge shows the exact wind number and a longer preview.',
    apply: function (camp) { camp.fineGauge = true; }
  },
  {
    id: 'crates', name: 'Supply Lines', icon: '▣',
    desc: 'Supply crates drift down more often.',
    apply: function (camp) { camp.crateBonus += 1; }
  },
  {
    id: 'rage', name: 'Hot Tempers', icon: '🔥',
    desc: 'Rage builds 30% faster from dealing and taking damage.',
    apply: function (camp) { camp.rageBonus += 0.3; }
  },
  {
    id: 'split', name: 'Seed Pouch', icon: '∴',
    desc: 'Start every level with a Triple Split item.',
    apply: function (camp) { camp.startSplit += 1; }
  }
];

function newCampaign() {
  return {
    hpBonus: 0, staminaBonus: 0, damageBonus: 0,
    startRepair: 0, startSplit: 0, crateBonus: 0, rageBonus: 0,
    fineGauge: false, stars: [0, 0, 0, 0, 0]
  };
}
