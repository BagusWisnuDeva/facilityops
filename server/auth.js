import crypto from 'node:crypto';

// ---- Kata sandi (scrypt + salt acak) ----
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [alg, s, h] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const hash = Buffer.from(h, 'base64');
    const test = crypto.scryptSync(password, Buffer.from(s, 'base64'), hash.length);
    return crypto.timingSafeEqual(hash, test);
  } catch {
    return false;
  }
}

// Hash palsu agar waktu respons sama baik akun ada maupun tidak.
export const DUMMY_HASH = hashPassword('tidak-dipakai');

// ---- Sesi (token acak di cookie HttpOnly, di basis data hanya disimpan hash-nya) ----
export const COOKIE_NAME = 'fops_sid';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sesi (token_hash, id_pengguna, kedaluwarsa) VALUES (?, ?, ?)').run(
    sha(token),
    userId,
    Date.now() + SESSION_TTL_MS,
  );
  return token;
}

export function getSessionUser(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT p.id_pengguna, p.nim, p.nama, p.panggilan, p.email, p.peran, p.spesialisasi, s.kedaluwarsa
         FROM sesi s JOIN pengguna p ON p.id_pengguna = s.id_pengguna
        WHERE s.token_hash = ?`,
    )
    .get(sha(token));
  if (!row) return null;
  if (row.kedaluwarsa < Date.now()) {
    destroySession(db, token);
    return null;
  }
  return row;
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sesi WHERE token_hash = ?').run(sha(token));
}

export function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM sesi WHERE kedaluwarsa < ?').run(Date.now());
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, maxAgeSec = SESSION_TTL_MS / 1000) {
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`;
}

export const clearCookie = () => sessionCookie('', 0);

export function publicUser(u) {
  return {
    id: u.id_pengguna,
    nim: u.nim,
    nama: u.nama,
    panggilan: u.panggilan,
    email: u.email,
    peran: u.peran,
    spesialisasi: u.spesialisasi,
  };
}
