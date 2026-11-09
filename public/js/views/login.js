import { api } from '../api.js';
import { html, mount, $, icon, toast } from '../ui.js';

const HOME = { pengguna: '#/gedung', admin: '#/admin/verifikasi', teknisi: '#/tugas' };
const DEMO = [
  ['Pengguna', '2508561005', 'mahasiswa123'],
  ['Admin', 'admin@unud.ac.id', 'admin123'],
  ['Teknisi', 'wayan.sudarma@unud.ac.id', 'teknisi123'],
];

export default function login({ root, go, afterLogin }) {
  document.title = 'Masuk · FacilityOPS';
  mount(root, html`<div class="login">
    <div class="app-icon">${icon('building', 28, 1.9)}</div>
    <h1>Masuk ke FacilityOPS</h1>
    <p class="subtitle">Cek ruangan, laporkan kerusakan, dan pantau perbaikannya.</p>
    <form id="f" novalidate>
      <div class="group">
        <label class="field" data-f="identifier"><span class="lbl">NIM atau email kampus</span>
          <input name="identifier" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="120"><div class="err" hidden></div></label>
        <label class="field" data-f="password"><span class="lbl">Kata sandi</span>
          <input name="password" type="password" autocomplete="current-password" placeholder="Wajib diisi"><div class="err" hidden></div></label>
      </div>
      <div class="form-error" id="err" role="alert" hidden style="margin-top:14px"></div>
      <button class="btn btn-lg" id="submit">Masuk</button>
    </form>
    <a class="link" href="#/login" id="forgot">Lupa kata sandi?</a>
    <p class="note">Pengguna, admin, dan teknisi masuk dari halaman yang sama.<br>Menu yang muncul menyesuaikan peran akunmu.</p>
    <details class="demo"><summary>Akun demo</summary>
      <div class="opts">${DEMO.map(([r, u, p]) => html`<button type="button" data-u="${u}" data-p="${p}"><b>${r}</b><span>${u}</span></button>`)}</div></details>
  </div>`);

  const form = $('#f', root);
  const errBox = $('#err', root);
  const setErr = (name, msg) => {
    const f = $(`[data-f="${name}"]`, root);
    const e = $('.err', f);
    e.hidden = !msg;
    e.textContent = msg || '';
    f.classList.toggle('invalid', !!msg);
  };
  form.identifier.focus();

  $('#forgot', root).onclick = (e) => {
    e.preventDefault();
    toast('Hubungi admin sarana dan prasarana kampus untuk mereset kata sandi.');
  };
  root.querySelectorAll('.demo button').forEach((b) => {
    b.onclick = () => { form.identifier.value = b.dataset.u; form.password.value = b.dataset.p; form.password.focus(); };
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const identifier = form.identifier.value.trim();
    const password = form.password.value;
    setErr('identifier', identifier ? '' : 'Wajib diisi.');
    setErr('password', password ? '' : 'Wajib diisi.');
    if (!identifier || !password) return;

    const btn = $('#submit', root);
    btn.disabled = true;
    btn.textContent = 'Memeriksa…';
    try {
      const { user } = await api.post('/auth/login', { identifier, password });
      await afterLogin(user);
      go(HOME[user.peran]);
    } catch (err) {
      errBox.hidden = false;
      errBox.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Masuk';
      form.password.select();
    }
  };
}
