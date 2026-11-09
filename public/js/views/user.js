import { api } from '../api.js';
import {
  html, raw, mount, $, $$, icon, chev, roomBadge, kondisiBadge, userStatusBadge, relTime, fmtHari, shiftDate, jam,
  toast, skeleton, debounce, cap,
} from '../ui.js';

// ===================================================================== Pilih gedung (FR-02)
export async function buildings({ root, user, isStale }) {
  document.title = 'Gedung · FacilityOPS';
  mount(root, html`<div class="page w-lg"><h1 class="title">Gedung</h1>${skeleton(2)}</div>`);
  const [list, mine] = await Promise.all([api.get('/buildings'), api.get('/reports/mine')]);
  if (isStale()) return;

  const card = (g) => html`<a class="bcard" href="#/gedung/${g.id_gedung}">
    <div class="top"><span class="tile ${g.warna}">${icon('building', 22)}</span>${chev()}</div>
    <div class="n">${g.nama_gedung}</div><div class="m">${g.jumlah_ruangan} ruangan · ${g.jumlah_lantai} lantai</div></a>`;

  mount(root, html`<div class="page w-lg">
    <div class="page-head"><div><h1 class="title">Gedung</h1><p class="subtitle">Pilih gedung untuk melihat ruangan dan fasilitasnya.</p></div>
      <label class="search">${icon('search', 16, 2)}<input id="q" type="search" placeholder="Cari gedung" aria-label="Cari gedung"></label></div>
    <div class="grid3" id="grid" style="margin-top:26px"></div>
    ${mine.length ? html`<h2 class="section-title">Laporan terakhir</h2><div class="list">
      ${mine.slice(0, 3).map((r) => html`<a class="row" href="#/laporan-saya"><div><div class="t">${r.judul}</div><div class="s">${r.nama_gedung} · ${r.nama_ruangan}</div></div>
        <div class="end">${userStatusBadge(r.status_laporan)}${chev()}</div></a>`)}</div>` : ''}
  </div>`);

  const grid = $('#grid', root);
  const draw = (q = '') => {
    const items = list.filter((g) => g.nama_gedung.toLowerCase().includes(q.trim().toLowerCase()));
    mount(grid, items.length ? html`${items.map(card)}` : html`<div class="empty card" style="grid-column:1/-1">Tidak ada gedung yang cocok dengan “${q}”.</div>`);
  };
  draw();
  $('#q', root).addEventListener('input', debounce((e) => draw(e.target.value), 100));
}

// ===================================================================== Pilih ruangan (FR-03, FR-05)
export async function rooms({ root, params, isStale }) {
  mount(root, html`<div class="page w-md">${skeleton(3)}</div>`);
  const { gedung, ruangan } = await api.get(`/buildings/${params[0]}`);
  if (isStale()) return;
  document.title = `${gedung.nama_gedung} · FacilityOPS`;
  let filter = 'semua';
  const tabs = [['semua', 'Semua'], ['tersedia', 'Tersedia'], ['digunakan', 'Digunakan'], ['dibooking', 'Dibooking']];

  mount(root, html`<div class="page w-md"><a class="back" href="#/gedung">${icon('left', 14, 2.2)} Gedung</a>
    <h1 class="title">${gedung.nama_gedung}</h1>
    <p class="subtitle">${ruangan.length} ruangan. Pilih satu untuk melihat status, jadwal, dan fasilitasnya.</p>
    <div style="margin:18px 0 14px"><div class="seg" id="seg" role="group" aria-label="Filter status ruangan">
      ${tabs.map(([k, l]) => html`<button data-k="${k}" aria-pressed="${String(k === 'semua')}">${l}</button>`)}</div></div>
    <div id="list"></div></div>`);

  const draw = () => {
    const items = filter === 'semua' ? ruangan : ruangan.filter((r) => r.status_ruangan === filter);
    mount($('#list', root), items.length
      ? html`<div class="list">${items.map((r) => html`<a class="row" href="#/ruangan/${r.id_ruangan}">
          <div><div class="t">${r.nama_ruangan}</div><div class="s">Nomor ${r.nomor_ruangan} · Kapasitas ${r.kapasitas} orang</div></div>
          <div class="end">${roomBadge(r.status_ruangan)}${chev()}</div></a>`)}</div>`
      : html`<div class="list"><div class="empty">Tidak ada ruangan dengan status ini.</div></div>`);
  };
  draw();
  $('#seg', root).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    filter = b.dataset.k;
    $$('#seg button', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    draw();
  });
}

// ===================================================================== Detail ruangan (FR-04, FR-05, FR-06)
export async function roomDetail({ root, params, isStale }) {
  const id = params[0];
  mount(root, html`<div class="page w-md">${skeleton(3)}</div>`);
  let data = await api.get(`/rooms/${id}`);
  if (isStale()) return;
  const { ruangan, hari_ini } = data;
  document.title = `${ruangan.nama_ruangan} · FacilityOPS`;
  const maxDate = shiftDate(hari_ini, 13);

  const stateCell = (it) => {
    if (it.type === 'kosong') return html`<span class="st">Tersedia</span>`;
    return {
      selesai: html`<span class="st">Selesai</span>`,
      berlangsung: html`<span class="badge b-green">Berlangsung</span>`,
      berikutnya: html`<span class="badge b-blue">Berikutnya</span>`,
      terjadwal: html`<span class="st">Terjadwal</span>`,
    }[it.state];
  };

  const drawSchedule = () => {
    const isToday = data.tanggal === hari_ini;
    mount($('#sched', root), html`
      <div class="head-row" style="align-items:center;margin:34px 0 12px">
        <h2 class="section-title" style="margin:0">${isToday ? 'Jadwal hari ini' : `Jadwal ${fmtHari(data.tanggal)}`}</h2>
        <div class="date-nav" role="group" aria-label="Pilih hari">
          <button data-d="-1" aria-label="Hari sebelumnya" ${data.tanggal <= hari_ini ? raw('disabled') : ''}>${icon('left', 14, 2.4)}</button>
          <button data-d="1" aria-label="Hari berikutnya" ${data.tanggal >= maxDate ? raw('disabled') : ''}>${icon('right', 14, 2.4)}</button></div></div>
      <div class="list sched">${data.jadwal.map((it) => html`<div class="row">
        <span class="time">${jam(it.mulai)} – ${jam(it.selesai)}</span>
        <span class="what ${it.type === 'kosong' ? 'free' : ''}">${it.type === 'kosong' ? 'Kosong' : it.keterangan}</span>${stateCell(it)}</div>`)}
        ${data.jadwal.length ? '' : html`<div class="empty">Belum ada jadwal.</div>`}</div>`);
  };

  mount(root, html`<div class="page w-md"><a class="back" href="#/gedung/${ruangan.id_gedung}">${icon('left', 14, 2.2)} ${ruangan.nama_gedung}</a>
    <div class="room-head"><div><h1 class="title">${ruangan.nama_ruangan}</h1>
      <p class="subtitle">Lantai ${ruangan.lantai} · Kapasitas ${ruangan.kapasitas} orang</p></div>
      <div style="padding-top:10px">${roomBadge(ruangan.status_ruangan)}</div></div>
    <div id="sched"></div>
    <h2 class="section-title">Fasilitas</h2>
    <div class="list">${data.fasilitas.length ? data.fasilitas.map((f) => html`<div class="row"><span class="t" style="font-weight:500">${f.nama_fasilitas}</span>${kondisiBadge(f.kondisi)}</div>`)
      : html`<div class="empty">Belum ada data fasilitas.</div>`}</div>
    <div class="card cta"><div><b>Menemukan kerusakan?</b><span>Laporkan agar segera diverifikasi dan ditangani teknisi.</span></div>
      <a class="btn" href="#/ruangan/${ruangan.id_ruangan}/lapor">Laporkan kerusakan</a></div></div>`);
  drawSchedule();

  $('#sched', root).addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-d]');
    if (!b || b.disabled) return;
    const next = shiftDate(data.tanggal, Number(b.dataset.d));
    try {
      data = await api.get(`/rooms/${id}?tanggal=${next}`);
      drawSchedule();
    } catch (err) { toast(err.message, 'err'); }
  });
}

// ===================================================================== Laporan kerusakan (FR-07)
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 5 * 1024 * 1024;

const readAsDataURL = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(new Error('Foto tidak dapat dibaca.'));
  r.readAsDataURL(file);
});
const loadImage = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

// Validasi format & ukuran, lalu perkecil foto besar (maks. 1600 px) agar unggahan ringan.
async function prepareImage(file) {
  if (!ALLOWED.includes(file.type)) throw new Error('Format foto harus JPG, PNG, WEBP, atau GIF.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Ukuran foto terlalu besar (maksimal 20 MB).');
  let dataUrl = await readAsDataURL(file);
  if (file.type !== 'image/gif' && file.size > 600 * 1024) {
    try {
      const img = await loadImage(dataUrl);
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      dataUrl = c.toDataURL('image/jpeg', 0.85);
    } catch { /* pakai berkas asli */ }
  }
  if ((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75 > MAX_BYTES) throw new Error('Ukuran foto maksimal 5 MB.');
  return dataUrl;
}

export async function reportForm({ root, params, go, state, isStale }) {
  mount(root, html`<div class="page w-sm">${skeleton(2)}</div>`);
  const { ruangan, fasilitas } = await api.get(`/rooms/${params[0]}`);
  if (isStale()) return;
  document.title = 'Laporkan kerusakan · FacilityOPS';
  const selectable = fasilitas.filter((f) => !f.laporan_aktif);
  const kategori = state.meta.kategori;
  let tingkat = 'sedang';
  let foto = null;

  mount(root, html`<div class="page w-sm"><a class="back" href="#/ruangan/${ruangan.id_ruangan}">${icon('left', 14, 2.2)} ${ruangan.nama_ruangan}</a>
    <h1 class="title">Laporkan kerusakan</h1>
    <p class="subtitle">${ruangan.nama_gedung} · ${ruangan.nama_ruangan}</p>
    <form id="f" novalidate style="margin-top:22px">
      ${selectable.length === 0 ? html`<div class="form-error">Semua fasilitas di ruangan ini sudah memiliki laporan yang sedang diproses.</div>` : ''}
      <div class="group">
        <label class="field sel" data-f="fas"><span class="lbl">Fasilitas</span><select name="fas">
          ${fasilitas.map((f) => html`<option value="${f.id_fasilitas}" data-kat="${f.kategori}" ${f.laporan_aktif ? raw('disabled') : ''}>${f.nama_fasilitas}${f.laporan_aktif ? ' — sudah dilaporkan' : ''}</option>`)}</select></label>
        <label class="field sel" data-f="kat"><span class="lbl">Kategori</span><select name="kat">
          ${kategori.map((k) => html`<option>${k}</option>`)}</select></label>
        <label class="field" data-f="desk"><span class="lbl">Deskripsi</span>
          <textarea name="desk" rows="3" maxlength="1000" placeholder="Ceritakan apa yang terjadi"></textarea><div class="err" hidden></div></label>
      </div>
      <span class="label-sm">Tingkat kerusakan</span>
      <div class="seg full" id="tk" role="group" aria-label="Tingkat kerusakan">
        ${state.meta.tingkat.map((t) => html`<button type="button" data-t="${t}" aria-pressed="${String(t === 'sedang')}">${cap(t)}</button>`)}</div>
      <label class="upload" id="up" tabindex="0" data-f="foto">
        <input type="file" id="file" accept="image/jpeg,image/png,image/webp,image/gif">
        <span id="upbody">${icon('camera', 22, 1.8)}<span>Tambah foto kerusakan</span><span class="hint">JPG, PNG, WEBP, atau GIF · maks. 5 MB</span></span></label>
      <div class="err" id="fotoerr" hidden style="color:var(--red);font-size:12.5px;margin:6px 4px 0"></div>
      <div class="form-error" id="err" role="alert" hidden style="margin-top:14px"></div>
      <button class="btn btn-lg" id="submit" style="margin-top:14px" ${selectable.length ? '' : raw('disabled')}>Kirim laporan</button>
    </form></div>`);

  const form = $('#f', root);
  const fasSel = form.fas;
  const first = selectable[0];
  if (first) { fasSel.value = first.id_fasilitas; form.kat.value = first.kategori; }
  fasSel.addEventListener('change', () => { form.kat.value = fasSel.selectedOptions[0].dataset.kat; });

  const setErr = (name, msg) => {
    const f = $(`[data-f="${name}"]`, root);
    f.classList.toggle('invalid', !!msg);
    const e = $('.err', f);
    if (e) { e.hidden = !msg; e.textContent = msg || ''; }
  };

  form.desk.addEventListener('input', () => { if (form.desk.value.trim().length >= 10) setErr('desk', ''); });

  $('#tk', root).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-t]');
    if (!b) return;
    tingkat = b.dataset.t;
    $$('#tk button', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });

  const up = $('#up', root);
  const fotoErr = $('#fotoerr', root);
  const showFoto = (dataUrl) => {
    mount($('#upbody', root), html`<img src="${dataUrl}" alt="Pratinjau foto kerusakan"><span class="hint">Klik untuk mengganti foto</span>`);
  };
  const choose = async (file) => {
    if (!file) return;
    fotoErr.hidden = true;
    up.classList.remove('invalid');
    try {
      foto = await prepareImage(file);
      showFoto(foto);
      fotoErr.hidden = true;
      up.classList.remove('invalid');
    } catch (err) {
      foto = null;
      fotoErr.hidden = false;
      fotoErr.textContent = err.message;
      up.classList.add('invalid');
    }
  };
  $('#file', root).addEventListener('change', (e) => choose(e.target.files[0]));
  up.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file', root).click(); } });
  ['dragover', 'dragenter'].forEach((n) => up.addEventListener(n, (e) => { e.preventDefault(); up.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((n) => up.addEventListener(n, () => up.classList.remove('drag')));
  up.addEventListener('drop', (e) => { e.preventDefault(); choose(e.dataTransfer.files[0]); });

  form.onsubmit = async (e) => {
    e.preventDefault();
    $('#err', root).hidden = true;
    const desk = form.desk.value.trim();
    setErr('desk', desk.length >= 10 ? '' : 'Deskripsi minimal 10 karakter.');
    if (!foto) { fotoErr.hidden = false; fotoErr.textContent = 'Foto kerusakan wajib dilampirkan.'; up.classList.add('invalid'); }
    if (desk.length < 10 || !foto) return;

    const btn = $('#submit', root);
    btn.disabled = true;
    btn.textContent = 'Mengirim…';
    try {
      const res = await api.post('/reports', {
        id_fasilitas: Number(fasSel.value), kategori_kerusakan: form.kat.value, tingkat_kerusakan: tingkat,
        deskripsi: desk, foto: { data: foto },
      });
      toast(`Laporan terkirim · tiket ${res.nomor_tiket}`);
      go('#/laporan-saya');
    } catch (err) {
      const box = $('#err', root);
      box.hidden = false;
      box.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Kirim laporan';
    }
  };
}

// ===================================================================== Laporan saya (FR-14)
function stepper(status) {
  let labels = ['Dikirim', 'Diverifikasi', 'Diperbaiki', 'Selesai'];
  let cls; let lines;
  switch (status) {
    case 'menunggu': cls = ['done', 'cur', '', '']; lines = ['line-on', '', '']; break;
    case 'ditugaskan':
    case 'diperbaiki': cls = ['done', 'done', 'cur', '']; lines = ['line-on', 'line-on', '']; break;
    case 'selesai': cls = ['ok', 'ok', 'ok', 'ok']; lines = ['line-done', 'line-done', 'line-done']; break;
    default: cls = ['done', 'bad', '', '']; lines = ['line-on', '', '']; labels = ['Dikirim', 'Ditolak', 'Diperbaiki', 'Selesai'];
  }
  return html`<div class="steps" aria-label="Progres laporan">${labels.map((l, i) => html`<div class="step ${cls[i]} ${lines[i] || ''}"><span class="dot"></span>${l}</div>`)}</div>`;
}

export async function myReports({ root, isStale }) {
  document.title = 'Laporan saya · FacilityOPS';
  mount(root, html`<div class="page w-md"><h1 class="title">Laporan saya</h1>${skeleton(3)}</div>`);
  const list = await api.get('/reports/mine');
  if (isStale()) return;

  const note = (r) => {
    if (r.status_laporan === 'ditolak') return html`<div class="note"><b>Alasan penolakan:</b> ${r.catatan_admin || 'Tidak ada catatan dari admin.'}</div>`;
    if (r.teknisi && r.status_laporan === 'selesai')
      return html`<div class="note">Diselesaikan oleh <b>${r.teknisi}</b>.${r.tindakan ? html` ${r.tindakan}` : ''}</div>`;
    if (r.teknisi) return html`<div class="note">Ditangani oleh <b>${r.teknisi}</b>.${r.tindakan ? html` ${r.tindakan}` : ''}</div>`;
    return '';
  };

  mount(root, html`<div class="page w-md"><h1 class="title">Laporan saya</h1><p class="subtitle">Pantau status setiap laporan yang kamu kirim.</p>
    <div style="margin-top:24px">${list.length ? list.map((r) => html`<article class="card rcard">
      <div class="head"><div><div class="t">${r.judul}</div><div class="s">${r.nama_gedung} · ${r.nama_ruangan} · ${relTime(r.dibuat_pada)}</div>
        <div class="tiket">${r.nomor_tiket} · ${r.nama_fasilitas}</div></div>${userStatusBadge(r.status_laporan)}</div>
      ${stepper(r.status_laporan)}${note(r)}</article>`)
      : html`<div class="card empty">Belum ada laporan. Pilih gedung dan ruangan, lalu laporkan kerusakan yang kamu temukan.<br><br><a class="btn" href="#/gedung">Lihat gedung</a></div>`}</div></div>`);
}
