'use strict';

function formatLapTime(ms) {
  if (!ms || ms <= 0) return '—';
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
function formatDelta(ms) {
  if (ms === null || ms === undefined) return '+0.000';
  const sign = ms >= 0 ? '+' : '-';
  return `${sign}${Math.abs(ms / 1000).toFixed(3)}`;
}
function sectorClass(current, reference) {
  if (!Number.isFinite(current) || !Number.isFinite(reference)) return '';
  return current <= reference ? 'good' : 'loss';
}
function set(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

let recordToastTimer = null;
function showRecordToast({ driverName, trackName, lapTimeMs, gainMs }) {
  const toast = document.getElementById('recordToast');
  set('toastDriver', driverName || 'Pilote');
  set('toastTrack', trackName ? `Nouveau record sur ${trackName}` : 'Nouveau record');
  set('toastTime', formatLapTime(lapTimeMs));
  const gainEl = document.getElementById('toastGain');
  gainEl.textContent = Number.isFinite(gainMs) ? `-${(gainMs / 1000).toFixed(3)}` : '';
  toast.classList.remove('show');
  // force reflow pour rejouer l'animation si deux records tombent vite
  void toast.offsetWidth;
  toast.classList.add('show');
  if (recordToastTimer) clearTimeout(recordToastTimer);
  recordToastTimer = setTimeout(() => toast.classList.remove('show'), 6000);
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  let bestLapMs = null;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'getLapList' }));
  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === 'lapList') { const times = msg.laps.map((l) => l.lapTimeMs).filter(Boolean); if (times.length) bestLapMs = Math.min(...times); return; }
    if (msg.type === 'newRecord') {
      bestLapMs = msg.lapTimeMs;
      showRecordToast(msg);
      return;
    }
    if (msg.type !== 'live') return;
    const me = msg.cars.find((c) => c.index === msg.playerCarIndex);
    if (!me || !me.lap) return;
    const telemetry = me.telemetry || {};
    const status = me.status || {};
    const lap = me.lap;

    set('pos', `P${lap.position || '-'}`);
    set('name', me.name || '');
    set('lapMeta', `TOUR ${lap.currentLapNum || '-'} / ${msg.session?.totalLaps || '-'}`);
    document.getElementById('invalidTag').hidden = !lap.currentLapInvalid;
    document.getElementById('card').classList.toggle('invalid', Boolean(lap.currentLapInvalid));

    set('currentLap', formatLapTime(lap.currentLapTimeInMS));
    set('lastLap', formatLapTime(lap.lastLapTimeInMS));
    set('bestLap', formatLapTime(bestLapMs || lap.lastLapTimeInMS));

    const hasGhost = Number.isFinite(msg.playerDeltaToGhostMs);
    const hasBest = Number.isFinite(msg.playerDeltaToBestMs);
    const delta = hasGhost ? msg.playerDeltaToGhostMs : (hasBest ? msg.playerDeltaToBestMs : null);
    const deltaEl = document.getElementById('deltaLive');
    deltaEl.textContent = delta === null ? '—.———' : formatDelta(delta);
    deltaEl.className = `delta mono ${delta === null ? 'flat' : (delta <= 0 ? 'good' : 'loss')}`;

    const ref = msg.referenceSectors;
    const s1El = document.getElementById('s1'); const s2El = document.getElementById('s2'); const s3El = document.getElementById('s3');
    if (ref && lap.sector1TimeInMS && lap.sector >= 2) { s1El.textContent = `S1 ${((lap.sector1TimeInMS - ref.sector1) / 1000).toFixed(2)}`; s1El.className = sectorClass(lap.sector1TimeInMS, ref.sector1); }
    else { s1El.textContent = 'S1'; s1El.className = ''; }
    if (ref && lap.sector2TimeInMS && lap.sector >= 3) { s2El.textContent = `S2 ${((lap.sector2TimeInMS - ref.sector2) / 1000).toFixed(2)}`; s2El.className = sectorClass(lap.sector2TimeInMS, ref.sector2); }
    else { s2El.textContent = 'S2'; s2El.className = ''; }
    s3El.textContent = 'S3'; s3El.className = '';

    set('gear', telemetry.gear > 0 ? String(telemetry.gear) : (telemetry.gear === 0 ? 'N' : 'R'));
    set('speed', `${Math.round(telemetry.speed || 0)} km/h`);
    set('ers', `${Math.round(status.ersPercent || 0)}%`);
    const drsEl = document.getElementById('drs'); drsEl.classList.toggle('on', Boolean(telemetry.drs)); drsEl.textContent = telemetry.drs ? 'DRS ACTIF' : 'DRS';

    const tyreDot = document.getElementById('tyreDot');
    const compound = status.compound || '—';
    tyreDot.textContent = compound.charAt(0);
    tyreDot.style.background = compound === 'S' ? '#ff7171' : compound === 'M' ? '#f8d574' : compound === 'H' ? '#f2f3f5' : '#73e3a6';
    const wear = status.tyreWear || 0;
    document.getElementById('wearFill').style.width = `${Math.min(100, wear)}%`;
    set('wearPct', `${Math.round(wear)}%`);

    const speedPct = Math.min(100, ((telemetry.speed || 0) / 360) * 100);
    document.getElementById('speedBar').style.width = `${speedPct}%`;
  };
  ws.onclose = () => setTimeout(connect, 1500);
}
connect();
