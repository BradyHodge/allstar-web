'use strict';

const express = require('express');
const router  = express.Router();
const { cliCommand } = require('../ami');
const { requireAuth } = require('../middleware/auth');

// All node control routes require an authenticated session
router.use(requireAuth);

function isValidNode(n) {
  return typeof n === 'string' && /^\d{4,7}$/.test(n);
}

/**
 * GET /api/node/status
 * Returns current link status for the authenticated user's node.
 */
router.get('/status', async (req, res) => {
  const node = req.user.node_number;
  try {
    const output = await cliCommand(`rpt lstats ${node}`);
    res.json({ ok: true, node, output });
  } catch (err) {
    console.error('[node/status]', err.message);
    res.status(503).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/node/connect
 * Body: { target: "27000" }
 * Connects the user's hub node to a remote AllStar node (transceive mode).
 */
router.post('/connect', async (req, res) => {
  const { target } = req.body || {};
  if (!isValidNode(String(target || ''))) {
    return res.status(400).json({ ok: false, error: 'Invalid target node number (4–7 digits)' });
  }
  const node = req.user.node_number;
  try {
    await cliCommand(`rpt cmd ${node} ilink 3 ${target}`);
    res.json({ ok: true, message: `Linking ${node} → ${target}` });
  } catch (err) {
    console.error('[node/connect]', err.message);
    res.status(503).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/node/disconnect
 * Body: { target: "27000" }
 */
router.post('/disconnect', async (req, res) => {
  const { target } = req.body || {};
  if (!isValidNode(String(target || ''))) {
    return res.status(400).json({ ok: false, error: 'Invalid target node number (4–7 digits)' });
  }
  const node = req.user.node_number;
  try {
    await cliCommand(`rpt cmd ${node} ilink 1 ${target}`);
    res.json({ ok: true, message: `Unlinked ${node} ✕ ${target}` });
  } catch (err) {
    console.error('[node/disconnect]', err.message);
    res.status(503).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/node/disconnect-all
 */
router.post('/disconnect-all', async (req, res) => {
  const node = req.user.node_number;
  try {
    await cliCommand(`rpt cmd ${node} ilink 6`);
    res.json({ ok: true, message: 'All links disconnected' });
  } catch (err) {
    console.error('[node/disconnect-all]', err.message);
    res.status(503).json({ ok: false, error: err.message });
  }
});

module.exports = router;
