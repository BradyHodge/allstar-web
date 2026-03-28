'use strict';

const express = require('express');
const helmet  = require('helmet');
const path    = require('path');
const { getAmi } = require('./ami');

const app  = express();
const PORT = process.env.PORT || 3000;

// Security headers - relax CSP so JsSIP/WebRTC can work
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(express.json());

// Serve static web UI
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use('/api/node',       require('./routes/node'));
app.use('/api/sip-config', require('./routes/sipconfig'));

// 404 fallback → serve the SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler
app.use((err, req, res, _next) => {
  console.error('[server]', err.message);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

// Eagerly connect to AMI on startup (retries automatically)
getAmi();

app.listen(PORT, () => {
  console.log(`AllStar Web Transceiver API listening on port ${PORT}`);
  console.log(`  Node:   ${process.env.NODE_NUMBER}`);
  console.log(`  Domain: ${process.env.SIP_DOMAIN}`);
});
