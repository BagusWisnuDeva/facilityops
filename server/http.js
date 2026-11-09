import fs from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Balasan berkas (mis. foto bukti kerusakan).
export class FileResponse {
  constructor(body, type, headers = {}) {
    this.body = body;
    this.type = type;
    this.headers = headers;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};
export const mimeFor = (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

export class Router {
  constructor() {
    this.routes = [];
  }
  add(method, pattern, ...fns) {
    const keys = [];
    const src = pattern.replace(/:([a-z_]+)/gi, (_, k) => {
      keys.push(k);
      return '([^/]+)';
    });
    this.routes.push({ method, re: new RegExp(`^${src}/?$`), keys, fns });
  }
  get(p, ...f) { this.add('GET', p, ...f); }
  post(p, ...f) { this.add('POST', p, ...f); }
  put(p, ...f) { this.add('PUT', p, ...f); }
  patch(p, ...f) { this.add('PATCH', p, ...f); }
  delete(p, ...f) { this.add('DELETE', p, ...f); }

  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
    return pathMatched ? 'method' : null;
  }
}

const MAX_BODY = 8 * 1024 * 1024; // 8 MB (foto berukuran maks 5 MB dikirim sebagai base64)

async function readJson(req) {
  const type = req.headers['content-type'] || '';
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Ukuran permintaan terlalu besar.');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  if (!type.includes('application/json')) throw new HttpError(415, 'Content-Type harus application/json.');
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    throw new HttpError(400, 'Format JSON tidak valid.');
  }
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function sqliteToHttp(err) {
  const msg = String(err?.message || '');
  if (/FOREIGN KEY constraint failed/i.test(msg))
    return new HttpError(409, 'Data tidak dapat diproses karena masih berkaitan dengan data lain (mis. riwayat laporan).');
  if (/UNIQUE constraint failed/i.test(msg)) return new HttpError(409, 'Data dengan nilai tersebut sudah ada.');
  if (/CHECK constraint failed/i.test(msg)) return new HttpError(400, 'Nilai yang dimasukkan tidak valid.');
  return null;
}

export async function handleApi(router, req, res, { getUser }) {
  const url = new URL(req.url, 'http://localhost');
  const cookies = {};
  try {
    const found = router.match(req.method, url.pathname);
    if (!found) throw new HttpError(404, 'Endpoint tidak ditemukan.');
    if (found === 'method') throw new HttpError(405, 'Metode tidak diizinkan.');

    // Perlindungan CSRF dasar: permintaan yang mengubah data harus berasal dari origin yang sama.
    if (req.method !== 'GET' && req.headers.origin) {
      let sameOrigin = false;
      try { sameOrigin = new URL(req.headers.origin).host === req.headers.host; } catch { /* abaikan */ }
      if (!sameOrigin) throw new HttpError(403, 'Permintaan lintas origin ditolak.');
    }

    const ctx = {
      req, res, url,
      query: Object.fromEntries(url.searchParams),
      params: found.params,
      body: {},
      status: 200,
      headers: {},
      cookies,
      user: null,
    };
    ctx.user = getUser(ctx);
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) ctx.body = await readJson(req);

    const { fns } = found.route;
    let result;
    for (let i = 0; i < fns.length; i++) {
      const out = await fns[i](ctx);
      if (i === fns.length - 1) result = out;
    }
    if (result instanceof FileResponse) {
      res.writeHead(200, {
        'Content-Type': result.type,
        'Content-Length': result.body.length,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        ...result.headers,
      });
      res.end(result.body);
      return;
    }
    sendJson(res, ctx.status, result ?? { ok: true }, ctx.headers);
  } catch (err) {
    const mapped = err instanceof HttpError ? err : sqliteToHttp(err);
    if (mapped) return sendJson(res, mapped.status, { error: mapped.message, details: mapped.details });
    console.error('[ERROR]', req.method, url.pathname, err);
    sendJson(res, 500, { error: 'Terjadi kesalahan pada server.' });
  }
}

export function serveStatic(req, res, publicDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  const { pathname } = new URL(req.url, 'http://localhost');
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400).end(); return; }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(publicDir, '.' + rel);
  if (file !== publicDir && !file.startsWith(publicDir + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Halaman tidak ditemukan.');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mimeFor(file),
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
};
