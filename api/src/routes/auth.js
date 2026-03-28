'use strict';

const express  = require('express');
const router   = express.Router();
const { v4: uuidv4 } = require('uuid');
const db       = require('../db');
const { encrypt, decrypt } = require('../crypto');
const { writeUserConfigs, reloadAsterisk } = require('../config-generator');

function isValidNodeNumber(n) {
  return typeof n === 'string' && /^\d{4,7}$/.test(n.trim());
}

function generateSipPassword() {
  // 20-char alphanumeric password safe for Asterisk config files
  return uuidv4().replace(/-/g, '').slice(0, 20);
}

/**
 * POST /api/auth/setup
 * Body: { nodeNumber: "12345", nodePassword: "secret" }
 *
 * First-time registration OR re-authentication for an existing node.
 * On success returns a session token the browser stores and sends
 * as "Authorization: Bearer <token>" on subsequent requests.
 */
router.post('/setup', async (req, res) => {
  const { nodeNumber, nodePassword } = req.body || {};

  if (!isValidNodeNumber(String(nodeNumber || ''))) {
    return res.status(400).json({ ok: false, error: 'Node number must be 4–7 digits' });
  }
  if (!nodePassword || typeof nodePassword !== 'string' || nodePassword.length < 1) {
    return res.status(400).json({ ok: false, error: 'Password is required' });
  }

  const node = String(nodeNumber).trim();
  const pass = String(nodePassword).trim();

  try {
    const existing = db.getByNode(node);

    if (existing) {
      // Verify the supplied password matches what's stored
      let storedPass;
      try {
        storedPass = decrypt(existing.enc_password);
      } catch (e) {
        return res.status(500).json({ ok: false, error: 'Failed to verify credentials' });
      }

      if (storedPass !== pass) {
        return res.status(401).json({ ok: false, error: 'Incorrect password for this node' });
      }

      // Issue a fresh session token
      const sessionToken = uuidv4();
      db.updateToken(node, sessionToken);
      console.log(`[auth] Re-authenticated node ${node}`);
      return res.json({ ok: true, sessionToken });
    }

    // New node: create record
    const sessionToken = uuidv4();
    const sipPassword  = generateSipPassword();
    const encPassword  = encrypt(pass);

    db.upsert({ nodeNumber: node, encPassword, sipPassword, sessionToken });
    console.log(`[auth] Registered new node ${node}`);

    // Write updated Asterisk configs and reload
    await writeUserConfigs();
    await reloadAsterisk();

    return res.json({ ok: true, sessionToken });

  } catch (e) {
    console.error('[auth/setup]', e);
    return res.status(500).json({ ok: false, error: 'Server error during setup' });
  }
});

module.exports = router;
