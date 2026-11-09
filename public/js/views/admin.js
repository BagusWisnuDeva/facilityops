import { api } from '../api.js';
import {
  html, raw, mount, $, $$, icon, adminStatusBadge, roomBadge, kondisiBadge, tingkatText, shortGedung, relTime, fmtTanggal,
  fmtTanggalWaktu, toast, skeleton, debounce, confirmDialog, promptDialog, formDialog, viewPhoto, todayStr, cap, jam,
} from '../ui.js';

const SPEC_KEY = { Elektronik: 'elektronik', Listrik: 'elektronik', 'Pendingin Udara': 'ac', Furnitur: 'furnitur', Bangunan: 'bangunan', Plumbing: 'plumbing' };
const lokasi = (r) => `${shortGedung(r.nama_gedung)} · ${r.nomor_ruangan}`;
const lokasiPanjang = (r) => `${r.nama_gedung} · ${r.nama_ruangan}`;

const head = (title, sub) => html`<h1 class="title">${title}</h1><p class="subtitle">${sub}</p>`;
const stat = (label, value, color) => html`<div class="card stat"><div class="l">${label}</div><div class="v ${color}">${value}</div></div>`;

// ===================================================================== Verifikasi laporan (FR-08, FR-09)
export async function verifikasi({ root, query, isStale, state }) {
  document.title = 'Verifikasi laporan · FacilityOPS';
  mount(root, html`${head('Verifikasi laporan', 'Periksa laporan masuk, lalu setujui dan tugaskan ke teknisi, atau tolak.')}${skeleton(3)}`);
  let [stats, reports, techs] = await Promise.all([api.get('/admin/stats'), api.get('/admin/reports'), api.get('/admin/technicians')]);
  if (isStale()) return;

  let filter = 'semua';
  let selected = Number(query.id) || (reports.find((r) => r.status_laporan === 'menunggu') || reports[0])?.id_laporan || null;
  const FILTERS = [['semua', 'Semua'], ['menunggu', 'Menunggu'], ['proses', 'Diproses'], ['selesai', 'Selesai']];
  const inFilter = (r) => filter === 'semua' || (filter === 'proses' ? ['ditugaskan', 'diperbaiki'].includes(r.status_laporan) : r.status_laporan === filter);

  const defaultTech = (r) => {
    const key = SPEC_KEY[r.kategori_kerusakan];
    return techs.find((t) => key && (t.spesialisasi || '').toLowerCase().includes(key))?.id_pengguna ?? '';
  };

  const statsHtml = () => html`<div class="stats">${stat('Menunggu verifikasi', stats.menunggu, 'orange')}${stat('Sedang diperbaiki', stats.ditugaskan + stats.diperbaiki, 'blue')}${stat('Selesai', stats.selesai, 'green')}</div>`;

  const tableHtml = () => {
    const rows = reports.filter(inFilter);
    return html`<div class="seg" id="seg" style="margin-bottom:12px" role="group" aria-label="Filter laporan">
        ${FILTERS.map(([k, l]) => html`<button data-k="${k}" aria-pressed="${String(k === filter)}">${l}</button>`)}</div>
      <div class="list tbl-wrap"><table class="table"><thead><tr><th>Laporan</th><th>Tingkat</th><th>Status</th></tr></thead><tbody>
        ${rows.map((r) => html`<tr class="click ${r.id_laporan === selected ? 'sel' : ''}" data-id="${r.id_laporan}" tabindex="0">
          <td><div class="t">${r.nama_fasilitas}</div><div class="s">${lokasi(r)}</div></td><td>${tingkatText(r.tingkat_kerusakan)}</td><td>${adminStatusBadge(r.status_laporan)}</td></tr>`)}
        ${rows.length ? '' : html`<tr><td colspan="3"><div class="empty">Tidak ada laporan.</div></td></tr>`}</tbody></table></div>`;
  };

  const detailHtml = () => {
    const r = reports.find((x) => x.id_laporan === selected);
    if (!r) return html`<div class="card detail"><div class="empty">Pilih laporan untuk melihat detailnya.</div></div>`;
    const pending = r.status_laporan === 'menunggu';
    const dt = defaultTech(r);
    return html`<aside class="card detail" aria-label="Detail laporan">
      <div class="lbl">Detail laporan</div><h2>${r.judul}</h2><div class="loc">${lokasiPanjang(r)}</div>
      <div class="photo"><img src="${r.foto_url}" alt="Foto dari pelapor" data-zoom="${r.foto_url}"></div>
      <div class="kv"><div><div class="k">Kategori</div><div class="v">${r.kategori_kerusakan}</div></div><div><div class="k">Tingkat</div><div class="v">${r.tingkat_kerusakan}</div></div></div>
      <p class="desc">${r.deskripsi}</p>
      <div class="kv-list"><div><span>Fasilitas</span><span>${r.nama_fasilitas}</span></div><div><span>Pelapor</span><span>${r.pelapor}</span></div>
        <div><span>Dikirim</span><span>${fmtTanggalWaktu(r.dibuat_pada)}</span></div><div><span>Tiket</span><span>${r.nomor_tiket}</span></div>
        ${pending ? '' : html`<div><span>Status</span><span>${adminStatusBadge(r.status_laporan)}</span></div>`}
        ${r.teknisi ? html`<div><span>Teknisi</span><span>${r.teknisi}</span></div>` : ''}
        ${r.tanggal_selesai ? html`<div><span>Selesai</span><span>${fmtTanggalWaktu(r.tanggal_selesai)}</span></div>` : ''}
        ${r.tindakan ? html`<div><span>Tindakan</span><span>${r.tindakan}</span></div>` : ''}
        ${r.catatan_admin ? html`<div><span>Catatan admin</span><span>${r.catatan_admin}</span></div>` : ''}</div>
      ${pending ? html`<label class="select"><span class="lbl">Tugaskan ke teknisi</span><select id="tech" aria-label="Tugaskan ke teknisi">
          <option value="">Pilih teknisi…</option>
          ${techs.map((t) => html`<option value="${t.id_pengguna}" ${t.id_pengguna === dt ? raw('selected') : ''}>${t.spesialisasi} · ${t.nama}${t.tugas_aktif ? ` (${t.tugas_aktif} tugas)` : ''}</option>`)}</select></label>
        <div class="actions"><button class="btn" id="approve">Setujui</button><button class="btn btn-red" id="reject">Tolak</button></div>` : ''}</aside>`;
  };

  const draw = () => {
    mount($('#stats', root), statsHtml());
    mount($('#left', root), tableHtml());
    mount($('#right', root), detailHtml());
  };

  const refresh = async (nextSelected) => {
    [stats, reports] = await Promise.all([api.get('/admin/stats'), api.get('/admin/reports')]);
    selected = nextSelected ?? (reports.find((r) => r.status_laporan === 'menunggu') || reports[0])?.id_laporan ?? null;
    draw();
  };

  mount(root, html`${head('Verifikasi laporan', 'Periksa laporan masuk, lalu setujui dan tugaskan ke teknisi, atau tolak.')}
    <div id="stats"></div><div class="split"><div id="left"></div><div id="right"></div></div>`);
  draw();

  root.addEventListener('click', async (e) => {
    const seg = e.target.closest('#seg button');
    if (seg) { filter = seg.dataset.k; mount($('#left', root), tableHtml()); return; }
    const tr = e.target.closest('tr[data-id]');
    if (tr) { selected = Number(tr.dataset.id); mount($('#left', root), tableHtml()); mount($('#right', root), detailHtml()); return; }
    const z = e.target.closest('[data-zoom]');
    if (z) { viewPhoto(z.dataset.zoom); return; }

    const r = reports.find((x) => x.id_laporan === selected);
    if (e.target.closest('#approve')) {
      const sel = $('#tech', root);
      if (!sel.value) { toast('Pilih teknisi terlebih dahulu.', 'err'); sel.focus(); return; }
      const btn = e.target.closest('#approve');
      btn.disabled = true;
      try {
        await api.post(`/admin/reports/${r.id_laporan}/verify`, { keputusan: 'setujui', id_teknisi: Number(sel.value) });
        toast(`Laporan disetujui dan ditugaskan ke ${sel.selectedOptions[0].textContent.split(' · ')[1].replace(/ \(\d+ tugas\)$/, '')}.`);
        techs = await api.get('/admin/technicians');
        await refresh(r.id_laporan);
      } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
    }
    if (e.target.closest('#reject')) {
      const reason = await promptDialog({
        title: 'Tolak laporan', message: `Laporan “${r.judul}” akan ditolak dan berhenti di sini. Beri alasan agar pelapor memahami keputusannya.`,
        label: 'Alasan penolakan', placeholder: 'Mis. kerusakan tidak ditemukan saat dicek', confirmText: 'Tolak laporan', danger: true, minLength: 5,
      });
      if (reason === null) return;
      try {
        await api.post(`/admin/reports/${r.id_laporan}/verify`, { keputusan: 'tolak', catatan: reason });
        toast('Laporan ditolak.');
        await refresh(r.id_laporan);
      } catch (err) { toast(err.message, 'err'); }
    }
  });
  root.addEventListener('keydown', (e) => {
    const tr = e.target.closest?.('tr[data-id]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tr.click(); }
  });
}

// ===================================================================== Monitoring perbaikan (FR-12)
export async function monitoring({ root, isStale }) {
  document.title = 'Monitoring perbaikan · FacilityOPS';
  mount(root, html`${head('Monitoring perbaikan', 'Pantau status seluruh laporan dari dikirim hingga selesai.')}${skeleton(3)}`);
  const [stats, reports] = await Promise.all([api.get('/admin/stats'), api.get('/admin/reports')]);
  if (isStale()) return;
  let filter = 'semua';
  let q = '';
  const FILTERS = [['semua', 'Semua'], ['menunggu', 'Menunggu'], ['ditugaskan', 'Ditugaskan'], ['diperbaiki', 'Diperbaiki'], ['selesai', 'Selesai'], ['ditolak', 'Ditolak']];

  mount(root, html`${head('Monitoring perbaikan', 'Pantau status seluruh laporan dari dikirim hingga selesai.')}
    <div class="stats s5">${stat('Menunggu', stats.menunggu, 'orange')}${stat('Ditugaskan', stats.ditugaskan, 'blue')}${stat('Diperbaiki', stats.diperbaiki, 'blue')}${stat('Selesai', stats.selesai, 'green')}${stat('Ditolak', stats.ditolak, 'red')}</div>
    <div class="toolbar"><div class="seg" id="seg" role="group" aria-label="Filter status">${FILTERS.map(([k, l]) => html`<button data-k="${k}" aria-pressed="${String(k === 'semua')}">${l}</button>`)}</div>
      <span class="spacer"></span><label class="search">${icon('search', 16, 2)}<input id="q" type="search" placeholder="Cari laporan, lokasi, teknisi" aria-label="Cari"></label></div>
    <div id="tbl"></div>`);

  const draw = () => {
    const term = q.trim().toLowerCase();
    const rows = reports.filter((r) => (filter === 'semua' || r.status_laporan === filter)
      && (!term || [r.judul, r.nomor_tiket, r.nama_fasilitas, r.nama_gedung, r.nama_ruangan, r.teknisi, r.pelapor].join(' ').toLowerCase().includes(term)));
    mount($('#tbl', root), html`<div class="list tbl-wrap"><table class="table"><thead><tr><th>Laporan</th><th>Lokasi</th><th>Tingkat</th><th>Status</th><th>Teknisi</th><th>Diperbarui</th></tr></thead><tbody>
      ${rows.map((r) => html`<tr class="click" data-id="${r.id_laporan}" tabindex="0"><td><div class="t">${r.judul}</div><div class="s">${r.nomor_tiket} · ${r.nama_fasilitas}</div></td>
        <td class="nowrap">${lokasi(r)}</td><td>${tingkatText(r.tingkat_kerusakan)}</td><td>${adminStatusBadge(r.status_laporan)}</td>
        <td>${r.teknisi || html`<span class="s">—</span>`}</td><td class="nowrap s">${relTime(r.diperbarui_pada || r.diverifikasi_pada || r.dibuat_pada)}</td></tr>`)}
      ${rows.length ? '' : html`<tr><td colspan="6"><div class="empty">Tidak ada laporan yang cocok.</div></td></tr>`}</tbody></table></div>`);
  };
  draw();
  $('#seg', root).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    filter = b.dataset.k;
    $$('#seg button', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    draw();
  });
  $('#q', root).addEventListener('input', debounce((e) => { q = e.target.value; draw(); }, 120));
  const open = (tr) => { if (tr) location.hash = `#/admin/verifikasi?id=${tr.dataset.id}`; };
  root.addEventListener('click', (e) => open(e.target.closest('tr[data-id]')));
  root.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(e.target.closest?.('tr[data-id]')); });
}

// ===================================================================== Riwayat perbaikan (FR-11)
export async function riwayat({ root, query, go, isStale }) {
  document.title = 'Riwayat perbaikan · FacilityOPS';
  mount(root, html`${head('Riwayat perbaikan', 'Catatan perbaikan yang telah selesai, tersimpan per fasilitas.')}${skeleton(3)}`);
  const idFas = query.fasilitas ? Number(query.fasilitas) : null;
  const rows = await api.get(`/admin/history${idFas ? `?id_fasilitas=${idFas}` : ''}`);
  if (isStale()) return;
  let q = '';
  const fasName = idFas && rows[0] ? `${rows[0].nama_fasilitas} — ${rows[0].nama_gedung} · ${rows[0].nomor_ruangan}` : '';

  mount(root, html`${head('Riwayat perbaikan', 'Catatan perbaikan yang telah selesai, tersimpan per fasilitas.')}
    <div class="toolbar">${idFas ? html`<span class="chip">${fasName || `Fasilitas #${idFas}`}<button data-clear aria-label="Hapus filter fasilitas">×</button></span>` : ''}
      <span class="spacer"></span><label class="search">${icon('search', 16, 2)}<input id="q" type="search" placeholder="Cari fasilitas, lokasi, teknisi" aria-label="Cari"></label></div>
    <div id="tbl"></div>`);

  const draw = () => {
    const term = q.trim().toLowerCase();
    const items = rows.filter((r) => !term || [r.nama_fasilitas, r.judul, r.nama_gedung, r.nama_ruangan, r.teknisi, r.tindakan, r.nomor_tiket].join(' ').toLowerCase().includes(term));
    mount($('#tbl', root), html`<div class="list tbl-wrap"><table class="table"><thead><tr><th>Fasilitas</th><th>Lokasi</th><th>Tindakan perbaikan</th><th>Teknisi</th><th>Selesai</th></tr></thead><tbody>
      ${items.map((r) => html`<tr><td><a class="t" href="#/admin/riwayat?fasilitas=${r.id_fasilitas}">${r.nama_fasilitas}</a><div class="s">${r.judul} · ${r.nomor_tiket}</div></td>
        <td class="nowrap">${lokasi(r)}</td><td style="min-width:220px">${r.tindakan || '—'}</td><td class="nowrap">${r.teknisi}</td><td class="nowrap">${fmtTanggal(r.tanggal_selesai)}<div class="s">${relTime(r.tanggal_selesai)}</div></td></tr>`)}
      ${items.length ? '' : html`<tr><td colspan="5"><div class="empty">Belum ada riwayat perbaikan.</div></td></tr>`}</tbody></table></div>`);
  };
  draw();
  $('#q', root).addEventListener('input', debounce((e) => { q = e.target.value; draw(); }, 120));
  $('[data-clear]', root)?.addEventListener('click', () => go('#/admin/riwayat'));
}

// ===================================================================== Kelola data master (FR-13)
const toInput = (s) => (s ? s.slice(0, 16).replace(' ', 'T') : '');

export async function master({ root, query, state, isStale, reload: rerender }) {
  document.title = 'Gedung dan ruangan · FacilityOPS';
  const TABS = [['gedung', 'Gedung'], ['ruangan', 'Ruangan'], ['fasilitas', 'Fasilitas'], ['jadwal', 'Jadwal']];
  const tab = TABS.some(([k]) => k === query.tab) ? query.tab : 'gedung';
  mount(root, html`${head('Gedung dan ruangan', 'Kelola data gedung, ruangan, fasilitas, dan jadwal.')}${skeleton(3)}`);

  let tanggal = /^\d{4}-\d{2}-\d{2}$/.test(query.tanggal || '') ? query.tanggal : todayStr();
  const [gedung, ruanganAll] = await Promise.all([api.get('/admin/gedung'), api.get('/admin/ruangan')]);
  let rows = await api.get(`/admin/${tab}${tab === 'jadwal' ? `?tanggal=${tanggal}` : ''}`);
  if (isStale()) return;
  let q = '';
  let gFilter = '';
  const meta = state.meta;
  const gOpts = gedung.map((g) => ({ value: g.id_gedung, label: g.nama_gedung }));
  const rOpts = ruanganAll.map((r) => ({ value: r.id_ruangan, label: `${r.nama_gedung} — ${r.nama_ruangan}${r.nama_ruangan.includes(r.nomor_ruangan) ? '' : ` (${r.nomor_ruangan})`}` }));
  const roomStatusOpts = meta.statusRuangan.map((s) => ({ value: s, label: { tersedia: 'Tersedia', digunakan: 'Sedang digunakan', dibooking: 'Dibooking' }[s] }));
  const colorOpts = meta.warna.map((w) => ({ value: w, label: cap({ blue: 'biru', green: 'hijau', orange: 'oranye', purple: 'ungu', teal: 'tosca', pink: 'merah muda' }[w]) }));

  const CFG = {
    gedung: {
      label: 'gedung', pk: 'id_gedung', add: 'Tambah gedung',
      cols: [['Gedung', (r) => html`<div class="t">${r.nama_gedung}</div><div class="s">${r.keterangan || '—'}</div>`], ['Lantai', (r) => r.jumlah_lantai], ['Ruangan', (r) => r.jumlah_ruangan]],
      fields: () => [
        { name: 'nama_gedung', label: 'Nama gedung', required: true, maxlength: 80 },
        { name: 'keterangan', label: 'Keterangan', maxlength: 200 },
        { name: 'jumlah_lantai', label: 'Jumlah lantai', type: 'number', min: 1, max: 50, required: true, default: 1 },
        { name: 'warna', label: 'Warna kartu', type: 'select', options: colorOpts, default: 'blue' },
      ],
      name: (r) => r.nama_gedung, search: (r) => `${r.nama_gedung} ${r.keterangan}`,
    },
    ruangan: {
      label: 'ruangan', pk: 'id_ruangan', add: 'Tambah ruangan', gFilter: true,
      cols: [['Ruangan', (r) => html`<div class="t">${r.nama_ruangan}</div><div class="s">Nomor ${r.nomor_ruangan}</div>`], ['Gedung', (r) => r.nama_gedung], ['Lantai', (r) => r.lantai], ['Kapasitas', (r) => r.kapasitas], ['Status', (r) => roomBadge(r.status_ruangan)]],
      fields: () => [
        { name: 'id_gedung', label: 'Gedung', type: 'select', options: gOpts, required: true, default: gFilter || '' },
        { name: 'nama_ruangan', label: 'Nama ruangan', required: true, maxlength: 80 },
        { name: 'nomor_ruangan', label: 'Nomor ruangan', required: true, maxlength: 20 },
        { name: 'lantai', label: 'Lantai', type: 'number', min: 0, max: 50, required: true, default: 1 },
        { name: 'kapasitas', label: 'Kapasitas (orang)', type: 'number', min: 0, max: 5000, required: true, default: 30 },
        { name: 'status_ruangan', label: 'Status ruangan', type: 'select', options: roomStatusOpts, default: 'tersedia' },
      ],
      name: (r) => r.nama_ruangan, search: (r) => `${r.nama_ruangan} ${r.nomor_ruangan} ${r.nama_gedung}`, gid: (r) => r.id_gedung,
    },
    fasilitas: {
      label: 'fasilitas', pk: 'id_fasilitas', add: 'Tambah fasilitas', gFilter: true,
      cols: [['Fasilitas', (r) => html`<div class="t">${r.nama_fasilitas}</div><div class="s">${r.kategori}</div>`], ['Ruangan', (r) => html`${r.nama_ruangan}<div class="s">${r.nama_gedung}</div>`], ['Kondisi', (r) => kondisiBadge(r.kondisi)]],
      fields: () => [
        { name: 'id_ruangan', label: 'Ruangan', type: 'select', options: rOpts, required: true, placeholder: 'Pilih ruangan…' },
        { name: 'nama_fasilitas', label: 'Nama fasilitas', required: true, maxlength: 80 },
        { name: 'kategori', label: 'Kategori', type: 'select', options: meta.kategori.map((k) => ({ value: k, label: k })), default: 'Lainnya' },
        { name: 'kondisi', label: 'Kondisi', type: 'select', options: meta.kondisi.map((k) => ({ value: k, label: k })), default: 'Baik' },
      ],
      name: (r) => `${r.nama_fasilitas} (${r.nama_ruangan})`, search: (r) => `${r.nama_fasilitas} ${r.kategori} ${r.nama_ruangan} ${r.nama_gedung}`, gid: (r) => r.id_gedung,
    },
    jadwal: {
      label: 'jadwal', pk: 'id_jadwal', add: 'Tambah jadwal', gFilter: true,
      cols: [['Waktu', (r) => `${jam(r.waktu_mulai.slice(11, 16))} – ${jam(r.waktu_selesai.slice(11, 16))}`], ['Keterangan', (r) => r.keterangan || '—'], ['Ruangan', (r) => html`${r.nama_ruangan}<div class="s">${r.nama_gedung}</div>`]],
      fields: () => [
        { name: 'id_ruangan', label: 'Ruangan', type: 'select', options: rOpts, required: true, placeholder: 'Pilih ruangan…' },
        { name: 'waktu_mulai', label: 'Waktu mulai', type: 'datetime-local', required: true, default: `${tanggal}T08:00` },
        { name: 'waktu_selesai', label: 'Waktu selesai', type: 'datetime-local', required: true, default: `${tanggal}T09:40` },
        { name: 'keterangan', label: 'Keterangan (mis. kuliah atau booking)', maxlength: 150 },
      ],
      name: (r) => `jadwal ${r.nama_ruangan} ${r.waktu_mulai.slice(11, 16)}`, search: (r) => `${r.keterangan} ${r.nama_ruangan} ${r.nama_gedung}`, gid: (r) => r.id_gedung,
      toForm: (r) => ({ ...r, waktu_mulai: toInput(r.waktu_mulai), waktu_selesai: toInput(r.waktu_selesai) }),
    },
  };
  const cfg = CFG[tab];

  mount(root, html`${head('Gedung dan ruangan', 'Kelola data gedung, ruangan, fasilitas, dan jadwal.')}
    <div class="toolbar"><div class="seg" role="group" aria-label="Jenis data">${TABS.map(([k, l]) => html`<a class="${k === tab ? 'on' : ''}" href="#/admin/master?tab=${k}" style="padding:6px 16px;border-radius:8px;font-size:13px;font-weight:${k === tab ? 600 : 500};color:${k === tab ? 'var(--ink)' : 'var(--soft)'};${k === tab ? 'background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.12)' : ''}">${l}</a>`)}</div></div>
    <div class="toolbar" style="margin-top:0">
      ${cfg.gFilter ? html`<select class="select-pill" id="g" aria-label="Filter gedung"><option value="">Semua gedung</option>${gOpts.map((o) => html`<option value="${o.value}">${o.label}</option>`)}</select>` : ''}
      ${tab === 'jadwal' ? html`<input class="input-pill" type="date" id="tgl" value="${tanggal}" aria-label="Tanggal jadwal">` : ''}
      <label class="search">${icon('search', 16, 2)}<input id="q" type="search" placeholder="Cari ${cfg.label}" aria-label="Cari"></label>
      <span class="spacer"></span><button class="btn btn-sm" id="add">${icon('plus', 14, 2.4)} ${cfg.add}</button></div>
    <div id="tbl"></div>`);

  const draw = () => {
    const term = q.trim().toLowerCase();
    const items = rows.filter((r) => (!gFilter || (cfg.gid ? cfg.gid(r) : r.id_gedung) === Number(gFilter)) && (!term || cfg.search(r).toLowerCase().includes(term)));
    mount($('#tbl', root), html`<div class="list tbl-wrap"><table class="table"><thead><tr>${cfg.cols.map(([h]) => html`<th>${h}</th>`)}<th></th></tr></thead><tbody>
      ${items.map((r) => html`<tr>${cfg.cols.map(([, f]) => html`<td>${f(r)}</td>`)}<td class="act">
        <button class="btn-link" data-edit="${r[cfg.pk]}">Ubah</button><button class="btn-link danger" data-del="${r[cfg.pk]}">Hapus</button></td></tr>`)}
      ${items.length ? '' : html`<tr><td colspan="${cfg.cols.length + 1}"><div class="empty">Tidak ada data${tab === 'jadwal' ? ' pada tanggal ini' : ''}.</div></td></tr>`}</tbody></table></div>
      <p class="form-hint" style="margin:8px 4px">${items.length} ${cfg.label}</p>`);
  };
  draw();

  // Daftar pilihan (gedung/ruangan) dipakai di banyak form, jadi perubahan keduanya memuat ulang seluruh tampilan.
  const reload = async () => {
    if (tab === 'gedung' || tab === 'ruangan') return rerender();
    rows = await api.get(`/admin/${tab}${tab === 'jadwal' ? `?tanggal=${tanggal}` : ''}`);
    draw();
  };
  const save = (id) => async (vals) => (id ? api.put(`/admin/${tab}/${id}`, vals) : api.post(`/admin/${tab}`, vals));

  $('#q', root).addEventListener('input', debounce((e) => { q = e.target.value; draw(); }, 120));
  $('#g', root)?.addEventListener('change', (e) => { gFilter = e.target.value; draw(); });
  $('#tgl', root)?.addEventListener('change', async (e) => { if (e.target.value) { tanggal = e.target.value; try { await reload(); } catch (err) { toast(err.message, 'err'); } } });

  $('#add', root).onclick = async () => {
    const ok = await formDialog({ title: cfg.add, fields: cfg.fields(), onSubmit: save(null) });
    if (ok) { toast('Data ditambahkan.'); await reload(); }
  };
  $('#tbl', root).addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    const dl = e.target.closest('[data-del]');
    if (ed) {
      const id = Number(ed.dataset.edit);
      const row = rows.find((r) => r[cfg.pk] === id);
      const ok = await formDialog({ title: `Ubah ${cfg.label}`, fields: cfg.fields(), values: cfg.toForm ? cfg.toForm(row) : row, onSubmit: save(id) });
      if (ok) { toast('Perubahan disimpan.'); await reload(); }
    }
    if (dl) {
      const id = Number(dl.dataset.del);
      const row = rows.find((r) => r[cfg.pk] === id);
      const yes = await confirmDialog({
        title: `Hapus ${cfg.label}?`, danger: true, confirmText: 'Hapus',
        message: `“${cfg.name(row)}” akan dihapus permanen.${tab === 'gedung' ? ' Seluruh ruangan dan fasilitas di dalamnya ikut terhapus.' : tab === 'ruangan' ? ' Seluruh fasilitas dan jadwal di dalamnya ikut terhapus.' : ''}`,
      });
      if (!yes) return;
      try { await api.del(`/admin/${tab}/${id}`); toast('Data dihapus.'); await reload(); } catch (err) { toast(err.message, 'err'); }
    }
  });
}
