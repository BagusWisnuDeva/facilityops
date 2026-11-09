import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, tx, DB_FILE, UPLOAD_DIR } from './db.js';
import { hashPassword } from './auth.js';
import { nextTicket } from './routes.js';
import { fmtDate, fmtDateTime, addDays, addMinutes, pad, toMinutes, fromMinutes } from './util.js';

// ---------------------------------------------------------------- Data master
const USERS = [
  { nama: 'Admin fasilitas', panggilan: 'Admin', email: 'admin@unud.ac.id', pw: 'admin123', peran: 'admin' },
  { nama: 'Wayan Sudarma', email: 'wayan.sudarma@unud.ac.id', pw: 'teknisi123', peran: 'teknisi', spesialisasi: 'Teknisi elektronik' },
  { nama: 'Ketut Arta', email: 'ketut.arta@unud.ac.id', pw: 'teknisi123', peran: 'teknisi', spesialisasi: 'Teknisi AC' },
  { nama: 'Komang Putra', email: 'komang.putra@unud.ac.id', pw: 'teknisi123', peran: 'teknisi', spesialisasi: 'Teknisi furnitur dan bangunan' },
  { nama: 'Nyoman Adi', email: 'nyoman.adi@unud.ac.id', pw: 'teknisi123', peran: 'teknisi', spesialisasi: 'Teknisi plumbing' },
  { nim: '2508561005', nama: 'I Made Bagus Wisnu Deva Manik', panggilan: 'Wisnu', email: 'manik.2508561005@student.unud.ac.id', pw: 'mahasiswa123', peran: 'pengguna' },
  { nim: '2508561001', nama: 'Pande Putu Agus Diva Surya Dinata. L.', panggilan: 'Diva', email: '2508561001@student.unud.ac.id', pw: 'mahasiswa123', peran: 'pengguna' },
  { nim: '2508561010', nama: 'I Gusti Kadek Bagus Angga Saputra', panggilan: 'Angga', email: '2508561010@student.unud.ac.id', pw: 'mahasiswa123', peran: 'pengguna' },
  { nim: '2508561148', nama: 'Luthfi Hanafi', panggilan: 'Luthfi', email: '2508561148@student.unud.ac.id', pw: 'mahasiswa123', peran: 'pengguna' },
];

// Fasilitas standar per tipe ruangan: [nama, kategori]
const FAC = {
  kuliah: [['Proyektor', 'Elektronik'], ['AC split', 'Pendingin Udara'], ['Papan tulis', 'Furnitur'], ['Stop kontak', 'Listrik'], ['Kursi kuliah', 'Furnitur'], ['Lampu ruangan', 'Listrik']],
  labkomp: [['Komputer', 'Elektronik'], ['AC split', 'Pendingin Udara'], ['Proyektor', 'Elektronik'], ['Switch jaringan', 'Elektronik'], ['Stop kontak', 'Listrik'], ['Meja lab', 'Furnitur']],
  lab: [['Meja lab', 'Furnitur'], ['Lemari bahan', 'Furnitur'], ['Exhaust fan', 'Listrik'], ['Wastafel', 'Plumbing'], ['AC split', 'Pendingin Udara'], ['Stop kontak', 'Listrik']],
  seminar: [['Proyektor', 'Elektronik'], ['Sound system', 'Elektronik'], ['AC split', 'Pendingin Udara'], ['Kursi lipat', 'Furnitur'], ['Lampu ruangan', 'Listrik']],
  diskusi: [['Papan tulis', 'Furnitur'], ['AC split', 'Pendingin Udara'], ['Lampu ruangan', 'Listrik'], ['Meja diskusi', 'Furnitur'], ['Stop kontak', 'Listrik']],
  rapat: [['Layar TV', 'Elektronik'], ['AC split', 'Pendingin Udara'], ['Meja rapat', 'Furnitur'], ['Lampu ruangan', 'Listrik']],
  aula: [['Sound system', 'Elektronik'], ['Lampu sorot', 'Listrik'], ['AC central', 'Pendingin Udara'], ['Kursi aula', 'Furnitur'], ['Panggung', 'Bangunan']],
  baca: [['Rak buku', 'Furnitur'], ['Meja baca', 'Furnitur'], ['AC split', 'Pendingin Udara'], ['Lampu ruangan', 'Listrik'], ['Stop kontak', 'Listrik']],
  multimedia: [['Komputer', 'Elektronik'], ['Headset', 'Elektronik'], ['AC split', 'Pendingin Udara'], ['Lampu ruangan', 'Listrik']],
  kecil: [['Sofa', 'Furnitur'], ['AC split', 'Pendingin Udara'], ['Lampu ruangan', 'Listrik'], ['Stop kontak', 'Listrik']],
};

function roomKind(nama) {
  const n = nama.toLowerCase();
  if (n.includes('lab komputer') || n.includes('lab jaringan') || n.includes('lab basis data') || n.includes('lab multimedia')) return 'labkomp';
  if (n.startsWith('lab ') || n.includes('instrumen')) return 'lab';
  if (n.includes('seminar')) return 'seminar';
  if (n.includes('rapat')) return 'rapat';
  if (n.includes('aula')) return 'aula';
  if (n.includes('diskusi')) return 'diskusi';
  if (n.includes('multimedia')) return 'multimedia';
  if (n.includes('baca') || n.includes('referensi') || n.includes('koleksi')) return 'baca';
  if (n.includes('transit') || n.includes('panitia')) return 'kecil';
  return 'kuliah';
}

// [nama, nomor, lantai, kapasitas, status]
const KULIAH_GKB = [];
for (let lt = 1; lt <= 4; lt++) for (let i = 1; i <= 4; i++) KULIAH_GKB.push([`Ruang Kuliah ${lt}.0${i}`, `${lt}.0${i}`, lt, 60 + ((lt + i) % 4) * 20, ['tersedia', 'tersedia', 'digunakan', 'dibooking'][(lt * 3 + i) % 4]]);

const BUILDINGS = [
  { nama: 'Gedung Teknik A', ket: 'Gedung perkuliahan Fakultas Teknik dan laboratorium komputer', lantai: 4, warna: 'blue', rooms: [
    ['Ruang Kuliah 3.02', '3.02', 3, 40, 'tersedia'], ['Ruang Kuliah 3.03', '3.03', 3, 40, 'digunakan'], ['Ruang Seminar 3.04', '3.04', 3, 60, 'dibooking'],
    ['Lab Komputer 2.01', '2.01', 2, 30, 'tersedia'], ['Lab Jaringan 2.02', '2.02', 2, 28, 'digunakan'], ['Ruang Diskusi 2.05', '2.05', 2, 15, 'tersedia'],
    ['Ruang Kuliah 1.01', '1.01', 1, 80, 'dibooking'], ['Ruang Kuliah 1.02', '1.02', 1, 80, 'tersedia'], ['Lab Multimedia 2.03', '2.03', 2, 24, 'tersedia'],
    ['Ruang Kuliah 4.01', '4.01', 4, 50, 'tersedia'], ['Ruang Kuliah 4.02', '4.02', 4, 50, 'digunakan'], ['Ruang Rapat 4.03', '4.03', 4, 20, 'tersedia'],
  ] },
  { nama: 'Gedung Teknik B', ket: 'Ruang kuliah, laboratorium elektronika dan fisika dasar', lantai: 3, warna: 'green', rooms: [
    ['Ruang Kuliah 1.01', '1.01', 1, 60, 'tersedia'], ['Ruang Kuliah 1.02', '1.02', 1, 60, 'digunakan'], ['Ruang Kuliah 1.03', '1.03', 1, 60, 'tersedia'], ['Ruang Kuliah 1.04', '1.04', 1, 50, 'tersedia'],
    ['Lab Elektronika 2.01', '2.01', 2, 30, 'tersedia'], ['Lab Fisika Dasar 2.02', '2.02', 2, 32, 'dibooking'], ['Ruang Kuliah 2.03', '2.03', 2, 50, 'tersedia'], ['Ruang Kuliah 2.04', '2.04', 2, 50, 'digunakan'],
    ['Ruang Diskusi 3.01', '3.01', 3, 16, 'tersedia'], ['Ruang Seminar 3.02', '3.02', 3, 70, 'tersedia'],
  ] },
  { nama: 'Laboratorium Terpadu', ket: 'Laboratorium sains, riset, dan rekayasa', lantai: 2, warna: 'orange', rooms: [
    ['Lab Biologi 1.01', '1.01', 1, 30, 'tersedia'], ['Lab Kimia 1.02', '1.02', 1, 30, 'digunakan'], ['Lab Fisika 1.03', '1.03', 1, 30, 'tersedia'], ['Lab Komputer 1.04', '1.04', 1, 40, 'tersedia'],
    ['Lab Riset 2.01', '2.01', 2, 20, 'dibooking'], ['Lab Basis Data 2.02', '2.02', 2, 30, 'tersedia'], ['Lab Robotika 2.03', '2.03', 2, 25, 'tersedia'], ['Ruang Instrumen 2.04', '2.04', 2, 12, 'tersedia'],
  ] },
  { nama: 'Perpustakaan', ket: 'Perpustakaan pusat dan ruang belajar bersama', lantai: 3, warna: 'purple', rooms: [
    ['Ruang Baca Utama', '1.01', 1, 100, 'tersedia'], ['Ruang Diskusi 1', '2.01', 2, 12, 'tersedia'], ['Ruang Diskusi 2', '2.02', 2, 12, 'digunakan'],
    ['Ruang Multimedia', '2.03', 2, 20, 'tersedia'], ['Ruang Referensi', '3.01', 3, 40, 'tersedia'], ['Ruang Koleksi Khusus', '3.02', 3, 15, 'dibooking'],
  ] },
  { nama: 'Gedung Kuliah Bersama', ket: 'Ruang kuliah bersama lintas program studi', lantai: 4, warna: 'teal', rooms: KULIAH_GKB },
  { nama: 'Aula Utama', ket: 'Aula untuk acara besar dan kegiatan kampus', lantai: 2, warna: 'pink', rooms: [
    ['Aula Utama', '1.01', 1, 500, 'tersedia'], ['Ruang Transit', '1.02', 1, 20, 'tersedia'], ['Ruang Panitia', '2.01', 2, 30, 'digunakan'],
  ] },
];

// Laporan contoh. Format ruangan: [nama gedung, nomor ruangan].
const REPORTS = [
  { g: 'Gedung Teknik A', n: '3.02', f: 'Proyektor', judul: 'Proyektor tidak menyala', desk: 'Proyektor tidak menyala saat dicoba dari awal perkuliahan. Kabel daya sudah dicek dan masih terpasang.', kat: 'Elektronik', tk: 'sedang', st: 'menunggu', by: 'Wisnu', ago: 95 },
  { g: 'Perpustakaan', n: '2.01', f: 'Lampu ruangan', judul: 'Lampu berkedip', desk: 'Lampu di atas meja diskusi berkedip terus dan kadang mati sendiri.', kat: 'Listrik', tk: 'sedang', st: 'diperbaiki', by: 'Wisnu', ago: 3 * 1440, tek: 'Wayan Sudarma', tind: 'Mengganti balast lampu. Instalasi kabel masih dicek ulang.' },
  { g: 'Perpustakaan', n: '2.01', f: 'AC split', judul: 'AC bocor', desk: 'AC meneteskan air ke lantai dan area meja sehingga basah.', kat: 'Pendingin Udara', tk: 'sedang', st: 'selesai', by: 'Wisnu', ago: 14 * 1440, tek: 'Ketut Arta', done: 13 * 1440, tind: 'Membersihkan saluran pembuangan dan mengganti pipa drain yang tersumbat.' },
  { g: 'Gedung Teknik A', n: '2.01', f: 'AC split', judul: 'AC tidak dingin dan berisik', desk: 'AC tidak mengeluarkan udara dingin dan menimbulkan bunyi keras saat dinyalakan.', kat: 'Pendingin Udara', tk: 'berat', st: 'menunggu', by: 'Angga', ago: 300 },
  { g: 'Gedung Teknik B', n: '1.04', f: 'Stop kontak', judul: 'Stop kontak longgar', desk: 'Stop kontak dekat pintu longgar dan sering memutus aliran listrik.', kat: 'Listrik', tk: 'ringan', st: 'menunggu', by: 'Diva', ago: 1440 + 120 },
  { g: 'Gedung Teknik A', n: '3.02', f: 'Kursi kuliah', judul: 'Kursi kuliah patah', desk: 'Dua kursi kuliah di barisan belakang patah pada bagian sandaran.', kat: 'Furnitur', tk: 'sedang', st: 'diperbaiki', by: 'Luthfi', ago: 2 * 1440, tek: 'Komang Putra', tind: 'Kursi dibawa ke bengkel untuk pengelasan ulang.' },
  { g: 'Gedung Teknik B', n: '1.02', f: 'Papan tulis', judul: 'Papan tulis lepas', desk: 'Papan tulis lepas dari dinding di bagian pojok kanan atas.', kat: 'Furnitur', tk: 'sedang', st: 'selesai', by: 'Diva', ago: 33 * 1440, tek: 'Komang Putra', done: 31 * 1440, tind: 'Memasang ulang papan tulis dengan baut dan dudukan baru.' },
  { g: 'Gedung Teknik A', n: '2.01', f: 'Komputer', judul: 'Komputer tidak bisa menyala', desk: 'Satu unit komputer di barisan depan tidak bisa menyala meski kabel power sudah diganti.', kat: 'Elektronik', tk: 'sedang', st: 'ditugaskan', by: 'Angga', ago: 1440 + 30, tek: 'Wayan Sudarma' },
  { g: 'Gedung Teknik B', n: '2.03', f: 'Proyektor', judul: 'Proyektor buram', desk: 'Gambar proyektor buram dan terlihat bercak gelap di sisi kiri layar.', kat: 'Elektronik', tk: 'ringan', st: 'selesai', by: 'Diva', ago: 22 * 1440, tek: 'Wayan Sudarma', done: 20 * 1440, tind: 'Membersihkan lensa dan filter udara, mengganti lampu proyektor.' },
  { g: 'Gedung Kuliah Bersama', n: '2.02', f: 'Stop kontak', judul: 'Stop kontak mati', desk: 'Seluruh stop kontak di sisi kanan ruangan tidak mengalirkan listrik.', kat: 'Listrik', tk: 'sedang', st: 'selesai', by: 'Luthfi', ago: 9 * 1440, tek: 'Wayan Sudarma', done: 8 * 1440, tind: 'Mengganti MCB yang turun dan memperbaiki sambungan kabel.' },
  { g: 'Laboratorium Terpadu', n: '1.02', f: 'Wastafel', judul: 'Keran wastafel bocor', desk: 'Keran wastafel bocor terus-menerus walaupun sudah ditutup rapat.', kat: 'Plumbing', tk: 'ringan', st: 'selesai', by: 'Angga', ago: 40 * 1440, tek: 'Nyoman Adi', done: 38 * 1440, tind: 'Mengganti keran dan seal karet pada sambungan pipa.' },
  { g: 'Gedung Kuliah Bersama', n: '3.01', f: 'AC split', judul: 'AC terasa terlalu panas', desk: 'AC dinyalakan tetapi ruangan terasa panas sepanjang perkuliahan.', kat: 'Pendingin Udara', tk: 'ringan', st: 'ditolak', by: 'Diva', ago: 6 * 1440, catatan: 'Setelah dicek, AC berfungsi normal. Suhu hanya perlu diatur ulang pada remote.' },
];

// ---------------------------------------------------------------- Foto contoh (SVG)
const ICONS = {
  Elektronik: '<rect x="270" y="150" width="260" height="170" rx="14" fill="#2b3340"/><rect x="284" y="164" width="232" height="130" rx="6" fill="#0f141b"/><path d="M300 180 L420 280 M470 172 L390 292" stroke="#ff5a5f" stroke-width="5" stroke-linecap="round"/><rect x="380" y="320" width="40" height="32" fill="#2b3340"/><rect x="340" y="350" width="120" height="12" rx="6" fill="#2b3340"/>',
  Listrik: '<path d="M400 90 v50" stroke="#555" stroke-width="6"/><path d="M400 140 c-60 0 -90 50 -62 100 c14 24 24 34 24 62 h76 c0 -28 10 -38 24 -62 c28 -50 -2 -100 -62 -100z" fill="#cfd5dc" stroke="#9aa3ad" stroke-width="4"/><rect x="368" y="302" width="64" height="26" rx="6" fill="#555"/><path d="M335 190 l-30 -20 M465 190 l30 -20 M400 118 v-26" stroke="#f5b82e" stroke-width="6" stroke-linecap="round"/>',
  'Pendingin Udara': '<rect x="200" y="140" width="400" height="120" rx="26" fill="#f1f3f6" stroke="#c9ced6" stroke-width="4"/><rect x="230" y="215" width="340" height="14" rx="7" fill="#c9ced6"/><circle cx="520" cy="175" r="8" fill="#3fa9f5"/><path d="M290 275 q-12 24 0 38 q12 -14 0 -38z M370 285 q-12 24 0 38 q12 -14 0 -38z M450 275 q-12 24 0 38 q12 -14 0 -38z" fill="#3fa9f5"/>',
  Furnitur: '<rect x="300" y="170" width="200" height="30" rx="8" fill="#8a5a33"/><rect x="300" y="200" width="22" height="130" fill="#6e4526"/><rect x="478" y="200" width="22" height="130" fill="#6e4526"/><path d="M380 150 l40 70 M430 150 l-30 70" stroke="#ff5a5f" stroke-width="5" stroke-linecap="round"/><rect x="320" y="250" width="160" height="14" fill="#a06d40"/>',
  Plumbing: '<rect x="250" y="160" width="230" height="36" rx="12" fill="#9aa3ad"/><rect x="450" y="160" width="36" height="110" rx="12" fill="#9aa3ad"/><path d="M468 290 q-22 36 0 56 q22 -20 0 -56z" fill="#3fa9f5"/><path d="M430 330 q-14 24 0 36 q14 -12 0 -36z" fill="#3fa9f5" opacity=".7"/>',
  Bangunan: '<rect x="220" y="120" width="360" height="230" fill="#d9d2c4"/><path d="M400 120 l-18 50 l24 40 l-20 60 l30 80" fill="none" stroke="#5b5348" stroke-width="5" stroke-linejoin="round"/>',
  Lainnya: '<circle cx="400" cy="230" r="80" fill="#e4e7ec"/><path d="M400 190 v50 M400 262 v4" stroke="#6b7280" stroke-width="10" stroke-linecap="round"/>',
};

function photoSvg({ kategori, judul, lokasi }) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
<defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eceff3"/><stop offset="1" stop-color="#dfe3e9"/></linearGradient></defs>
<rect width="800" height="500" fill="url(#w)"/><rect y="380" width="800" height="120" fill="#c8ccd3"/><rect y="378" width="800" height="4" fill="#b4b9c1"/>
${ICONS[kategori] || ICONS.Lainnya}
<rect x="0" y="430" width="800" height="70" fill="#000" opacity=".55"/>
<text x="24" y="462" font-family="Helvetica,Arial,sans-serif" font-size="22" font-weight="700" fill="#fff">${esc(judul)}</text>
<text x="24" y="488" font-family="Helvetica,Arial,sans-serif" font-size="15" fill="#d6d9de">${esc(lokasi)} · foto contoh data awal</text>
</svg>`;
}

// ---------------------------------------------------------------- Pengisian data
export function seedAll(db) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const now = new Date();
  const ids = { user: {}, building: {}, room: {}, fac: {} };

  tx(db, () => {
    const insUser = db.prepare(
      'INSERT INTO pengguna (nim, nama, panggilan, email, kata_sandi, peran, spesialisasi) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const u of USERS) {
      const res = insUser.run(u.nim ?? null, u.nama, u.panggilan ?? null, u.email, hashPassword(u.pw), u.peran, u.spesialisasi ?? null);
      ids.user[u.panggilan || u.nama] = Number(res.lastInsertRowid);
      ids.user[u.nama] = Number(res.lastInsertRowid);
    }

    const insG = db.prepare('INSERT INTO gedung (nama_gedung, keterangan, jumlah_lantai, warna) VALUES (?, ?, ?, ?)');
    const insR = db.prepare('INSERT INTO ruangan (id_gedung, nama_ruangan, nomor_ruangan, lantai, kapasitas, status_ruangan) VALUES (?, ?, ?, ?, ?, ?)');
    const insF = db.prepare('INSERT INTO fasilitas (id_ruangan, nama_fasilitas, kategori, kondisi) VALUES (?, ?, ?, ?)');
    for (const b of BUILDINGS) {
      const gid = Number(insG.run(b.nama, b.ket, b.lantai, b.warna).lastInsertRowid);
      ids.building[b.nama] = gid;
      for (const [nama, nomor, lantai, kap, status] of b.rooms) {
        const rid = Number(insR.run(gid, nama, nomor, lantai, kap, status).lastInsertRowid);
        ids.room[`${b.nama}|${nomor}`] = rid;
        let tpl = FAC[roomKind(nama)];
        if (b.nama === 'Gedung Teknik A' && nomor === '3.02') tpl = tpl.slice(0, 5); // sesuai prototipe
        for (const [fn, kat] of tpl) {
          ids.fac[`${b.nama}|${nomor}|${fn}`] = Number(insF.run(rid, fn, kat, 'Baik').lastInsertRowid);
        }
      }
    }

    // Laporan contoh + riwayat perbaikan
    const insL = db.prepare(
      `INSERT INTO laporan (nomor_tiket, id_fasilitas, id_pelapor, id_admin, judul, foto, kategori_kerusakan, tingkat_kerusakan,
                            deskripsi, status_laporan, catatan_admin, kondisi_sebelum, dibuat_pada, diverifikasi_pada)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Baik', ?, ?)`,
    );
    const insP = db.prepare(
      `INSERT INTO perbaikan (id_laporan, id_teknisi, tindakan, tanggal_ditugaskan, tanggal_selesai, status_perbaikan, diperbarui_pada)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const setKondisi = db.prepare('UPDATE fasilitas SET kondisi = ? WHERE id_fasilitas = ?');
    const adminId = ids.user['Admin'];

    const sorted = [...REPORTS].sort((a, b) => b.ago - a.ago); // tiket diberi nomor urut sesuai waktu
    sorted.forEach((rp, i) => {
      const created = addMinutes(now, -rp.ago);
      const fid = ids.fac[`${rp.g}|${rp.n}|${rp.f}`];
      if (!fid) throw new Error(`Fasilitas seed tidak ditemukan: ${rp.g} ${rp.n} ${rp.f}`);
      const foto = `seed-${i + 1}.svg`;
      fs.writeFileSync(path.join(UPLOAD_DIR, foto), photoSvg({ kategori: rp.kat, judul: rp.judul, lokasi: `${rp.g} · ${rp.n}` }));
      const verifAt = rp.st === 'menunggu' ? null : fmtDateTime(addMinutes(created, 60));
      const lid = Number(
        insL.run(
          nextTicket(db, created), fid, ids.user[rp.by], rp.st === 'menunggu' ? null : adminId, rp.judul, foto, rp.kat, rp.tk,
          rp.desk, rp.st, rp.catatan ?? null, fmtDateTime(created), verifAt,
        ).lastInsertRowid,
      );
      if (rp.tek) {
        const assigned = fmtDateTime(addMinutes(created, 60));
        const finished = rp.st === 'selesai' ? fmtDateTime(addMinutes(now, -rp.done)) : null;
        const updated = finished || fmtDateTime(addMinutes(now, -Math.max(30, rp.ago / 3)));
        insP.run(lid, ids.user[rp.tek], rp.tind ?? null, assigned, finished, rp.st, updated);
      }
      // Kondisi fasilitas mengikuti status laporan
      const kondisi = { menunggu: 'Rusak', ditugaskan: 'Rusak', diperbaiki: 'Dalam perbaikan', selesai: 'Baik', ditolak: 'Baik' }[rp.st];
      setKondisi.run(kondisi, fid);
    });
  });

  generateSchedule(db);
}

// ---------------------------------------------------------------- Jadwal ruangan
const DAY_START = toMinutes('06:00');
const SLOTS = [['07:30', '09:10'], ['09:20', '11:00'], ['11:10', '12:50'], ['13:00', '14:40'], ['15:00', '16:40']];
const COURSES = ['Pemrograman Web', 'Basis Data', 'Rekayasa Perangkat Lunak', 'Struktur Data', 'Jaringan Komputer', 'Kecerdasan Buatan', 'Sistem Operasi', 'Kalkulus', 'Aljabar Linear', 'Statistika', 'Fisika Dasar', 'Kimia Dasar', 'Pemrograman Mobile', 'Interaksi Manusia dan Komputer', 'Keamanan Informasi', 'Pengolahan Citra'];
const EVENTS = ['Seminar Proposal Skripsi', 'Rapat Himpunan', 'Workshop UI/UX', 'Sidang Tugas Akhir', 'Kuliah Tamu', 'Rapat Koordinasi', 'Pelatihan Dosen', 'Diskusi Kelompok', 'Rapat Panitia Kegiatan'];

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSchedule(db, { days = 14, from = new Date() } = {}) {
  const rooms = db.prepare(
    'SELECT r.*, g.nama_gedung FROM ruangan r JOIN gedung g ON g.id_gedung = r.id_gedung',
  ).all();
  const ins = db.prepare('INSERT INTO jadwal (id_ruangan, waktu_mulai, waktu_selesai, keterangan) VALUES (?, ?, ?, ?)');
  const todayStr = fmtDate(from);
  const nowMin = from.getHours() * 60 + from.getMinutes();

  tx(db, () => {
    for (let d = 0; d < days; d++) {
      const date = addDays(from, d);
      const ds = fmtDate(date);
      const dow = date.getDay(); // 0 = Minggu
      for (const room of rooms) {
        const rnd = mulberry32(room.id_ruangan * 100003 + Math.floor(date.getTime() / 86400000));
        const kind = roomKind(room.nama_ruangan);
        const isFixed = room.nama_gedung === 'Gedung Teknik A' && room.nomor_ruangan === '3.02';
        let entries = []; // {s, e, ket} dalam menit

        if (isFixed) {
          if (dow >= 1 && dow <= 5) {
            entries = [
              { s: toMinutes('07:30'), e: toMinutes('09:10'), ket: 'Pemrograman Web' },
              { s: toMinutes('09:20'), e: toMinutes('11:00'), ket: 'Basis Data' },
              { s: toMinutes('13:00'), e: toMinutes('14:40'), ket: 'Rekayasa Perangkat Lunak' },
            ];
          }
        } else if (dow !== 0) {
          const classKind = kind === 'kuliah' || kind === 'labkomp' || kind === 'lab';
          const prob = classKind ? (dow === 6 ? 0.15 : 0.55) : dow === 6 ? 0.1 : kind === 'baca' || kind === 'multimedia' ? 0.15 : 0.3;
          for (const [s, e] of SLOTS) {
            if (rnd() < prob) {
              const ket = classKind
                ? (kind === 'kuliah' ? COURSES[Math.floor(rnd() * COURSES.length)] : `Praktikum ${COURSES[Math.floor(rnd() * COURSES.length)]}`)
                : EVENTS[Math.floor(rnd() * EVENTS.length)];
              entries.push({ s: toMinutes(s), e: toMinutes(e), ket });
            }
          }
        }

        // Selaraskan hari ini dengan status ruangan yang tersimpan.
        if (ds === todayStr && !isFixed) {
          const overlaps = (x, a, b) => x.s < b && x.e > a;
          if (room.status_ruangan === 'tersedia') {
            entries = entries.filter((x) => !overlaps(x, nowMin - 5, nowMin + 5));
          } else if (room.status_ruangan === 'digunakan') {
            const s = Math.max(DAY_START, Math.floor((nowMin - 40) / 5) * 5);
            const e = s + 90;
            if (e < 24 * 60) {
              entries = entries.filter((x) => !overlaps(x, s, e));
              entries.push({ s, e, ket: kind === 'kuliah' || kind === 'labkomp' || kind === 'lab' ? 'Perkuliahan berlangsung' : 'Kegiatan berlangsung' });
            }
          } else if (room.status_ruangan === 'dibooking') {
            const s = Math.ceil((nowMin + 45) / 5) * 5;
            const e = s + 90;
            if (e < 24 * 60) {
              entries = entries.filter((x) => !overlaps(x, s, e));
              entries.push({ s, e, ket: `Booking: ${EVENTS[Math.floor(rnd() * EVENTS.length)]}` });
            }
          }
        }

        entries.sort((a, b) => a.s - b.s);
        for (const en of entries) ins.run(room.id_ruangan, `${ds} ${fromMinutes(en.s)}:00`, `${ds} ${fromMinutes(en.e)}:00`, en.ket);
      }
    }
  });
}

// Jika tidak ada jadwal untuk hari ini dan seterusnya (mis. server dinyalakan lagi di hari lain), buat ulang 14 hari ke depan.
export function ensureSchedule(db) {
  const rooms = db.prepare('SELECT COUNT(*) AS c FROM ruangan').get().c;
  if (!rooms) return;
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM jadwal WHERE waktu_mulai >= ?').get(`${fmtDate()} 00:00:00`);
  if (c === 0) generateSchedule(db);
}

// ---------------------------------------------------------------- CLI: npm run seed
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.env.TZ ||= 'Asia/Makassar';
  if (process.argv.includes('--reset')) {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_FILE + suffix, { force: true });
    if (fs.existsSync(UPLOAD_DIR)) for (const f of fs.readdirSync(UPLOAD_DIR)) if (f.startsWith('seed-')) fs.rmSync(path.join(UPLOAD_DIR, f));
  }
  const db = openDb();
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM pengguna').get();
  if (c > 0) {
    console.log('Basis data sudah berisi data. Gunakan "npm run seed" (dengan --reset) untuk mengosongkan dan mengisi ulang.');
  } else {
    seedAll(db);
    const n = (t) => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
    console.log(`Seed selesai: ${n('pengguna')} pengguna, ${n('gedung')} gedung, ${n('ruangan')} ruangan, ${n('fasilitas')} fasilitas, ${n('jadwal')} jadwal, ${n('laporan')} laporan, ${n('perbaikan')} perbaikan.`);
  }
}
