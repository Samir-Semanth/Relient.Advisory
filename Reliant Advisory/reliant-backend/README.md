# Reliant Advisory: website + backend (Vercel + Turso)

The website (`public/index.html`) and admin panel (`public/admin.html`) are static files. The backend is one Express API in `api/index.js`, which runs as a Vercel serverless function and stores data in a **Turso** database (hosted SQLite, free tier available).

## What you manage from /admin.html
Clients (add, edit, hide, delete, bulk CSV upload) · Insights articles (draft or publish) · Enquiries (status + CSV export) · Page-view analytics.
The website loads clients and articles from the API; if the API is unreachable it shows its built-in client list.

## Deploy to Vercel

### 1. Create the database (5 minutes)
1. Sign up at https://turso.tech and create a database (any name, e.g. `reliant`).
2. Copy its **Database URL** (looks like `libsql://reliant-yourname.turso.io`).
3. Create a **database token** (read & write) and copy it.
Tables are created automatically on the first request, and your starting client list is added once.

### 2. Put the project on Vercel
**Important: no spaces in any folder or repo name** (Vercel rejects function paths that contain spaces).
- **GitHub route:** put the *contents* of this folder (the files `package.json`, `vercel.json`, `api/`, `public/` ...) at the root of a new repository, then import it in Vercel. If they sit in a sub-folder, set **Root Directory** to that sub-folder.
- **CLI route:** `npm i -g vercel`, then `cd` into this folder and run `vercel`.

Project settings: **Framework Preset = Other**. Leave Build Command and Output Directory empty.

### 3. Environment variables (Project > Settings > Environment Variables)
| Name | Value |
|---|---|
| `ADMIN_TOKEN` | a long random secret: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` |
| `TURSO_DATABASE_URL` | the `libsql://...` URL |
| `TURSO_AUTH_TOKEN` | the Turso token |
| `NOTIFY_TO` | `nasrinsultana.reliant@gmail.com` (where enquiry alerts go) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | optional, for email alerts (Gmail: `smtp.gmail.com`, `465`, your address, an **App Password**) |

Redeploy after adding variables. Then open `https://<your-domain>/admin.html` and sign in with `ADMIN_TOKEN`. Add your custom domain under Settings > Domains.

## Run locally
```
npm install
cp .env.example .env     # set ADMIN_TOKEN; leave TURSO_* empty to use a local data.db file
npm start                # http://localhost:3000   admin: /admin.html
```

## Uploading data later
- One client: Admin > Clients > "Add a client".
- Many clients: Admin > Clients > "Bulk upload (CSV)". One per line: `name,sector` (header row optional; quote names that contain commas).
- Articles: Admin > Insights. Blank line between paragraphs. Plain text only.
- Backup: Turso keeps the data; use Export CSV for enquiries.

## API
Public: `POST /api/contact`, `GET /api/clients`, `GET /api/posts`, `POST /api/track`, `GET /api/health`.
Admin (`Authorization: Bearer <ADMIN_TOKEN>`): `/api/admin/enquiries[.csv]`, `/api/admin/clients[/import]`, `/api/admin/posts`, `/api/admin/stats`.

## Notes
- Public clients/articles responses are cached for about a minute, so edits can take up to a minute to appear.
- The enquiry limit (5 per IP per 15 minutes) is stored in the database, so it works across serverless instances.
- Enquiries store the visitor's IP for abuse control: mention this in your privacy policy. Page views use no cookies and no personal data.
- Not included: image uploads, multiple admin users, editing fixed page copy from the admin panel.

## Troubleshooting
- **"Serverless Function has an invalid name ... must not contain any space"**: a folder or repo name contains a space. Rename it or deploy from inside this folder.
- **API returns "Database not configured"**: `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` are missing in Vercel. Add them and redeploy.
- **401 in the admin panel**: the token does not match `ADMIN_TOKEN`.
