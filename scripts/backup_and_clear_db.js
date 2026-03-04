const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'enbic.db');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(BACKUP_DIR, `enbic-backup-${ts}.db`);

try {
  fs.copyFileSync(DB_PATH, backupFile);
  console.log('Database file backed up to', backupFile);
} catch (e) {
  console.error('Failed to copy DB file:', e.message);
  process.exit(1);
}

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error('Error opening DB:', err.message);
    process.exit(1);
  }
});

db.serialize(() => {
  db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`, [], (err, rows) => {
    if (err) {
      console.error('Failed to list tables:', err.message);
      db.close();
      process.exit(1);
    }

    const tableNames = (rows || []).map(r => r.name).filter(n => n !== 'users');
    if (tableNames.length === 0) {
      console.log('No non-users tables found to clear. Running VACUUM.');
      db.run('VACUUM', [], () => { db.close(); console.log('VACUUM complete'); });
      return;
    }

    let remaining = tableNames.length;
    tableNames.forEach(table => {
      db.all(`SELECT * FROM ${table}`, [], (err2, data) => {
        if (err2) {
          console.warn(`Could not export table ${table}:`, err2.message);
        } else {
          try {
            fs.writeFileSync(path.join(BACKUP_DIR, `${table}-${ts}.json`), JSON.stringify(data, null, 2));
            console.log(`Exported ${table} -> ${path.join(BACKUP_DIR, `${table}-${ts}.json`)}`);
          } catch (e) {
            console.warn('Failed to write export for', table, e.message);
          }
        }

        db.run(`DELETE FROM ${table}`, [], (err3) => {
          if (err3) console.error(`Failed to clear table ${table}:`, err3.message);
          else console.log(`Cleared table ${table}`);

          remaining -= 1;
          if (remaining === 0) {
            db.run('VACUUM', [], (vErr) => {
              if (vErr) console.warn('VACUUM failed:', vErr.message);
              db.close();
              console.log('Backup-and-clear complete. Preserved `users` table.');
            });
          }
        });
      });
    });
  });
});
