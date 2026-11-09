import { api } from '../api.js';
import {
  html, raw, mount, $, $$, chev, techStatusBadge, shortGedung, relTime, fmtTanggalWaktu, toast, skeleton, viewPhoto, cap,
} from '../ui.js';

const lokasi = (r) => `${shortGedung(r.nama_gedung)} · ${r.nomor_ruangan}`;
const head = html`<h1 class="title">Tugas saya</h1><p class="subtitle">Perbarui progres perbaikan agar pelapor dan admin ikut terpantau.</p>`;

// ===================================================================== Tugas saya (FR-10)
export async function tugas({ root, query, isStale }) {
  document.title = 'Tugas saya · FacilityOPS';
  mount(root, html`<div class="page w-xl">${head}${skeleton(3)}</div>`);
  let [tasks, history] = await Promise.all([api.get('/tech/tasks'), api.get('/tech/history')]);
  if (isStale()) return;

  let selected = Number(query.id) || (tasks.find((t) => t.status_perbaikan !== 'selesai') || tasks[0])?.id_perbaikan || null;
  let status = null; // status yang dipilih pada kontrol segmented

  const listHtml = () => html`<div class="list">${tasks.map((t) => html`<button class="row ${t.id_perbaikan === selected ? 'sel' : ''}" data-id="${t.id_perbaikan}">
      <div><div class="t">${t.judul}</div><div class="s">${lokasi(t)}</div></div><div class="end">${techStatusBadge(t.status_perbaikan)}</div></button>`)}</div>`;

  const panelHtml = () => {
    const t = tasks.find((x) => x.id_perbaikan === selected);
    if (!t) return html`<div class="card pcard"><div class="empty">Belum ada tugas perbaikan untuk Anda.</div></div>`;
    const done = t.status_perbaikan === 'selesai';
    status = status || t.status_perbaikan;
    return html`<section class="card pcard" aria-label="Perbarui progres">
      <div class="photo"><img src="${t.foto_url}" alt="Foto dari pelapor" data-zoom="${t.foto_url}"></div>
      <div class="lbl">Perbarui progres</div><h2>${t.judul}</h2><div class="loc">${t.nama_gedung} · ${t.nama_ruangan}</div>
      <p class="info">${t.deskripsi}<br><span style="color:var(--muted);font-size:12.5px">${t.nama_fasilitas} · ${t.kategori_kerusakan} · tingkat ${t.tingkat_kerusakan} · ${t.nomor_tiket}</span></p>
      <div class="seg full" id="seg" style="margin-top:14px" role="group" aria-label="Status perbaikan">
        ${['ditugaskan', 'diperbaiki', 'selesai'].map((s) => html`<button data-s="${s}" aria-pressed="${String(s === status)}" ${done ? raw('disabled') : ''}>${cap(s)}</button>`)}</div>
      <label class="note-field"><span>Catatan perbaikan</span><textarea id="note" maxlength="1000" placeholder="Tulis tindakan yang sudah dilakukan" ${done ? raw('readonly') : ''}>${t.tindakan || ''}</textarea></label>
      ${done ? html`<p class="form-hint">Selesai pada ${fmtTanggalWaktu(t.tanggal_selesai)}. Tugas yang sudah selesai tidak dapat diubah.</p>`
        : html`<div class="form-error" id="err" role="alert" hidden style="margin:12px 0 0"></div><button class="btn" id="save">Simpan pembaruan</button>`}
    </section>`;
  };

  const historyHtml = () => html`<h2 class="section-title">Riwayat perbaikan</h2><div class="list">
    ${history.slice(0, 5).map((h) => html`<div class="row"><div><div class="t">${h.judul}</div><div class="s">${lokasi(h)} · Selesai ${relTime(h.tanggal_selesai).toLowerCase().replace('hari ini, ', 'hari ini ')}</div></div>${techStatusBadge('selesai')}</div>`)}
    ${history.length ? '' : html`<div class="empty">Belum ada riwayat perbaikan.</div>`}</div>
    ${history.length > 5 ? html`<p style="margin:10px 4px"><a href="#/riwayat">Lihat semua riwayat (${history.length})</a></p>` : ''}`;

  const draw = () => {
    mount($('#list', root), tasks.length ? listHtml() : html`<div class="list"><div class="empty">Tidak ada tugas aktif. Tugas baru muncul setelah admin menugaskan laporan kepada Anda.</div></div>`);
    mount($('#panel', root), panelHtml());
    mount($('#hist', root), historyHtml());
  };

  mount(root, html`<div class="page w-xl">${head}<div class="tech"><div id="list"></div><div id="panel"></div></div><div id="hist"></div></div>`);
  draw();

  root.addEventListener('click', async (e) => {
    const row = e.target.closest('button.row[data-id]');
    if (row) { selected = Number(row.dataset.id); status = null; mount($('#list', root), listHtml()); mount($('#panel', root), panelHtml()); return; }
    const z = e.target.closest('[data-zoom]');
    if (z) { viewPhoto(z.dataset.zoom); return; }
    const seg = e.target.closest('#seg button[data-s]');
    if (seg) { status = seg.dataset.s; $$('#seg button', root).forEach((b) => b.setAttribute('aria-pressed', String(b === seg))); return; }

    if (e.target.closest('#save')) {
      const t = tasks.find((x) => x.id_perbaikan === selected);
      const note = $('#note', root).value.trim();
      const err = $('#err', root);
      err.hidden = true;
      if (status === 'selesai' && note.length < 5) {
        err.hidden = false;
        err.textContent = 'Isi catatan perbaikan (minimal 5 karakter) sebelum menandai tugas selesai.';
        $('#note', root).focus();
        return;
      }
      const btn = e.target.closest('#save');
      btn.disabled = true;
      btn.textContent = 'Menyimpan…';
      try {
        await api.patch(`/tech/tasks/${t.id_perbaikan}`, { status, tindakan: note || null });
        toast(status === 'selesai' ? 'Perbaikan ditandai selesai dan masuk riwayat.' : 'Pembaruan tersimpan.');
        [tasks, history] = await Promise.all([api.get('/tech/tasks'), api.get('/tech/history')]);
        status = null;
        draw();
      } catch (ex) {
        err.hidden = false;
        err.textContent = ex.message;
        btn.disabled = false;
        btn.textContent = 'Simpan pembaruan';
      }
    }
  });
}

// ===================================================================== Riwayat (FR-11)
export async function riwayat({ root, isStale }) {
  document.title = 'Riwayat · FacilityOPS';
  mount(root, html`<div class="page w-md"><h1 class="title">Riwayat</h1>${skeleton(3)}</div>`);
  const list = await api.get('/tech/history');
  if (isStale()) return;
  mount(root, html`<div class="page w-md"><h1 class="title">Riwayat</h1><p class="subtitle">Seluruh perbaikan yang sudah Anda selesaikan.</p>
    <div style="margin-top:24px">${list.length ? list.map((h) => html`<article class="card rcard"><div class="head"><div><div class="t">${h.judul}</div>
      <div class="s">${h.nama_gedung} · ${h.nama_ruangan} · ${h.nama_fasilitas}</div><div class="tiket">${h.nomor_tiket} · selesai ${fmtTanggalWaktu(h.tanggal_selesai)}</div></div>${techStatusBadge('selesai')}</div>
      <div class="note"><b>Tindakan:</b> ${h.tindakan || '—'}</div></article>`)
      : html`<div class="card empty">Belum ada riwayat perbaikan.</div>`}</div></div>`);
}
