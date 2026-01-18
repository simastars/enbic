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

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Initialize database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database schema
function initializeDatabase() {
  db.serialize(() => {
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
      notes TEXT
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

    console.log('Database initialized');
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
  // Reminders for ARNs awaiting submission
  db.all(
    `SELECT arn FROM arns WHERE status = 'Awaiting Capture'`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      rows.forEach(row => {
        db.get(
          `SELECT id FROM reminders WHERE arn = ? AND reminder_type = 'pending_capture' AND resolved_at IS NULL`,
          [row.arn],
          (err, existing) => {
            if (!err && !existing) {
              db.run(
                `INSERT INTO reminders (arn, reminder_type, message) VALUES (?, ?, ?)`,
                [row.arn, 'pending_capture', `ARN ${row.arn} is still awaiting capture and personalization submission`]
              );
            }
          }
        );
      });

      res.json({ success: true, message: 'Reminders generated' });
    }
  );
});

// Resolve reminder
app.post('/api/reminders/:id/resolve', (req, res) => {
  db.run(
    `UPDATE reminders SET resolved_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [req.params.id],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ success: true });
      }
    }
  );
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
  let query = '';

  switch (type) {
    case 'pending-capture':
      query = `SELECT *, 
        julianday('now') - julianday(created_at) as age_days
        FROM arns WHERE status = 'Awaiting Capture' ORDER BY created_at ASC`;
      break;
    case 'submitted':
      query = `SELECT * FROM arns WHERE status = 'Submitted to Personalization' ORDER BY submitted_at DESC`;
      break;
    case 'pending-delivery':
      query = `SELECT *, 
        julianday('now') - julianday(pending_delivery_at) as age_days
        FROM arns WHERE status = 'Pending Delivery' ORDER BY state, pending_delivery_at ASC`;
      break;
    case 'delivery-history':
      query = `SELECT * FROM delivery_history ORDER BY delivery_date DESC`;
      break;
    case 'activity-log':
      query = `SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 1000`;
      break;
    default:
      return res.status(400).json({ error: 'Invalid report type' });
  }

  db.all(query, [], (err, rows) => {
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
  db.all('SELECT DISTINCT state FROM arns ORDER BY state', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows.map(r => r.state));
    }
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
