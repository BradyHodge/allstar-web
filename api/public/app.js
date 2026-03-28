'use strict';
// ─────────────────────────────────────────────────────────
//  AllStar Web Transceiver - Browser Client
//  Uses JsSIP for WebRTC-over-SIP to connect to Asterisk.
//  PTT is implemented by enabling/disabling the local audio
//  track — no re-INVITE needed, zero extra latency.
// ─────────────────────────────────────────────────────────

let ua        = null;   // JsSIP UserAgent
let session   = null;   // Active SIP call session
let cfg       = null;   // Config from /api/sip-config
let txAnalyser = null;  // AudioAnalyser for TX meter
let rxAnalyser = null;  // AudioAnalyser for RX meter
let meterRaf   = null;  // requestAnimationFrame handle

// ── DOM refs ──────────────────────────────────────────────
const $  = id => document.getElementById(id);
const els = {
  dot:         $('status-dot'),
  statusText:  $('status-text'),
  nodeBadge:   $('node-badge'),
  btnAudio:    $('btn-audio'),
  btnPtt:      $('btn-ptt'),
  pttLabel:    $('ptt-label'),
  txFill:      $('tx-fill'),
  rxFill:      $('rx-fill'),
  txDb:        $('tx-db'),
  rxDb:        $('rx-db'),
  remoteAudio: $('remote-audio'),
  targetNode:  $('target-node'),
  btnLink:     $('btn-link'),
  btnUnlink:   $('btn-unlink'),
  btnUnlinkAll:$('btn-unlink-all'),
  btnRefresh:  $('btn-refresh-status'),
  linkedNodes: $('linked-nodes'),
  log:         $('log'),
};

// ── Logging ───────────────────────────────────────────────
function log(msg, type = '') {
  const entry = document.createElement('div');
  entry.className = `entry ${type}`;
  entry.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  els.log.prepend(entry);
  // Keep log manageable
  while (els.log.children.length > 60) els.log.removeChild(els.log.lastChild);
}

// ── Status dot ────────────────────────────────────────────
function setStatus(text, state = '') {
  els.statusText.textContent = text;
  els.dot.className = `status-dot ${state}`;
}

// ── Bootstrap: fetch config then init JsSIP ──────────────
async function init() {
  log('Fetching configuration…');
  try {
    const resp = await fetch('/api/sip-config');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    cfg = await resp.json();
  } catch (e) {
    log(`Failed to load config: ${e.message}`, 'error');
    setStatus('Config error', 'error');
    return;
  }

  els.nodeBadge.textContent = `Node ${cfg.nodeNumber}`;
  log(`Config loaded — node ${cfg.nodeNumber}`);
  log(`SIP server: ${cfg.wsUri}`);

  startSipUA();
}

// ── JsSIP UserAgent ───────────────────────────────────────
function startSipUA() {
  const socket = new JsSIP.WebSocketInterface(cfg.wsUri);

  ua = new JsSIP.UA({
    sockets:  [socket],
    uri:      cfg.sipUri,
    password: cfg.password,
    register: true,
    pcConfig: { iceServers: cfg.stunServers },
    // Reconnect parameters
    connection_recovery_min_interval: 2,
    connection_recovery_max_interval: 30,
  });

  ua.on('connecting',   ()    => { setStatus('Connecting…'); log('Connecting to SIP server…'); });
  ua.on('connected',    ()    => { setStatus('Connected'); log('WebSocket connected', 'ok'); });
  ua.on('disconnected', ()    => { setStatus('Disconnected', 'error'); log('WebSocket disconnected', 'warn'); });

  ua.on('registered', () => {
    setStatus('Registered', 'registered');
    log(`Registered as ${cfg.sipUri}`, 'ok');
    els.btnAudio.disabled = false;
    els.btnAudio.textContent = 'Connect Audio';
  });

  ua.on('unregistered', () => {
    setStatus('Unregistered', '');
    log('SIP unregistered', 'warn');
    els.btnAudio.disabled = false;
  });

  ua.on('registrationFailed', e => {
    setStatus('Registration failed', 'error');
    log(`Registration failed: ${e.cause}`, 'error');
  });

  ua.on('newRTCSession', handleNewSession);

  ua.start();
  log('SIP UA started');
}

// ── Connect / Disconnect Audio ────────────────────────────
function toggleAudio() {
  if (session) {
    disconnectAudio();
  } else {
    connectAudio();
  }
}

function connectAudio() {
  if (!ua || session) return;

  const target = `sip:${cfg.nodeNumber}@${new URL(cfg.wsUri).hostname}`;
  log(`Calling ${target}…`);

  session = ua.call(target, {
    mediaConstraints:    { audio: true, video: false },
    rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
    pcConfig: { iceServers: cfg.stunServers },
    eventHandlers: {
      progress: () => { setStatus('Ringing…'); log('Ringing…'); },

      confirmed: () => {
        setStatus('On node', 'connected');
        log(`Connected to AllStar node ${cfg.nodeNumber}`, 'ok');
        els.btnAudio.textContent = 'Disconnect Audio';
        els.btnAudio.classList.add('connected');
        els.btnPtt.disabled = false;
        els.pttLabel.textContent = 'Hold to transmit';
        // Start muted — user must press PTT to transmit
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
  if (session) {
    session.terminate();
    session = null;
  }
}

function resetAudioUI() {
  els.btnAudio.textContent = 'Connect Audio';
  els.btnAudio.classList.remove('connected');
  els.btnPtt.disabled = true;
  els.btnPtt.classList.remove('transmitting');
  els.pttLabel.textContent = 'Connect audio to enable';
  els.pttLabel.classList.remove('tx');
}

// ── Incoming session handler (e.g. Asterisk calls us back) ─
function handleNewSession(data) {
  const s = data.session;
  if (s.direction === 'incoming') {
    // Auto-answer incoming calls from the node
    s.answer({ mediaConstraints: { audio: true, video: false } });
    session = s;
  }
  // Wire up remote audio
  s.on('peerconnection', pcData => {
    pcData.peerconnection.ontrack = e => {
      if (!els.remoteAudio.srcObject) {
        els.remoteAudio.srcObject = e.streams[0];
        setupRxMeter(e.streams[0]);
      }
    };
  });
}

// ── PTT: enable/disable the outgoing audio track ──────────
// Track.enabled = false sends silence/comfort-noise.
// The RTP session stays alive — no re-INVITE latency.
function setTxEnabled(enabled) {
  if (!session || !session.connection) return;
  session.connection.getSenders().forEach(sender => {
    if (sender.track && sender.track.kind === 'audio') {
      sender.track.enabled = enabled;
    }
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
  els.pttLabel.textContent = 'Hold to transmit';
  els.pttLabel.classList.remove('tx');
}

// ── Audio level meters ────────────────────────────────────
function setupRxMeter(stream) {
  try {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    rxAnalyser = ctx.createAnalyser();
    rxAnalyser.fftSize = 256;
    src.connect(rxAnalyser);
  } catch (_) { /* meters are non-critical */ }
}

function startMeters() {
  if (meterRaf) return;
  const txData = new Uint8Array(128);
  const rxData = new Uint8Array(128);

  // TX meter: read from microphone via a separate AudioContext
  let txCtx, txSrc, txAna;
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    txCtx = new AudioContext();
    txSrc = txCtx.createMediaStreamSource(stream);
    txAna = txCtx.createAnalyser();
    txAna.fftSize = 256;
    txSrc.connect(txAna);
    txAnalyser = txAna;
  }).catch(() => {});

  function tick() {
    meterRaf = requestAnimationFrame(tick);

    if (txAnalyser) {
      txAnalyser.getByteTimeDomainData(txData);
      const rms = rmsOf(txData);
      const pct = Math.min(100, rms * 300);
      els.txFill.style.width = `${pct}%`;
      els.txDb.textContent   = rms > 0.001 ? `${(20 * Math.log10(rms)).toFixed(0)} dB` : '—';
    }

    if (rxAnalyser) {
      rxAnalyser.getByteTimeDomainData(rxData);
      const rms = rmsOf(rxData);
      const pct = Math.min(100, rms * 300);
      els.rxFill.style.width = `${pct}%`;
      els.rxDb.textContent   = rms > 0.001 ? `${(20 * Math.log10(rms)).toFixed(0)} dB` : '—';
    }
  }
  tick();
}

function stopMeters() {
  if (meterRaf) { cancelAnimationFrame(meterRaf); meterRaf = null; }
  els.txFill.style.width = '0%'; els.txDb.textContent = '—';
  els.rxFill.style.width = '0%'; els.rxDb.textContent = '—';
  txAnalyser = null; rxAnalyser = null;
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

// ── Node link / unlink API calls ──────────────────────────
async function apiPost(path, body) {
  const resp = await fetch(path, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return resp.json();
}

async function linkNode() {
  const target = els.targetNode.value.trim();
  if (!target) return;
  log(`Linking to node ${target}…`);
  const data = await apiPost('/api/node/connect', { target });
  log(data.message || data.error, data.ok ? 'ok' : 'error');
  if (data.ok) refreshStatus();
}

async function unlinkNode() {
  const target = els.targetNode.value.trim();
  if (!target) return;
  log(`Unlinking node ${target}…`);
  const data = await apiPost('/api/node/disconnect', { target });
  log(data.message || data.error, data.ok ? 'ok' : 'error');
  if (data.ok) refreshStatus();
}

async function unlinkAll() {
  log('Unlinking all nodes…');
  const data = await apiPost('/api/node/disconnect-all', {});
  log(data.message || data.error, data.ok ? 'ok' : 'error');
  if (data.ok) refreshStatus();
}

// ── Node status / linked nodes list ───────────────────────
async function refreshStatus() {
  try {
    const resp = await fetch('/api/node/status');
    const data = await resp.json();
    renderLinkedNodes(data.output || '');
  } catch (e) {
    els.linkedNodes.textContent = 'Could not reach AMI';
  }
}

function renderLinkedNodes(raw) {
  // Parse "rpt lstats" output — lines like: "12345  ESTABLISHED  TRX"
  const lines = (raw || '').split('\n').filter(l => /^\d{4,7}/.test(l.trim()));
  if (!lines.length) {
    els.linkedNodes.textContent = 'No active links';
    return;
  }
  els.linkedNodes.innerHTML = '';
  lines.forEach(line => {
    const parts = line.trim().split(/\s+/);
    const nodeNum = parts[0];
    const item = document.createElement('div');
    item.className = 'node-item';
    item.innerHTML = `
      <span class="node-number">${nodeNum}</span>
      <span style="font-size:0.7rem;color:var(--muted)">${parts.slice(1).join(' ')}</span>
      <button class="btn-unlink" data-node="${nodeNum}">✕</button>`;
    item.querySelector('.btn-unlink').addEventListener('click', async e => {
      const n = e.target.dataset.node;
      log(`Unlinking ${n}…`);
      const data = await apiPost('/api/node/disconnect', { target: n });
      log(data.message || data.error, data.ok ? 'ok' : 'error');
      if (data.ok) refreshStatus();
    });
    els.linkedNodes.appendChild(item);
  });
}

// Refresh status every 15 seconds
setInterval(refreshStatus, 15000);

// ── Event wiring ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Audio connect/disconnect
  els.btnAudio.addEventListener('click', toggleAudio);

  // PTT — mouse
  els.btnPtt.addEventListener('mousedown',  pttStart);
  els.btnPtt.addEventListener('mouseup',    pttStop);
  els.btnPtt.addEventListener('mouseleave', pttStop);

  // PTT — touch (mobile)
  els.btnPtt.addEventListener('touchstart', e => { e.preventDefault(); pttStart(); }, { passive: false });
  els.btnPtt.addEventListener('touchend',   e => { e.preventDefault(); pttStop();  }, { passive: false });

  // PTT — spacebar shortcut
  document.addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); pttStart(); } });
  document.addEventListener('keyup',   e => { if (e.code === 'Space') { e.preventDefault(); pttStop(); } });

  // Node controls
  els.btnLink.addEventListener('click', linkNode);
  els.btnUnlink.addEventListener('click', unlinkNode);
  els.btnUnlinkAll.addEventListener('click', unlinkAll);
  els.btnRefresh.addEventListener('click', refreshStatus);

  // Allow Enter key in the target node input
  els.targetNode.addEventListener('keydown', e => { if (e.key === 'Enter') linkNode(); });

  init();
});
