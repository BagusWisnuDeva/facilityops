import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'facilityops.db');
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');

// Skema mengikuti ERD pada laporan (Bab II, 2.6) dengan beberapa kolom tambahan:
// nomor_tiket, judul, catatan_admin, kondisi_sebelum, spesialisasi, dll.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS pengguna (
  id_pengguna  INTEGER PRIMARY KEY AUTOINCREMENT,
  nim          TEXT UNIQUE,
  nama         TEXT NOT NULL,
  panggilan    TEXT,
  email        TEXT NOT NULL UNIQUE,
  kata_sandi   TEXT NOT NULL,                       -- hash scrypt, bukan teks asli
  peran        TEXT NOT NULL CHECK (peran IN ('pengguna','admin','teknisi')),
  spesialisasi TEXT                                 -- khusus teknisi
);

CREATE TABLE IF NOT EXISTS sesi (
  token_hash  TEXT PRIMARY KEY,
  id_pengguna INTEGER NOT NULL REFERENCES pengguna(id_pengguna) ON DELETE CASCADE,
  kedaluwarsa INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS gedung (
  id_gedung     INTEGER PRIMARY KEY AUTOINCREMENT,
  nama_gedung   TEXT NOT NULL UNIQUE,
  keterangan    TEXT,
  jumlah_lantai INTEGER NOT NULL DEFAULT 1 CHECK (jumlah_lantai >= 1),
  warna         TEXT NOT NULL DEFAULT 'blue'
);

CREATE TABLE IF NOT EXISTS ruangan (
  id_ruangan     INTEGER PRIMARY KEY AUTOINCREMENT,
  id_gedung      INTEGER NOT NULL REFERENCES gedung(id_gedung) ON DELETE CASCADE,
  nama_ruangan   TEXT NOT NULL,
  nomor_ruangan  TEXT NOT NULL,
  lantai         INTEGER NOT NULL DEFAULT 1,
  kapasitas      INTEGER NOT NULL DEFAULT 0 CHECK (kapasitas >= 0),
  status_ruangan TEXT NOT NULL DEFAULT 'tersedia' CHECK (status_ruangan IN ('tersedia','digunakan','dibooking'))
);
CREATE INDEX IF NOT EXISTS idx_ruangan_gedung ON ruangan(id_gedung);

CREATE TABLE IF NOT EXISTS jadwal (
  id_jadwal     INTEGER PRIMARY KEY AUTOINCREMENT,
  id_ruangan    INTEGER NOT NULL REFERENCES ruangan(id_ruangan) ON DELETE CASCADE,
  waktu_mulai   TEXT NOT NULL,
  waktu_selesai TEXT NOT NULL,
  keterangan    TEXT
);
CREATE INDEX IF NOT EXISTS idx_jadwal_ruangan ON jadwal(id_ruangan, waktu_mulai);

CREATE TABLE IF NOT EXISTS fasilitas (
  id_fasilitas  INTEGER PRIMARY KEY AUTOINCREMENT,
  id_ruangan    INTEGER NOT NULL REFERENCES ruangan(id_ruangan) ON DELETE CASCADE,
  nama_fasilitas TEXT NOT NULL,
  kategori      TEXT NOT NULL DEFAULT 'Lainnya',
  kondisi       TEXT NOT NULL DEFAULT 'Baik' CHECK (kondisi IN ('Baik','Rusak','Dalam perbaikan'))
);
CREATE INDEX IF NOT EXISTS idx_fasilitas_ruangan ON fasilitas(id_ruangan);

CREATE TABLE IF NOT EXISTS laporan (
  id_laporan         INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor_tiket        TEXT NOT NULL UNIQUE,
  id_fasilitas       INTEGER NOT NULL REFERENCES fasilitas(id_fasilitas),
  id_pelapor         INTEGER NOT NULL REFERENCES pengguna(id_pengguna),
  id_admin           INTEGER REFERENCES pengguna(id_pengguna),
  judul              TEXT NOT NULL,
  foto               TEXT NOT NULL,                 -- hanya nama berkas; berkas disimpan terpisah
  kategori_kerusakan TEXT NOT NULL,
  tingkat_kerusakan  TEXT NOT NULL CHECK (tingkat_kerusakan IN ('ringan','sedang','berat')),
  deskripsi          TEXT NOT NULL,
  status_laporan     TEXT NOT NULL DEFAULT 'menunggu'
                     CHECK (status_laporan IN ('menunggu','ditolak','ditugaskan','diperbaiki','selesai')),
  catatan_admin      TEXT,
  kondisi_sebelum    TEXT,
  dibuat_pada        TEXT NOT NULL,
  diverifikasi_pada  TEXT
);
CREATE INDEX IF NOT EXISTS idx_laporan_status ON laporan(status_laporan);
CREATE INDEX IF NOT EXISTS idx_laporan_pelapor ON laporan(id_pelapor);
CREATE INDEX IF NOT EXISTS idx_laporan_fasilitas ON laporan(id_fasilitas);

CREATE TABLE IF NOT EXISTS perbaikan (
  id_perbaikan       INTEGER PRIMARY KEY AUTOINCREMENT,
  id_laporan         INTEGER NOT NULL UNIQUE REFERENCES laporan(id_laporan) ON DELETE CASCADE,
  id_teknisi         INTEGER NOT NULL REFERENCES pengguna(id_pengguna),
  tindakan           TEXT,
  tanggal_ditugaskan TEXT NOT NULL,
  tanggal_selesai    TEXT,
  status_perbaikan   TEXT NOT NULL DEFAULT 'ditugaskan' CHECK (status_perbaikan IN ('ditugaskan','diperbaiki','selesai')),
  diperbarui_pada    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_perbaikan_teknisi ON perbaikan(id_teknisi);
`;

export function openDb(file = DB_FILE) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

// Jalankan fn dalam satu transaksi; rollback otomatis jika terjadi galat.
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
