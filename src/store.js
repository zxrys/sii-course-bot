import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, privateDir, writePrivate } from './paths.js';
import { normalizeSnapshot, diffSchedules } from './schedule.js';

export class Store {
  constructor(file = path.join(DATA_DIR, 'course-bot.sqlite')) {
    if (file !== ':memory:') privateDir(path.dirname(file));
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS delivered (key TEXT PRIMARY KEY, sent_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lock (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, until_ms INTEGER NOT NULL);`);
    if (file !== ':memory:') fs.chmodSync(file, 0o600);
  }
  get(key) { const row = this.db.prepare('SELECT value FROM kv WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; }
  set(key, value) { this.db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  hasSent(key) { return Boolean(this.db.prepare('SELECT 1 FROM delivered WHERE key=?').get(key)); }
  markSent(key, now = new Date()) { this.db.prepare('INSERT OR IGNORE INTO delivered VALUES (?,?)').run(key, now.toISOString()); }
  save(raw, archive = true) {
    const schedule = normalizeSnapshot(raw);
    const diff = diffSchedules(this.get('schedule'), schedule);
    if (archive) writePrivate(path.join(DATA_DIR, 'raw-latest.json'), raw);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.set('schedule', schedule);
      this.set('syncError', null);
      this.set('lastDiff', diff);
      // Persist a change notice across restarts until the sender confirms delivery.
      if (diff.added.length || diff.removed.length || diff.updated.length) {
        const pending = this.get('pendingChanges') || [];
        this.set('pendingChanges', [...pending, { at: raw.fetchedAt, diff }]);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { schedule, diff };
  }
  lease(owner, now = Date.now()) {
    this.db.prepare(`INSERT INTO lock VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner, until_ms=excluded.until_ms WHERE lock.until_ms < ? OR lock.owner=?`).run(owner, now + 180_000, now, owner);
    return this.db.prepare('SELECT owner FROM lock WHERE id=1').get()?.owner === owner;
  }
  release(owner) { this.db.prepare('DELETE FROM lock WHERE owner=?').run(owner); }
  close() { this.db.close(); }
}
