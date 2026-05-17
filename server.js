require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 4000);

const PROJECT_ROOT = __dirname;
const PUBLIC_DIR = PROJECT_ROOT;
const DB_FILE = path.join(PROJECT_ROOT, 'complaints.db');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(PUBLIC_DIR));

const db = new sqlite3.Database(DB_FILE);

const run = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      err ? reject(err) : resolve({ id: this.lastID, changes: this.changes });
    })
  );

const all = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => {
      err ? reject(err) : resolve(rows);
    })
  );

const asyncHandler = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message || 'Server error'
    });
  });

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: Number(process.env.EMAIL_PORT || 587),
  secure: String(process.env.EMAIL_SECURE || 'false') === 'true',
  auth:
    process.env.EMAIL_USER && process.env.EMAIL_PASS
      ? { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      : undefined
});

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticketNo TEXT,
      clientName TEXT,
      mobile TEXT,
      email TEXT,
      address TEXT,
      issueType TEXT,
      issueDetails TEXT,
      assignedTo TEXT,
      status TEXT,
      priority TEXT,
      slaDue TEXT,
      followupDate TEXT,
      escalationLevel TEXT,
      escalatedTo TEXT,
      escalationRemarks TEXT,
      remarks TEXT,
      internalNotes TEXT,
      closed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Viewer',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS amc (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clientName TEXT,
      type TEXT,
      start TEXT,
      end TEXT,
      amount TEXT,
      renewalAmount TEXT,
      assigned TEXT,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS client_master (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      mobile TEXT,
      email TEXT,
      address TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS suggestion_master (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(type, value)
    )
  `);

  await run(`
    INSERT OR IGNORE INTO users 
    (id, username, password, role)
    VALUES (1, 'admin', '1234', 'Admin')
  `);

  console.log('Database Initialized');
}

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/health', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    status: 'Running',
    database: DB_FILE
  });
}));

app.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};

  const rows = await all(
    'SELECT id, username, role FROM users WHERE username = ? AND password = ?',
    [username, password]
  );

  if (rows.length > 0) {
    return res.json({
      success: true,
      user: rows[0]
    });
  }

  res.json({
    success: false,
    message: 'Invalid Login'
  });
}));

app.get('/users', asyncHandler(async (req, res) => {
  const rows = await all(
    'SELECT id, username, password, role, created_at FROM users ORDER BY id DESC'
  );
  res.json(rows);
}));

app.post('/users', asyncHandler(async (req, res) => {
  const { username, password, role } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: 'Username and password required'
    });
  }

  await run(
    'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
    [username, password, role || 'Viewer']
  );

  res.json({
    success: true,
    message: 'User created'
  });
}));

app.put('/users/:id', asyncHandler(async (req, res) => {
  const { username, password, role } = req.body || {};

  await run(
    'UPDATE users SET username = ?, password = ?, role = ? WHERE id = ?',
    [username, password, role || 'Viewer', req.params.id]
  );

  res.json({
    success: true,
    message: 'User updated'
  });
}));

app.delete('/users/:id', asyncHandler(async (req, res) => {
  await run(
    'DELETE FROM users WHERE id = ? AND username <> ?',
    [req.params.id, 'admin']
  );

  res.json({
    success: true,
    message: 'User deleted'
  });
}));

app.get('/complaints', asyncHandler(async (req, res) => {
  const rows = await all('SELECT * FROM complaints ORDER BY id DESC');
  res.json(rows);
}));

app.post('/complaints', asyncHandler(async (req, res) => {
  const c = req.body || {};
  const ticketNo = `CT-${Date.now()}`;
  const closedAt = c.status === 'Closed' ? new Date().toISOString() : null;

  const result = await run(
    `
    INSERT INTO complaints
    (ticketNo, clientName, mobile, email, address, issueType, issueDetails, assignedTo, status, priority, slaDue, followupDate, escalationLevel, escalatedTo, escalationRemarks, remarks, internalNotes, closed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      ticketNo,
      c.clientName || '',
      c.mobile || c.mobileNo || '',
      c.email || '',
      c.address || '',
      c.issueType || '',
      c.issueDetails || '',
      c.assignedTo || '',
      c.status || 'Open',
      c.priority || 'Medium',
      c.slaDue || '',
      c.followupDate || '',
      c.escalationLevel || '',
      c.escalatedTo || '',
      c.escalationRemarks || '',
      c.remarks || '',
      c.internalNotes || '',
      closedAt
    ]
  );

  res.json({
    success: true,
    id: result.id,
    ticketNo
  });
}));

app.put('/complaints/:id', asyncHandler(async (req, res) => {
  const c = req.body || {};
  const closedAt = c.status === 'Closed' ? new Date().toISOString() : null;

  await run(
    `
    UPDATE complaints SET
      clientName = ?,
      mobile = ?,
      email = ?,
      address = ?,
      issueType = ?,
      issueDetails = ?,
      assignedTo = ?,
      status = ?,
      priority = ?,
      slaDue = ?,
      followupDate = ?,
      escalationLevel = ?,
      escalatedTo = ?,
      escalationRemarks = ?,
      remarks = ?,
      internalNotes = ?,
      closed_at = ?
    WHERE id = ?
    `,
    [
      c.clientName || '',
      c.mobile || c.mobileNo || '',
      c.email || '',
      c.address || '',
      c.issueType || '',
      c.issueDetails || '',
      c.assignedTo || '',
      c.status || 'Open',
      c.priority || 'Medium',
      c.slaDue || '',
      c.followupDate || '',
      c.escalationLevel || '',
      c.escalatedTo || '',
      c.escalationRemarks || '',
      c.remarks || '',
      c.internalNotes || '',
      closedAt,
      req.params.id
    ]
  );

  res.json({
    success: true,
    message: 'Complaint updated'
  });
}));

app.delete('/complaints/:id', asyncHandler(async (req, res) => {
  await run('DELETE FROM complaints WHERE id = ?', [req.params.id]);

  res.json({
    success: true,
    message: 'Complaint deleted'
  });
}));

app.get('/amc', asyncHandler(async (req, res) => {
  const rows = await all('SELECT * FROM amc ORDER BY id DESC');
  res.json(rows);
}));

app.post('/amc', asyncHandler(async (req, res) => {
  const a = req.body || {};

  const result = await run(
    `
    INSERT INTO amc
    (clientName, type, start, end, amount, renewalAmount, assigned, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      a.clientName || '',
      a.type || '',
      a.start || '',
      a.end || '',
      a.amount || '',
      a.renewalAmount || '',
      a.assigned || '',
      a.note || ''
    ]
  );

  res.json({
    success: true,
    id: result.id,
    message: 'AMC created'
  });
}));

app.put('/amc/:id', asyncHandler(async (req, res) => {
  const a = req.body || {};

  await run(
    `
    UPDATE amc SET
      clientName = ?,
      type = ?,
      start = ?,
      end = ?,
      amount = ?,
      renewalAmount = ?,
      assigned = ?,
      note = ?
    WHERE id = ?
    `,
    [
      a.clientName || '',
      a.type || '',
      a.start || '',
      a.end || '',
      a.amount || '',
      a.renewalAmount || '',
      a.assigned || '',
      a.note || '',
      req.params.id
    ]
  );

  res.json({
    success: true,
    message: 'AMC updated'
  });
}));

app.delete('/amc/:id', asyncHandler(async (req, res) => {
  await run('DELETE FROM amc WHERE id = ?', [req.params.id]);

  res.json({
    success: true,
    message: 'AMC deleted'
  });
}));

app.get('/client-master', asyncHandler(async (req, res) => {
  const rows = await all('SELECT * FROM client_master ORDER BY name ASC');
  res.json(rows);
}));

app.post('/client-master', asyncHandler(async (req, res) => {
  const { name, mobile, email, address } = req.body || {};

  if (!name) {
    return res.status(400).json({
      success: false,
      message: 'Client name required'
    });
  }

  await run(
    'INSERT OR IGNORE INTO client_master (name, mobile, email, address) VALUES (?, ?, ?, ?)',
    [name, mobile || '', email || '', address || '']
  );

  res.json({
    success: true,
    message: 'Client created'
  });
}));

app.put('/client-master/:id', asyncHandler(async (req, res) => {
  const { name, mobile, email, address } = req.body || {};

  await run(
    'UPDATE client_master SET name = ?, mobile = ?, email = ?, address = ? WHERE id = ?',
    [name || '', mobile || '', email || '', address || '', req.params.id]
  );

  res.json({
    success: true,
    message: 'Client updated'
  });
}));

app.delete('/client-master/:id', asyncHandler(async (req, res) => {
  await run('DELETE FROM client_master WHERE id = ?', [req.params.id]);

  res.json({
    success: true,
    message: 'Client deleted'
  });
}));

app.post('/import/client-master', asyncHandler(async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  let count = 0;

  for (const r of rows) {
    const name =
      r['Client Name'] ||
      r['Name'] ||
      r.name ||
      r.clientName ||
      '';

    if (!name) continue;

    await run(
      'INSERT OR IGNORE INTO client_master (name, mobile, email, address) VALUES (?, ?, ?, ?)',
      [
        name,
        r['Mobile'] || r['Mobile No'] || r['Mobile No.'] || r.mobile || '',
        r['Email'] || r.email || '',
        r['Address'] || r.address || ''
      ]
    );

    count++;
  }

  res.json({
    success: true,
    imported: count,
    message: `${count} clients imported`
  });
}));

app.get('/suggestion-master', asyncHandler(async (req, res) => {
  const rows = await all('SELECT * FROM suggestion_master ORDER BY type, value');
  res.json(rows);
}));

app.post('/suggestion-master', asyncHandler(async (req, res) => {
  const { type, value } = req.body || {};

  if (!type || !value) {
    return res.status(400).json({
      success: false,
      message: 'Type and value required'
    });
  }

  await run(
    'INSERT OR IGNORE INTO suggestion_master (type, value) VALUES (?, ?)',
    [type, value]
  );

  res.json({
    success: true,
    message: 'Suggestion created'
  });
}));

app.put('/suggestion-master/:id', asyncHandler(async (req, res) => {
  const { type, value } = req.body || {};

  await run(
    'UPDATE suggestion_master SET type = ?, value = ? WHERE id = ?',
    [type || '', value || '', req.params.id]
  );

  res.json({
    success: true,
    message: 'Suggestion updated'
  });
}));

app.delete('/suggestion-master/:id', asyncHandler(async (req, res) => {
  await run('DELETE FROM suggestion_master WHERE id = ?', [req.params.id]);

  res.json({
    success: true,
    message: 'Suggestion deleted'
  });
}));

app.post('/import/complaints', asyncHandler(async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  let count = 0;

  for (const r of rows) {
    const ticketNo = r['Ticket No'] || r.ticketNo || `CT-${Date.now()}-${count}`;

    await run(
      `
      INSERT INTO complaints
      (ticketNo, clientName, mobile, email, address, issueType, issueDetails, assignedTo, status, priority, slaDue, followupDate, escalationLevel, escalatedTo, escalationRemarks, remarks, internalNotes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        ticketNo,
        r['Client Name'] || r.clientName || '',
        r['Mobile'] || r['Mobile No'] || r['Mobile No.'] || r.mobile || '',
        r['Email'] || r.email || '',
        r['Address'] || r.address || '',
        r['Issue Type'] || r.issueType || '',
        r['Issue Details'] || r.issueDetails || '',
        r['Assigned To'] || r.assignedTo || '',
        r['Status'] || r.status || 'Open',
        r['Priority'] || r.priority || 'Medium',
        r['SLA Due'] || r.slaDue || '',
        r['Follow-up Date'] || r.followupDate || '',
        r['Escalation Level'] || r.escalationLevel || '',
        r['Escalated To'] || r.escalatedTo || '',
        r['Escalation Remarks'] || r.escalationRemarks || '',
        r['Remarks'] || r.remarks || '',
        r['Internal Notes'] || r.internalNotes || ''
      ]
    );

    count++;
  }

  res.json({
    success: true,
    imported: count,
    message: `${count} complaints imported`
  });
}));

app.post('/send-email', asyncHandler(async (req, res) => {
  const { to, subject, body } = req.body || {};

  if (!to) {
    return res.status(400).json({
      success: false,
      message: 'Recipient email required'
    });
  }

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return res.status(400).json({
      success: false,
      message: 'Email credentials missing'
    });
  }

  const info = await transporter.sendMail({
    from: `"Support Team" <${process.env.EMAIL_USER}>`,
    to,
    subject: subject || 'Complaint Update',
    text: body || 'Complaint updated successfully'
  });

  res.json({
    success: true,
    messageId: info.messageId
  });
}));

app.use((req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
      console.log(`Database: ${DB_FILE}`);
    });
  })
  .catch((err) => {
    console.error('Init failed', err);
    process.exit(1);
  });
