'use strict';
// ─────────────────────────────────────────────────────────
//  AllStar Web Transceiver - Browser Client
// ─────────────────────────────────────────────────────────

const SESSION_KEY = 'allstar_session_token';

let ua          = null;
let session     = null;
let cfg         = null;
let txAnalyser  = null;
let rxAnalyser  = null;
let meterRaf    = null;

// ── DOM refs ──────────────────────────────────────────────
const $  = id => document.getElementById(id);
const els = {
  // Setup screen
  setupScreen:  $('setup-screen'),
  setupNode:    $('setup-node'),
  setupPass:    $('setup-pass'),
  setupError:   $('setup-error'),
  btnSetup:     $('btn-setup'),
  // Transceiver screen
  txScreen:     $('transceiver-screen'),
  nodeBadge:    $('node-badge'),
  dot:          $('status-dot'),
  statusText:   $('status-text'),
  btnSignout:   $('btn-signout'),
  btnAudio:     $('btn-audio'),
  btnPtt:       $('btn-ptt'),
  pttLabel:     $('ptt-label'),
  txFill:       $('tx-fill'),
  rxFill:       $('rx-fill'),
  txDb:         $('tx-db'),
  rxDb:         $('rx-db'),
  remoteAudio:  $('remote-audio'),
  targetNode:   $('target-node'),
  btnLink:      $('btn-link'),
  btnUnlink:    $('btn-unlink'),
  btnUnlinkAll: $('btn-unlink-all'),
  btnRefresh:   $('btn-refresh'),
  linkedNodes:  $('linked-nodes'),
  log:          $('log'),
};

// ── Auth helpers ──────────────────────────────────────────
function getToken()       { return localStorage.getItem(SESSION_KEY); }
function saveToken(t)     { localStorage.setItem(SESSION_KEY, t); }
function clearToken()     { localStorage.removeItem(SESSION_KEY); }

function authHeaders() {
  return { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

// ── Screen switching ──────────────────────────────────────
function showSetup(errorMsg) {
  els.setupScreen.style.display = 'flex';
  els.txScreen.style.display    = 'none';
  if (errorMsg) showSetupError(errorMsg);
}

function showTransceiver() {
  els.setupScreen.style.display = 'none';
  els.txScreen.style.display    = 'flex';
}

function showSetupError(msg) {
  els.setupError.textContent = msg;
  els.setupError.style.display = 'block';
}
function clearSetupError() {
  els.setupError.style.display = 'none';
  els.setupError.textContent   = '';
}

// ── Logging ───────────────────────────────────────────────
function log(msg, type = '') {
  const e = document.createElement('div');
  e.className = `entry ${type}`;
  e.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  els.log.prepend(e);
  while (els.log.children.length > 80) els.log.removeChild(els.log.lastChild);
}

function setStatus(text, state = '') {
  els.statusText.textContent = text;
  els.dot.className = `status-dot ${state}`;
}

// ─────────────────────────────────────────────────────────
//  SETUP FLOW
// ─────────────────────────────────────────────────────────
async function handleSetupSubmit() {
  clearSetupError();
  const nodeNumber  = els.setupNode.value.trim();
  const nodePassword = els.setupPass.value.trim();

  if (!/^\d{4,7}$/.test(nodeNumber)) {
    return showSetupError('Node number must be 4–7 digits.');
  }
  if (!nodePassword) {
    return showSetupError('Please enter your node password.');
  }

  els.btnSetup.disabled = true;
  els.btnSetup.textContent = 'Connecting…';

  try {
    const resp = await fetch('/api/auth/setup', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ nodeNumber, nodePassword }),
    });
    const data = await resp.json();

    if (!data.ok) {
      showSetupError(data.error || 'Setup failed.');
      return;
    }

    saveToken(data.sessionToken);
    await enterTransceiver();

  } catch (e) {
    showSetupError('Could not reach the server. Try again.');
  } finally {
    els.btnSetup.disabled = false;
    els.btnSetup.textContent = 'Connect';
  }
}

// ─────────────────────────────────────────────────────────
//  TRANSCEIVER STARTUP
// ─────────────────────────────────────────────────────────
async function enterTransceiver() {
  // Fetch SIP config (requires valid session token)
  let resp;
  try {
    resp = await fetch('/api/sip-config', { headers: authHeaders() });
  } catch (e) {
    showSetup('Could not reach the server.');
    return;
  }

  if (resp.status === 401) {
    clearToken();
    showSetup('Session expired. Please sign in again.');
    return;
  }

  cfg = await resp.json();
  els.nodeBadge.textContent = `Node ${cfg.nodeNumber}`;

  showTransceiver();
  startSipUA();
  refreshStatus();
}

function signOut() {
  // Tear down active audio first
  if (session) { try { session.terminate(); } catch (_) {} session = null; }
  if (ua)      { try { ua.stop(); }          catch (_) {} ua = null; }
  stopMeters();
  clearToken();
  cfg = null;
  setStatus('');
  showSetup();
}

// ─────────────────────────────────────────────────────────
//  JsSIP UserAgent
// ─────────────────────────────────────────────────────────
function startSipUA() {
  if (ua) { try { ua.stop(); } catch (_) {} }

  const socket = new JsSIP.WebSocketInterface(cfg.wsUri);

  ua = new JsSIP.UA({
    sockets:   [socket],
    uri:       cfg.sipUri,
    password:  cfg.password,
    register:  true,
    pcConfig:  { iceServers: cfg.stunServers },
    connection_recovery_min_interval: 2,
    connection_recovery_max_interval: 30,
  });

  ua.on('connecting',   ()    => { setStatus('Connecting…'); log('Connecting to SIP server…'); });
  ua.on('connected',    ()    => { setStatus('Connected'); log('WebSocket connected', 'ok'); });
  ua.on('disconnected', ()    => { setStatus('Disconnected', 'error'); log('WebSocket disconnected', 'warn'); });

  ua.on('registered', () => {
    setStatus('Registered', 'registered');
    log(`Registered — node ${cfg.nodeNumber}`, 'ok');
    els.btnAudio.disabled = false;
    els.btnAudio.textContent = 'Connect Audio';
  });

  ua.on('unregistered',       () => { setStatus('Unregistered'); log('SIP unregistered', 'warn'); });
  ua.on('registrationFailed', e  => {
    setStatus('Registration failed', 'error');
    log(`Registration failed: ${e.cause}`, 'error');
  });

  ua.on('newRTCSession', handleNewSession);
  ua.start();
  log(`SIP UA started (${cfg.sipUri})`);
}

// ─────────────────────────────────────────────────────────
//  Audio connect / disconnect
// ─────────────────────────────────────────────────────────
function toggleAudio() {
  if (session) disconnectAudio();
  else         connectAudio();
}

function connectAudio() {
  if (!ua || session) return;
  const target = `sip:${cfg.nodeNumber}@${new URL(cfg.wsUri).hostname}`;
  log(`Calling node ${cfg.nodeNumber}…`);

  session = ua.call(target, {
    mediaConstraints:    { audio: true, video: false },
    rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
    pcConfig: { iceServers: cfg.stunServers },
    eventHandlers: {
      progress:  () => { setStatus('Ringing…'); log('Ringing…'); },
      confirmed: () => {
        setStatus('On air', 'connected');
        log(`On node ${cfg.nodeNumber}`, 'ok');
        els.btnAudio.textContent = 'Disconnect Audio';
        els.btnAudio.classList.add('connected');
        els.btnPtt.disabled = false;
        els.pttLabel.textContent = 'Hold to transmit  ·  Space bar shortcut';
        setTxEnabled(false);
        startMeters();
      },
      failed: e => {
        log(`Call failed: ${e.cause}`, 'error');
        setStatus('Registered', 'registered');
        session = null;
        resetAudioUI();
      },
      ended: () => {
        log('Audio session ended');
        setStatus('Registered', 'registered');
        session = null;
        resetAudioUI();
        stopMeters();
      },
    },
  });
}

function disconnectAudio() {
  if (session) { try { session.terminate(); } catch (_) {} session = null; }
}

function resetAudioUI() {
  els.btnAudio.textContent = 'Connect Audio';
  els.btnAudio.classList.remove('connected');
  els.btnPtt.disabled = true;
  els.btnPtt.classList.remove('transmitting');
  els.pttLabel.textContent = 'Connect audio to enable';
  els.pttLabel.classList.remove('tx');
}

function handleNewSession(data) {
  const s = data.session;
  if (s.direction === 'incoming') {
    s.answer({ mediaConstraints: { audio: true, video: false } });
    session = s;
  }
  s.on('peerconnection', pcData => {
    pcData.peerconnection.ontrack = e => {
      if (!els.remoteAudio.srcObject) {
        els.remoteAudio.srcObject = e.streams[0];
        setupRxMeter(e.streams[0]);
      }
    };
  });
}

// ─────────────────────────────────────────────────────────
//  PTT  —  enable/disable the outgoing audio track
// ─────────────────────────────────────────────────────────
function setTxEnabled(enabled) {
  if (!session?.connection) return;
  session.connection.getSenders().forEach(s => {
    if (s.track?.kind === 'audio') s.track.enabled = enabled;
  });
}

function pttStart() {
  if (!session || els.btnPtt.disabled) return;
  setTxEnabled(true);
  els.btnPtt.classList.add('transmitting');
  els.pttLabel.textContent = '● TRANSMITTING';
  els.pttLabel.classList.add('tx');
}

function pttStop() {
  if (!session) return;
  setTxEnabled(false);
  els.btnPtt.classList.remove('transmitting');
  els.pttLabel.textContent = 'Hold to transmit  ·  Space bar shortcut';
  els.pttLabel.classList.remove('tx');
}

// ─────────────────────────────────────────────────────────
//  Audio level meters
// ─────────────────────────────────────────────────────────
function setupRxMeter(stream) {
  try {
    const ctx = new AudioContext();
    rxAnalyser = ctx.createAnalyser();
    rxAnalyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(rxAnalyser);
  } catch (_) {}
}

function startMeters() {
  if (meterRaf) return;
  const txData = new Uint8Array(128);
  const rxData = new Uint8Array(128);

  // Separate AudioContext for TX meter (reads mic independently of the call)
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const ctx = new AudioContext();
    txAnalyser = ctx.createAnalyser();
    txAnalyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(txAnalyser);
  }).catch(() => {});

  const tick = () => {
    meterRaf = requestAnimationFrame(tick);
    if (txAnalyser) {
      txAnalyser.getByteTimeDomainData(txData);
      const rms = rmsOf(txData);
      els.txFill.style.width = `${Math.min(100, rms * 300)}%`;
      els.txDb.textContent   = rms > 0.002 ? `${(20 * Math.log10(rms)).toFixed(0)} dB` : '—';
    }
    if (rxAnalyser) {
      rxAnalyser.getByteTimeDomainData(rxData);
      const rms = rmsOf(rxData);
      els.rxFill.style.width = `${Math.min(100, rms * 300)}%`;
      els.rxDb.textContent   = rms > 0.002 ? `${(20 * Math.log10(rms)).toFixed(0)} dB` : '—';
    }
  };
  tick();
}

function stopMeters() {
  if (meterRaf) { cancelAnimationFrame(meterRaf); meterRaf = null; }
  els.txFill.style.width = '0%'; els.txDb.textContent = '—';
  els.rxFill.style.width = '0%'; els.rxDb.textContent = '—';
  txAnalyser = rxAnalyser = null;
  els.remoteAudio.srcObject = null;
}

function rmsOf(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

// ─────────────────────────────────────────────────────────
//  Node link / unlink  (REST API calls)
// ─────────────────────────────────────────────────────────
async function apiPost(path, body) {
  const resp = await fetch(path, {
    method:  'POST',
    headers: authHeaders(),
    body:    JSON.stringify(body),
  });
  if (resp.status === 401) { signOut(); return { ok: false, error: 'Session expired' }; }
  return resp.json();
}

async function linkNode() {
  const target = els.targetNode.value.trim();
  if (!target) return;
  log(`Linking → ${target}…`);
  const data = await apiPost('/api/node/connect', { target });
  log(data.message || data.error, data.ok ? 'ok' : 'error');
  if (data.ok) setTimeout(refreshStatus, 1500);
}

async function unlinkNode() {
  const target = els.targetNode.value.trim();
  if (!target) return;
  log(`Unlinking ${target}…`);
  const data = await apiPost('/api/node/disconnect', { target });
  log(data.message || data.error, data.ok ? 'ok' : 'error');
  if (data.ok) setTimeout(refreshStatus, 1500);
}

async function unlinkAll() {
  log('Unlinking all…');
  const data = await apiPost('/api/node/disconnect-all', {});
  log(data.message || data.error, data.ok ? 'ok' : 'error');
  if (data.ok) setTimeout(refreshStatus, 1500);
}

async function refreshStatus() {
  try {
    const resp = await fetch('/api/node/status', { headers: authHeaders() });
    if (resp.status === 401) { signOut(); return; }
    const data = await resp.json();
    renderLinkedNodes(data.output || '');
  } catch (_) {
    els.linkedNodes.textContent = 'Could not reach AMI';
  }
}

function renderLinkedNodes(raw) {
  const lines = raw.split('\n').filter(l => /^\s*\d{4,7}/.test(l));
  if (!lines.length) {
    els.linkedNodes.textContent = 'No active links';
    return;
  }
  els.linkedNodes.innerHTML = '';
  lines.forEach(line => {
    const parts   = line.trim().split(/\s+/);
    const nodeNum = parts[0];
    const item    = document.createElement('div');
    item.className = 'node-item';
    item.innerHTML = `
      <span class="node-num">${nodeNum}</span>
      <span style="font-size:0.68rem;color:var(--muted)">${parts.slice(1).join(' ')}</span>
      <button class="btn-unlink-item" data-node="${nodeNum}">✕</button>`;
    item.querySelector('.btn-unlink-item').addEventListener('click', async e => {
      const n = e.target.dataset.node;
      log(`Unlinking ${n}…`);
      const data = await apiPost('/api/node/disconnect', { target: n });
      log(data.message || data.error, data.ok ? 'ok' : 'error');
      if (data.ok) setTimeout(refreshStatus, 1500);
    });
    els.linkedNodes.appendChild(item);
  });
}

// Refresh link status every 15 s while on transceiver screen
setInterval(() => { if (cfg) refreshStatus(); }, 15000);

// ─────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // ── Setup screen events ──
  els.btnSetup.addEventListener('click', handleSetupSubmit);
  [els.setupNode, els.setupPass].forEach(el =>
    el.addEventListener('keydown', e => { if (e.key === 'Enter') handleSetupSubmit(); })
  );

  // ── Transceiver events ──
  els.btnSignout.addEventListener('click', signOut);
  els.btnAudio.addEventListener('click', toggleAudio);

  // PTT — mouse
  els.btnPtt.addEventListener('mousedown',  pttStart);
  els.btnPtt.addEventListener('mouseup',    pttStop);
  els.btnPtt.addEventListener('mouseleave', pttStop);

  // PTT — touch (mobile)
  els.btnPtt.addEventListener('touchstart', e => { e.preventDefault(); pttStart(); }, { passive: false });
  els.btnPtt.addEventListener('touchend',   e => { e.preventDefault(); pttStop();  }, { passive: false });

  // PTT — spacebar
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault(); pttStart();
    }
  });
  document.addEventListener('keyup', e => {
    if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault(); pttStop();
    }
  });

  // Node controls
  els.btnLink.addEventListener('click', linkNode);
  els.btnUnlink.addEventListener('click', unlinkNode);
  els.btnUnlinkAll.addEventListener('click', unlinkAll);
  els.btnRefresh.addEventListener('click', refreshStatus);
  els.targetNode.addEventListener('keydown', e => { if (e.key === 'Enter') linkNode(); });

  // ── Initial routing: session token already stored? ──
  const token = getToken();
  if (token) {
    enterTransceiver();   // will show setup screen if token is invalid
  } else {
    showSetup();
  }
});
