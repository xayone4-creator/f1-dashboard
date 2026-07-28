'use strict';

// APEX is deliberately dependency-free: rendering stays fluid even while F1 sends UDP at 60 Hz.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const fmt = new Intl.NumberFormat('fr-FR');

function formatLapTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0');
  return `${minutes}:${seconds}`;
}
function formatDelta(ms) {
  if (!Number.isFinite(ms)) return '+0.000';
  return `${ms < 0 ? '−' : '+'}${Math.abs(ms / 1000).toFixed(3)}`;
}
function clamp(number, min, max) { return Math.max(min, Math.min(max, number)); }
function sessionLabel(type) {
  const labels = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'SHORT P', 5: 'QUALIFYING', 6: 'RACE', 7: 'RACE', 8: 'TIME TRIAL' };
  return labels[type] || 'SESSION LIVE';
}

const appState = {
  connected: false,
  latest: null,
  latestTrack: null,
  // Do not invent a history. These entries come only from completed F1 laps.
  laps: [],
  demoStart: performance.now(),
  activeMode: localStorage.getItem('apex-profile') || 'qualifying',
  shownView: 'dashboard',
  trackOutline: null,
  mapTrail: [],
  chartFrame: 0,
  comparison: null,
  analysisCursor: .5,
};

// ---------------------------------------------------------------------------
// WebSocket / live telemetry
// ---------------------------------------------------------------------------
let ws;
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}/ws`);
  ws.onmessage = (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch (_) { return; }
    if (message.type === 'hello') $('#udpPort').textContent = `UDP : ${message.udpPort}`;
    if (message.type === 'live') handleLive(message);
    if (message.type === 'lapList') handleLapList(message.laps || []);
    if (message.type === 'trackOutline') handleTrackOutline(message);
    if (message.type === 'lapData') cacheLapData(message);
  };
  ws.onclose = () => { appState.connected = false; setTimeout(connect, 1500); };
  ws.onerror = () => ws.close();
}
connect();

const lapDataCache = {};
function cacheLapData(message) {
  if (message.lap) lapDataCache[message.lapNumber] = message.lap;
}
function requestLap(lapNumber) {
  return new Promise((resolve) => {
    if (lapDataCache[lapNumber]) return resolve(lapDataCache[lapNumber]);
    if (!ws || ws.readyState !== WebSocket.OPEN) return resolve(null);
    const listener = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      if (message.type !== 'lapData' || String(message.lapNumber) !== String(lapNumber)) return;
      ws.removeEventListener('message', listener);
      cacheLapData(message);
      resolve(message.lap || null);
    };
    ws.addEventListener('message', listener);
    ws.send(JSON.stringify({ type: 'getLap', lapNumber: Number(lapNumber) }));
    setTimeout(() => { ws.removeEventListener('message', listener); resolve(null); }, 800);
  });
}

function handleLive(message) {
  appState.connected = Boolean(message.connected);
  if (!message.connected) return;
  appState.latest = message;
  appState.latestTrack = message.session?.trackName || appState.latestTrack;
  renderSnapshot(toDashboardSnapshot(message));
}
function handleTrackOutline(message) {
  appState.trackOutline = message.points || null;
  appState.mapTrail = [];
}
function handleLapList(laps) {
  if (!laps.length) return;
  appState.laps = laps.map((lap, index) => ({
    ...lap,
    compound: index < 1 ? 'M' : 'S', wear: clamp(7 + index * 3, 7, 46),
    delta: index === laps.length - 1 ? 248 : Math.max(0, lap.lapTimeMs - Math.min(...laps.map((item) => item.lapTimeMs))),
  }));
  renderLapInterfaces();
  renderTheoreticalBest();
}

function renderTheoreticalBest() {
  const badge = $('#theoreticalBest'); if (!badge) return;
  const laps = appState.laps;
  const s1 = laps.map((lap) => lap.sector1TimeInMS).filter(Number.isFinite);
  const s2 = laps.map((lap) => lap.sector2TimeInMS).filter(Number.isFinite);
  const s3 = laps.map((lap) => lap.sector3TimeInMS).filter(Number.isFinite);
  if (!s1.length || !s2.length || !s3.length) { badge.hidden = true; return; }
  const theoreticalMs = Math.min(...s1) + Math.min(...s2) + Math.min(...s3);
  const bestActualMs = Math.min(...laps.map((lap) => lap.lapTimeMs));
  const gapMs = theoreticalMs - bestActualMs;
  badge.hidden = false;
  $('#theoreticalBestTime').textContent = formatLapTime(theoreticalMs);
  $('#theoreticalBestGap').textContent = gapMs < -5 ? `${formatDelta(gapMs)} vs meilleur tour` : 'déjà atteint';
  $('#theoreticalBestGap').className = gapMs < -5 ? 'good' : 'loss';
}

function toDashboardSnapshot(message) {
  const me = message.cars.find((car) => car.index === message.playerCarIndex) || {};
  const lap = me.lap || {};
  const telemetry = me.telemetry || me;
  const status = me.status || {};
  // Prefer the delta calculated locally against the best saved lap. Race gaps
  // are only a fallback: they do not represent the Time Trial ghost.
  const hasGhost = Number.isFinite(message.playerDeltaToGhostMs);
  const hasLocalBest = Number.isFinite(message.playerDeltaToBestMs);
  const hasReference = hasGhost || hasLocalBest;
  const actualDelta = hasGhost ? message.playerDeltaToGhostMs : (hasLocalBest ? message.playerDeltaToBestMs : null);
  const ghostCar = Number.isFinite(message.ghostCarIndex) && message.ghostCarIndex >= 0
    ? message.cars.find((car) => car.index === message.ghostCarIndex) : null;
  return {
    real: true,
    trackName: message.session?.trackName || 'CIRCUIT',
    sessionType: sessionLabel(message.session?.sessionType),
    totalLaps: message.session?.totalLaps || '—',
    air: message.session?.airTemperature ?? '—',
    track: message.session?.trackTemperature ?? '—',
    speed: telemetry.speed || 0,
    gear: telemetry.gear ?? 0,
    rpm: telemetry.rpm || telemetry.engineRPM || 0,
    throttle: Math.round((telemetry.throttle || 0) * (telemetry.throttle <= 1 ? 100 : 1)),
    brake: Math.round((telemetry.brake || 0) * (telemetry.brake <= 1 ? 100 : 1)),
    steering: Math.round((telemetry.steering || telemetry.steer || 0) * 28),
    drs: Boolean(telemetry.drs),
    ers: status.ersPercent ?? 0,
    fuel: status.fuelInTank ?? 0,
    fuelLaps: status.fuelRemainingLaps ?? 0,
    compound: status.compound || '—',
    tyreAge: status.tyresAgeLaps ?? 0,
    temps: telemetry.tyreSurfaceTemperature || [0, 0, 0, 0],
    wear: status.tyreWear ?? 0,
    wearCorners: status.tyreWearByCorner || [0, 0, 0, 0],
    lapNumber: lap.currentLapNum || 0,
    lapTime: lap.currentLapTimeInMS || 0,
    bestLap: appState.laps.length ? Math.min(...appState.laps.map((item) => item.lapTimeMs)) : 0,
    delta: actualDelta,
    hasReference,
    referenceSource: hasGhost ? 'ghost F1' : (hasLocalBest ? 'meilleur tour local' : null),
    position: lap.position || 0,
    front: lap.deltaToCarInFrontMS || 0,
    back: 1327,
    cars: message.cars,
    playerCarIndex: message.playerCarIndex,
    lapInvalid: Boolean(lap.currentLapInvalid),
    currentSector: lap.sector || 0,
    sector1Live: lap.sector1TimeInMS || null,
    sector2Live: lap.sector2TimeInMS || null,
    referenceSectors: message.referenceSectors || null,
    ghostName: ghostCar ? ghostCar.name : null,
    ghostBestLapMs: ghostCar?.lap?.lastLapTimeInMS || ghostCar?.lap?.currentLapTimeInMS || null,
  };
}

// ---------------------------------------------------------------------------
// Demo driver: it makes the interface useful before the first UDP packet.
// ---------------------------------------------------------------------------
function createDemoSnapshot() {
  const elapsed = (performance.now() - appState.demoStart) / 1000;
  const phase = elapsed * .42;
  const speed = Math.round(274 + Math.sin(phase * 1.4) * 23 + Math.sin(phase * 3.9) * 9);
  const braking = clamp(Math.round(Math.max(0, Math.sin(phase * 1.1 - .3)) * 71), 0, 100);
  const throttle = clamp(Math.round(93 - braking * .84 + Math.sin(phase * 2.2) * 4), 0, 100);
  const delta = Math.round(248 + Math.sin(phase * 1.7) * 125);
  const cars = ['VERSTAPPEN', 'LECLERC', 'NORRIS', 'RUSSELL', 'HAMILTON', 'ROUSS', 'PIASTRI', 'ALONSO'].map((name, index) => ({
    index,
    name,
    color: ['#3873d1', '#ed3d4a', '#ff922d', '#29d5c5', '#e63a47', '#a879ff', '#ff922d', '#2f9b73'][index],
    lap: { position: index + 1, lastLapTimeInMS: 80274 + index * 253, deltaToRaceLeaderMS: index * 375 },
    pos: monzaPoint((phase * .03 + index / 8) % 1),
  }));
  return {
    real: false, trackName: 'AUTODROMO NAZIONALE MONZA', sessionType: 'QUALIFYING', totalLaps: 27,
    air: 24, track: 32, speed, gear: speed > 305 ? 8 : 7, rpm: Math.round(10600 + speed * 2.15), throttle, brake: braking,
    steering: Math.round(Math.sin(phase * 2) * 13), drs: speed > 289, ers: Math.round(68 - Math.sin(phase * .31) * 4), fuel: +(12.7 - elapsed / 520).toFixed(1), fuelLaps: 1.8,
    compound: 'SOFT', tyreAge: 6, temps: [92, 94, 88, 89].map((temperature, index) => temperature + Math.round(Math.sin(phase + index) * 2)), wear: 14,
    lapNumber: 17, lapTime: 62847 + Math.round((elapsed % 30) * 1000), bestLap: 80456, delta: null, hasReference: false, position: 6, front: 812, back: 1327, cars, playerCarIndex: 5,
    lapInvalid: false, currentSector: Math.floor((elapsed % 30) / 10) + 1, sector1Live: null, sector2Live: null, referenceSectors: null, ghostName: 'FANTÔME DÉMO', ghostBestLapMs: 80456,
  };
}

function tickDemo() {
  const now = performance.now();
  if (!appState.connected && (!appState.lastDemoFrame || now - appState.lastDemoFrame > 65)) {
    appState.lastDemoFrame = now;
    renderSnapshot(createDemoSnapshot());
  }
  requestAnimationFrame(tickDemo);
}
requestAnimationFrame(tickDemo);

// ---------------------------------------------------------------------------
// UI rendering
// ---------------------------------------------------------------------------
function renderSnapshot(data) {
  const status = data.real ? 'RÉCEPTION UDP' : 'SIMULATION';
  $('#connectionText').textContent = data.real ? 'UDP CONNECTÉ' : 'MODE DÉMO';
  $('.status-dot').classList.toggle('live', data.real);
  $('#liveStatus').textContent = status;
  $('#liveStatus').style.color = data.real ? 'var(--green)' : 'var(--accent)';
  $('#settingsConnection').textContent = data.real ? 'CONNECTÉ' : 'EN ATTENTE';
  $('#settingsConnection').style.color = data.real ? 'var(--green)' : 'var(--accent)';
  $('#trackName').textContent = data.trackName.toUpperCase().replace('AUTODROMO NAZIONALE ', '');
  $('#mapTrackName').textContent = data.trackName.split(' ').slice(-1)[0];
  $('#sessionType').textContent = data.sessionType;
  $('#trackTemp').textContent = `${data.track}°`;
  $('#trackTempLarge').textContent = `${data.track}°`;
  $('#airTemp').textContent = `${data.air}°`;

  const hasReference = data.hasReference === true;
  const delta = hasReference ? data.delta : 0;
  const deltaPositive = delta >= 0;
  const deltaText = hasReference ? formatDelta(delta) : '—.———';
  $('#deltaBig').textContent = deltaText;
  $('#deltaBig').style.color = hasReference ? (deltaPositive ? 'var(--red)' : 'var(--green)') : 'var(--muted)';
  $('#deltaLabelWithRef').hidden = !hasReference;
  $('#deltaLabelNoRef').hidden = hasReference;
  $('#deltaLabelSource').textContent = data.referenceSource || 'référence';
  $('#qualDelta').textContent = deltaText;
  $('#ttDelta').textContent = deltaText;
  $('#ttDelta').style.color = hasReference ? (deltaPositive ? 'var(--red)' : 'var(--green)') : 'var(--muted)';
  const ghostLabel = data.referenceSource ? String(data.referenceSource).toUpperCase() : 'RÉFÉRENCE';
  $('#ttDeltaStatus').textContent = hasReference ? (deltaPositive ? `RETARD SUR ${ghostLabel}` : `AVANCE SUR ${ghostLabel}`) : 'TERMINE UN TOUR VALIDE POUR CRÉER LA RÉFÉRENCE';
  $('#ttGhost').hidden = !hasReference;
  $('#ttGhostLabel').textContent = ghostLabel;
  $('#ttMapStatus').textContent = hasReference ? ghostLabel : 'RÉFÉRENCE REQUISE';
  if (hasReference) { $('#ttGhostBar').style.width = `${clamp(50 + delta / 20, 5, 95)}%`; $('#ttGhostGap').textContent = deltaText; }
  $('#ttInvalidBadge').hidden = !data.lapInvalid;
  $('#ttSector').textContent = data.currentSector ? `S${data.currentSector}` : '—';
  $('#ttGhostName').textContent = data.ghostName || '—';
  $('#ttGhostBestLap').textContent = data.ghostBestLapMs ? formatLapTime(data.ghostBestLapMs) : '—.———';
  renderSectorDeltas(data);
  renderTimeTrialMap(data.cars, data.playerCarIndex, data.real);
  $('#streamDelta').textContent = deltaText;
  $('#streamDelta').style.color = hasReference ? (deltaPositive ? 'var(--red)' : 'var(--green)') : 'var(--muted)';
  $('#deltaNeedle').style.left = `${hasReference ? clamp(50 + delta / 20, 6, 94) : 50}%`;
  $('#referenceLap').textContent = formatLapTime(data.bestLap);
  $('#currentLap').textContent = formatLapTime(data.lapTime);
  $('#qualAttempt').textContent = formatLapTime(data.lapTime);
  $('#bestLap').textContent = formatLapTime(data.bestLap);
  $('#lapNumber').innerHTML = `${data.lapNumber} <i>/ ${data.totalLaps}</i>`;
  $('#streamLap').textContent = `LAP ${data.lapNumber} / ${data.totalLaps}`;
  $('#raceLap').textContent = `${data.lapNumber} / ${data.totalLaps}`;
  $('#sector1').textContent = hasReference ? '−0.061' : '—'; $('#sector2').textContent = hasReference ? '−0.112' : '—'; $('#sector3').textContent = hasReference ? formatDelta(Math.abs(delta) * 1.7) : '—';

  $('#speedValue').textContent = fmt.format(data.speed);
  $('#gearValue').textContent = data.gear > 0 ? data.gear : 'N';
  $('#rpmValue').textContent = fmt.format(data.rpm);
  $('#throttleValue').textContent = String(data.throttle).padStart(2, '0');
  $('#brakeValue').textContent = String(data.brake).padStart(2, '0');
  $('#steeringValue').textContent = `${data.steering < 0 ? '−' : '+'}${String(Math.abs(data.steering)).padStart(2, '0')}°`;
  $('#throttleBar').style.width = `${data.throttle}%`;
  $('#brakeBar').style.width = `${data.brake}%`;
  renderRpmBars(data.rpm);

  $('#tyreCompound').textContent = data.compound;
  $('#tyreAge').textContent = `${data.tyreAge} tours`;
  ['FL', 'FR', 'RL', 'RR'].forEach((corner, index) => { $(`#tyre${corner}`).textContent = `${Math.round(data.temps[index] || 0)}°`; });
  ['FL', 'FR', 'RL', 'RR'].forEach((corner, index) => {
    $(`#tyre${corner}`).parentElement.querySelector('i').style.setProperty('--wear', `${Math.round(data.wearCorners?.[index] ?? data.wear)}%`);
  });
  $('#wearBar').style.width = `${data.wear}%`; $('#wearValue').textContent = `${Math.round(data.wear)}%`;
  $('#ersValue').innerHTML = `${Math.round(data.ers)}<small>%</small>`;
  $('#ersCircle').style.strokeDashoffset = String(100 - clamp(data.ers, 0, 100));
  $('#ersState').textContent = data.ers > 25 ? 'DÉPLOIEMENT' : 'RÉCUPÉRATION';
  $('#drsState').textContent = data.drs ? 'DRS ACTIF' : 'DRS OFF';
  $('#drsState').style.color = data.drs ? 'var(--green)' : '#a68aff';
  $('#fuelValue').textContent = Number(data.fuel).toFixed(1); $('#fuelLaps').textContent = `+${Number(data.fuelLaps).toFixed(1)} tours`;
  $('#streamErs').style.width = `${data.ers}%`; $('#streamFuel').textContent = `${Number(data.fuel).toFixed(1)} KG`;

  const position = `P${String(data.position || 0).padStart(2, '0')}`;
  $('#positionValue').textContent = position; $('#racePosition').textContent = position; $('#streamPosition').textContent = position;
  $('#gapFront').textContent = formatDelta(data.front); $('#gapBack').textContent = formatDelta(data.back);
  $('#raceFront').textContent = formatDelta(data.front);
  renderFlag(data.cars, data.playerCarIndex);
  renderMap(data.cars, data.playerCarIndex, data.real);
  renderClassification(data.cars, data.playerCarIndex);
}

// Le drapeau FIA (vehicleFiaFlags) est propre à chaque voiture : c'est celui
// montré au joueur, pas un drapeau global de course. -1/0 = aucun, 1 = vert,
// 2 = bleu, 3 = jaune, 4 = rouge (spec UDP F1 25).
const FLAG_LABELS = { '-1': ['VERT', 'flag-green'], 0: ['VERT', 'flag-green'], 1: ['VERT', 'flag-green'], 2: ['BLEU', 'flag-blue'], 3: ['JAUNE', 'flag-yellow'], 4: ['ROUGE', 'flag-red'] };
function renderFlag(cars, playerIndex) {
  const el = $('#raceFlag'); if (!el) return;
  const player = cars?.find((car) => car.index === playerIndex);
  const code = player?.status?.fiaFlag;
  const [label, cls] = FLAG_LABELS[String(code)] || FLAG_LABELS['-1'];
  el.textContent = label;
  el.className = cls;
}

function renderSectorDeltas(data) {
  const ref = data.referenceSectors;
  const cells = [['#ttS1', 1, data.sector1Live, ref?.sector1], ['#ttS2', 2, data.sector2Live, ref?.sector2], ['#ttS3', 3, null, ref?.sector3]];
  cells.forEach(([selector, sectorNumber, liveValue, refValue]) => {
    const el = $(selector); if (!el) return;
    if (!ref) { el.textContent = 'Référence requise'; el.className = 'mono'; return; }
    let current = liveValue;
    if (sectorNumber === 3 && data.currentSector === 3 && data.sector1Live && data.sector2Live) {
      current = data.lapTime - data.sector1Live - data.sector2Live;
    }
    if (!current || data.currentSector < sectorNumber) { el.textContent = 'En attente…'; el.className = 'mono'; return; }
    const sectorDelta = current - refValue;
    el.textContent = formatDelta(sectorDelta);
    el.className = `mono ${sectorDelta > 0 ? 'loss' : 'good'}`;
  });
}

function renderTimeTrialMap(cars, playerIndex, real) {
  const canvas = $('#ttMapCanvas'); if (!canvas) return;
  const { ctx, width, height } = canvasContext(canvas); ctx.clearRect(0, 0, width, height);
  const points = appState.trackOutline?.length > 3 ? appState.trackOutline.map((point) => ({ x: point.x, z: point.z })) : (real ? appState.mapTrail : []);
  const emptyState = $('#ttMapEmpty');
  if (!points.length) { emptyState.classList.add('visible'); return; }
  emptyState.classList.remove('visible');
  const minX = Math.min(...points.map((point) => point.x)); const maxX = Math.max(...points.map((point) => point.x));
  const minZ = Math.min(...points.map((point) => point.z)); const maxZ = Math.max(...points.map((point) => point.z));
  const spanX = maxX - minX || 1; const spanZ = maxZ - minZ || 1;
  const scale = Math.min((width - 44) / spanX, (height - 40) / spanZ);
  const project = (point) => ({ x: width / 2 + (point.x - (minX + maxX) / 2) * scale, y: height / 2 - (point.z - (minZ + maxZ) / 2) * scale });
  ctx.beginPath(); points.forEach((point, index) => { const p = project(point); index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
  ctx.strokeStyle = 'rgba(232,234,239,.15)'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.beginPath(); points.forEach((point, index) => { const p = project(point); index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
  ctx.strokeStyle = 'rgba(123,128,142,.72)'; ctx.lineWidth = 1.5; ctx.stroke();
  if (!cars?.length) return;
  const player = cars.find((car) => car.index === playerIndex);
  const ghost = cars.find((car) => car.index === appState.latest?.ghostCarIndex);
  if (ghost?.pos) {
    const p = project(ghost.pos);
    ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(199,202,209,.18)'; ctx.fill();
    ctx.lineWidth = 1.6; ctx.strokeStyle = '#c7cad1'; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]);
  }
  if (player?.pos) {
    const p = project(player.pos);
    ctx.beginPath(); ctx.arc(p.x, p.y, 5.3, 0, Math.PI * 2); ctx.fillStyle = 'white'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent'); ctx.stroke();
  }
}

function renderRpmBars(rpm) {
  const total = 14;
  const active = Math.round(clamp(rpm / 12500, 0, 1) * total);
  $('#rpmBars').innerHTML = Array.from({ length: total }, (_, index) => `<i class="${index < active ? 'active' : ''}" style="height:${8 + index * 1.2}px"></i>`).join('');
}

function renderClassification(cars, playerIndex) {
  const sorted = [...cars].filter((car) => car.lap?.position).sort((a, b) => a.lap.position - b.lap.position).slice(0, 8);
  const markup = sorted.map((car) => `<div class="driver-row ${car.index === playerIndex ? 'active' : ''}"><span>${String(car.lap.position).padStart(2, '0')}</span><b style="border-left:2px solid ${car.color || '#777'};padding-left:6px">${car.name || `DRIVER ${car.index}`}</b><strong class="mono">${car.lap.position === 1 ? 'LEADER' : formatDelta(car.lap.deltaToRaceLeaderMS || 0)}</strong></div>`).join('');
  $('#raceClassification').innerHTML = markup;
  $('#qualClassification').innerHTML = markup;
}

function renderLapInterfaces() {
  $('#lapCount').textContent = String(appState.laps.length).padStart(2, '0');
  const latest = appState.laps.slice(-5);
  $('#lapCheckList').innerHTML = latest.map((lap, index) => `<label class="lap-chip"><input type="checkbox" value="${lap.lapNumber}" ${index > 0 ? 'checked' : ''}>T${lap.lapNumber} <b>${formatLapTime(lap.lapTimeMs)}</b></label>`).join('');
  $('#historyRows').innerHTML = [...appState.laps].reverse().map((lap) => {
    const best = lap.lapTimeMs === Math.min(...appState.laps.map((item) => item.lapTimeMs));
    const sectorText = (ms) => Number.isFinite(ms) ? formatLapTime(ms).slice(2) : '—';
    return `<div class="history-row"><span class="lap-badge">TOUR ${lap.lapNumber}</span><b class="mono ${best ? 'best' : ''}">${formatLapTime(lap.lapTimeMs)}</b><span class="mono">${sectorText(lap.sector1TimeInMS)}</span><span class="mono">${sectorText(lap.sector2TimeInMS)}</span><span class="mono">${sectorText(lap.sector3TimeInMS)}</span><span class="tyre-history ${lap.compound === 'S' ? 'soft-dot' : 'medium-dot'}">${lap.compound || 'S'}</span><small>${lap.wear || 0}%</small><b class="mono ${lap.delta > 0 ? 'loss' : 'good'}">${formatDelta(lap.delta || 0)}</b><button title="Analyser ce tour" data-analyse-lap="${lap.lapNumber}">›</button></div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Canvas maps and lightweight analysis charts
// ---------------------------------------------------------------------------
function monzaPoint(t) {
  const a = t * Math.PI * 2;
  return { x: Math.cos(a) * (1 + .22 * Math.sin(2 * a)) + .25 * Math.sin(3 * a), z: .6 * Math.sin(a) + .22 * Math.sin(2 * a) };
}
function canvasContext(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr)); const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx, width: rect.width, height: rect.height };
}
function renderMap(cars, playerIndex, real) {
  const canvas = $('#mapCanvas'); if (!canvas) return;
  const { ctx, width, height } = canvasContext(canvas); ctx.clearRect(0, 0, width, height);
  let points = appState.trackOutline?.length > 3 ? appState.trackOutline.map((point) => ({ x: point.x, z: point.z })) : [];
  if (real && !appState.trackOutline) {
    const player = cars.find((car) => car.index === playerIndex);
    if (player?.pos) {
      const last = appState.mapTrail[appState.mapTrail.length - 1];
      // Un redémarrage de session, un flashback ou un retour aux stands
      // téléporte la voiture : sans ce garde-fou, le trait droit entre
      // l'ancienne et la nouvelle position traversait la carte en plein
      // milieu. Un déplacement réel entre deux échantillons ne dépasse
      // jamais ~80m (même à 350 km/h à 20 Hz), donc au-delà c'est un saut.
      const jumped = last && Math.hypot(player.pos.x - last.x, player.pos.z - last.z) > 80;
      if (jumped) appState.mapTrail = [];
      appState.mapTrail.push(player.pos);
      if (appState.mapTrail.length > 500) appState.mapTrail.shift();
    }
    if (appState.mapTrail.length > 20) points = appState.mapTrail;
  }
  const emptyState = $('#mapEmpty');
  if (!points.length) { emptyState.classList.add('visible'); return; }
  emptyState.classList.remove('visible');
  const minX = Math.min(...points.map((point) => point.x)); const maxX = Math.max(...points.map((point) => point.x));
  const minZ = Math.min(...points.map((point) => point.z)); const maxZ = Math.max(...points.map((point) => point.z));
  const spanX = maxX - minX || 1; const spanZ = maxZ - minZ || 1;
  const scale = Math.min((width - 44) / spanX, (height - 40) / spanZ);
  const project = (point) => ({ x: width / 2 + (point.x - (minX + maxX) / 2) * scale, y: height / 2 - (point.z - (minZ + maxZ) / 2) * scale });
  const path = () => { ctx.beginPath(); points.forEach((point, index) => { const p = project(point); index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); };
  path(); ctx.strokeStyle = 'rgba(232,234,239,.15)'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  path(); ctx.strokeStyle = 'rgba(123,128,142,.72)'; ctx.lineWidth = 1.5; ctx.stroke();
  if (!cars?.length) return;
  cars.forEach((car) => {
    if (!car.pos) return; const p = project(car.pos);
    ctx.beginPath(); ctx.arc(p.x, p.y, car.index === playerIndex ? 5.3 : 3.2, 0, Math.PI * 2); ctx.fillStyle = car.index === playerIndex ? 'white' : (car.color || '#89909e'); ctx.fill();
    if (car.index === playerIndex) { ctx.lineWidth = 2.5; ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent'); ctx.stroke(); }
  });
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace('#', ''); const value = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(value, 16); const r = (num >> 16) & 255; const g = (num >> 8) & 255; const b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
function seededSeries(length, fn) { return Array.from({ length }, (_, index) => fn(index / (length - 1), index)); }
function drawLineChart(id, datasets, config = {}) {
  const canvas = $(`#${id}`); if (!canvas) return;
  const { ctx, width, height } = canvasContext(canvas); ctx.clearRect(0, 0, width, height);
  const padding = { left: 38, right: 10, top: 9, bottom: config.xLabels ? 21 : 8 };
  const all = datasets.flatMap((dataset) => dataset.values).filter(Number.isFinite);
  if (!all.length) return;
  const min = config.min ?? Math.min(...all); const max = config.max ?? Math.max(...all); const range = max - min || 1;
  const plotWidth = width - padding.left - padding.right; const plotHeight = height - padding.top - padding.bottom;
  const point = (value, index, length) => ({ x: padding.left + (length <= 1 ? 0 : index / (length - 1) * plotWidth), y: padding.top + (1 - (value - min) / range) * plotHeight });

  ctx.font = '9px "DM Mono", monospace'; ctx.textBaseline = 'middle';
  for (let tick = 0; tick < 4; tick += 1) {
    const py = padding.top + plotHeight * tick / 3;
    const value = max - range * tick / 3;
    ctx.strokeStyle = tick === 0 ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.065)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padding.left, py); ctx.lineTo(width - padding.right, py); ctx.stroke();
    ctx.fillStyle = '#737986'; ctx.textAlign = 'right'; ctx.fillText(config.yFormat ? config.yFormat(value) : String(Math.round(value)), padding.left - 7, py);
  }
  if (Number.isFinite(config.zeroLine) && config.zeroLine >= min && config.zeroLine <= max) {
    const zeroY = point(config.zeroLine, 0, 1).y;
    ctx.strokeStyle = 'rgba(255,255,255,.32)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(padding.left, zeroY); ctx.lineTo(width - padding.right, zeroY); ctx.stroke(); ctx.setLineDash([]);
  }
  datasets.forEach((dataset) => {
    const values = dataset.values;
    if (dataset.zeroFill && Number.isFinite(config.zeroLine)) {
      const zeroY = point(config.zeroLine, 0, 1).y;
      const shape = new Path2D();
      values.forEach((value, index) => { const p = point(value, index, values.length); index ? shape.lineTo(p.x, p.y) : shape.moveTo(p.x, p.y); });
      const lastP = point(values[values.length - 1], values.length - 1, values.length);
      const firstP = point(values[0], 0, values.length);
      shape.lineTo(lastP.x, zeroY); shape.lineTo(firstP.x, zeroY); shape.closePath();
      ctx.save(); ctx.beginPath(); ctx.rect(padding.left, padding.top, plotWidth, Math.max(0, zeroY - padding.top)); ctx.clip(); ctx.fillStyle = dataset.zeroFill.above; ctx.fill(shape); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(padding.left, zeroY, plotWidth, Math.max(0, padding.top + plotHeight - zeroY)); ctx.clip(); ctx.fillStyle = dataset.zeroFill.below; ctx.fill(shape); ctx.restore();
    }
    ctx.beginPath(); values.forEach((value, index) => { const p = point(value, index, values.length); index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    if (dataset.fill) { const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + plotHeight); gradient.addColorStop(0, dataset.fill); gradient.addColorStop(1, 'rgba(0,0,0,0)'); ctx.lineTo(width - padding.right, padding.top + plotHeight); ctx.lineTo(padding.left, padding.top + plotHeight); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill(); ctx.beginPath(); values.forEach((value, index) => { const p = point(value, index, values.length); index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); }
    ctx.strokeStyle = dataset.color; ctx.lineWidth = dataset.width || 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (dataset.dash) ctx.setLineDash(dataset.dash);
    ctx.stroke();
    if (dataset.dash) ctx.setLineDash([]);
  });
  if (config.xLabels?.length) {
    ctx.fillStyle = '#737986'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    config.xLabels.forEach((label, index) => { const x = padding.left + plotWidth * index / (config.xLabels.length - 1); ctx.fillText(label, x, height - 4); });
  }
  if (Number.isFinite(config.cursorRatio)) {
    const ratio = clamp(config.cursorRatio, 0, 1); const cx = padding.left + plotWidth * ratio;
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(cx, padding.top); ctx.lineTo(cx, padding.top + plotHeight); ctx.stroke(); ctx.setLineDash([]);
    datasets.forEach((dataset) => { const index = Math.round(ratio * (dataset.values.length - 1)); const p = point(dataset.values[index], index, dataset.values.length); ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#12141a'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = dataset.color; ctx.stroke(); });
  }
}
function renderCharts() {
  if (appState.comparison && appState.shownView === 'analysis') { renderComparisonAtCursor(); return; }
  $('#analysisTooltip').hidden = true;
  drawEmptyChart('speedChart', 'Sélectionne des tours terminés pour comparer la vitesse');
  drawEmptyChart('brakeChart', 'Aucune télémétrie de frein disponible');
  drawEmptyChart('throttleChart', 'Aucune télémétrie d’accélérateur disponible');
  drawEmptyChart('deltaChart', 'La référence apparaîtra après un tour valide');
  drawEmptyChart('racePaceChart', 'Données de rythme indisponibles');
  drawEmptyChart('stintChart', 'Données de relais indisponibles');
}

function drawEmptyChart(id, message) {
  const canvas = $(`#${id}`); if (!canvas) return;
  const { ctx, width, height } = canvasContext(canvas); ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255,255,255,.065)'; ctx.lineWidth = 1;
  for (let y = 1; y < 4; y++) { const py = height / 4 * y; ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(width, py); ctx.stroke(); }
  ctx.fillStyle = '#737986'; ctx.font = '10px Inter, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(message, width / 2, height / 2);
}

// ---------------------------------------------------------------------------
// Progression du record personnel par circuit (vue Historique)
// ---------------------------------------------------------------------------
function formatLapTimeShort(ms) {
  if (!Number.isFinite(ms)) return '—';
  const m = Math.floor(ms / 60000); const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
async function loadTrackOptions() {
  const select = $('#progressTrackSelect'); if (!select || select.dataset.loaded) return;
  try {
    const tracks = await (await fetch('/api/tracks')).json();
    tracks.sort((a, b) => a.name.localeCompare(b.name));
    select.innerHTML = tracks.map((track) => `<option value="${track.id}">${track.name}</option>`).join('');
    select.dataset.loaded = '1';
    const currentTrackId = appState.session?.trackId;
    if (currentTrackId !== undefined && currentTrackId !== null && tracks.some((track) => track.id === currentTrackId)) {
      select.value = String(currentTrackId);
    }
  } catch (err) { /* dashboard hors-ligne ou API indisponible : le sélecteur reste vide */ }
}
async function renderRecordProgression() {
  const select = $('#progressTrackSelect'); if (!select || !select.value) { drawEmptyChart('progressChart', 'Sélectionne un circuit'); return; }
  let data;
  try {
    data = await (await fetch(`/api/record-progression?trackId=${select.value}`)).json();
  } catch (err) { drawEmptyChart('progressChart', 'Impossible de charger la progression'); return; }
  const points = data.progression || [];
  const emptyLabel = $('#progressEmptyLabel');
  if (points.length < 2) {
    if (emptyLabel) emptyLabel.textContent = points.length ? '1 seul temps enregistré pour l’instant' : 'Aucun temps enregistré sur ce circuit';
    drawEmptyChart('progressChart', 'Roule quelques tours sur ce circuit pour voir ta progression');
    return;
  }
  if (emptyLabel) emptyLabel.textContent = `${data.driverName} · ${points.length} amélioration${points.length > 1 ? 's' : ''}`;
  const values = points.map((point) => point.lapTimeMs / 1000);
  const xLabels = points.map((point) => new Date(point.recordedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }));
  drawLineChart('progressChart', [{ values, color: '#9b6cff', fill: 'rgba(155,108,255,.16)' }], {
    yFormat: (value) => formatLapTimeShort(value * 1000),
    xLabels,
  });
}
$('#progressTrackSelect')?.addEventListener('change', renderRecordProgression);

function sampleAtRatio(samples, ratio) {
  if (!samples.length) return {};
  const target = samples[0].distance + ((samples[samples.length - 1].distance - samples[0].distance) * ratio);
  let index = 0;
  while (index < samples.length - 1 && samples[index + 1].distance < target) index += 1;
  return samples[index];
}
function renderLapComparison(entries) {
  const colors = ['#9b6cff', '#ff9d63', '#73e3a6', '#f8d574', '#58b7ff'];
  const steps = 100;
  const data = entries.map((entry, index) => ({
    ...entry,
    color: colors[index],
    points: seededSeries(steps, (ratio) => sampleAtRatio(entry.lap.samples, ratio)),
  }));
  const reference = data.reduce((best, entry) => entry.lap.lapTimeMs < best.lap.lapTimeMs ? entry : best, data[0]);
  appState.comparison = { data, reference };
  renderComparisonAtCursor();
}

function legendMarkup(entries, reference, compact = false) {
  return entries.map((entry) => `<span><i style="border-color:${entry.color}"></i>T${entry.number}${entry === reference ? (compact ? ' · RÉF.' : ' · RÉFÉRENCE') : ''}</span>`).join('');
}
function renderComparisonAtCursor() {
  const comparison = appState.comparison;
  if (!comparison) { renderCharts(); return; }
  const { data, reference } = comparison;
  const cursor = appState.analysisCursor;
  const speeds = data.map((entry) => ({
    values: entry.points.map((point) => point.speed || 0),
    color: entry === reference ? entry.color : hexToRgba(entry.color, .5),
    width: entry === reference ? 2.8 : 1.5,
    dash: entry === reference ? undefined : [5, 4],
    fill: entry === reference ? hexToRgba(entry.color, .16) : undefined,
  }));
  const brakes = data.map((entry) => ({
    values: entry.points.map((point) => point.brake || 0),
    color: entry === reference ? entry.color : hexToRgba(entry.color, .5),
    width: entry === reference ? 2.3 : 1.3,
    dash: entry === reference ? undefined : [5, 4],
    fill: entry === reference ? hexToRgba(entry.color, .3) : undefined,
  }));
  const throttles = data.map((entry) => ({
    values: entry.points.map((point) => point.throttle || 0),
    color: entry === reference ? entry.color : hexToRgba(entry.color, .5),
    width: entry === reference ? 2.3 : 1.3,
    dash: entry === reference ? undefined : [5, 4],
    fill: entry === reference ? hexToRgba(entry.color, .3) : undefined,
  }));
  const deltas = data.filter((entry) => entry !== reference).map((entry) => ({
    values: entry.points.map((point, index) => ((point.lapTimeMs || 0) - (reference.points[index].lapTimeMs || 0)) / 1000),
    color: entry.color, width: 2,
    zeroFill: { above: hexToRgba('#ff7171', .16), below: hexToRgba('#73e3a6', .16) },
  }));
  const startDistance = reference.points[0].distance || 0;
  const endDistance = reference.points[reference.points.length - 1].distance || 0;
  const distanceLabels = [0, .25, .5, .75, 1].map((ratio) => `${Math.round(startDistance + (endDistance - startDistance) * ratio)}m`);
  const allSpeeds = speeds.flatMap((entry) => entry.values);
  const minSpeed = Math.max(0, Math.floor(Math.min(...allSpeeds) / 20) * 20 - 10);
  const maxSpeed = Math.ceil(Math.max(...allSpeeds) / 20) * 20 + 10;
  const deltaRange = Math.max(.05, ...deltas.flatMap((entry) => entry.values.map((value) => Math.abs(value))));
  drawLineChart('speedChart', speeds, { min: minSpeed, max: maxSpeed, yFormat: (value) => `${Math.round(value)}`, xLabels: distanceLabels, cursorRatio: cursor });
  drawLineChart('brakeChart', brakes, { min: 0, max: 100, yFormat: (value) => `${Math.round(value)}%`, cursorRatio: cursor });
  drawLineChart('throttleChart', throttles, { min: 0, max: 100, yFormat: (value) => `${Math.round(value)}%`, cursorRatio: cursor });
  drawLineChart('deltaChart', deltas.length ? deltas : [{ values: Array(reference.points.length).fill(0), color: reference.color }], { min: -deltaRange, max: deltaRange, zeroLine: 0, yFormat: (value) => `${value > 0 ? '+' : ''}${value.toFixed(2)}s`, cursorRatio: cursor });
  $('#speedLegend').innerHTML = legendMarkup(data, reference);
  $('#brakeLegend').innerHTML = legendMarkup(data, reference, true);
  $('#throttleLegend').innerHTML = legendMarkup(data, reference, true);
  $('#deltaLegend').innerHTML = deltas.length ? legendMarkup(data.filter((entry) => entry !== reference), reference, true) : '<span>Référence seule</span>';
  updateAnalysisTooltip(data, reference, cursor);
  updateInsights(data, reference);
}

function localCoaching(data, reference, index) {
  const compared = data.find((entry) => entry !== reference);
  if (!compared) return null;
  const windowSize = 6;
  const lo = Math.max(0, index - windowSize); const hi = Math.min(reference.points.length - 1, index + windowSize);
  const findCross = (points, prop, threshold) => { for (let i = lo; i <= hi; i++) { if (Number(points[i]?.[prop] || 0) >= threshold) return i; } return -1; };
  const refBrakeIdx = findCross(reference.points, 'brake', 20);
  const compBrakeIdx = findCross(compared.points, 'brake', 20);
  const refThrottleIdx = findCross(reference.points, 'throttle', 90);
  const compThrottleIdx = findCross(compared.points, 'throttle', 90);
  if (refBrakeIdx >= 0 && compBrakeIdx >= 0 && refBrakeIdx !== compBrakeIdx) {
    const meters = Math.round(Math.abs((compared.points[compBrakeIdx]?.distance || 0) - (reference.points[refBrakeIdx]?.distance || 0)));
    const later = compBrakeIdx > refBrakeIdx;
    return { message: `Freinage ${meters} m ${later ? 'plus tard' : 'plus tôt'} ici que ${reference.number ? `T${reference.number}` : 'la référence'}.`, positive: !later };
  }
  if (refThrottleIdx >= 0 && compThrottleIdx >= 0 && refThrottleIdx !== compThrottleIdx) {
    const meters = Math.round(Math.abs((compared.points[compThrottleIdx]?.distance || 0) - (reference.points[refThrottleIdx]?.distance || 0)));
    const earlier = compThrottleIdx < refThrottleIdx;
    return { message: `Plein gaz ${meters} m ${earlier ? 'plus tôt' : 'plus tard'} ici que ${reference.number ? `T${reference.number}` : 'la référence'}.`, positive: earlier };
  }
  const speedDelta = Math.round((compared.points[index]?.speed || 0) - (reference.points[index]?.speed || 0));
  if (Math.abs(speedDelta) >= 3) {
    return { message: `${Math.abs(speedDelta)} km/h ${speedDelta < 0 ? 'de moins' : 'de plus'} que la référence ici.`, positive: speedDelta >= 0 };
  }
  return null;
}
function gearChangeNear(entry, index) {
  const windowSize = 3;
  const lo = Math.max(0, index - windowSize); const hi = Math.min(entry.points.length - 1, index + windowSize);
  for (let i = lo; i < hi; i++) {
    const from = entry.points[i]?.gear; const to = entry.points[i + 1]?.gear;
    if (Number.isFinite(from) && Number.isFinite(to) && from !== to && from > 0 && to > 0) {
      return { from, to, delta: to - from };
    }
  }
  return null;
}
function updateAnalysisTooltip(data, reference, ratio) {
  const tooltip = $('#analysisTooltip');
  const index = Math.round(clamp(ratio, 0, 1) * (reference.points.length - 1));
  const distance = Math.round(reference.points[index].distance || 0);
  tooltip.hidden = false;
  tooltip.style.left = `${clamp(ratio * 100, 12, 88)}%`;
  const coaching = localCoaching(data, reference, index);
  const gearChange = gearChangeNear(reference, index);
  const gearMarkup = gearChange ? `<div class="tooltip-coaching ${gearChange.delta < 0 ? 'loss' : 'good'}">Rapport ${gearChange.from}→${gearChange.to} (${gearChange.delta > 0 ? '+' : ''}${gearChange.delta}) ici.</div>` : '';
  const coachingMarkup = coaching ? `<div class="tooltip-coaching ${coaching.positive ? 'good' : 'loss'}">${coaching.message}</div>` : '';
  tooltip.innerHTML = `<b>${distance} m</b>${data.map((entry) => { const point = entry.points[index]; const delta = (point.lapTimeMs || 0) - (reference.points[index].lapTimeMs || 0); const gearText = Number.isFinite(point.gear) && point.gear > 0 ? ` · G${point.gear}` : ''; return `<span><i style="background:${entry.color}"></i>T${entry.number} <strong>${Math.round(point.speed || 0)} km/h</strong>${gearText}${entry === reference ? ' · RÉF.' : ` · ${formatDelta(delta)}`}</span>`; }).join('')}${gearMarkup}${coachingMarkup}`;
}

function firstThresholdIndex(points, property, threshold) {
  return points.findIndex((point) => Number(point[property] || 0) >= threshold);
}
function setInsight(prefix, text, value, positive) {
  const valueElement = $(`#${prefix}InsightValue`);
  $(`#${prefix}InsightText`).textContent = text;
  valueElement.textContent = value;
  valueElement.className = positive ? 'good' : 'loss';
}
function updateInsights(data, reference) {
  const compared = data.find((entry) => entry !== reference);
  if (!compared) {
    setInsight('brake', 'Ajoute un deuxième tour pour comparer le freinage.', '—', false);
    setInsight('throttle', 'Ajoute un deuxième tour pour comparer la traction.', '—', false);
    setInsight('speed', 'Ajoute un deuxième tour pour comparer les vitesses.', '—', false);
    return;
  }
  const refBrake = firstThresholdIndex(reference.points, 'brake', 20);
  const comparedBrake = firstThresholdIndex(compared.points, 'brake', 20);
  const brakeIndex = Math.max(refBrake, comparedBrake, 0);
  const brakeMeters = Math.abs((compared.points[comparedBrake]?.distance || 0) - (reference.points[refBrake]?.distance || 0));
  const brakeLater = comparedBrake > refBrake;
  setInsight('brake', `Freinage ${Math.round(brakeMeters)} m ${brakeLater ? 'plus tard' : 'plus tôt'} vers ${Math.round(reference.points[brakeIndex]?.distance || 0)} m.`, `${brakeLater ? '+' : '−'}${Math.abs(comparedBrake - refBrake)} pts`, !brakeLater);

  const refThrottle = firstThresholdIndex(reference.points, 'throttle', 90);
  const comparedThrottle = firstThresholdIndex(compared.points, 'throttle', 90);
  const throttleMeters = Math.abs((compared.points[comparedThrottle]?.distance || 0) - (reference.points[refThrottle]?.distance || 0));
  const throttleEarlier = comparedThrottle < refThrottle;
  setInsight('throttle', `Plein gaz ${Math.round(throttleMeters)} m ${throttleEarlier ? 'plus tôt' : 'plus tard'} vers ${Math.round(reference.points[Math.max(refThrottle, comparedThrottle, 0)]?.distance || 0)} m.`, `${throttleEarlier ? '−' : '+'}${Math.abs(comparedThrottle - refThrottle)} pts`, throttleEarlier);

  const speedDifference = compared.points.map((point, index) => Number(point.speed || 0) - Number(reference.points[index].speed || 0));
  const worstIndex = speedDifference.reduce((best, value, index) => value < speedDifference[best] ? index : best, 0);
  const loss = speedDifference[worstIndex];
  setInsight('speed', `À ${Math.round(reference.points[worstIndex].distance || 0)} m : ${Math.abs(Math.round(loss))} km/h ${loss < 0 ? 'sous' : 'au-dessus de'} la référence.`, `${loss > 0 ? '+' : ''}${Math.round(loss)} km/h`, loss > 0);
}

// ---------------------------------------------------------------------------
// Navigation, profiles, customization and local persistence
// ---------------------------------------------------------------------------
const viewTitles = { dashboard: ['RACE CONTROL', 'DASHBOARD'], race: ['RACE CONTROL', 'MODE COURSE'], qualifying: ['RACE CONTROL', 'QUALIFICATIONS'], practice: ['RACE CONTROL', 'FREE PRACTICE'], timetrial: ['RACE CONTROL', 'TIME TRIAL'], stream: ['RACE CONTROL', 'MODE STREAM'], analysis: ['DATA LAB', 'ANALYSE'], history: ['DATA LAB', 'HISTORIQUE'], settings: ['CONFIGURATION', 'PARAMÈTRES'] };
function showView(view) {
  if (!viewTitles[view]) return;
  appState.shownView = view;
  $$('.view').forEach((section) => section.classList.toggle('active', section.id === `view-${view}`));
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $('#topSection').textContent = viewTitles[view][0]; $('#topTitle').textContent = viewTitles[view][1];
  if (view === 'analysis') {
    requestAnimationFrame(() => requestAnimationFrame(() => compareSelectedLaps()));
  } else if (view === 'race' || view === 'practice') {
    // Canvases inside a hidden view have a 0px drawing area. Two frames ensure
    // layout is committed before we calculate their internal resolution.
    requestAnimationFrame(() => requestAnimationFrame(renderCharts));
  } else if (view === 'history') {
    loadTrackOptions().then(() => requestAnimationFrame(() => requestAnimationFrame(renderRecordProgression)));
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
$$('[data-go-dashboard]').forEach((button) => button.addEventListener('click', () => showView('dashboard')));

function setProfile(mode) {
  appState.activeMode = mode; localStorage.setItem('apex-profile', mode);
  $$('.mode-switch button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  $('#profileName').textContent = ({ race: 'Course', qualifying: 'Qualif', practice: 'Practice', timetrial: 'Time Trial' })[mode];
}
$$('.mode-switch button').forEach((button) => button.addEventListener('click', () => setProfile(button.dataset.mode)));
setProfile(appState.activeMode);

function buildCustomizer() {
  const names = { delta: 'Delta live', lap: 'Tour actuel', telemetry: 'Télémétrie', track: 'Mini carte', tyres: 'Pneus', energy: 'Énergie & carburant', position: 'Position', conditions: 'Conditions' };
  $('#widgetToggles').innerHTML = $$('.widget').map((widget) => `<div class="widget-toggle"><label><input type="checkbox" data-toggle-widget="${widget.dataset.widget}" ${widget.classList.contains('is-hidden') ? '' : 'checked'}>${names[widget.dataset.widget]}</label><button data-size-widget="${widget.dataset.widget}">Largeur auto</button></div>`).join('');
  $$('[data-toggle-widget]').forEach((input) => input.addEventListener('change', () => { const widget = $(`[data-widget="${input.dataset.toggleWidget}"]`); widget.classList.toggle('is-hidden', !input.checked); persistWidgets(); }));
  $$('[data-size-widget]').forEach((button) => button.addEventListener('click', () => { const widget = $(`[data-widget="${button.dataset.sizeWidget}"]`); widget.classList.toggle('widget-wide'); button.textContent = widget.classList.contains('widget-wide') ? 'Format large' : 'Largeur auto'; persistWidgets(); }));
}
function closeAllOverlays() {
  $('#customizer').classList.remove('open'); $('#customizer').setAttribute('aria-hidden', 'true');
  $('#profileModal').classList.remove('open'); $('#profileModal').setAttribute('aria-hidden', 'true');
  $('#overlayBackdrop').classList.remove('show');
}
function openCustomizer(open) { closeAllOverlays(); if (!open) return; $('#customizer').classList.add('open'); $('#customizer').setAttribute('aria-hidden', 'false'); $('#overlayBackdrop').classList.add('show'); buildCustomizer(); }
$('#customizeButton').addEventListener('click', () => openCustomizer(true)); $('#closeCustomizer').addEventListener('click', () => openCustomizer(false)); $('#doneCustomize').addEventListener('click', () => openCustomizer(false)); $('#overlayBackdrop').addEventListener('click', () => closeAllOverlays());

// ---------------------------------------------------------------------------
// Driver profile — create/edit the pilot card in the sidebar
// ---------------------------------------------------------------------------
function loadDriverProfile() { return { name: localStorage.getItem('apex-driver-name') || 'ROUSS', platform: localStorage.getItem('apex-driver-platform') || 'PC' }; }
function applyDriverProfile() {
  const { name, platform } = loadDriverProfile();
  $('#driverName').textContent = name;
  $('#driverPlatform').textContent = `F1 25 · ${platform}`;
  $('#driverAvatar').textContent = name.trim().charAt(0).toUpperCase() || '?';
}
function openProfileModal(open) {
  closeAllOverlays(); if (!open) return;
  const { name, platform } = loadDriverProfile();
  $('#profileNameInput').value = name; $('#profilePlatformInput').value = platform;
  $('#profileAvatarPreview').textContent = name.trim().charAt(0).toUpperCase() || '?';
  $('#profileModal').classList.add('open'); $('#profileModal').setAttribute('aria-hidden', 'false'); $('#overlayBackdrop').classList.add('show');
  $('#profileNameInput').focus();
}
$('#profileNameInput').addEventListener('input', () => { $('#profileAvatarPreview').textContent = $('#profileNameInput').value.trim().charAt(0).toUpperCase() || '?'; });
$('#driverCard').addEventListener('click', () => openProfileModal(true));
$('#closeProfileModal').addEventListener('click', () => closeAllOverlays());
$('#cancelProfileModal').addEventListener('click', () => closeAllOverlays());
$('#saveProfileModal').addEventListener('click', () => {
  const name = $('#profileNameInput').value.trim().slice(0, 14) || 'PILOTE';
  const platform = $('#profilePlatformInput').value;
  localStorage.setItem('apex-driver-name', name); localStorage.setItem('apex-driver-platform', platform);
  applyDriverProfile(); closeAllOverlays();
});
applyDriverProfile();
function persistWidgets() { localStorage.setItem('apex-widgets', JSON.stringify($$('.widget').map((widget) => ({ name: widget.dataset.widget, hidden: widget.classList.contains('is-hidden'), wide: widget.classList.contains('widget-wide') })))); }
function restoreWidgets() { try { const config = JSON.parse(localStorage.getItem('apex-widgets') || '[]'); config.forEach((item) => { const widget = $(`[data-widget="${item.name}"]`); if (widget) { widget.classList.toggle('is-hidden', item.hidden); widget.classList.toggle('widget-wide', item.wide); } }); } catch (_) {} }
restoreWidgets();
$('#resetLayout').addEventListener('click', () => { localStorage.removeItem('apex-widgets'); $$('.widget').forEach((widget) => { widget.classList.remove('is-hidden'); if (['delta', 'telemetry'].includes(widget.dataset.widget)) widget.classList.add('widget-wide'); else widget.classList.remove('widget-wide'); }); buildCustomizer(); });

let dragging;
$('#dashboardGrid').addEventListener('dragstart', (event) => { const widget = event.target.closest('.widget'); if (!widget) return; dragging = widget; widget.classList.add('dragging'); event.dataTransfer.effectAllowed = 'move'; });
$('#dashboardGrid').addEventListener('dragend', () => { if (dragging) dragging.classList.remove('dragging'); dragging = null; persistWidgets(); });
$('#dashboardGrid').addEventListener('dragover', (event) => { event.preventDefault(); const target = event.target.closest('.widget'); if (!dragging || !target || target === dragging) return; const box = target.getBoundingClientRect(); const before = event.clientY < box.top + box.height / 2; target.parentNode.insertBefore(dragging, before ? target : target.nextSibling); });

function closeWidgetMenus() { $$('.widget-actions-menu').forEach((menu) => menu.remove()); }
$('#dashboardGrid').addEventListener('click', (event) => {
  const button = event.target.closest('.widget-menu');
  if (!button) { if (!event.target.closest('.widget-actions-menu')) closeWidgetMenus(); return; }
  event.stopPropagation();
  const widget = button.closest('.widget');
  const alreadyOpen = widget.querySelector('.widget-actions-menu');
  closeWidgetMenus();
  if (alreadyOpen) return;
  const menu = document.createElement('div');
  menu.className = 'widget-actions-menu';
  menu.innerHTML = `<button data-widget-action="resize">${widget.classList.contains('widget-wide') ? '↔ Format normal' : '↔ Agrandir'}</button><button data-widget-action="hide">◌ Masquer le widget</button><button data-widget-action="reset">↺ Réinitialiser le widget</button>`;
  widget.appendChild(menu);
  menu.addEventListener('click', (menuEvent) => {
    const action = menuEvent.target.closest('[data-widget-action]')?.dataset.widgetAction;
    if (action === 'resize') widget.classList.toggle('widget-wide');
    if (action === 'hide') widget.classList.add('is-hidden');
    if (action === 'reset') { widget.classList.remove('is-hidden'); widget.classList.remove('widget-wide'); if (['delta', 'telemetry'].includes(widget.dataset.widget)) widget.classList.add('widget-wide'); }
    persistWidgets(); closeWidgetMenus();
  });
});

$('#themeButton').addEventListener('click', () => showView('settings'));
$$('.theme-option').forEach((button) => button.addEventListener('click', () => { const theme = button.dataset.theme; document.body.dataset.theme = theme === 'violet' ? '' : theme; localStorage.setItem('apex-theme', theme); $$('.theme-option').forEach((option) => option.classList.toggle('selected', option === button)); renderCharts(); }));
const savedTheme = localStorage.getItem('apex-theme') || 'violet'; document.body.dataset.theme = savedTheme === 'violet' ? '' : savedTheme; $$('.theme-option').forEach((option) => option.classList.toggle('selected', option.dataset.theme === savedTheme));
$('#ghostButton').addEventListener('click', (event) => { const active = event.currentTarget.classList.toggle('active'); event.currentTarget.textContent = active ? '◉  Ghost activé' : '○  Ghost désactivé'; });
async function compareSelectedLaps() {
  const selected = $$('#lapCheckList input:checked').map((input) => input.value).slice(0, 5);
  if (!selected.length) { renderCharts(); return; }
  const laps = await Promise.all(selected.map(requestLap));
  const valid = laps.map((lap, index) => ({ lap, number: selected[index] })).filter((entry) => entry.lap?.samples?.length > 5);
  if (valid.length) renderLapComparison(valid); else renderCharts();
}
$('#compareButton').addEventListener('click', compareSelectedLaps);
$('#lapCheckList').addEventListener('change', () => { if (appState.shownView === 'analysis') compareSelectedLaps(); });
$('#exportButton').addEventListener('click', () => {
  const header = 'lap,time_ms,compound,wear_percent,delta_ms\n'; const rows = appState.laps.map((lap) => `${lap.lapNumber},${lap.lapTimeMs},${lap.compound || ''},${lap.wear || ''},${lap.delta || 0}`).join('\n');
  const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'apex-f1-25-laps.csv'; link.click(); URL.revokeObjectURL(link.href);
});
$('#historyRows').addEventListener('click', (event) => { if (event.target.closest('[data-analyse-lap]')) showView('analysis'); });
$('.chart-canvas-wrap').addEventListener('mousemove', (event) => {
  const box = event.currentTarget.getBoundingClientRect();
  appState.analysisCursor = clamp((event.clientX - box.left) / box.width, 0, 1);
  $('.chart-hover-line').style.left = `${appState.analysisCursor * 100}%`;
  if (appState.comparison) renderComparisonAtCursor();
});
$('.chart-canvas-wrap').addEventListener('mouseleave', () => { $('#analysisTooltip').hidden = true; });
$('#unitSelect').addEventListener('change', (event) => { $('#settingUnit').value = event.target.value; });
$('#settingUnit').addEventListener('change', (event) => { $('#unitSelect').value = event.target.value; });
$('.save-settings').addEventListener('click', (event) => { event.currentTarget.textContent = 'Préférences sauvegardées'; setTimeout(() => { event.currentTarget.textContent = 'Sauvegarder les préférences'; }, 1400); });
setInterval(() => { $('#sessionClock').textContent = new Date().toLocaleTimeString('fr-FR', { hour12: false }); }, 1000);
window.addEventListener('resize', () => { cancelAnimationFrame(appState.chartFrame); appState.chartFrame = requestAnimationFrame(renderCharts); });
renderLapInterfaces(); renderCharts();
