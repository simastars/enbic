const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const moment = require('moment');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
const PORT = 3000;
const DB_PATH = path.join(__dirname, 'data', 'enbic.db');
const BACKUP_DIR = path.join(__dirname, 'backups');

// Ensure directories exist
if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}
// Directory to store dispatch notes
const DISPATCH_NOTES_DIR = path.join(__dirname, 'data', 'dispatch_notes');
if (!fs.existsSync(DISPATCH_NOTES_DIR)) {
  fs.mkdirSync(DISPATCH_NOTES_DIR, { recursive: true });
}

// Middleware
app.use(cors());
// Increase payload limits to allow uploading signed/confirmation files as data URLs
app.use(bodyParser.json({ limit: '20mb' }));
app.use(bodyParser.urlencoded({ limit: '20mb', extended: true }));
app.use(express.static('public'));

// Simple session-based auth (suitable for local use). For production, replace store.
app.use(session({
  secret: process.env.SESSION_SECRET || 'enbic-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Initialize database
const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
    // Generate reminders immediately on startup and schedule daily generation
    generateRemindersInDB((err) => {
      if (err) console.error('Error generating reminders on startup:', err);
      else console.log('Initial reminders generated');
    });
    setInterval(() => generateRemindersInDB(), 24 * 60 * 60 * 1000);
  }
});

// ensure dispatch_batches table has optional batch_arn column for single-ARN batches
db.serialize(() => {
  db.all(`PRAGMA table_info(dispatch_batches)`, [], (err, cols) => {
    if (!err && cols) {
      const names = cols.map(c => c.name);
      if (!names.includes('batch_arn')) {
        console.log('Adding batch_arn column to dispatch_batches...');
        db.run(`ALTER TABLE dispatch_batches ADD COLUMN batch_arn TEXT`, (alterErr) => {
          if (alterErr) console.warn('Could not add batch_arn column:', alterErr.message);
        });
      }
    }
  });
});

// Initialize database schema
function initializeDatabase() {
  db.serialize(() => {
    // States table
    db.run(`CREATE TABLE IF NOT EXISTS states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // ARNs table
    db.run(`CREATE TABLE IF NOT EXISTS arns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      arn TEXT UNIQUE NOT NULL,
      name TEXT,
      state TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Awaiting Capture',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      captured_at DATETIME,
      submitted_at DATETIME,
      pending_delivery_at DATETIME,
      stored_at DATETIME,
      collected_at DATETIME,
      delivered_at DATETIME,
      notes TEXT,
      FOREIGN KEY (state) REFERENCES states(name)
    )`);

    // Ensure document_number and audit columns exist (for personalization document tracking)
    db.all(`PRAGMA table_info('arns')`, [], (err, cols) => {
      if (err) return console.error('PRAGMA table_info failed', err);
      const colNames = (cols || []).map(c => c.name);
      const migrations = [];
      if (!colNames.includes('document_number')) {
        migrations.push(`ALTER TABLE arns ADD COLUMN document_number TEXT`);
      }
      if (!colNames.includes('document_number_set_by')) {
        migrations.push(`ALTER TABLE arns ADD COLUMN document_number_set_by TEXT`);
      }
      if (!colNames.includes('document_number_set_at')) {
        migrations.push(`ALTER TABLE arns ADD COLUMN document_number_set_at DATETIME`);
      }
      migrations.forEach(sql => {
        try {
          db.run(sql, [], (err2) => {
            if (err2) console.error('Failed to run migration:', sql, err2);
            else console.log('Migration applied:', sql);
          });
        } catch (e) { console.error('Migration error', e); }
      });
    });

    // Delivery history table
    db.run(`CREATE TABLE IF NOT EXISTS delivery_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT NOT NULL,
      delivery_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      arn_count INTEGER NOT NULL,
      operator_notes TEXT
    )`);

    // Audit log table
    db.run(`CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      arn TEXT,
      action TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      operator TEXT DEFAULT 'System'
    )`);

    // Reminders table
    db.run(`CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      arn TEXT NOT NULL,
      reminder_type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      FOREIGN KEY (arn) REFERENCES arns(arn)
    )`);

    // Dispatch batches table (store signatures and file paths for immutable evidence)
    db.run(`CREATE TABLE IF NOT EXISTS dispatch_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT UNIQUE NOT NULL,
      state TEXT NOT NULL,
      card_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      batch_arn TEXT,
      operator_name TEXT,
      operator_signed_at DATETIME,
      officer_name TEXT,
      officer_signed_at DATETIME,
      dispatched_at DATETIME,
      delivered_at DATETIME,
      delivery_note_path TEXT,
      confirmation_note_path TEXT,
      status TEXT DEFAULT 'prepared'
    )`);

    // Users table for authentication and RBAC
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operator',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Seed a default admin user if none exists
    db.get(`SELECT COUNT(*) as cnt FROM users`, [], (err, row) => {
      if (!err && row && row.cnt === 0) {
        const defaultPass = process.env.ADMIN_PW || 'admin123';
        const hash = bcrypt.hashSync(defaultPass, 10);
        db.run(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`, ['admin', hash, 'admin']);
        console.log('Seeded default admin user (username: admin)');
      }
    });

    // Ensure a default store officer user exists
    db.get(`SELECT id FROM users WHERE username = ?`, ['officer'], (err3, urow) => {
      if (!err3 && !urow) {
        const officerPass = process.env.OFFICER_PW || 'officer123';
        const hash2 = bcrypt.hashSync(officerPass, 10);
        db.run(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`, ['officer', hash2, 'officer']);
        console.log('Seeded default store officer user (username: officer)');
      }
    });

    // Inventory: stock movements ledger
    db.run(`CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      qty INTEGER NOT NULL,
      reference TEXT,
      related_request_id INTEGER,
      operator TEXT,
      user_id INTEGER,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    
    // Migration: Add user_id column if it doesn't exist (for existing databases)
    db.all(`PRAGMA table_info(stock_movements)`, [], (err, rows) => {
      if (!err && rows) {
        const hasUserIdColumn = rows.some(col => col.name === 'user_id');
        if (!hasUserIdColumn) {
          console.log('Adding user_id column to stock_movements table...');
          db.run(`ALTER TABLE stock_movements ADD COLUMN user_id INTEGER`, (alterErr) => {
            if (!alterErr) {
              console.log('Successfully added user_id column to stock_movements');
            } else {
              console.warn('Could not add user_id column:', alterErr.message);
            }
          });
        } else {
          console.log('user_id column already exists in stock_movements');
        }
      }
    });

    // Blank card requests from Store Officer
    db.run(`CREATE TABLE IF NOT EXISTS blank_card_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER,
      quantity INTEGER NOT NULL,
      reason TEXT,
      needed_by DATE,
      status TEXT DEFAULT 'pending', -- pending, approved, partially_approved, rejected
      approved_qty INTEGER DEFAULT 0,
      approver_id INTEGER,
      decision_note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME
    )`);

    // Issue notes / handover records (require issuer and receiver signatures)
    db.run(`CREATE TABLE IF NOT EXISTS issue_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER,
      quantity INTEGER NOT NULL,
      issuer_name TEXT,
      issuer_signed_at DATETIME,
      receiver_name TEXT,
      receiver_signed_at DATETIME,
      issue_note_path TEXT,
      status TEXT DEFAULT 'pending_signatures', -- pending_signatures, signed, completed
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Settings (e.g., low stock threshold)
    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);

    // seed default low_stock_threshold if missing
    db.get(`SELECT value FROM settings WHERE key = 'low_stock_threshold'`, [], (err2, r2) => {
      if (!err2 && !r2) {
        db.run(`INSERT INTO settings (key, value) VALUES (?, ?)`, ['low_stock_threshold', '100']);
      }
    });

    console.log('Database initialized');
  });
}

// ensure arns table has optional columns for older DBs
db.serialize(() => {
  db.get(`PRAGMA table_info(arns)`, [], (err, row) => {
    // add stored_at if missing
    db.all(`PRAGMA table_info(arns)`, [], (err2, cols) => {
      if (!err2 && cols) {
        const names = cols.map(c => c.name);
        if (!names.includes('stored_at')) {
          db.run(`ALTER TABLE arns ADD COLUMN stored_at DATETIME`);
        }
        if (!names.includes('collected_at')) {
          db.run(`ALTER TABLE arns ADD COLUMN collected_at DATETIME`);
        }
        if (!names.includes('collected_info')) {
          db.run(`ALTER TABLE arns ADD COLUMN collected_info TEXT`);
        }
        // add optional name column if missing
        if (!names.includes('name')) {
          db.run(`ALTER TABLE arns ADD COLUMN name TEXT`);
        }
        // add delivery note path column if missing
        if (!names.includes('delivery_note_path')) {
          db.run(`ALTER TABLE arns ADD COLUMN delivery_note_path TEXT`);
        }
      }
    });
  });
});

// Generate reminders logic extracted so it can be triggered automatically
function generateRemindersInDB(cb) {
  // Reminders for ARNs awaiting submission
  db.all(`SELECT arn FROM arns WHERE status = 'Awaiting Capture'`, [], (err, rows) => {
    if (err) {
      if (cb) return cb(err);
      return;
    }

    const tasks = [];

    rows.forEach(row => {
      tasks.push(new Promise((resolve) => {
        db.get(`SELECT id FROM reminders WHERE arn = ? AND reminder_type = 'pending_capture' AND resolved_at IS NULL`, [row.arn], (err2, existing) => {
          if (!err2 && !existing) {
            db.run(`INSERT INTO reminders (arn, reminder_type, message) VALUES (?, ?, ?)`, [row.arn, 'pending_capture', `ARN ${row.arn} is still awaiting capture and personalization submission`], () => resolve());
          } else {
            resolve();
          }
        });
      }));
    });

    // After pending-capture reminders, add personalization reminders and state thresholds
    Promise.all(tasks).then(() => {
      db.all(`SELECT arn FROM arns WHERE status = 'Submitted to Personalization'`, [], (err3, rows2) => {
        if (!err3 && rows2 && rows2.length > 0) {
          const tasks2 = rows2.map(r2 => new Promise((resolve) => {
            db.get(`SELECT id FROM reminders WHERE arn = ? AND reminder_type = 'pending_personalization' AND resolved_at IS NULL`, [r2.arn], (err4, existing2) => {
              if (!err4 && !existing2) {
                db.run(`INSERT INTO reminders (arn, reminder_type, message) VALUES (?, ?, ?)`, [r2.arn, 'pending_personalization', `ARN ${r2.arn} has been submitted to personalization — move to pending delivery`], () => resolve());
              } else {
                resolve();
              }
            });
          }));

          Promise.all(tasks2).then(() => {
            // State-level reminders for states with >=3 pending deliveries
            db.all(`SELECT state, COUNT(*) as cnt, MIN(arn) as sample_arn FROM arns WHERE status = 'Pending Delivery' GROUP BY state HAVING cnt >= 3`, [], (err5, rows3) => {
              if (!err5 && rows3 && rows3.length > 0) {
                const tasks3 = rows3.map(r3 => new Promise((resolve) => {
                  db.get(`SELECT id FROM reminders WHERE reminder_type = 'state_delivery_threshold' AND message LIKE ? AND resolved_at IS NULL`, [`%${r3.state}%`], (err6, existing3) => {
                    if (!err6 && !existing3) {
                      const sampleArn = r3.sample_arn || '';
                      const msg = `State ${r3.state} has ${r3.cnt} pending cards — consider scheduling delivery`;
                      db.run(`INSERT INTO reminders (arn, reminder_type, message) VALUES (?, ?, ?)`, [sampleArn, 'state_delivery_threshold', msg], () => resolve());
                    } else {
                      resolve();
                    }
                  });
                }));

                Promise.all(tasks3).then(() => cb ? cb(null) : null);
              } else {
                if (cb) cb(null);
              }
            });
          });
        } else {
          // Even if no personalization rows, still check state-level reminders
          db.all(`SELECT state, COUNT(*) as cnt, MIN(arn) as sample_arn FROM arns WHERE status = 'Pending Delivery' GROUP BY state HAVING cnt >= 3`, [], (err5, rows3) => {
            if (!err5 && rows3 && rows3.length > 0) {
              const tasks3 = rows3.map(r3 => new Promise((resolve) => {
                db.get(`SELECT id FROM reminders WHERE reminder_type = 'state_delivery_threshold' AND message LIKE ? AND resolved_at IS NULL`, [`%${r3.state}%`], (err6, existing3) => {
                  if (!err6 && !existing3) {
                    const sampleArn = r3.sample_arn || '';
                    const msg = `State ${r3.state} has ${r3.cnt} pending cards — consider scheduling delivery`;
                    db.run(`INSERT INTO reminders (arn, reminder_type, message) VALUES (?, ?, ?)`, [sampleArn, 'state_delivery_threshold', msg], () => resolve());
                  } else {
                    resolve();
                  }
                });
              }));

              Promise.all(tasks3).then(() => cb ? cb(null) : null);
            } else {
              if (cb) cb(null);
            }
          });
        }
      });
    });
  });
}

// Auto-backup function
function createBackup() {
  const timestamp = moment().format('YYYY-MM-DD_HH-mm-ss');
  const backupPath = path.join(BACKUP_DIR, `backup_${timestamp}.db`);
  
  fs.copyFile(DB_PATH, backupPath, (err) => {
    if (err) {
      console.error('Backup failed:', err);
    } else {
      console.log(`Backup created: ${backupPath}`);
      // Keep only last 30 backups
      fs.readdir(BACKUP_DIR, (err, files) => {
        if (!err && files.length > 30) {
          files.sort().slice(0, files.length - 30).forEach(file => {
            fs.unlink(path.join(BACKUP_DIR, file), () => {});
          });
        }
      });
    }
  });
}

// Create backup every 6 hours
setInterval(createBackup, 6 * 60 * 60 * 1000);
createBackup(); // Initial backup

// Helper: Log audit trail
function logAudit(arn, action, oldValue, newValue) {
  db.run(
    `INSERT INTO audit_log (arn, action, old_value, new_value) VALUES (?, ?, ?, ?)`,
    [arn, action, oldValue, newValue]
  );
}

// Helper: save data URL (data:<mime>;base64,...) to file and return path
function saveDataUrlToFile(dataUrl, prefix) {
  try {
    const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!match) return null;
    const mime = match[1];
    const base64 = match[2];
    const ext = mime.split('/')[1] || 'bin';
    const filename = `${prefix}_${Date.now()}.${ext}`;
    const filePath = path.join(DISPATCH_NOTES_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return filePath;
  } catch (e) {
    console.error('Failed to save data URL to file', e);
    return null;
  }
}

// Helper: Validate status transition
function isValidStatusTransition(currentStatus, newStatus) {
  const validTransitions = {
    'Awaiting Capture': ['Submitted to Personalization'],
    'Submitted to Personalization': ['Pending Delivery'],
    'Pending Delivery': ['Delivered','Collected at SHQ'],
    'Collected at SHQ': [],
    'Stored': ['Pending Delivery'],
    'Delivered': [] // Final state
  };
  return validTransitions[currentStatus]?.includes(newStatus) || false;
}

// --- Authentication & RBAC helpers ---
function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Authentication required' });
}

function requireRole(roles) {
  return function(req, res, next) {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Authentication required' });
    const userRole = req.session.user.role;
    if (Array.isArray(roles)) {
      if (roles.includes(userRole) || userRole === 'admin') return next();
    } else {
      if (userRole === roles || userRole === 'admin') return next();
    }
    return res.status(403).json({ error: 'Forbidden: insufficient role' });
  };
}

// Auth endpoints
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  db.get(`SELECT id, username, password_hash, role FROM users WHERE username = ?`, [username], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    bcrypt.compare(password, user.password_hash, (err2, ok) => {
      if (err2) return res.status(500).json({ error: err2.message });
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
      // success
      req.session.user = { id: user.id, username: user.username, role: user.role };
      res.json({ success: true, user: req.session.user });
    });
  });
});

app.post('/api/auth/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  } else {
    res.json({ success: true });
  }
});

app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.user) return res.json({ user: req.session.user });
  res.json({ user: null });
});

// end auth helpers

// API Routes

// Inventory helpers
function getCurrentStock(cb, userId = null) {
  let query = `SELECT SUM(qty) as total FROM stock_movements`;
  let params = [];
  
  // If userId is 'central' or null, get central/admin stock (WHERE user_id IS NULL)
  // If userId is a number (officer id), get ONLY that officer's stock (WHERE user_id = ?)
  if (userId === 'central' || userId === null) {
    query += ` WHERE user_id IS NULL`;
  } else if (userId) {
    query += ` WHERE user_id = ?`;
    params.push(userId);
  }
  
  db.get(query, params, (err, row) => {
    if (err) return cb(err);
    const total = row && row.total ? Number(row.total) : 0;
    cb(null, total);
  });
}

function getSetting(key, cb) {
  db.get(`SELECT value FROM settings WHERE key = ?`, [key], (err, row) => {
    if (err) return cb(err);
    cb(null, row ? row.value : null);
  });
}

// Require low stock check helper
function checkLowStock(cb) {
  getSetting('low_stock_threshold', (err, val) => {
    if (err) return cb(err);
    const threshold = val ? Number(val) : 0;
    getCurrentStock((err2, total) => {
      if (err2) return cb(err2);
      cb(null, { total, threshold, low: total < threshold });
    });
  });
}


// Get all ARNs with filters
app.get('/api/arns', (req, res) => {
  const { state, status, search } = req.query;
  let query = 'SELECT * FROM arns WHERE 1=1';
  const params = [];

  if (state) {
    query += ' AND state = ?';
    params.push(state);
  }
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (search) {
    query += ' AND arn LIKE ?';
    params.push(`%${search}%`);
  }

  query += ' ORDER BY created_at DESC';

  db.all(query, params, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

// Receive personalized ARNs into store (batch)
app.post('/api/arns/receive', requireRole(['officer','admin','operator']), (req, res) => {
  const { arns, state } = req.body;
  if (!Array.isArray(arns) || arns.length === 0) return res.status(400).json({ error: 'arns array required' });

  const results = [];
  const tasks = arns.map(a => new Promise((resolve) => {
    const arn = (a || '').trim();
    if (!arn) return resolve({ arn, success: false, message: 'Empty ARN' });
    db.get(`SELECT * FROM arns WHERE arn = ?`, [arn], (err, row) => {
      if (err) return resolve({ arn, success: false, message: err.message });
      if (!row) return resolve({ arn, success: false, message: 'ARN not found' });
      // Only allow if submitted to personalization (or other states as needed)
      if (row.status !== 'Submitted to Personalization' && row.status !== 'Awaiting Capture') {
        // allow update if already Pending Delivery? skip
      }
      const newState = state || row.state;
      db.run(`UPDATE arns SET status = 'Pending Delivery', state = ?, pending_delivery_at = CURRENT_TIMESTAMP, stored_at = CURRENT_TIMESTAMP WHERE arn = ?`, [newState, arn], function(err2) {
        if (err2) return resolve({ arn, success: false, message: err2.message });
        logAudit(arn, 'RECEIVED_IN_STORE', row.status, 'Pending Delivery');
        resolve({ arn, success: true });
      });
    });
  }));

  Promise.all(tasks).then(resultsArr => {
    res.json({ success: true, results: resultsArr });
  });
});

// Record SHQ pickup for one or many ARNs
app.post('/api/arns/pickup', requireRole(['officer','admin','operator']), (req, res) => {
  const { arns, collector_name, collector_id, phone } = req.body;
  if (!Array.isArray(arns) || arns.length === 0) return res.status(400).json({ error: 'arns array required' });
  if (!collector_name && !collector_id && !phone) return res.status(400).json({ error: 'collector info required' });

  const results = [];
  const tasks = arns.map(a => new Promise((resolve) => {
    const arn = (a || '').trim();
    if (!arn) return resolve({ arn, success: false, message: 'Empty ARN' });
    db.get(`SELECT * FROM arns WHERE arn = ?`, [arn], (err, row) => {
      if (err) return resolve({ arn, success: false, message: err.message });
      if (!row) return resolve({ arn, success: false, message: 'ARN not found' });
      // Only allow pickup if Pending Delivery
      if (row.status !== 'Pending Delivery') return resolve({ arn, success: false, message: `Invalid status (${row.status})` });
      const info = JSON.stringify({ collector_name, collector_id, phone });
      db.run(`UPDATE arns SET status = 'Collected at SHQ', collected_at = CURRENT_TIMESTAMP, collected_info = ? WHERE arn = ?`, [info, arn], function(err2) {
        if (err2) return resolve({ arn, success: false, message: err2.message });
        logAudit(arn, 'PICKED_UP_SHQ', row.status, `Collected by ${collector_name||collector_id||phone}`);
        resolve({ arn, success: true });
      });
    });
  }));

  Promise.all(tasks).then(resultsArr => {
    res.json({ success: true, results: resultsArr });
  });
});

// Inventory endpoints
// Receive blank cards into store (Store Officer)
app.post('/api/inventory/receive', requireRole(['officer','operator','admin']), (req, res) => {
  const { qty, reference, notes } = req.body;
  if (!qty || Number(qty) <= 0) return res.status(400).json({ error: 'Quantity required and must be > 0' });
  const q = Number(qty);
  const userId = req.session.user ? req.session.user.id : null;
  const userRole = req.session.user ? req.session.user.role : null;
  
  // If officer is receiving, add to their inventory; if admin, add to central
  const ownerUserId = userRole === 'officer' ? userId : null;
  
  db.run(`INSERT INTO stock_movements (type, qty, reference, operator, user_id, notes) VALUES (?, ?, ?, ?, ?, ?)`, ['received', q, reference || '', req.session.user ? req.session.user.username : 'unknown', ownerUserId, notes || ''], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    logAudit(null, 'INVENTORY_RECEIVE', null, `+${q} (${reference || ''})`);
    res.json({ success: true, id: this.lastID });
  });
});

// Get current balance
app.get('/api/inventory/balance', requireRole(['officer','admin']), (req, res) => {
  const userId = req.session.user ? req.session.user.id : null;
  const userRole = req.session.user ? req.session.user.role : null;
  
  // Officers see only their own inventory
  if (userRole === 'officer') {
    getCurrentStock((err, officerBalance) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ 
        total: officerBalance
      });
    }, userId);
  } else {
    // Admins see central inventory and all officer inventories
    getCurrentStock((err, centralBalance) => {
      if (err) return res.status(500).json({ error: err.message });
      
      // Get all officer inventories
      db.all(`SELECT u.id, u.username, COALESCE(SUM(sm.qty), 0) as balance FROM users u LEFT JOIN stock_movements sm ON u.id = sm.user_id WHERE u.role = 'officer' GROUP BY u.id`, [], (err2, officers) => {
        if (err2) {
          console.error('Error fetching officer balances:', err2.message);
          // Still return central balance even if officer fetch fails
          return res.json({ 
            central_stock: centralBalance,
            officer_stocks: []
          });
        }
        
        res.json({ 
          central_stock: centralBalance,
          total: centralBalance,
          officer_stocks: officers || []
        });
      });
    }, 'central');
  }
});

// Get ledger (movements)
app.get('/api/inventory/ledger', requireRole(['officer','admin']), (req, res) => {
  const { page = 1, page_size = 100 } = req.query;
  const limit = Math.min(Number(page_size) || 100, 1000);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  
  const userRole = req.session.user ? req.session.user.role : null;
  const userId = req.session.user ? req.session.user.id : null;
  
  let query = `SELECT * FROM stock_movements`;
  let params = [];
  
  // Officers only see their own movements (where user_id = their id)
  if (userRole === 'officer') {
    query += ` WHERE user_id = ?`;
    params.push(userId);
  }
  // Admins see all movements (central + all officers)
  
  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Adjustments / damaged / lost
app.post('/api/inventory/adjust', requireRole(['officer','admin','operator']), (req, res) => {
  const { qty, type, reference, notes } = req.body; // qty positive or negative depending on adjustment
  if (!qty || Number(qty) === 0) return res.status(400).json({ error: 'Quantity required and cannot be zero' });
  const q = Number(qty);
  const allowed = ['adjustment','damaged','lost'];
  if (!type || !allowed.includes(type)) return res.status(400).json({ error: 'Invalid adjustment type' });
  const userId = req.session.user ? req.session.user.id : null;
  const userRole = req.session.user ? req.session.user.role : null;
  const ownerUserId = userRole === 'officer' ? userId : null;
  // store negative qty for damaged/lost/issued types
  db.run(`INSERT INTO stock_movements (type, qty, reference, operator, user_id, notes) VALUES (?, ?, ?, ?, ?, ?)`, [type, q, reference || '', req.session.user ? req.session.user.username : 'unknown', ownerUserId, notes || ''], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    logAudit(null, 'INVENTORY_ADJUST', null, `${type} ${q}`);
    res.json({ success: true, id: this.lastID });
  });
});

// Low-stock status
app.get('/api/inventory/low-stock', requireRole(['officer','admin']), (req, res) => {
  checkLowStock((err, info) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(info);
  });
});

// Create blank card request (Store Officer)
app.post('/api/inventory/requests', requireRole(['officer','admin']), (req, res) => {
  const { quantity, reason, needed_by } = req.body;
  if (!quantity || Number(quantity) <= 0) return res.status(400).json({ error: 'Quantity required' });
  const q = Number(quantity);
  const requester_id = req.session.user ? req.session.user.id : null;
  db.run(`INSERT INTO blank_card_requests (requester_id, quantity, reason, needed_by) VALUES (?, ?, ?, ?)`, [requester_id, q, reason || '', needed_by || null], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    logAudit(null, 'REQUEST_CREATED', null, `Request ${this.lastID} qty ${q}`);
    res.json({ success: true, id: this.lastID });
  });
});

// List requests - officer sees only own, admin/operator see all
app.get('/api/inventory/requests', requireLogin, (req, res) => {
  const userRole = req.session.user ? req.session.user.role : null;
  const userId = req.session.user ? req.session.user.id : null;
  
  let query = `SELECT r.*, u.username as requester FROM blank_card_requests r LEFT JOIN users u ON r.requester_id = u.id`;
  let params = [];
  
  // Officer can only see their own requests
  if (userRole === 'officer') {
    query += ` WHERE r.requester_id = ?`;
    params.push(userId);
  }
  // Admin and operator see all requests
  
  query += ` ORDER BY r.created_at DESC`;
  
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Approve or reject request (Admin/Operator)
app.post('/api/inventory/requests/:id/decide', requireRole(['operator','admin']), (req, res) => {
  const id = req.params.id;
  const { action, approved_qty, decision_note } = req.body; // action: approve|partial|reject
  if (!action || !['approve','partial','reject'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  db.get(`SELECT * FROM blank_card_requests WHERE id = ?`, [id], (err, reqRow) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!reqRow) return res.status(404).json({ error: 'Request not found' });
    const approver_id = req.session.user ? req.session.user.id : null;
    let status = 'rejected';
    let approved = 0;
    if (action === 'approve') { status = 'approved'; approved = reqRow.quantity; }
    if (action === 'partial') { status = 'partially_approved'; approved = Number(approved_qty) || 0; }
    if (action === 'reject') { status = 'rejected'; approved = 0; }

    // If approving, check central stock availability
    if ((action === 'approve' || action === 'partial') && approved > 0) {
      getCurrentStock((err_stock, centralStock) => {
        if (err_stock) return res.status(500).json({ error: 'Failed to check inventory' });
        
        // Check if we have enough central stock
        if (centralStock < approved) {
          return res.status(400).json({ error: `Insufficient central stock. Available: ${centralStock}, Requested: ${approved}` });
        }
        
        // Proceed with approval
        proceedWithApproval();
      }, 'central');
    } else {
      // For rejections, proceed without stock check
      proceedWithApproval();
    }
    
    function proceedWithApproval() {
      db.run(`UPDATE blank_card_requests SET status = ?, approved_qty = ?, approver_id = ?, decision_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [status, approved, approver_id, decision_note || '', id], function(err2) {
        if (err2) return res.status(500).json({ error: err2.message });
        logAudit(null, 'REQUEST_DECIDED', reqRow.status, `${status} qty ${approved}`);
        
        // If approved (full or partial), create TWO stock movements:
        // 1. Deduct from central/admin inventory (user_id = NULL)
        // 2. Add to officer's inventory (user_id = requester_id)
        if ((action === 'approve' || action === 'partial') && approved > 0) {
          const requesterUserId = reqRow.requester_id;
          
          // Movement 1: Deduct from central inventory
          db.run(
            `INSERT INTO stock_movements (type, qty, reference, operator, user_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            ['issued', -approved, `Blank Card Request #${id}`, approver_id, null, `Approved blank card request for officer #${requesterUserId}`],
            (err3) => {
              if (err3) {
                console.error('Error creating central stock movement:', err3.message);
                return res.status(500).json({ error: 'Failed to update inventory' });
              }
              
              // Movement 2: Add to officer's inventory
              db.run(
                `INSERT INTO stock_movements (type, qty, reference, operator, user_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                ['received', approved, `Blank Card Request #${id}`, approver_id, requesterUserId, `Received from blank card request approval`],
                (err4) => {
                  if (err4) {
                    console.error('Error creating officer stock movement:', err4.message);
                    return res.status(500).json({ error: 'Failed to update officer inventory' });
                  }
                  res.json({ success: true, status, approved_qty: approved });
                }
              );
            }
          );
        } else {
          res.json({ success: true, status, approved_qty: approved });
        }
      });
    }
  });
});

// Generate Issue Note for an approved request
app.post('/api/inventory/requests/:id/generate-issue', requireRole(['operator','admin']), (req, res) => {
  const id = req.params.id;
  db.get(`SELECT * FROM blank_card_requests WHERE id = ?`, [id], (err, rrow) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!rrow) return res.status(404).json({ error: 'Request not found' });
    if (!['approved','partially_approved'].includes(rrow.status) && rrow.approved_qty <= 0) return res.status(400).json({ error: 'Request not approved' });
    const qty = rrow.approved_qty || rrow.quantity;
    db.run(`INSERT INTO issue_notes (request_id, quantity) VALUES (?, ?)`, [id, qty], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ success: true, issue_id: this.lastID, quantity: qty });
    });
  });
});

// Sign issue note (issuer or receiver) and optionally upload note file
app.post('/api/inventory/issue/:issueId/sign', requireLogin, (req, res) => {
  const issueId = req.params.issueId;
  const { signer, name, fileData } = req.body; // signer: 'issuer' or 'receiver'
  if (!signer || !name) return res.status(400).json({ error: 'signer and name required' });

  db.get(`SELECT * FROM issue_notes WHERE id = ?`, [issueId], (err, issue) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!issue) return res.status(404).json({ error: 'Issue note not found' });

    const updates = [];
    const params = [];
    if (signer === 'issuer') {
      // only operator/admin can be issuer
      if (!(req.session.user && (req.session.user.role === 'operator' || req.session.user.role === 'admin'))) return res.status(403).json({ error: 'Forbidden' });
      updates.push('issuer_name = ?', 'issuer_signed_at = CURRENT_TIMESTAMP'); params.push(name);
    } else if (signer === 'receiver') {
      // receiver should be store officer
      if (!(req.session.user && (req.session.user.role === 'officer' || req.session.user.role === 'admin'))) return res.status(403).json({ error: 'Forbidden' });
      updates.push('receiver_name = ?', 'receiver_signed_at = CURRENT_TIMESTAMP'); params.push(name);
    } else {
      return res.status(400).json({ error: 'Invalid signer' });
    }

    if (fileData) {
      const saved = saveDataUrlToFile(fileData, `issue_${issueId}`);
      if (saved) { updates.push('issue_note_path = ?'); params.push(saved); }
    }

    params.push(issueId);
    const sql = `UPDATE issue_notes SET ${updates.join(', ')} WHERE id = ?`;
    db.run(sql, params, function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });

      // check if both signed now
      db.get(`SELECT * FROM issue_notes WHERE id = ?`, [issueId], (err3, uissue) => {
        if (!err3 && uissue && uissue.issuer_name && uissue.receiver_name && uissue.status !== 'completed') {
          // mark completed and add qty to stock_movements (store receives the approved qty)
          db.run(`UPDATE issue_notes SET status = 'completed' WHERE id = ?`, [issueId]);
          const issueUserId = uissue.requester_id || null;
          db.run(`INSERT INTO stock_movements (type, qty, reference, related_request_id, operator, user_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`, ['received_from_issue', uissue.quantity, `issue_${issueId}`, uissue.request_id, req.session.user ? req.session.user.username : 'system', issueUserId, 'Received via issue note'], function(err4) {
            if (err4) console.error('Error adding stock from issue:', err4);
            // update request status if needed
            db.run(`UPDATE blank_card_requests SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [uissue.request_id]);
          });
        }
      });

      res.json({ success: true });
    });
  });
});

// Issue blank cards to personalization (Store -> Perso). Reduces stock immediately.
app.post('/api/inventory/issue-to-perso', requireRole(['officer','admin']), (req, res) => {
  const { qty, issued_to, reference, notes } = req.body;
  if (!qty || Number(qty) <= 0) return res.status(400).json({ error: 'Quantity required' });
  const q = Number(qty);
  
  const userId = req.session.user ? req.session.user.id : null;
  const userRole = req.session.user ? req.session.user.role : null;
  
  // Get the appropriate balance to check
  const checkUserId = userRole === 'officer' ? userId : 'central';
  
  getCurrentStock((err, total) => {
    if (err) return res.status(500).json({ error: err.message });
    if (total < q) return res.status(400).json({ error: 'Insufficient stock' });
    
    // Determine which user_id to deduct from
    const deductUserId = userRole === 'officer' ? userId : null;
    
    // record movement as negative qty
    db.run(`INSERT INTO stock_movements (type, qty, reference, operator, user_id, notes) VALUES (?, ?, ?, ?, ?, ?)`, ['issued', -q, reference || issued_to || '', req.session.user ? req.session.user.username : 'unknown', deductUserId, notes || 'Issued to personalization'], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      logAudit(null, 'INVENTORY_ISSUED', null, `-${q} to ${issued_to || reference || ''}`);
      res.json({ success: true, id: this.lastID });
    });
  }, checkUserId);
});

// Reconciliation view: opening + received - issued - damaged/lost = expected
app.get('/api/inventory/reconciliation', requireRole(['officer','operator','admin','supervisor']), (req, res) => {
  const { date_from, date_to } = req.query;
  // For simplicity, compute sums over the period
  const params = [];
  let where = '1=1';
  if (date_from) { where += ' AND date(created_at) >= date(?)'; params.push(date_from); }
  if (date_to) { where += ' AND date(created_at) <= date(?)'; params.push(date_to); }

  const sql = `SELECT type, SUM(qty) as total FROM stock_movements WHERE ${where} GROUP BY type`;
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const map = {};
    rows.forEach(r => { map[r.type] = Number(r.total || 0); });
    // opening stock is cumulative before date_from
    if (date_from) {
      db.get(`SELECT SUM(qty) as opening FROM stock_movements WHERE date(created_at) < date(?)`, [date_from], (err2, orow) => {
        if (err2) return res.status(500).json({ error: err2.message });
        const opening = Number(orow && orow.opening ? orow.opening : 0);
        const received = Number(map.received || 0) + Number(map.received_from_issue || 0) + Number(map.received_from_issue || 0);
        const issued = Math.abs(Number(map.issued || 0));
        const damaged = Math.abs(Number(map.damaged || 0));
        const lost = Math.abs(Number(map.lost || 0));
        const adjustments = Number(map.adjustment || 0);
        const expected = opening + received + adjustments - issued - damaged - lost;
        res.json({ opening, received, issued, damaged, lost, adjustments, expected });
      });
    } else {
      const received = Number(map.received || 0) + Number(map.received_from_issue || 0);
      const issued = Math.abs(Number(map.issued || 0));
      const damaged = Math.abs(Number(map.damaged || 0));
      const lost = Math.abs(Number(map.lost || 0));
      const adjustments = Number(map.adjustment || 0);
      // opening assumed 0 if no date_from
      const opening = 0;
      const expected = opening + received + adjustments - issued - damaged - lost;
      res.json({ opening, received, issued, damaged, lost, adjustments, expected });
    }
  });
});

// List issue notes
app.get('/api/inventory/issue-notes', requireRole(['officer','operator','admin']), (req, res) => {
  db.all(`SELECT i.*, u1.username as requester, u2.username as approver FROM issue_notes i LEFT JOIN users u1 ON i.issuer_name = u1.username LEFT JOIN users u2 ON i.receiver_name = u2.username ORDER BY i.created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Get single ARN
app.get('/api/arns/:arn', (req, res) => {
  db.get('SELECT * FROM arns WHERE arn = ?', [req.params.arn], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else if (!row) {
      res.status(404).json({ error: 'ARN not found' });
    } else {
      res.json(row);
    }
  });
});

// Add new ARN
app.post('/api/arns', requireRole(['operator','admin']), (req, res) => {
  const { arn, state, name } = req.body;

  if (!arn || !state) {
    return res.status(400).json({ error: 'ARN and state are required' });
  }

  db.get('SELECT * FROM arns WHERE arn = ?', [arn], (err, existing) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (existing) {
      return res.status(409).json({ error: 'ARN already exists' });
    }

    db.run(
      `INSERT INTO arns (arn, state, name, status) VALUES (?, ?, ?, 'Awaiting Capture')`,
      [arn, state, name || null],
      function(err) {
        if (err) {
          res.status(500).json({ error: err.message });
        } else {
          logAudit(arn, 'ARN_CREATED', null, `State: ${state}${name ? `, Name: ${name}` : ''}`);
          res.json({ id: this.lastID, arn, state, name: name || null, status: 'Awaiting Capture' });
          // Trigger reminders generation for the newly added ARN (non-blocking)
          try {
            generateRemindersInDB();
          } catch (e) {
            console.error('Error triggering reminders after ARN creation:', e);
          }
        }
      }
    );
  });
});

// Update ARN status
app.put('/api/arns/:arn/status', requireRole(['operator','admin','supervisor']), (req, res) => {
  const { status } = req.body;
  const { arn } = req.params;

  if (!status) {
    return res.status(400).json({ error: 'Status is required' });
  }

  db.get('SELECT * FROM arns WHERE arn = ?', [arn], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'ARN not found' });
    }

    if (!isValidStatusTransition(row.status, status)) {
      return res.status(400).json({ 
        error: `Invalid status transition from ${row.status} to ${status}` 
      });
    }

    const updateFields = ['status = ?'];
    const updateValues = [status];
    const timestampField = {
      'Submitted to Personalization': 'submitted_at',
      'Pending Delivery': 'pending_delivery_at',
      'Delivered': 'delivered_at'
    };

    if (timestampField[status]) {
      updateFields.push(`${timestampField[status]} = CURRENT_TIMESTAMP`);
    }

    db.run(
      `UPDATE arns SET ${updateFields.join(', ')} WHERE arn = ?`,
      [...updateValues, arn],
      function(err) {
        if (err) {
          res.status(500).json({ error: err.message });
        } else {
          logAudit(arn, 'STATUS_UPDATED', row.status, status);
          res.json({ success: true });
          // Refresh reminders after status change (non-blocking)
          try {
            generateRemindersInDB();
          } catch (e) {
            console.error('Error triggering reminders after status update:', e);
          }
        }
      }
    );
  });
});

// Append or update document number for an ARN (store officer or admin)
app.put('/api/arns/:arn/document-number', requireRole(['officer','admin']), (req, res) => {
  const { document_number } = req.body;
  const { arn } = req.params;

  if (!document_number) return res.status(400).json({ error: 'document_number is required' });

  db.get('SELECT * FROM arns WHERE arn = ?', [arn], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'ARN not found' });

    // Only allow setting document number before delivery (Submitted or Pending Delivery)
    if (row.status !== 'Submitted to Personalization' && row.status !== 'Pending Delivery') {
      return res.status(400).json({ error: `Cannot set document number at status ${row.status}` });
    }

    const actor = req.session && req.session.user ? req.session.user.username : null;
    db.run(`UPDATE arns SET document_number = ?, document_number_set_by = ?, document_number_set_at = CURRENT_TIMESTAMP WHERE arn = ?`, [document_number, actor, arn], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      logAudit(arn, 'DOCUMENT_NUMBER_SET', row.status, `document_number=${document_number} by ${actor || 'unknown'}`);
      res.json({ success: true });
    });
  });
});

// Bulk delivery confirmation by state
app.post('/api/delivery/confirm', requireRole(['operator','admin','supervisor']), (req, res) => {
  const { state, notes } = req.body;

  if (!state) {
    return res.status(400).json({ error: 'State is required' });
  }

  db.all('SELECT arn FROM arns WHERE state = ? AND status = ?', 
    [state, 'Pending Delivery'], 
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      const arnCount = rows.length;
      if (arnCount === 0) {
        return res.json({ success: true, message: 'No pending deliveries for this state', count: 0 });
      }

      const arns = rows.map(r => r.arn);
      const placeholders = arns.map(() => '?').join(',');

      db.run(
        `UPDATE arns SET status = 'Delivered', delivered_at = CURRENT_TIMESTAMP WHERE arn IN (${placeholders})`,
        arns,
        function(err) {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          // Log delivery history
          db.run(
            `INSERT INTO delivery_history (state, arn_count, operator_notes) VALUES (?, ?, ?)`,
            [state, arnCount, notes || ''],
            (err) => {
              if (err) {
                console.error('Error logging delivery history:', err);
              }
            }
          );

          // Log audit for each ARN
          arns.forEach(arn => {
            logAudit(arn, 'BULK_DELIVERED', 'Pending Delivery', `Delivered (State: ${state})`);
          });

          res.json({ success: true, count: arnCount });
        }
      );
    }
  );
});

// Dispatch batches: create batch (server-side)
app.post('/api/dispatch/batches', requireRole(['operator','admin']), (req, res) => {
  const { batchId, state, cardCount, batchArn } = req.body;
  if (!batchId || !state) return res.status(400).json({ error: 'batchId and state required' });

  db.run(`INSERT INTO dispatch_batches (batch_id, state, card_count, batch_arn) VALUES (?, ?, ?, ?)`, [batchId, state, cardCount || 0, batchArn || null], function(err) {
    if (err) {
      if (err.message && err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Batch already exists' });
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, id: this.lastID });
  });
});

// List dispatch batches
app.get('/api/dispatch/batches', requireRole(['operator','admin','officer']), (req, res) => {
  db.all(`SELECT * FROM dispatch_batches ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Sign a batch (operator or officer) and optionally upload signed delivery note (data URL)
app.post('/api/dispatch/:batchId/sign', requireLogin, (req, res) => {
  const batchId = req.params.batchId;
  const { signer, name, fileData } = req.body; // signer: 'operator' or 'officer'
  if (!signer || !name) return res.status(400).json({ error: 'signer and name required' });

  // role enforcement: operator-sign must be operator/admin; officer-sign must be officer/admin
  const sessionRole = req.session && req.session.user && req.session.user.role;
  if (signer === 'operator' && !(sessionRole === 'operator' || sessionRole === 'admin')) {
    return res.status(403).json({ error: 'Forbidden: must be operator or admin to sign as operator' });
  }
  if (signer === 'officer' && !(sessionRole === 'officer' || sessionRole === 'admin')) {
    return res.status(403).json({ error: 'Forbidden: must be officer or admin to sign as officer' });
  }

  db.get(`SELECT * FROM dispatch_batches WHERE batch_id = ?`, [batchId], (err, batch) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const updates = [];
    const params = [];

    if (signer === 'operator') {
      updates.push('operator_name = ?', 'operator_signed_at = CURRENT_TIMESTAMP');
      params.push(name);
    } else if (signer === 'officer') {
      updates.push('officer_name = ?', 'officer_signed_at = CURRENT_TIMESTAMP');
      params.push(name);
    } else {
      return res.status(400).json({ error: 'Invalid signer' });
    }

    // handle fileData (data URL)
    if (fileData) {
      const savedPath = saveDataUrlToFile(fileData, `batch_${batchId}`);
      if (savedPath) {
        updates.push('delivery_note_path = ?');
        params.push(savedPath);
      }
    }

    // finalize update
    params.push(batchId);
    const sql = `UPDATE dispatch_batches SET ${updates.join(', ')} WHERE batch_id = ?`;
    db.run(sql, params, function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });

      // if both signatures now present, set status to ready_for_dispatch
      db.get(`SELECT operator_name, officer_name FROM dispatch_batches WHERE batch_id = ?`, [batchId], (err3, updated) => {
        if (!err3 && updated && updated.operator_name && updated.officer_name) {
          db.run(`UPDATE dispatch_batches SET status = 'ready_for_dispatch' WHERE batch_id = ?`, [batchId]);
        }
      });

      res.json({ success: true });
    });
  });
});

// Confirm dispatch (mark dispatched_at)
app.post('/api/dispatch/:batchId/confirm', requireRole(['operator','admin']), (req, res) => {
  const batchId = req.params.batchId;
  db.get(`SELECT * FROM dispatch_batches WHERE batch_id = ?`, [batchId], (err, batch) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    if (!batch.operator_name || !batch.officer_name) return res.status(400).json({ error: 'Both signatures required before dispatch' });

    db.run(`UPDATE dispatch_batches SET dispatched_at = CURRENT_TIMESTAMP, status = 'dispatched' WHERE batch_id = ?`, [batchId], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ success: true });
    });
  });
});

// Upload confirmation note and mark delivered (accepts data URL)
app.post('/api/dispatch/:batchId/confirmation', requireRole(['operator','admin','officer']), (req, res) => {
  const batchId = req.params.batchId;
  const { fileData } = req.body;
  if (!fileData) return res.status(400).json({ error: 'fileData is required' });

  db.get(`SELECT * FROM dispatch_batches WHERE batch_id = ?`, [batchId], (err, batch) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const savedPath = saveDataUrlToFile(fileData, `confirmation_${batchId}`);
    if (!savedPath) return res.status(500).json({ error: 'Failed to save confirmation file' });

    // mark ARNs delivered for this batch (single-ARN batch or state batch)
    if (batch.batch_arn) {
      // single ARN
      const theArn = batch.batch_arn;
      db.get('SELECT * FROM arns WHERE arn = ? AND status = ?', [theArn, 'Pending Delivery'], (err2, row) => {
        if (err2) return res.status(500).json({ error: err2.message });
        const arnCount = row ? 1 : 0;
        if (arnCount > 0) {
          db.run(`UPDATE arns SET status = 'Delivered', delivered_at = CURRENT_TIMESTAMP WHERE arn = ?`, [theArn], function(err3) {
            if (err3) console.error('Error marking ARN delivered:', err3);
          });
          db.run(`INSERT INTO delivery_history (state, arn_count, operator_notes) VALUES (?, ?, ?)`, [batch.state, arnCount, 'Delivered via dispatch confirmation'], (err4) => { if (err4) console.error('Error logging delivery history:', err4); });
        }

        db.run(`UPDATE dispatch_batches SET confirmation_note_path = ?, delivered_at = CURRENT_TIMESTAMP, status = 'delivered' WHERE batch_id = ?`, [savedPath, batchId], function(err5) {
          if (err5) return res.status(500).json({ error: err5.message });
          if (arnCount > 0) logAudit(theArn, 'DELIVERED_VIA_DISPATCH', 'Pending Delivery', `Delivered (Batch: ${batchId})`);
          res.json({ success: true, count: arnCount });
        });
      });
    } else {
      // state-level batch (existing behavior)
      db.all('SELECT arn FROM arns WHERE state = ? AND status = ?', [batch.state, 'Pending Delivery'], (err2, rows) => {
        if (err2) return res.status(500).json({ error: err2.message });
        const arns = rows.map(r => r.arn);
        const arnCount = arns.length;

        if (arnCount > 0) {
          const placeholders = arns.map(() => '?').join(',');
          db.run(`UPDATE arns SET status = 'Delivered', delivered_at = CURRENT_TIMESTAMP WHERE arn IN (${placeholders})`, arns, function(err3) {
            if (err3) console.error('Error marking ARNs delivered:', err3);
          });

          db.run(`INSERT INTO delivery_history (state, arn_count, operator_notes) VALUES (?, ?, ?)`, [batch.state, arnCount, 'Delivered via dispatch confirmation'], (err4) => {
            if (err4) console.error('Error logging delivery history:', err4);
          });
        }

        db.run(`UPDATE dispatch_batches SET confirmation_note_path = ?, delivered_at = CURRENT_TIMESTAMP, status = 'delivered' WHERE batch_id = ?`, [savedPath, batchId], function(err5) {
          if (err5) return res.status(500).json({ error: err5.message });
          // log audit entries
          arns.forEach(a => logAudit(a, 'BULK_DELIVERED_VIA_DISPATCH', 'Pending Delivery', `Delivered (Batch: ${batchId})`));
          res.json({ success: true, count: arnCount });
        });
      });
    }
    });
  }); 

// Generate delivery note for a batch (server-side) and save file
    app.post('/api/dispatch/:batchId/generate-note', requireRole(['operator','admin']), (req, res) => {
      const batchId = req.params.batchId;
      db.get(`SELECT * FROM dispatch_batches WHERE batch_id = ?`, [batchId], (err, batch) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!batch) return res.status(404).json({ error: 'Batch not found' });

        // fetch ARNs for this batch. If batch_arn is set, use that single ARN; else fetch all pending in the state
        const buildHtmlForRows = (rows) => {
          const title = `Delivery Note - ${batch.state}`;
          const signInfo = `Operator: ${batch.operator_name || 'N/A'}\nStore Officer: ${batch.officer_name || 'N/A'}`;
          const rowsHtml = (rows || []).map(a => `<tr><td>${a.arn}</td><td>${a.name || ''}</td><td>${a.state}</td><td>${a.status}</td><td>${a.created_at ? a.created_at : ''}</td></tr>`).join('');
          const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
            <style>body{font-family:Arial,Helvetica,sans-serif;padding:20px}h1{color:#1f3a57}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:8px;border:1px solid #ddd;text-align:left}thead th{background:#f6fbff}</style>
            </head><body>
            <h1>${title}</h1>
            <div><strong>Batch ID:</strong> ${batch.batch_id}</div>
            <div><strong>Created:</strong> ${batch.created_at}</div>
            <div style="margin-top:8px">${signInfo}</div>
            <div style="margin-top:12px"><strong>Card Count:</strong> ${batch.card_count}</div>
            <table><thead><tr><th>ARN</th><th>Name</th><th>State</th><th>Status</th><th>Created</th></tr></thead><tbody>
            ${rowsHtml}
            </tbody></table>
            <div style="margin-top:18px;font-size:12px;color:#666">Generated by ENBIC Tracking System</div>
            </body></html>`;
          return html;
        };

        if (batch.batch_arn) {
          db.get('SELECT arn, name, state, status, created_at FROM arns WHERE arn = ?', [batch.batch_arn], (err2, row) => {
            if (err2) return res.status(500).json({ error: err2.message });
            const html = buildHtmlForRows(row ? [row] : []);
            const filename = `batch_${batchId}_delivery_note_${Date.now()}.html`;
            const filePath = path.join(DISPATCH_NOTES_DIR, filename);
            fs.writeFile(filePath, html, (err3) => {
              if (err3) return res.status(500).json({ error: err3.message });
              db.run(`UPDATE dispatch_batches SET delivery_note_path = ? WHERE batch_id = ?`, [filePath, batchId], function(err4) {
                if (err4) return res.status(500).json({ error: err4.message });
                res.json({ success: true, path: filePath });
              });
            });
          });
        } else {
          db.all('SELECT arn, name, state, status, created_at FROM arns WHERE state = ? AND status = ?', [batch.state, 'Pending Delivery'], (err2, rows) => {
            if (err2) return res.status(500).json({ error: err2.message });
            const html = buildHtmlForRows(rows);
            const filename = `batch_${batchId}_delivery_note_${Date.now()}.html`;
            const filePath = path.join(DISPATCH_NOTES_DIR, filename);
            fs.writeFile(filePath, html, (err3) => {
              if (err3) return res.status(500).json({ error: err3.message });
              db.run(`UPDATE dispatch_batches SET delivery_note_path = ? WHERE batch_id = ?`, [filePath, batchId], function(err4) {
                if (err4) return res.status(500).json({ error: err4.message });
                res.json({ success: true, path: filePath });
              });
            });
          });
        }
      });
    });

  // Serve stored delivery or confirmation files for a batch
  app.get('/api/dispatch/:batchId/file/:which', requireLogin, (req, res) => {
    const { batchId, which } = req.params;
    db.get(`SELECT delivery_note_path, confirmation_note_path FROM dispatch_batches WHERE batch_id = ?`, [batchId], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Batch not found' });
      const filePath = which === 'delivery' ? row.delivery_note_path : row.confirmation_note_path;
      if (!filePath) return res.status(404).json({ error: 'File not found' });
      res.sendFile(filePath);
    });
  });

  // Generate delivery note for a single ARN (server-side) and save file
  app.post('/api/arns/:arn/generate-note', requireRole(['operator','admin']), (req, res) => {
    const arnParam = req.params.arn;
    const force = req.query.force === 'true' || req.body.force === true;

    db.get(`SELECT * FROM arns WHERE arn = ?`, [arnParam], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'ARN not found' });

      if (row.delivery_note_path && !force) {
        return res.status(409).json({ error: 'Delivery note already generated for this ARN' });
      }

      const esc = (s) => (s === null || s === undefined) ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
      const title = `Delivery Note - ${esc(row.state)} - ${esc(arnParam)}`;
      const signInfo = `Generated by ENBIC Tracking System`;
      const nameLine = row.name ? `<div><strong>Name:</strong> ${esc(row.name)}</div>` : '';
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
        <style>body{font-family:Arial,Helvetica,sans-serif;padding:20px}h1{color:#1f3a57}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:8px;border:1px solid #ddd;text-align:left}thead th{background:#f6fbff}</style>
        </head><body>
        <h1>${title}</h1>
        <div><strong>ARN:</strong> ${arnParam}</div>
        ${nameLine}
        <div><strong>State:</strong> ${row.state}</div>
        <div style="margin-top:8px">${signInfo}</div>
        <div style="margin-top:18px;font-size:12px;color:#666">Generated: ${moment().format('YYYY-MM-DD HH:mm:ss')}</div>
        </body></html>`;

      const filename = `delivery_note_${arnParam.replace(/[^a-zA-Z0-9_-]/g, '')}_${Date.now()}.html`;
      const filePath = path.join(DISPATCH_NOTES_DIR, filename);

      fs.writeFile(filePath, html, (err2) => {
        if (err2) return res.status(500).json({ error: 'Failed to save delivery note' });

        db.run(`UPDATE arns SET delivery_note_path = ? WHERE arn = ?`, [filePath, arnParam], function(err3) {
          if (err3) return res.status(500).json({ error: err3.message });
          logAudit(arnParam, 'DELIVERY_NOTE_GENERATED', null, filePath);
          res.json({ success: true, path: filePath });
        });
      });
    });
  });

  // Serve per-ARN delivery note file
  app.get('/api/arns/:arn/delivery-note', requireLogin, (req, res) => {
    const arnParam = req.params.arn;
    db.get(`SELECT delivery_note_path FROM arns WHERE arn = ?`, [arnParam], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'ARN not found' });
      if (!row.delivery_note_path) return res.status(404).json({ error: 'Delivery note not found' });
      res.sendFile(row.delivery_note_path);
    });
  });

// Get reminders
app.get('/api/reminders', requireRole(['operator','admin','supervisor']), (req, res) => {
  const query = `
    SELECT r.*, a.state, a.status, a.name as arn_name
    FROM reminders r
    JOIN arns a ON r.arn = a.arn
    WHERE r.resolved_at IS NULL
    ORDER BY r.created_at DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

// Generate reminders (should be called daily)
app.post('/api/reminders/generate', requireRole(['operator','admin']), (req, res) => {
  generateRemindersInDB((err) => {
    if (err) return res.status(500).json({ error: err.message || String(err) });
    res.json({ success: true, message: 'Reminders generated' });
  });
});

// Resolve reminder
app.post('/api/reminders/:id/resolve', requireRole(['operator','admin']), (req, res) => {
  const reminderId = req.params.id;
  db.get(`SELECT * FROM reminders WHERE id = ?`, [reminderId], (err, reminder) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!reminder) return res.status(404).json({ error: 'Reminder not found' });

    const advanceMap = {
      'pending_capture': 'Submitted to Personalization',
      'pending_personalization': 'Pending Delivery'
    };

    const newStatus = advanceMap[reminder.reminder_type];

    const finalize = (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });
      // Mark reminder resolved
      db.run(`UPDATE reminders SET resolved_at = CURRENT_TIMESTAMP WHERE id = ?`, [reminderId], function(err3) {
        if (err3) return res.status(500).json({ error: err3.message });
        res.json({ success: true });
      });
    };

    if (!newStatus || !reminder.arn) {
      // Nothing to advance for this reminder type or no associated ARN
      return finalize(null);
    }

    // Try to advance ARN status
    db.get(`SELECT * FROM arns WHERE arn = ?`, [reminder.arn], (err4, arnRow) => {
      if (err4) return res.status(500).json({ error: err4.message });
      if (!arnRow) {
        // ARN not found, just resolve reminder
        return finalize(null);
      }

      if (!isValidStatusTransition(arnRow.status, newStatus)) {
        // Invalid transition; still resolve reminder but inform via log
        console.warn(`Invalid status transition for ARN ${reminder.arn}: ${arnRow.status} -> ${newStatus}`);
        return finalize(null);
      }

      const timestampField = {
        'Submitted to Personalization': 'submitted_at',
        'Pending Delivery': 'pending_delivery_at',
        'Delivered': 'delivered_at'
      };

      const updateFields = ['status = ?'];
      if (timestampField[newStatus]) updateFields.push(`${timestampField[newStatus]} = CURRENT_TIMESTAMP`);

      db.run(`UPDATE arns SET ${updateFields.join(', ')} WHERE arn = ?`, [newStatus, reminder.arn], function(err5) {
        if (err5) return res.status(500).json({ error: err5.message });
        logAudit(reminder.arn, 'STATUS_UPDATED_VIA_REMINDER', arnRow.status, newStatus);
        // regenerate reminders asynchronously
        try { generateRemindersInDB(); } catch (e) { console.error('Error regenerating reminders:', e); }
        return finalize(null);
      });
    });
  });
});

// Get delivery statistics by state
app.get('/api/delivery/stats', requireLogin, (req, res) => {
  const query = `
    SELECT 
      state,
      COUNT(*) as pending_count,
      MIN(created_at) as oldest_pending
    FROM arns
    WHERE status = 'Pending Delivery'
    GROUP BY state
    ORDER BY state
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows.map(row => ({
        ...row,
        oldest_pending_age: moment(row.oldest_pending).fromNow()
      })));
    }
  });
});

// Get reports data
app.get('/api/reports/:type', requireRole(['operator','admin','supervisor']), (req, res) => {
  const { type } = req.params;
  const { search, state, date_from, date_to, page = 1, page_size = 50 } = req.query;
  let query = '';
  let params = [];
  const limit = Math.min(Number(page_size) || 50, 1000);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  switch (type) {
    case 'pending-capture':
      query = `SELECT *, julianday('now') - julianday(created_at) as age_days FROM arns WHERE status = 'Awaiting Capture'`;
      if (search) { query += ' AND arn LIKE ?'; params.push(`%${search}%`); }
      if (state) { query += ' AND state = ?'; params.push(state); }
      if (date_from) { query += ' AND date(created_at) >= date(?)'; params.push(date_from); }
      if (date_to) { query += ' AND date(created_at) <= date(?)'; params.push(date_to); }
      query += ` ORDER BY created_at ASC LIMIT ${limit} OFFSET ${offset}`;
      break;
    case 'submitted':
      query = `SELECT * FROM arns WHERE status = 'Submitted to Personalization'`;
      if (search) { query += ' AND arn LIKE ?'; params.push(`%${search}%`); }
      if (state) { query += ' AND state = ?'; params.push(state); }
      if (date_from) { query += ' AND date(submitted_at) >= date(?)'; params.push(date_from); }
      if (date_to) { query += ' AND date(submitted_at) <= date(?)'; params.push(date_to); }
      query += ` ORDER BY submitted_at DESC LIMIT ${limit} OFFSET ${offset}`;
      break;
    case 'pending-delivery':
      query = `SELECT *, julianday('now') - julianday(pending_delivery_at) as age_days FROM arns WHERE status = 'Pending Delivery'`;
      if (search) { query += ' AND arn LIKE ?'; params.push(`%${search}%`); }
      if (state) { query += ' AND state = ?'; params.push(state); }
      if (date_from) { query += ' AND date(pending_delivery_at) >= date(?)'; params.push(date_from); }
      if (date_to) { query += ' AND date(pending_delivery_at) <= date(?)'; params.push(date_to); }
      query += ` ORDER BY state, pending_delivery_at ASC LIMIT ${limit} OFFSET ${offset}`;
      break;
    case 'delivery-history':
      query = `SELECT * FROM delivery_history WHERE 1=1`;
      if (state) { query += ' AND state = ?'; params.push(state); }
      if (date_from) { query += ' AND date(delivery_date) >= date(?)'; params.push(date_from); }
      if (date_to) { query += ' AND date(delivery_date) <= date(?)'; params.push(date_to); }
      query += ` ORDER BY delivery_date DESC LIMIT ${limit} OFFSET ${offset}`;
      break;
    case 'activity-log':
      query = `SELECT * FROM audit_log WHERE 1=1`;
      if (search) { query += ' AND (arn LIKE ? OR action LIKE ? OR old_value LIKE ? OR new_value LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
      if (date_from) { query += ' AND date(timestamp) >= date(?)'; params.push(date_from); }
      if (date_to) { query += ' AND date(timestamp) <= date(?)'; params.push(date_to); }
      query += ` ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`;
      break;
    default:
      return res.status(400).json({ error: 'Invalid report type' });
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

// Export to Excel
app.get('/api/export/excel/:type', requireRole(['operator','admin','supervisor']), async (req, res) => {
  const { type } = req.params;
  
  // Get data based on type
  const data = await new Promise((resolve, reject) => {
    const query = {
      'pending-capture': `SELECT *, 
        julianday('now') - julianday(created_at) as age_days
        FROM arns WHERE status = 'Awaiting Capture' ORDER BY created_at ASC`,
      'submitted': `SELECT * FROM arns WHERE status = 'Submitted to Personalization' ORDER BY submitted_at DESC`,
      'pending-delivery': `SELECT *, 
        julianday('now') - julianday(pending_delivery_at) as age_days
        FROM arns WHERE status = 'Pending Delivery' ORDER BY state, pending_delivery_at ASC`,
      'all': `SELECT * FROM arns ORDER BY created_at DESC`
    }[type] || `SELECT * FROM arns ORDER BY created_at DESC`;

    db.all(query, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Report');

  if (data.length > 0) {
    worksheet.columns = Object.keys(data[0]).map(key => ({
      header: key.replace(/_/g, ' ').toUpperCase(),
      key: key,
      width: 20
    }));

    data.forEach(row => {
      worksheet.addRow(row);
    });
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=enbic_report_${type}_${moment().format('YYYY-MM-DD')}.xlsx`);

  await workbook.xlsx.write(res);
  res.end();
});

// Export to PDF
app.get('/api/export/pdf/:type', requireRole(['operator','admin','supervisor']), (req, res) => {
  const { type } = req.params;
  
  db.all(`SELECT * FROM arns WHERE status = ?`, 
    type === 'pending-capture' ? ['Awaiting Capture'] :
    type === 'submitted' ? ['Submitted to Personalization'] :
    type === 'pending-delivery' ? ['Pending Delivery'] : ['%'],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      const doc = new PDFDocument();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=enbic_report_${type}_${moment().format('YYYY-MM-DD')}.pdf`);
      
      doc.pipe(res);
      doc.fontSize(20).text('ENBIC Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Report Type: ${type}`, { align: 'center' });
      doc.text(`Generated: ${moment().format('YYYY-MM-DD HH:mm:ss')}`, { align: 'center' });
      doc.moveDown();

      if (rows.length === 0) {
        doc.text('No records found.');
      } else {
        doc.fontSize(10);
        rows.forEach((row, index) => {
          doc.text(`${index + 1}. ARN: ${row.arn} | State: ${row.state} | Status: ${row.status}`);
          doc.moveDown(0.5);
        });
      }

      doc.end();
    }
  );
});

// Get states list
app.get('/api/states', requireLogin, (req, res) => {
  db.all('SELECT * FROM states ORDER BY name', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

// Add new state
app.post('/api/states', requireRole(['admin','operator']), (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'State name is required' });
  }

  const stateName = name.trim();

  db.run(
    `INSERT INTO states (name) VALUES (?)`,
    [stateName],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          res.status(409).json({ error: 'State already exists' });
        } else {
          res.status(500).json({ error: err.message });
        }
      } else {
        logAudit(null, 'STATE_CREATED', null, `State: ${stateName}`);
        res.json({ id: this.lastID, name: stateName });
      }
    }
  );
});

// Delete state
app.delete('/api/states/:id', requireRole(['admin','operator']), (req, res) => {
  const { id } = req.params;

  db.get('SELECT name FROM states WHERE id = ?', [id], (err, state) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!state) {
      return res.status(404).json({ error: 'State not found' });
    }

    db.get('SELECT COUNT(*) as count FROM arns WHERE state = ?', [state.name], (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (row.count > 0) {
        return res.status(400).json({ 
          error: `Cannot delete state "${state.name}" - it has ${row.count} associated ARN(s)` 
        });
      }

      db.run('DELETE FROM states WHERE id = ?', [id], function(err) {
        if (err) {
          res.status(500).json({ error: err.message });
        } else {
          logAudit(null, 'STATE_DELETED', state.name, null);
          res.json({ success: true, message: `State "${state.name}" deleted` });
        }
      });
    });
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`ENBIC Tracking System running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});
