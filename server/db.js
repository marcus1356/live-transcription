'use strict';
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT    UNIQUE NOT NULL,
    password_hash TEXT   NOT NULL,
    name         TEXT    NOT NULL,
    plan         TEXT    NOT NULL DEFAULT 'free',
    is_admin     INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS daily_usage (
    user_id      INTEGER NOT NULL,
    date         TEXT    NOT NULL,
    translations INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, date),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

const PLAN_LIMITS = { free: 30, pro: -1, school: -1 };

module.exports = {
  PLAN_LIMITS,

  createUser(email, passwordHash, name) {
    return db.prepare(
      'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?) RETURNING id, email, name, plan, is_admin'
    ).get(email, passwordHash, name);
  },

  getUserByEmail(email) {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  },

  getUserById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },

  getTodayUsage(userId) {
    const today = new Date().toISOString().slice(0, 10);
    return db.prepare('SELECT translations FROM daily_usage WHERE user_id = ? AND date = ?')
      .get(userId, today)?.translations || 0;
  },

  incrementUsage(userId) {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO daily_usage (user_id, date, translations) VALUES (?, ?, 1)
      ON CONFLICT (user_id, date) DO UPDATE SET translations = translations + 1
    `).run(userId, today);
  },

  getAllUsers() {
    return db.prepare(
      'SELECT id, email, name, plan, is_admin, created_at FROM users ORDER BY created_at DESC'
    ).all();
  },

  updateUserPlan(userId, plan) {
    db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, userId);
  },

  setAdmin(userId) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(userId);
  },

  countUsers() {
    return db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  },

  getStats() {
    const today = new Date().toISOString().slice(0, 10);
    return {
      totalUsers: db.prepare('SELECT COUNT(*) as n FROM users').get().n,
      todayTranslations: db.prepare('SELECT COALESCE(SUM(translations),0) as n FROM daily_usage WHERE date = ?').get(today).n,
      totalTranslations: db.prepare('SELECT COALESCE(SUM(translations),0) as n FROM daily_usage').get().n,
      byPlan: db.prepare("SELECT plan, COUNT(*) as n FROM users GROUP BY plan").all(),
    };
  },
};
