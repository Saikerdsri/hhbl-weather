// Live map for HHBL Sky Lane: lane geometry, animated rain radar (RainViewer),
// and a wind-flow particle layer driven by Open-Meteo wind data.

const MAP_CENTER = [13.687, 100.751];
const RAINVIEWER_META = 'https://api.rainviewer.com/public/weather-maps.json';
const RADAR_OPACITY = 0.65;
const RADAR_FRAME_MS = 700;      // time per frame
const RADAR_LAST_FRAME_MS = 1800; // hold on the newest frame a bit longer

let map = null;
let radarFrames = [];   // { time, layer, isForecast }
let radarIdx = 0;
let radarPlaying = true;
let radarTimer = null;

// ---------- Map + lane ----------

function laneStyle(cat) {
  switch (cat) {
    case 'blue':   return { color: '#0e7dd1', weight: 4, opacity: 0.95 };
    case 'purple': return { color: '#8e44ad', weight: 3.5, opacity: 0.9 };
    case 'kids':   return { color: '#1fa855', weight: 3, opacity: 0.9 };
    case 'bridge': return { color: '#e8720c', weight: 4, opacity: 0.95 };
    default:       return { color: '#7b8a99', weight: 2, opacity: 0.6, dashArray: '4 4' };
  }
}

function isDarkTheme() {
  return window.APP_THEME === 'lux' || window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function initMap() {
  if (map) return;
  const dark = isDarkTheme();
  map = L.map('map', { center: MAP_CENTER, zoom: 12, scrollWheelZoom: false, maxZoom: 18 });

  // Keyless basemap: OpenStreetMap in its own pane, darkened via CSS filter so
  // the radar overlay keeps its true colors. Full zoom detail, no API key.
  map.createPane('basemap');
  const basePane = map.getPane('basemap');
  basePane.style.zIndex = 150; // below tilePane (200) where the radar lives
  if (dark) basePane.classList.add('basemap-dark');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · radar <a href="https://www.rainviewer.com/">RainViewer</a>',
    maxZoom: 19,
    pane: 'basemap',
  }).addTo(map);

  // Lane geometry (generated from OSM into lane-data.js)
  if (typeof LANE_DATA !== 'undefined') {
    const order = ['misc', 'other_named', 'kids', 'bridge', 'purple', 'blue'];
    for (const cat of order) {
      for (const coords of (LANE_DATA[cat] || [])) {
        L.polyline(coords, laneStyle(cat)).addTo(map);
      }
    }
  }

  L.marker(MAP_CENTER, { opacity: 0 }).addTo(map)
    .bindTooltip('HHBL Sky Lane', { permanent: false });

  initRadar();
  initWindCanvas();
}

// ---------- Rain radar animation (RainViewer free API) ----------

async function initRadar() {
  const label = document.getElementById('radar-time');
  try {
    const res = await fetch(RAINVIEWER_META);
    const meta = await res.json();
    const host = meta.host;
    const past = (meta.radar?.past || []).slice(-7); // last ~70 minutes
    const nowcast = meta.radar?.nowcast || [];       // next ~30 minutes

    const entries = [
      ...past.map(f => ({ ...f, isForecast: false })),
      ...nowcast.map(f => ({ ...f, isForecast: true })),
    ];
    if (!entries.length) throw new Error('no radar frames');

    radarFrames = entries.map(f => ({
      time: f.time,
      isForecast: f.isForecast,
      layer: L.tileLayer(`${host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, {
        opacity: 0,
        zIndex: 400,
        maxZoom: 18,
      }).addTo(map),
    }));

    const slider = document.getElementById('radar-slider');
    slider.max = radarFrames.length - 1;
    slider.addEventListener('input', () => {
      setRadarPlaying(false);
      showRadarFrame(parseInt(slider.value, 10));
    });
    document.getElementById('radar-play').addEventListener('click', () => setRadarPlaying(!radarPlaying));

    // Start on the newest observed frame, then animate
    radarIdx = Math.max(0, past.length - 1);
    showRadarFrame(radarIdx);
    scheduleRadarTick();

    // Refresh radar frames every 5 minutes
    setTimeout(() => { destroyRadar(); initRadar(); }, 5 * 60 * 1000);
  } catch (e) {
    console.error('Radar init failed:', e);
    label.textContent = 'radar unavailable';
  }
}

function destroyRadar() {
  clearTimeout(radarTimer);
  for (const f of radarFrames) map.removeLayer(f.layer);
  radarFrames = [];
}

function showRadarFrame(idx) {
  if (!radarFrames.length) return;
  radarIdx = ((idx % radarFrames.length) + radarFrames.length) % radarFrames.length;
  radarFrames.forEach((f, i) => f.layer.setOpacity(i === radarIdx ? RADAR_OPACITY : 0));

  const f = radarFrames[radarIdx];
  const t = new Date(f.time * 1000).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok',
  });
  document.getElementById('radar-time').textContent = f.isForecast ? `${t} (forecast)` : t;
  document.getElementById('radar-slider').value = radarIdx;
}

function scheduleRadarTick() {
  clearTimeout(radarTimer);
  if (!radarPlaying || !radarFrames.length) return;
  const holdLast = radarIdx === radarFrames.length - 1;
  radarTimer = setTimeout(() => {
    showRadarFrame(radarIdx + 1);
    scheduleRadarTick();
  }, holdLast ? RADAR_LAST_FRAME_MS : RADAR_FRAME_MS);
}

function setRadarPlaying(playing) {
  radarPlaying = playing;
  document.getElementById('radar-play').textContent = playing ? '⏸' : '▶';
  scheduleRadarTick();
}

// ---------- Wind flow animation ----------

const wind = { speed: 0, dir: 0, gusts: 0 }; // dir = meteorological (blowing FROM), degrees
let particles = [];
const PARTICLE_COUNT = 110;

function initWindCanvas() {
  const canvas = document.getElementById('wind-canvas');
  const wrap = canvas.parentElement;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = wrap.clientWidth * devicePixelRatio;
    canvas.height = wrap.clientHeight * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    spawnParticles(wrap.clientWidth, wrap.clientHeight);
  }
  new ResizeObserver(resize).observe(wrap);
  resize();

  const lux = window.APP_THEME === 'lux';
  const dark = isDarkTheme();
  const trailColor = lux ? 'rgba(232, 205, 143, 0.7)'
    : dark ? 'rgba(180, 220, 255, 0.65)' : 'rgba(10, 70, 130, 0.55)';
  const haloColor = dark ? 'rgba(0, 20, 40, 0.5)' : 'rgba(255, 255, 255, 0.7)';

  function step() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    ctx.clearRect(0, 0, w, h);

    if (wind.speed > 0.5) {
      // Movement bearing = direction the wind blows TOWARD
      const bearing = (wind.dir + 180) * Math.PI / 180;
      const vx = Math.sin(bearing);
      const vy = -Math.cos(bearing);
      const px = 0.35 + wind.speed * 0.06; // px per frame

      for (const p of particles) {
        p.hist.push([p.x, p.y]);
        if (p.hist.length > 7) p.hist.shift();
        p.x += vx * px * p.mult;
        p.y += vy * px * p.mult;
        p.life -= 1;

        if (p.life <= 0 || p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) {
          respawn(p, w, h);
        }

        if (p.hist.length > 1) {
          const alpha = Math.min(1, p.life / 30);
          ctx.lineCap = 'round';
          // halo pass for contrast on any basemap
          ctx.strokeStyle = haloColor;
          ctx.lineWidth = 2.6;
          ctx.globalAlpha = alpha * 0.8;
          drawTrail(ctx, p);
          // main pass
          ctx.strokeStyle = trailColor;
          ctx.lineWidth = 1.3;
          ctx.globalAlpha = alpha;
          drawTrail(ctx, p);
          ctx.globalAlpha = 1;
        }
      }
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function drawTrail(ctx, p) {
  ctx.beginPath();
  ctx.moveTo(p.hist[0][0], p.hist[0][1]);
  for (let i = 1; i < p.hist.length; i++) ctx.lineTo(p.hist[i][0], p.hist[i][1]);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
}

function spawnParticles(w, h) {
  particles = Array.from({ length: PARTICLE_COUNT }, () => {
    const p = {};
    respawn(p, w, h);
    p.life = Math.random() * 90; // desync
    return p;
  });
}

function respawn(p, w, h) {
  p.x = Math.random() * w;
  p.y = Math.random() * h;
  p.mult = 0.7 + Math.random() * 0.6;
  p.life = 60 + Math.random() * 60;
  p.hist = [];
}

const COMPASS_PTS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
function compassName(deg) { return COMPASS_PTS[Math.round(deg / 22.5) % 16]; }

// Called from app.js after each forecast load
function updateMapWind(speed, dirFrom, gusts) {
  wind.speed = speed || 0;
  wind.dir = dirFrom || 0;
  wind.gusts = gusts || 0;
  // Compass arrow points where the wind blows TO
  document.getElementById('compass-arrow').setAttribute('transform', `rotate(${(dirFrom + 180) % 360} 30 30)`);
  document.getElementById('wind-speed-label').textContent = `${Math.round(speed)} km/h`;
  document.getElementById('wind-dir-label').textContent = `${compassName(dirFrom)} → ${compassName((dirFrom + 180) % 360)}`;
}
