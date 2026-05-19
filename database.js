const Database = require('better-sqlite3');
const path = require('path');

// Render uchun /tmp papkasida saqlash (yoki loyiha ichida)
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'bot.db');

const db = new Database(DB_PATH);

// WAL mode - tezroq yozish
db.pragma('journal_mode = WAL');

// Jadvallar yaratish
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
`);

module.exports = {
  // Foydalanuvchi olish
  getUser: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),

  // Foydalanuvchini saqlash / yangilash
  saveUser: (id, username, first_name, last_name, lang = 'uz') => {
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

  // Oxirgi faollikni yangilash
  updateActivity: (id) => {
    db.prepare('UPDATE users SET last_active = datetime("now") WHERE id = ?').run(id);
  },

  // Til sozlash
  setLang: (id, lang) => db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(lang, id),

  // Tilni olish
  getLang: (id) => {
    const row = db.prepare('SELECT lang FROM users WHERE id = ?').get(id);
    return row ? row.lang : 'uz';
  },

  // Barcha faol foydalanuvchilar
  getAllUsers: () => db.prepare('SELECT * FROM users WHERE blocked = 0 AND is_banned = 0').all(),

  // Foydalanuvchilar soni
  getUserCount: () => db.prepare('SELECT COUNT(*) as c FROM users WHERE is_banned = 0').get().c,

  // Bugungi yangi foydalanuvchilar
  getTodayCount: () => db.prepare(
    "SELECT COUNT(*) as c FROM users WHERE date(joined_at) = date('now') AND is_banned = 0"
  ).get().c,

  // Faol foydalanuvchilar (oxirgi 24 soat)
  getActiveCount: () => db.prepare(
    "SELECT COUNT(*) as c FROM users WHERE last_active > datetime('now', '-24 hours') AND is_banned = 0"
  ).get().c,

  // Bloklash (bot tomonidan)
  blockUser: (id) => db.prepare('UPDATE users SET blocked = 1 WHERE id = ?').run(id),

  // Ban qilish (admin tomonidan)
  banUser: (id) => db.prepare('UPDATE users SET is_banned = 1 WHERE id = ?').run(id),

  // Bandan chiqarish
  unbanUser: (id) => db.prepare('UPDATE users SET is_banned = 0 WHERE id = ?').run(id),

  // Foydalanuvchi ban ekanligini tekshirish
  isBanned: (id) => {
    const row = db.prepare('SELECT is_banned FROM users WHERE id = ?').get(id);
    return row ? row.is_banned === 1 : false;
  },

  // Session saqlash (akkaunt ulanganda)
  saveSession: (userId, sessionString, phone) => {
    db.prepare(`
      INSERT INTO sessions (user_id, session_string, phone, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        session_string = excluded.session_string,
        phone = excluded.phone,
        updated_at = datetime('now')
    `).run(userId, sessionString, phone);
    db.prepare('UPDATE users SET sessions_count = sessions_count + 1 WHERE id = ?').run(userId);
  },

  // Session olish
  getSession: (userId) => db.prepare('SELECT * FROM sessions WHERE user_id = ?').get(userId),

  // Sessionni o'chirish
  deleteSession: (userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId),

  // Barcha foydalanuvchilar (admin uchun)
  getAllUsersAdmin: (limit = 20, offset = 0) => db.prepare(
    'SELECT * FROM users ORDER BY joined_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset),

  // Statistika qo'shish
  addStat: (userId, action) => {
    db.prepare('INSERT INTO stats (user_id, action) VALUES (?, ?)').run(userId, action);
  },

  // Umumiy statistika
  getStats: () => ({
    total: db.prepare('SELECT COUNT(*) as c FROM users WHERE is_banned = 0').get().c,
    today: db.prepare("SELECT COUNT(*) as c FROM users WHERE date(joined_at) = date('now') AND is_banned = 0").get().c,
    active: db.prepare("SELECT COUNT(*) as c FROM users WHERE last_active > datetime('now', '-24 hours') AND is_banned = 0").get().c,
    banned: db.prepare('SELECT COUNT(*) as c FROM users WHERE is_banned = 1').get().c,
    sessions: db.prepare('SELECT COUNT(*) as c FROM sessions').get().c,
    totalLeaves: db.prepare("SELECT COUNT(*) as c FROM stats WHERE action = 'leave'").get().c,
  }),
};
