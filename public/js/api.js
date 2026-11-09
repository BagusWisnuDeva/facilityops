// Klien REST sederhana. Cookie sesi (HttpOnly) dikirim otomatis oleh browser.
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, url, body) {
  let res;
  try {
    res = await fetch('/api' + url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Tidak dapat terhubung ke server. Periksa koneksi Anda lalu coba lagi.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* tubuh kosong */ }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/login') && onUnauthorized) onUnauthorized();
    throw new ApiError(res.status, data?.error || 'Terjadi kesalahan pada server.', data?.details);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  patch: (url, body = {}) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
};
