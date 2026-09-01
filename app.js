// HHBL Sky Lane Weather — Suvarnabhumi bike lane, Bangkok
// © 2026 Thamarat Saikerdsri. Free to use and share with credit; do not claim as your own.
// Data: Open-Meteo (free, no API key). All times in Asia/Bangkok.

// Donations: see donate.js — the Support button appears automatically once
// donation-qr.png exists in the project root.

const LAT = 13.69;
const LON = 100.75;
const TZ = 'Asia/Bangkok';
const TRACK_OPEN = 6;   // 06:00
const TRACK_CLOSE = 21; // 21:00 (last entry earlier, lights on the lit loop)

const API_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
  `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,is_day` +
  `&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,rain,weather_code,wind_speed_10m,wind_gusts_10m,uv_index,is_day,et0_fao_evapotranspiration` +
  `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max` +
  `&timezone=${encodeURIComponent(TZ)}&forecast_days=7&past_days=1`;

// WMO weather codes -> description + icons (day / night)
const WMO = {
  0:  ['Clear sky', '☀️', '🌙'],
  1:  ['Mainly clear', '🌤️', '🌙'],
  2:  ['Partly cloudy', '⛅', '☁️'],
  3:  ['Overcast', '☁️', '☁️'],
  45: ['Fog', '🌫️', '🌫️'],
  48: ['Depositing rime fog', '🌫️', '🌫️'],
  51: ['Light drizzle', '🌦️', '🌧️'],
  53: ['Drizzle', '🌦️', '🌧️'],
  55: ['Dense drizzle', '🌧️', '🌧️'],
  61: ['Slight rain', '🌦️', '🌧️'],
  63: ['Rain', '🌧️', '🌧️'],
  65: ['Heavy rain', '🌧️', '🌧️'],
  66: ['Freezing rain', '🌧️', '🌧️'],
  67: ['Heavy freezing rain', '🌧️', '🌧️'],
  71: ['Slight snow', '🌨️', '🌨️'],
  73: ['Snow', '🌨️', '🌨️'],
  75: ['Heavy snow', '🌨️', '🌨️'],
  77: ['Snow grains', '🌨️', '🌨️'],
  80: ['Rain showers', '🌦️', '🌧️'],
  81: ['Moderate showers', '🌧️', '🌧️'],
  82: ['Violent showers', '⛈️', '⛈️'],
  85: ['Snow showers', '🌨️', '🌨️'],
  86: ['Heavy snow showers', '🌨️', '🌨️'],
  95: ['Thunderstorm', '⛈️', '⛈️'],
  96: ['Thunderstorm + hail', '⛈️', '⛈️'],
  99: ['Thunderstorm + heavy hail', '⛈️', '⛈️'],
};

function wmoDesc(code) { return (WMO[code] || ['Unknown', '❓', '❓'])[0]; }
function wmoIcon(code, isDay) { return (WMO[code] || ['?', '❓', '❓'])[isDay ? 1 : 2]; }

// ---- Track surface wetness model ----
// Simple water balance on the tarmac: each hour rain adds surface water (mm),
// evaporation removes it. Drying power comes from Open-Meteo's FAO reference
// evapotranspiration (sun + heat + wind + humidity), scaled up because hot
// asphalt dries much faster than the reference grass surface.
// Returns mm-equivalent wetness per hourly index (past 24h + full forecast).
function computeSurfaceWetness(d) {
  const rain = d.hourly.precipitation;
  const et0 = d.hourly.et0_fao_evapotranspiration;
  const wet = new Array(rain.length);
  let w = 0; // start 24h back at dry — anything older has evaporated in Bangkok heat
  for (let i = 0; i < rain.length; i++) {
    w += rain[i] || 0;
    w = Math.min(w, 6); // asphalt sheds standing water; wetness saturates
    const dry = 0.08 + 2.2 * (et0[i] || 0); // mm/h; ~0.15 at night, ~1+ in full sun
    w = Math.max(0, w - dry);
    wet[i] = w;
  }
  return wet;
}

const SURFACE_LEVELS = [
  { max: 0.1, label: 'Dry', icon: '🛣️', penalty: 0 },
  { max: 0.8, label: 'Damp', icon: '🛣️', penalty: 8 },
  { max: 3.0, label: 'Wet', icon: '⚠️', penalty: 25 },
  { max: Infinity, label: 'Soaked', icon: '⚠️', penalty: 40 },
];

function surfaceLevel(wetness) {
  return SURFACE_LEVELS.find((l) => wetness <= l.max);
}

// ---- Ride score: 0–100, higher = better riding conditions ----
function rideScore(h) {
  let score = 100;

  // Rain probability — the big one in Bangkok
  score -= (h.precipProb || 0) * 0.55;
  // Actual precipitation forecast (mm)
  if (h.precip > 0) score -= Math.min(40, h.precip * 18);
  // Thunderstorms are a hard no on an exposed airport loop
  if (h.code >= 95) score -= 50;
  else if (h.code >= 80) score -= 20;
  else if (h.code >= 61) score -= 15;
  else if (h.code >= 51) score -= 8;

  // Heat: apparent temperature
  const feels = h.feels;
  if (feels >= 42) score -= 30;
  else if (feels >= 38) score -= 18;
  else if (feels >= 35) score -= 9;

  // Wind (km/h) — Sky Lane is wide open, gusts matter
  if (h.gusts >= 45) score -= 20;
  else if (h.wind >= 30) score -= 12;
  else if (h.wind >= 20) score -= 5;

  // UV during the day
  if (h.uv >= 11) score -= 10;
  else if (h.uv >= 8) score -= 5;

  // Wet tarmac is slippery even after the rain stops
  score -= surfaceLevel(h.wetness || 0).penalty;
  // Fresh rain on dry tarmac lifts the oil film — the most slippery moment
  if (h.freshRain) score -= 12;

  // A very likely soaking can never rate better than "fair"
  if ((h.precipProb || 0) >= 70) score = Math.min(score, 50);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreBand(score) {
  if (score >= 75) return 'great';
  if (score >= 55) return 'good';
  if (score >= 35) return 'fair';
  return 'poor';
}

const BAND_LABEL = { great: 'Great', good: 'Good', fair: 'Fair', poor: 'Poor' };

function verdictCopy(band, h) {
  switch (band) {
    case 'great': return ['🚴', 'Great time to ride!', 'Conditions at Sky Lane look excellent. Roll out!'];
    case 'good':  return ['👍', 'Good riding conditions', 'A solid session is on — keep an eye on the sky.'];
    case 'fair':  return ['🤔', 'Rideable, but watch out', reasonText(h) || 'Conditions are mixed. Short loops recommended.'];
    default:      return ['⛔', 'Not a good time to ride', reasonText(h) || 'Sit this one out and check the next window.'];
  }
}

function reasonText(h) {
  const reasons = [];
  if (h.code >= 95) reasons.push('thunderstorms around');
  else if (h.precipProb >= 60) reasons.push(`${h.precipProb}% chance of rain`);
  else if (h.precipProb >= 35) reasons.push(`${h.precipProb}% rain chance`);
  if (h.freshRain) reasons.push('fresh rain on dry tarmac — extra slippery');
  else if ((h.wetness || 0) > 3) reasons.push('tarmac soaked — very slippery');
  else if ((h.wetness || 0) > 0.8) reasons.push('tarmac still wet from earlier rain');
  else if ((h.wetness || 0) > 0.1) reasons.push('tarmac damp in places');
  if (h.feels >= 38) reasons.push(`feels like ${Math.round(h.feels)}°C`);
  if (h.gusts >= 45) reasons.push(`gusts to ${Math.round(h.gusts)} km/h`);
  else if (h.wind >= 30) reasons.push(`windy (${Math.round(h.wind)} km/h)`);
  if (h.uv >= 8) reasons.push(`UV ${Math.round(h.uv)}`);
  if (!reasons.length) return '';
  const s = reasons.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

function hourData(d, i) {
  const wetness = d._wetness ? d._wetness[i] : 0;
  const prevWet = d._wetness && i > 0 ? d._wetness[i - 1] : 0;
  return {
    time: d.hourly.time[i],
    temp: d.hourly.temperature_2m[i],
    feels: d.hourly.apparent_temperature[i],
    precipProb: d.hourly.precipitation_probability[i],
    precip: d.hourly.precipitation[i],
    code: d.hourly.weather_code[i],
    wind: d.hourly.wind_speed_10m[i],
    gusts: d.hourly.wind_gusts_10m[i],
    uv: d.hourly.uv_index[i],
    isDay: d.hourly.is_day[i],
    wetness,
    freshRain: (d.hourly.precipitation[i] || 0) > 0.2 && prevWet < 0.1,
  };
}

// Current time in Bangkok regardless of the viewer's timezone
function bangkokNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
}

function fmtHour(iso) {
  const h = parseInt(iso.slice(11, 13), 10);
  return `${String(h).padStart(2, '0')}:00`;
}

function fmtDay(iso, todayIso) {
  if (iso === todayIso) return 'Today';
  const d = new Date(iso + 'T00:00:00');
  const tomorrow = new Date(todayIso + 'T00:00:00');
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.getTime() === tomorrow.getTime()) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ---- Rendering ----

function renderCurrent(d) {
  const c = d.current;
  document.getElementById('current-icon').textContent = wmoIcon(c.weather_code, c.is_day);
  document.getElementById('current-temp').textContent = `${Math.round(c.temperature_2m)}°C`;
  document.getElementById('current-desc').textContent = wmoDesc(c.weather_code);
  document.getElementById('current-feels').textContent = `Feels like ${Math.round(c.apparent_temperature)}°C`;
  document.getElementById('stat-humidity').textContent = `${c.relative_humidity_2m}%`;
  document.getElementById('stat-wind').textContent = `${Math.round(c.wind_speed_10m)} km/h (gusts ${Math.round(c.wind_gusts_10m)})`;
  document.getElementById('stat-rain').textContent = c.rain > 0 ? `${c.rain.toFixed(1)} mm` : 'None';
  document.getElementById('stat-uv').textContent = c.uv_index != null ? c.uv_index.toFixed(1) : '–';
}

function renderSurface(d, nowIdx) {
  const wet = d._wetness[nowIdx];
  const level = surfaceLevel(wet);
  document.getElementById('surface-icon').textContent = level.icon;
  document.getElementById('stat-surface').textContent = level.label;

  const detail = document.getElementById('surface-detail');
  if (wet <= 0.1) {
    detail.textContent = 'Track surface';
  } else {
    // Estimated time the tarmac dries out (first modelled-dry hour ahead)
    let dryIdx = -1;
    for (let i = nowIdx + 1; i < Math.min(nowIdx + 36, d._wetness.length); i++) {
      if (d._wetness[i] <= 0.1) { dryIdx = i; break; }
    }
    detail.textContent = dryIdx > 0
      ? `Slippery — dry ~${fmtHour(d.hourly.time[dryIdx])}`
      : 'Slippery — wet for a while';
  }
}

function renderVerdict(d, nowIdx) {
  const now = bangkokNow();
  const hour = now.getHours();
  const el = document.getElementById('verdict');
  const h = hourData(d, nowIdx);
  // Blend current observations into the score input where we have them
  h.precip = Math.max(h.precip, d.current.precipitation || 0);
  h.code = d.current.weather_code;
  h.feels = d.current.apparent_temperature;
  h.wind = d.current.wind_speed_10m;
  h.gusts = d.current.wind_gusts_10m;

  const score = rideScore(h);
  const band = scoreBand(score);

  if (hour < TRACK_OPEN || hour >= TRACK_CLOSE) {
    el.className = 'verdict v-closed';
    document.getElementById('verdict-emoji').textContent = '🌙';
    document.getElementById('verdict-title').textContent = 'Track is closed right now';
    document.getElementById('verdict-detail').textContent =
      `Sky Lane opens ${String(TRACK_OPEN).padStart(2, '0')}:00–${TRACK_CLOSE}:00. Check the ride windows below for your next session.`;
  } else {
    const [emoji, title, detail] = verdictCopy(band, h);
    el.className = `verdict v-${band}`;
    document.getElementById('verdict-emoji').textContent = emoji;
    document.getElementById('verdict-title').textContent = title;
    document.getElementById('verdict-detail').textContent = detail;
  }
  document.getElementById('score-value').textContent = score;
}

function renderHourly(d, nowIdx) {
  const container = document.getElementById('hourly');
  container.innerHTML = '';
  const end = Math.min(nowIdx + 24, d.hourly.time.length);
  for (let i = nowIdx; i < end; i++) {
    const h = hourData(d, i);
    const hr = parseInt(h.time.slice(11, 13), 10);
    const open = hr >= TRACK_OPEN && hr < TRACK_CLOSE;
    const band = scoreBand(rideScore(h));
    const cell = document.createElement('div');
    cell.className = `hour-cell h-${band}${open ? '' : ' h-closed'}`;
    cell.title = open
      ? `${BAND_LABEL[band]} · feels ${Math.round(h.feels)}°C · wind ${Math.round(h.wind)} km/h`
      : 'Track closed';
    cell.innerHTML = `
      <div class="hour-time">${i === nowIdx ? 'Now' : fmtHour(h.time)}</div>
      <div class="hour-icon">${wmoIcon(h.code, h.isDay)}</div>
      <div class="hour-temp">${Math.round(h.temp)}°</div>
      <div class="hour-rain">${h.precipProb > 0 ? h.precipProb + '%' : '&nbsp;'}</div>`;
    container.appendChild(cell);
  }
}

function renderRideWindows(d, nowIdx) {
  const container = document.getElementById('ride-windows');
  container.innerHTML = '';
  const todayIso = d.hourly.time[nowIdx].slice(0, 10);

  // Group open-hours slots by date for the next ~3 days
  const byDay = new Map();
  for (let i = nowIdx; i < d.hourly.time.length; i++) {
    const h = hourData(d, i);
    const date = h.time.slice(0, 10);
    const hr = parseInt(h.time.slice(11, 13), 10);
    if (hr < TRACK_OPEN || hr >= TRACK_CLOSE) continue;
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push({ ...h, hr, score: rideScore(h) });
    if (byDay.size > 3 ) break;
  }

  let shown = 0;
  for (const [date, slots] of byDay) {
    if (shown >= 3) break;
    // Find the best contiguous run of >=2 hours with score >= 55, else best single hour
    let best = null;
    let run = [];
    const flush = () => {
      if (run.length >= 1) {
        const avg = run.reduce((s, x) => s + x.score, 0) / run.length;
        if (!best || run.length > best.slots.length || (run.length === best.slots.length && avg > best.avg)) {
          best = { slots: [...run], avg };
        }
      }
      run = [];
    };
    for (const s of slots) {
      if (s.score >= 55) run.push(s);
      else flush();
    }
    flush();

    const row = document.createElement('div');
    row.className = 'window-row';
    if (best && best.slots.length) {
      const first = best.slots[0];
      const last = best.slots[best.slots.length - 1];
      const band = scoreBand(best.avg);
      const why = reasonText(best.slots[0]) || `Avg feels-like ${Math.round(best.slots.reduce((s, x) => s + x.feels, 0) / best.slots.length)}°C, low rain risk.`;
      row.innerHTML = `
        <span class="w-day">${fmtDay(date, todayIso)}</span>
        <span class="w-time">${String(first.hr).padStart(2, '0')}:00–${String(last.hr + 1).padStart(2, '0')}:00</span>
        <span class="w-why">${why}</span>
        <span class="window-badge b-${band}">${BAND_LABEL[band]}</span>`;
    } else {
      // No good window — show the least-bad hour
      const bestSlot = slots.reduce((a, b) => (b.score > a.score ? b : a), slots[0]);
      row.innerHTML = `
        <span class="w-day">${fmtDay(date, todayIso)}</span>
        <span class="w-time">${String(bestSlot.hr).padStart(2, '0')}:00</span>
        <span class="w-why">Rough day — ${reasonText(bestSlot).toLowerCase() || 'poor conditions all day'} Best of a bad lot.</span>
        <span class="window-badge b-${scoreBand(bestSlot.score)}">${BAND_LABEL[scoreBand(bestSlot.score)]}</span>`;
    }
    container.appendChild(row);
    shown++;
  }

  if (!shown) {
    container.innerHTML = '<p class="no-window">No forecast slots available.</p>';
  }
}

function renderDaily(d) {
  const container = document.getElementById('daily');
  container.innerHTML = '';
  // With past_days=1 the first daily entry is yesterday — start from today
  const now = bangkokNow();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const start = Math.max(0, d.daily.time.indexOf(todayIso));
  for (let i = start; i < d.daily.time.length; i++) {
    const row = document.createElement('div');
    row.className = 'day-row';
    const code = d.daily.weather_code[i];
    row.innerHTML = `
      <span class="day-name">${fmtDay(d.daily.time[i], todayIso)}</span>
      <span class="day-icon">${wmoIcon(code, 1)}</span>
      <span class="day-desc">${wmoDesc(code)}</span>
      <span class="day-rain">💧 ${d.daily.precipitation_probability_max[i] ?? 0}% · ${(d.daily.precipitation_sum[i] ?? 0).toFixed(1)} mm</span>
      <span class="day-temps">${Math.round(d.daily.temperature_2m_max[i])}° <span class="t-min">${Math.round(d.daily.temperature_2m_min[i])}°</span></span>`;
    container.appendChild(row);
  }
}

async function loadWeather() {
  const loading = document.getElementById('loading');
  const error = document.getElementById('error');
  const content = document.getElementById('content');
  loading.classList.remove('hidden');
  error.classList.add('hidden');

  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Index of the current hour in the hourly arrays (API returns Bangkok local times)
    const now = bangkokNow();
    const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:00`;
    let nowIdx = data.hourly.time.indexOf(nowKey);
    if (nowIdx < 0) nowIdx = 24; // with past_days=1, "now" sits ~24h into the arrays

    data._wetness = computeSurfaceWetness(data);

    renderCurrent(data);
    renderSurface(data, nowIdx);
    renderVerdict(data, nowIdx);
    renderHourly(data, nowIdx);
    renderRideWindows(data, nowIdx);
    renderDaily(data);

    document.getElementById('last-updated').textContent =
      'Updated ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    loading.classList.add('hidden');
    content.classList.remove('hidden');

    // Live map (defined in map.js) — init once the card is visible, then feed wind
    if (typeof initMap === 'function') {
      initMap();
      updateMapWind(data.current.wind_speed_10m, data.current.wind_direction_10m, data.current.wind_gusts_10m);
    }
  } catch (e) {
    console.error('Forecast load failed:', e);
    loading.classList.add('hidden');
    content.classList.add('hidden');
    error.classList.remove('hidden');
  }
}

// Credit footer: keep the year current
document.getElementById('credit-year').textContent = bangkokNow().getFullYear();

// PWA: register the service worker (works on https and localhost)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed:', e));
}

document.getElementById('refresh-btn').addEventListener('click', loadWeather);
loadWeather();
// Auto-refresh every 15 minutes
setInterval(loadWeather, 15 * 60 * 1000);
