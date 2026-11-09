import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, FileResponse, mimeFor } from './http.js';
import { tx, UPLOAD_DIR } from './db.js';
import * as auth from './auth.js';
import { reqStr, optStr, reqInt, reqEnum, reqDateTime, idParam, sniffImage } from './validate.js';
import { fmtDate, fmtDateTime, parseLocal, addDays, toMinutes, fromMinutes, pad } from './util.js';

export const META = {
  kategori: ['Elektronik', 'Listrik', 'Pendingin Udara', 'Furnitur', 'Bangunan', 'Plumbing', 'Lainnya'],
  tingkat: ['ringan', 'sedang', 'berat'],
  kondisi: ['Baik', 'Rusak', 'Dalam perbaikan'],
  statusRuangan: ['tersedia', 'digunakan', 'dibooking'],
  warna: ['blue', 'green', 'orange', 'purple', 'teal', 'pink'],
};
const ACTIVE = ['menunggu', 'ditugaskan', 'diperbaiki'];
const MAX_PHOTO = 5 * 1024 * 1024;
const DAY_OPEN = toMinutes('07:30');
const DAY_CLOSE = toMinutes('17:00');

// Pembatas percobaan login (per IP + akun), cukup untuk satu proses.
const attempts = new Map();
function checkRate(key) {
  const e = attempts.get(key);
  if (e && e.until > Date.now() && e.count >= 8)
    throw new HttpError(429, 'Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi.');
}
function noteFail(key) {
  const now = Date.now();
  const e = attempts.get(key);
  if (!e || e.until < now) attempts.set(key, { count: 1, until: now + 10 * 60 * 1000 });
  else e.count++;
}

const REPORT_SELECT = `
SELECT l.id_laporan, l.nomor_tiket, l.judul, l.kategori_kerusakan, l.tingkat_kerusakan, l.deskripsi,
       l.status_laporan, l.catatan_admin, l.dibuat_pada, l.diverifikasi_pada,
       f.id_fasilitas, f.nama_fasilitas, f.kondisi AS kondisi_fasilitas,
       r.id_ruangan, r.nama_ruangan, r.nomor_ruangan, g.id_gedung, g.nama_gedung,
       pel.nama AS pelapor,
       pb.id_perbaikan, pb.status_perbaikan, pb.tindakan, pb.tanggal_ditugaskan, pb.tanggal_selesai, pb.diperbarui_pada,
       pb.id_teknisi, t.nama AS teknisi, t.spesialisasi AS spesialisasi_teknisi
  FROM laporan l
  JOIN fasilitas f ON f.id_fasilitas = l.id_fasilitas
  JOIN ruangan r ON r.id_ruangan = f.id_ruangan
  JOIN gedung g ON g.id_gedung = r.id_gedung
  JOIN pengguna pel ON pel.id_pengguna = l.id_pelapor
  LEFT JOIN perbaikan pb ON pb.id_laporan = l.id_laporan
  LEFT JOIN pengguna t ON t.id_pengguna = pb.id_teknisi`;

const shapeReport = (row) => ({ ...row, foto_url: `/api/reports/${row.id_laporan}/photo` });

function makeJudul(deskripsi) {
  const first = deskripsi.split(/[.!?\n]/)[0].trim() || deskripsi.trim();
  if (first.length <= 60) return first;
  const cut = first.slice(0, 57);
  return cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 57) + '…';
}

export function nextTicket(db, when = new Date()) {
  const prefix = `FOP-${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}-`;
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM laporan WHERE nomor_tiket LIKE ?').get(prefix + '%');
  return prefix + String(c + 1).padStart(4, '0');
}

// Susun jadwal satu hari: entri jadwal + slot kosong (>= 30 menit) di jam operasional.
function buildDay(rows, dateStr, now) {
  const today = fmtDate(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const items = [];
  let cursor = DAY_OPEN;
  for (const row of rows) {
    const s = toMinutes(row.waktu_mulai.slice(11, 16));
    const e = toMinutes(row.waktu_selesai.slice(11, 16));
    if (s - cursor >= 30) items.push({ type: 'kosong', mulai: fromMinutes(cursor), selesai: fromMinutes(s) });
    items.push({
      type: 'jadwal', id_jadwal: row.id_jadwal, mulai: fromMinutes(s), selesai: fromMinutes(e),
      keterangan: row.keterangan || 'Terjadwal',
    });
    cursor = Math.max(cursor, e);
  }
  if (DAY_CLOSE - cursor >= 30) items.push({ type: 'kosong', mulai: fromMinutes(cursor), selesai: fromMinutes(DAY_CLOSE) });

  let nextMarked = false;
  for (const it of items) {
    if (it.type === 'kosong') { it.state = 'kosong'; continue; }
    const s = toMinutes(it.mulai);
    const e = toMinutes(it.selesai);
    if (dateStr < today) it.state = 'selesai';
    else if (dateStr > today) it.state = 'terjadwal';
    else if (e <= nowMin) it.state = 'selesai';
    else if (s <= nowMin) it.state = 'berlangsung';
    else if (!nextMarked) { it.state = 'berikutnya'; nextMarked = true; }
    else it.state = 'terjadwal';
  }
  return items;
}

export function registerRoutes(r, db) {
  const authed = (...roles) => (ctx) => {
    if (!ctx.user) throw new HttpError(401, 'Silakan masuk terlebih dahulu.');
    if (roles.length && !roles.includes(ctx.user.peran)) throw new HttpError(403, 'Anda tidak memiliki akses ke fitur ini.');
  };
  const any = authed();
  const adminOnly = authed('admin');
  const exists = (table, pk, id) => !!db.prepare(`SELECT 1 FROM ${table} WHERE ${pk} = ?`).get(id);

  // ------------------------------------------------------------------ Autentikasi (FR-01)
  r.post('/api/auth/login', (ctx) => {
    const identifier = reqStr(ctx.body.identifier, 'NIM atau email', { max: 120 });
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    if (!password) throw new HttpError(400, 'Kata sandi wajib diisi.');
    const key = `${ctx.req.socket.remoteAddress}|${identifier.toLowerCase()}`;
    checkRate(key);
    const u = db.prepare('SELECT * FROM pengguna WHERE nim = ? OR lower(email) = lower(?)').get(identifier, identifier);
    const ok = u ? auth.verifyPassword(password, u.kata_sandi) : (auth.verifyPassword(password, auth.DUMMY_HASH), false);
    if (!ok) {
      noteFail(key);
      throw new HttpError(401, 'NIM/email atau kata sandi salah.');
    }
    attempts.delete(key);
    const token = auth.createSession(db, u.id_pengguna);
    ctx.headers['Set-Cookie'] = auth.sessionCookie(token);
    return { user: auth.publicUser(u) };
  });

  r.post('/api/auth/logout', (ctx) => {
    auth.destroySession(db, ctx.cookies[auth.COOKIE_NAME]);
    ctx.headers['Set-Cookie'] = auth.clearCookie();
    return { ok: true };
  });

  r.get('/api/auth/me', (ctx) => ({ user: ctx.user ? auth.publicUser(ctx.user) : null }));
  r.get('/api/meta', any, () => META);

  // ------------------------------------------------------------------ Informasi gedung & ruangan (FR-02..06)
  r.get('/api/buildings', any, () =>
    db.prepare(
      `SELECT g.id_gedung, g.nama_gedung, g.keterangan, g.jumlah_lantai, g.warna,
              (SELECT COUNT(*) FROM ruangan r WHERE r.id_gedung = g.id_gedung) AS jumlah_ruangan
         FROM gedung g ORDER BY g.id_gedung`,
    ).all(),
  );

  r.get('/api/buildings/:id', any, (ctx) => {
    const id = idParam(ctx.params.id, 'ID gedung');
    const gedung = db.prepare('SELECT * FROM gedung WHERE id_gedung = ?').get(id);
    if (!gedung) throw new HttpError(404, 'Gedung tidak ditemukan.');
    const ruangan = db
      .prepare('SELECT * FROM ruangan WHERE id_gedung = ? ORDER BY id_ruangan')
      .all(id);
    return { gedung, ruangan };
  });

  r.get('/api/rooms/:id', any, (ctx) => {
    const id = idParam(ctx.params.id, 'ID ruangan');
    const ruangan = db
      .prepare(
        `SELECT r.*, g.nama_gedung FROM ruangan r JOIN gedung g ON g.id_gedung = r.id_gedung WHERE r.id_ruangan = ?`,
      )
      .get(id);
    if (!ruangan) throw new HttpError(404, 'Ruangan tidak ditemukan.');
    const now = new Date();
    let tanggal = ctx.query.tanggal || fmtDate(now);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) throw new HttpError(400, 'Format tanggal tidak valid.');
    const rows = db
      .prepare('SELECT * FROM jadwal WHERE id_ruangan = ? AND substr(waktu_mulai, 1, 10) = ? ORDER BY waktu_mulai')
      .all(id, tanggal);
    const fasilitas = db
      .prepare(
        `SELECT f.*, EXISTS(SELECT 1 FROM laporan l WHERE l.id_fasilitas = f.id_fasilitas
                             AND l.status_laporan IN ('menunggu','ditugaskan','diperbaiki')) AS laporan_aktif
           FROM fasilitas f WHERE f.id_ruangan = ? ORDER BY f.id_fasilitas`,
      )
      .all(id);
    return { ruangan, tanggal, hari_ini: fmtDate(now), jadwal: buildDay(rows, tanggal, now), fasilitas };
  });

  // ------------------------------------------------------------------ Pelaporan kerusakan (FR-07, FR-14)
  r.post('/api/reports', authed('pengguna'), (ctx) => {
    const b = ctx.body;
    const idFasilitas = reqInt(b.id_fasilitas, 'Fasilitas', { min: 1 });
    const kategori = reqEnum(b.kategori_kerusakan, 'Kategori', META.kategori);
    const tingkat = reqEnum(b.tingkat_kerusakan, 'Tingkat kerusakan', META.tingkat);
    const deskripsi = reqStr(b.deskripsi, 'Deskripsi', { min: 10, max: 1000 });

    const foto = b.foto;
    if (!foto || typeof foto.data !== 'string' || !foto.data) throw new HttpError(400, 'Foto kerusakan wajib dilampirkan.');
    const b64 = foto.data.replace(/^data:[^;]+;base64,/, '');
    if (b64.length > Math.ceil((MAX_PHOTO * 4) / 3) + 8) throw new HttpError(413, 'Ukuran foto maksimal 5 MB.');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > MAX_PHOTO) throw new HttpError(413, 'Ukuran foto maksimal 5 MB.');
    const kind = sniffImage(buf);
    if (!kind) throw new HttpError(415, 'Format foto tidak didukung. Gunakan JPG, PNG, WEBP, atau GIF.');

    const fas = db.prepare('SELECT * FROM fasilitas WHERE id_fasilitas = ?').get(idFasilitas);
    if (!fas) throw new HttpError(404, 'Fasilitas tidak ditemukan.');

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const filename = `${crypto.randomUUID()}${kind.ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
    try {
      const created = tx(db, () => {
        const dup = db
          .prepare(`SELECT 1 FROM laporan WHERE id_fasilitas = ? AND status_laporan IN ('menunggu','ditugaskan','diperbaiki')`)
          .get(idFasilitas);
        if (dup) throw new HttpError(409, 'Fasilitas ini sudah memiliki laporan yang sedang diproses.');
        const now = new Date();
        const tiket = nextTicket(db, now);
        const res = db
          .prepare(
            `INSERT INTO laporan (nomor_tiket, id_fasilitas, id_pelapor, judul, foto, kategori_kerusakan,
                                  tingkat_kerusakan, deskripsi, status_laporan, kondisi_sebelum, dibuat_pada)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'menunggu', ?, ?)`,
          )
          .run(tiket, idFasilitas, ctx.user.id_pengguna, makeJudul(deskripsi), filename, kategori, tingkat, deskripsi, fas.kondisi, fmtDateTime(now));
        db.prepare(`UPDATE fasilitas SET kondisi = 'Rusak' WHERE id_fasilitas = ?`).run(idFasilitas);
        return { id_laporan: Number(res.lastInsertRowid), nomor_tiket: tiket };
      });
      ctx.status = 201;
      return created;
    } catch (err) {
      fs.rmSync(path.join(UPLOAD_DIR, filename), { force: true });
      throw err;
    }
  });

  r.get('/api/reports/mine', authed('pengguna'), (ctx) =>
    db.prepare(`${REPORT_SELECT} WHERE l.id_pelapor = ? ORDER BY l.dibuat_pada DESC, l.id_laporan DESC`)
      .all(ctx.user.id_pengguna).map(shapeReport),
  );

  r.get('/api/reports/:id/photo', any, (ctx) => {
    const id = idParam(ctx.params.id, 'ID laporan');
    const row = db.prepare('SELECT foto, id_pelapor FROM laporan WHERE id_laporan = ?').get(id);
    if (!row) throw new HttpError(404, 'Foto tidak ditemukan.');
    if (ctx.user.peran === 'pengguna' && row.id_pelapor !== ctx.user.id_pengguna)
      throw new HttpError(403, 'Anda tidak memiliki akses ke foto ini.');
    const file = path.join(UPLOAD_DIR, path.basename(row.foto));
    if (!fs.existsSync(file)) throw new HttpError(404, 'Berkas foto tidak ditemukan.');
    return new FileResponse(fs.readFileSync(file), mimeFor(file));
  });

  // ------------------------------------------------------------------ Admin: verifikasi & monitoring (FR-08, FR-09, FR-12)
  r.get('/api/admin/stats', adminOnly, () => {
    const out = { menunggu: 0, ditugaskan: 0, diperbaiki: 0, selesai: 0, ditolak: 0 };
    for (const row of db.prepare('SELECT status_laporan s, COUNT(*) c FROM laporan GROUP BY status_laporan').all()) out[row.s] = row.c;
    out.total = Object.values(out).reduce((a, b) => a + b, 0);
    return out;
  });

  r.get('/api/admin/technicians', adminOnly, () =>
    db.prepare(
      `SELECT p.id_pengguna, p.nama, p.spesialisasi,
              (SELECT COUNT(*) FROM perbaikan pb WHERE pb.id_teknisi = p.id_pengguna AND pb.status_perbaikan != 'selesai') AS tugas_aktif
         FROM pengguna p WHERE p.peran = 'teknisi' ORDER BY p.nama`,
    ).all(),
  );

  r.get('/api/admin/reports', adminOnly, (ctx) => {
    const rows = db
      .prepare(
        `${REPORT_SELECT}
         ORDER BY CASE l.status_laporan WHEN 'menunggu' THEN 0 WHEN 'ditugaskan' THEN 1 WHEN 'diperbaiki' THEN 2 ELSE 3 END,
                  CASE WHEN l.status_laporan = 'menunggu'
                       THEN CASE l.tingkat_kerusakan WHEN 'berat' THEN 0 WHEN 'sedang' THEN 1 ELSE 2 END ELSE 0 END,
                  l.dibuat_pada DESC, l.id_laporan DESC`,
      )
      .all()
      .map(shapeReport);
    return ctx.query.status ? rows.filter((x) => x.status_laporan === ctx.query.status) : rows;
  });

  r.post('/api/admin/reports/:id/verify', adminOnly, (ctx) => {
    const id = idParam(ctx.params.id, 'ID laporan');
    const keputusan = reqEnum(ctx.body.keputusan, 'Keputusan', ['setujui', 'tolak']);
    const catatan = optStr(ctx.body.catatan, 'Catatan', { max: 500 });
    const lap = db.prepare('SELECT * FROM laporan WHERE id_laporan = ?').get(id);
    if (!lap) throw new HttpError(404, 'Laporan tidak ditemukan.');
    if (lap.status_laporan !== 'menunggu') throw new HttpError(409, 'Laporan ini sudah diverifikasi sebelumnya.');
    const now = fmtDateTime();

    if (keputusan === 'setujui') {
      const idTeknisi = reqInt(ctx.body.id_teknisi, 'Teknisi', { min: 1 });
      const tek = db.prepare(`SELECT 1 FROM pengguna WHERE id_pengguna = ? AND peran = 'teknisi'`).get(idTeknisi);
      if (!tek) throw new HttpError(400, 'Teknisi yang dipilih tidak valid.');
      tx(db, () => {
        db.prepare(
          `UPDATE laporan SET status_laporan = 'ditugaskan', id_admin = ?, catatan_admin = ?, diverifikasi_pada = ? WHERE id_laporan = ?`,
        ).run(ctx.user.id_pengguna, catatan, now, id);
        db.prepare(
          `INSERT INTO perbaikan (id_laporan, id_teknisi, tanggal_ditugaskan, status_perbaikan, diperbarui_pada)
           VALUES (?, ?, ?, 'ditugaskan', ?)`,
        ).run(id, idTeknisi, now, now);
      });
    } else {
      tx(db, () => {
        db.prepare(
          `UPDATE laporan SET status_laporan = 'ditolak', id_admin = ?, catatan_admin = ?, diverifikasi_pada = ? WHERE id_laporan = ?`,
        ).run(ctx.user.id_pengguna, catatan, now, id);
        // Laporan ditolak: kembalikan kondisi fasilitas seperti sebelum dilaporkan.
        db.prepare('UPDATE fasilitas SET kondisi = ? WHERE id_fasilitas = ?').run(lap.kondisi_sebelum || 'Baik', lap.id_fasilitas);
      });
    }
    return shapeReport(db.prepare(`${REPORT_SELECT} WHERE l.id_laporan = ?`).get(id));
  });

  r.get('/api/admin/history', adminOnly, (ctx) => {
    const where = [`pb.status_perbaikan = 'selesai'`];
    const args = [];
    if (ctx.query.id_fasilitas) { where.push('f.id_fasilitas = ?'); args.push(idParam(ctx.query.id_fasilitas, 'ID fasilitas')); }
    return db
      .prepare(
        `SELECT pb.id_perbaikan, l.id_laporan, l.nomor_tiket, l.judul, l.tingkat_kerusakan, l.kategori_kerusakan,
                f.id_fasilitas, f.nama_fasilitas, r.nama_ruangan, r.nomor_ruangan, g.nama_gedung,
                pb.tindakan, pb.tanggal_ditugaskan, pb.tanggal_selesai, t.nama AS teknisi
           FROM perbaikan pb
           JOIN laporan l ON l.id_laporan = pb.id_laporan
           JOIN fasilitas f ON f.id_fasilitas = l.id_fasilitas
           JOIN ruangan r ON r.id_ruangan = f.id_ruangan
           JOIN gedung g ON g.id_gedung = r.id_gedung
           JOIN pengguna t ON t.id_pengguna = pb.id_teknisi
          WHERE ${where.join(' AND ')}
          ORDER BY pb.tanggal_selesai DESC LIMIT 500`,
      )
      .all(...args);
  });

  // ------------------------------------------------------------------ Teknisi (FR-10, FR-11)
  r.get('/api/tech/tasks', authed('teknisi'), (ctx) => {
    const since = fmtDateTime(addDays(new Date(), -7));
    return db
      .prepare(
        `${REPORT_SELECT}
          WHERE pb.id_teknisi = ? AND (pb.status_perbaikan != 'selesai' OR pb.tanggal_selesai >= ?)
          ORDER BY CASE pb.status_perbaikan WHEN 'ditugaskan' THEN 0 WHEN 'diperbaiki' THEN 1 ELSE 2 END,
                   pb.tanggal_ditugaskan DESC`,
      )
      .all(ctx.user.id_pengguna, since)
      .map(shapeReport);
  });

  r.get('/api/tech/history', authed('teknisi'), (ctx) =>
    db
      .prepare(
        `${REPORT_SELECT} WHERE pb.id_teknisi = ? AND pb.status_perbaikan = 'selesai' ORDER BY pb.tanggal_selesai DESC LIMIT 200`,
      )
      .all(ctx.user.id_pengguna)
      .map(shapeReport),
  );

  r.patch('/api/tech/tasks/:id', authed('teknisi'), (ctx) => {
    const id = idParam(ctx.params.id, 'ID perbaikan');
    const status = reqEnum(ctx.body.status, 'Status', ['ditugaskan', 'diperbaiki', 'selesai']);
    const tindakan = optStr(ctx.body.tindakan, 'Catatan perbaikan', { max: 1000 });
    const pb = db.prepare('SELECT * FROM perbaikan WHERE id_perbaikan = ?').get(id);
    if (!pb || pb.id_teknisi !== ctx.user.id_pengguna) throw new HttpError(404, 'Tugas tidak ditemukan.');
    if (pb.status_perbaikan === 'selesai') throw new HttpError(409, 'Tugas yang sudah selesai tidak dapat diubah.');
    if (status === 'selesai' && (!tindakan || tindakan.length < 5))
      throw new HttpError(400, 'Catatan perbaikan wajib diisi (minimal 5 karakter) untuk menyelesaikan tugas.');

    const now = fmtDateTime();
    tx(db, () => {
      const lap = db.prepare('SELECT id_fasilitas FROM laporan WHERE id_laporan = ?').get(pb.id_laporan);
      db.prepare(
        `UPDATE perbaikan SET status_perbaikan = ?, tindakan = COALESCE(?, tindakan), tanggal_selesai = ?, diperbarui_pada = ?
          WHERE id_perbaikan = ?`,
      ).run(status, tindakan, status === 'selesai' ? now : null, now, id);
      db.prepare('UPDATE laporan SET status_laporan = ? WHERE id_laporan = ?').run(status, pb.id_laporan);
      const kondisi = { ditugaskan: 'Rusak', diperbaiki: 'Dalam perbaikan', selesai: 'Baik' }[status];
      db.prepare('UPDATE fasilitas SET kondisi = ? WHERE id_fasilitas = ?').run(kondisi, lap.id_fasilitas);
    });
    return shapeReport(db.prepare(`${REPORT_SELECT} WHERE pb.id_perbaikan = ?`).get(id));
  });

  // ------------------------------------------------------------------ Admin: kelola data master (FR-13)
  const ENT = {
    gedung: {
      table: 'gedung', pk: 'id_gedung',
      list: () => db.prepare(
        `SELECT g.*, (SELECT COUNT(*) FROM ruangan r WHERE r.id_gedung = g.id_gedung) AS jumlah_ruangan FROM gedung g ORDER BY g.id_gedung`,
      ).all(),
      spec: (b) => ({
        nama_gedung: reqStr(b.nama_gedung, 'Nama gedung', { max: 80 }),
        keterangan: optStr(b.keterangan, 'Keterangan', { max: 200 }),
        jumlah_lantai: reqInt(b.jumlah_lantai, 'Jumlah lantai', { min: 1, max: 50 }),
        warna: reqEnum(b.warna ?? 'blue', 'Warna', META.warna),
      }),
    },
    ruangan: {
      table: 'ruangan', pk: 'id_ruangan',
      list: () => db.prepare(
        `SELECT r.*, g.nama_gedung FROM ruangan r JOIN gedung g ON g.id_gedung = r.id_gedung
          ORDER BY g.id_gedung, r.lantai, r.nomor_ruangan`,
      ).all(),
      spec: (b) => {
        const id_gedung = reqInt(b.id_gedung, 'Gedung', { min: 1 });
        if (!exists('gedung', 'id_gedung', id_gedung)) throw new HttpError(400, 'Gedung tidak ditemukan.');
        return {
          id_gedung,
          nama_ruangan: reqStr(b.nama_ruangan, 'Nama ruangan', { max: 80 }),
          nomor_ruangan: reqStr(b.nomor_ruangan, 'Nomor ruangan', { max: 20 }),
          lantai: reqInt(b.lantai, 'Lantai', { min: 0, max: 50 }),
          kapasitas: reqInt(b.kapasitas, 'Kapasitas', { min: 0, max: 5000 }),
          status_ruangan: reqEnum(b.status_ruangan ?? 'tersedia', 'Status ruangan', META.statusRuangan),
        };
      },
    },
    fasilitas: {
      table: 'fasilitas', pk: 'id_fasilitas',
      list: () => db.prepare(
        `SELECT f.*, r.nama_ruangan, r.nomor_ruangan, g.id_gedung, g.nama_gedung
           FROM fasilitas f JOIN ruangan r ON r.id_ruangan = f.id_ruangan JOIN gedung g ON g.id_gedung = r.id_gedung
          ORDER BY g.id_gedung, r.lantai, r.nomor_ruangan, f.id_fasilitas`,
      ).all(),
      spec: (b) => {
        const id_ruangan = reqInt(b.id_ruangan, 'Ruangan', { min: 1 });
        if (!exists('ruangan', 'id_ruangan', id_ruangan)) throw new HttpError(400, 'Ruangan tidak ditemukan.');
        return {
          id_ruangan,
          nama_fasilitas: reqStr(b.nama_fasilitas, 'Nama fasilitas', { max: 80 }),
          kategori: reqEnum(b.kategori ?? 'Lainnya', 'Kategori', META.kategori),
          kondisi: reqEnum(b.kondisi ?? 'Baik', 'Kondisi', META.kondisi),
        };
      },
    },
    jadwal: {
      table: 'jadwal', pk: 'id_jadwal',
      list: (ctx) => db.prepare(
        `SELECT j.*, r.nama_ruangan, r.nomor_ruangan, g.id_gedung, g.nama_gedung
           FROM jadwal j JOIN ruangan r ON r.id_ruangan = j.id_ruangan JOIN gedung g ON g.id_gedung = r.id_gedung
          WHERE substr(j.waktu_mulai, 1, 10) = ? ORDER BY j.waktu_mulai, g.id_gedung, r.nomor_ruangan`,
      ).all(/^\d{4}-\d{2}-\d{2}$/.test(ctx.query.tanggal || '') ? ctx.query.tanggal : fmtDate()),
      spec: (b, id) => {
        const id_ruangan = reqInt(b.id_ruangan, 'Ruangan', { min: 1 });
        if (!exists('ruangan', 'id_ruangan', id_ruangan)) throw new HttpError(400, 'Ruangan tidak ditemukan.');
        const waktu_mulai = reqDateTime(b.waktu_mulai, 'Waktu mulai');
        const waktu_selesai = reqDateTime(b.waktu_selesai, 'Waktu selesai');
        if (waktu_mulai.slice(0, 10) !== waktu_selesai.slice(0, 10)) throw new HttpError(400, 'Waktu mulai dan selesai harus pada tanggal yang sama.');
        if (waktu_selesai <= waktu_mulai) throw new HttpError(400, 'Waktu selesai harus setelah waktu mulai.');
        const clash = db.prepare(
          `SELECT 1 FROM jadwal WHERE id_ruangan = ? AND id_jadwal != ? AND waktu_mulai < ? AND waktu_selesai > ?`,
        ).get(id_ruangan, id ?? -1, waktu_selesai, waktu_mulai);
        if (clash) throw new HttpError(409, 'Jadwal bertabrakan dengan jadwal lain pada ruangan yang sama.');
        return { id_ruangan, waktu_mulai, waktu_selesai, keterangan: optStr(b.keterangan, 'Keterangan', { max: 150 }) };
      },
    },
  };

  for (const [name, ent] of Object.entries(ENT)) {
    r.get(`/api/admin/${name}`, adminOnly, (ctx) => ent.list(ctx));

    r.post(`/api/admin/${name}`, adminOnly, (ctx) => {
      const data = ent.spec(ctx.body);
      const cols = Object.keys(data);
      const res = db
        .prepare(`INSERT INTO ${ent.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...cols.map((c) => data[c]));
      ctx.status = 201;
      return { [ent.pk]: Number(res.lastInsertRowid) };
    });

    r.put(`/api/admin/${name}/:id`, adminOnly, (ctx) => {
      const id = idParam(ctx.params.id);
      const data = ent.spec(ctx.body, id);
      const cols = Object.keys(data);
      const res = db
        .prepare(`UPDATE ${ent.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${ent.pk} = ?`)
        .run(...cols.map((c) => data[c]), id);
      if (!res.changes) throw new HttpError(404, 'Data tidak ditemukan.');
      return { ok: true };
    });

    r.delete(`/api/admin/${name}/:id`, adminOnly, (ctx) => {
      const id = idParam(ctx.params.id);
      const res = db.prepare(`DELETE FROM ${ent.table} WHERE ${ent.pk} = ?`).run(id);
      if (!res.changes) throw new HttpError(404, 'Data tidak ditemukan.');
      return { ok: true };
    });
  }
}
