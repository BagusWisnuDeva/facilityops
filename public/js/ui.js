// Pembantu tampilan: templat HTML aman, ikon, badge, dialog, toast, format waktu.

// ---------- Templat HTML dengan escape otomatis ----------
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const val = (v) => {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  return esc(v);
};
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += val(vals[i]); });
  return new Raw(out);
}
export const mount = (el, tpl) => { el.innerHTML = String(tpl); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- Ikon ----------
const P = {
  building: '<path d="M5 21V10a7 7 0 0 1 14 0v11"/><rect x="10" y="14" width="4" height="7" rx="1"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.2-2h5.6L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.4"/>',
  logout: '<path d="M10 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H10"/><path d="M15 8l4 4-4 4M19 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
export const icon = (name, size = 20, sw = 1.8) =>
  raw(`<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`);
export const chev = () => html`<span class="chev">${icon('right', 18, 2)}</span>`;

// ---------- Badge ----------
const mk = (kind, text) => html`<span class="badge b-${kind}">${text}</span>`;
export const ROOM_STATUS = { tersedia: ['green', 'Tersedia'], digunakan: ['orange', 'Sedang digunakan'], dibooking: ['blue', 'Dibooking'] };
export const KONDISI = { Baik: 'green', Rusak: 'red', 'Dalam perbaikan': 'orange' };
const USER_STATUS = { menunggu: ['orange', 'Menunggu verifikasi'], ditolak: ['red', 'Ditolak'], ditugaskan: ['blue', 'Diverifikasi'], diperbaiki: ['blue', 'Sedang diperbaiki'], selesai: ['green', 'Selesai'] };
const ADMIN_STATUS = { menunggu: ['orange', 'Menunggu'], ditolak: ['red', 'Ditolak'], ditugaskan: ['blue', 'Ditugaskan'], diperbaiki: ['blue', 'Diperbaiki'], selesai: ['green', 'Selesai'] };
const TECH_STATUS = { ditugaskan: ['blue', 'Ditugaskan'], diperbaiki: ['orange', 'Diperbaiki'], selesai: ['green', 'Selesai'] };
export const roomBadge = (s) => mk(...(ROOM_STATUS[s] || ['gray', s]));
export const kondisiBadge = (k) => mk(KONDISI[k] || 'gray', k);
export const userStatusBadge = (s) => mk(...(USER_STATUS[s] || ['gray', s]));
export const adminStatusBadge = (s) => mk(...(ADMIN_STATUS[s] || ['gray', s]));
export const techStatusBadge = (s) => mk(...(TECH_STATUS[s] || ['gray', s]));
export const tingkatText = (t) => html`<span class="tk-${t}">${cap(t)}</span>`;

// ---------- Teks & waktu ----------
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
export const shortGedung = (n) => String(n || '').replace(/^Gedung /, '');
export const initial = (u) => (u?.panggilan || u?.nama || '?').trim()[0].toUpperCase();
const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export function parseLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}
export const jam = (hhmm) => String(hhmm).replace(':', '.');

export function relTime(s) {
  const d = parseLocal(s);
  if (!d) return '-';
  const now = new Date();
  const dayStart = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((dayStart(now) - dayStart(d)) / 86400000);
  const hm = `${pad(d.getHours())}.${pad(d.getMinutes())}`;
  if (diff <= 0) return `Hari ini, ${hm}`;
  if (diff === 1) return `Kemarin, ${hm}`;
  if (diff < 7) return `${diff} hari lalu`;
  if (diff < 35) return `${Math.floor(diff / 7)} minggu lalu`;
  const mo = Math.round(diff / 30);
  return mo < 12 ? `${mo} bulan lalu` : `${Math.floor(diff / 365)} tahun lalu`;
}
export function fmtTanggal(s) {
  const d = parseLocal(s.length === 10 ? `${s} 00:00` : s);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}` : '-';
}
export function fmtTanggalWaktu(s) {
  const d = parseLocal(s);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}, ${pad(d.getHours())}.${pad(d.getMinutes())}` : '-';
}
export function fmtHari(dateStr) {
  const d = parseLocal(`${dateStr} 00:00`);
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
export function shiftDate(dateStr, n) {
  const d = parseLocal(`${dateStr} 00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const todayStr = () => {
  const n = new Date();
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
};

export const debounce = (fn, ms = 150) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- Toast ----------
export function toast(message, type = 'ok') {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'err' ? ' err' : '');
  el.setAttribute('role', type === 'err' ? 'alert' : 'status');
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), type === 'err' ? 5200 : 3200);
}

// ---------- Dialog ----------
function openDialog(inner, className = '') {
  const dlg = document.createElement('dialog');
  if (className) dlg.className = className;
  dlg.innerHTML = String(inner);
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg && className === 'photo-view') dlg.close(); });
  dlg.showModal();
  return dlg;
}

export function confirmDialog({ title, message, confirmText = 'Ya', cancelText = 'Batal', danger = false }) {
  return new Promise((resolve) => {
    const dlg = openDialog(html`<div class="dlg"><h2>${title}</h2><p class="msg">${message}</p>
      <div class="btns"><button class="btn btn-gray" data-v="0">${cancelText}</button>
      <button class="btn ${danger ? 'btn-red' : ''}" data-v="1">${confirmText}</button></div></div>`);
    let result = false;
    dlg.addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) { result = b.dataset.v === '1'; dlg.close(); } });
    dlg.addEventListener('close', () => resolve(result));
  });
}

// Dialog dengan satu kolom teks (mis. alasan penolakan). Mengembalikan teks atau null bila dibatalkan.
export function promptDialog({ title, message, label, placeholder = '', confirmText = 'Kirim', danger = false, minLength = 0 }) {
  return new Promise((resolve) => {
    const dlg = openDialog(html`<form class="dlg" novalidate><h2>${title}</h2>${message ? html`<p class="msg">${message}</p>` : ''}
      <div class="group"><label class="field"><span class="lbl">${label}</span><textarea name="v" rows="3" placeholder="${placeholder}"></textarea>
      <div class="err" hidden></div></label></div>
      <div class="btns"><button type="button" class="btn btn-gray" data-cancel>Batal</button>
      <button class="btn ${danger ? 'btn-red' : ''}">${confirmText}</button></div></form>`);
    let result = null;
    const form = $('form', dlg);
    $('textarea', dlg).focus();
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = form.v.value.trim();
      if (v.length < minLength) {
        const err = $('.err', dlg);
        err.hidden = false;
        err.textContent = minLength ? `Minimal ${minLength} karakter.` : 'Wajib diisi.';
        return;
      }
      result = v;
      dlg.close();
    };
    dlg.addEventListener('close', () => resolve(result));
  });
}

// Dialog formulir generik untuk CRUD data master. onSubmit(values) boleh melempar galat untuk ditampilkan.
export function formDialog({ title, fields, values = {}, submitText = 'Simpan', onSubmit }) {
  return new Promise((resolve) => {
    const input = (f) => {
      const v = values[f.name] ?? f.default ?? '';
      const req = f.required ? 'required' : '';
      if (f.type === 'select')
        return html`<label class="field sel"><span class="lbl">${f.label}</span><select name="${f.name}" ${req}>
          ${f.placeholder ? html`<option value="">${f.placeholder}</option>` : ''}
          ${f.options.map((o) => html`<option value="${o.value}" ${String(o.value) === String(v) ? raw('selected') : ''}>${o.label}</option>`)}</select></label>`;
      if (f.type === 'textarea')
        return html`<label class="field"><span class="lbl">${f.label}</span><textarea name="${f.name}" rows="3" ${req}>${v}</textarea></label>`;
      return html`<label class="field"><span class="lbl">${f.label}</span>
        <input name="${f.name}" type="${f.type || 'text'}" value="${v}" ${req} ${f.min != null ? raw(`min="${f.min}"`) : ''} ${f.max != null ? raw(`max="${f.max}"`) : ''} ${f.maxlength ? raw(`maxlength="${f.maxlength}"`) : ''} ${f.placeholder ? raw(`placeholder="${esc(f.placeholder)}"`) : ''}></label>`;
    };
    const dlg = openDialog(html`<form class="dlg" novalidate><h2>${title}</h2>
      <div class="form-error" hidden style="margin-top:14px"></div>
      <div class="group">${fields.map(input)}</div>
      <div class="btns"><button type="button" class="btn btn-gray" data-cancel>Batal</button><button class="btn">${submitText}</button></div></form>`);
    const form = $('form', dlg);
    const errBox = $('.form-error', dlg);
    let done = false;
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    form.onsubmit = async (e) => {
      e.preventDefault();
      errBox.hidden = true;
      const out = {};
      for (const f of fields) {
        const rawVal = form.elements[f.name].value;
        out[f.name] = f.type === 'number' ? (rawVal === '' ? '' : Number(rawVal)) : rawVal;
        if (f.required && rawVal.trim() === '') {
          errBox.hidden = false;
          errBox.textContent = `${f.label} wajib diisi.`;
          form.elements[f.name].focus();
          return;
        }
      }
      const btn = $('.btns .btn:last-child', dlg);
      btn.disabled = true;
      try {
        await onSubmit(out);
        done = true;
        dlg.close();
      } catch (err) {
        errBox.hidden = false;
        errBox.textContent = err.message || 'Gagal menyimpan.';
        btn.disabled = false;
      }
    };
    dlg.addEventListener('close', () => resolve(done));
  });
}

export function viewPhoto(src) {
  const dlg = openDialog(html`<img src="${src}" alt="Foto bukti kerusakan">`, 'photo-view');
  dlg.addEventListener('keydown', (e) => e.key === 'Escape' && dlg.close());
}

// ---------- Keadaan umum ----------
export const skeleton = (n = 3) => html`<div>${Array.from({ length: n }, () => html`<div class="skeleton"></div>`)}</div>`;
export const errorState = (err) => html`<div class="state"><h2>Terjadi kendala</h2><p>${err?.message || 'Data tidak dapat dimuat.'}</p>
  <button class="btn" data-retry>Coba lagi</button></div>`;
