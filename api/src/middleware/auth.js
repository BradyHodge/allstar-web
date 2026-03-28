'use strict';

const db = require('../db');

/**
 * Express middleware that extracts a session token from the
 * Authorization header ("Bearer <token>") and attaches the
 * user record to req.user.  Rejects with 401 if missing or invalid.
 */
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }

  const user = db.getByToken(token);
  if (!user) {
    return res.status(401).json({ ok: false, error: 'Invalid or expired session' });
  }

  req.user = user;
  next();
}

module.exports = { requireAuth };
