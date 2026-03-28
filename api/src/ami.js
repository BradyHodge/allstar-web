'use strict';

const AsteriskManager = require('asterisk-manager');

let ami = null;

function getAmi() {
  if (ami) return ami;

  ami = new AsteriskManager(
    process.env.AMI_PORT || '5038',
    process.env.AMI_HOST || 'host.docker.internal',
    process.env.AMI_USER || 'webtx',
    process.env.AMI_SECRET || 'changeme-ami',
    true  // enable events
  );

  ami.keepConnected();

  ami.on('connect',    ()    => console.log('[AMI] Connected to Asterisk'));
  ami.on('close',      ()    => console.log('[AMI] Connection closed'));
  ami.on('error',      (err) => console.error('[AMI] Error:', err.message));
  ami.on('disconnect', ()    => console.log('[AMI] Disconnected (will reconnect)'));

  return ami;
}

/**
 * Send an Asterisk CLI command via AMI and return the output.
 * @param {string} cmd  - Asterisk CLI command string
 * @returns {Promise<string>}
 */
function cliCommand(cmd) {
  return new Promise((resolve, reject) => {
    getAmi().action({ action: 'Command', command: cmd }, (err, res) => {
      if (err) return reject(new Error(err.message || String(err)));
      // res.output is the command output text
      resolve(typeof res === 'object' ? (res.output || JSON.stringify(res)) : String(res));
    });
  });
}

module.exports = { getAmi, cliCommand };
