// Pengujian black-box melalui HTTP untuk skenario UT-01 s.d. UT-09 pada laporan (Bab II, 2.8), ditambah uji keamanan dasar.
// Menjalankan server pada port acak dengan basis data sementara; tidak mengubah data asli.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'facilityops-test-'));
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.TZ = 'Asia/Makassar';

const { openDb } = await import('../server/db.js');
const { createServer, prepareDatabase } = await import('../server/server.js');

const db = openDb();
prepareDatabase(db);
const server = createServer(db);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data, headers: res.headers };
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}) { return this.req('POST', u, b); }
  put(u, b = {}) { return this.req('PUT', u, b); }
  patch(u, b = {}) { return this.req('PATCH', u, b); }
  del(u) { return this.req('DELETE', u); }
  async login(identifier, password) { return this.post('/api/auth/login', { identifier, password }); }
}
const asUser = async (id, pw) => { const c = new Client(); const r = await c.login(id, pw); assert.equal(r.status, 200, `login ${id}`); return c; };
const mhs = () => asUser('2508561005', 'mahasiswa123');
const adm = () => asUser('admin@unud.ac.id', 'admin123');
const tek = () => asUser('wayan.sudarma@unud.ac.id', 'teknisi123');

// Fasilitas yang bebas laporan aktif di Gedung Teknik A, Ruang Kuliah 3.03
const freeFacility = () => db.prepare(
  `SELECT f.id_fasilitas, f.nama_fasilitas FROM fasilitas f JOIN ruangan r ON r.id_ruangan = f.id_ruangan JOIN gedung g ON g.id_gedung = r.id_gedung
    WHERE g.nama_gedung = 'Gedung Teknik A' AND r.nomor_ruangan = '3.03' AND f.nama_fasilitas = 'Proyektor'`).get();

const state = {};

test('UT-01 login: akun valid masuk, akun tidak valid ditolak dengan pesan', async () => {
  const c = new Client();
  assert.equal((await c.login('2508561005', 'salah')).status, 401);
  assert.match((await c.login('tidak-ada@x.id', 'apa saja')).data.error, /salah/);
  assert.equal((await c.login('', 'x')).status, 400);
  const ok = await c.login('2508561005', 'mahasiswa123');
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.peran, 'pengguna');
  assert.equal((await c.login('manik.2508561005@student.unud.ac.id', 'mahasiswa123')).status, 200, 'login via email');
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await c.get('/api/auth/me')).data.user.nama.includes('Wisnu'), true);
});

test('logout menghapus sesi; tanpa login semua API ditolak (401)', async () => {
  const c = await mhs();
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/buildings')).status, 401);
  assert.equal((await new Client().get('/api/rooms/1')).status, 401);
  assert.equal((await new Client().get('/api/auth/me')).data.user, null);
});

test('UT-02 daftar gedung lalu ruangan pada gedung terpilih', async () => {
  const c = await mhs();
  const g = (await c.get('/api/buildings')).data;
  assert.equal(g.length, 6);
  const teknikA = g.find((x) => x.nama_gedung === 'Gedung Teknik A');
  assert.equal(teknikA.jumlah_ruangan, 12);
  const det = (await c.get(`/api/buildings/${teknikA.id_gedung}`)).data;
  assert.equal(det.ruangan.length, 12);
  assert.equal((await c.get('/api/buildings/9999')).status, 404);
});

test('UT-03 detail ruangan: status, jadwal, dan fasilitas sesuai data', async () => {
  const c = await mhs();
  const rooms = db.prepare('SELECT id_ruangan, status_ruangan FROM ruangan').all();
  for (const status of ['tersedia', 'digunakan', 'dibooking']) {
    const room = rooms.find((r) => r.status_ruangan === status);
    const d = (await c.get(`/api/rooms/${room.id_ruangan}`)).data;
    assert.equal(d.ruangan.status_ruangan, status);
    assert.ok(Array.isArray(d.jadwal) && d.jadwal.length > 0, `jadwal ${status}`);
    assert.ok(d.fasilitas.length > 0);
  }
  // Ruang Kuliah 3.02 mengikuti prototipe: 5 fasilitas dan jadwal tetap
  const r302 = db.prepare(`SELECT r.id_ruangan FROM ruangan r JOIN gedung g USING (id_gedung) WHERE g.nama_gedung='Gedung Teknik A' AND r.nomor_ruangan='3.02'`).get();
  const d = (await c.get(`/api/rooms/${r302.id_ruangan}`)).data;
  assert.deepEqual(d.fasilitas.map((f) => f.nama_fasilitas), ['Proyektor', 'AC split', 'Papan tulis', 'Stop kontak', 'Kursi kuliah']);
  assert.deepEqual(d.jadwal.filter((j) => j.type === 'jadwal').map((j) => j.keterangan), ['Pemrograman Web', 'Basis Data', 'Rekayasa Perangkat Lunak']);
  assert.equal((await c.get(`/api/rooms/${r302.id_ruangan}?tanggal=bukan-tanggal`)).status, 400);
});

test('UT-04 kirim laporan lengkap dengan foto → status menunggu verifikasi', async () => {
  const c = await mhs();
  const fas = freeFacility();
  const r = await c.post('/api/reports', { id_fasilitas: fas.id_fasilitas, kategori_kerusakan: 'Elektronik', tingkat_kerusakan: 'berat', deskripsi: 'Proyektor mati total dan berbau gosong saat dinyalakan.', foto: { data: `data:image/png;base64,${PNG}` } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.match(r.data.nomor_tiket, /^FOP-\d{8}-\d{4}$/);
  state.laporan = r.data.id_laporan;
  const mine = (await c.get('/api/reports/mine')).data;
  const item = mine.find((x) => x.id_laporan === state.laporan);
  assert.equal(item.status_laporan, 'menunggu');
  assert.equal(item.judul, 'Proyektor mati total dan berbau gosong saat dinyalakan');
  assert.equal(db.prepare('SELECT kondisi FROM fasilitas WHERE id_fasilitas=?').get(fas.id_fasilitas).kondisi, 'Rusak');
  // laporan ganda untuk fasilitas yang sama ditolak
  const dup = await c.post('/api/reports', { id_fasilitas: fas.id_fasilitas, kategori_kerusakan: 'Elektronik', tingkat_kerusakan: 'ringan', deskripsi: 'Laporan ganda untuk fasilitas yang sama.', foto: { data: PNG } });
  assert.equal(dup.status, 409);
  // foto bisa dilihat pemilik
  const photo = await c.req('GET', `/api/reports/${state.laporan}/photo`);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/png');
});

test('UT-05 laporan tanpa foto / file bukan gambar / terlalu besar ditolak', async () => {
  const c = await mhs();
  const fas = db.prepare(`SELECT id_fasilitas FROM fasilitas WHERE nama_fasilitas='Papan tulis' LIMIT 1`).get();
  const base = { id_fasilitas: fas.id_fasilitas, kategori_kerusakan: 'Furnitur', tingkat_kerusakan: 'ringan', deskripsi: 'Papan tulis sulit dihapus dan kusam.' };
  const noPhoto = await c.post('/api/reports', base);
  assert.equal(noPhoto.status, 400);
  assert.match(noPhoto.data.error, /Foto/);
  const text = await c.post('/api/reports', { ...base, foto: { data: Buffer.from('ini bukan gambar sama sekali, hanya teks biasa').toString('base64') } });
  assert.equal(text.status, 415);
  const svg = await c.post('/api/reports', { ...base, foto: { name: 'x.png', type: 'image/png', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64') } });
  assert.equal(svg.status, 415, 'SVG tidak boleh diunggah meski diberi nama .png');
  const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]), Buffer.alloc(5 * 1024 * 1024 + 10)]);
  assert.equal((await c.post('/api/reports', { ...base, foto: { data: big.toString('base64') } })).status, 413);
  assert.equal((await c.post('/api/reports', { ...base, deskripsi: 'pendek', foto: { data: PNG } })).status, 400);
  assert.equal((await c.post('/api/reports', { ...base, tingkat_kerusakan: 'kritis', foto: { data: PNG } })).status, 400);
  assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).filter((f) => !f.startsWith('seed-')).length, 1, 'tidak ada berkas yatim dari unggahan yang ditolak');
});

test('pengguna lain tidak boleh melihat foto laporan orang lain, admin boleh', async () => {
  const other = await asUser('2508561001', 'mahasiswa123');
  assert.equal((await other.get(`/api/reports/${state.laporan}/photo`)).status, 403);
  assert.equal((await (await adm()).get(`/api/reports/${state.laporan}/photo`)).status, 200);
});

test('UT-06 admin menyetujui dan menolak laporan', async () => {
  const a = await adm();
  const list = (await a.get('/api/admin/reports')).data;
  assert.equal(list[0].status_laporan, 'menunggu');
  assert.equal(list[0].tingkat_kerusakan, 'berat', 'laporan menunggu diurutkan dari yang paling berat');
  const stats0 = (await a.get('/api/admin/stats')).data;
  // tolak laporan seed (Stop kontak ringan) → kondisi fasilitas kembali Baik
  const stopKontak = list.find((r) => r.judul === 'Stop kontak longgar');
  const rej = await a.post(`/api/admin/reports/${stopKontak.id_laporan}/verify`, { keputusan: 'tolak', catatan: 'Sudah diperbaiki sendiri oleh petugas gedung.' });
  assert.equal(rej.data.status_laporan, 'ditolak');
  assert.equal(db.prepare('SELECT kondisi FROM fasilitas WHERE id_fasilitas=?').get(stopKontak.id_fasilitas).kondisi, 'Baik');
  assert.equal((await a.post(`/api/admin/reports/${stopKontak.id_laporan}/verify`, { keputusan: 'tolak' })).status, 409, 'tidak bisa diverifikasi dua kali');
  // setujui tanpa teknisi → 400
  assert.equal((await a.post(`/api/admin/reports/${state.laporan}/verify`, { keputusan: 'setujui' })).status, 400);
  // teknisi harus berperan teknisi
  const notTech = db.prepare(`SELECT id_pengguna FROM pengguna WHERE peran='pengguna' LIMIT 1`).get();
  assert.equal((await a.post(`/api/admin/reports/${state.laporan}/verify`, { keputusan: 'setujui', id_teknisi: notTech.id_pengguna })).status, 400);
  assert.equal((await a.get('/api/admin/stats')).data.ditolak, stats0.ditolak + 1);
});

test('UT-07 admin menugaskan teknisi → tugas muncul di daftar teknisi terpilih saja', async () => {
  const a = await adm();
  const techs = (await a.get('/api/admin/technicians')).data;
  const wayan = techs.find((t) => t.nama === 'Wayan Sudarma');
  const komang = techs.find((t) => t.nama === 'Komang Putra');
  const ok = await a.post(`/api/admin/reports/${state.laporan}/verify`, { keputusan: 'setujui', id_teknisi: wayan.id_pengguna });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.status_laporan, 'ditugaskan');
  assert.equal(ok.data.teknisi, 'Wayan Sudarma');
  const t1 = (await (await tek()).get('/api/tech/tasks')).data;
  assert.ok(t1.some((t) => t.id_laporan === state.laporan));
  const t2 = (await (await asUser('komang.putra@unud.ac.id', 'teknisi123')).get('/api/tech/tasks')).data;
  assert.ok(!t2.some((t) => t.id_laporan === state.laporan));
  assert.ok(komang);
  state.perbaikan = t1.find((t) => t.id_laporan === state.laporan).id_perbaikan;
});

test('UT-08 teknisi memperbarui status dan mencatat hasil → riwayat tersimpan', async () => {
  const t = await tek();
  const fasId = freeFacility().id_fasilitas;
  const step1 = await t.patch(`/api/tech/tasks/${state.perbaikan}`, { status: 'diperbaiki', tindakan: 'Memeriksa power supply proyektor.' });
  assert.equal(step1.data.status_laporan, 'diperbaiki');
  assert.equal(db.prepare('SELECT kondisi FROM fasilitas WHERE id_fasilitas=?').get(fasId).kondisi, 'Dalam perbaikan');
  assert.equal((await t.patch(`/api/tech/tasks/${state.perbaikan}`, { status: 'selesai', tindakan: '' })).status, 400, 'selesai wajib punya catatan');
  const done = await t.patch(`/api/tech/tasks/${state.perbaikan}`, { status: 'selesai', tindakan: 'Mengganti power supply dan menguji proyektor.' });
  assert.equal(done.status, 200);
  assert.equal(done.data.status_perbaikan, 'selesai');
  assert.ok(done.data.tanggal_selesai);
  assert.equal(db.prepare('SELECT kondisi FROM fasilitas WHERE id_fasilitas=?').get(fasId).kondisi, 'Baik');
  assert.equal((await t.patch(`/api/tech/tasks/${state.perbaikan}`, { status: 'diperbaiki' })).status, 409, 'tugas selesai terkunci');
  assert.ok((await t.get('/api/tech/history')).data.some((h) => h.id_laporan === state.laporan));
  const hist = (await (await adm()).get(`/api/admin/history?id_fasilitas=${fasId}`)).data;
  assert.equal(hist.length, 1);
  assert.match(hist[0].tindakan, /power supply/);
  // pelapor melihat hasilnya
  const mine = (await (await mhs()).get('/api/reports/mine')).data.find((x) => x.id_laporan === state.laporan);
  assert.equal(mine.status_laporan, 'selesai');
  // teknisi lain tidak bisa mengubah tugas orang lain
  const komang = await asUser('komang.putra@unud.ac.id', 'teknisi123');
  assert.equal((await komang.patch(`/api/tech/tasks/${state.perbaikan}`, { status: 'diperbaiki' })).status, 404);
});

test('UT-09 pembatasan akses per peran', async () => {
  const m = await mhs();
  for (const u of ['/api/admin/stats', '/api/admin/reports', '/api/admin/gedung', '/api/admin/history', '/api/tech/tasks']) {
    assert.equal((await m.get(u)).status, 403, u);
  }
  assert.equal((await m.post('/api/admin/reports/1/verify', { keputusan: 'setujui' })).status, 403);
  const t = await tek();
  assert.equal((await t.get('/api/admin/reports')).status, 403);
  assert.equal((await t.post('/api/reports', {})).status, 403, 'teknisi tidak membuat laporan');
  const a = await adm();
  assert.equal((await a.get('/api/tech/tasks')).status, 403);
  assert.equal((await a.get('/api/reports/mine')).status, 403);
});

test('FR-13 admin mengelola data gedung, ruangan, fasilitas, jadwal (CRUD) + validasi', async () => {
  const a = await adm();
  const g = await a.post('/api/admin/gedung', { nama_gedung: 'Gedung Uji', keterangan: 'Untuk pengujian', jumlah_lantai: 2, warna: 'teal' });
  assert.equal(g.status, 201);
  assert.equal((await a.post('/api/admin/gedung', { nama_gedung: 'Gedung Uji', jumlah_lantai: 1 })).status, 409, 'nama gedung unik');
  assert.equal((await a.post('/api/admin/gedung', { nama_gedung: 'X', jumlah_lantai: 0 })).status, 400);
  const r = await a.post('/api/admin/ruangan', { id_gedung: g.data.id_gedung, nama_ruangan: 'Ruang Uji 1.01', nomor_ruangan: '1.01', lantai: 1, kapasitas: 20, status_ruangan: 'tersedia' });
  assert.equal(r.status, 201);
  assert.equal((await a.post('/api/admin/ruangan', { id_gedung: 99999, nama_ruangan: 'x', nomor_ruangan: '1', lantai: 1, kapasitas: 1 })).status, 400);
  const f = await a.post('/api/admin/fasilitas', { id_ruangan: r.data.id_ruangan, nama_fasilitas: 'Proyektor uji', kategori: 'Elektronik', kondisi: 'Baik' });
  assert.equal(f.status, 201);
  assert.equal((await a.put(`/api/admin/fasilitas/${f.data.id_fasilitas}`, { id_ruangan: r.data.id_ruangan, nama_fasilitas: 'Proyektor uji 2', kategori: 'Elektronik', kondisi: 'Rusak' })).status, 200);
  assert.equal(db.prepare('SELECT kondisi FROM fasilitas WHERE id_fasilitas=?').get(f.data.id_fasilitas).kondisi, 'Rusak');

  const day = '2031-05-05';
  const j = await a.post('/api/admin/jadwal', { id_ruangan: r.data.id_ruangan, waktu_mulai: `${day}T08:00`, waktu_selesai: `${day}T09:40`, keterangan: 'Kuliah uji' });
  assert.equal(j.status, 201);
  assert.equal((await a.post('/api/admin/jadwal', { id_ruangan: r.data.id_ruangan, waktu_mulai: `${day}T09:00`, waktu_selesai: `${day}T10:00` })).status, 409, 'jadwal bertabrakan');
  assert.equal((await a.post('/api/admin/jadwal', { id_ruangan: r.data.id_ruangan, waktu_mulai: `${day}T11:00`, waktu_selesai: `${day}T10:00` })).status, 400);
  assert.equal((await a.get(`/api/admin/jadwal?tanggal=${day}`)).data.length, 1);
  const view = (await (await mhs()).get(`/api/rooms/${r.data.id_ruangan}?tanggal=${day}`)).data;
  assert.equal(view.jadwal[0].type, 'kosong');
  assert.equal(view.jadwal.find((x) => x.type === 'jadwal').keterangan, 'Kuliah uji');

  // fasilitas yang punya riwayat laporan tidak boleh terhapus
  assert.equal((await a.del(`/api/admin/fasilitas/${freeFacility().id_fasilitas}`)).status, 409);
  // gedung baru bisa dihapus (cascade ke ruangan, fasilitas, jadwal)
  assert.equal((await a.del(`/api/admin/gedung/${g.data.id_gedung}`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM fasilitas WHERE id_fasilitas=?').get(f.data.id_fasilitas).c, 0);
  assert.equal((await a.del(`/api/admin/gedung/${g.data.id_gedung}`)).status, 404);
});

test('keamanan: kata sandi ter-hash, CSRF lintas origin, path traversal, rate limit login', async () => {
  const rows = db.prepare('SELECT kata_sandi FROM pengguna').all();
  assert.ok(rows.every((r) => r.kata_sandi.startsWith('scrypt$') && !r.kata_sandi.includes('123')));
  const tokenRow = db.prepare('SELECT token_hash FROM sesi LIMIT 1').get();
  assert.equal(tokenRow.token_hash.length, 64, 'token sesi disimpan sebagai hash');

  const c = await mhs();
  assert.equal((await c.req('POST', '/api/auth/logout', {}, { Origin: 'https://evil.example' })).status, 403);

  const trav = await fetch(`${base}/..%2f..%2fetc%2fpasswd`);
  assert.ok([403, 404].includes(trav.status));
  const trav2 = await fetch(`${base}/%2e%2e/server/db.js`);
  assert.ok([403, 404].includes(trav2.status));
  assert.equal((await fetch(`${base}/`)).status, 200);

  const bad = new Client();
  let last;
  for (let i = 0; i < 10; i++) last = await bad.login('ratelimit@x.id', 'salah');
  assert.equal(last.status, 429);

  const html = await fetch(`${base}/`);
  assert.match(html.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(html.headers.get('x-frame-options'), 'DENY');
});
