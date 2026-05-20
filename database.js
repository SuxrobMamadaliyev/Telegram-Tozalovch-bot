const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// DB_PATH env dan olinadi.
// Render'da /tmp restart da o'chadi — persistent disk yo'q bo'lsa
// loyiha papkasidagi ./data/ ishlatiladi (yoki RENDER_DISK_PATH env bilan override)
function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;

  // Render persistent disk ulangan bo'lsa
  if (process.env.RENDER_DISK_PATH) {
    const dir = process.env.RENDER_DISK_PATH;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'bot.db');
  }

  // Local / default: loyiha papkasida ./data/bot.db
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'bot.db');
}

const DB_PATH = resolveDbPath();
console.log(`[DB] Fayl joyi: ${DB_PATH}`);

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');   // WAL — tezroq va xatosizroq
db.pragma('synchronous = NORMAL'); // Balans: tezlik + xavfsizlik

// Jadvallarni yaratish
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT DEFAULT '',
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    lang TEXT DEFAULT 'uz',
    joined_at TEXT DEFAULT (datetime('now')),
    last_active TEXT DEFAULT (datetime('now')),
    blocked INTEGER DEFAULT 0,
    is_banned INTEGER DEFAULT 0,
    sessions_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    user_id INTEGER PRIMARY KEY,
    session_string TEXT,
    phone TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT,
    count INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS required_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL UNIQUE,
    title TEXT DEFAULT '',
    type TEXT DEFAULT 'channel'
  );

  CREATE TABLE IF NOT EXISTS bot_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// .env dagi REQUIRED_CHANNEL ni avtomatik DB ga ko'chirish (bir martalik migration)
(function migrateEnvChannel() {
  const envChannel = process.env.REQUIRED_CHANNEL;
  if (!envChannel) return;
  const already = db.prepare('SELECT id FROM required_channels WHERE channel_id = ?').get(envChannel);
  if (!already) {
    db.prepare('INSERT OR IGNORE INTO required_channels (channel_id, title, type) VALUES (?, ?, ?)').run(
      envChannel, envChannel, 'channel'
    );
    console.log(`[DB] REQUIRED_CHANNEL migratsiya: ${envChannel} qo'shildi`);
  }
})();

module.exports = {
  getDbPath: () => DB_PATH,

  getUser: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),

  saveUser: (id, username, first_name, last_name, lang) => {
    db.prepare(`
      INSERT INTO users (id, username, first_name, last_name, lang)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        last_active = datetime('now')
    `).run(id, username || '', first_name || '', last_name || '', lang);
  },

  updateActivity: (id) => db.prepare("UPDATE users SET last_active = datetime('now') WHERE id = ?").run(id),

  setLang: (id, lang) => db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(lang, id),

  getLang: (id) => {
    const user = db.prepare('SELECT lang FROM users WHERE id = ?').get(id);
    return user ? user.lang : 'uz';
  },

  // ─── Sessionlar ───────────────────────────────────────────────────
  saveSession: (userId, sessionString, phone) => {
    db.prepare(`
      INSERT INTO sessions (user_id, session_string, phone)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        session_string = excluded.session_string,
        phone = excluded.phone,
        updated_at = datetime('now')
    `).run(userId, sessionString, phone);
  },

  getSession: (userId) => db.prepare('SELECT * FROM sessions WHERE user_id = ?').get(userId),

  deleteSession: (userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId),

  // ─── Ban ──────────────────────────────────────────────────────────
  isBanned: (id) => {
    const user = db.prepare('SELECT is_banned FROM users WHERE id = ?').get(id);
    return user ? user.is_banned === 1 : false;
  },

  banUser: (id) => db.prepare('UPDATE users SET is_banned = 1 WHERE id = ?').run(id),

  unbanUser: (id) => db.prepare('UPDATE users SET is_banned = 0 WHERE id = ?').run(id),

  blockUser: (id) => db.prepare('UPDATE users SET blocked = 1 WHERE id = ?').run(id),

  // ─── Statistika ───────────────────────────────────────────────────
  getStats: () => ({
    total: db.prepare('SELECT COUNT(*) as c FROM users WHERE is_banned = 0').get().c,
    sessions: db.prepare('SELECT COUNT(*) as c FROM sessions').get().c,
    banned: db.prepare('SELECT COUNT(*) as c FROM users WHERE is_banned = 1').get().c,
    today: db.prepare("SELECT COUNT(*) as c FROM users WHERE date(joined_at) = date('now')").get().c,
    active: db.prepare("SELECT COUNT(*) as c FROM users WHERE last_active > datetime('now', '-24 hours')").get().c,
    totalLeaves: db.prepare("SELECT SUM(count) as c FROM stats WHERE action = 'leave'").get().c || 0,
  }),

  getAllUsers: () => db.prepare('SELECT id, lang FROM users WHERE is_banned = 0').all(),

  getAllUsersAdmin: (limit = 10, offset = 0) => {
    return db.prepare(
      'SELECT id, username, first_name, last_name, is_banned, blocked FROM users ORDER BY joined_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset);
  },

  getUserCount: () => db.prepare('SELECT COUNT(*) as c FROM users').get().c,

  addStat: (userId, action) => {
    const existing = db.prepare(
      "SELECT id FROM stats WHERE user_id = ? AND action = ? AND date(created_at) = date('now')"
    ).get(userId, action);
    if (existing) {
      db.prepare(
        "UPDATE stats SET count = count + 1 WHERE user_id = ? AND action = ? AND date(created_at) = date('now')"
      ).run(userId, action);
    } else {
      db.prepare('INSERT INTO stats (user_id, action, count) VALUES (?, ?, 1)').run(userId, action);
    }
  },

  // ─── Majburiy obuna kanallari ─────────────────────────────────────
  getRequiredChannels: () => db.prepare('SELECT * FROM required_channels ORDER BY id ASC').all(),

  addRequiredChannel: (channelId, title, type = 'channel') => {
    try {
      db.prepare(
        'INSERT INTO required_channels (channel_id, title, type) VALUES (?, ?, ?)'
      ).run(channelId, title || channelId, type);
      return true;
    } catch (e) {
      // UNIQUE constraint — allaqachon bor
      return false;
    }
  },

  removeRequiredChannel: (id) => {
    db.prepare('DELETE FROM required_channels WHERE id = ?').run(id);
  },

  // ─── Bot sozlamalari (kelajak uchun) ─────────────────────────────
  getSetting: (key) => {
    const row = db.prepare('SELECT value FROM bot_settings WHERE key = ?').get(key);
    return row ? row.value : null;
  },

  setSetting: (key, value) => {
    db.prepare('INSERT INTO bot_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  },
};
