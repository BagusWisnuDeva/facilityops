process.env.TZ ||= 'Asia/Makassar'; // WITA; harus diset sebelum objek Date dipakai

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, DB_FILE, UPLOAD_DIR, openDb } from './db.js';
import { Router, handleApi, serveStatic, SECURITY_HEADERS } from './http.js';
import { registerRoutes } from './routes.js';
import { seedAll, ensureSchedule } from './seed.js';
import * as auth from './auth.js';
import { fmtDate } from './util.js';

export function createServer(db) {
  const router = new Router();
  registerRoutes(router, db);
  const publicDir = path.join(ROOT, 'public');

  return http.createServer((req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/api/')) {
      handleApi(router, req, res, {
        getUser: (ctx) => {
          Object.assign(ctx.cookies, auth.parseCookies(req.headers.cookie));
          return auth.getSessionUser(db, ctx.cookies[auth.COOKIE_NAME]);
        },
      });
    } else {
      serveStatic(req, res, publicDir);
    }
  });
}

export function prepareDatabase(db) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM pengguna').get();
  if (c === 0) {
    console.log('Basis data kosong, mengisi data awal...');
    seedAll(db);
  }
  ensureSchedule(db);
  auth.purgeExpiredSessions(db);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const db = openDb();
  prepareDatabase(db);
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  createServer(db).listen(port, host, () => {
    console.log(`FacilityOPS berjalan di http://${host === '0.0.0.0' ? 'localhost' : host}:${port}  (${fmtDate()}, TZ=${process.env.TZ})`);
    console.log(`Basis data: ${DB_FILE}`);
  });
}