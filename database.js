const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Render uchun /tmp papkasidan foydalanamiz (Write access bor joy)
const DB_PATH = process.env.DB_PATH || '/tmp/bot.db';

const db = new Database(DB_PATH);

// Render Free tier uchun stabil rejim
db.pragma('journal_mode = DELETE');

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
`);

module.exports = {
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

  isBanned: (id) => {
    const user = db.prepare('SELECT is_banned FROM users WHERE id = ?').get(id);
    return user ? user.is_banned === 1 : false;
  },

  getStats: () => ({
    total: db.prepare('SELECT COUNT(*) as c FROM users WHERE is_banned = 0').get().c,
    sessions: db.prepare('SELECT COUNT(*) as c FROM sessions').get().c,
    banned: db.prepare('SELECT COUNT(*) as c FROM users WHERE is_banned = 1').get().c,
    today: db.prepare("SELECT COUNT(*) as c FROM users WHERE date(joined_at) = date('now')").get().c,
    active: db.prepare("SELECT COUNT(*) as c FROM users WHERE last_active > datetime('now', '-24 hours')").get().c,
    totalLeaves: db.prepare("SELECT SUM(count) as c FROM stats WHERE action = 'leave'").get().c || 0
  }),

  getAllUsers: () => db.prepare('SELECT id, lang FROM users WHERE is_banned = 0').all(),

  // FIX #1: getAllUsersAdmin va getUserCount qo'shildi
  getAllUsersAdmin: (limit = 10, offset = 0) => {
    return db.prepare('SELECT id, username, first_name, last_name, is_banned, blocked FROM users ORDER BY joined_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  },

  getUserCount: () => {
    return db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  },

  // FIX #3: addStat — ON CONFLICT DO NOTHING o'rniga INSERT OR IGNORE ishlatildi
  addStat: (userId, action) => {
    // Bugun ushbu action uchun yozuv bor-yo'qligini tekshir
    const existing = db.prepare(
      "SELECT id FROM stats WHERE user_id = ? AND action = ? AND date(created_at) = date('now')"
    ).get(userId, action);

    if (existing) {
      db.prepare(
        "UPDATE stats SET count = count + 1 WHERE user_id = ? AND action = ? AND date(created_at) = date('now')"
      ).run(userId, action);
    } else {
      db.prepare(
        'INSERT INTO stats (user_id, action, count) VALUES (?, ?, 1)'
      ).run(userId, action);
    }
  },
  
  blockUser: (id) => db.prepare('UPDATE users SET blocked = 1 WHERE id = ?').run(id),
  
  banUser: (id) => db.prepare('UPDATE users SET is_banned = 1 WHERE id = ?').run(id),
  
  unbanUser: (id) => db.prepare('UPDATE users SET is_banned = 0 WHERE id = ?').run(id),

  // ─── Majburiy obuna kanallari/guruhlari ───────────────────────────
  getRequiredChannels: () => db.prepare('SELECT * FROM required_channels ORDER BY id ASC').all(),

  addRequiredChannel: (channelId, title, type = 'channel') => {
    try {
      db.prepare(
        'INSERT INTO required_channels (channel_id, title, type) VALUES (?, ?, ?)'
      ).run(channelId, title || '', type);
      return true;
    } catch (e) {
      return false; // UNIQUE constraint — allaqachon bor
    }
  },

  removeRequiredChannel: (id) => {
    db.prepare('DELETE FROM required_channels WHERE id = ?').run(id);
  },
};
