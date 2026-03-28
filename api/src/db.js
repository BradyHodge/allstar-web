'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_PATH = process.env.DB_PATH || '/app/data/users.db';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    node_number   TEXT PRIMARY KEY,
    enc_password  TEXT NOT NULL,
    sip_password  TEXT NOT NULL,
    session_token TEXT,
    created_at    INTEGER DEFAULT (unixepoch())
  )
`);

module.exports = {
  getByToken(token) {
    return db.prepare('SELECT * FROM users WHERE session_token = ?').get(token) || null;
  },

  getByNode(nodeNumber) {
    return db.prepare('SELECT * FROM users WHERE node_number = ?').get(String(nodeNumber)) || null;
  },

  upsert({ nodeNumber, encPassword, sipPassword, sessionToken }) {
    db.prepare(`
      INSERT INTO users (node_number, enc_password, sip_password, session_token)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(node_number) DO UPDATE SET
        enc_password  = excluded.enc_password,
        session_token = excluded.session_token
    `).run(String(nodeNumber), encPassword, sipPassword, sessionToken);
  },

  updateToken(nodeNumber, sessionToken) {
    db.prepare('UPDATE users SET session_token = ? WHERE node_number = ?')
      .run(sessionToken, String(nodeNumber));
  },

  allUsers() {
    return db.prepare('SELECT * FROM users').all();
  },
};
