/* ============================================================
   MARKET ZONE — Live Support Chat (Firebase Realtime Database)
   Customer: after login, a floating live chat button + widget appears
   Admin:     Admin Panel -> Support Chat inbox with real-time reply
   ============================================================ */
(function () {
'use strict';

var cfg = window.MZ_FIREBASE_CONFIG || {};
function okCfg() {
    if (!window.firebase) return false;
    var s = (cfg.apiKey || '') + '|' + (cfg.databaseURL || '') + '|' + (cfg.projectId || '');
    return s.length > 40 && s.indexOf('PASTE') === -1 && s.indexOf('YOUR_') === -1;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fmtTime(t) { if (!t) return ''; var d = new Date(t); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }

var booted = false, fbDb = null, fbAuth = null;
var currentUser = null, currentRoute = 'shop';
var anonUid = null, convRef = null;
var myMeta = {}, myMsgs = [];
var panelOpen = false, widgetErr = '';
var convCache = {}, adminMsgs = [], adminSelected = null;
var adminAuthHooked = false, adminFbUser = null, adminIsAdmin = false;
var adminListHook = false, adminMsgRef = null, adminMsgFor = null;

var root = document.createElement('div');
root.id = 'mz-chat-root';
(document.body || document.documentElement).appendChild(root);

function cfgNotice() {
    return '<div class="mz-chat-setup"><b>Firebase setup required</b><ol>' +
        '<li>Create a project at <a href="https://console.firebase.google.com/" target="_blank">Firebase Console</a></li>' +
        '<li>Register a web app and paste its config into <code>js/firebase-config.js</code></li>' +
        '<li>Enable <b>Anonymous</b> and <b>Email/Password</b> in Authentication</li>' +
        '<li>Create a Realtime Database and publish the rules from <code>database.rules.json</code></li>' +
        '<li>Set the admin claim: <code>node tools/set-admin-claim.js admin@email.com</code></li></ol></div>';
}

/* ---------------- LOCAL FALLBACK (same-browser storage) ---------------- */
function localMode() { return !okCfg(); }
function localChats() {
    try { return JSON.parse(localStorage.getItem('mz_local_chats') || '{}'); }
    catch (e) { return {}; }
}
function saveLocalChats(chats) { localStorage.setItem('mz_local_chats', JSON.stringify(chats)); }
function localConversationId() { return currentUser ? 'customer-' + currentUser.id : ''; }
function loadLocalCustomer(markRead) {
    if (!currentUser) return;
    var id = localConversationId(), chats = localChats();
    var conv = chats[id] || { meta: {}, messages: [] };
    conv.meta = conv.meta || {};
    conv.messages = conv.messages || [];
    conv.meta.mzUid = currentUser.id;
    conv.meta.name = currentUser.name;
    conv.meta.email = currentUser.email;
    if (markRead && conv.meta.unreadCustomer) conv.meta.unreadCustomer = 0;
    chats[id] = conv;
    saveLocalChats(chats);
    myMeta = conv.meta;
    myMsgs = conv.messages.slice().sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
}
function openLocalChat() {
    anonUid = localConversationId();
    convRef = null;
    widgetErr = '';
    loadLocalCustomer(true);
    renderWidget();
}

/* ---------------- CUSTOMER WIDGET ---------------- */
function renderWidget() {
    var u = currentUser;
    var show = u && u.role === 'customer' && currentRoute !== 'login' && currentRoute !== 'register' && currentRoute.indexOf('admin') !== 0;
    var badge = (myMeta.unreadCustomer || 0) > 0 ? '<span class="mz-chat-badge">' + myMeta.unreadCustomer + '</span>' : '';
    var html = '';
    if (show) {
        /* floating chat button removed - chat opens from the header "Live Chat" link */
        if (panelOpen) html += renderPanel();
    }
    root.innerHTML = html;
    var box = document.getElementById('mz-chat-msgs');
    if (box) box.scrollTop = box.scrollHeight;
}

function renderPanel() {
    var body;
    if (widgetErr) body = '<div class="mz-chat-setup">' + esc(widgetErr) + '</div>';
    else if (!anonUid) body = '<div class="mz-chat-loading">Connecting to support&hellip;</div>';
    else {
        var msgs = myMsgs.map(function (m) {
            return '<div class="mz-bubble ' + (m.from === 'admin' ? 'from-admin' : 'from-me') + '">' + esc(m.text) +
                '<span class="mz-bubble-time">' + fmtTime(m.at) + '</span></div>';
        }).join('');
        if (!myMsgs.length) msgs = '<div class="mz-chat-empty">Hello! Type your message below and it will be saved for the support team.</div>';
        body = '<div id="mz-chat-msgs">' + msgs + '</div>' +
            '<form data-mzc-form="customer" class="mz-chat-composer">' +
            '<input data-mzc-input="customer" placeholder="Type your message&hellip;" autocomplete="off" maxlength="2000">' +
            '<button class="mz-send" type="submit">&#10148;</button></form>';
    }
    return '<div id="mz-chat-panel"><div class="mz-chat-head"><b>&#128172; Live Support</b><span>MarketZone</span><button type="button" data-mzc="close" class="mz-x">&#10005;</button></div><div class="mz-chat-body">' + body + '</div></div>';
}

function boot() {
    if (booted) return okCfg();
    if (!okCfg()) return false;
    try { firebase.initializeApp(cfg); fbDb = firebase.database(); fbAuth = firebase.auth(); booted = true; return true; }
    catch (e) { widgetErr = e.message; return false; }
}

function openChat() {
    panelOpen = true;
    if (localMode()) { openLocalChat(); return; }
    if (!boot()) { renderWidget(); return; }
    renderWidget();
    fbAuth.signInAnonymously().then(function (cred) {
        anonUid = cred.user.uid;
        convRef = fbDb.ref('chats/' + anonUid);
        convRef.child('messages').on('value', function (snap) {
            var v = snap.val() || {};
            myMsgs = Object.keys(v).map(function (k) { return v[k]; }).sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
            renderWidget();
        });
        convRef.child('meta').on('value', function (snap) {
            myMeta = snap.val() || {};
            if ((myMeta.unreadCustomer || 0) > 0) convRef.child('meta/unreadCustomer').set(0);
            renderWidget();
        });
    }).catch(function (e) { widgetErr = e.message; renderWidget(); });
}

function sendCustomer(text) {
    if (!currentUser) return;
    if (localMode()) {
        var id = localConversationId(), chats = localChats();
        var conv = chats[id] || { meta: {}, messages: [] };
        conv.messages = conv.messages || [];
        conv.meta = conv.meta || {};
        var at = Date.now();
        conv.messages.push({ id: 'm' + at + '-' + Math.random().toString(36).slice(2, 7), from: 'customer', text: text, at: at });
        conv.meta.mzUid = currentUser.id;
        conv.meta.name = currentUser.name;
        conv.meta.email = currentUser.email;
        conv.meta.lastMsg = text.slice(0, 90);
        conv.meta.lastAt = at;
        conv.meta.unreadAdmin = (conv.meta.unreadAdmin || 0) + 1;
        conv.meta.unreadCustomer = 0;
        chats[id] = conv;
        saveLocalChats(chats);
        myMeta = conv.meta;
        myMsgs = conv.messages;
        renderWidget();
        return;
    }
    if (!convRef) return;
    var t = firebase.database.ServerValue.TIMESTAMP;
    convRef.child('messages').push({ from: 'customer', text: text, at: t });
    convRef.child('meta').update({
        mzUid: currentUser.id, name: currentUser.name, email: currentUser.email,
        lastMsg: text.slice(0, 90), lastAt: t,
        unreadAdmin: (myMeta.unreadAdmin || 0) + 1
    });
}

/* ---------------- ADMIN PANEL ---------------- */
window.vAdminChat = function () {
    var local = localMode();
    return '<div class="card" style="margin-bottom:16px"><h3 style="margin-top:0">&#128172; Support Chat</h3>' +
        '<p style="margin:0;color:#666">' + (local
            ? 'Local support mode is active. Messages are saved in this browser and synchronized across tabs on this device. Configure Firebase for cross-device live support.'
            : 'Firebase live support is connected. Customer messages arrive here in real time and you can reply directly.') + '</p></div>' +
        '<div id="mz-admin-chat"></div>';
};

function renderAdmin(el) {
    if (!el) return;
    if (localMode()) {
        adminIsAdmin = true;
        convCache = localChats();
        renderAdminInbox(el);
        return;
    }
    if (!adminAuthHooked) {
        adminAuthHooked = true;
        fbAuth.onAuthStateChanged(function (user) {
            adminFbUser = user;
            if (!user) { adminIsAdmin = false; renderAdminLogin(el); return; }
            user.getIdTokenResult().then(function (tr) {
                adminIsAdmin = !!(tr.claims && tr.claims.admin === true);
                if (adminIsAdmin) startAdminInbox(el); else renderAdminDenied(el);
            }).catch(function () { renderAdminDenied(el); });
        });
    } else if (adminFbUser && adminIsAdmin) { renderAdminInbox(el); }
    else if (adminFbUser) { renderAdminDenied(el); }
    else { renderAdminLogin(el); }
}

function renderAdminLogin(el) {
    el.innerHTML = '<div class="card" style="max-width:460px"><h3 style="margin-top:0">Connect Support Admin</h3>' +
        '<p style="color:#666">Connect with your Firebase support admin account (the one with the <code>admin: true</code> claim set).</p>' +
        '<form data-mzc-form="admin-login">' +
        '<label>Email<br><input name="email" type="email" required placeholder="admin@yourdomain.com" style="width:100%;padding:8px;margin:4px 0 10px"></label>' +
        '<label>Password<br><input name="pass" type="password" required placeholder="********" style="width:100%;padding:8px;margin:4px 0 10px"></label>' +
        '<button class="btn" type="submit">Connect</button></form></div>';
}

function renderAdminDenied(el) {
    el.innerHTML = '<div class="card"><h3 style="margin-top:0">Access denied</h3><p style="color:#666">This Firebase account does not have the <code>admin: true</code> claim. Follow README step 5, then retry.</p>' +
        '<button class="btn" data-mzc="admin-retry">Retry</button> <button class="btn" data-mzc="admin-logout">Sign out</button></div>';
}

function startAdminInbox(el) {
    if (!adminListHook) {
        adminListHook = true;
        fbDb.ref('chats').on('value', function (snap) {
            convCache = snap.val() || {};
            renderAdminInbox(document.getElementById('mz-admin-chat'));
        });
    }
    renderAdminInbox(el);
}

function ensureConvHook() {
    if (!adminSelected) { adminMsgs = []; return; }
    if (localMode()) {
        adminMsgFor = adminSelected;
        var conv = localChats()[adminSelected] || { messages: [] };
        adminMsgs = (conv.messages || []).slice().sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
        return;
    }
    if (adminMsgFor === adminSelected) return;
    if (adminMsgRef) adminMsgRef.off();
    adminMsgFor = adminSelected;
    adminMsgRef = fbDb.ref('chats/' + adminSelected + '/messages');
    adminMsgRef.on('value', function (snap) {
        var v = snap.val() || {};
        adminMsgs = Object.keys(v).map(function (k) { return v[k]; }).sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
        renderAdminInbox(document.getElementById('mz-admin-chat'));
    });
}

function renderAdminInbox(el) {
    if (!el || !adminIsAdmin) return;
    var convs = Object.keys(convCache).map(function (k) { return { id: k, m: convCache[k].meta || {} }; });
    convs.sort(function (a, b) { return (b.m.lastAt || 0) - (a.m.lastAt || 0); });
    if (!adminSelected || !convCache[adminSelected]) { adminSelected = convs.length ? convs[0].id : null; adminMsgFor = null; }
    ensureConvHook();

    var oldInp = el.querySelector('[data-mzc-input="admin"]');
    var oldVal = oldInp ? oldInp.value : '';
    var hadFocus = oldInp && document.activeElement === oldInp;

    var listHtml = convs.length ? convs.map(function (c) {
        var un = c.m.unreadAdmin || 0;
        return '<button type="button" class="mz-conv' + (c.id === adminSelected ? ' active' : '') + '" data-mzc="sel" data-id="' + esc(c.id) + '">' +
            '<span class="mz-conv-name">' + esc(c.m.name || 'Customer') + (un ? ' <span class="mz-chat-badge" style="position:static">' + un + '</span>' : '') + '</span>' +
            '<span class="mz-conv-sub">' + esc(c.m.lastMsg || '&mdash;') + '</span>' +
            '<span class="mz-conv-time">' + fmtTime(c.m.lastAt) + '</span></button>';
    }).join('') : '<div class="mz-chat-empty">No conversations yet. When a logged-in customer sends a message from the live chat, it will appear here in real time.</div>';

    var selMeta = adminSelected && convCache[adminSelected] ? (convCache[adminSelected].meta || {}) : {};
    var msgs = adminMsgs.map(function (m) {
        return '<div class="mz-bubble ' + (m.from === 'admin' ? 'from-me' : 'from-admin') + '">' + esc(m.text) + '<span class="mz-bubble-time">' + fmtTime(m.at) + '</span></div>';
    }).join('') || '<div class="mz-chat-empty">No messages yet.</div>';

    el.innerHTML = '<div class="mz-ac-wrap">' +
        '<div class="mz-ac-list"><div class="mz-ac-list-head"><b>Conversations</b>' + (localMode() ? '<span class="hint">Local mode</span>' : '<button type="button" class="btn" data-mzc="admin-logout">Sign out</button>') + '</div>' + listHtml + '</div>' +
        '<div class="mz-ac-main">' +
        (adminSelected ?
            '<div class="mz-ac-head"><b>' + esc(selMeta.name || 'Customer') + '</b><span>' + esc(selMeta.email || '') + '</span></div>' +
            '<div id="mz-ac-msgs">' + msgs + '</div>' +
            '<form data-mzc-form="admin-reply" class="mz-chat-composer"><input data-mzc-input="admin" placeholder="Type a reply&hellip;" autocomplete="off" maxlength="2000"><button class="mz-send" type="submit">&#10148;</button></form>'
            : '<div class="mz-chat-empty">Select a conversation.</div>') +
        '</div></div>';

    var ni = el.querySelector('[data-mzc-input="admin"]');
    if (ni) { ni.value = oldVal; if (hadFocus) ni.focus(); }
    var box = el.querySelector('#mz-ac-msgs');
    if (box) box.scrollTop = box.scrollHeight;
    if (adminSelected && convCache[adminSelected] && ((convCache[adminSelected].meta || {}).unreadAdmin || 0) > 0) {
        if (localMode()) {
            var chats = localChats();
            if (chats[adminSelected]) {
                chats[adminSelected].meta = chats[adminSelected].meta || {};
                chats[adminSelected].meta.unreadAdmin = 0;
                saveLocalChats(chats);
                convCache = chats;
            }
        } else fbDb.ref('chats/' + adminSelected + '/meta/unreadAdmin').set(0);
    }
}

function sendAdminReply(text) {
    if (!adminSelected) return;
    var meta = (convCache[adminSelected] && convCache[adminSelected].meta) || {};
    if (localMode()) {
        var chats = localChats(), conv = chats[adminSelected];
        if (!conv) return;
        conv.messages = conv.messages || [];
        conv.meta = conv.meta || {};
        var at = Date.now();
        conv.messages.push({ id: 'm' + at + '-' + Math.random().toString(36).slice(2, 7), from: 'admin', text: text, at: at });
        conv.meta.lastMsg = text.slice(0, 90);
        conv.meta.lastAt = at;
        conv.meta.unreadCustomer = (conv.meta.unreadCustomer || 0) + 1;
        conv.meta.unreadAdmin = 0;
        chats[adminSelected] = conv;
        saveLocalChats(chats);
        convCache = chats;
        adminMsgs = conv.messages;
        renderAdminInbox(document.getElementById('mz-admin-chat'));
        return;
    }
    var t = firebase.database.ServerValue.TIMESTAMP;
    fbDb.ref('chats/' + adminSelected + '/messages').push({ from: 'admin', text: text, at: t });
    fbDb.ref('chats/' + adminSelected + '/meta').update({ lastMsg: text.slice(0, 90), lastAt: t, unreadCustomer: (meta.unreadCustomer || 0) + 1 });
}

/* ---------------- EVENTS ---------------- */
document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-mzc]') : null;
    if (!t) return;
    var a = t.getAttribute('data-mzc');
    if (a === 'toggle') { e.preventDefault(); if (panelOpen) { panelOpen = false; renderWidget(); } else openChat(); }
    else if (a === 'close') { panelOpen = false; renderWidget(); }
    else if (a === 'sel') { adminSelected = t.getAttribute('data-id'); ensureConvHook(); renderAdminInbox(document.getElementById('mz-admin-chat')); }
    else if (a === 'admin-logout') { if (fbAuth) fbAuth.signOut(); }
    else if (a === 'admin-retry') { renderAdmin(document.getElementById('mz-admin-chat')); }
});

document.addEventListener('submit', function (e) {
    var f = e.target.closest ? e.target.closest('[data-mzc-form]') : null;
    if (!f) return;
    e.preventDefault();
    var kind = f.getAttribute('data-mzc-form');
    if (kind === 'customer') {
        var inp = f.querySelector('[data-mzc-input="customer"]');
        var v = inp ? inp.value.trim() : '';
        if (v) { sendCustomer(v); inp.value = ''; }
    } else if (kind === 'admin-reply') {
        var inp2 = f.querySelector('[data-mzc-input="admin"]');
        var v2 = inp2 ? inp2.value.trim() : '';
        if (v2) { sendAdminReply(v2); inp2.value = ''; }
    } else if (kind === 'admin-login') {
        if (!boot()) return;
        fbAuth.signInWithEmailAndPassword(f.email.value.trim(), f.pass.value).catch(function (err) { alert('Login failed: ' + err.message); });
    }
});

window.addEventListener('storage', function (e) {
    if (!localMode() || e.key !== 'mz_local_chats') return;
    if (currentUser && currentUser.role === 'customer') {
        loadLocalCustomer(panelOpen);
        renderWidget();
    }
    if (currentUser && currentUser.role === 'admin' && currentRoute === 'admin/chat') {
        convCache = localChats();
        renderAdminInbox(document.getElementById('mz-admin-chat'));
    }
});

/* ---------------- PUBLIC HOOK (called from render() in app.js) ---------------- */
window.MZChat = {
    onRoute: function (u, r) {
        currentUser = u || null;
        currentRoute = r || 'shop';
        if (localMode() && u && u.role === 'customer') loadLocalCustomer(false);
        if (!u) { panelOpen = false; anonUid = null; myMsgs = []; myMeta = {}; }
        renderWidget();
        if (u && u.role === 'admin' && r === 'admin/chat') {
            if (localMode()) { renderAdmin(document.getElementById('mz-admin-chat')); return; }
            if (!boot()) { var el = document.getElementById('mz-admin-chat'); if (el) el.innerHTML = cfgNotice(); return; }
            renderAdmin(document.getElementById('mz-admin-chat'));
        }
    }
};
})();
