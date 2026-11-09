# FacilityOPS — Campus Facility Issue & Maintenance Management System

Aplikasi web untuk capstone **Rekayasa Perangkat Lunak (Kelompok 4)**, Program Studi Informatika, Universitas Udayana.
Implementasi mengikuti laporan: kebutuhan FR-01 s.d. FR-14, NFR-01 s.d. NFR-07, DFD, ERD, dan prototipe 8 layar (Bab II).

- **Frontend:** HTML + CSS + JavaScript murni (ES modules, tanpa framework dan tanpa proses build)
- **Backend:** Node.js (modul bawaan saja: `http`, `crypto`, `node:sqlite`) — **tidak ada dependensi npm**
- **Database:** SQLite (satu berkas, `data/facilityops.db`), otomatis terisi data contoh saat pertama kali dijalankan

## Menjalankan

Prasyarat: **Node.js 22.13 atau lebih baru** (untuk `node:sqlite`). Tidak perlu `npm install`.

```bash
npm start            # lalu buka http://localhost:3000
```

Pertama kali dijalankan, basis data dibuat dan diisi otomatis (8 gedung, 36 ruangan, 208 fasilitas, jadwal 14 hari, 12 laporan contoh).

| Perintah | Fungsi |
|---|---|
| `npm start` | Menjalankan aplikasi (port 3000) |
| `npm run seed` | Menghapus basis data lalu mengisi ulang data contoh |
| `npm test` | Menjalankan 13 skenario uji API (UT-01 s.d. UT-09 + CRUD + keamanan) |

Variabel lingkungan (opsional): `PORT` (3000), `HOST` (127.0.0.1; pakai `0.0.0.0` agar bisa diakses dari jaringan), `TZ` (Asia/Makassar), `DB_FILE`, `UPLOAD_DIR`, `COOKIE_SECURE=1` (bila dilayani lewat HTTPS).

## Akun demo

| Peran | Login (NIM atau email) | Kata sandi |
|---|---|---|
| Pengguna | `2508561005` (juga 2508561001, 2508561010, 2508561148) | `mahasiswa123` |
| Admin | `admin@unud.ac.id` | `admin123` |
| Teknisi | `wayan.sudarma@unud.ac.id` (juga `ketut.arta@`, `komang.putra@`, `nyoman.adi@unud.ac.id`) | `teknisi123` |

Akun demo juga tersedia pada tautan "Akun demo" di halaman login. **Ganti seluruh kata sandi ini sebelum aplikasi dipakai di luar demo.**

## Peta layar prototipe → kode

| Prototipe | Rute | Berkas |
|---|---|---|
| Gambar 2.1 Layar Login | `#/login` | `public/js/views/login.js` |
| Gambar 2.2 Layar Pilih Gedung | `#/gedung` | `views/user.js` → `buildings` |
| Gambar 2.3 Layar Pilih Ruangan | `#/gedung/:id` | `views/user.js` → `rooms` |
| Gambar 2.4 Layar Detail Ruangan | `#/ruangan/:id` | `views/user.js` → `roomDetail` |
| Gambar 2.5 Layar Laporan Kerusakan | `#/ruangan/:id/lapor` | `views/user.js` → `reportForm` |
| Gambar 2.6 Layar Laporan Saya | `#/laporan-saya` | `views/user.js` → `myReports` |
| Gambar 2.7 Layar Verifikasi Laporan Admin | `#/admin/verifikasi` | `views/admin.js` → `verifikasi` |
| Gambar 2.8 Layar Tugas Teknisi | `#/tugas` | `views/tech.js` → `tugas` |

Layar tambahan untuk kebutuhan yang tidak punya layar di prototipe: Monitoring perbaikan (FR-12), Riwayat perbaikan admin (FR-11), Gedung dan ruangan / CRUD data master (FR-13), dan Riwayat teknisi.

## Pemenuhan kebutuhan

| Kode | Implementasi |
|---|---|
| FR-01 | Login/logout dengan sesi cookie `HttpOnly` (`server/auth.js`, `POST /api/auth/login`, `/logout`) |
| FR-02, FR-03 | `GET /api/buildings`, `GET /api/buildings/:id` |
| FR-04, FR-05, FR-06 | `GET /api/rooms/:id?tanggal=` — detail, status, jadwal harian (dengan slot kosong), fasilitas |
| FR-07 | `POST /api/reports` — foto, kategori, tingkat, deskripsi; nomor tiket otomatis `FOP-YYYYMMDD-NNNN` |
| FR-08, FR-09 | `POST /api/admin/reports/:id/verify` (setujui + tugaskan teknisi, atau tolak dengan alasan) |
| FR-10, FR-11 | `PATCH /api/tech/tasks/:id`, `GET /api/tech/history`, `GET /api/admin/history` |
| FR-12 | `GET /api/admin/reports`, `/api/admin/stats` |
| FR-13 | CRUD `/api/admin/{gedung,ruangan,fasilitas,jadwal}` |
| FR-14 | `GET /api/reports/mine` |
| NFR-01 | Pemeriksaan peran di server pada setiap endpoint; kata sandi di-hash **scrypt**; token sesi disimpan sebagai hash; pembatasan percobaan login; perlindungan CSRF dasar (cek Origin); header CSP, X-Frame-Options |
| NFR-02 | Unggahan divalidasi di server dari **byte awal berkas** (JPG/PNG/WEBP/GIF), maks. 5 MB; SVG dan berkas lain ditolak; foto hanya bisa dilihat pemilik laporan, admin, dan teknisi |
| NFR-03 | Halaman gedung/ruangan hanya memakai satu-dua kueri SQLite berindeks |
| NFR-04 | Alur singkat gedung → ruangan → laporan; pesan galat berbahasa Indonesia |
| NFR-05 | Tata letak responsif (desktop, tablet, ponsel) |
| NFR-06 | Setiap perubahan multi-tabel memakai transaksi SQL; berkas foto dihapus bila penyimpanan laporan gagal |
| NFR-07 | Kode dipisah per modul (`server/*.js`, `public/js/views/*.js`) dan diuji otomatis |

## Aturan alur data

- Saat laporan dikirim, kondisi fasilitas menjadi **Rusak** (kondisi sebelumnya disimpan). Satu fasilitas hanya boleh punya satu laporan aktif.
- Admin **menolak** → kondisi fasilitas dikembalikan. Admin **menyetujui** → perbaikan dibuat dan ditugaskan ke teknisi.
- Teknisi mengubah status **Ditugaskan → Diperbaiki → Selesai**. "Diperbaiki" membuat kondisi fasilitas *Dalam perbaikan*; "Selesai" mewajibkan catatan tindakan, mengunci tugas, dan mengembalikan kondisi ke *Baik*.
- Laporan menunggu diurutkan dari tingkat kerusakan terberat (penentuan prioritas).
- Status ruangan (tersedia / sedang digunakan / dibooking) disimpan di tabel `ruangan` dan dikelola admin, sesuai batasan masalah laporan.

## Perbedaan kecil terhadap ERD laporan

Kolom tambahan yang dibutuhkan fitur pada laporan/prototipe: `pengguna.nim`, `pengguna.panggilan`, `pengguna.spesialisasi`, `gedung.jumlah_lantai`, `gedung.warna`, `ruangan.lantai`, `fasilitas.kategori`, `laporan.nomor_tiket`, `laporan.judul` (dibuat otomatis dari kalimat pertama deskripsi), `laporan.catatan_admin`, `laporan.kondisi_sebelum`, `laporan.diverifikasi_pada`, `perbaikan.tanggal_ditugaskan`, serta tabel `sesi`. Jika ERD di Bab II perlu diselaraskan, tambahkan atribut-atribut tersebut.

## Struktur

```
server/   server.js (HTTP + static) · routes.js (REST API) · db.js (skema SQLite) · auth.js · http.js · validate.js · seed.js
public/   index.html · css/style.css · js/{app,api,ui}.js · js/views/{login,user,admin,tech}.js
test/     smoke.test.js
data/     facilityops.db (dibuat otomatis)      uploads/  foto laporan (dibuat otomatis)
```

## Catatan

- Font **Figtree** dimuat dari Google Fonts; tanpa internet tampilan memakai font sistem.
- Pembatas login berjalan di memori satu proses; bila dijalankan lebih dari satu instance, pindahkan ke penyimpanan bersama.
- Jadwal contoh dibuat otomatis untuk 14 hari; bila server dinyalakan lagi setelah semuanya lewat, jadwal dibuat ulang. Jadwal buatan admin tidak dihapus.
- Fitur "Lupa kata sandi" hanya menampilkan petunjuk menghubungi admin (belum ada pengiriman email).
- Pengujian kegunaan (SUS, UT-12) dan pengukuran waktu muat (UT-10) bersifat manual dan belum diotomatisasi.
