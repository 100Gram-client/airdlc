var currentUser = null;
var ADMIN_USER = 'kekainat';
var serverData = { users: [], keys: [] };

function apiLoad(cb) {
    fetch('/api/data').then(function(r) { return r.json(); }).then(function(d) {
        serverData.users = d.users || [];
        serverData.keys = d.keys || [];
        if (cb) cb();
    }).catch(function() { if (cb) cb(); });
}

function apiSave(cb) {
    fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: serverData.users, keys: serverData.keys })
    }).then(function() { if (cb) cb(); }).catch(function() { if (cb) cb(); });
}

function openModal(tab) {
    document.getElementById('authModal').classList.add('active');
    switchTab(tab);
}
function closeModal() {
    document.getElementById('authModal').classList.remove('active');
}
function switchTab(tab) {
    document.getElementById('loginForm').style.display = tab === 'login' ? 'flex' : 'none';
    document.getElementById('registerForm').style.display = tab === 'register' ? 'flex' : 'none';
    document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
    document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
}
function resetBtn(b, s, sp) {
    b.disabled = false;
    s.style.display = 'inline';
    sp.style.display = 'none';
}

function handleRegister(e) {
    e.preventDefault();
    var b = document.getElementById('regBtn');
    var s = b.querySelector('span');
    var sp = b.querySelector('.btn-spinner');
    b.disabled = true; s.style.display = 'none'; sp.style.display = 'inline-block';
    var u = document.getElementById('regUsername').value;
    var em = document.getElementById('regEmail').value;
    var p = document.getElementById('regPassword').value;
    var k = document.getElementById('regKey').value;
    setTimeout(function() {
        if (serverData.users.find(function(x) { return x.username === u; })) { toast('Username already exists', 'error'); resetBtn(b, s, sp); return; }
        if (serverData.users.find(function(x) { return x.email === em; })) { toast('Email already registered', 'error'); resetBtn(b, s, sp); return; }
        var ke = serverData.keys.find(function(x) { return x.key === k && !x.used; });
        if (!ke) { toast('Invalid or used license key', 'error'); resetBtn(b, s, sp); return; }
        ke.used = true; ke.usedBy = u; ke.usedDate = new Date().toISOString();
        serverData.users.push({ username: u, email: em, password: p, key: ke.key, subType: ke.subType, expiry: ke.subType === 'Lifetime' ? 'Never' : calcExpiry(ke.subType), hwid: genHWID(), joinDate: new Date().toISOString() });
        apiSave(function() {
            toast('Account created!', 'success');
            switchTab('login');
            resetBtn(b, s, sp);
        });
    }, 1200);
    return false;
}

function handleLogin(e) {
    e.preventDefault();
    var b = document.getElementById('loginBtn');
    var s = b.querySelector('span');
    var sp = b.querySelector('.btn-spinner');
    b.disabled = true; s.style.display = 'none'; sp.style.display = 'inline-block';
    var u = document.getElementById('loginUsername').value;
    var p = document.getElementById('loginPassword').value;
    setTimeout(function() {
        var user = serverData.users.find(function(x) { return x.username === u && x.password === p; });
        if (user) {
            currentUser = user.username;
            localStorage.setItem('airdlc_session', currentUser);
            updateAuthUI(); closeModal();
            toast('Welcome, ' + currentUser, 'success');
            window.location.href = 'dashboard.html';
        } else { toast('Invalid credentials', 'error'); }
        resetBtn(b, s, sp);
    }, 1000);
    return false;
}

function logout() {
    currentUser = null;
    localStorage.removeItem('airdlc_session');
    window.location.href = 'index.html';
}

function updateAuthUI() {
    var nr = document.getElementById('navRight');
    var nra = document.getElementById('navRightAuth');
    if (!nr || !nra) return;
    if (currentUser) {
        nr.style.display = 'none'; nra.style.display = 'flex';
        document.getElementById('navAvatarLetter').textContent = currentUser[0].toUpperCase();
        document.getElementById('dropdownName').textContent = currentUser;
        var user = serverData.users.find(function(x) { return x.username === currentUser; });
        if (user) document.getElementById('dropdownEmail').textContent = user.email;
        document.querySelectorAll('.admin-only').forEach(function(el) { el.style.display = isAdmin() ? 'flex' : 'none'; });
    } else {
        nr.style.display = 'flex'; nra.style.display = 'none';
        document.querySelectorAll('.admin-only').forEach(function(el) { el.style.display = 'none'; });
    }
    var h = document.getElementById('downloadHint');
    if (h) { h.textContent = currentUser ? '' : 'Sign in to download'; h.style.display = currentUser ? 'none' : 'block'; }
}

function isAdmin() { return currentUser === ADMIN_USER; }

function updateDashboard() {
    var user = serverData.users.find(function(x) { return x.username === currentUser; });
    if (!user) return;
    var el = function(id) { return document.getElementById(id); };
    if (el('dashAvatar')) el('dashAvatar').textContent = currentUser[0].toUpperCase();
    if (el('dashName')) el('dashName').textContent = currentUser;
    if (el('dashEmail')) el('dashEmail').textContent = user.email;
    if (el('dashSubType')) el('dashSubType').textContent = user.subType || 'Lifetime';
    if (el('dashExpiry')) el('dashExpiry').textContent = user.expiry || 'Never';
    if (el('dashHwid')) el('dashHwid').textContent = user.hwid || 'Locked';
    if (el('dashLicenseKey')) el('dashLicenseKey').textContent = user.key || 'XXXX';
    if (el('settingsUsername')) el('settingsUsername').value = currentUser;
    if (el('settingsEmail')) el('settingsEmail').value = user.email;
}

function switchDashTab(tab) {
    document.querySelectorAll('.dash-tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.dashboard-nav-item').forEach(function(i) { i.classList.remove('active'); });
    var te = document.getElementById('dashTab-' + tab);
    if (te) te.classList.add('active');
    var ni = document.querySelector('.dashboard-nav-item[data-tab="' + tab + '"]');
    if (ni) ni.classList.add('active');
}

function copyLicense() {
    var k = document.getElementById('dashLicenseKey').textContent;
    navigator.clipboard.writeText(k).then(function() {
        document.getElementById('dashLicenseKey').classList.add('copied');
        toast('Copied!', 'success');
        setTimeout(function() { document.getElementById('dashLicenseKey').classList.remove('copied'); }, 2000);
    });
}

function handleChangePassword(e) { e.preventDefault(); toast('Password updated!', 'success'); e.target.reset(); return false; }

function handleUpdateProfile(e) {
    e.preventDefault();
    var user = serverData.users.find(function(x) { return x.username === currentUser; });
    if (user) {
        user.email = document.getElementById('settingsEmail').value || user.email;
        apiSave(function() { updateDashboard(); updateAuthUI(); toast('Profile updated!', 'success'); });
    }
    return false;
}

function handleDeleteAccount() {
    if (!confirm('Delete account?')) return;
    serverData.users = serverData.users.filter(function(x) { return x.username !== currentUser; });
    apiSave(function() { logout(); });
}

function generateLicenseKey() {
    if (!isAdmin()) return;
    var p = (document.getElementById('adminKeyPrefix').value || 'AIR').toUpperCase().slice(0, 4);
    var st = document.getElementById('adminSubType').value;
    var k = p + '-' + rnd() + '-' + rnd() + '-' + rnd();
    serverData.keys.push({ key: k, subType: st, used: false, usedBy: null, usedDate: null, createdBy: currentUser, createdDate: new Date().toISOString() });
    apiSave(function() {
        document.getElementById('adminGeneratedKey').textContent = k;
        document.getElementById('adminGeneratedBox').style.display = 'flex';
        toast('Key generated!', 'success');
        updateAdminPanel();
    });
}

function rnd() {
    var c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var r = '';
    for (var i = 0; i < 4; i++) r += c[Math.floor(Math.random() * c.length)];
    return r;
}

function calcExpiry(t) {
    var n = new Date();
    var m = { '1 Month': 1, '3 Months': 3, '6 Months': 6, '1 Year': 12 };
    n.setMonth(n.getMonth() + (m[t] || 0));
    return n.toLocaleDateString('ru-RU');
}

function copyAdminKey() {
    navigator.clipboard.writeText(document.getElementById('adminGeneratedKey').textContent).then(function() { toast('Copied!', 'success'); });
}

function copyKey(k) { navigator.clipboard.writeText(k).then(function() { toast('Copied!', 'success'); }); }

function deleteKey(kv) {
    if (!confirm('Delete key?')) return;
    serverData.keys = serverData.keys.filter(function(k) { return k.key !== kv; });
    apiSave(function() { toast('Deleted', 'success'); updateAdminPanel(); });
}

function deleteUser(un) {
    if (un === ADMIN_USER) { toast('Cannot delete admin', 'error'); return; }
    if (!confirm('Delete ' + un + '?')) return;
    serverData.users = serverData.users.filter(function(u) { return u.username !== un; });
    apiSave(function() { toast('Deleted', 'success'); updateAdminPanel(); });
}

function updateAdminPanel() {
    if (!isAdmin()) return;
    var us = serverData.users;
    var ks = serverData.keys;
    document.getElementById('adminTotalUsers').textContent = us.length;
    document.getElementById('adminActiveKeys').textContent = ks.filter(function(k) { return !k.used; }).length;
    document.getElementById('adminUsedKeys').textContent = ks.filter(function(k) { return k.used; }).length;

    var kl = document.getElementById('adminKeysList');
    if (ks.length === 0) { kl.innerHTML = '<p class="admin-empty">No keys yet</p>'; }
    else {
        var html = '';
        for (var i = 0; i < ks.length; i++) {
            var k = ks[i];
            var cls = k.used ? 'admin-key-item used' : 'admin-key-item';
            var meta = k.subType + ' | ' + (k.used ? 'Used by ' + k.usedBy : 'Unused') + ' | ' + new Date(k.createdDate).toLocaleDateString('ru-RU');
            html += '<div class="' + cls + '"><div class="admin-key-left"><code class="admin-key-value">' + k.key + '</code><span class="admin-key-meta">' + meta + '</span></div><div class="admin-key-actions"><button class="btn-icon" onclick="copyKey(\'' + k.key + '\')">Copy</button><button class="btn-icon" onclick="deleteKey(\'' + k.key + '\')" style="color:var(--red)">Del</button></div></div>';
        }
        kl.innerHTML = html;
    }

    var ul = document.getElementById('adminUsersList');
    if (us.length === 0) { ul.innerHTML = '<p class="admin-empty">No users</p>'; }
    else {
        var uhtml = '';
        for (var j = 0; j < us.length; j++) {
            var u = us[j];
            var badge = u.username === ADMIN_USER ? 'admin-badge' : '';
            var btext = u.username === ADMIN_USER ? 'Admin' : 'User';
            var del = u.username !== ADMIN_USER ? '<button class="btn-icon" onclick="deleteUser(\'' + u.username + '\')" style="color:var(--red)">Del</button>' : '';
            uhtml += '<div class="admin-user-item"><div class="admin-user-left"><span class="admin-user-name">' + u.username + '</span><span class="admin-user-meta">' + u.email + ' | ' + (u.subType || 'Lifetime') + '</span></div><div style="display:flex;align-items:center;gap:8px"><span class="admin-user-badge ' + badge + '">' + btext + '</span>' + del + '</div></div>';
        }
        ul.innerHTML = uhtml;
    }
}

var LOADER_URL = 'https://github.com/100Gram-client/airdlc/releases/download/1/AirDLC.exe';
function handleDownload() {
    if (!currentUser) { toast('Sign in first', 'error'); openModal('login'); return; }
    toast('Download started!', 'success');
    window.open(LOADER_URL, '_blank');
    var b = document.getElementById('downloadBtn');
    if (b) {
        var o = b.textContent;
        b.disabled = true; b.textContent = 'Downloading...';
        setTimeout(function() { b.textContent = o; b.disabled = false; }, 2000);
    }
}

function uploadUpdate(e) {
    e.preventDefault();
    if (!isAdmin()) return;
    var fileInput = document.getElementById('updateFile');
    var version = document.getElementById('updateVersion').value.trim();
    var notes = document.getElementById('updateNotes').value.trim();
    var type = document.getElementById('updateType').value;
    if (!version) { toast('Enter version', 'error'); return; }
    if (!fileInput.files.length) { toast('Select a file', 'error'); return; }
    var fd = new FormData();
    fd.append('file', fileInput.files[0]);
    fd.append('version', version);
    fd.append('notes', notes);
    fd.append('type', type);
    var btn = document.getElementById('updateUploadBtn');
    btn.disabled = true; btn.textContent = 'Uploading...';
    fetch('/api/updates/upload', { method: 'POST', body: fd })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        btn.disabled = false; btn.textContent = 'Upload';
        if (data.ok) { toast('Update uploaded!', 'success'); loadUpdatesList(); e.target.reset(); }
        else { toast(data.error || 'Upload failed', 'error'); }
    })
    .catch(function() { btn.disabled = false; btn.textContent = 'Upload'; toast('Connection error', 'error'); });
}

function loadUpdatesList() {
    fetch('/api/updates').then(function(r) { return r.json(); }).then(function(updates) {
        var el = document.getElementById('adminUpdatesList');
        if (!el) return;
        if (updates.length === 0) { el.innerHTML = '<p class="admin-empty">No updates yet</p>'; return; }
        var html = '';
        updates.forEach(function(u) {
            var sizeKB = Math.round(u.size / 1024);
            var sizeMB = (u.size / 1048576).toFixed(1);
            var sizeStr = u.size > 1048576 ? sizeMB + ' MB' : sizeKB + ' KB';
            html += '<div class="admin-key-item"><div class="admin-key-left">' +
                '<code class="admin-key-value">' + u.version + ' (' + u.type + ')</code>' +
                '<span class="admin-key-meta">' + (u.notes || 'No notes') + ' | ' + sizeStr + ' | ' + new Date(u.date).toLocaleDateString('ru-RU') + '</span>' +
                '</div><div class="admin-key-actions">' +
                '<button class="btn-icon" onclick="downloadUpdate(\'' + u.id + '\')">DL</button>' +
                '<button class="btn-icon" onclick="deleteUpdate(\'' + u.id + '\')" style="color:var(--red)">Del</button>' +
                '</div></div>';
        });
        el.innerHTML = html;
    });
}

function downloadUpdate(id) {
    window.open('/api/updates/download/' + id, '_blank');
}

function deleteUpdate(id) {
    if (!confirm('Delete this update?')) return;
    fetch('/api/updates/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id })
    }).then(function() { toast('Deleted', 'success'); loadUpdatesList(); });
}

function loadPublicUpdates() {
    fetch('/api/updates').then(function(r) { return r.json(); }).then(function(updates) {
        var el = document.getElementById('updatesList');
        if (!el) return;
        if (updates.length === 0) { el.innerHTML = '<p style="color:var(--text3);text-align:center;padding:24px">No updates available</p>'; return; }
        var html = '';
        updates.forEach(function(u) {
            var sizeKB = Math.round(u.size / 1024);
            var sizeMB = (u.size / 1048576).toFixed(1);
            var sizeStr = u.size > 1048576 ? sizeMB + ' MB' : sizeKB + ' KB';
            html += '<div class="admin-key-item"><div class="admin-key-left">' +
                '<code class="admin-key-value">' + u.version + '</code>' +
                '<span class="admin-key-meta">' + (u.notes || '') + ' | ' + sizeStr + ' | ' + new Date(u.date).toLocaleDateString('ru-RU') + '</span>' +
                '</div><div class="admin-key-actions">' +
                '<button class="btn-icon" onclick="window.open(\'/api/updates/download/' + u.id + '\',\'_blank\')">Download</button>' +
                '</div></div>';
        });
        el.innerHTML = html;
    });
}

function genHWID() {
    return 'HWID-' + Math.random().toString(36).substr(2, 8).toUpperCase() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
}

function toast(t, ty) {
    var e = document.getElementById('toast');
    if (!e) return;
    var te = document.getElementById('toastText');
    te.textContent = t;
    e.className = 'toast ' + (ty || '');
    e.classList.add('show');
    clearTimeout(e._timer);
    e._timer = setTimeout(function() { e.classList.remove('show'); }, 3000);
}

function animateCounters() {
    document.querySelectorAll('.hero-stat-num').forEach(function(el) {
        var target = parseFloat(el.getAttribute('data-target'));
        var isDec = target % 1 !== 0;
        var dur = 2000;
        var start = performance.now();
        function up(now) {
            var prog = Math.min((now - start) / dur, 1);
            var eased = 1 - Math.pow(1 - prog, 3);
            el.textContent = isDec ? (eased * target).toFixed(1) : Math.floor(eased * target);
            if (prog < 1) requestAnimationFrame(up);
        }
        requestAnimationFrame(up);
    });
}

function toggleProfileMenu() {
    document.getElementById('profileDropdown').classList.toggle('show');
}

document.addEventListener('click', function(e) {
    var dd = document.getElementById('profileDropdown');
    var av = document.querySelector('.nav-avatar');
    if (dd && !dd.contains(e.target) && av && !av.contains(e.target)) dd.classList.remove('show');
});

(function() {
    var s = localStorage.getItem('airdlc_session');
    if (s) currentUser = s;
    apiLoad(function() {
        updateAuthUI();
        if (document.querySelector('.hero-stat-num')) animateCounters();
    });
})();
