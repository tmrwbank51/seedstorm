// Seeded random numbers for SEEDSTORM: every run with the same seed plays the
// same level layouts, winds and crate drops. mulberry32 is small, fast and
// deterministic across engines.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash a short string into a 32-bit seed, so level names can seed generators.
function hashSeed(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A small RNG toolkit wrapping one mulberry32 stream.
function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next: next,
    range: function (lo, hi) { return lo + next() * (hi - lo); },
    int: function (lo, hi) { return Math.floor(lo + next() * (hi - lo + 1)); },
    pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
    chance: function (p) { return next() < p; },
    sign: function () { return next() < 0.5 ? -1 : 1; },
    shuffle: function (arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
      }
      return out;
    }
  };
}
