// Donation modal + Ride Buddy hatcher.
// The support button appears only when donation-qr.png exists in the project,
// so the site never shows a dead donate button.

const DONATION_QR = 'donation-qr.png';

(function initDonate() {
  const btn = document.getElementById('donate-btn');
  const modal = document.getElementById('donate-modal');

  // Reveal the button only if the QR image actually exists
  const probe = new Image();
  probe.onload = () => btn.classList.remove('hidden');
  probe.src = DONATION_QR;

  btn.addEventListener('click', () => modal.classList.remove('hidden'));
  document.getElementById('donate-close').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.classList.add('hidden'); });

  document.getElementById('hatch-btn').addEventListener('click', hatchBuddy);
  document.getElementById('rehatch-btn').addEventListener('click', hatchBuddy);

  // A previously hatched buddy comes back home
  try {
    const saved = localStorage.getItem('hhbl-buddy');
    if (saved) renderBuddy(JSON.parse(saved));
  } catch (e) {}
})();

// ---- Ride Buddy: procedural pixel creature (original art, generated live) ----

const BUDDY_PALETTES = [
  ['#e8cd8f', '#c9a962', '#8a6f35', '#4a3b1c'], // champagne gold
  ['#9fd8ff', '#4aa8e8', '#1e6fa8', '#0d3a5c'], // sky blue
  ['#b8f0c9', '#57c785', '#2a8a55', '#12472b'], // track green
  ['#e8b3d8', '#c667a8', '#8a3a72', '#4a1c3c'], // orchid
  ['#ffd2a3', '#f09a4a', '#b25f1e', '#5c2f0d'], // sunset
  ['#d3c2f5', '#9a72e8', '#5f3ab2', '#2c1a5c'], // dusk violet
];

const NAME_START = ['Pi', 'Cha', 'Mo', 'Zu', 'Kra', 'Lek', 'Nok', 'Fah', 'Bo', 'Suk', 'Wan', 'Rin'];
const NAME_MID = ['ka', 'ri', 'lo', 'na', 'chai', 'phi', 'du', 'mee', ''];
const NAME_END = ['chu', 'mon', 'ling', 'bii', 'zor', 'nak', 'pip', 'gon', 'wing', 'paw'];

const FLAVORS = [
  'Loves tailwinds. Hates puddles.',
  'Sprints the back straight at 06:00 sharp.',
  'Naps under the Sky Bridge on hot days.',
  'Can smell rain 30 minutes away.',
  'Once drafted a plane on the runway fence.',
  'Believes every ride deserves a snack stop.',
  'Only rides counter-clockwise. Obviously.',
  'Collects lost bottle caps at the Bike Center.',
  'Afraid of thunder, brave in drizzle.',
  'Dreams of a 23.5 km personal best.',
];

function hatchBuddy() {
  const buddy = generateBuddy();
  renderBuddy(buddy);
  try { localStorage.setItem('hhbl-buddy', JSON.stringify(buddy)); } catch (e) {}
}

function generateBuddy() {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const name =
    pick(NAME_START, seed) + pick(NAME_MID, seed >> 3) + pick(NAME_END, seed >> 7);
  return {
    seed,
    name,
    flavor: pick(FLAVORS, seed >> 11),
    palette: Math.abs(seed >> 5) % BUDDY_PALETTES.length,
  };
}

function pick(arr, n) { return arr[Math.abs(n) % arr.length]; }

// Mulberry32 — tiny seeded PRNG so a saved buddy always redraws identically
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function renderBuddy(buddy) {
  const rand = rng(buddy.seed);
  const palette = BUDDY_PALETTES[buddy.palette];
  const G = 12; // grid size; left half generated, mirrored right

  // Fill half the grid, denser toward the middle for a body-like blob
  let grid = [];
  for (let y = 0; y < G; y++) {
    grid[y] = [];
    for (let x = 0; x < G / 2; x++) {
      const centerBias = 1 - (Math.abs(y - G / 2) / (G / 2)) * 0.55 - ((G / 2 - x) / (G / 2)) * 0.35;
      grid[y][x] = rand() < centerBias * 0.62 ? 1 : 0;
    }
  }
  // Smoothing pass: kill lonely pixels, fill strong neighbourhoods
  const half = G / 2;
  const at = (y, x) => (y >= 0 && y < G && x >= 0 && x < half ? grid[y][x] : 0);
  grid = grid.map((row, y) => row.map((v, x) => {
    const n = at(y-1,x) + at(y+1,x) + at(y,x-1) + at(y,x+1);
    if (v && n === 0) return 0;
    if (!v && n >= 3) return 1;
    return v;
  }));

  const canvas = document.getElementById('buddy-canvas');
  const ctx = canvas.getContext('2d');
  const px = canvas.width / (G + 2); // 1px border margin
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;

  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      const sx = x < half ? x : G - 1 - x; // mirror
      if (!grid[y][sx]) continue;
      // color: darker toward edges of the blob, lighter in the core
      const n = at(y-1,sx) + at(y+1,sx) + at(y,sx-1) + at(y,sx+1);
      const shade = n === 4 ? (rand() < 0.25 ? 0 : 1) : n >= 2 ? 2 : 3;
      ctx.fillStyle = palette[shade];
      ctx.fillRect((x + 1) * px, (y + 1) * px, px, px);
    }
  }

  // Eyes: symmetric pair on an upper filled row
  ctx.fillStyle = '#0b0e13';
  const eyeRow = Math.floor(G * 0.35);
  for (let y = eyeRow; y < G - 2; y++) {
    const xs = [];
    for (let x = 1; x < half; x++) if (grid[y][x]) xs.push(x);
    if (xs.length) {
      const ex = xs[Math.floor(rand() * xs.length)];
      ctx.fillRect((ex + 1) * px, (y + 1) * px, px, px);
      ctx.fillRect((G - ex) * px, (y + 1) * px, px, px);
      break;
    }
  }

  document.getElementById('buddy-name').textContent = buddy.name;
  document.getElementById('buddy-flavor').textContent = buddy.flavor;
  document.getElementById('buddy-result').classList.remove('hidden');
  document.getElementById('hatch-btn').classList.add('hidden');
}
