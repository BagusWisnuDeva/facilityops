import { api, setUnauthorizedHandler } from './api.js';
import { html, mount, $, $$, icon, initial, toast, errorState } from './ui.js';
import login from './views/login.js';
import * as user from './views/user.js';
import * as admin from './views/admin.js';
import * as tech from './views/tech.js';

const app = document.getElementById('app');
export const state = { user: null, meta: null, checked: false };

const HOME = { pengguna: '#/gedung', admin: '#/admin/verifikasi', teknisi: '#/tugas' };
export const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

// [pola hash, peran yang diizinkan, fungsi tampilan]
const ROUTES = [
  [/^#\/login$/, null, login],
  [/^#\/gedung$/, ['pengguna'], user.buildings],
  [/^#\/gedung\/(\d+)$/, ['pengguna'], user.rooms],
  [/^#\/ruangan\/(\d+)$/, ['pengguna'], user.roomDetail],
  [/^#\/ruangan\/(\d+)\/lapor$/, ['pengguna'], user.reportForm],
  [/^#\/laporan-saya$/, ['pengguna'], user.myReports],
  [/^#\/admin\/verifikasi$/, ['admin'], admin.verifikasi],
  [/^#\/admin\/monitoring$/, ['admin'], admin.monitoring],
  [/^#\/admin\/riwayat$/, ['admin'], admin.riwayat],
  [/^#\/admin\/master$/, ['admin'], admin.master],
  [/^#\/tugas$/, ['teknisi'], tech.tugas],
  [/^#\/riwayat$/, ['teknisi'], tech.riwayat],
];

const NAV = {
  pengguna: [['Gedung', '#/gedung', /^#\/(gedung|ruangan)/], ['Laporan saya', '#/laporan-saya', /^#\/laporan-saya/]],
  teknisi: [['Tugas saya', '#/tugas', /^#\/tugas/], ['Riwayat', '#/riwayat', /^#\/riwayat/]],
  admin: [
    ['Verifikasi laporan', '#/admin/verifikasi', /^#\/admin\/verifikasi/],
    ['Monitoring perbaikan', '#/admin/monitoring', /^#\/admin\/monitoring/],
    ['Riwayat perbaikan', '#/admin/riwayat', /^#\/admin\/riwayat/],
    ['Gedung dan ruangan', '#/admin/master', /^#\/admin\/master/],
  ],
};
const ROLE_LABEL = { pengguna: 'Pengguna', admin: 'Admin', teknisi: 'Teknisi' };

let shellKind = null;
let renderToken = 0;

async function loadSession() {
  try {
    state.user = (await api.get('/auth/me')).user;
    if (state.user) state.meta = await api.get('/meta');
  } catch {
    state.user = null;
  }
  state.checked = true;
}

export async function afterLogin(u) {
  state.user = u;
  state.meta = await api.get('/meta');
}

async function logout() {
  try { await api.post('/auth/logout'); } catch { /* sesi mungkin sudah habis */ }
  state.user = null;
  shellKind = null;
  go('#/login');
}

setUnauthorizedHandler(() => {
  if (!state.user) return;
  state.user = null;
  shellKind = null;
  toast('Sesi Anda berakhir. Silakan masuk kembali.', 'err');
  go('#/login');
});

function accountMenu(u) {
  return html`<div class="menu" role="menu" hidden>
    <div class="who"><b>${u.nama}</b><span>${ROLE_LABEL[u.peran]}${u.nim ? ` · ${u.nim}` : ''}${u.spesialisasi ? ` · ${u.spesialisasi}` : ''}</span></div>
    <button role="menuitem" data-logout>${icon('logout', 18)} Keluar</button></div>`;
}

function bindMenu(scope) {
  const trigger = $('[data-menu]', scope);
  const menu = $('.menu', scope);
  trigger.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; trigger.setAttribute('aria-expanded', String(!menu.hidden)); };
  document.addEventListener('click', () => { if (!menu.hidden) menu.hidden = true; });
  $('[data-logout]', scope).onclick = logout;
}

function buildShell(kind, u) {
  shellKind = kind;
  if (kind === 'login') {
    mount(app, html`<div class="login-top"><span class="brand">FacilityOPS</span></div><main id="view"></main>`);
  } else if (kind === 'admin') {
    mount(app, html`<div class="admin"><aside class="sidebar"><a class="brand" href="${HOME.admin}">FacilityOPS</a>
      <nav aria-label="Menu admin">${NAV.admin.map(([t, h]) => html`<a href="${h}">${t}</a>`)}</nav>
      <div class="me"><button data-menu aria-haspopup="menu" aria-expanded="false"><span class="avatar">${initial(u)}</span><span class="nm">${u.nama}</span></button>${accountMenu(u)}</div>
      </aside><main class="admin-main" id="view"></main></div>`);
    bindMenu($('.sidebar'));
  } else {
    mount(app, html`<header class="topbar"><a class="brand" href="${HOME[u.peran]}">FacilityOPS</a>
      <nav class="topnav" aria-label="Menu utama">${NAV[u.peran].map(([t, h]) => html`<a href="${h}">${t}</a>`)}</nav>
      <div class="menu-wrap"><button class="avatar" data-menu aria-label="Akun" aria-haspopup="menu" aria-expanded="false">${initial(u)}</button>${accountMenu(u)}</div></header>
      <main id="view"></main>`);
    bindMenu($('.menu-wrap'));
  }
}

function markActive(hash, role) {
  if (!role) return;
  const links = $$(shellKind === 'admin' ? '.sidebar nav a' : '.topnav a');
  NAV[role].forEach(([, , re], i) => {
    const on = re.test(hash);
    links[i].classList.toggle('active', on);
    if (on) links[i].setAttribute('aria-current', 'page'); else links[i].removeAttribute('aria-current');
  });
}

// Ganti elemen #view dengan salinan kosong agar pendengar event dari tampilan sebelumnya tidak menumpuk.
function freshView() {
  const old = $('#view');
  const fresh = old.cloneNode(false);
  old.replaceWith(fresh);
  return fresh;
}

function deniedView(root, role) {
  document.title = 'Akses ditolak · FacilityOPS';
  mount(root, html`<div class="state" style="padding-top:120px"><h2>Akses ditolak</h2>
    <p>Halaman ini tidak tersedia untuk peran ${ROLE_LABEL[role]}.</p><a class="btn" href="${HOME[role]}">Kembali ke beranda</a></div>`);
}

async function render() {
  const token = ++renderToken;
  if (!state.checked) await loadSession();
  if (token !== renderToken) return;

  const full = location.hash || '#/';
  const [hash, queryString = ''] = full.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString));

  if (hash === '#/' || hash === '#') {
    location.replace(state.user ? HOME[state.user.peran] : '#/login');
    return;
  }
  const found = ROUTES.map(([re, roles, fn]) => [re.exec(hash), roles, fn]).find(([m]) => m);

  if (!state.user) {
    if (found && found[1] === null) {
      if (shellKind !== 'login') buildShell('login');
      return found[2]({ root: freshView(), state, go, query, afterLogin });
    }
    location.replace('#/login');
    return;
  }
  if (found && found[1] === null) { // sudah masuk tetapi membuka halaman login
    location.replace(HOME[state.user.peran]);
    return;
  }

  const kind = state.user.peran === 'admin' ? 'admin' : 'topbar';
  if (shellKind !== kind || !$('#view')) buildShell(kind, state.user);
  markActive(hash, state.user.peran);
  const root = freshView();
  window.scrollTo(0, 0);

  if (!found) {
    document.title = 'Tidak ditemukan · FacilityOPS';
    mount(root, html`<div class="state" style="padding-top:120px"><h2>Halaman tidak ditemukan</h2><p>Alamat yang Anda buka tidak tersedia.</p>
      <a class="btn" href="${HOME[state.user.peran]}">Kembali ke beranda</a></div>`);
    return;
  }
  const [match, roles, fn] = found;
  if (!roles.includes(state.user.peran)) return deniedView(root, state.user.peran);

  const ctx = { root, state, go, query, params: match.slice(1), user: state.user, isStale: () => token !== renderToken, reload: render };
  try {
    await fn(ctx);
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    mount(root, errorState(err));
    $('[data-retry]', root)?.addEventListener('click', render);
  }
}

window.addEventListener('hashchange', render);
render();
