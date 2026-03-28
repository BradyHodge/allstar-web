'use strict';

const express = require('express');
const router  = express.Router();

/**
 * GET /api/sip-config
 * Returns the SIP/WebRTC parameters the browser needs to connect.
 * Served over HTTPS via Caddy, so WSS URI is derived from DOMAIN env var.
 */
router.get('/', (req, res) => {
  const domain = process.env.SIP_DOMAIN || req.hostname;
  res.json({
    wsUri:       `wss://${domain}/ws`,
    sipUri:      `sip:${process.env.SIP_USER || 'webtx'}@${domain}`,
    password:    process.env.SIP_PASSWORD || '',
    nodeNumber:  process.env.NODE_NUMBER  || '',
    stunServers: [
      { urls: `stun:${process.env.STUN_SERVER || 'stun.l.google.com:19302'}` }
    ]
  });
});

module.exports = router;
