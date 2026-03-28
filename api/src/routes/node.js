'use strict';

const express = require('express');
const router  = express.Router();
const { cliCommand } = require('../ami');

const NODE = process.env.NODE_NUMBER;

// Validate that a target is a numeric node number (4-7 digits)
function isValidNode(n) {
  return typeof n === 'string' && /^\d{4,7}$/.test(n);
}

/**
 * GET /api/node/status
 * Returns the current link status for our node.
 */
router.get('/status', async (req, res) => {
  try {
    const output = await cliCommand(`rpt lstats ${NODE}`);
    res.json({ ok: true, node: NODE, output });
  } catch (err) {
    console.error('[node/status]', err.message);
    res.status(503).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/node/connect
 * Body: { target: "27000" }
 * Connects our hub node to a remote AllStar node in transceive mode.
 * Equivalent to dialing *327000 on a phone connected to this node.
 */
router.post('/connect', async (req, res) => {
  const { target } = req.body || {};
  if (!isValidNode(target)) {
    return res.status(400).json({ ok: false, error: 'Invalid target node number (4-7 digits)' });
  }
  try {
    await cliCommand(`rpt cmd ${NODE} ilink 3 ${target}`);
    res.json({ ok: true, message: `Connecting node ${NODE} → ${target}` });
  } catch (err) {
    console.error('[node/connect]', err.message);
    res.status(503).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/node/disconnect
 * Body: { target: "27000" }
 * Disconnects from a specific linked node.
 */
router.post('/disconnect', async (req, res) => {
  const { target } = req.body || {};
  if (!isValidNode(target)) {
    return res.status(400).json({ ok: false, error: 'Invalid target node number (4-7 digits)' });
  }
  try {
    await cliCommand(`rpt cmd ${NODE} ilink 1 ${target}`);
    res.json({ ok: true, message: `Disconnected node ${NODE} ✕ ${target}` });
  } catch (err) {
    console.error('[node/disconnect]', err.message);
    res.status(503).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/node/disconnect-all
 * Drops all current links.
 */
router.post('/disconnect-all', async (req, res) => {
  try {
    await cliCommand(`rpt cmd ${NODE} ilink 6`);
    res.json({ ok: true, message: 'All links disconnected' });
  } catch (err) {
    console.error('[node/disconnect-all]', err.message);
    res.status(503).json({ ok: false, error: err.message });
  }
});

module.exports = router;
