// === Cloud Config shared frontend logic ===

const CloudAuth = {
  getSession() {
    try {
      return JSON.parse(localStorage.getItem('airdlc_cloud') || 'null');
    } catch {
      return null;
    }
  },

  setSession(session) {
    localStorage.setItem('airdlc_cloud', JSON.stringify(session));
  },

  clearSession() {
    localStorage.removeItem('airdlc_cloud');
  },

  getToken() {
    const s = this.getSession();
    return s ? s.token : null;
  },

  getRefreshToken() {
    const s = this.getSession();
    return s ? s.refresh_token : null;
  },

  getUsername() {
    const s = this.getSession();
    return s ? s.username : null;
  },

  isLoggedIn() {
    return !!this.getToken();
  },
};

const CloudApi = {
  async request(method, path, body, retry = true) {
    const token = CloudAuth.getToken();
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(path, opts);

    if (res.status === 401 && retry) {
      const refreshed = await CloudApi.refreshToken();
      if (refreshed) return CloudApi.request(method, path, body, false);
      CloudAuth.clearSession();
      window.location.href = '/login.html?expired=1';
      throw new Error('unauthorized');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  async refreshToken() {
    const rt = CloudAuth.getRefreshToken();
    if (!rt) return false;
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      const session = CloudAuth.getSession();
      CloudAuth.setSession({
        ...session,
        token: data.token,
        refresh_token: data.refresh_token,
      });
      return true;
    } catch {
      return false;
    }
  },

  getConfigs() {
    return CloudApi.request('GET', '/api/configs');
  },

  getConfig(id) {
    return CloudApi.request('GET', '/api/configs/' + id);
  },

  createConfig(name, data) {
    return CloudApi.request('POST', '/api/configs', { name, data });
  },

  deleteConfig(id) {
    return CloudApi.request('DELETE', '/api/configs/' + id);
  },

  login(username, password) {
    return CloudApi.request('POST', '/api/auth/login', { username, password });
  },

  register(username, email, password) {
    return CloudApi.request('POST', '/api/auth/register', { username, email, password });
  },
};

const CloudToast = {
  _container: null,

  _ensureContainer() {
    if (!this._container) {
      this._container = document.createElement('div');
      this._container.className = 'cc-toast-container';
      document.body.appendChild(this._container);
    }
    return this._container;
  },

  _icon(type) {
    const icons = {
      success: '<svg class="cc-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      error: '<svg class="cc-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      warning: '<svg class="cc-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    };
    return icons[type] || '';
  },

  show(message, type = 'success', duration = 3500) {
    const container = this._ensureContainer();
    const toast = document.createElement('div');
    toast.className = `cc-toast ${type}`;
    toast.innerHTML = `
      ${this._icon(type)}
      <span class="cc-toast-message">${CloudUtils.escapeHtml(message)}</span>
      <button class="cc-toast-close">&times;</button>
    `;
    container.appendChild(toast);

    const remove = () => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 250);
    };

    toast.querySelector('.cc-toast-close').addEventListener('click', remove);
    setTimeout(remove, duration);
  },

  success(msg) { this.show(msg, 'success'); },
  error(msg) { this.show(msg, 'error'); },
  warning(msg) { this.show(msg, 'warning'); },
};

const CloudUtils = {
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' +
      d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  },

  timeAgo(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins} мин. назад`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ч. назад`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} дн. назад`;
    return this.formatDate(iso);
  },

  shortId(id) {
    return id ? id.slice(0, 8) : '—';
  },

  copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  },

  debounce(fn, ms) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), ms);
    };
  },

  validateJson(str) {
    try {
      JSON.parse(str);
      return { valid: true, data: JSON.parse(str) };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  },
};

// Ripple effect on buttons
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.cc-btn');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  btn.style.setProperty('--ripple-x', x + 'px');
  btn.style.setProperty('--ripple-y', y + 'px');
});

// Auto-redirect if not logged in on protected pages
document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  const protectedPages = ['cloud.html', 'cloud-editor.html', 'cloud-profile.html', 'device.html'];
  const isProtected = protectedPages.some(p => path.endsWith(p));

  if (isProtected && !CloudAuth.isLoggedIn()) {
    window.location.href = '/login.html?redirect=' + encodeURIComponent(path);
  }
});
