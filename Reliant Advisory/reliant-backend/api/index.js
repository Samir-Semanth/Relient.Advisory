require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');
// Remote Turso (HTTP client, no native code) in production; a local SQLite file when TURSO_DATABASE_URL is not set.
const { createClient } = require(process.env.TURSO_DATABASE_URL ? '@libsql/client/web' : '@libsql/client');

const onVercel = !!process.env.VERCEL;
const SERVICES = ['Tax Advisory & Compliance', 'VAT & Regulatory Support', 'Accounting & Financial Reporting',
  'Corporate & Business Advisory', 'Digital Finance & Capability', 'Other'];
const db = createClient(process.env.TURSO_DATABASE_URL
  ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
  : { url: 'file:' + (process.env.DB_PATH || path.join(process.cwd(), 'data.db')) });
const all = async (sql, args = []) => (await db.execute({ sql, args })).rows;
const one = async (sql, args = []) => (await all(sql, args))[0];
const run = (sql, args = []) => db.execute({ sql, args });

const SEED = [['Strativ BD Limited','ITES (MNC)'],['Mango Group','IT and Technology-enabled Business'],['Nagadhat Limited','E-commerce Business'],['Techdesh Ltd','ITES'],
  ['Grit Technologies Ltd','ITES'],['Ogroni Informatics','ITES'],['Nazdaq Technologies Inc. Ltd.','ITES'],['Synthia Securities Ltd','Share Brokerage'],
  ['Hello Super Star Ltd','ITES'],['Global Assurance Asset Management Ltd.','Asset Management Co.'],['Innovex Hub BD Limited','ITES'],['SOFTEDGE','ITES'],
  ['Ignited','Service'],['Student Icon','Manufacturer'],['Doctorola Limited','ITES'],['Meditalk Digital','Digital Content'],['Arise Horizon','Outsourcing Firm']];
function parseCSV(t) { const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; r.push(f); rows.push(r); r = []; f = ''; }
    else f += c; }
  if (f || r.length) { r.push(f); rows.push(r); } return rows.filter(x => x.some(y => y.trim())); }

const slugify = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'post';

const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 465),
  secure: +(process.env.SMTP_PORT || 465) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }) : null;

async function notify(d) {
  if (!mailer) return;
  await mailer.sendMail({
    from: `"Reliant Advisory Website" <${process.env.SMTP_USER}>`,
    to: process.env.NOTIFY_TO || 'nasrinsultana.reliant@gmail.com',
    replyTo: d.email,
    subject: `New enquiry: ${d.service} (${d.name})`,
    text: `Name: ${d.name}\nCompany: ${d.company || '-'}\nEmail: ${d.email}\nPhone: ${d.phone || '-'}\nService: ${d.service}\n\n${d.message}`
  });
}

const clean = (v, n) => String(v == null ? '' : v).trim().slice(0, n);


async function init() {
  if (onVercel && !process.env.TURSO_DATABASE_URL) throw new Error('Database not configured: set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN');
  await db.batch([
    `CREATE TABLE IF NOT EXISTS enquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      name TEXT NOT NULL, company TEXT, email TEXT NOT NULL, phone TEXT, service TEXT NOT NULL, message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new', ip TEXT)`,
    `CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sector TEXT, sort INTEGER DEFAULT 0, visible INTEGER DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, category TEXT, summary TEXT,
      body TEXT, published INTEGER DEFAULT 0, published_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS views (day TEXT, path TEXT, n INTEGER DEFAULT 0, PRIMARY KEY (day, path))`,
    `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`
  ], 'write');
  // Seed the starting client list exactly once (atomic, so concurrent cold starts cannot double-seed)
  const r = await run("INSERT OR IGNORE INTO meta (k, v) VALUES ('seeded', '1')");
  if (r.rowsAffected === 1)
    await db.batch(SEED.map((c, i) => ({ sql: 'INSERT INTO clients (name,sector,sort) VALUES (?,?,?)', args: [c[0], c[1], i] })), 'write');
}
let ready;
const boot = () => (ready = ready || init().catch(e => { ready = null; throw e; }));
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ['https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"],
  upgradeInsecureRequests: null } } }));
app.use(express.json({ limit: '300kb' }));
if (require.main === module) app.use(express.static(path.join(__dirname, '..', 'public'))); // local dev; Vercel serves /public itself
app.use('/api', wrap(async (req, res, next) => { await boot(); next(); }));

// ---------- Public ----------
app.post('/api/contact', wrap(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot: bots fill this hidden field
  const d = { name: clean(b.name, 120), company: clean(b.company, 160), email: clean(b.email, 160),
    phone: clean(b.phone, 40), service: clean(b.service, 80), message: clean(b.message, 4000) };
  const fields = {};
  if (!d.name) fields.name = 'Required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) fields.email = 'Invalid email';
  if (d.phone && !/^[+\d][\d\s()-]{6,}$/.test(d.phone)) fields.phone = 'Invalid phone';
  if (!SERVICES.includes(d.service)) fields.service = 'Choose a service';
  if (d.message.length < 10) fields.message = 'Too short';
  if (Object.keys(fields).length) return res.status(400).json({ error: 'Validation failed', fields });
  // Database-backed limit (works across serverless instances): 5 enquiries per IP per 15 minutes
  const recent = await one("SELECT COUNT(*) c FROM enquiries WHERE ip=? AND created_at > datetime('now','-15 minutes')", [req.ip || '']);
  if (recent.c >= 5) return res.status(429).json({ error: 'Too many enquiries. Please try again later.' });
  const r = await run('INSERT INTO enquiries (name,company,email,phone,service,message,ip) VALUES (?,?,?,?,?,?,?)',
    [d.name, d.company, d.email, d.phone, d.service, d.message, req.ip || '']);
  await notify(d).catch(e => console.error('Email notification failed:', e.message)); // awaited: serverless stops after the response
  res.status(201).json({ ok: true, id: Number(r.lastInsertRowid) });
}));
const cache = (res) => res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
app.get('/api/clients', wrap(async (_, res) => { cache(res); res.json(await all('SELECT name, sector FROM clients WHERE visible=1 ORDER BY sort, id')); }));
app.get('/api/posts', wrap(async (_, res) => { cache(res);
  res.json(await all('SELECT slug,title,category,summary,body,published_at FROM posts WHERE published=1 ORDER BY published_at DESC')); }));
// Privacy-friendly page-view counter (no cookies, no IP, no personal data)
const trackLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });
app.post('/api/track', trackLimiter, wrap(async (req, res) => {
  const p = clean((req.body || {}).path, 80);
  if (/^\/[A-Za-z0-9/_-]{0,70}$/.test(p)) await run("INSERT INTO views (day,path,n) VALUES (date('now'),?,1) ON CONFLICT(day,path) DO UPDATE SET n=n+1", [p]);
  res.status(204).end(); }));
app.get('/api/health', (_, res) => res.json({ ok: true }));

// ---------- Admin (Bearer ADMIN_TOKEN) ----------
const auth = (req, res, next) => {
  const a = Buffer.from((req.get('authorization') || '').replace(/^Bearer /, ''));
  const b = Buffer.from(process.env.ADMIN_TOKEN || '');
  if (!b.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Unauthorized' });
  next();
};
const csvCell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
app.get('/api/admin/enquiries', auth, wrap(async (_, res) => res.json(await all('SELECT * FROM enquiries ORDER BY id DESC LIMIT 500'))));
app.get('/api/admin/enquiries.csv', auth, wrap(async (_, res) => {
  const rows = await all('SELECT * FROM enquiries ORDER BY id DESC'), cols = ['id','created_at','name','company','email','phone','service','message','status'];
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="enquiries.csv"')
    .send('\ufeff' + [cols.join(',')].concat(rows.map(r => cols.map(c => csvCell(r[c])).join(','))).join('\r\n')); }));
app.patch('/api/admin/enquiries/:id', auth, wrap(async (req, res) => {
  const s = (req.body || {}).status;
  if (!['new', 'contacted', 'closed'].includes(s)) return res.status(400).json({ error: 'Invalid status' });
  await run('UPDATE enquiries SET status=? WHERE id=?', [s, Number(req.params.id)]); res.json({ ok: true }); }));
// Clients
app.get('/api/admin/clients', auth, wrap(async (_, res) => res.json(await all('SELECT * FROM clients ORDER BY sort, id'))));
app.post('/api/admin/clients', auth, wrap(async (req, res) => {
  const n = clean(req.body.name, 160); if (!n) return res.status(400).json({ error: 'Name required' });
  const max = (await one('SELECT COALESCE(MAX(sort),0)+1 m FROM clients')).m;
  const r = await run('INSERT INTO clients (name,sector,sort) VALUES (?,?,?)', [n, clean(req.body.sector, 120), max]);
  res.status(201).json({ id: Number(r.lastInsertRowid) }); }));
app.post('/api/admin/clients/import', auth, wrap(async (req, res) => {
  let rows = parseCSV(String(req.body.csv || '')); if (rows.length && /^(name|client|organi[sz]ation)/i.test(rows[0][0].trim())) rows = rows.slice(1);
  let max = (await one('SELECT COALESCE(MAX(sort),0) m FROM clients')).m; const stmts = [];
  rows.forEach(r => { const name = clean(r[0], 160); if (name) stmts.push({ sql: 'INSERT INTO clients (name,sector,sort) VALUES (?,?,?)', args: [name, clean(r[1], 120), ++max] }); });
  if (stmts.length) await db.batch(stmts, 'write');
  res.json({ ok: true, imported: stmts.length }); }));
app.patch('/api/admin/clients/:id', auth, wrap(async (req, res) => {
  const b = req.body || {}, c = await one('SELECT * FROM clients WHERE id=?', [Number(req.params.id)]); if (!c) return res.status(404).json({ error: 'Not found' });
  await run('UPDATE clients SET name=?, sector=?, visible=? WHERE id=?', [clean(b.name ?? c.name, 160) || c.name, clean(b.sector ?? c.sector, 120), b.visible === undefined ? c.visible : (b.visible ? 1 : 0), c.id]);
  res.json({ ok: true }); }));
app.delete('/api/admin/clients/:id', auth, wrap(async (req, res) => { await run('DELETE FROM clients WHERE id=?', [Number(req.params.id)]); res.json({ ok: true }); }));
// Insights / articles
app.get('/api/admin/posts', auth, wrap(async (_, res) => res.json(await all('SELECT * FROM posts ORDER BY published_at DESC, id DESC'))));
const postFields = b => ({ title: clean(b.title, 200), category: clean(b.category, 60), summary: clean(b.summary, 400), body: clean(b.body, 60000),
  published: b.published ? 1 : 0, at: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null });
app.post('/api/admin/posts', auth, wrap(async (req, res) => {
  const f = postFields(req.body || {}); if (!f.title) return res.status(400).json({ error: 'Title required' });
  let slug = slugify(f.title), i = 2; while (await one('SELECT 1 FROM posts WHERE slug=?', [slug])) slug = slugify(f.title) + '-' + i++;
  const r = await run("INSERT INTO posts (slug,title,category,summary,body,published,published_at) VALUES (?,?,?,?,?,?,COALESCE(?,datetime('now')))",
    [slug, f.title, f.category, f.summary, f.body, f.published, f.at]);
  res.status(201).json({ id: Number(r.lastInsertRowid), slug }); }));
app.patch('/api/admin/posts/:id', auth, wrap(async (req, res) => {
  const f = postFields(req.body || {}); if (!f.title) return res.status(400).json({ error: 'Title required' });
  await run('UPDATE posts SET title=?,category=?,summary=?,body=?,published=?,published_at=COALESCE(?,published_at) WHERE id=?',
    [f.title, f.category, f.summary, f.body, f.published, f.at, Number(req.params.id)]);
  res.json({ ok: true }); }));
app.delete('/api/admin/posts/:id', auth, wrap(async (req, res) => { await run('DELETE FROM posts WHERE id=?', [Number(req.params.id)]); res.json({ ok: true }); }));
// Analytics
app.get('/api/admin/stats', auth, wrap(async (_, res) => res.json({
  views: await all("SELECT path, SUM(n) n FROM views WHERE day >= date('now','-30 day') GROUP BY path ORDER BY n DESC"),
  enquiries: await all('SELECT status, COUNT(*) n FROM enquiries GROUP BY status') })));

app.use((e, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(e);
  res.status(500).json({ error: /Database not configured/.test(e.message) ? e.message : 'Server error' }); });

module.exports = app;
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Reliant Advisory running on http://localhost:${PORT}`));
}
