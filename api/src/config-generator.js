'use strict';

const fs      = require('fs');
const path    = require('path');
const db      = require('./db');
const { decrypt } = require('./crypto');
const { cliCommand } = require('./ami');

const USERS_DIR = process.env.ASTERISK_USERS_DIR || '/etc/asterisk-users';

function ensureDir() {
  fs.mkdirSync(USERS_DIR, { recursive: true });
}

// ── Config fragment generators ─────────────────────────

function rptNodeSection(nodeNumber) {
  return `
[${nodeNumber}]
rxchannel       = DAHDI/pseudo
duplex          = 0
hangtime        = 0
althangtime     = 0
totime          = 3600000
holdofftelem    = 1
telemdefault    = 0
telemdynamic    = 0
idtime          = 0
politeid        = 30
functions       = functions
link_functions  = link-functions
phone_functions = phone-functions
telemetry       = telemetry
controlstates   = controlstates
scheduler       = scheduler
events          = events
erxgain         = -3
etxgain         = 3
`.trimStart();
}

function pjsipEndpointSection(nodeNumber, sipPassword) {
  const name = `node_${nodeNumber}`;
  return `
[${name}]
type                    = endpoint
transport               = transport-ws
context                 = sip-phones
disallow                = all
allow                   = ulaw
allow                   = opus
webrtc                  = yes
dtls_auto_generate_cert = yes
ice_support             = yes
rewrite_contact         = yes
rtp_symmetric           = yes
direct_media            = no
force_rport             = yes
auth                    = ${name}
aors                    = ${name}
callerid                = "Node ${nodeNumber}" <${nodeNumber}>
dtmf_mode               = rfc4733

[${name}]
type      = auth
auth_type = userpass
username  = ${name}
password  = ${sipPassword}

[${name}]
type            = aor
max_contacts    = 5
remove_existing = no

`.trimStart();
}

// ── Write all user configs to the shared volume ─────────

async function writeUserConfigs() {
  ensureDir();
  const users = db.allUsers();

  let rptConf   = '';
  let pjsipConf = '';
  let regConf   = '';

  for (const user of users) {
    let nodePassword;
    try {
      nodePassword = decrypt(user.enc_password);
    } catch (e) {
      console.error(`[config] Failed to decrypt password for node ${user.node_number}:`, e.message);
      continue;
    }

    rptConf   += rptNodeSection(user.node_number);
    pjsipConf += pjsipEndpointSection(user.node_number, user.sip_password);
    regConf   += `register => ${user.node_number}:${nodePassword}@register.allstarlink.org\n`;
  }

  fs.writeFileSync(path.join(USERS_DIR, 'users_rpt.conf'),   rptConf,   'utf8');
  fs.writeFileSync(path.join(USERS_DIR, 'users_pjsip.conf'), pjsipConf, 'utf8');
  fs.writeFileSync(path.join(USERS_DIR, 'users_reg.conf'),   regConf,   'utf8');

  console.log(`[config] Wrote configs for ${users.length} node(s)`);
}

// ── Trigger Asterisk to reload affected modules ─────────

async function reloadAsterisk() {
  const modules = ['res_pjsip.so', 'app_rpt.so', 'res_rpt_http_registrations.so'];

  for (const mod of modules) {
    try {
      await cliCommand(`module reload ${mod}`);
      console.log(`[config] Reloaded ${mod}`);
    } catch (e) {
      // Not all modules may be present (e.g. res_rpt_http_registrations)
      console.warn(`[config] Could not reload ${mod}: ${e.message}`);
    }
  }
}

module.exports = { writeUserConfigs, reloadAsterisk };
