import { HttpError } from './http.js';

export function reqStr(v, name, { min = 1, max = 200 } = {}) {
  if (typeof v !== 'string') throw new HttpError(400, `${name} wajib diisi.`);
  const s = v.trim();
  if (s.length === 0) throw new HttpError(400, `${name} wajib diisi.`);
  if (s.length < min) throw new HttpError(400, `${name} minimal ${min} karakter.`);
  if (s.length > max) throw new HttpError(400, `${name} maksimal ${max} karakter.`);
  return s;
}

export function optStr(v, name, { max = 500 } = {}) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw new HttpError(400, `${name} tidak valid.`);
  const s = v.trim();
  if (s.length > max) throw new HttpError(400, `${name} maksimal ${max} karakter.`);
  return s || null;
}

export function reqInt(v, name, { min = -Infinity, max = Infinity } = {}) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(n)) throw new HttpError(400, `${name} harus berupa bilangan bulat.`);
  if (n < min || n > max) throw new HttpError(400, `${name} harus antara ${min} dan ${max}.`);
  return n;
}

export function reqEnum(v, name, values) {
  if (!values.includes(v)) throw new HttpError(400, `${name} tidak valid.`);
  return v;
}

// Menerima "YYYY-MM-DD HH:MM" atau "YYYY-MM-DDTHH:MM" lalu menormalkannya.
export function reqDateTime(v, name) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/.exec(typeof v === 'string' ? v.trim() : '');
  if (!m) throw new HttpError(400, `${name} tidak valid.`);
  const d = new Date(`${m[1]}T${m[2]}:00`);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${name} tidak valid.`);
  return `${m[1]} ${m[2]}:00`;
}

export function idParam(v, name = 'ID') {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `${name} tidak valid.`);
  return n;
}

// Deteksi jenis gambar dari byte awal berkas (bukan dari ekstensi/MIME yang dikirim klien).
export function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: '.png', type: 'image/png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: '.jpg', type: 'image/jpeg' };
  if (buf.toString('ascii', 0, 4) === 'GIF8') return { ext: '.gif', type: 'image/gif' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: '.webp', type: 'image/webp' };
  return null;
}
