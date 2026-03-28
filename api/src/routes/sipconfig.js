'use strict';

const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/sip-config
 * Returns the WebRTC/SIP parameters for the authenticated user's node.
 * Each user gets their own SIP username (node_NNNNN) and password.
 */
router.get('/', requireAuth, (req, res) => {
  const domain = process.env.SIP_DOMAIN || req.hostname;
  const { node_number, sip_password } = req.user;

  res.json({
    wsUri:       `wss://${domain}/ws`,
    sipUri:      `sip:node_${node_number}@${domain}`,
    password:    sip_password,
    nodeNumber:  node_number,
    stunServers: [
      { urls: `stun:${process.env.STUN_SERVER || 'stun.l.google.com:19302'}` }
    ]
  });
});

module.exports = router;
