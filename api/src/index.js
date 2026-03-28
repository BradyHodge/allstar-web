'use strict';

const express  = require('express');
const helmet   = require('helmet');
const path     = require('path');
const { getAmi } = require('./ami');
const { writeUserConfigs } = require('./config-generator');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json());

// Static web UI
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/node',       require('./routes/node'));
app.use('/api/sip-config', require('./routes/sipconfig'));

// SPA fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler
app.use((err, req, res, _next) => {
  console.error('[server]', err.message);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

// On startup: connect to AMI and sync any existing users' configs
// (in case the ASL container was rebuilt and lost its users volume)
getAmi();
writeUserConfigs().catch(e => console.error('[startup] Config write failed:', e.message));

app.listen(PORT, () => {
  console.log(`AllStar Web Transceiver API listening on port ${PORT}`);
  console.log(`  Domain: ${process.env.SIP_DOMAIN}`);
});
