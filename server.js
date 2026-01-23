const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const moment = require('moment');

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

// Initialize database
const db = new sqlite3.Database(DB_PATH, (err) => {
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
      state TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Awaiting Capture',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      captured_at DATETIME,
      submitted_at DATETIME,
      pending_delivery_at DATETIME,
      delivered_at DATETIME,
      notes TEXT,
      FOREIGN KEY (state) REFERENCES states(name)
    )`);

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

    console.log('Database initialized');
  });
}

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
    'Pending Delivery': ['Delivered'],
    'Delivered': [] // Final state
  };
  return validTransitions[currentStatus]?.includes(newStatus) || false;
}

// API Routes

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
app.post('/api/arns', (req, res) => {
  const { arn, state } = req.body;

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
      `INSERT INTO arns (arn, state, status) VALUES (?, ?, 'Awaiting Capture')`,
      [arn, state],
      function(err) {
        if (err) {
          res.status(500).json({ error: err.message });
        } else {
          logAudit(arn, 'ARN_CREATED', null, `State: ${state}`);
          res.json({ id: this.lastID, arn, state, status: 'Awaiting Capture' });
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
app.put('/api/arns/:arn/status', (req, res) => {
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

// Bulk delivery confirmation by state
app.post('/api/delivery/confirm', (req, res) => {
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
app.post('/api/dispatch/batches', (req, res) => {
  const { batchId, state, cardCount } = req.body;
  if (!batchId || !state) return res.status(400).json({ error: 'batchId and state required' });

  db.run(`INSERT INTO dispatch_batches (batch_id, state, card_count) VALUES (?, ?, ?)`, [batchId, state, cardCount || 0], function(err) {
    if (err) {
      if (err.message && err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Batch already exists' });
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, id: this.lastID });
  });
});

// List dispatch batches
app.get('/api/dispatch/batches', (req, res) => {
  db.all(`SELECT * FROM dispatch_batches ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Sign a batch (operator or officer) and optionally upload signed delivery note (data URL)
app.post('/api/dispatch/:batchId/sign', (req, res) => {
  const batchId = req.params.batchId;
  const { signer, name, fileData } = req.body; // signer: 'operator' or 'officer'
  if (!signer || !name) return res.status(400).json({ error: 'signer and name required' });

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
app.post('/api/dispatch/:batchId/confirm', (req, res) => {
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
app.post('/api/dispatch/:batchId/confirmation', (req, res) => {
  const batchId = req.params.batchId;
  const { fileData } = req.body;
  if (!fileData) return res.status(400).json({ error: 'fileData is required' });

  db.get(`SELECT * FROM dispatch_batches WHERE batch_id = ?`, [batchId], (err, batch) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const savedPath = saveDataUrlToFile(fileData, `confirmation_${batchId}`);
    if (!savedPath) return res.status(500).json({ error: 'Failed to save confirmation file' });

    // mark ARNs delivered for the state and log delivery history
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
  });

  // Generate delivery note for a batch (server-side) and save file
  app.post('/api/dispatch/:batchId/generate-note', (req, res) => {
    const batchId = req.params.batchId;
    db.get(`SELECT * FROM dispatch_batches WHERE batch_id = ?`, [batchId], (err, batch) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!batch) return res.status(404).json({ error: 'Batch not found' });

      // fetch ARNs for the state that are pending delivery
      db.all('SELECT arn, state, status, created_at FROM arns WHERE state = ? AND status = ?', [batch.state, 'Pending Delivery'], (err2, rows) => {
        if (err2) return res.status(500).json({ error: err2.message });

        const title = `Delivery Note - ${batch.state}`;
        const signInfo = `Operator: ${batch.operator_name || 'N/A'}\nStore Officer: ${batch.officer_name || 'N/A'}`;
        const rowsHtml = (rows || []).map(a => `<tr><td>${a.arn}</td><td>${a.state}</td><td>${a.status}</td><td>${a.created_at ? a.created_at : ''}</td></tr>`).join('');
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
          <style>body{font-family:Arial,Helvetica,sans-serif;padding:20px}h1{color:#1f3a57}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:8px;border:1px solid #ddd;text-align:left}thead th{background:#f6fbff}</style>
          </head><body>
          <h1>${title}</h1>
          <div><strong>Batch ID:</strong> ${batch.batch_id}</div>
          <div><strong>Created:</strong> ${batch.created_at}</div>
          <div style="margin-top:8px">${signInfo}</div>
          <div style="margin-top:12px"><strong>Card Count:</strong> ${batch.card_count}</div>
          <table><thead><tr><th>ARN</th><th>State</th><th>Status</th><th>Created</th></tr></thead><tbody>
          ${rowsHtml}
          </tbody></table>
          <div style="margin-top:18px;font-size:12px;color:#666">Generated by ENBIC Tracking System</div>
          </body></html>`;

        // save html to file
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
    });
  });

  // Serve stored delivery or confirmation files for a batch
  app.get('/api/dispatch/:batchId/file/:which', (req, res) => {
    const { batchId, which } = req.params;
    db.get(`SELECT delivery_note_path, confirmation_note_path FROM dispatch_batches WHERE batch_id = ?`, [batchId], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Batch not found' });
      const filePath = which === 'delivery' ? row.delivery_note_path : row.confirmation_note_path;
      if (!filePath) return res.status(404).json({ error: 'File not found' });
      res.sendFile(filePath);
    });
  });
});

// Get reminders
app.get('/api/reminders', (req, res) => {
  const query = `
    SELECT r.*, a.state, a.status 
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
app.post('/api/reminders/generate', (req, res) => {
  generateRemindersInDB((err) => {
    if (err) return res.status(500).json({ error: err.message || String(err) });
    res.json({ success: true, message: 'Reminders generated' });
  });
});

// Resolve reminder
app.post('/api/reminders/:id/resolve', (req, res) => {
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
app.get('/api/delivery/stats', (req, res) => {
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
app.get('/api/reports/:type', (req, res) => {
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
app.get('/api/export/excel/:type', async (req, res) => {
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
app.get('/api/export/pdf/:type', (req, res) => {
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
app.get('/api/states', (req, res) => {
  db.all('SELECT * FROM states ORDER BY name', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

// Add new state
app.post('/api/states', (req, res) => {
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
app.delete('/api/states/:id', (req, res) => {
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
