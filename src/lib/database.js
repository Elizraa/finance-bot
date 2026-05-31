import dotenv from 'dotenv';
dotenv.config();

import Database from 'better-sqlite3';
import crypto from 'crypto';
import { log } from './logger.js';

const { ENCRYPTION_KEY } = process.env;

const db = new Database('bot_data.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS user_api_keys (
    user_id INTEGER PRIMARY KEY,
    api_key TEXT NOT NULL,
    categories_enabled INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

try {
  db.exec(
    `ALTER TABLE user_api_keys ADD COLUMN categories_enabled INTEGER NOT NULL DEFAULT 0`,
  );
  log.info('Migrated user_api_keys: added categories_enabled column');
} catch {
  // Column already exists
}

log.info('Database initialised', { file: 'bot_data.db' });

export const dbHelpers = {
  encrypt(text) {
    if (!ENCRYPTION_KEY) return text;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(ENCRYPTION_KEY, 'hex'),
      iv,
    );
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  },

  decrypt(text) {
    if (!ENCRYPTION_KEY) return text;
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(ENCRYPTION_KEY, 'hex'),
      iv,
    );
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  },

  saveApiKey(userId, apiKey) {
    const encrypted = this.encrypt(apiKey);
    db.prepare(
      `INSERT INTO user_api_keys (user_id, api_key, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         api_key = excluded.api_key,
         updated_at = CURRENT_TIMESTAMP`,
    ).run(userId, encrypted);
    log.user(userId, 'API key saved/updated');
  },

  getApiKey(userId) {
    const row = db
      .prepare('SELECT api_key FROM user_api_keys WHERE user_id = ?')
      .get(userId);
    return row ? this.decrypt(row.api_key) : null;
  },

  deleteApiKey(userId) {
    db.prepare('DELETE FROM user_api_keys WHERE user_id = ?').run(userId);
    log.user(userId, 'API key deleted');
  },

  hasApiKey(userId) {
    return (
      db
        .prepare('SELECT 1 FROM user_api_keys WHERE user_id = ?')
        .get(userId) !== undefined
    );
  },

  getCategoriesEnabled(userId) {
    const row = db
      .prepare('SELECT categories_enabled FROM user_api_keys WHERE user_id = ?')
      .get(userId);
    return row ? row.categories_enabled === 1 : false;
  },

  toggleCategories(userId) {
    const current = this.getCategoriesEnabled(userId);
    const next = current ? 0 : 1;
    db.prepare(
      `UPDATE user_api_keys SET categories_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
    ).run(next, userId);
    log.user(userId, 'Categories toggled', { enabled: next === 1 });
    return next === 1;
  },
};

export default db;
