const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = path.join(__dirname, '..', 'data', 'enbic.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('ERROR_OPENING_DB', err.message);
    process.exit(1);
  }
});

db.all('SELECT * FROM arns ORDER BY created_at DESC', [], (err, rows) => {
  if (err) {
    console.error('ERROR_QUERY', err.message);
    db.close();
    process.exit(1);
  }

  console.log(JSON.stringify(rows, null, 2));
  db.close();
});
