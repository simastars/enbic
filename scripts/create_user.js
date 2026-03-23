// scripts/create_user.js
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const [,, username='perso', password='perso123', role='personalization'] = process.argv;
const db = new sqlite3.Database('data/enbic.db');

const hash = bcrypt.hashSync(password, 10);
db.run('INSERT INTO users (username, full_name, password_hash, role) VALUES (?,?,?,?)',
  [username, 'Personalization Officer', hash, role],
  function(err) {
    if (err) { console.error('Error:', err.message); process.exit(1); }
    console.log('Created user', username, 'password', password);
    db.close();
  });