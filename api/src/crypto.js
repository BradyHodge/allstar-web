'use strict';

const crypto = require('crypto');

// Key must be exactly 32 bytes for AES-256.
// Pad/truncate the ENCRYPTION_KEY env var to fit.
const rawKey = (process.env.ENCRYPTION_KEY || '').slice(0, 32).padEnd(32, '0');
const KEY    = Buffer.from(rawKey, 'utf8');

/**
 * Encrypt a plaintext string.
 * Returns a base64-encoded string: IV (12) + AuthTag (16) + Ciphertext.
 */
function encrypt(plaintext) {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/**
 * Decrypt a base64-encoded string produced by encrypt().
 */
function decrypt(ciphertext) {
  const buf      = Buffer.from(ciphertext, 'base64');
  const iv       = buf.subarray(0, 12);
  const tag      = buf.subarray(12, 28);
  const enc      = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
