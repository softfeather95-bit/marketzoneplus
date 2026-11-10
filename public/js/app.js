/* ============================================================
   MARKET ZONE — Professional Storefront
   Pure web version: no server needed, just open index.html.
   Data is saved in the browser's localStorage.
   ============================================================ */
(function () {
'use strict';

var ADMIN_EMAIL = 'admin@gmail.com';
var SEED_VERSION = 5;
var FREE_SHIP_OVER = 50;
var SHIP_FEE = 5.99;
var FALLBACK_IMG = 'assets/image-unavailable.svg';
var CAT_ICONS = {'Watches':'⌚','Bags & Luggage':'🎒','Electrical Tools':'🔌','Electronics':'💻','Fashion':'👕','Home & Kitchen':'🍳','Beauty & Care':'💄','Sports & Fitness':'🏋️','Toys & Games':'🧸','Automotive':'🚗','Health':'❤️','Machinery':'⚙️','General':'📦'};

/* ---------- storage helpers ---------- */
function dbGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function dbSet(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

var seq = dbGet('mz_seq', 1000);
function nextId() { seq += 1; dbSet('mz_seq', seq); return seq; }

function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; } return 'h' + h.toString(36) + '_' + s.length; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function money(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
var STORE_DEPOSIT_MESSAGE = 'Please contact the administrator to complete your store deposit. Tell the administrator the amount you wish to deposit in USD and follow their instructions.';
var storeDepositContactStoreId = 0;
function frozenAccountNotice() {
    var u = sessionUser();
    return u && u.withdrawHold ? '<div class="notice notice-error account-frozen-notice" role="alert"><strong>Your account is frozen.</strong> Financial and Store actions are unavailable. Please contact the administrator.</div>' : '';
}
function numFmt(n) { return Number(n || 0).toLocaleString('en-US'); }
function phoneNumberOk(v) { var d = String(v || '').replace(/\D/g, ''); return d.length >= 7 && d.length <= 15; }
function nowISO() { return new Date().toISOString(); }
function fmtDate(iso) { var d = new Date(iso); return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
function fmtDateTime(iso) { var d = new Date(iso); return fmtDate(iso) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }
function deliveryDate(seed) { var d = new Date(Date.now() + (3 + (seed % 5)) * 86400000); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
function pctOff(p) { return p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0; }
function hasExcludedProductBranding(p) {
    var text = [p.name, p.brand, p.description].concat(p.features || []).join(' ');
    return /amazon|\bstone\s*&\s*beam\b|\brivet\b|\bstrathwood\b|\b(?:umi|eono|proiron)\b|\bsimple joys by carter|\bcare of by puma\b/i.test(text);
}
function commOf(p) { return Math.round(p.price * p.commissionRate) / 100; }

/* ---------- data access ---------- */
var Users = {
    all: function () { return dbGet('mz_users', []); },
    save: function (l) { dbSet('mz_users', l); },
    byEmail: function (e) { return Users.all().find(function (u) { return u.email === e; }); },
    byId: function (id) { return Users.all().find(function (u) { return u.id === id; }); },
    byReferralCode: function (code) { return Users.all().find(function (u) { return u.role === 'customer' && u.referralCode === code; }); },
    add: function (u) { var l = Users.all(); l.push(u); Users.save(l); },
    update: function (id, patch) { var l = Users.all(); var u = l.find(function (x) { return x.id === id; }); if (u) { Object.assign(u, patch); Users.save(l); } },
    remove: function (id) { Users.save(Users.all().filter(function (u) { return u.id !== id; })); }
};
function normProduct(p) {
    p.name = String(p.name || 'Unnamed product').trim();
    p.brand = String(p.brand || '').trim();
    p.category = p.category || 'General';
    p.subcategory = p.subcategory || p.productType || 'General';
    p.description = String(p.description || '').trim();
    p.features = Array.isArray(p.features) ? p.features.filter(Boolean) : [];
    p.images = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
    if (!p.images.length && p.image && p.image !== FALLBACK_IMG) p.images = [p.image];
    p.image = p.images[0] || p.image || FALLBACK_IMG;
    p.price = Math.min(1000, Math.max(50, Number(p.price) || 50));
    p.stock = Math.max(0, parseInt(p.stock, 10) || 0);
    p.commissionRate = Number(p.commissionRate) || 0;
    p.rating = p.rating == null ? null : Number(p.rating);
    p.reviews = p.reviews == null ? null : Number(p.reviews);
    p.discountPercent = [10, 15, 20, 25, 30, 35, 40].indexOf(Number(p.discountPercent)) >= 0 ? Number(p.discountPercent) : 20;
    p.mrp = p.mrp == null ? null : Number(p.mrp);
    if (!(p.mrp > p.price)) p.mrp = Math.round(p.price / (1 - p.discountPercent / 100) * 100) / 100;
    p.sku = p.sku || ('MZ-' + p.id);
    p.badge = p.badge || '';
    p.storeName = p.storeName || '';
    return p;
}
var Products = {
    _cache: null,
    all: function () {
        if (!Products._cache) Products._cache = dbGet('mz_products', []).map(normProduct);
        return Products._cache;
    },
    save: function (l) { dbSet('mz_products', l); Products._cache = l.map(normProduct); },
    byId: function (id) { return Products.all().find(function (p) { return Number(p.id) === Number(id); }) || null; },
    add: function (p) { var l = Products.all().slice(); l.push(p); Products.save(l); },
    remove: function (id) { Products.save(Products.all().filter(function (p) { return Number(p.id) !== Number(id); })); },
    update: function (id, patch) {
        var l = Products.all().map(function (x) { return Object.assign({}, x); });
        var p = l.find(function (x) { return Number(x.id) === Number(id); });
        if (p) { Object.assign(p, patch); Products.save(l); }
    }
};
var Orders = {
    all: function () { return dbGet('mz_orders', []); },
    save: function (l) { dbSet('mz_orders', l); },
    add: function (o) { var l = Orders.all(); l.push(o); Orders.save(l); },
    update: function (id, patch) { var l = Orders.all(); var o = l.find(function (x) { return x.id === id; }); if (o) { Object.assign(o, patch); Orders.save(l); } },
    byUser: function (uid) { return Orders.all().filter(function (o) { return o.userId === uid; }).sort(function (a, b) { return b.id - a.id; }); }
};
var Txs = {
    all: function () { return dbGet('mz_txs', []); },
    save: function (l) { dbSet('mz_txs', l); },
    add: function (t) { var l = Txs.all(); l.push(t); Txs.save(l); },
    byUser: function (uid) { return Txs.all().filter(function (t) { return t.userId === uid; }).sort(function (a, b) { return b.id - a.id; }); }
};
var Wallets = {
    get: function (uid) { var w = dbGet('mz_wallets', {}); return w[uid] || 0; },
    set: function (uid, bal) { var w = dbGet('mz_wallets', {}); w[uid] = bal; dbSet('mz_wallets', w); }
};


/* ---------- customer dashboard stats ---------- */
function orderCommission(o) { return (o.items || []).reduce(function (s, i) { return s + (Number(i.commission) || 0); }, 0); }
function txSum(uid, type, absolute) {
    return Txs.byUser(uid).filter(function (t) { return t.type === type; }).reduce(function (s, t) {
        var a = Number(t.amount) || 0; return s + (absolute ? Math.abs(a) : a);
    }, 0);
}
function customerStats(uid) {
    var orders = Orders.byUser(uid);
    var s = {
        orders: orders, totalOrders: orders.length, activeOrders: 0, completedOrders: 0, cancelledOrders: 0,
        totalOrderValue: 0, completedOrderValue: 0, cancelledOrderValue: 0, pendingCommission: 0,
        walletBalance: Wallets.get(uid), commissionEarned: 0, cashbackEarned: 0, refundEarned: 0, profitEarned: 0,
        purchaseTotal: 0, walletTopups: 0, walletDebits: 0, withdrawn: 0, totalProfit: 0, totalEarnings: 0
    };
    orders.forEach(function (o) {
        var total = Number(o.total) || 0, comm = orderCommission(o);
        s.totalOrderValue += total;
        if (o.status === 'Completed') { s.completedOrders += 1; s.completedOrderValue += total; }
        else if (o.status === 'Cancelled') { s.cancelledOrders += 1; s.cancelledOrderValue += total; }
        else { s.activeOrders += 1; s.pendingCommission += comm; }
    });
    s.commissionEarned = Math.round(txSum(uid, 'commission') * 100) / 100;
    s.cashbackEarned = Math.round(txSum(uid, 'cashback') * 100) / 100;
    s.refundEarned = Math.round((txSum(uid, 'refund') + txSum(uid, 'order_refund')) * 100) / 100;
    s.profitEarned = Math.round((txSum(uid, 'profit') + txSum(uid, 'profit_reversal')) * 100) / 100;
    s.purchaseTotal = Math.round(Math.abs(txSum(uid, 'purchase')) * 100) / 100;
    s.walletTopups = Math.round(txSum(uid, 'credit') * 100) / 100;
    s.walletDebits = Math.round(Math.abs(txSum(uid, 'debit')) * 100) / 100;
    s.withdrawn = Math.round(Withdrawals.all().filter(function (w) { return w.userId === uid && w.status === 'Completed'; }).reduce(function (sum, w) { return sum + (Number(w.amount) || 0); }, 0) * 100) / 100;
    s.pendingCommission = Math.round(s.pendingCommission * 100) / 100;
    s.totalOrderValue = Math.round(s.totalOrderValue * 100) / 100;
    s.completedOrderValue = Math.round(s.completedOrderValue * 100) / 100;
    s.cancelledOrderValue = Math.round(s.cancelledOrderValue * 100) / 100;
    s.totalProfit = Math.round((s.commissionEarned + s.profitEarned) * 100) / 100;
    s.totalEarnings = Math.round((s.cashbackEarned + s.totalProfit) * 100) / 100;
    return s;
}
function customerStatCard(lbl, num, color) { return '<div class="stat"><div class="lbl">' + lbl + '</div><div class="num" style="color:' + color + '">' + num + '</div></div>'; }

/* ---------- USDT (TRC20) withdrawals ---------- */
var Withdrawals = {
    all: function () { return dbGet('mz_withdrawals', []); },
    save: function (l) { dbSet('mz_withdrawals', l); },
    add: function (w) { var l = Withdrawals.all(); l.push(w); Withdrawals.save(l); },
    update: function (id, patch) { var l = Withdrawals.all(); var w = l.find(function (x) { return x.id === id; }); if (w) { Object.assign(w, patch); Withdrawals.save(l); } }
};

/* ---------- wallet deposit requests ---------- */
var Deposits = {
    all: function () { return dbGet('mz_deposits', []); },
    save: function (l) { dbSet('mz_deposits', l); },
    add: function (d) { var l = Deposits.all(); l.push(d); Deposits.save(l); },
    byUser: function (uid) { return Deposits.all().filter(function (d) { return d.userId === uid; }).sort(function (a, b) { return b.id - a.id; }); },
    update: function (id, patch) { var l = Deposits.all(); var d = l.find(function (x) { return x.id === id; }); if (d) { Object.assign(d, patch); Deposits.save(l); } return d; }
};

/* ---------- Merchant Stores (customer store applications) ---------- */
var DOC_TYPES = ['National ID (NIC)', 'Passport', 'Driving Licence'];
var STORE_CATS = ['Fashion & Clothing', 'Designer / Custom Made', 'Electronics & Gadgets', 'Furniture & Wood Work', 'Shoes, Bags & Accessories', 'Beauty & Personal Care', 'Home & Kitchen', 'Grocery & Food', 'Sports & Fitness', 'Toys & Kids', 'Mobile Accessories', 'Other'];
var COUNTRIES = [
    ['United States', '+1'], ['United Kingdom', '+44'], ['Canada', '+1'], ['Australia', '+61'],
    ['Pakistan', '+92'], ['India', '+91'], ['Bangladesh', '+880'], ['UAE', '+971'],
    ['Saudi Arabia', '+966'], ['Qatar', '+974'], ['Kuwait', '+965'], ['Oman', '+968'],
    ['Bahrain', '+973'], ['Turkey', '+90'], ['Malaysia', '+60'], ['Indonesia', '+62'],
    ['Philippines', '+63'], ['Singapore', '+65'], ['Thailand', '+66'], ['Vietnam', '+84'],
    ['China', '+86'], ['Japan', '+81'], ['South Korea', '+82'], ['Hong Kong', '+852'],
    ['Germany', '+49'], ['France', '+33'], ['Spain', '+34'], ['Italy', '+39'],
    ['Netherlands', '+31'], ['Belgium', '+32'], ['Switzerland', '+41'], ['Austria', '+43'],
    ['Sweden', '+46'], ['Norway', '+47'], ['Denmark', '+45'], ['Finland', '+358'],
    ['Ireland', '+353'], ['Portugal', '+351'], ['Poland', '+48'], ['Greece', '+30'],
    ['Czech Republic', '+420'], ['Romania', '+40'], ['Ukraine', '+380'], ['Russia', '+7'],
    ['South Africa', '+27'], ['Nigeria', '+234'], ['Kenya', '+254'], ['Ghana', '+233'],
    ['Egypt', '+20'], ['Morocco', '+212'], ['Algeria', '+213'], ['Tunisia', '+216'],
    ['Brazil', '+55'], ['Mexico', '+52'], ['Argentina', '+54'], ['Colombia', '+57'],
    ['Chile', '+56'], ['Peru', '+51'], ['New Zealand', '+64'], ['Afghanistan', '+93'],
    ['Iran', '+98'], ['Iraq', '+964'], ['Jordan', '+962'], ['Lebanon', '+961']
];
var Stores = {
    all: function () { return dbGet('mz_stores', []); },
    save: function (l) { dbSet('mz_stores', l); },
    add: function (s) { var l = Stores.all(); l.push(s); Stores.save(l); },
    update: function (id, patch) { var l = Stores.all(); var s = l.find(function (x) { return x.id === id; }); if (s) { Object.assign(s, patch); Stores.save(l); } },
    remove: function (id) { Stores.save(Stores.all().filter(function (s) { return s.id !== id; })); },
    byId: function (id) { return Stores.all().find(function (s) { return s.id === id; }); },
    byUser: function (uid) { return Stores.all().find(function (s) { return s.userId === uid; }); }
};
/* Store identity is persisted on every new order item. Legacy text matching is
   used only when it resolves to one unambiguous approved store. */
function resolveProductStore(p) {
    if (!p) return null;
    var approved = Stores.all().filter(function (s) { return s.status === 'approved'; });
    if (p.storeId) {
        var explicit = approved.find(function (s) { return s.id === Number(p.storeId); });
        if (explicit) return explicit;
    }
    var named = approved.filter(function (s) { return String(s.storeName).trim().toLowerCase() === String(p.storeName || '').trim().toLowerCase(); });
    if (named.length === 1) return named[0];
    var selected = approved.filter(function (s) { return (s.productIds || []).map(Number).indexOf(Number(p.id)) !== -1; });
    return selected.length === 1 ? selected[0] : null;
}
function storeProductsFor(s) {
    if (!s) return [];
    var ids = (s.productIds || []).map(Number);
    return Products.all().filter(function (p) {
        return Number(p.storeId) === Number(s.id) || ids.indexOf(Number(p.id)) !== -1 ||
            (!p.storeId && String(p.storeName || '').trim().toLowerCase() === String(s.storeName).trim().toLowerCase());
    });
}
function orderItemStoreId(it) {
    if (!it) return 0;
    if (it.storeId) return Number(it.storeId);
    var p = Products.byId(it.productId);
    if (p && p.storeId) return Number(p.storeId);
    var linked = resolveProductStore(p || { id: it.productId, storeName: it.storeName });
    return linked ? linked.id : 0;
}
function migrateStoreOrderLinks() {
    var orders = Orders.all(), sellerOrders = SellerOrders.all(), changed = false;
    orders.forEach(function (o) {
        var linked = o.sellerOrderId ? sellerOrders.find(function (so) { return so.id === Number(o.sellerOrderId); }) :
            sellerOrders.find(function (so) { return Number(so.customerOrderId) === Number(o.id); });
        (o.items || []).forEach(function (it) {
            var storeId = linked ? Number(linked.storeId) : orderItemStoreId(it);
            if (storeId && Number(it.storeId) !== storeId) { it.storeId = storeId; changed = true; }
            var st = storeId ? Stores.byId(storeId) : null;
            if (st && !it.storeName) { it.storeName = st.storeName; changed = true; }
            var product = Products.byId(it.productId);
            if (product && !it.image) { it.image = product.image || FALLBACK_IMG; changed = true; }
        });
    });
    if (changed) Orders.save(orders);
}
/* ---------- Notifications ---------- */
var Notifs = {
    all: function () { return dbGet('mz_notifs', []); },
    save: function (l) { dbSet('mz_notifs', l); },
    add: function (n) { var l = Notifs.all(); l.push(n); Notifs.save(l); },
    forUser: function (uid) { return Notifs.all().filter(function (n) { return n.userId === uid; }).sort(function (a, b) { return b.id - a.id; }); },
    unread: function (uid) { return Notifs.forUser(uid).filter(function (n) { return !n.read; }).length; },
    markAllRead: function (uid) { var l = Notifs.all(); l.forEach(function (n) { if (n.userId === uid) n.read = true; }); Notifs.save(l); }
};
function notify(uid, title, message, soId) {
    if (!uid) return;
    Notifs.add({ id: nextId(), userId: uid, title: title, message: message || '', read: false, soId: soId || 0, createdAt: nowISO() });
}
function storeStatusBadge(st) {
    var m = { pending: ['badge-gold', '⏳ Pending'], approved: ['badge-green', '✔ Approved'], rejected: ['badge-red', '✖ Rejected'] };
    var x = m[st] || ['badge-blue', st];
    return '<span class="badge ' + x[0] + '">' + x[1] + '</span>';
}
function countryOptions(sel) {
    return COUNTRIES.map(function (c) { return '<option value="' + c[1] + '"' + (sel === c[1] ? ' selected' : '') + '>' + esc(c[0]) + ' (' + c[1] + ')</option>'; }).join('');
}
function worldCountryOptions(selected) {
    return (window.MZ_COUNTRIES || []).map(function (c) { return '<option value="' + esc(c.name) + '" data-dial="' + esc(c.dial) + '"' + (c.name === selected ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');
}
function docImgHtml(s, cls) {
    if (!s.docImage) return '<span class="hint">No document</span>';
    if (s.docImage.indexOf('data:application/pdf') === 0) return '<a class="btn btn-soft btn-sm" href="' + s.docImage + '" target="_blank">📄 View PDF</a>';
    return '<a href="' + s.docImage + '" target="_blank"><img class="' + (cls || 'doc-thumb') + '" src="' + s.docImage + '" alt="ID document"></a>';
}
function storeDetailCard(s) {
    return '<div class="card" style="margin-bottom:20px"><h3 style="margin-top:0">🏪 ' + esc(s.storeName) + ' ' + storeStatusBadge(s.status) + '</h3>' +
        '<table><tbody>' +
        '<tr><td style="width:180px" class="hint">Store Name</td><td><b>' + esc(s.storeName) + '</b></td></tr>' +
        '<tr><td class="hint">Category</td><td>🏷️ ' + esc(s.category || '—') + '</td></tr>' +
        '<tr><td class="hint">Description</td><td>' + esc(s.description) + '</td></tr>' +
        '<tr><td class="hint">📞 Phone</td><td>' + esc(s.phone) + '</td></tr>' +
        '<tr><td class="hint">🪪 ID Document</td><td><b>' + esc(s.docType) + '</b></td></tr>' +
        '<tr><td class="hint">Document Copy</td><td>' + docImgHtml(s, 'doc-thumb') + '</td></tr>' +
        '<tr><td class="hint">Submitted</td><td>' + fmtDateTime(s.createdAt) + '</td></tr>' +
        (s.reviewedAt ? '<tr><td class="hint">Reviewed</td><td>' + fmtDateTime(s.reviewedAt) + '</td></tr>' : '') +
        '</tbody></table></div>';
}

/* ---------- Referral codes (admin generated) ---------- */
var RefCodes = {
    all: function () { return dbGet('mz_referral_codes', []); },
    save: function (l) { dbSet('mz_referral_codes', l); },
    add: function (c) { var l = RefCodes.all(); l.push(c); RefCodes.save(l); },
    byCode: function (code) { return RefCodes.all().find(function (x) { return x.code === code; }); },
    use: function (code, uid) { var l = RefCodes.all(); var x = l.find(function (y) { return y.code === code; }); if (x) { x.usedBy = uid; x.usedAt = nowISO(); RefCodes.save(l); } }
};
function genRefCode() {
    // Generate a unique 9-digit code across admin invitations and customer alliances.
    var existing = RefCodes.all().map(function (x) { return String(x.code || ''); })
        .concat(Users.all().map(function (u) { return String(u.referralCode || ''); }));
    var c, attempts = 0;
    do {
        c = '';
        for (var i = 0; i < 9; i++) c += Math.floor(Math.random() * 10).toString();
        attempts++;
    } while ((c.charAt(0) === '0' || existing.indexOf(c) !== -1) && attempts < 500);
    if (c.charAt(0) === '0' || existing.indexOf(c) !== -1) {
        c = String(Math.floor(100000000 + Math.random() * 900000000));
        while (existing.indexOf(c) !== -1) c = String(Math.floor(100000000 + Math.random() * 900000000));
    }
    return c;
}

function cart() { try { var c = JSON.parse(sessionStorage.getItem('mz_cart') || '[]'); return Array.isArray(c) ? c : []; } catch (e) { return []; } }
function saveCart(c) {
    var merged = [];
    (Array.isArray(c) ? c : []).forEach(function (i) {
        var id = Number(i.id), qty = parseInt(i.qty, 10) || 0;
        if (!id || qty <= 0) return;
        var existing = merged.find(function (x) { return Number(x.id) === id; });
        if (existing) existing.qty += qty;
        else merged.push(Object.assign({}, i, { id: id, qty: qty }));
    });
    sessionStorage.setItem('mz_cart', JSON.stringify(merged));
}
function cartCount() { return cart().reduce(function (s, i) { return s + i.qty; }, 0); }

function sessionUser() { var s = dbGet('mz_session', null); return s ? Users.byId(s.uid) : null; }
function setSession(uid) { dbSet('mz_session', { uid: uid }); }
function clearSession() { localStorage.removeItem('mz_session'); }

/* ---------- authoritative server synchronization ---------- */
var serverConfig = { payments: { wallet: true, cod: true, card: false, online: false }, availableCountries: ['United States'] };
var serverState = { assistance: [], audits: [] };
function applyServerState(s, light) {
    if (!s || !s.user) return;
    if (light) {
        var previousProducts = Products.all();
        var patches = {};
        (s.products || []).forEach(function (p) { patches[p.id] = p; });
        s = Object.assign({}, s, {
            products: previousProducts.map(function (p) { return Object.assign({}, p, patches[p.id] || {}); }),
            stores: (s.stores || []).map(function (st) {
                var previous = Stores.byId(st.id);
                return Object.assign({}, st, { docImage: st.docImage || (previous && previous.docImage) || '' });
            })
        });
    }
    serverState = s;
    Users.save(s.users || []); Stores.save(s.stores || []); Products.save(s.products || []);
    Orders.save(s.orders || []); SellerOrders.save(s.sellerOrders || []); Txs.save(s.txs || []);
    Deposits.save(s.deposits || []); Notifs.save(s.notifs || []); Withdrawals.save(s.withdrawals || []);
    RefCodes.save(s.refCodes || []); dbSet('mz_wallets', s.wallets || {}); setSession(s.user.id);
    dbSet('mz_seed_v', SEED_VERSION);
    var maxId = [s.users, s.orders, s.sellerOrders, s.deposits, s.products].reduce(function (m, list) {
        (list || []).forEach(function (x) { m = Math.max(m, Number(x.id) || 0); }); return m;
    }, 1000);
    if (maxId > seq) { seq = maxId; dbSet('mz_seq', seq); }
}
function serverSync(light) {
    return MZServer.request('/state' + (light ? '?light=1' : '')).then(function (s) { applyServerState(s, !!light); return s; }).catch(function (err) {
        if (err.status === 401 || err.status === 403) { clearSession(); return null; }
        throw err;
    });
}
function serverCall(path, method, payload) {
    return MZServer.request(path, { method: method || 'POST', body: payload || {} }).then(function (result) {
        var needsFullCatalog = path.indexOf('/products') >= 0 || path === '/customer/store' || path === '/customer/stores' || path.indexOf('/admin/stores') === 0;
        return serverSync(!needsFullCatalog).then(function () { return result; });
    });
}
function serverError(err) {
    console.error('Server operation failed:', err);
    toast(esc(err && err.message ? err.message : 'The operation could not be completed. No changes were confirmed.'), 'error');
}
function checkoutKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'order-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '-marketzone';
}

/* ---------- licensed catalog seed ---------- */
function seedProducts() {
    return (Array.isArray(window.MZ_CATALOG) ? window.MZ_CATALOG : []).map(function (p) {
        return Object.assign({}, p);
    });
}
function init() {
    if (!window.MZServer && !localStorage.getItem('mz_users')) {
        var adminId = nextId();
        Users.add({ id: adminId, name: 'Market Zone Admin', email: ADMIN_EMAIL, pass: '', role: 'admin', status: 'active', createdAt: nowISO() });
        Wallets.set(adminId, 0);
        dbSet('mz_txs', []);
        dbSet('mz_orders', []);
    }
    if (dbGet('mz_seed_v', 0) < SEED_VERSION) {
        var previousProducts = dbGet('mz_products', []);
        var customProducts = previousProducts.filter(function (p) { return p.source === 'admin' || p.custom === true || Number(p.id) > 1000 && Number(p.id) < 10000; }).filter(function (p) { return !hasExcludedProductBranding(p); });
        var previousBySku = {}, customSkus = {};
        previousProducts.forEach(function (p) { if (p.sku) previousBySku[p.sku] = p; });
        customProducts.forEach(function (p) { if (p.sku) customSkus[p.sku] = true; });
        var catalogProducts = seedProducts().filter(function (p) { return !customSkus[p.sku]; }).map(function (p) {
            var previous = previousBySku[p.sku];
            if (!previous) return p;
            /* Catalog refreshes must not undo stock depletion or Store assignment. */
            p.stock = Math.max(0, parseInt(previous.stock, 10) || 0);
            p.storeId = Number(previous.storeId) || 0;
            p.storeName = previous.storeName || '';
            p.commissionRate = Number(previous.commissionRate) || 0;
            return p;
        });
        Products.save(catalogProducts.concat(customProducts));
        var maxProductId = Products.all().reduce(function (m, p) { return Math.max(m, Number(p.id) || 0); }, seq);
        if (maxProductId > seq) { seq = maxProductId; dbSet('mz_seq', seq); }
        dbSet('mz_seed_v', SEED_VERSION);
    }
    Users.all().filter(function (u) { return u.role === 'customer' && !u.referralCode; }).forEach(function (u) {
        Users.update(u.id, { referralCode: genRefCode() });
    });
    migrateStoreOrderLinks();
}

/* ---------- toast ---------- */
function toast(msg, type) {
    var t = document.getElementById('toast');
    t.innerHTML = msg;
    t.className = 'show ' + (type || 'success');
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.className = ''; }, 3400);
}
function manualOrderError(msg) {
    var feedback = document.getElementById('assign-order-feedback');
    if (feedback) { feedback.textContent = msg; feedback.className = 'form-feedback error'; }
    toast(esc(msg), 'error');
}

/* ---------- routing ---------- */
function go(p) { location.hash = '#/' + p; }
function route() { var h = location.hash.replace(/^#\/?/, '') || 'shop'; return h.split('?')[0]; }

/* ---------- shared bits ---------- */
function starsHtml(r) {
    var full = Math.round(r), s = '';
    for (var i = 1; i <= 5; i++) s += i <= full ? '★' : '☆';
    return '<span class="stars">' + s + '</span>';
}
function ratingHtml(p) {
    if (p.rating == null || !isFinite(p.rating)) return '<div class="prating unavailable">Source rating unavailable</div>';
    return '<div class="prating">' + starsHtml(p.rating) + '<span class="rev">' + p.rating.toFixed(1) + (p.reviews != null ? ' (' + numFmt(p.reviews) + ' source reviews)' : '') + '</span></div>';
}
function stockHtml(p) {
    if (p.stock <= 0) return '<span class="pstock out">Out of stock</span>';
    if (p.stock < 10) return '<span class="pstock low">Only ' + p.stock + ' left in stock — order soon</span>';
    return '<span class="pstock in">✔ In stock · ' + p.stock + ' in MarketZone local inventory</span>';
}
function shipLine(p) {
    return p.price >= FREE_SHIP_OVER
        ? '<span class="pship">✔ FREE delivery <b>' + deliveryDate(p.id) + '</b></span>'
        : '<span class="pship fee">FREE delivery on orders over ' + money(FREE_SHIP_OVER) + '</span>';
}
function badgeHtml(p) {
    var off = pctOff(p);
    if (off > 0) return '<span class="pbadge b-deal discount-badge">' + off + '% OFF</span>';
    if (!p.badge) return '';
    var cls = p.badge === 'Deal' ? 'b-deal' : (p.badge === 'New' ? 'b-new' : 'b-best');
    return '<span class="pbadge ' + cls + '">' + esc(p.badge) + '</span>';
}
function imgTag(p, cls, loading) {
    return '<img loading="' + (loading || 'lazy') + '" decoding="async" class="' + (cls || '') + '" src="' + esc(p.image) + '" alt="' + esc(p.name) + '" onerror="this.onerror=null;this.src=\'' + FALLBACK_IMG + '\';this.classList.add(\'image-error\')">';
}
function statusBadge(s) {
    var m = { Pending: 'badge-gold', Processing: 'badge-blue', Completed: 'badge-green', Approved: 'badge-green', Cancelled: 'badge-red', Rejected: 'badge-red' };
    return '<span class="badge ' + (m[s] || 'badge-blue') + '">' + s + '</span>';
}

/* ---------- storefront chrome ---------- */
function categories() {
    return Products.all().map(function (p) { return p.category; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
}
function updateCartBadge() {
    var b = document.getElementById('cart-badge'), count = cartCount();
    if (b) { b.textContent = count; b.hidden = !count; }
    var link = document.querySelector('.header-cart');
    if (link) link.setAttribute('aria-label', 'Shopping cart, ' + count + ' items');
}
function updateNotificationBadge() {
    var u = sessionUser(); if (!u) return;
    var count = Notifs.unread(u.id), trigger = document.querySelector('.notification-trigger');
    if (trigger) {
        trigger.setAttribute('aria-label', 'Notifications, ' + count + ' unread');
        var badge = trigger.querySelector('.header-count');
        if (count && !badge) { badge = document.createElement('span'); badge.className = 'header-count'; badge.id = 'notification-badge'; trigger.appendChild(badge); }
        if (badge) { badge.textContent = count; badge.hidden = !count; }
    }
    var panel = document.getElementById('notification-panel');
    if (panel) { var wasOpen = !panel.hidden; panel.outerHTML = notificationPanelHtml(u); document.getElementById('notification-panel').hidden = !wasOpen; }
}
function headerHtml(u) {
    return '' +
    '<header class="hdr">' +
      '<div class="hdr-top">' +
        '<button class="burger" data-action="open-drawer" aria-label="Menu"><span></span><span></span><span></span></button>' +
        '<a class="logo" href="#/shop"><span class="logo-mark">\u{1F6CD}</span><span class="logo-lockup"><span class="logo-title">Market<span>ZonePlus</span></span></span></a>' +
        '<span class="hdr-spacer"></span>' +
        (u && u.role === 'customer' ? '<a class="hlink mz-livechat-link" href="#/shop" data-mzc="toggle"><span>\u{1F4AC} Need help?</span><b>Live Chat</b></a>' +
            '<button class="header-icon notification-trigger" data-action="toggle-notifications" aria-label="Notifications, ' + Notifs.unread(u.id) + ' unread" aria-expanded="false" aria-controls="notification-panel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>' + (Notifs.unread(u.id) ? '<span class="header-count" id="notification-badge">' + Notifs.unread(u.id) + '</span>' : '') + '</button>' +
            '<a class="header-icon header-cart" href="#/cart" aria-label="Shopping cart, ' + cartCount() + ' items"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h2l2.4 12.2a2 2 0 0 0 2 1.8h7.9a2 2 0 0 0 2-1.6L21 7H6M10 21h.01M17 21h.01"/></svg><span class="header-count" id="cart-badge"' + (cartCount() ? '' : ' hidden') + '>' + cartCount() + '</span></a>' +
            notificationPanelHtml(u) : '') +
      '</div>' +
    '</header>';
}

function notificationPanelHtml(u) {
    var list = Notifs.forUser(u.id), unread = Notifs.unread(u.id);
    var rows = list.slice(0, 6).map(function (n) {
        return '<button class="notif-pop-item' + (n.read ? '' : ' unread') + '" data-action="notif-open" data-id="' + n.id + '"><span class="notif-dot" aria-hidden="true"></span><span><b>' + esc(n.title) + '</b><span>' + esc(n.message || 'Open for details') + '</span><small>' + fmtDateTime(n.createdAt) + '</small></span></button>';
    }).join('');
    return '<section class="notif-popover" id="notification-panel" aria-label="Notifications" hidden>' +
        '<div class="notif-pop-head"><div><b>Notifications</b><span>' + (unread ? unread + ' unread' : 'You’re up to date') + '</span></div><button class="notif-close" data-action="close-notifications" aria-label="Close notifications">×</button></div>' +
        '<div class="notif-pop-list">' + (rows || '<div class="notif-empty"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><b>No notifications yet</b><span>Order, cart, and account updates will appear here.</span></div>') + '</div>' +
        '<div class="notif-pop-foot"><a href="#/notifications">View all</a>' + (unread ? '<button data-action="notif-readall">Mark all as read</button>' : '') + '</div></section>';
}
function accountAvatar(u) {
    var palettes = [['#8f3f24','#f3d8ca'],['#245b55','#d7ebe5'],['#3f4f78','#e0e5f2'],['#71507d','#eee1f0'],['#72531f','#f3e8cf']];
    var pal = palettes[Math.abs(Number(u.id) || 0) % palettes.length];
    var initials = String(u.name || 'Customer').trim().split(/\s+/).slice(0, 2).map(function (x) { return x.charAt(0); }).join('').toUpperCase();
    return '<svg class="account-avatar-svg" viewBox="0 0 96 96" role="img" aria-label="Profile avatar for ' + esc(u.name) + '"><rect width="96" height="96" rx="48" fill="' + pal[1] + '"/><path d="M19 88c3-20 15-30 29-30s26 10 29 30" fill="' + pal[0] + '" opacity=".94"/><circle cx="48" cy="37" r="18" fill="#fff" opacity=".96"/><path d="M38 35h20l-2 11H40z" fill="' + pal[0] + '" opacity=".16"/><path d="M42 35v-3a6 6 0 0 1 12 0v3" fill="none" stroke="' + pal[0] + '" stroke-width="2.4" stroke-linecap="round"/><text x="48" y="43" text-anchor="middle" font-family="Manrope,Poppins,sans-serif" font-size="15" font-weight="800" fill="' + pal[0] + '">' + esc(initials) + '</text><circle cx="75" cy="22" r="10" fill="#fff"/><path d="M71 20h8l-1 6h-6zM73 20v-2a2 2 0 0 1 4 0v2" fill="none" stroke="' + pal[0] + '" stroke-width="1.5" stroke-linejoin="round"/></svg>';
}
function drawerHtml(u) {
    var cats = categories();
    var unread = Notifs.unread(u.id);
    var st = Stores.byUser(u.id);
    var isCust = u && u.role === 'customer';
    var isAdmin = u && u.role === 'admin';
    return '' +
    '<div class="mz-overlay" id="mz-overlay" data-action="close-drawer"></div>' +
    '<aside class="mz-drawer" id="mz-drawer">' +
      '<div class="mz-d-head"><span>\u{1F6CD}</span><b>Market<span style="color:#febd69">Zone</span></b>' +
        '<button class="mz-d-close" data-action="close-drawer">\u{2715}</button></div>' +
      '<div class="mz-d-search"><form class="searchbar" data-form="search">' +
        '<input id="drawer-q" name="q" placeholder="Search products..." value="' + esc(shopState.q) + '" autocomplete="off" aria-label="Search products from menu">' +
        '<button class="sbtn" aria-label="Search">\u{1F50D}</button></form></div>' +
      '<div class="mz-d-scroll">' +
        '<div class="mz-d-label">Navigation</div>' +
        '<a class="mz-item" href="#/shop"><span class="mi-ico">\u{1F6D1}</span> Shop</a>' +
        '<a class="mz-item" href="#/shop"><span class="mi-ico">\u{1F4D6}</span> Official Catalog</a>' +
        (isCust ? '<a class="mz-item" href="#/mystore"><span class="mi-ico">\u{1F3EA}</span> My Store</a>' +
            '<a class="mz-item" href="#/orders"><span class="mi-ico">\u{1F4E6}</span> My Orders</a>' +
            '<a class="mz-item" href="#/targets"><span class="mi-ico">\u{1F3AF}</span> My Targets</a>' : '') +
        (isAdmin ? '<a class="mz-item" href="#/admin"><span class="mi-ico">\u{1F4CA}</span> Admin Dashboard</a>' : '') +
        '<a class="mz-item" href="#/notifications"><span class="mi-ico">\u{1F514}</span> Notifications' + (unread ? '<span class="mz-badge">' + unread + '</span>' : '') + '</a>' +
        (isCust ? '<a class="mz-item" href="#/profile"><span class="mi-ico">\u{1F464}</span> My Account</a>' : '') +
        '<div class="mz-d-label">Categories</div>' +
        cats.map(function (c) {
            return '<a class="mz-item mz-cat" href="#/shop?cat=' + encodeURIComponent(c) + '"><span class="mi-ico">' + (CAT_ICONS[c] || '\u{1F6CD}') + '</span> ' + esc(c) + '</a>';
        }).join('') +
        '<div class="mz-d-label">Information</div>' +
        '<a class="mz-item" href="#/about"><span class="mi-ico">\u{2139}\u{FE0F}</span> About Us</a>' +
        (isCust ? '<a class="mz-item" href="#/shop" data-mzc="toggle"><span class="mi-ico">\u{1F4DE}</span> Contact Support</a>' : '') +
        (isAdmin ? '<a class="mz-item" href="#/admin/chat"><span class="mi-ico">\u{1F4DE}</span> Support Inbox</a>' : '') +
        '<a class="mz-item" href="#/privacy"><span class="mi-ico">\u{1F4C4}</span> Privacy Policy</a>' +
        '<a class="mz-item" href="#/terms"><span class="mi-ico">\u{1F4DC}</span> Terms &amp; Conditions</a>' +
      '</div>' +
      '<div class="mz-d-foot">' +
        '<div class="side-profile"><span class="avatar">' + esc(u.name.charAt(0).toUpperCase()) + '</span><div class="sp-txt"><b>' + esc(u.name) + '</b><span>' + esc(u.email) + '</span></div></div>' +
        '<a class="mz-signout" href="#/logout">Sign Out \u{279C}</a>' +
      '</div>' +
    '</aside>';
}

function bottomNavHtml(u) {
    if (!u || u.role !== 'customer') return '';
    var r = route();
    var ownStore = Stores.byUser(u.id);
    var storeWallet = ownStore && ownStore.status === 'approved';
    var active = (r === 'shop' || r === 'cart' || r === 'checkout') ? 'home'
        : (r === 'mystore' || r === 'seller' || ((r === 'wallet' || r === 'withdrawals') && storeWallet)) ? 'store'
        : r === 'orders' ? 'orders'
        : 'account';
    var icons = {
        home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></svg>',
        orders: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="m3 8 1 10 8 4 8-4 1-10M12 13v9"/></svg>',
        store: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v10h16V10M3 4h18l-2 6a3 3 0 0 1-5 1 3 3 0 0 1-4 0 3 3 0 0 1-5-1Z"/><path d="M9 20v-5h6v5"/></svg>',
        account: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>'
    };
    function item(key, href, label) {
        return '<a class="bn-item' + (active === key ? ' active' : '') + '" href="' + href + '"' + (active === key ? ' aria-current="page"' : '') + '>' +
            '<span class="bn-ico">' + icons[key] + '</span><span class="bn-label">' + label + '</span></a>';
    }
    return '<nav class="bnav" aria-label="Customer navigation">' +
        item('home', '#/shop', 'Home') +
        item('orders', '#/orders', 'Orders') +
        item('store', '#/mystore', 'My Store') +
        item('account', '#/profile', 'Account') +
    '</nav>';
}
function vWithdrawals() {
    var u = sessionUser();
    var bal = Wallets.get(u.id);
    var wds = Withdrawals.all().filter(function (w) { return w.userId === u.id; }).sort(function (a, b) { return b.id - a.id; });
    var done = wds.filter(function (w) { return w.status === 'Completed'; }).reduce(function (s, w) { return s + w.amount; }, 0);
    var pend = wds.filter(function (w) { return w.status === 'Pending'; }).reduce(function (s, w) { return s + w.amount; }, 0);
    function badge(st) {
        if (st === 'Completed') return '<span class="wd-badge ok">approved</span>';
        if (st === 'Rejected') return '<span class="wd-badge bad">rejected</span>';
        return '<span class="wd-badge wait">pending</span>';
    }
    function item(w) {
        var addr = w.method === 'bank'
            ? 'Bank \u00B7 ' + String(w.bankDetails || w.address || '').slice(0, 12) + '\u2026'
            : 'TRC20 ' + String(w.address || '').slice(0, 12) + '\u2026';
        return '<div class="wd-item"><div class="wd-ico">\u2B07</div><div class="wd-info"><div class="wd-tx">' + esc(w.txid || ('TX' + w.id)) + '</div>' +
            '<div class="wd-sub">' + new Date(w.createdAt).toLocaleString('en-US') + '</div>' +
            '<div class="wd-sub">' + esc(addr) + '</div></div>' +
            '<div class="wd-right"><div class="wd-amt">' + money(w.amount) + '</div>' + badge(w.status) + '</div></div>';
    }
    return '<div class="wd-head"><div><h1 class="wd-title">Withdrawals</h1><p class="wd-subtitle">Manage your earnings and withdrawals</p></div>' +
        (u.withdrawHold
            ? '<span class="wd-frozen">\u{1F9CA} Withdrawals frozen by admin</span>'
            : '<button class="wd-req" data-action="open-withdraw-modal">\uFF0B Request Withdrawal</button>') + '</div>' +
        '<div class="wd-stats">' +
        '<div class="wd-stat"><span>Balance</span><b>' + money(bal) + '</b></div>' +
        '<div class="wd-stat"><span>Total Withdrawn</span><b>' + money(done) + '</b></div>' +
        '<div class="wd-stat"><span>Pending</span><b>' + money(pend) + '</b></div></div>' +
        (wds.length ? '<div class="wd-list">' + wds.map(item).join('') + '</div>'
            : '<div class="empty" style="margin-top:20px">\u{1F4B8} No withdrawals yet. Tap "\uFF0B Request Withdrawal" to cash out.</div>');
}
function openWithdrawModal() {
    var u = sessionUser();
    var me = Users.byId(u.id) || u;
    if (me.withdrawHold) { toast('\u{1F9CA} Your withdrawals are frozen by the admin. Contact support.', 'error'); return; }
    var bal = Wallets.get(u.id);
    var root = document.getElementById('modal-root');
    var myStores = Stores.all().filter(function (s) { return s.userId === u.id && s.status === 'approved'; });
    root.innerHTML = '<div class="modal-back" data-action="close-modal"><div class="wmodal">' +
        '<button class="modal-x" data-action="close-modal">\u2715</button>' +
        '<h2 class="wmodal-title">Request Withdrawal</h2>' +
        '<div class="wmodal-bal"><span>Available Balance</span><b>' + money(bal) + '</b></div>' +
        '<form data-form="withdraw">' +
        '<input type="hidden" name="method" id="w-method" value="trc20">' +
        '<label class="wlabel">Amount</label><input name="amount" class="win" type="number" min="1" max="' + bal + '" step="0.01" placeholder="Enter amount" required>' +
        '<label class="wlabel">From Store (optional)</label><select name="store" class="win"><option value="">Select store</option>' +
            myStores.map(function (s) { return '<option value="' + esc(s.storeName) + '">' + esc(s.storeName) + '</option>'; }).join('') + '</select>' +
        '<label class="wlabel">Payment Method</label>' +
        '<div class="wmethods">' +
            '<button type="button" class="wmethod" data-action="wmethod" data-m="bank">\u{1F3E6} Bank Transfer</button>' +
            '<button type="button" class="wmethod active" data-action="wmethod" data-m="trc20">\u20AE TRC20</button>' +
        '</div>' +
        '<div id="w-bankwrap" style="display:none"><label class="wlabel">Bank Details</label><textarea name="bankdetails" class="win" rows="3" placeholder="Enter your bank name, account number, routing number, account holder name..."></textarea></div>' +
        '<div id="w-trcwrap"><label class="wlabel">Your USDT TRC20 Address</label><input name="trc20" class="win" placeholder="T..." minlength="34" maxlength="34"></div>' +
        '<button class="wsubmit" type="submit" ' + (bal <= 0 ? 'disabled' : '') + '>Submit Request</button>' +
        '<button class="wcancel" type="button" data-action="close-modal">Cancel</button>' +
        '</form></div></div>';
    document.body.style.overflow = 'hidden';
}
function vInfo(title, text) {
    return '<div class="card" style="max-width:720px;margin:20px auto"><h2 class="page-title">' + title + '</h2><p style="color:#3a4655;line-height:1.7;font-size:15px">' + esc(text) + '</p></div>';
}
function vTargets() {
    var u = sessionUser();
    var now = new Date();
    var completed = Orders.byUser(u.id).filter(function (o) {
        if (o.status !== 'Completed') return false;
        var d = new Date(o.completedAt || o.createdAt);
        return !isNaN(d.getTime());
    });
    var today = completed.filter(function (o) {
        var d = new Date(o.completedAt || o.createdAt);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    });
    var monthly = completed.filter(function (o) {
        var d = new Date(o.completedAt || o.createdAt);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
    var monthlyValue = Math.round(monthly.reduce(function (sum, o) { return sum + o.total; }, 0) * 100) / 100;
    function card(title, current, goal, unit, color) {
        var progress = Math.min(100, goal ? current / goal * 100 : 0);
        var achieved = current >= goal;
        var currentText = unit === '$' ? money(current) : numFmt(current);
        var goalText = unit === '$' ? money(goal) : numFmt(goal);
        return '<div class="card target-card"><div class="row-between"><h3 style="margin:0">' + title + '</h3>' +
            '<span class="badge ' + (achieved ? 'badge-green' : 'badge-gold') + '">' + (achieved ? 'Achieved' : 'In progress') + '</span></div>' +
            '<div class="target-value" style="color:' + color + '">' + currentText + ' <small>/ ' + goalText + '</small></div>' +
            '<div class="target-track" role="progressbar" aria-label="' + esc(title) + '" aria-valuemin="0" aria-valuemax="' + goal + '" aria-valuenow="' + Math.min(current, goal) + '"><div class="target-fill" style="width:' + progress + '%;background:' + color + '"></div></div>' +
            '<p class="hint">' + (achieved ? 'Target completed. New activity continues to be counted.' : (unit === '$' ? money(goal - current) : numFmt(goal - current)) + ' remaining to reach this target.') + '</p></div>';
    }
    return '<h1 class="page-title">🎯 My Targets</h1>' +
        '<p class="hint" style="margin-bottom:16px">Live progress from your completed orders. Daily targets reset at midnight; monthly targets reset on the first day of each month.</p>' +
        '<div class="target-grid">' +
        card('Today · Completed Orders', today.length, 3, 'orders', '#1458a6') +
        card(now.toLocaleDateString('en-US', { month: 'long' }) + ' · Completed Orders', monthly.length, 20, 'orders', '#067d62') +
        card(now.toLocaleDateString('en-US', { month: 'long' }) + ' · Completed Value', monthlyValue, 1000, '$', '#9a6a00') +
        '</div><div class="card" style="margin-top:18px"><h3 style="margin-top:0">Current Summary</h3>' +
        '<div class="acc-rgrid"><div><span>Completed Today</span><b>' + today.length + '</b></div><div><span>Completed This Month</span><b>' + monthly.length + '</b></div>' +
        '<div><span>Completed Value</span><b>' + money(monthlyValue) + '</b></div><div><span>All-time Completed</span><b>' + completed.length + '</b></div></div></div>';
}

function vCatalogSources() {
    return '<div class="card source-page"><h1 class="page-title">Catalog sources & data notes</h1>' +
    '<p>This catalog contains <b>' + Products.all().length + '</b> currently accessible product records. Imported product titles, brands, descriptions, identifiers, and catalog photography come from exact source listings; they are not randomly generated product cards. Admin-added records are separately identified.</p>' +
    '<h3>Product metadata and images</h3><p>Amazon.com, through the Amazon Berkeley Objects dataset. Dataset/archive credit: Matthieu Guillaumin, Thomas Dideriksen, Kenan Deng, Himanshu Arora, Jasmine Collins, and Jitendra Malik. Licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">Creative Commons Attribution 4.0</a>. Local images have been resized and converted to WebP. The authoritative license and source notice are included in the project’s licenses folder.</p>' +
    '<h3>Historical prices and ratings</h3><p>MarketZone selling prices range from $40 to $1,000. Every product stores an original list price and a varied discount; cards, galleries, cart, and checkout calculate savings from the same values. Available ratings/review counts are exact-source snapshots, not live retailer offers; unavailable ratings remain empty.</p>' +
    '<h3>Supplementary exact devices</h3><p>Five standalone device records fill categories absent from the ABO selection: Samsung Galaxy S24, Apple MacBook Air M2, Sony WH-1000XM3, Raspberry Pi 5, and Apple Watch Series 9. Their exact-model photographs come from Wikimedia Commons under the per-image licenses documented in <a href="licenses/SUPPLEMENTARY-DEVICE-CREDITS.md" target="_blank" rel="noopener">supplementary device credits</a>. Prices are explicitly labeled historical official or documented launch/MSRP snapshots with a linked source on each product. Ratings remain unavailable rather than invented. Apple Watch Series 9 has two verified photographs; its gallery is intentionally not padded with duplicates.</p>' +
    '<h3>MarketZone operational data</h3><p>Stock is MarketZone inventory and decreases only after a successful checkout. It is not live source-retailer availability. Admin-added products retain their own supplied details and ratings; selling prices must be $40–$1,000 and use the same validated discount model.</p></div>';
}
function footerHtml(u) {
    var accountLinks = u && u.role === 'admin'
        ? '<div><h5>Administration</h5><a href="#/admin">Admin Dashboard</a><a href="#/admin/orders">Manage Orders</a><a href="#/admin/chat">Support Inbox</a></div>'
        : '';
    return '<footer class="ftr"><div class="ftr-main' + (accountLinks ? '' : ' ftr-main-no-account') + '"><div><h4>🛒 Market<b>Zone</b></h4><p>Everything you love — electronics, home, fashion, beauty and more. ' + Products.all().length + ' products with verified source details.</p></div>' +
    '<div><h5>Shop</h5><a href="#/shop">All Products</a><a href="#/shop?sort=rating">Top Rated</a><a href="#/shop?sort=reviews">Best Sellers</a></div>' + accountLinks +
    '<div><h5>Support</h5><a href="#/about">About MarketZone</a><a href="#/catalog-sources">Catalog Sources</a><a href="#/privacy">Privacy Policy</a></div></div>' +
    '<div class="ftr-bar">© 2026 MarketZone — online shopping marketplace.</div></footer>';
}
function storeChrome(u, content) {
    return headerHtml(u) + drawerHtml(u) + '<main class="wrap">' + frozenAccountNotice() + content + '</main>' + footerHtml(u) + bottomNavHtml(u);
}

/* ---------- shop state ---------- */
function defaultShopState() {
    return { q: '', cat: 'All', subcat: 'All', brand: 'All', min: '', max: '', rating: '0', availability: 'all', sort: 'featured', page: 1, filtersOpen: false };
}
var shopState = defaultShopState();
function applyShopQuery() {
    var h = location.hash, i = h.indexOf('?');
    if (i < 0) return;
    var params = new URLSearchParams(h.slice(i + 1));
    if (params.get('cat')) shopState.cat = params.get('cat');
    if (params.get('sort')) shopState.sort = params.get('sort');
    if (params.get('q') != null) shopState.q = params.get('q');
    shopState.page = 1;
}
function filteredProducts() {
    var prods = Products.all().slice();
    if (shopState.q) {
        var terms = shopState.q.toLowerCase().trim().split(/\s+/).filter(Boolean);
        prods = prods.filter(function (p) {
            var hay = [p.name, p.brand, p.category, p.subcategory, p.sku, p.storeName, p.description].join(' ').toLowerCase();
            return terms.every(function (t) { return hay.indexOf(t) >= 0; });
        });
    }
    if (shopState.cat !== 'All') prods = prods.filter(function (p) { return p.category === shopState.cat; });
    if (shopState.subcat !== 'All') prods = prods.filter(function (p) { return p.subcategory === shopState.subcat; });
    if (shopState.brand !== 'All') prods = prods.filter(function (p) { return p.brand === shopState.brand; });
    if (shopState.min !== '' && isFinite(Number(shopState.min))) prods = prods.filter(function (p) { return p.price >= Number(shopState.min); });
    if (shopState.max !== '' && isFinite(Number(shopState.max))) prods = prods.filter(function (p) { return p.price <= Number(shopState.max); });
    if (Number(shopState.rating) > 0) prods = prods.filter(function (p) { return p.rating != null && p.rating >= Number(shopState.rating); });
    if (shopState.availability === 'in') prods = prods.filter(function (p) { return p.stock > 0; });
    if (shopState.availability === 'out') prods = prods.filter(function (p) { return p.stock <= 0; });
    var sorters = {
        'price-asc': function (a, b) { return a.price - b.price; },
        'price-desc': function (a, b) { return b.price - a.price; },
        'rating': function (a, b) { return (b.rating || 0) - (a.rating || 0); },
        'reviews': function (a, b) { return (b.reviews || 0) - (a.reviews || 0); },
        'name': function (a, b) { return a.name.localeCompare(b.name); },
        'featured': function (a, b) { return (b.reviews || 0) - (a.reviews || 0) || a.name.localeCompare(b.name); }
    };
    prods.sort(sorters[shopState.sort] || sorters.featured);
    return prods;
}

/* ---------- product card / grid ---------- */
function productCard(p, position) {
    var stars = '';
    if (p.rating != null) {
        var full = Math.round(p.rating);
        for (var i = 1; i <= 5; i++) stars += i <= full ? '\u{2605}' : '<i>\u{2605}</i>';
    }
    var second = p.images && p.images.length > 1 ? p.images[1] : '';
    return '<article class="mp-card">' +
        '<div class="mp-img" data-action="view" data-id="' + p.id + '">' + badgeHtml(p) + imgTag(p, '', position < 8 ? 'eager' : 'lazy') +
            (second ? '<img class="mp-alt" loading="lazy" src="' + esc(second) + '" alt="" aria-hidden="true">' : '') +
            (p.stock <= 0 ? '<span class="mp-low">Out of stock</span>' : p.stock < 10 ? '<span class="mp-low">Only ' + p.stock + ' left</span>' : '') + '</div>' +
        '<div class="mp-body">' +
            (p.brand ? '<div class="mp-brand">' + esc(p.brand) + '</div>' : '') +
            '<div class="mp-name" data-action="view" data-id="' + p.id + '">' + esc(p.name) + '</div>' +
            '<div class="mp-rate">' + (p.rating != null ? '<span class="mp-stars">' + stars + '</span>' + p.rating.toFixed(1) + ' <span>(' + numFmt(p.reviews || 0) + ')</span>' : '<span>Rating unavailable</span>') + '</div>' +
            '<div class="mp-row"><span class="mp-price">' + money(p.price) + '</span><span class="mp-left">' + (p.stock > 0 ? p.stock + ' local' : 'Unavailable') + '</span></div>' +
            '<div class="mp-list-price"><s>' + money(p.mrp) + '</s><span>Save ' + money(p.mrp - p.price) + '</span></div>' +
            '<div class="mp-sku">SKU ' + esc(p.sku) + '</div>' +
        '</div></article>';
}
function shopGridHtml() {
    var prods = filteredProducts();
    if (!prods.length) return '<div class="empty catalog-empty"><div style="font-size:36px">⌕</div><h3>No products match these filters</h3><p>Try a broader search or clear the selected filters.</p><button class="btn btn-gold" data-action="clear-filters">Clear all filters</button></div>';
    var perPage = 24, pages = Math.max(1, Math.ceil(prods.length / perPage));
    if (shopState.page > pages) shopState.page = pages;
    var start = (shopState.page - 1) * perPage;
    var visible = prods.slice(start, start + perPage);
    var pager = '<nav class="catalog-pager" aria-label="Catalog pages">' +
        '<button class="btn" data-action="catalog-page" data-page="' + (shopState.page - 1) + '" ' + (shopState.page <= 1 ? 'disabled' : '') + '>← Previous</button>' +
        '<span>Page <b>' + shopState.page + '</b> of ' + pages + '</span>' +
        '<button class="btn" data-action="catalog-page" data-page="' + (shopState.page + 1) + '" ' + (shopState.page >= pages ? 'disabled' : '') + '>Next →</button></nav>';
    return '<div class="catalog-summary"><span><b>' + numFmt(prods.length) + '</b> products · showing ' + (start + 1) + '–' + Math.min(start + perPage, prods.length) + '</span><span>Clear selling prices and consistent discounts on every product</span></div>' +
        '<div class="mp-grid">' + visible.map(function (p, i) { return productCard(p, i); }).join('') + '</div>' + pager;
}
function sidebarHtml() {
    var all = Products.all();
    var cats = categories();
    var scoped = all.filter(function (p) { return shopState.cat === 'All' || p.category === shopState.cat; });
    var subcats = scoped.map(function (p) { return p.subcategory; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; }).sort();
    var brands = scoped.map(function (p) { return p.brand; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; }).sort();
    return '<aside class="side catalog-side' + (shopState.filtersOpen ? ' open' : '') + '" id="catalog-filters">' +
        '<div class="filter-title"><b>Filter products</b><button data-action="clear-filters">Reset</button></div>' +
        '<div class="filter-group"><h4>Category</h4>' + ['All'].concat(cats).map(function (c) {
            var n = c === 'All' ? all.length : all.filter(function (p) { return p.category === c; }).length;
            return '<button class="side-cat' + (shopState.cat === c ? ' active' : '') + '" data-action="set-cat" data-cat="' + esc(c) + '"><span>' + (CAT_ICONS[c] || '▪') + ' ' + esc(c) + '</span><span>' + n + '</span></button>';
        }).join('') + '</div>' +
        '<div class="filter-group"><label for="filter-subcat">Subcategory</label><select id="filter-subcat" data-shop-filter="subcat"><option>All</option>' + subcats.map(function (x) { return '<option ' + (shopState.subcat === x ? 'selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></div>' +
        '<div class="filter-group"><label for="filter-brand">Brand</label><select id="filter-brand" data-shop-filter="brand"><option>All</option>' + brands.map(function (x) { return '<option ' + (shopState.brand === x ? 'selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></div>' +
        '<div class="filter-group"><label>Price range (USD)</label><div class="price-filter"><input type="number" min="0" step="0.01" placeholder="Min" value="' + esc(shopState.min) + '" data-shop-filter="min" aria-label="Minimum price"><span>–</span><input type="number" min="0" step="0.01" placeholder="Max" value="' + esc(shopState.max) + '" data-shop-filter="max" aria-label="Maximum price"></div></div>' +
        '<div class="filter-group"><label for="filter-rating">Minimum source rating</label><select id="filter-rating" data-shop-filter="rating">' + [['0','Any rating'],['4','4 stars & up'],['3','3 stars & up'],['2','2 stars & up']].map(function (x) { return '<option value="' + x[0] + '" ' + (shopState.rating === x[0] ? 'selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></div>' +
        '<div class="filter-group"><label for="filter-stock">Local availability</label><select id="filter-stock" data-shop-filter="availability">' + [['all','All products'],['in','In stock'],['out','Out of stock']].map(function (x) { return '<option value="' + x[0] + '" ' + (shopState.availability === x[0] ? 'selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></div>' +
        '<div class="side-note">🚚 <b>FREE delivery</b> on orders over ' + money(FREE_SHIP_OVER) + '</div>' +
        '</aside>';
}
/* ---------- home / shop view ---------- */
function miniCard(p) {
    var off = pctOff(p);
    return '<div class="mini" data-action="view" data-id="' + p.id + '">' +
        (off > 0 ? '<span class="off sm">-' + off + '%</span>' : '') +
        imgTag(p) + '<div class="mname">' + esc(p.name) + '</div>' +
        '<div class="mprice">' + money(p.price) + (p.mrp > p.price ? ' <s>' + money(p.mrp) + '</s>' : '') + '</div>' +
        '</div>';
}
function railHtml(title, prods, seeAll) {
    if (!prods.length) return '';
    return '<section class="card sec"><div class="sec-head"><h2>' + title + '</h2>' + (seeAll ? '<a href="' + seeAll + '">See all →</a>' : '') + '</div>' +
        '<div class="rail">' + prods.slice(0, 12).map(miniCard).join('') + '</div></section>';
}
function vShop() {
    var u = sessionUser();
    return '' +
    '<div class="mp-head"><div><h1 class="mp-title">Shop MarketZonePlus</h1><p class="catalog-kicker">Professional products, clear savings, and secure ordering</p></div>' +
    (u.role === 'admin'
        ? '<a class="mp-wallet" href="#/admin/wallet">\u{1F4BC} Wallet Transactions</a>'
        : '<a class="mp-wallet" href="#/wallet">\u{1F4BC} ' + money(Wallets.get(u.id)) + '</a>') + '</div>' +
    '<div class="mp-filters">' +
      '<form class="mp-search" data-form="search"><span>\u{1F50D}</span><input id="global-q" name="q" placeholder="Search by product, brand, category or SKU" value="' + esc(shopState.q) + '" autocomplete="off" aria-label="Search products"><button type="submit">Search</button></form>' +
      '<button class="btn filter-toggle" data-action="toggle-filters">☰ Filters</button>' +
      '<label class="catalog-sort">Sort <select id="shop-sort" aria-label="Sort products">' +
        [['featured','Featured'],['price-asc','Price: low to high'],['price-desc','Price: high to low'],['rating','Highest rated'],['reviews','Most reviewed'],['name','Name: A–Z']].map(function (x) { return '<option value="' + x[0] + '" ' + (shopState.sort === x[0] ? 'selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
    '</div>' +
    '<div class="catalog-layout">' + sidebarHtml() + '<main id="shop-grid" aria-live="polite">' + shopGridHtml() + '</main></div>';
}

/* ---------- quick view modal ---------- */
var galleryState = { id: null, index: 0, zoom: false };
function openProductModal(id) {
    var p = Products.byId(+id);
    if (!p) { toast('This product is no longer available.', 'error'); return; }
    var u = sessionUser();
    var canShop = u && u.role === 'customer';
    var images = p.images && p.images.length ? p.images : [p.image || FALLBACK_IMG];
    galleryState = { id: p.id, index: 0, zoom: false };
    var variants = (p.variants || []).map(Products.byId).filter(function (x) { return x && Number(x.id) !== Number(p.id); });
    var facts = [];
    if (p.color) facts.push(['Color / style', p.color]);
    if (p.productType) facts.push(['Source product type', p.productType]);
    if (p.sku) facts.push(['SKU / source identifier', p.sku]);
    if (p.sourceAsin) facts.push(['Source ASIN', p.sourceAsin]);
    var attributes = p.attributes && typeof p.attributes === 'object' ? p.attributes : {};
    Object.keys(attributes).slice(0, 8).forEach(function (k) { if (attributes[k]) facts.push([k, attributes[k]]); });
    var priceNote = 'MarketZone selling price with ' + pctOff(p) + '% off the original list price. Cart and checkout use this same discounted price.';
    var sourceNote = p.sourceDomain === 'commons.wikimedia.org'
        ? 'Exact-model photography: Wikimedia Commons. Per-image authors and licenses are listed in the supplementary device credits. Images are cropped only to remove browser surroundings where needed, resized, and converted to WebP.'
        : 'Product metadata and images: Amazon.com, via Amazon Berkeley Objects (CC BY 4.0). Images are resized and converted to WebP.';
    var root = document.getElementById('modal-root');
    root.innerHTML = '<div class="modal-back" data-action="close-modal"><div class="modal product-modal" aria-label="' + esc(p.name) + '">' +
        '<button class="modal-x" data-action="close-modal">✕</button>' +
        '<section class="product-gallery" aria-label="Product image gallery">' +
            '<div class="gallery-stage" id="gallery-stage">' +
                '<button class="gallery-arrow prev" data-action="gallery-prev" aria-label="Previous image">‹</button>' +
                '<div class="gallery-viewport"><div class="gallery-track" id="gallery-track">' + images.map(function (src, i) {
                    return '<figure class="gallery-slide"><img src="' + esc(src) + '" alt="' + esc(p.name) + ' — image ' + (i + 1) + '" loading="' + (i === 0 ? 'eager' : 'lazy') + '" decoding="async" draggable="false"><div class="gallery-status">Loading image…</div></figure>';
                }).join('') + '</div></div>' +
                '<button class="gallery-arrow next" data-action="gallery-next" aria-label="Next image">›</button>' +
                '<button class="gallery-zoom" data-action="gallery-zoom" aria-pressed="false">⌕ Zoom</button>' +
                '<span class="gallery-count" id="gallery-count">1 / ' + images.length + '</span>' +
            '</div>' +
            '<div class="gallery-thumbs" role="tablist" aria-label="Choose product image">' + images.map(function (src, i) {
                return '<button class="gallery-thumb' + (i === 0 ? ' active' : '') + '" data-action="gallery-go" data-index="' + i + '" role="tab" aria-selected="' + (i === 0) + '" aria-label="View image ' + (i + 1) + '"><img src="' + esc(src) + '" alt="" loading="eager" decoding="async"></button>';
            }).join('') + '</div>' +
            '<p class="gallery-help">Use arrows, swipe, or thumbnails. Select Zoom to inspect details.</p>' +
        '</section>' +
        '<div class="modal-info product-info">' +
            '<div class="pcat">' + esc(p.category) + ' <span>/</span> ' + esc(p.subcategory) + '</div>' +
            (p.brand ? '<div class="product-brand">' + esc(p.brand) + '</div>' : '') +
            '<h2>' + esc(p.name) + '</h2>' + ratingHtml(p) +
            '<div class="m-price detail-price">' + money(p.price) + ' <s>' + money(p.mrp) + '</s><span class="detail-discount">' + pctOff(p) + '% OFF</span></div>' +
            '<div class="detail-savings">You save ' + money(p.mrp - p.price) + ' on this item.</div>' +
            '<div class="source-price-note">' + priceNote + (p.priceSourceUrl ? ' <a href="' + esc(p.priceSourceUrl) + '" target="_blank" rel="noopener">View price source</a>.' : '') + ' Checkout uses the current price shown here.</div>' +
            '<p class="mdesc">' + esc(p.description || 'No source description was supplied for this listing.') + '</p>' +
            (p.features.length ? '<ul class="product-features">' + p.features.slice(0, 5).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' : '') +
            (variants.length ? '<div class="variant-block"><b>Verified catalog variations</b><div class="variant-list"><button class="variant-chip active">' + esc(p.color || 'Current') + '</button>' + variants.map(function (v) { return '<button class="variant-chip" data-action="variant-select" data-id="' + v.id + '">' + esc(v.color || v.name) + '</button>'; }).join('') + '</div><small>Only listings with matching source brand, model, and product type are linked.</small></div>' : '') +
            shipLine(p) + stockHtml(p) +
            '<div class="qty-row">Qty: <div class="qty"><button data-action="m-dec" aria-label="Decrease quantity">−</button><span id="m-qty">1</span><button data-action="m-inc" aria-label="Increase quantity">+</button></div></div>' +
            (canShop ? '<div class="modal-btns"><button class="btn btn-cart" data-action="add-cart" data-id="' + p.id + '" data-qtyfrom="m-qty" ' + (p.stock <= 0 ? 'disabled' : '') + '>🛒 Add to Cart</button>' +
            '<button class="btn btn-buy" data-action="buy-now" data-id="' + p.id + '" data-qtyfrom="m-qty" ' + (p.stock <= 0 ? 'disabled' : '') + '>⚡ Buy Now</button>' +
            '<button class="btn btn-store" data-action="add-to-store" data-id="' + p.id + '">🏪 Add to My Store</button></div>'
            : '<p class="hint">You are browsing as an administrator. Customer shopping controls are hidden.</p>') +
            '<details class="product-facts"><summary>Product and source details</summary><dl>' + facts.map(function (f) { return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>'; }).join('') + '</dl>' +
            '<p>' + sourceNote + ' Stock is MarketZone local operational inventory, not live retailer availability.</p><a href="#/catalog-sources">Full catalog sources and image credits</a></details>' +
        '</div></div></div>';
    document.body.style.overflow = 'hidden';
    bindProductGallery();
}
function bindProductGallery() {
    var stage = document.getElementById('gallery-stage');
    if (!stage) return;
    Array.prototype.forEach.call(stage.querySelectorAll('.gallery-slide img'), function (img) {
        function loaded() { img.parentNode.classList.add('is-loaded'); }
        function failed() {
            img.parentNode.classList.add('is-error');
            img.alt = 'Product image unavailable';
            img.src = FALLBACK_IMG;
            var status = img.parentNode.querySelector('.gallery-status');
            if (status) status.textContent = 'Image unavailable';
        }
        img.addEventListener('load', loaded);
        img.addEventListener('error', failed, { once: true });
        if (img.complete) { if (img.naturalWidth) loaded(); else failed(); }
    });
    var startX = 0, startY = 0, tracking = false;
    stage.addEventListener('pointerdown', function (e) {
        if (galleryState.zoom || e.target.closest('button')) return;
        startX = e.clientX; startY = e.clientY; tracking = true;
        stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointerup', function (e) {
        if (!tracking) return;
        tracking = false;
        var dx = e.clientX - startX, dy = e.clientY - startY;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) moveGallery(dx < 0 ? 1 : -1);
    });
    stage.addEventListener('pointercancel', function () { tracking = false; });
}
function updateGallery() {
    var p = Products.byId(galleryState.id);
    if (!p) return;
    var count = (p.images && p.images.length) || 1;
    galleryState.index = (galleryState.index + count) % count;
    var track = document.getElementById('gallery-track');
    if (track) track.style.transform = 'translateX(-' + (galleryState.index * 100) + '%)';
    var counter = document.getElementById('gallery-count');
    if (counter) counter.textContent = (galleryState.index + 1) + ' / ' + count;
    Array.prototype.forEach.call(document.querySelectorAll('.gallery-thumb'), function (b, i) {
        b.classList.toggle('active', i === galleryState.index);
        b.setAttribute('aria-selected', i === galleryState.index ? 'true' : 'false');
    });
}
function moveGallery(delta) {
    galleryState.index += delta;
    updateGallery();
}
function closeModal() {
    document.getElementById('modal-root').innerHTML = '';
    document.body.style.overflow = '';
}
function modalQty(delta) {
    var el = document.getElementById('m-qty');
    if (el) el.textContent = Math.max(1, parseInt(el.textContent, 10) + delta);
}

/* ---------- cart ---------- */
function cartItemsDetailed() {
    return cart().map(function (i) {
        var p = Products.byId(i.id);
        return { id: i.id, name: p ? p.name : i.name, price: p ? p.price : i.price, mrp: p ? p.mrp : (i.mrp || i.price), qty: i.qty, commissionRate: i.commissionRate, image: p ? p.image : (i.image || FALLBACK_IMG), stock: p ? p.stock : 0 };
    });
}
function vCart() {
    var items = cartItemsDetailed();
    var subtotal = items.reduce(function (s, i) { return s + i.price * i.qty; }, 0);
    var original = items.reduce(function (s, i) { return s + i.mrp * i.qty; }, 0);
    var shipping = items.length ? (subtotal >= FREE_SHIP_OVER ? 0 : SHIP_FEE) : 0;
    var need = Math.max(0, FREE_SHIP_OVER - subtotal);
    var rows = items.map(function (i, idx) {
        return '<div class="crow">' + imgTag(i, 'cthumb') +
            '<div class="cinfo"><b>' + esc(i.name) + '</b><span class="cart-unit-price">' + money(i.price) + ' <s>' + money(i.mrp) + '</s><em>' + pctOff(i) + '% OFF</em></span>' +
            '<span class="' + (i.stock < 10 ? 'pstock low' : 'pstock in') + '">' + (i.stock < 10 ? 'Only ' + i.stock + ' left!' : 'In stock') + '</span></div>' +
            '<div class="qty"><button data-action="cart-dec" data-idx="' + idx + '">−</button><span>' + i.qty + '</span><button data-action="cart-inc" data-idx="' + idx + '">+</button></div>' +
            '<div class="cprice">' + money(i.price * i.qty) + '<br><small>' + money(i.price) + ' each</small></div>' +
            '<button class="btn btn-link" data-action="cart-remove" data-idx="' + idx + '">Delete</button></div>';
    }).join('');
    var summary = items.length ? '<div class="card sum"><h3>Order Summary</h3>' +
        '<div class="srow"><span>Original price</span><b>' + money(original) + '</b></div>' +
        '<div class="srow savings-row"><span>Discount savings</span><b>−' + money(original - subtotal) + '</b></div>' +
        '<div class="srow"><span>Subtotal (' + cartCount() + ' items)</span><b>' + money(subtotal) + '</b></div>' +
        '<div class="srow"><span>Shipping</span><b>' + (shipping === 0 ? '<span class="free">FREE</span>' : money(shipping)) + '</b></div>' +
        '<div class="srow total"><span>Total</span><b>' + money(subtotal + shipping) + '</b></div>' +
        (need > 0 ? '<div class="shipbar"><div class="shipbar-fill" style="width:' + Math.min(100, subtotal / FREE_SHIP_OVER * 100) + '%"></div></div><small>Add ' + money(need) + ' more for FREE delivery</small>' : '<small class="free">✔ You unlocked FREE delivery!</small>') +
        '<a class="btn btn-gold btn-block" href="#/checkout">Proceed to Checkout →</a></div>' : '';
    return '<h1 class="page-title">🛒 Shopping Cart <small>' + cartCount() + ' item' + (cartCount() === 1 ? '' : 's') + '</small></h1>' +
        (items.length
            ? '<div class="cart-layout"><div class="card">' + rows + '</div>' + summary + '</div>'
            : '<div class="card"><div class="empty">Your cart is empty.<br><br><a class="btn btn-cart" href="#/shop">Continue Shopping →</a></div></div>');
}

/* ---------- checkout ---------- */
function vCheckout() {
    var u = sessionUser();
    if (!u) { go('login'); return ''; }
    var items = cartItemsDetailed();
    if (!items.length) return '<div class="card"><div class="empty">Cart is empty. <a href="#/shop" style="color:#c45500;font-weight:700">Go shopping</a></div></div>';
    var subtotal = items.reduce(function (s, i) { return s + i.price * i.qty; }, 0);
    var original = items.reduce(function (s, i) { return s + i.mrp * i.qty; }, 0);
    var shipping = subtotal >= FREE_SHIP_OVER ? 0 : SHIP_FEE;
    return '<h1 class="page-title">📦 Checkout</h1><div class="cart-layout">' +
    '<div class="card"><h3 style="margin-top:0">Shipping Address</h3><form data-form="checkout">' +
        '<div class="frow"><div class="field"><label>Full Name</label><input name="name" value="' + esc(u.name) + '" required></div>' +
        '<div class="field"><label>📞 Phone Number</label><input name="phone" type="tel" placeholder="Enter your phone number" required></div></div>' +
        '<div class="field"><label>Street Address</label><input name="address" placeholder="House, street, area" required></div>' +
        '<div class="frow"><div class="field"><label>City</label><input name="city" placeholder="City" required></div>' +
        '<div class="field"><label>Payment Method</label><select name="payment" required><option value="Wallet Balance">Wallet Balance</option><option value="COD">Cash on Delivery</option></select></div></div>' +
        '<div class="field"><label>Delivery Country</label><select name="country" required>' + worldCountryOptions('United States') + '</select></div>' +
        '<div class="hint" style="margin:8px 0">Card and online gateway payments are not configured. Manual assistance is available for unsupported delivery countries.</div>' +
        '<button class="btn btn-soft" type="button" data-action="assistance-open">Contact Administrator</button>' +
        '<div class="srow"><span>💼 Your Wallet Balance</span><b>' + money(Wallets.get(u.id)) + '</b></div>' +
        (Wallets.get(u.id) >= subtotal + shipping
            ? '<div class="free" style="margin:6px 0">✔ Sufficient balance — you can place this order.</div>'
            : '<div style="color:#b12704;font-weight:700;margin:6px 0">⚠ Insufficient wallet balance — you need ' + money(subtotal + shipping - Wallets.get(u.id)) + ' more. Please top up your wallet (contact admin).</div>') +
        '<h3>Items (' + cartCount() + ')</h3>' +
        items.map(function (i) { return '<div class="srow"><span>' + i.qty + ' × ' + esc(i.name) + '</span><b>' + money(i.price * i.qty) + '</b></div>'; }).join('') +
        '<div class="srow savings-row"><span>Discount savings</span><b>−' + money(original - subtotal) + '</b></div>' +
        '<div class="srow"><span>Shipping</span><b>' + (shipping === 0 ? '<span class="free">FREE</span>' : money(shipping)) + '</b></div>' +
        '<div class="srow total"><span>Order Total</span><b>' + money(subtotal + shipping) + '</b></div>' +
        '<button class="btn btn-gold btn-block">✔ Place your order — ' + money(subtotal + shipping) + '</button></form></div>' +
    '<div class="card sum"><h3>Order Summary</h3>' +
        '<div class="srow"><span>Items</span><b>' + money(subtotal) + '</b></div>' +
        '<div class="srow"><span>Shipping</span><b>' + (shipping === 0 ? 'FREE' : money(shipping)) + '</b></div>' +
        '<div class="srow total"><span>Total</span><b>' + money(subtotal + shipping) + '</b></div>' +
        '<small style="color:#565959">Wallet payment is charged only after server confirmation. COD payment is due on delivery. Cancellations restore stock and refund eligible wallet payments.</small></div>' +
    '</div>';
}

/* ---------- orders ---------- */
function vOrders() {
    var u = sessionUser();
    var st = customerStats(u.id);
    var orders = st.orders;
    var summary = '<div class="grid stats" style="margin-bottom:22px">' +
        customerStatCard('Total Orders', numFmt(st.totalOrders), '#10233f') +
        customerStatCard('Completed Orders', numFmt(st.completedOrders), '#067d62') +
        customerStatCard('Total Order Value', money(st.totalOrderValue), '#0e7490') +
        customerStatCard('Current Wallet Balance', money(st.walletBalance), '#1458a6') + '</div>';
    var cards = orders.map(function (o) {
        var items = o.items.map(function (i) { return i.qty + ' × ' + i.name; }).join('<br>');
        return '<div class="ocard card"><div class="ohead"><div><b>Order #' + o.id + '</b><div class="hint">' + fmtDateTime(o.createdAt) + '</div></div>' + statusBadge(o.status) + '</div>' +
            '<div class="obody"><div>' + items + (o.phone ? '<div class="hint" style="margin-top:6px">📞 Contact: <b>' + esc(o.phone) + '</b></div>' : '') + '</div><div class="ototal"><div>Total: <b>' + money(o.total) + '</b></div></div></div>' +
            (o.manual ? '<div class="hint" style="margin-top:8px">Manual order · Managed with your seller order</div>' : '') +
            (o.status === 'Pending' && !o.manual ? '<div class="ofoot"><button class="btn btn-link" data-action="cancel-order" data-id="' + o.id + '">Cancel order</button></div>' : '') +
            '</div>';
    }).join('');
    return '<h1 class="page-title">📦 Your Orders</h1>' + summary + (orders.length
        ? cards
        : '<div class="card"><div class="empty">No orders yet. <a href="#/shop" style="color:#c45500;font-weight:700">Start shopping →</a></div></div>');
}

/* ---------- wallet ---------- */
function vWallet() {
    var u = sessionUser();
    var bal = Wallets.get(u.id);
    var txs = Txs.byUser(u.id).slice(0, 50);
    var deposits = Deposits.byUser(u.id);
    var st = customerStats(u.id);
    var txRows = txs.map(function (t) {
        var pos = t.amount >= 0;
        return '<tr><td>' + fmtDateTime(t.createdAt) + '</td><td><span class="badge ' + (pos ? 'badge-green' : 'badge-red') + '">' + t.type + '</span></td>' +
            '<td style="font-weight:700;color:' + (pos ? '#067d62' : '#b12704') + '">' + (pos ? '+' : '') + money(t.amount) + '</td><td>' + esc(t.note) + '</td></tr>';
    }).join('');
    return '<h1 class="page-title">💼 My Wallet</h1>' +
        '<div class="wallet-hero">' +
        '<div><div class="lbl">💼 Wallet Balance</div><div class="big-balance">' + money(bal) + '</div></div>' +
        '</div>' +
        '<div class="grid stats" style="margin-bottom:22px">' +
        customerStatCard('Total Deposits', money(st.walletTopups), '#1458a6') +
        customerStatCard('Cashback Received', money(st.cashbackEarned), '#067d62') +
        customerStatCard('Refunds Received', money(st.refundEarned), '#b8860b') +
        customerStatCard('Total Spent on Orders', money(st.purchaseTotal), '#10233f') + '</div>' +
        '<div class="dw-grid" style="margin-bottom:22px">' +
        '<div class="card" id="mz-deposit-card" style="border:1px solid #d6b45a"><h3 style="margin-top:0">💰 Request a Deposit</h3>' +
        '<form data-form="deposit"><div class="field"><label>Deposit Amount (USD $)</label><input name="amount" type="number" min="1" max="1000000" step="0.01" placeholder="Enter amount in dollars" required></div>' +
        '<div class="field"><label>Payment Reference <small>(optional)</small></label><input name="reference" maxlength="100" placeholder="Transaction or receipt reference"></div>' +
        '<button class="btn btn-gold" type="submit">Submit Deposit Request</button>' +
        '<small class="hint" style="display:block;margin-top:8px">Your request is saved for admin review. Funds are added only after approval; no payment is charged by this form.</small></form></div>' +
        (u.withdrawHold
        ? '<div class="card" id="mz-withdraw-card" style="border:2px solid #b12704"><h3 style="margin-top:0">💸 Withdraw — USDT (TRC20)</h3>' +
            '<div class="empty" style="color:#b12704;font-weight:700">🧊 Your withdrawals are currently <b>FROZEN</b> by the admin. You cannot request withdrawals right now. Please contact support.</div></div>'
        : '<div class="card" id="mz-withdraw-card"><h3 style="margin-top:0">💸 Withdraw — USDT (TRC20)</h3>' +
        '<form data-form="withdraw">' +
        '<div class="frow"><div class="field"><label>Amount (USDT / $)</label><input name="amount" type="number" step="0.01" min="1" max="' + bal + '" required></div>' +
        '<div class="field"><label>Your USDT TRC20 Address</label><input name="trc20" placeholder="T..." minlength="34" maxlength="34" required></div></div>' +
        '<button class="btn btn-gold" ' + (bal <= 0 ? 'disabled' : '') + '>Request USDT Withdrawal</button>' +
        '<small class="hint" style="display:block;margin-top:8px">Available: <b>' + money(bal) + '</b> · Min $1 · Admin approves & sends USDT to your TRC20 address.</small></form></div>') + '</div>' +
        (function () {
            var wds = Withdrawals.all().filter(function (w) { return w.userId === u.id; }).sort(function (a, b) { return b.id - a.id; });
            if (!wds.length) return '';
            return '<div class="card" style="margin-bottom:22px"><h3 style="margin-top:0">💸 My Withdrawal Requests</h3><table><thead><tr><th>Date</th><th>Amount</th><th>TRC20 Address</th><th>Status</th></tr></thead><tbody>' +
                wds.map(function (w) {
                    var col = w.status === 'Completed' ? '#067d62' : (w.status === 'Rejected' ? '#b12704' : '#b8860b');
                    return '<tr><td>' + fmtDateTime(w.createdAt) + '</td><td style="font-weight:700;color:#b12704">-' + money(w.amount) + '</td><td><code class="addr">' + esc(w.address) + '</code></td><td><span class="badge" style="background:' + col + '">' + w.status + '</span></td></tr>';
                }).join('') + '</tbody></table></div>';
        })() +
        (deposits.length ? '<div class="card" style="margin-bottom:22px"><h3 style="margin-top:0">💰 My Deposit Requests</h3><div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Amount</th><th>Reference</th><th>Status</th></tr></thead><tbody>' +
            deposits.map(function (d) {
                return '<tr><td>' + fmtDateTime(d.createdAt) + '</td><td><b>' + money(d.amount) + '</b></td><td>' + esc(d.reference || '—') + '</td><td>' + statusBadge(d.status) + '</td></tr>';
            }).join('') + '</tbody></table></div></div>' : '') +
        '<div class="card" id="tx-history"><h3 style="margin-top:0">Transaction History</h3>' + (txRows
            ? '<table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Note</th></tr></thead><tbody>' + txRows + '</tbody></table>'
            : '<div class="empty">No transactions yet.</div>') + '</div>';
}

/* ---------- customer: my store ---------- */
/* ================= SELLER ORDER ASSIGNMENT SYSTEM (v25) ================= */
function sellerOrderCustomerStatus(status) {
    if (status === 'Completed') return 'Completed';
    if (status === 'Cancelled' || status === 'Rejected') return 'Cancelled';
    if (status === 'Awaiting Acceptance') return 'Pending';
    return 'Processing';
}
function syncSellerOrderToCustomer(o) {
    if (!o || !o.customerOrderId) return;
    var status = sellerOrderCustomerStatus(o.status);
    Orders.update(o.customerOrderId, {
        status: status,
        completedAt: status === 'Completed' ? (o.completedAt || nowISO()) : ''
    });
}

var SellerOrders = {
    all: function () { return dbGet('mz_seller_orders', []); },
    save: function (l) { dbSet('mz_seller_orders', l); },
    add: function (o) { var l = SellerOrders.all(); l.push(o); SellerOrders.save(l); },
    update: function (id, patch) { var l = SellerOrders.all(); var o = l.find(function (x) { return x.id === id; }); if (o) { Object.assign(o, patch); SellerOrders.save(l); syncSellerOrderToCustomer(o); } return o; },
    byId: function (id) { return SellerOrders.all().find(function (x) { return x.id === id; }); },
    forSeller: function (uid) { return SellerOrders.all().filter(function (x) { return x.sellerId === uid; }); },
    forStore: function (storeId, uid) {
        return SellerOrders.all().filter(function (x) {
            return Number(x.storeId) === Number(storeId) && (!uid || Number(x.sellerId) === Number(uid));
        });
    },
    pushHistory: function (id, status, message, by) {
        var o = SellerOrders.byId(id); if (!o) return;
        o.history = o.history || [];
        o.history.push({ status: status, message: message || '', at: nowISO(), by: by || 'system' });
        SellerOrders.update(id, { history: o.history });
    },
    /* dashboard statistics — all values DERIVED from actual order records (no stored totals, no duplicates) */
    stats: function (uid, storeId) {
        var os = storeId ? SellerOrders.forStore(storeId, uid) : SellerOrders.forSeller(uid);
        function sum(l) { return Math.round(l.reduce(function (t, o) { return t + (Number(o.profit) || 0); }, 0) * 100) / 100; }
        var completed = os.filter(function (o) { return o.status === 'Completed'; });
        var dead = { 'Rejected': 1, 'Cancelled': 1 };
        return {
            total: os.length,
            accepted: os.filter(function (o) { return o.status !== 'Awaiting Acceptance' && !dead[o.status]; }).length,
            pending: os.filter(function (o) { return o.status === 'Awaiting Acceptance' || (!dead[o.status] && o.status !== 'Completed'); }).length,
            completed: completed.length,
            cancelled: os.filter(function (o) { return dead[o.status]; }).length,
            earned: sum(completed),
            pendingProfit: sum(completed.filter(function (o) { return !o.profitCredited; })),
            creditedProfit: sum(os.filter(function (o) { return o.profitCredited; })),
            paidProfit: sum(os.filter(function (o) { return o.profitStatus === 'Paid'; }))
        };
    }
};
function canAccessSellerOrder(u, o) {
    if (!u || !o || u.status === 'banned') return false;
    if (u.role === 'admin') return true;
    if (u.role !== 'customer' || Number(o.sellerId) !== Number(u.id)) return false;
    var s = Stores.byUser(u.id);
    return !!(s && s.status === 'approved' && Number(s.id) === Number(o.storeId));
}
function soBadge(st) {
    var m = { 'Awaiting Acceptance': 'badge-gold', 'Accepted': 'badge-blue', 'Purchasing': 'badge-blue', 'Processing': 'badge-blue', 'Ready for Shipping': 'badge-blue', 'Shipped': 'badge-blue', 'Out for Delivery': 'badge-blue', 'Delivered': 'badge-gold', 'Completed': 'badge-green', 'Rejected': 'badge-red', 'Cancelled': 'badge-red' };
    return '<span class="badge ' + (m[st] || 'badge-blue') + '">' + esc(st) + '</span>';
}
function soTimeline(o) {
    var h = (o.history || []).slice().reverse();
    return '<div class="so-timeline">' + (h.length ? h.map(function (x) {
        return '<div class="so-tl-item"><span class="so-tl-dot"></span><div style="flex:1"><b>' + esc(x.status) + '</b>' +
            (x.message ? '<div class="hint">' + esc(x.message) + '</div>' : '') +
            '<div class="hint">' + fmtDateTime(x.at) + ' · by ' + (x.by === 'admin' ? 'Admin' : x.by === 'seller' ? 'Seller' : 'System') + '</div></div></div>';
    }).join('') : '<div class="hint">No updates yet.</div>') + '</div>';
}
/* ---------- balance hold / profit credit / refund (financial core) ---------- */
/* ---------- admin: assign orders to approved stores + manage statuses ---------- */
function eligibleStoreProducts(s) {
    if (!s) return [];
    var ids = (s.productIds || []).map(Number);
    return Products.all().filter(function (p) { return Number(p.storeId) === Number(s.id) && ids.indexOf(Number(p.id)) >= 0; });
}
function assignmentProductOptions(storeId) {
    var s = Stores.byId(Number(storeId));
    var prods = eligibleStoreProducts(s);
    return prods.length ? prods.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + ' · #' + p.id + ' · ' + p.stock + ' in stock</option>'; }).join('') : '<option value="">No eligible Store products</option>';
}
function updateAssignmentStore(select) {
    var f = select && select.closest('form[data-form="assign-order"]'); if (!f) return;
    var s = Stores.byId(Number(select.value));
    var prods = eligibleStoreProducts(s);
    f.productId.innerHTML = assignmentProductOptions(select.value);
    f.productId.disabled = !prods.length;
    var submit = f.querySelector('button[type="submit"]'); if (submit) submit.disabled = !prods.length;
    var summary = document.getElementById('assignment-store-summary');
    if (summary) summary.innerHTML = s ? '<b>' + esc(s.storeName) + '</b>: ' + prods.length + ' eligible product' + (prods.length === 1 ? '' : 's') + ' · Owner wallet <b>' + money(Wallets.get(s.userId)) + '</b>. Only products added by this Store owner through “Add to My Store” can be assigned.' : '';
}
function vAdminSellerOrders() {
    var stores = Stores.all().filter(function (s) { return s.status === 'approved'; });
    var os = SellerOrders.all().slice().sort(function (a, b) { return b.id - a.id; });
    var st = { total: os.length, awaiting: 0, completed: 0, cancelled: 0, earned: 0, paid: 0, pendingFunds: 0 };
    os.forEach(function (o) {
        if (o.status === 'Awaiting Acceptance') { st.awaiting++; st.pendingFunds += Number(o.amount) || 0; }
        if (o.status === 'Completed') { st.completed++; st.earned += Number(o.profit) || 0; if (o.profitStatus === 'Paid') st.paid += Number(o.profit) || 0; }
        if (o.status === 'Cancelled' || o.status === 'Rejected') st.cancelled++;
    });
    st.earned = Math.round(st.earned * 100) / 100; st.paid = Math.round(st.paid * 100) / 100; st.pendingFunds = Math.round(st.pendingFunds * 100) / 100;
    function stat(lbl, num, color) { return '<div class="stat"><div class="lbl">' + lbl + '</div><div class="num" style="color:' + color + '">' + num + '</div></div>'; }
    var firstEligible = stores.length ? eligibleStoreProducts(stores[0]) : [];
    var assignForm = '<div class="card" style="margin-bottom:18px"><h3 style="margin-top:0">📤 Create Manual Order</h3>' +
        '<p class="manual-order-note">Select an approved Store and one of its own eligible products. Enter the exact funds required from the Store owner and the expected profit. Both remain editable until acceptance.</p>' +
        (stores.length
        ? '<form data-form="assign-order" class="admin-form manual-order-grid">' +
          '<div><label>Approved Store / Customer *</label><select name="storeId" required>' + stores.map(function (s) { return '<option value="' + s.id + '">' + esc(s.storeName) + ' — ' + esc(s.userName || '') + ' · ' + eligibleStoreProducts(s).length + ' eligible</option>'; }).join('') + '</select></div>' +
          '<div><label>Eligible Store Product *</label><select name="productId" required ' + (firstEligible.length ? '' : 'disabled') + '>' + assignmentProductOptions(stores[0].id) + '</select></div>' +
          '<div id="assignment-store-summary" class="manual-order-note"><b>' + esc(stores[0].storeName) + '</b>: ' + firstEligible.length + ' eligible products · Owner wallet <b>' + money(Wallets.get(stores[0].userId)) + '</b>.</div>' +
          '<div><label>Quantity *</label><input name="quantity" type="number" step="1" min="1" max="100" value="1" required></div>' +
          '<div><label>Required Order Amount ($) *</label><input name="amount" type="number" step="0.01" min="0.01" max="1000000" placeholder="e.g. 280.00" required></div>' +
          '<div><label>Expected Store Profit ($) *</label><input name="profit" type="number" step="0.01" min="0" max="1000000" placeholder="e.g. 40.00" required></div>' +
          '<div><label>Estimated Completion *</label><select name="eta"><option>24 hours</option><option>48 hours</option><option>2 days</option><option>3 days</option></select></div>' +
          '<div class="manual-order-instructions"><label>Instructions / Custom Message</label><input name="instructions" placeholder="e.g. Deliver within 5 days, packing instructions..."></div>' +
          '<div class="manual-order-actions"><button class="btn btn-gold" type="submit" ' + (firstEligible.length ? '' : 'disabled') + '>Send Manual Order</button></div>' +
          '<div id="assign-order-feedback" class="form-feedback" role="status" aria-live="polite"></div></form>'
        : '<div class="empty" style="padding:16px">No approved stores are available. Approve a store before creating a manual order.</div>') + '</div>';
    var rows = os.map(function (o) {
        var store = Stores.byId(o.storeId);
        var prod = o.productImage ? '<img src="' + esc(o.productImage) + '" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid #eee">' : '';
        var finalState = ['Completed', 'Cancelled', 'Rejected'].indexOf(o.status) >= 0;
        var awaiting = o.status === 'Awaiting Acceptance';
        var statuses = awaiting ? ['Cancelled'] : ['Purchasing', 'Preparing for Shipping', 'Processing', 'Ready for Shipping', 'Shipped', 'Out for Delivery', 'Delivered', 'Completed', 'Cancelled'];
        if (statuses.indexOf(o.status) < 0 && !finalState) statuses.unshift(o.status);
        var manage = finalState ? '<span class="hint">Final financial state.</span>' :
            '<form data-form="so-status-change" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
            '<input type="hidden" name="id" value="' + o.id + '"><select name="status">' + statuses.map(function (s2) { return '<option' + (o.status === s2 ? ' selected' : '') + '>' + s2 + '</option>'; }).join('') + '</select>' +
            '<input name="message" placeholder="Status message (optional)" style="width:170px"><button class="btn btn-sm btn-primary">Update</button></form>';
        if (awaiting) manage = '<form data-form="so-terms-save" class="manual-order-note" style="display:flex;gap:6px;flex-wrap:wrap;align-items:end"><input type="hidden" name="id" value="' + o.id + '">' +
            '<label>Amount $<input name="amount" type="number" min="0.01" max="1000000" step="0.01" value="' + Number(o.amount).toFixed(2) + '" required style="width:110px"></label>' +
            '<label>Profit $<input name="profit" type="number" min="0" max="1000000" step="0.01" value="' + Number(o.profit).toFixed(2) + '" required style="width:100px"></label><button class="btn btn-sm btn-gold">Save terms</button></form>' + manage;
        if (o.status === 'Completed' && o.profitStatus !== 'Paid') manage += ' <button class="btn btn-sm btn-gold" data-action="so-profit-paid" data-id="' + o.id + '" style="margin-top:6px">💰 Mark Profit Paid</button>';
        return '<tr><td><b>ORD-' + o.id + '</b><div class="hint">' + fmtDateTime(o.assignedAt) + '</div></td>' +
            '<td><b>' + esc(o.storeName) + '</b><div class="hint">Wallet ' + money(Wallets.get(o.sellerId)) + ' · ' + eligibleStoreProducts(store).length + ' eligible products</div></td>' +
            '<td>' + prod + ' ' + esc(o.productName) + '<div class="hint">Store product #' + o.productId + ' · Qty ' + o.quantity + '</div>' + (o.instructions ? '<div class="hint">📝 ' + esc(o.instructions) + '</div>' : '') + '</td>' +
            '<td>' + esc(o.eta || '—') + '</td>' +
            '<td><b>Required ' + money(o.amount) + '</b><div class="hint">Deducted ' + money(o.deducted || 0) + '</div><div class="hint">Returned ' + money(o.returned || 0) + '</div>' + (o.balanceAfterCompletion != null ? '<div class="hint">Final wallet ' + money(o.balanceAfterCompletion) + '</div>' : '') + '</td>' +
            '<td>' + money(o.profit) + '<div class="hint">' + (o.profitStatus === 'Paid' ? '✅ Paid' : o.profitCredited ? '✅ Credited to wallet' : 'Expected at admin completion') + '</div></td>' +
            '<td>' + soBadge(o.status) + '<div class="hint">' + (o.acceptedAt ? 'Accepted ' + fmtDateTime(o.acceptedAt) : 'Awaiting Store acceptance') + '</div>' + (o.completedAt ? '<div class="hint">Final ' + fmtDateTime(o.completedAt) + '</div>' : '') + '</td>' +
            '<td><button class="btn btn-sm btn-soft" data-action="notif-view-so" data-id="' + o.id + '">👁 View</button></td><td>' + manage + '</td></tr>';
    }).join('');
    return '<div class="grid stats" style="margin-bottom:18px">' +
        stat('📤 Total Assigned', st.total, '#10233f') + stat('⏳ Awaiting Acceptance', st.awaiting, '#b8860b') +
        stat('✅ Completed', st.completed, '#067d62') + stat('✖ Cancelled/Rejected', st.cancelled, '#b12704') +
        stat('💰 Seller Profit (Completed)', money(st.earned), '#067d62') + stat('💼 Awaiting Required Funds', money(st.pendingFunds), '#b8860b') +
        stat('💸 Profit Marked Paid', money(st.paid), '#1458a6') + '</div>' + assignForm +
        '<div class="card"><h3 style="margin-top:0">📋 Assigned Seller Orders (' + os.length + ')</h3>' +
        (rows ? '<div style="overflow-x:auto"><table><thead><tr><th>Order</th><th>Store / Wallet</th><th>Eligible Product</th><th>ETA</th><th>Financial State</th><th>Store Profit</th><th>Shipping State</th><th>View</th><th>Manage</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty" style="padding:16px">No orders have been assigned yet.</div>') + '</div>';
}


/* ---------- unified, store-scoped merchant workspace ---------- */
function storeIcon(name) {
    var paths = {
        store: '<path d="M4 10v10h16V10M3 4h18l-2 6a3 3 0 0 1-5 1 3 3 0 0 1-4 0 3 3 0 0 1-5-1Z"/><path d="M9 20v-5h6v5"/>',
        check: '<path d="m5 12 4 4L19 6"/><circle cx="12" cy="12" r="10"/>',
        orders: '<path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4"/>',
        box: '<path d="m4 7 8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7M12 11v10"/>',
        arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        shield: '<path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
        wallet: '<path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3h12"/><path d="M15 11h5v4h-5a2 2 0 0 1 0-4Z"/>',
        tag: '<path d="m3 12 9 9 9-9-9-9H3v9Z"/><circle cx="8" cy="8" r="1"/>'
    };
    return '<svg class="store-icon" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.store) + '</svg>';
}
function storeOrderGroups(s) {
    var groups = [];
    Orders.all().forEach(function (o) {
        if (o.manual) return;
        var items = (o.items || []).filter(function (it) { return Number(orderItemStoreId(it)) === Number(s.id); });
        if (!items.length) return;
        var buyer = Users.byId(o.userId) || {};
        var total = items.reduce(function (sum, it) { return sum + (Number(it.price) || 0) * (Number(it.qty) || 0); }, 0);
        groups.push({ order: o, items: items, buyerName: buyer.name || ('Customer #' + o.userId), total: Math.round(total * 100) / 100 });
    });
    return groups.sort(function (a, b) { return b.order.id - a.order.id; });
}
function storeDashboardStats(s, u) {
    var assigned = SellerOrders.forStore(s.id, u.id), purchases = storeOrderGroups(s);
    var assignedActive = assigned.filter(function (o) { return ['Completed', 'Cancelled', 'Rejected'].indexOf(o.status) === -1 && o.status !== 'Awaiting Acceptance'; }).length;
    var purchaseActive = purchases.filter(function (x) { return ['Completed', 'Cancelled'].indexOf(x.order.status) === -1; }).length;
    var completedSales = purchases.filter(function (x) { return x.order.status === 'Completed'; }).reduce(function (sum, x) { return sum + x.total; }, 0);
    var assignedStats = SellerOrders.stats(u.id, s.id);
    return {
        assigned: assigned, purchases: purchases,
        total: assigned.length + purchases.length,
        awaiting: assigned.filter(function (o) { return o.status === 'Awaiting Acceptance'; }).length,
        active: assignedActive + purchaseActive,
        completed: assigned.filter(function (o) { return o.status === 'Completed'; }).length + purchases.filter(function (x) { return x.order.status === 'Completed'; }).length,
        cancelled: assigned.filter(function (o) { return o.status === 'Cancelled' || o.status === 'Rejected'; }).length + purchases.filter(function (x) { return x.order.status === 'Cancelled'; }).length,
        completedSales: Math.round(completedSales * 100) / 100,
        profit: assignedStats.creditedProfit,
        products: storeProductsFor(s).length
    };
}
function storeMetric(label, value, note, tone) {
    return '<div class="store-metric' + (tone ? ' ' + tone : '') + '"><span>' + esc(label) + '</span><strong>' + value + '</strong><small>' + esc(note) + '</small></div>';
}
function storeWorkspaceNav() {
    return '<nav class="store-workspace-nav" aria-label="Store dashboard sections">' +
        '<button data-action="store-scroll" data-target="store-overview" class="active">Overview</button>' +
        '<button data-action="store-scroll" data-target="store-assigned">Assigned orders</button>' +
        '<button data-action="store-scroll" data-target="store-orders">Customer orders</button>' +
        '<button data-action="store-scroll" data-target="store-profit">Profit &amp; records</button>' +
        '<button data-action="store-scroll" data-target="store-products">Products</button>' +
        '<button data-action="store-scroll" data-target="store-details">Store details</button></nav>';
}
function storeApprovalHero(s, st) {
    var progress = st.total ? Math.round(st.completed / st.total * 100) : 0;
    return '<section class="store-hero" aria-labelledby="store-workspace-title">' +
        '<div class="store-hero-main"><div class="store-kicker">' + storeIcon('store') + ' Merchant workspace</div>' +
        '<div class="store-title-row"><span class="store-monogram" aria-hidden="true">' + esc((s.storeName || 'S').charAt(0).toUpperCase()) + '</span>' +
        '<div><h1 id="store-workspace-title">' + esc(s.storeName) + '</h1><p>' + esc(s.category || 'Store seller') + ' <span>·</span> Store MZ-' + s.id + '</p></div></div>' +
        '<p class="store-description">' + esc(s.description || 'Your approved MarketZone merchant store.') + '</p>' +
        '<div class="store-hero-actions"><button class="store-primary" data-action="store-scroll" data-target="store-assigned">Review store orders ' + storeIcon('arrow') + '</button>' +
        '<a class="store-secondary" href="#/shop">Add products</a></div></div>' +
        '<aside class="store-approval" aria-label="Store approval and order pipeline"><div class="store-live-pill"><span class="store-live-dot"></span> Approved &amp; active</div>' +
        '<div class="store-approved-mark">' + storeIcon('check') + '</div><h2>Your store is verified.</h2>' +
        '<p>Approved ' + fmtDateTime(s.reviewedAt || s.createdAt) + '. You can receive orders and manage your catalog.</p>' +
        '<div class="store-pipeline"><div><span>Order pipeline</span><b>' + st.completed + ' of ' + st.total + ' completed</b></div>' +
        '<div class="store-progress" role="progressbar" aria-label="Completed store orders" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + progress + '"><span style="width:' + progress + '%"></span></div>' +
        '<small>' + (st.total ? progress + '% of all linked orders completed' : 'Your live pipeline starts with the first order') + '</small></div></aside></section>';
}
function assignedStoreOrdersHtml(s, u) {
    var myOrders = SellerOrders.forStore(s.id, u.id).sort(function (a, b) { return b.id - a.id; });
    var awaitingCount = myOrders.filter(function (o) { return o.status === 'Awaiting Acceptance'; }).length;
    var orderCards = myOrders.map(function (o) {
        var awaiting = o.status === 'Awaiting Acceptance';
        var orderTxs = Txs.byUser(u.id).filter(function (t) { return Number(t.orderId) === Number(o.customerOrderId); });
        var txHtml = orderTxs.length ? '<ul class="store-item-list">' + orderTxs.map(function (t) { return '<li><span>' + esc(t.type.replace(/_/g, ' ')) + ' · ' + fmtDateTime(t.createdAt) + '</span><b>' + (t.amount >= 0 ? '+' : '−') + money(Math.abs(t.amount)) + '</b></li>'; }).join('') + '</ul>' : '<p class="hint">No wallet transactions for this order yet.</p>';
        return '<article class="store-order-row' + (awaiting ? ' needs-action' : '') + '" data-store-order-id="' + o.id + '">' +
            '<button class="store-order-open" data-action="notif-view-so" data-id="' + o.id + '" aria-label="View assigned order ORD-' + o.id + '">' +
            (o.productImage ? '<img src="' + esc(o.productImage) + '" alt="' + esc(o.productName) + '">' : '') +
            '<span class="store-order-heading"><small>ADMIN ASSIGNMENT · ORD-' + o.id + '</small><b>' + esc(o.productName) + '</b><span>Received ' + fmtDateTime(o.assignedAt) + '</span></span>' +
            '<span class="store-order-state">' + soBadge(o.status) + '<small>' + (awaiting ? 'Acceptance required' : 'Managed by administrator') + '</small></span></button>' +
            '<dl class="store-order-facts"><div><dt>Required order amount</dt><dd>' + money(o.amount) + '</dd><small>Admin-defined</small></div>' +
            '<div><dt>Available wallet</dt><dd>' + money(Wallets.get(u.id)) + '</dd><small>' + (awaiting && Wallets.get(u.id) < o.amount ? 'Insufficient for acceptance' : 'Current server balance') + '</small></div>' +
            '<div><dt>Expected Store profit</dt><dd class="positive">' + money(o.profit) + '</dd><small>' + (o.profitCredited ? 'Credited by administrator' : 'Credit at admin completion') + '</small></div>' +
            '<div><dt>Amount deducted</dt><dd>' + money(o.deducted || 0) + '</dd><small>' + (o.acceptedAt ? 'Accepted ' + fmtDateTime(o.acceptedAt) : 'No acceptance debit') + '</small></div>' +
            '<div><dt>Principal returned</dt><dd>' + money(o.returned || 0) + '</dd><small>Separate wallet transaction</small></div>' +
            '<div><dt>Profit credited</dt><dd class="positive">' + money(o.profitCredited ? o.profit : 0) + '</dd><small>' + (o.profitStatus || 'Not yet credited') + '</small></div>' +
            '<div><dt>Final order balance</dt><dd>' + (o.balanceAfterCompletion == null ? '—' : money(o.balanceAfterCompletion)) + '</dd><small>' + (o.completedAt ? fmtDateTime(o.completedAt) : 'Available after final settlement') + '</small></div>' +
            '<div><dt>Customer order</dt><dd>#' + (o.customerOrderId || '—') + '</dd><small>' + esc(o.eta || 'No ETA') + '</small></div></dl>' +
            (o.instructions ? '<div class="store-instruction"><b>Admin instructions</b><p>' + esc(o.instructions) + '</p></div>' : '') +
            (awaiting ? '<div class="store-action-note">Acceptance deducts exactly ' + money(o.amount) + ' once after a secure available-balance check. After acceptance, only the administrator manages processing, shipping, delivery, completion, principal return, and profit credit.</div>' : '<div class="store-action-note">You can view administrator updates here. Store owners cannot advance processing or complete this order.</div>') +
            (awaiting ? '<div class="store-row-actions"><button class="btn btn-gold" data-action="so-accept" data-id="' + o.id + '">Accept &amp; deduct ' + money(o.amount) + '</button><button class="btn btn-danger" data-action="so-reject" data-id="' + o.id + '">Reject</button></div>' : '') +
            '<details class="store-history"><summary>Wallet transactions <span>' + orderTxs.length + '</span></summary>' + txHtml + '</details>' +
            '<details class="store-history"><summary>Status history <span>' + (o.history || []).length + '</span></summary>' + soTimeline(o) + '</details></article>';
    }).join('');
    return '<section class="store-panel" id="store-assigned" aria-labelledby="store-assigned-title"><div class="store-panel-head"><div><span class="store-section-label">FULFILLMENT QUEUE</span><h2 id="store-assigned-title">Admin-assigned orders</h2><p>Review required funds before acceptance, then follow administrator-managed shipping and final wallet settlement.</p></div>' +
        '<span class="store-count">' + myOrders.length + (awaitingCount ? ' · ' + awaitingCount + ' to review' : '') + '</span></div>' +
        (orderCards ? '<div class="store-order-list">' + orderCards + '</div>' : '<div class="store-empty">' + storeIcon('orders') + '<h3>No assigned orders yet</h3><p>When an administrator creates an order for ' + esc(s.storeName) + ', it will appear here with its required amount and expected profit.</p></div>') + '</section>';
}
function storeOrdersHtml(s) {
    var my = storeOrderGroups(s);
    var total = my.reduce(function (sum, x) { return sum + x.total; }, 0);
    var rows = my.map(function (x) {
        var itemCount = x.items.reduce(function (sum, it) { return sum + Number(it.qty || 0); }, 0);
        var items = x.items.map(function (it) {
            return '<li><span>' + esc(it.name) + ' × ' + it.qty + '</span><b>' + money(it.qty * it.price) + '</b></li>';
        }).join('');
        return '<article class="store-purchase-row" data-customer-order-id="' + x.order.id + '"><div class="store-purchase-main"><div><small>CUSTOMER PURCHASE · ORDER #' + x.order.id + '</small><h3>' + esc(x.buyerName) + '</h3><p>' + itemCount + ' item' + (itemCount === 1 ? '' : 's') + ' from this store · ' + fmtDateTime(x.order.createdAt) + '</p></div>' +
            '<div class="store-purchase-total"><b>' + money(x.total) + '</b>' + statusBadge(x.order.status) + '</div></div>' +
            '<details class="store-history"><summary>View store items <span>' + x.items.length + '</span></summary><ul class="store-item-list">' + items + '</ul></details></article>';
    }).join('');
    return '<section class="store-panel" id="store-orders" aria-labelledby="store-orders-title"><div class="store-panel-head"><div><span class="store-section-label">STOREFRONT SALES</span><h2 id="store-orders-title">Customer orders</h2><p>One entry per customer order, including only items linked to this store.</p></div><span class="store-count">' + my.length + ' orders · ' + money(total) + '</span></div>' +
        (rows || '<div class="store-empty">' + storeIcon('box') + '<h3>No customer purchases yet</h3><p>Eligible storefront purchases will appear here automatically after checkout. Admin assignments stay in the separate fulfillment queue above.</p></div>') + '</section>';
}
function myStoreProductsHtml(s) {
    var prods = storeProductsFor(s);
    var rows = prods.map(function (p) {
        return '<article class="store-product-row"><img src="' + esc(p.image || FALLBACK_IMG) + '" alt="' + esc(p.name) + '" loading="lazy">' +
            '<div><h3>' + esc(p.name) + '</h3><p>' + esc(p.category) + ' · Product #' + p.id + '</p></div>' +
            '<div class="store-product-price"><b>' + money(p.price) + '</b>' + stockHtml(p) + '</div>' +
            '<button class="store-remove-product" data-action="st-prod-remove" data-pid="' + p.id + '" aria-label="Remove ' + esc(p.name) + ' from store">Remove</button></article>';
    }).join('');
    return '<section class="store-panel" id="store-products" aria-labelledby="store-products-title"><div class="store-panel-head"><div><span class="store-section-label">CATALOG</span><h2 id="store-products-title">Store products</h2><p>Your selected catalog products and directly linked catalog items.</p></div><a class="store-text-link" href="#/shop">Add products ' + storeIcon('arrow') + '</a></div>' +
        (rows || '<div class="store-empty">' + storeIcon('tag') + '<h3>Your catalog is ready to build</h3><p>Browse the catalog and choose “Add to My Store” on a product. New purchases for uniquely linked products will then flow into this workspace.</p><a class="btn btn-gold" href="#/shop">Browse products</a></div>') + '</section>';
}
function storeStars(rating) {
    var r = Math.max(0, Math.min(5, Number(rating) || 0));
    return '<span class="store-rating" aria-label="' + r.toFixed(1) + ' out of 5 stars"><span>' + '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r)) + '</span><b>' + r.toFixed(1) + '</b></span>';
}
function storeOfficeHtml(s) {
    if (!s.ownerName && !s.street && !s.city) return '';
    var line2 = [s.houseNumber, s.street].filter(Boolean).join(' ') + (s.apartment ? ', Apartment ' + s.apartment : '');
    var line3 = [s.city, [s.state, s.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return '<div class="store-office"><h3>Store Owner &amp; Office Information</h3><address><b>' + esc(s.ownerName || '—') + '</b><br>' + esc(line2 || '—') + '<br>' + esc(line3 || '—') + '<br>' + esc(s.officeCountry || '—') + '</address></div>';
}
function approvedStoreCard(s) {
    return '<section class="store-panel store-details-panel" id="store-details" aria-labelledby="store-details-title"><div class="store-panel-head"><div><span class="store-section-label">MERCHANT PROFILE</span><h2 id="store-details-title">Store details</h2></div>' + storeStatusBadge(s.status) + '</div>' +
        '<dl class="store-detail-list"><div><dt>Store name</dt><dd>' + esc(s.storeName) + '</dd></div><div><dt>Store ID</dt><dd>MZ-' + s.id + '</dd></div>' +
        '<div><dt>Owner</dt><dd>' + esc(s.userName || '—') + '</dd></div><div><dt>Credit score</dt><dd>' + Number(s.creditScore) + '</dd></div><div><dt>Rating</dt><dd>' + storeStars(s.rating) + '</dd></div><div><dt>Configured visitors</dt><dd>' + Number(s.visitors).toLocaleString() + '</dd></div><div><dt>Configured views</dt><dd>' + Number(s.views).toLocaleString() + '</dd></div><div><dt>Category</dt><dd>' + esc(s.category || '—') + '</dd></div>' +
        '<div><dt>Contact</dt><dd>' + esc(s.phone || '—') + '</dd></div><div><dt>Approved</dt><dd>' + fmtDateTime(s.reviewedAt || s.createdAt) + '</dd></div>' +
        '<div class="wide"><dt>Description</dt><dd>' + esc(s.description || '—') + '</dd></div></dl><p class="hint">Visitors and views are manually configured values, not independently tracked analytics.</p>' + storeOfficeHtml(s) + '</section>';
}
function storeWithdrawalHtml(s, u) {
    var bal = Wallets.get(u.id);
    var myWd = Withdrawals.all().filter(function (w) { return w.userId === u.id; }).sort(function (a, b) { return b.id - a.id; });
    var myDeposits = Deposits.byUser(u.id);
    var pendingWd = Math.round(myWd.filter(function (w) { return w.status === 'Pending'; }).reduce(function (sum, w) { return sum + w.amount; }, 0) * 100) / 100;
    var wdRows = myWd.map(function (w) {
        return '<li><span>#' + w.id + ' · ' + fmtDate(w.createdAt) + '</span><b>' + money(w.amount) + '</b>' + statusBadge(w.status) + '</li>';
    }).join('');
    var depositRows = myDeposits.map(function (d) {
        return '<li><span>#' + d.id + ' · ' + fmtDate(d.createdAt) + (d.reference ? ' · ' + esc(d.reference) : '') + '</span><b>' + money(d.amount) + '</b>' + statusBadge(d.status) + '</li>';
    }).join('');
    return '<section class="store-panel store-wallet-panel" aria-labelledby="store-wallet-title"><div class="store-panel-head"><div><span class="store-section-label">EARNINGS &amp; PAYMENTS</span><h2 id="store-wallet-title">Store wallet</h2><p>Deposit and withdrawal tools are available after your store is verified.</p></div>' + storeIcon('wallet') + '</div>' +
        '<div class="store-balance-line"><span>Available balance</span><strong>' + money(bal) + '</strong><small>' + money(pendingWd) + ' in pending withdrawals</small></div>' +
        '<div class="store-wallet-actions"><form data-form="deposit" class="store-deposit-form"><input type="hidden" name="storeId" value="' + Number(s.id) + '"><div class="field"><label for="store-deposit-amount">Amount in USD ($)</label><input id="store-deposit-amount" name="amount" type="number" min="1" max="1000000" step="0.01" placeholder="Enter amount" required></div>' +
        '<button class="btn btn-gold" type="submit">Deposit</button>' + (storeDepositContactStoreId === Number(s.id) ? '<p class="notice notice-success store-deposit-contact" role="status">' + STORE_DEPOSIT_MESSAGE + '</p>' : '') + '</form>' +
        '<form data-form="withdraw" class="store-withdraw-form"><input type="hidden" name="method" value="trc20"><input type="hidden" name="store" value="' + esc(s.storeName) + '"><input type="hidden" name="storeId" value="' + Number(s.id) + '">' +
        '<div class="field"><label for="store-wd-amount">Withdrawal amount (USDT / $)</label><input id="store-wd-amount" name="amount" type="number" step="0.01" min="1" max="' + bal + '" required></div>' +
        '<div class="field"><label for="store-wd-address">USDT TRC20 address</label><input id="store-wd-address" name="trc20" placeholder="T..." minlength="34" maxlength="34" required></div>' +
        '<button class="btn btn-gold" ' + (bal <= 0 || u.withdrawHold ? 'disabled' : '') + '>Request withdrawal</button><p class="hint">Admin reviews the request before sending USDT. Minimum $1.' + (u.withdrawHold ? ' Withdrawals are currently frozen by the administrator.' : '') + '</p></form></div>' +
        (depositRows ? '<div class="store-wallet-history"><h3>All deposit requests</h3><ul class="store-withdraw-list">' + depositRows + '</ul></div>' : '') +
        (wdRows ? '<div class="store-wallet-history"><h3>All withdrawal requests</h3><ul class="store-withdraw-list">' + wdRows + '</ul></div>' : '') + '</section>';
}
function storeProfitRecordsHtml(s, u) {
    var orders = SellerOrders.forStore(s.id, u.id).slice().sort(function (a, b) { return b.id - a.id; });
    var stats = SellerOrders.stats(u.id, s.id);
    var completed = orders.filter(function (o) { return o.status === 'Completed'; });
    var completedProfit = Math.round(completed.reduce(function (sum, o) { return sum + (Number(o.profit) || 0); }, 0) * 100) / 100;
    var pendingProfit = Math.round(completed.filter(function (o) { return !o.profitCredited; }).reduce(function (sum, o) { return sum + (Number(o.profit) || 0); }, 0) * 100) / 100;
    var creditedProfit = Math.round(orders.filter(function (o) { return o.profitCredited; }).reduce(function (sum, o) { return sum + (Number(o.profit) || 0); }, 0) * 100) / 100;
    var paidProfit = Math.round(orders.filter(function (o) { return o.profitStatus === 'Paid'; }).reduce(function (sum, o) { return sum + (Number(o.profit) || 0); }, 0) * 100) / 100;
    var rows = orders.map(function (o) {
        var profitState = o.profitStatus === 'Paid' ? 'Paid' : o.profitCredited ? 'Credited to balance' : o.status === 'Completed' ? 'Pending credit' : 'Not yet earned';
        var at = o.completedAt || o.updatedAt || o.assignedAt || o.createdAt;
        return '<tr><td>ORD-' + o.id + '</td><td>' + esc(o.productName || 'Store order') + '</td><td>' + fmtDate(at) + '</td><td>' + soBadge(o.status) + '</td><td class="positive"><b>' + money(o.profit) + '</b></td><td>' + esc(profitState) + '</td></tr>';
    }).join('');
    return '<section class="store-panel" id="store-profit" aria-labelledby="store-profit-title"><div class="store-panel-head"><div><span class="store-section-label">PROFIT OVERVIEW</span><h2 id="store-profit-title">Profit dashboard &amp; all records</h2><p>Every admin-assigned order for this approved store, with profit status and history at a glance.</p></div>' + storeIcon('wallet') + '</div>' +
        '<div class="store-metrics store-profit-metrics">' +
        storeMetric('Completed-order profit', money(completedProfit), completed.length + ' completed orders') +
        storeMetric('Pending profit', money(pendingProfit), 'Awaiting balance credit', pendingProfit ? 'attention' : '') +
        storeMetric('Profit credited', money(creditedProfit), 'Credited to wallet balance') +
        storeMetric('Profit paid', money(paidProfit), 'Marked paid by admin') +
        '</div>' +
        (rows ? '<div class="store-profit-table-wrap" style="overflow-x:auto"><table class="store-profit-table"><thead><tr><th>Order</th><th>Product</th><th>Date</th><th>Order status</th><th>Profit</th><th>Profit record</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="store-empty">' + storeIcon('orders') + '<h3>No profit records yet</h3><p>All order and profit records will appear here after your approved store receives assignments.</p></div>') +
        '<p class="hint" style="margin-top:12px">Profit totals are calculated from this store’s order records. Pending profit is not counted as available balance until credited.</p></section>';
}
function approvedStoreDashboard(s, u) {
    var st = storeDashboardStats(s, u);
    return storeApprovalHero(s, st) + '<div id="store-overview">' + storeWorkspaceNav() +
        '<section class="store-metrics" aria-label="Store order overview">' +
        storeMetric('Total orders', st.total, st.assigned.length + ' assigned · ' + st.purchases.length + ' customer') +
        storeMetric('Needs action', st.awaiting, 'Awaiting store acceptance', st.awaiting ? 'attention' : '') +
        storeMetric('In progress', st.active, 'Accepted or processing') +
        storeMetric('Completed', st.completed, st.cancelled + ' cancelled or rejected') +
        storeMetric('Completed sales', money(st.completedSales), 'Customer purchases only') +
        storeMetric('Profit credited', money(st.profit), st.products + ' linked products') + '</section></div>' +
        assignedStoreOrdersHtml(s, u) + storeOrdersHtml(s) + storeProfitRecordsHtml(s, u) + myStoreProductsHtml(s) +
        '<div class="store-bottom-grid">' + approvedStoreCard(s) + storeWithdrawalHtml(s, u) + '</div>';
}
function vSellerDash() {
    var u = sessionUser();
    var s = u ? Stores.byUser(u.id) : null;
    if (!s || s.status !== 'approved') { go('mystore'); return ''; }
    return approvedStoreDashboard(s, u);
}
function storeApplicationHero(s, state) {
    var pending = state === 'pending';
    return '<section class="store-application-hero ' + state + '"><div><div class="store-kicker">' + storeIcon(pending ? 'clock' : 'shield') + (pending ? ' Application in review' : ' Action required') + '</div>' +
        '<h1>' + (pending ? 'Your store is being verified.' : 'Let’s get your application back on track.') + '</h1>' +
        '<p>' + (pending ? esc(s.storeName) + ' was submitted ' + fmtDateTime(s.createdAt) + '. The admin team will review the information you provided.' : 'The review team needs a correction before ' + esc(s.storeName) + ' can be approved. Update the details below and resubmit securely.') + '</p></div>' +
        '<div class="store-application-status"><span class="store-status-orbit">' + storeIcon(pending ? 'clock' : 'shield') + '</span><b>' + (pending ? 'Pending review' : 'Changes requested') + '</b><small>' + (pending ? 'Review may take up to 24 hours' : 'Your previous details are preserved') + '</small></div>' +
        (pending ? '<ol class="store-review-steps"><li class="done"><b>Application submitted</b><span>' + fmtDate(s.createdAt) + '</span></li><li class="current"><b>Admin verification</b><span>Currently in progress</span></li><li><b>Store approval</b><span>Unlocks your merchant workspace</span></li></ol>' :
            '<div class="store-rejection-reason"><span>Review feedback</span><p>' + esc(s.rejectReason || 'Please review your application details.') + '</p></div>') + '</section>';
}
function storeSubmittedDetails(s) {
    return '<section class="store-panel store-submitted-panel"><div class="store-panel-head"><div><span class="store-section-label">SUBMITTED APPLICATION</span><h2>' + esc(s.storeName) + '</h2><p>Keep this information available for the verification review.</p></div>' + storeStatusBadge(s.status) + '</div>' +
        '<dl class="store-detail-list"><div><dt>Applicant</dt><dd>' + esc(s.userName || '—') + '</dd></div><div><dt>Category</dt><dd>' + esc(s.category || '—') + '</dd></div><div><dt>Contact</dt><dd>' + esc(s.phone || '—') + '</dd></div><div><dt>Document</dt><dd>' + esc(s.docType || '—') + '</dd></div><div class="wide"><dt>Description</dt><dd>' + esc(s.description || '—') + '</dd></div></dl></section>';
}
function vMyStore() {
    var u = sessionUser();
    if (!u) { go('login'); return ''; }
    var s = Stores.byUser(u.id);
    if (s && s.status === 'pending') return storeApplicationHero(s, 'pending') + storeSubmittedDetails(s);
    if (s && s.status === 'approved') return approvedStoreDashboard(s, u);
    var rejected = (s && s.status === 'rejected');
    var ph0 = (s && s.phone) ? s.phone : '';
    var intro = rejected ? storeApplicationHero(s, 'rejected') :
        '<section class="store-onboarding"><div><div class="store-kicker">' + storeIcon('store') + ' Merchant onboarding</div><h1>Build your business on MarketZone.</h1><p>Verify your store, curate your catalog, and manage customer purchases and admin assignments in one dedicated workspace.</p></div>' +
        '<ol><li><span>01</span><div><b>Verify your store</b><p>Submit your business and identity details for admin review.</p></div></li><li><span>02</span><div><b>Build your catalog</b><p>Add catalog products after your store is approved.</p></div></li><li><span>03</span><div><b>Manage real orders</b><p>Track assignments, customer purchases, status history, and earnings.</p></div></li></ol></section>';
    return intro + '<section class="store-registration"><div class="store-registration-head"><span class="store-section-label">' + (rejected ? 'UPDATE & RESUBMIT' : 'STORE VERIFICATION') + '</span><h2>' + (rejected ? 'Correct your application' : 'Tell us about your store') + '</h2><p>All required fields must be completed before the admin review can begin.</p></div>' +
    '<form data-form="store-apply" id="store-form">' +
    '<fieldset><legend>Store information</legend><div class="field"><label>Store Name *</label><input name="storename" minlength="3" placeholder="e.g. Ali Trading Co." value="' + esc(s ? s.storeName : '') + '" required></div>' +
    '<div class="field"><label>Store Category *</label><select name="storecat">' + STORE_CATS.map(function (t) { return '<option' + (s && s.category === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label>Store Description * <small>(minimum 20 characters)</small></label><textarea name="description" minlength="20" placeholder="Describe your products, customers, and service..." required>' + esc(s ? s.description : '') + '</textarea></div></fieldset>' +
    '<fieldset><legend>Contact &amp; verification</legend><div class="field"><label>Gender *</label><select name="gender" required><option value="">Select gender</option><option value="Male"' + (s && s.gender === 'Male' ? ' selected' : '') + '>Male</option><option value="Female"' + (s && s.gender === 'Female' ? ' selected' : '') + '>Female</option></select></div>' +
    '<div class="frow"><div class="field"><label>Country *</label><select name="country" required>' + worldCountryOptions(s && s.country ? s.country : 'United States') + '</select></div>' +
    '<div class="field"><label>Phone Number *</label><input name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="Enter your phone number" value="' + esc(ph0) + '" required></div></div>' +
    '<div class="field"><label>ID Document Type *</label><select name="doctype">' + DOC_TYPES.map(function (t) { return '<option' + (s && s.docType === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label>Upload Document * <small>(clear image or PDF, max 2.5MB)</small></label><input id="st-doc-file" type="file" accept="image/*,application/pdf">' +
    '<input type="hidden" name="docdata" value="' + esc(s && s.docImage ? s.docImage : '') + '"><div id="st-doc-file-preview">' + (s && s.docImage && s.docImage.indexOf('data:image') === 0 ? '<img src="' + s.docImage + '" alt="Previously uploaded document" style="display:block;max-width:min(100%,320px);max-height:320px;width:auto;height:auto;object-fit:contain;margin:12px auto 0;border-radius:8px;border:1px solid #d5d9d9">' : '') + '</div></div>' +
    '<div class="field"><label>Store Invitation Code <small>(optional — 9 digits)</small></label><input name="refcode" inputmode="numeric" maxlength="9" pattern="\\d{9}" placeholder="e.g. 123456789" value="' + esc(s ? (s.refCode || '') : '') + '"></div></fieldset>' +
    '<div class="store-submit-row"><div>' + storeIcon('shield') + '<p>Your document is submitted securely for administrator verification. Review may take up to 24 hours. If you do not choose a new file, your previous document is kept.</p></div>' +
    '<button class="btn btn-gold">' + (rejected ? 'Resubmit for verification' : 'Submit for verification') + '</button></div></form></section>';
}


/* ---------- customer: notifications ---------- */
function vNotifications() {
    var u = sessionUser();
    if (!u) { go('login'); return ''; }
    var list = Notifs.forUser(u.id);
    var rows = list.map(function (n) {
        return '<div class="notif-item' + (n.read ? '' : ' unread') + '"><div style="flex:1"><b>' + esc(n.title) + '</b>' +
            (n.message ? '<div style="margin-top:4px">' + esc(n.message) + '</div>' : '') +
            '<div class="hint" style="margin-top:4px">' + fmtDateTime(n.createdAt) + '</div></div>' +
            '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">' +
            (n.soId ? '<button class="btn btn-sm btn-soft" data-action="notif-view-so" data-id="' + n.soId + '">📋 View Order</button>' : '') +
            (n.read ? '' : '<span class="badge badge-gold">New</span>') + '</div></div>';
    }).join('');
    return '<h1 class="page-title">🔔 Notifications</h1>' +
        (list.length ? '<button class="btn btn-soft" data-action="notif-readall" style="margin-bottom:14px">✔ Mark all as read</button>' +
        '<div class="card" style="padding:8px">' + rows + '</div>'
        : '<div class="card"><div class="empty">No notifications yet.</div></div>');
}

/* ---------- customer profile ---------- */
function alliancePanelHtml(u) {
    var referrals = Users.all().filter(function (x) { return x.referredBy === u.id; }).sort(function (a, b) { return b.id - a.id; });
    var approved = referrals.filter(function (x) { var s = Stores.byUser(x.id); return s && s.status === 'approved'; }).length;
    var rows = referrals.map(function (x) {
        var s = Stores.byUser(x.id);
        return '<tr><td><b>' + esc(x.name) + '</b><div class="hint">' + esc(x.email) + '</div></td><td>' + fmtDate(x.referredAt || x.createdAt) + '</td>' +
            '<td>' + (s ? storeStatusBadge(s.status) : '<span class="hint">No store application</span>') + '</td></tr>';
    }).join('');
    return '<div class="alliance-code"><label for="alliance-ref-code"><b>Your referral code</b></label><div class="alliance-copy-row">' +
        '<input id="alliance-ref-code" value="' + esc(u.referralCode) + '" readonly aria-label="Your referral code">' +
        '<button class="btn btn-gold" data-action="copy-ref" data-code="' + esc(u.referralCode) + '">Copy Code</button>' +
        '<button class="btn btn-soft" data-action="copy-invite" data-code="' + esc(u.referralCode) + '">Copy Invite Link</button></div></div>' +
        '<div class="acc-rgrid" style="margin:14px 0"><div><span>Total Referrals</span><b>' + referrals.length + '</b></div><div><span>Approved Merchants</span><b>' + approved + '</b></div></div>' +
        '<p class="hint">Share your code or invite link. New customers who enter it during registration are linked to your alliance. Referral tracking does not automatically add wallet funds.</p>' +
        (rows ? '<div style="overflow-x:auto"><table><thead><tr><th>Referred Customer</th><th>Joined</th><th>Store Progress</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
            : '<div class="empty" style="padding:16px">No referrals yet. Share your code to grow your alliance.</div>');
}
function vProfile() {
    var u = sessionUser();
    if (!u) { go('login'); return ''; }
    var myWds = Withdrawals.all().filter(function (w) { return w.userId === u.id; });
    var pendingAmt = myWds.filter(function (w) { return w.status === 'Pending'; }).reduce(function (s, w) { return s + w.amount; }, 0);
    var uid5 = (((u.id * 2654435761) >>> 0) % 0x100000).toString(16).toUpperCase();
    while (uid5.length < 5) uid5 = '0' + uid5;
    var myNotifs = Notifs.forUser(u.id);
    var tick = myNotifs.length ? (myNotifs[0].title + ': ' + myNotifs[0].message) : '\u{1F389} Welcome to MarketZone! Shop now to unlock the latest offers.';
    if (tick.length > 46) tick = tick.slice(0, 46) + '\u2026';
    var txs = Txs.byUser(u.id).slice(0, 12);
    function txRow(t) {
        return '<div class="acc-tx"><div style="min-width:0"><b>' + esc(t.type.replace(/_/g, ' ')) + '</b><div class="acc-tx-sub">' + esc(t.note || '') + ' \u00B7 ' + fmtDate(t.createdAt) + '</div></div>' +
            '<b style="color:' + (t.amount >= 0 ? '#067d62' : '#b12704') + ';white-space:nowrap">' + (t.amount >= 0 ? '+' : '') + money(Math.abs(t.amount)) + '</b></div>';
    }
    return '' +
    '<div class="acc-top"><div class="acc-ava">' + accountAvatar(u) + '</div>' +
        '<div class="acc-meta"><div class="acc-email">' + esc(u.email) + '</div><div class="acc-id">ID: ' + uid5 + '</div></div></div>' +
    '<div class="acc-pending"><span>Pending Amount:</span><b>' + money(pendingAmt) + '</b></div>' +
    '<div class="acc-notif"><span class="acc-spk">\u{1F56A}</span><span class="acc-ntxt">' + esc(tick) + '</span></div>' +
    '<div class="acc-menu">' +
        '<button class="acc-mi" data-action="acc-panel" data-p="info"><span class="acc-mi-ico">\u{1F464}</span> Personal Information <span class="acc-mi-arrow">\u203A</span></button>' +
        '<div class="acc-panel" id="acc-p-info">' +
            '<form data-form="profile-update">' +
            '<div class="field"><label>Full Name</label><input name="name" value="' + esc(u.name) + '" required></div><div class="field"><label>Email Address</label><input name="email" type="email" value="' + esc(u.email) + '" required></div>' +
            '<div class="hint" style="margin-bottom:10px">Member since ' + fmtDate(u.createdAt) + '</div>' +
            '<button class="btn btn-gold">\u{1F4BE} Save Changes</button></form>' +
            '<hr style="border:none;border-top:1px solid #f0f2f5;margin:18px 0">' +
            '<form data-form="password-change"><div class="frow"><div class="field"><label>Current Password</label><input name="current" type="password" required></div>' +
            '<div class="field"><label>New Password (8+ characters)</label><input name="password" type="password" minlength="8" required></div></div><div class="field"><label>Confirm New Password</label><input name="confirm" type="password" minlength="8" required></div>' +
            '<button class="btn">\u{1F512} Change Password</button></form></div>' +
        '<button class="acc-mi" data-action="acc-panel" data-p="refund"><span class="acc-mi-ico">\u{21BA}</span> Apply for Refund <span class="acc-mi-arrow">\u203A</span></button>' +
        '<div class="acc-panel" id="acc-p-refund"><p style="color:#3a4655;font-size:14.5px;line-height:1.7;margin:0 0 14px">You can request a refund for eligible cancelled orders. Wallet refunds are issued automatically. For order-related refunds, open your orders and use the cancel option \u2014 or contact live chat support.</p>' +
            '<a class="btn" href="#/orders" style="display:inline-block;text-decoration:none">\u{1F4E6} Go to My Orders</a></div>' +
        '<button class="acc-mi" data-action="acc-panel" data-p="records"><span class="acc-mi-ico">\u{1F4C3}</span> Financial Records <span class="acc-mi-arrow">\u203A</span></button>' +
        '<div class="acc-panel" id="acc-p-records">' + (txs.length ? txs.map(txRow).join('') : '<div class="acc-tx-sub" style="padding:6px 0">No transactions yet.</div>') + '</div>' +
        '<button class="acc-mi" data-action="acc-panel" data-p="alliance"><span class="acc-mi-ico">\u{1F465}</span> Entrepreneur Alliance <span class="acc-mi-arrow">\u203A</span></button>' +
        '<div class="acc-panel" id="acc-p-alliance">' + alliancePanelHtml(u) + '</div>' +
    '</div>';
}

/* ---------- auth views ---------- */
function vLogin() {
    return '<div class="auth-wrap"><div class="auth-card">' +
        '<div class="auth-logo"><span class="auth-mark">🛍</span><span class="auth-wordmark">Market<span>ZonePlus</span></span><small>SMART FINDS · BETTER VALUE</small></div><h2>Welcome Back</h2><p class="auth-sub">Sign in to your MarketZonePlus account</p>' +
        '<form data-form="login"><div class="field"><label>Email Address</label><input name="email" type="email" placeholder="you@example.com" required></div>' +
        '<div class="field"><label>Password</label><input name="password" type="password" placeholder="Enter your password" required></div>' +
        '<button class="btn btn-gold btn-block">🔐 Sign In Securely</button></form>' +
        (serverConfig.setupRequired ? '<details class="admin-setup"><summary>First-run administrator setup</summary><p class="hint">Create the administrator login for this installation. No default password is included.</p><form data-form="admin-setup"><div class="field"><label>Administrator Name</label><input name="name" value="Market Zone Admin" required></div><div class="field"><label>Administrator Email</label><input name="email" type="email" value="' + esc(ADMIN_EMAIL) + '" required></div><div class="field"><label>New Password (8+ characters)</label><input name="password" type="password" minlength="8" required></div><div class="field"><label>Confirm Password</label><input name="confirm" type="password" minlength="8" required></div><button class="btn btn-soft btn-block">Create Administrator Login</button></form></details>' : '') +
        '<div class="auth-foot">New to MarketZonePlus? <a href="#/register">Create your account</a></div>' +
        '</div></div>';
}
function vRegister() {
    var qi = location.hash.indexOf('?');
    var ref = qi >= 0 ? (new URLSearchParams(location.hash.slice(qi + 1)).get('ref') || '') : '';
    return '<div class="auth-wrap"><div class="auth-card">' +
        '<div class="auth-logo"><span class="auth-mark">🛍</span><span class="auth-wordmark">Market<span>ZonePlus</span></span><small>SMART FINDS · BETTER VALUE</small></div><h2>Create Account</h2><p class="auth-sub">Shop ' + Products.all().length + ' products with clear source details</p>' +
        '<form data-form="register">' +
        '<div class="field"><label>Full Name</label><input name="name" required></div>' +
        '<div class="field"><label>Email</label><input name="email" type="email" required></div>' +
        '<div class="field"><label>Password (8+ characters)</label><input name="password" type="password" minlength="8" required></div>' +
        '<div class="field"><label>Referral Code <small>(optional)</small></label><input name="refcode" inputmode="numeric" maxlength="9" pattern="\\d{9}" value="' + esc(ref) + '" placeholder="9-digit alliance code"></div>' +
        '<button class="btn btn-gold btn-block">Create your MarketZone account</button></form>' +
        '<div class="auth-foot">Already have an account? <a href="#/login">Sign in</a></div>' +
        '</div></div>';
}

/* ---------- admin ---------- */
function adminLayout(u, active, title, content) {
    var items = [['admin', '📊 Dashboard'], ['admin/users', '👥 Customers'], ['admin/stores', '🏪 Stores'], ['admin/seller-orders', '📋 Seller Orders'], ['admin/products', '📦 Products'], ['admin/orders', '🧾 Orders'], ['admin/wallet', '💼 Transactions'], ['admin/deposits', '💰 Deposits'], ['admin/withdrawals', '💸 Withdrawals'], ['admin/assistance', '🤝 Assistance'], ['admin/audits', '🛡 Audit History'], ['admin/chat', '💬 Support Chat']];
    return '<div class="app-layout"><aside class="sidebar">' +
        '<div class="brand"><span class="brand-mark">🛒</span><span>Market <b>Zone</b></span></div>' +
        '<div class="nav-label">ADMIN PANEL</div>' +
        items.map(function (it) { return '<a class="nav-item' + (it[0] === active ? ' active' : '') + '" href="#/' + it[0] + '">' + it[1] + '</a>'; }).join('') +
        '<div style="flex:1"></div>' +
        '<a class="nav-item" href="#/shop">🛍 View Store</a>' +
        '<a class="nav-item" href="#/logout">Logout</a>' +
        '<div class="side-profile"><span class="avatar">' + esc(u.name.charAt(0).toUpperCase()) + '</span><div class="sp-txt"><b>' + esc(u.name) + '</b><span>' + esc(u.email) + '</span></div></div></aside>' +
        '<main class="main"><div class="topbar"><h1>' + title + '</h1>' +
        '</div>' + content + '</main></div>';
}
function vAdminDash() {
    var users = Users.all().filter(function (u) { return u.role === 'customer'; });
    var banned = users.filter(function (u) { return u.status === 'banned'; }).length;
    var prods = Products.all();
    var orders = Orders.all();
    var revenue = orders.filter(function (o) { return o.status === 'Completed'; }).reduce(function (s, o) { return s + o.total; }, 0);
    var pending = orders.filter(function (o) { return o.status !== 'Completed' && o.status !== 'Cancelled'; }).length;
    function stat(lbl, num, color) { return '<div class="stat"><div class="lbl">' + lbl + '</div><div class="num" style="color:' + color + '">' + num + '</div></div>'; }
    return '<div class="grid stats">' +
        stat('👥 Customers', users.length, '#1458a6') + stat('🚫 Banned', banned, '#b12704') +
        stat('📦 Products', prods.length, '#1458a6') + stat('🧾 Total Orders', orders.length, '#10233f') +
        stat('💰 Completed Revenue', money(revenue), '#067d62') + stat('⏳ Pending Orders', pending, '#b8860b') +
        stat('🏪 Pending Stores', Stores.all().filter(function (s) { return s.status === 'pending'; }).length, '#b8860b') + '</div>' +
        '<div class="card"><h3 style="margin-top:0">Recent Orders</h3>' +
        (orders.length ? '<table><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Date</th></tr></thead><tbody>' +
            orders.slice().sort(function (a, b) { return b.id - a.id; }).slice(0, 8).map(function (o) {
                var cu = Users.byId(o.userId);
                return '<tr><td>#' + o.id + '</td><td>' + esc(cu ? cu.name : 'Deleted') + '</td><td>' + money(o.total) + '</td><td>' + statusBadge(o.status) + '</td><td>' + fmtDate(o.createdAt) + '</td></tr>';
            }).join('') + '</tbody></table>' : '<div class="empty">No orders yet.</div>') + '</div>';
}
function vAdminUsers() {
    var q = (vAdminUsers.q || '').toLowerCase();
    var users = Users.all().filter(function (u) { return u.role === 'customer'; });
    if (q) users = users.filter(function (u) { return u.name.toLowerCase().indexOf(q) >= 0 || u.email.toLowerCase().indexOf(q) >= 0; });
    users.sort(function (a, b) { return b.id - a.id; });
    var rows = users.map(function (u) {
        var bal = Wallets.get(u.id);
        var mStore = Stores.byUser(u.id);
        return '<tr><td><b>' + esc(u.name) + '</b>' + (mStore && mStore.status === 'approved' ? ' <span class="badge badge-green">🏪 ' + esc(mStore.storeName) + '</span>' : '') + '<div class="hint">' + esc(u.email) + '</div></td>' +
            '<td>' + (u.status === 'banned' ? '<span class="badge badge-red">Banned</span>' : '<span class="badge badge-green">Active</span>') + '</td>' +
            '<td>' + money(bal) + '</td>' +
            '<td>' + (u.withdrawHold ? '<span class="badge badge-red">🧊 Frozen</span>' : '<span class="badge badge-green">Active</span>') +
            ' <button class="btn btn-soft btn-sm" data-action="toggle-freeze" data-id="' + u.id + '">' + (u.withdrawHold ? 'Unfreeze' : 'Freeze') + '</button></td>' +
            '<td><div class="fund-box"><input type="number" step="0.01" id="fund-' + u.id + '" placeholder="Amount"><button class="btn btn-soft btn-sm" data-action="fund" data-id="' + u.id + '" data-sign="1">Add</button><button class="btn btn-danger btn-sm" data-action="fund" data-id="' + u.id + '" data-sign="-1">Deduct</button></div></td>' +
            '<td>' + (u.status === 'banned'
                ? '<button class="btn btn-soft btn-sm" data-action="unban" data-id="' + u.id + '">Unban</button>'
                : '<button class="btn btn-gold btn-sm" data-action="ban" data-id="' + u.id + '">Ban</button>') +
            ' <button class="btn btn-danger btn-sm" data-action="del-user" data-id="' + u.id + '">Delete</button></td></tr>';
    }).join('');
    return '<div class="card"><div class="row-between" style="margin-bottom:16px"><input id="user-q" placeholder="Search by name or email..." value="' + esc(vAdminUsers.q || '') + '" style="max-width:340px"></div>' +
        (users.length ? '<table><thead><tr><th>Customer</th><th>Status</th><th>Wallet</th><th>Withdrawals</th><th>Manage Funds</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table>'
            : '<div class="empty">No customers found.</div>') + '</div>';
}
var adminProductState = { q: '', page: 1 };
function vAdminProducts() {
    var all = Products.all().slice().sort(function (a, b) { return b.id - a.id; });
    var q = adminProductState.q.trim().toLowerCase();
    var prods = all.filter(function (p) { return !q || [p.name, p.brand, p.sku, p.category].join(' ').toLowerCase().indexOf(q) >= 0; });
    var perPage = 30, pages = Math.max(1, Math.ceil(prods.length / perPage));
    if (adminProductState.page > pages) adminProductState.page = pages;
    var visible = prods.slice((adminProductState.page - 1) * perPage, adminProductState.page * perPage);
    var rows = visible.map(function (p) {
        return '<tr><td style="display:flex;align-items:center;gap:10px">' + imgTag(p, 'athumb') + '<span><b>' + esc(p.name) + '</b><small class="hint" style="display:block">' + esc(p.brand || p.sku) + '</small></span></td>' +
            '<td>' + esc(p.category) + '<small class="hint" style="display:block">' + esc(p.subcategory) + '</small></td><td>' + money(p.price) + '</td><td>' + p.stock + '</td>' +
            '<td>' + (p.rating == null ? '—' : p.rating.toFixed(1) + '★ (' + numFmt(p.reviews || 0) + ')') + '</td>' +
            '<td><button class="btn btn-soft btn-sm" data-action="edit-product" data-id="' + p.id + '">✏️ Edit</button> '
            + '<button class="btn btn-danger btn-sm" data-action="del-product" data-id="' + p.id + '">Delete</button></td></tr>';
    }).join('');
    var cats = categories();
    return '<div class="card"><h3 style="margin-top:0" id="prod-form-title">➕ Add Product</h3><form data-form="add-product" class="admin-form">' +
        '<div><label>Product Name</label><input name="name" required></div>' +
        '<div><label>Brand</label><input name="brand" required></div>' +
        '<div><label>Seller / Store Name</label><input name="storeName" placeholder="Approved store name"></div>' +
        '<div><label>Category</label><input name="category" list="catlist" value="General" required><datalist id="catlist">' + cats.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></div>' +
        '<div><label>Subcategory</label><input name="subcategory" required></div>' +
        '<div><label>SKU</label><input name="sku" placeholder="Generated from product ID if blank"></div>' +
        '<div><label>Selling Price ($40–$1,000)</label><input name="price" type="number" step="0.01" min="40" max="1000" required></div>' +
        '<div><label>Discount</label><select name="discountPercent">' + [10,15,20,25,30,35,40].map(function (d) { return '<option value="' + d + '"' + (d === 20 ? ' selected' : '') + '>' + d + '% OFF</option>'; }).join('') + '</select></div>' +
        '<div><label>Local Stock</label><input name="stock" type="number" min="0" value="10" required></div>' +
        '<div style="grid-column:1/-1"><label>Description</label><textarea name="description" rows="3" required></textarea></div>' +
        '<div style="grid-column:1/-1"><label>Image URLs <small>(one per line; use only images you have permission to publish)</small></label><textarea name="images" rows="3" placeholder="https://..."></textarea></div>' +
        '<input type="hidden" name="editId">' +
        '<button class="btn btn-primary" id="prod-submit">Add</button> <button type="button" class="btn btn-soft" id="prod-cancel" data-action="cancel-edit" style="display:none">Cancel</button></form></div>' +
        '<div class="card"><div class="admin-product-head"><h3 style="margin:0">📦 Products (' + prods.length + ')</h3><input id="admin-product-q" value="' + esc(adminProductState.q) + '" placeholder="Search name, brand, SKU or category" aria-label="Search admin products"></div>' +
        '<div style="overflow-x:auto"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Source rating</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="6">No products match this search.</td></tr>') + '</tbody></table></div>' +
        '<nav class="catalog-pager"><button class="btn" data-action="admin-product-page" data-page="' + (adminProductState.page - 1) + '" ' + (adminProductState.page <= 1 ? 'disabled' : '') + '>← Previous</button><span>Page ' + adminProductState.page + ' of ' + pages + '</span><button class="btn" data-action="admin-product-page" data-page="' + (adminProductState.page + 1) + '" ' + (adminProductState.page >= pages ? 'disabled' : '') + '>Next →</button></nav></div>';
}
function vAdminOrders() {
    var orders = Orders.all().slice().sort(function (a, b) { return b.id - a.id; });
    var rows = orders.map(function (o) {
        var cu = Users.byId(o.userId);
        var items = o.items.map(function (i) { return i.qty + ' × ' + i.name; }).join(', ');
        return '<tr><td>#' + o.id + '<div class="hint">' + fmtDate(o.createdAt) + '</div></td><td>' + esc(cu ? cu.name : 'Deleted user') + (o.phone ? '<div class="hint">📞 ' + esc(o.phone) + '</div>' : '') + '</td><td>' + esc(items) + '</td>' +
            '<td>' + money(o.total) + '</td><td>' + statusBadge(o.status) + '</td>' +
            '<td>' + (o.sellerOrderId ? '<a class="btn btn-sm btn-gold" href="#/admin/seller-orders">Manage ORD-' + o.sellerOrderId + '</a><div class="hint">Assigned orders use the protected Seller Orders workflow.</div>' : o.status === 'Cancelled' ? '<span class="hint">Cancelled orders are final.</span>' : ['Pending', 'Processing', 'Completed', 'Cancelled'].map(function (s) {
                return '<button class="btn btn-sm ' + (o.status === s ? 'btn-primary' : 'btn-soft') + '" data-action="order-status" data-id="' + o.id + '" data-status="' + s + '">' + s + '</button>';
            }).join(' ')) + '</td></tr>';
    }).join('');
    return '<div class="card">' + (orders.length
        ? '<div style="overflow-x:auto"><table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Change</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">No orders yet.</div>') + '</div>';
}
function vAdminWallet() {
    var txs = Txs.all().slice().sort(function (a, b) { return b.id - a.id; }).slice(0, 200);
    var rows = txs.map(function (t) {
        var u = Users.byId(t.userId);
        var pos = t.amount >= 0;
        return '<tr><td>#' + t.id + '</td><td>' + esc(u ? u.name : 'Deleted user') + '<div class="hint">' + esc(u ? u.email : '') + '</div></td>' +
            '<td><span class="badge ' + (pos ? 'badge-green' : 'badge-red') + '">' + t.type + '</span></td>' +
            '<td style="font-weight:700;color:' + (pos ? '#067d62' : '#b12704') + '">' + (pos ? '+' : '') + money(t.amount) + '</td>' +
            '<td>' + esc(t.note) + '</td><td>' + fmtDateTime(t.createdAt) + '</td></tr>';
    }).join('');
    return '<div class="card">' + (rows
        ? '<table><thead><tr><th>ID</th><th>User</th><th>Type</th><th>Amount</th><th>Note</th><th>Date</th></tr></thead><tbody>' + rows + '</tbody></table>'
        : '<div class="empty">No wallet transactions yet.</div>') + '</div>';
}
function vAdminWithdrawals() {
    var ws = Withdrawals.all().slice().sort(function (a, b) { return b.id - a.id; });
    var pend = ws.filter(function (w) { return w.status === 'Pending'; });
    var rows = ws.map(function (w) {
        var cu = Users.byId(w.userId);
        return '<tr><td>#' + w.id + '<div class="hint">' + fmtDateTime(w.createdAt) + '</div></td>' +
            '<td>' + esc(cu ? cu.name : 'Deleted user') + '<div class="hint">' + esc(cu ? cu.email : '') + '</div></td>' +
            '<td style="font-weight:700;color:#b12704">' + money(w.amount) + '</td>' +
            '<td>' + (w.method === 'bank' ? '🏦 Bank Transfer' : '₮ USDT TRC20') + '<div class="hint"><code class="addr">' + esc(w.method === 'bank' ? (w.bankDetails || w.address) : w.address) + '</code></div></td>' +
            '<td>' + statusBadge(w.status) + '</td>' +
            '<td>' + (w.status === 'Pending'
                ? '<button class="btn btn-gold btn-sm" data-action="wd-send" data-id="' + w.id + '">✔ Mark as Sent</button> <button class="btn btn-danger btn-sm" data-action="wd-reject" data-id="' + w.id + '">✖ Reject</button>'
                : '<span class="hint">' + (w.processedAt ? fmtDateTime(w.processedAt) : '—') + '</span>') + '</td></tr>';
    }).join('');
    return '<div class="grid stats" style="margin-bottom:18px">' +
        '<div class="stat"><div class="lbl">⏳ Pending Requests</div><div class="num" style="color:#b8860b">' + pend.length + '</div></div>' +
        '<div class="stat"><div class="lbl">💸 Pending Amount</div><div class="num" style="color:#b12704">' + money(pend.reduce(function (s, w) { return s + w.amount; }, 0)) + '</div></div></div>' +
        '<div class="card">' + (rows
            ? '<table><thead><tr><th>ID</th><th>Customer</th><th>Amount</th><th>Method / Destination</th><th>Status</th><th>Action</th></tr></thead><tbody>' + rows + '</tbody></table>'
            : '<div class="empty">No withdrawal requests yet.</div>') + '</div>';
}
/* ---------- admin: deposit requests ---------- */
function vAdminDeposits() {
    var ds = Deposits.all().slice().sort(function (a, b) { return b.id - a.id; });
    var pending = ds.filter(function (d) { return d.status === 'Pending'; });
    var pendingAmount = pending.reduce(function (sum, d) { return sum + d.amount; }, 0);
    var rows = ds.map(function (d) {
        var cu = Users.byId(d.userId);
        return '<tr><td>#' + d.id + '<div class="hint">' + fmtDateTime(d.createdAt) + '</div></td>' +
            '<td>' + esc(cu ? cu.name : 'Deleted user') + '<div class="hint">' + esc(cu ? cu.email : '') + '</div></td>' +
            '<td><b>' + money(d.amount) + '</b></td><td>' + esc(d.reference || '—') + '</td><td>' + statusBadge(d.status) + '</td>' +
            '<td>' + (d.status === 'Pending'
                ? '<button class="btn btn-gold btn-sm" data-action="deposit-approve" data-id="' + d.id + '">✔ Approve &amp; Credit</button> <button class="btn btn-danger btn-sm" data-action="deposit-reject" data-id="' + d.id + '">✖ Reject</button>'
                : '<span class="hint">' + (d.processedAt ? fmtDateTime(d.processedAt) : '—') + '</span>') + '</td></tr>';
    }).join('');
    return '<div class="grid stats" style="margin-bottom:18px">' +
        '<div class="stat"><div class="lbl">⏳ Pending Requests</div><div class="num" style="color:#b8860b">' + pending.length + '</div></div>' +
        '<div class="stat"><div class="lbl">💰 Pending Amount</div><div class="num" style="color:#1458a6">' + money(pendingAmount) + '</div></div></div>' +
        '<div class="card"><p class="hint">Approve only after confirming the customer’s payment. Approval credits the wallet exactly once.</p>' +
        (rows ? '<div style="overflow-x:auto"><table><thead><tr><th>Request</th><th>Customer</th><th>Amount</th><th>Reference</th><th>Status</th><th>Action / Processed</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
            : '<div class="empty">No deposit requests yet.</div>') + '</div>';
}

/* ---------- admin: stores & merchants ---------- */
function vAdminStores() {
    var q = (vAdminStores.q || '').toLowerCase();
    var all = Stores.all().filter(function (s) { return !q || [s.storeName, s.userName, s.userEmail, s.country].join(' ').toLowerCase().indexOf(q) >= 0; }).slice().sort(function (a, b) { return b.id - a.id; });
    var pend = all.filter(function (s) { return s.status === 'pending'; });
    var appr = all.filter(function (s) { return s.status === 'approved'; });
    var statsHtml = '<div class="grid stats" style="margin-bottom:18px">' +
        '<div class="stat"><div class="lbl">⏳ Pending Review</div><div class="num" style="color:#b8860b">' + pend.length + '</div></div>' +
        '<div class="stat"><div class="lbl">✅ Approved Stores</div><div class="num" style="color:#067d62">' + appr.length + '</div></div>' +
        '<div class="stat"><div class="lbl">🏪 Total Applications</div><div class="num" style="color:#10233f">' + all.length + '</div></div></div>';
    var pendRows = pend.map(function (s) {
        return '<tr><td><b>' + esc(s.storeName) + '</b><div class="hint">🏷️ ' + esc(s.category || '—') + '</div><div class="hint">' + fmtDateTime(s.createdAt) + '</div></td>' +
        '<td><b>' + esc(s.userName || '—') + '</b><div class="hint">' + esc(s.userEmail || '—') + '</div></td>' +
        '<td>' + esc(s.description || '—') + '</td>' +
        '<td>📞 ' + esc(s.phone || '—') + '</td>' +
        '<td><b>' + esc(s.docType || '—') + '</b><div style="margin-top:4px">' + docImgHtml(s) + '</div></td>' +
        '<td>' + (s.source === 'admin' ? '<span class="badge badge-blue">By Admin</span>' : '<span class="badge badge-gold">Customer</span>') + '</td>' +
        '<td><button class="btn btn-soft btn-sm" data-action="st-view" data-id="' + s.id + '">👁 Details</button> <button class="btn btn-gold btn-sm" data-action="st-approve" data-id="' + s.id + '">✔ Approve</button> <button class="btn btn-danger btn-sm" data-action="st-reject-open" data-id="' + s.id + '">✖ Reject</button></td></tr>';
    }).join('');
    var restRows = all.filter(function (s) { return s.status !== 'pending'; }).map(function (s) {
        var eligible = eligibleStoreProducts(s);
        return '<tr><td><b>' + esc(s.storeName) + '</b><div class="hint">🏷️ ' + esc(s.category || '—') + '</div><div class="hint">' + fmtDate(s.createdAt) + '</div><div class="hint"><b>' + eligible.length + ' eligible Store products</b> · Wallet ' + money(Wallets.get(s.userId)) + '</div>' + (eligible.length ? '<details><summary>Eligible product IDs</summary><div class="hint">' + eligible.map(function (p) { return '#' + p.id + ' ' + esc(p.name); }).join('<br>') + '</div></details>' : '<div class="hint">Owner must use Add to My Store before assignment.</div>') + '</td>' +
        '<td><b>' + esc(s.userName || '—') + '</b><div class="hint">' + esc(s.userEmail || '—') + '</div></td>' +
        '<td>📞 ' + esc(s.phone || '—') + '<div class="hint">' + esc(s.docType || '—') + '</div></td>' +
        '<td>' + storeStatusBadge(s.status) + (s.status === 'rejected' && s.rejectReason ? '<div class="hint">' + esc(s.rejectReason) + '</div>' : '') + '</td>' +
        '<td>' + fmtDateTime(s.reviewedAt || s.createdAt) + '</td>' +
        '<td>' + docImgHtml(s) + '</td>' +
        '<td><button class="btn btn-soft btn-sm" data-action="st-edit" data-id="' + s.id + '">Edit</button> <button class="btn btn-danger btn-sm" data-action="st-remove" data-id="' + s.id + '">Delete</button></td></tr>';
    }).join('');
    var customers = Users.all().filter(function (cu) { return cu.role === 'customer' && !Stores.byUser(cu.id); });
    var addForm = '<div class="card" style="margin-bottom:18px"><h3 style="margin-top:0">➕ Add Merchant Directly (instant approval)</h3>' +
        (customers.length
        ? '<form data-form="admin-add-merchant" class="admin-form" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
        '<div><label>Customer Account</label><select name="userId">' + customers.map(function (cu) { return '<option value="' + cu.id + '">' + esc(cu.name) + ' — ' + esc(cu.email) + '</option>'; }).join('') + '</select></div>' +
        '<div><label>Store Name</label><input name="storename" required></div>' +
        '<div><label>Store Category</label><select name="storecat">' + STORE_CATS.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select></div>' +
        '<div><label>Store Description</label><input name="description"></div>' +
        '<div><label>Gender</label><select name="gender" required><option value="Male">Male</option><option value="Female">Female</option></select></div>' +
        '<div><label>Country</label><select name="country" required>' + worldCountryOptions('United States') + '</select></div>' +
        '<div><label>Phone Number</label><input name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="Enter phone number" required></div>' +
        '<div><label>ID Document Type</label><select name="doctype">' + DOC_TYPES.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select></div>' +
        '<div><label>Document (optional)</label><input id="am-doc-file" type="file" accept="image/*,application/pdf"><input type="hidden" name="docdata"><div id="am-doc-file-preview"></div></div>' +
        '<div><label>Referral Code (optional)</label><input name="refcode" inputmode="numeric" maxlength="9" placeholder="9-digit"></div>' +
        '<div><label>&nbsp;</label><button class="btn btn-primary">➕ Add Merchant</button></div></form>'
        : '<div class="empty" style="padding:20px">All customers already have store applications.</div>') + '</div>';
    var refList = RefCodes.all().slice().reverse();
    var refCard = '<div class="card" style="margin-bottom:18px"><h3 style="margin-top:0">🎟 Store Invitation Codes — Generate &amp; Distribute</h3>' +
        '<form data-form="admin-gen-ref" class="admin-form" style="grid-template-columns:120px auto;align-items:end;margin-bottom:12px">' +
        '<div><label>How many codes?</label><input name="count" type="number" min="1" max="50" value="5"></div>' +
        '<div><label>&nbsp;</label><button class="btn btn-gold">⚡ Generate Codes</button></div></form>' +
        (refList.length
        ? '<div style="max-height:280px;overflow:auto"><table class="tbl"><thead><tr><th>Code</th><th>Status</th><th>Used By</th><th>Used At</th></tr></thead><tbody>' +
          refList.map(function (r) { return '<tr><td><b>' + esc(r.code) + '</b></td><td>' + (r.usedBy ? '✅ Used' : '🟢 Active') + '</td><td>' + esc(r.usedBy || '—') + '</td><td>' + (r.usedAt ? fmtDateTime(r.usedAt) : '—') + '</td></tr>'; }).join('') +
          '</tbody></table></div>'
        : '<div class="empty" style="padding:16px">No store invitation codes generated yet.</div>') + '</div>';
    return '<div class="card" style="margin-bottom:18px"><input id="store-q" placeholder="Search Stores, owners, email, or country" value="' + esc(vAdminStores.q || '') + '" style="max-width:440px"></div>' + statsHtml + refCard +
        '<div class="card" style="margin-bottom:18px"><h3 style="margin-top:0">⏳ Pending Store Applications (' + pend.length + ')</h3>' +
        (pendRows ? '<div style="overflow-x:auto"><table><thead><tr><th>Store</th><th>Applicant</th><th>Description</th><th>Phone</th><th>ID Document</th><th>Source</th><th>Action</th></tr></thead><tbody>' + pendRows + '</tbody></table></div>' : '<div class="empty">No pending applications.</div>') + '</div>' +
        addForm +
        '<div class="card"><h3 style="margin-top:0">🏪 All Stores</h3>' +
        (restRows ? '<div style="overflow-x:auto"><table><thead><tr><th>Store</th><th>Owner</th><th>Contact</th><th>Status</th><th>Reviewed</th><th>Document</th><th></th></tr></thead><tbody>' + restRows + '</tbody></table></div>' : '<div class="empty">No stores yet.</div>') + '</div>';
}
function vAdminAssistance() {
    var rows = ((serverState && serverState.assistance) || []).map(function (r) {
        var u = Users.byId(r.userId);
        return '<tr><td>#' + r.id + '<div class="hint">' + fmtDateTime(r.createdAt) + '</div></td><td>' + esc(u ? u.name : 'Customer #' + r.userId) + '</td><td>' + esc(r.country) + '</td><td>' + esc(r.message) + '</td><td>' + statusBadge(r.status) + '</td><td>' + (r.status === 'Resolved' ? '<span class="hint">Resolved</span>' : '<button class="btn btn-soft btn-sm" data-action="assistance-review" data-id="' + r.id + '" data-status="Reviewed">Mark reviewed</button> <button class="btn btn-gold btn-sm" data-action="assistance-review" data-id="' + r.id + '" data-status="Resolved">Resolve</button>') + '</td></tr>';
    }).join('');
    return '<div class="card"><p class="hint">Review or arrange manual assistance here. A review never creates a payment, order, or delivery confirmation.</p>' + (rows ? '<div style="overflow-x:auto"><table><thead><tr><th>Request</th><th>Customer</th><th>Country</th><th>Message</th><th>Status</th><th>Action</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">No assistance requests.</div>') + '</div>';
}
function vAdminAudits() {
    var rows = ((serverState && serverState.audits) || []).map(function (a) {
        var admin = Users.byId(a.adminId);
        return '<tr><td>#' + a.id + '<div class="hint">' + fmtDateTime(a.createdAt) + '</div></td><td>' + esc(admin ? admin.name : 'Admin #' + a.adminId) + '</td><td>' + esc(a.entityType) + ' #' + esc(a.entityId) + '<div class="hint">' + esc(a.action) + '</div></td><td><details><summary>Values &amp; details</summary><p>' + esc(a.details) + '</p><pre style="white-space:pre-wrap;max-width:520px">' + esc(JSON.stringify({ previous: a.previousValue, new: a.newValue }, null, 2)) + '</pre></details></td></tr>';
    }).join('');
    return '<div class="card"><p class="hint">Protected administrator changes include the administrator, previous value, new value, timestamp, and details.</p>' + (rows ? '<div style="overflow-x:auto"><table><thead><tr><th>Audit</th><th>Administrator</th><th>Entity / action</th><th>Record</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">No audit records yet.</div>') + '</div>';
}
function v403() {
    return '<div class="page-403"><div><h1>403</h1><p>Admins only.</p><a href="#/login" style="color:#1458a6;font-weight:700">Go to login</a></div></div>';
}

/* ---------- render ---------- */
function render() {
    closeModal();
    var app = document.getElementById('app');
    var r = route();
    var u = sessionUser();

    if (r === 'login' || r === 'register') {
        if (u && u.status !== 'banned') { go(u.role === 'admin' ? 'admin' : 'shop'); return; }
        app.innerHTML = r === 'register' ? vRegister() : vLogin();
        return;
    }
    if (r === 'logout') { if (window.MZServer) MZServer.request('/auth/logout', { method: 'POST', body: {} }).catch(function () {}); clearSession(); sessionStorage.removeItem('mz_cart'); toast('Logged out. 👋');
        if (window.MZChat) MZChat.onRoute(null, 'login'); go('login'); return; }
    if (!u) { go('login'); return; }
    if (u.status === 'banned') { clearSession(); toast('Your account has been banned. Contact support.', 'error');
        if (window.MZChat) MZChat.onRoute(null, 'login'); go('login'); return; }

    if (r.indexOf('admin') === 0) {
        if (u.role !== 'admin') { app.innerHTML = v403(); return; }
        var map = { 'admin': ['admin', '📊 Dashboard', vAdminDash], 'admin/users': ['admin/users', '👥 Customers', vAdminUsers], 'admin/stores': ['admin/stores', '🏪 Stores & Merchants', vAdminStores], 'admin/seller-orders': ['admin/seller-orders', '📋 Seller Orders', vAdminSellerOrders], 'admin/products': ['admin/products', '📦 Products', vAdminProducts], 'admin/orders': ['admin/orders', '🧾 Orders', vAdminOrders], 'admin/wallet': ['admin/wallet', '💼 Wallet Transactions', vAdminWallet], 'admin/deposits': ['admin/deposits', '💰 Deposit Requests', vAdminDeposits], 'admin/withdrawals': ['admin/withdrawals', '💸 Withdrawals', vAdminWithdrawals], 'admin/assistance': ['admin/assistance', '🤝 Assistance', vAdminAssistance], 'admin/audits': ['admin/audits', '🛡 Audit History', vAdminAudits], 'admin/chat': ['admin/chat', '💬 Support Chat', vAdminChat] };
        var m = map[r] || map['admin'];
        app.innerHTML = adminLayout(u, m[0], m[1], m[2]());
        shopState = defaultShopState();
        if (window.MZChat) MZChat.onRoute(u, r);
        return;
    }
    applyShopQuery();
    if (u.role === 'admin' && ['cart', 'checkout', 'orders', 'wallet', 'profile', 'mystore', 'seller', 'targets', 'withdrawals'].indexOf(r) >= 0) {
        go('admin');
        return;
    }
    var cmap = { 'shop': vShop, 'cart': vCart, 'checkout': vCheckout, 'orders': vOrders,
        'wallet': function () { var s = Stores.byUser(u.id); return s && s.status === 'approved' ? vMyStore() : vWallet(); },
        'profile': vProfile, 'mystore': vMyStore, 'seller': vSellerDash, 'notifications': vNotifications,
        'targets': vTargets,
        'about': function () { return vInfo('\u{2139}\u{FE0F} About Us', 'MarketZone is a professional online shopping marketplace with ' + Products.all().length + ' accessible catalog products across electronics, home, fashion, beauty, sports, and other departments. Product facts and imagery retain source attribution; local inventory and checkout are managed by MarketZone.'); },
        'catalog-sources': vCatalogSources,
        'privacy': function () { return vInfo('\u{1F4C4} Privacy Policy', 'Account, order, wallet, Store, notification, and administrator review data are stored securely in the platform database. Browser storage is used only as a synchronized display cache and is not authoritative. If Firebase is configured, support messages and chat identifiers are sent to that Firebase project. Contact support with privacy questions.'); },
        'terms': function () { return vInfo('\u{1F4DC} Terms & Conditions', 'Use MarketZone lawfully and provide accurate account, delivery, and payment information. Store deposits and withdrawals require an approved Store and administrator review. Pending customer orders may be cancelled with an automatic wallet refund. Seller orders follow the assigned acceptance and fulfillment workflow.'); },
        'withdrawals': function () { var s = Stores.byUser(u.id); return s && s.status === 'approved' ? vMyStore() : vWithdrawals(); } };
    var view = cmap[r] || vShop;
    app.innerHTML = storeChrome(u, view());
    if (window.MZChat) MZChat.onRoute(u, r);
    updateCartBadge();
    if (r !== 'shop') shopState = defaultShopState();
    if (r === 'wallet') {
        var qi = location.hash.indexOf('?');
        if (qi >= 0) {
            var act = new URLSearchParams(location.hash.slice(qi + 1)).get('act');
            var target = document.getElementById(act === 'withdraw' ? 'mz-withdraw-card' : act === 'deposit' ? 'mz-deposit-card' : null);
            if (target) setTimeout(function () {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.style.boxShadow = '0 0 0 3px #febd69';
                setTimeout(function () { target.style.boxShadow = ''; }, 1600);
            }, 60);
        }
    }
}

/* ---------- actions ---------- */
function addToCart(id, qty) {
    qty = parseInt(qty, 10);
    if (!(qty >= 1)) { toast('Please choose a valid quantity.', 'error'); return false; }
    var p = Products.byId(+id);
    if (!p || p.stock <= 0) { toast('Sorry, this product is out of stock.', 'error'); return false; }
    var c = cart();
    var ex = c.find(function (i) { return i.id === p.id; });
    var cur = ex ? ex.qty : 0;
    if (cur + qty > p.stock) { toast('Only ' + p.stock + ' in stock for "' + p.name + '".', 'error'); return false; }
    if (ex) ex.qty += qty; else c.push({ id: p.id, name: p.name, price: p.price, mrp: p.mrp, image: p.image, qty: qty, commissionRate: p.commissionRate });
    saveCart(c);
    var u = sessionUser();
    if (u && !ex) notify(u.id, 'Item added to cart', p.name + ' is now in your shopping cart.');
    toast('✔ Added to cart: ' + esc(p.name));
    if (u) updateNotificationBadge();
    updateCartBadge();
    return true;
}
function copyText(text, successMessage) {
    function fallback() {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        toast(ok ? successMessage : 'Copy failed. Please select and copy the code manually.', ok ? 'success' : 'error');
    }
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () { toast(successMessage); }).catch(fallback);
    } else fallback();
}
var Actions = {
    'assistance-review': function (el) { return serverCall('/admin/assistance/' + Number(el.dataset.id), 'PATCH', { status: el.dataset.status, note: 'Reviewed by administrator.' }).then(function () { toast('Assistance request updated.'); render(); }).catch(serverError); },
    'deposit-contact': function () { toast('Please contact the administrator to make a deposit.'); },
    'assistance-open': function () {
        var root = document.getElementById('modal-root');
        root.innerHTML = '<div class="modal-back" data-action="close-modal"><div class="modal" style="display:block;max-width:480px"><button class="modal-x" data-action="close-modal">✕</button><h3>Contact Administrator</h3><p class="hint">Request a manual review or order arrangement. Submitting this form does not create an order, payment, or delivery confirmation.</p><form data-form="assistance"><div class="field"><label>Your country</label><select name="country" required>' + worldCountryOptions('United States') + '</select></div><div class="field"><label>How can the administrator help?</label><textarea name="message" minlength="5" maxlength="2000" required></textarea></div><button class="btn btn-gold">Submit assistance request</button></form></div></div>';
        document.body.style.overflow = 'hidden';
    },
    'open-drawer': function () {
        var d = document.getElementById('mz-drawer'), o = document.getElementById('mz-overlay');
        if (d) d.classList.add('open');
        if (o) o.classList.add('open');
        document.body.style.overflow = 'hidden';
    },
    'close-drawer': function () {
        var d = document.getElementById('mz-drawer'), o = document.getElementById('mz-overlay');
        if (d) d.classList.remove('open');
        if (o) o.classList.remove('open');
        document.body.style.overflow = '';
    },
    'toggle-cats': function () { var m = document.getElementById('mp-catmenu'); if (m) m.classList.toggle('open'); },
    'open-withdraw-modal': function () { openWithdrawModal(); },
    'wmethod': function (el) {
        var m = el.dataset.m;
        var h = document.getElementById('w-method'); if (h) h.value = m;
        var bw = document.getElementById('w-bankwrap'), tw = document.getElementById('w-trcwrap');
        if (bw) bw.style.display = m === 'bank' ? '' : 'none';
        if (tw) tw.style.display = m === 'trc20' ? '' : 'none';
        var btns = document.querySelectorAll('.wmethod');
        Array.prototype.forEach.call(btns, function (b) { b.classList.toggle('active', b.dataset.m === m); });
    },
    'copy-ref': function (el) { copyText(el.dataset.code, 'Referral code copied.'); },
    'copy-invite': function (el) {
        var base = location.href.split('#')[0];
        copyText(base + '#/register?ref=' + encodeURIComponent(el.dataset.code), 'Invite link copied.');
    },
    'acc-panel': function (el) {
        var p = document.getElementById('acc-p-' + el.dataset.p);
        if (!p) return;
        var wasOpen = p.classList.contains('open');
        Array.prototype.forEach.call(document.querySelectorAll('.acc-panel'), function (x) { x.classList.remove('open'); });
        Array.prototype.forEach.call(document.querySelectorAll('.acc-mi'), function (b) { b.classList.remove('active'); });
        if (!wasOpen) { p.classList.add('open'); el.classList.add('active'); }
        Array.prototype.forEach.call(document.querySelectorAll('.acc-mi'), function (b) {
            b.setAttribute('aria-expanded', b.classList.contains('active') ? 'true' : 'false');
        });
    },
    'view': function (el) { openProductModal(el.dataset.id); },
    'close-modal': function (el, e) { if (el.classList.contains('modal-back') && e.target !== el) return; closeModal(); },
    'm-inc': function () { modalQty(1); },
    'm-dec': function () { modalQty(-1); },
    'add-cart': function (el) {
        var qEl = el.dataset.qtyfrom ? document.getElementById(el.dataset.qtyfrom) : null;
        var qty = qEl ? parseInt(qEl.textContent, 10) : 1;
        if (addToCart(el.dataset.id, qty)) {
            closeModal();
            var g = document.getElementById('shop-grid'); if (g) g.innerHTML = shopGridHtml();
        }
    },
    'buy-now': function (el) {
        if (!sessionUser()) { toast('Please login first — an account is required for Buy Now.', 'error'); vLogin.tab = 'customer'; go('login'); return; }
        var qEl = el.dataset.qtyfrom ? document.getElementById(el.dataset.qtyfrom) : null;
        var qty = qEl ? parseInt(qEl.textContent, 10) : 1;
        if (addToCart(el.dataset.id, qty)) { closeModal(); go('checkout'); }
    },
    'set-cat': function (el) { shopState.cat = el.dataset.cat; shopState.subcat = 'All'; shopState.brand = 'All'; shopState.page = 1; render(); window.scrollTo(0, 0); },
    'set-subcat': function (el) { shopState.subcat = el.dataset.subcat; shopState.page = 1; render(); },
    'clear-filters': function () { shopState = defaultShopState(); render(); },
    'toggle-filters': function () { shopState.filtersOpen = !shopState.filtersOpen; var f = document.getElementById('catalog-filters'); if (f) f.classList.toggle('open', shopState.filtersOpen); },
    'admin-product-page': function (el) { if (el.disabled) return; adminProductState.page = Number(el.dataset.page) || 1; render(); },
    'catalog-page': function (el) { var page = Number(el.dataset.page); if (page < 1 || el.disabled) return; shopState.page = page; var g = document.getElementById('shop-grid'); if (g) g.innerHTML = shopGridHtml(); window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); },
    'gallery-go': function (el) { galleryState.index = Number(el.dataset.index) || 0; updateGallery(); },
    'gallery-prev': function () { moveGallery(-1); },
    'gallery-next': function () { moveGallery(1); },
    'gallery-zoom': function (el) { galleryState.zoom = !galleryState.zoom; var stage = document.getElementById('gallery-stage'); if (stage) stage.classList.toggle('zoomed', galleryState.zoom); el.setAttribute('aria-pressed', galleryState.zoom ? 'true' : 'false'); el.textContent = galleryState.zoom ? '⌕ Reset zoom' : '⌕ Zoom'; },
    'variant-select': function (el) { openProductModal(Number(el.dataset.id)); },
    'goto-store': function (el) { shopState.q = el.dataset.name; shopState.cat = 'All'; go('shop'); window.scrollTo(0, 0); },
    'set-sort': function (el) { shopState.sort = el.dataset.sort; render(); window.scrollTo(0, 0); },
    'cart-inc': function (el) { var c = cart(); var i = +el.dataset.idx; var p = Products.byId(c[i].id); if (p && c[i].qty >= p.stock) { toast('Only ' + p.stock + ' in stock.', 'error'); return; } c[i].qty += 1; saveCart(c); render(); },
    'cart-dec': function (el) { var c = cart(); var i = +el.dataset.idx; c[i].qty -= 1; if (c[i].qty <= 0) c.splice(i, 1); saveCart(c); render(); },
    'cart-remove': function (el) { var c = cart(), removed = c[+el.dataset.idx]; c.splice(+el.dataset.idx, 1); saveCart(c); var u = sessionUser(); if (u && removed) notify(u.id, 'Item removed from cart', removed.name + ' was removed from your shopping cart.'); render(); },
    'cancel-order': function (el) {
        if (!confirm('Cancel this pending order? Items will be restocked and any wallet payment refunded.')) return;
        return serverCall('/customer/orders/' + Number(el.dataset.id) + '/cancel', 'POST', {})
            .then(function () { toast('Order cancelled, restocked, and any wallet payment refunded.'); render(); }).catch(serverError);
    },
    'toggle-freeze': function (el) {
        var u = Users.byId(+el.dataset.id); if (!u) return;
        return serverCall('/admin/users/' + u.id, 'PATCH', { withdrawHold: !u.withdrawHold })
            .then(function () { toast(!u.withdrawHold ? 'Account frozen. Financial and Store actions are now blocked.' : 'Account unfrozen. Permitted actions are restored.'); render(); }).catch(serverError);
    },
    'ban': function (el) {
        return serverCall('/admin/users/' + Number(el.dataset.id), 'PATCH', { status: 'banned' })
            .then(function () { toast('Member banned.'); render(); }).catch(serverError);
    },
    'unban': function (el) {
        return serverCall('/admin/users/' + Number(el.dataset.id), 'PATCH', { status: 'active' })
            .then(function () { toast('Member access restored.'); render(); }).catch(serverError);
    },
    'del-user': function () {
        toast('Member accounts are retained for order, balance, and audit history. Ban the account to revoke access.', 'error');
    },
    'fund': function (el) {
        var id = +el.dataset.id, inp = document.getElementById('fund-' + id);
        var amount = Math.round(parseFloat(inp.value) * 100) / 100 * (+el.dataset.sign);
        if (!amount || isNaN(amount)) { toast('Enter a non-zero amount.', 'error'); return; }
        var reason = prompt('Reason for this audited balance adjustment (required):');
        if (!reason || reason.trim().length < 3) { toast('A reason of at least 3 characters is required.', 'error'); return; }
        return serverCall('/admin/wallet', 'POST', { userId: id, amount: amount, reason: reason.trim() })
            .then(function () { toast('Wallet adjustment saved and audited.'); render(); }).catch(serverError);
    },
    'edit-product': function (el) {
        var p = Products.byId(+el.dataset.id);
        if (!p) return;
        var f = document.querySelector('form[data-form="add-product"]');
        if (!f) return;
        f.editId.value = p.id;
        f.name.value = p.name;
        f.storeName.value = p.storeName || '';
        f.brand.value = p.brand || '';
        f.category.value = p.category;
        f.subcategory.value = p.subcategory || '';
        f.sku.value = p.sku || '';
        f.description.value = p.description || '';
        f.price.value = p.price;
        f.discountPercent.value = p.discountPercent || pctOff(p) || 20;
        f.stock.value = p.stock;
        f.images.value = (p.images || []).join('\n');
        var t = document.getElementById('prod-form-title'); if (t) t.textContent = '✏️ Edit Product (ID: ' + p.id + ')';
        var s = document.getElementById('prod-submit'); if (s) s.textContent = '💾 Save Changes';
        var c = document.getElementById('prod-cancel'); if (c) c.style.display = '';
        f.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    'cancel-edit': function () { render(); },
    'del-product': function (el) {
        if (!confirm('Delete this catalog product? Historical order snapshots will be retained.')) return;
        return serverCall('/admin/products/' + Number(el.dataset.id), 'DELETE', {})
            .then(function () { toast('Product deleted.'); render(); }).catch(serverError);
    },
    'order-status': function (el) {
        return serverCall('/admin/orders/' + Number(el.dataset.id), 'PATCH', { status: el.dataset.status, message: 'Status updated by administrator.' })
            .then(function () { toast('Order status updated.'); render(); }).catch(serverError);
    },
    'deposit-approve': function (el) {
        var d = Deposits.all().find(function (x) { return x.id === +el.dataset.id; });
        if (!d || !confirm('Confirm that ' + money(d.amount) + ' was received and verified?')) return;
        return serverCall('/admin/deposits/' + d.id, 'PATCH', { action: 'Approved', note: 'Payment received and verified by administrator.' })
            .then(function () { toast('Deposit approved and credited once.'); render(); }).catch(serverError);
    },
    'deposit-reject': function (el) {
        if (!confirm('Reject this deposit request? No wallet funds will be added.')) return;
        return serverCall('/admin/deposits/' + Number(el.dataset.id), 'PATCH', { action: 'Rejected', note: 'Deposit could not be verified.' })
            .then(function () { toast('Deposit rejected; balance unchanged.'); render(); }).catch(serverError);
    },
    'wd-send': function (el) {
        if (!confirm('Confirm that this withdrawal has actually been sent?')) return;
        return serverCall('/admin/withdrawals/' + Number(el.dataset.id), 'PATCH', { status: 'Completed', note: 'Withdrawal sent after administrator verification.' })
            .then(function () { toast('Withdrawal marked as sent.'); render(); }).catch(serverError);
    },
    'wd-reject': function (el) {
        if (!confirm('Reject this withdrawal and refund the reserved amount?')) return;
        return serverCall('/admin/withdrawals/' + Number(el.dataset.id), 'PATCH', { status: 'Rejected', note: 'Withdrawal rejected and reserved amount refunded.' })
            .then(function () { toast('Withdrawal rejected and refunded.'); render(); }).catch(serverError);
    },
    'add-to-store': function (el) {
        var u = sessionUser(); if (!u) { go('login'); return; }
        var s = Stores.byUser(u.id);
        if (!s || s.status !== 'approved') { toast('An approved Store is required before adding products.', 'error'); go('mystore'); return; }
        var productId = Number(el.dataset.id);
        if ((s.productIds || []).indexOf(productId) !== -1) { toast('This product is already in your Store.'); return; }
        return serverCall('/customer/stores/products', 'POST', { productId: productId, storeId: s.id })
            .then(function () { toast('Product added to your Store.'); render(); }).catch(serverError);
    },
    'store-scroll': function (el) {
        var target = document.getElementById(el.dataset.target);
        if (!target) return;
        var buttons = document.querySelectorAll('.store-workspace-nav button');
        Array.prototype.forEach.call(buttons, function (b) { b.classList.toggle('active', b === el); });
        target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    },
    'go-mystore': function () { closeModal(); go('mystore'); },
    'st-prod-remove': function (el) {
        var u = sessionUser(), s = u && Stores.byUser(u.id); if (!s) return;
        return serverCall('/customer/stores/products', 'POST', { productId: Number(el.dataset.pid), storeId: s.id, remove: true })
            .then(function () { toast('Product removed from your Store.'); render(); }).catch(serverError);
    },
    'toggle-notifications': function (el) {
        var panel = document.getElementById('notification-panel'); if (!panel) return;
        panel.hidden = !panel.hidden; el.setAttribute('aria-expanded', String(!panel.hidden));
    },
    'close-notifications': function () { var panel = document.getElementById('notification-panel'); if (panel) panel.hidden = true; var trigger = document.querySelector('.notification-trigger'); if (trigger) trigger.setAttribute('aria-expanded', 'false'); },
    'notif-open': function (el) {
        var n = Notifs.all().find(function (x) { return Number(x.id) === Number(el.dataset.id); });
        return serverCall('/customer/notifications/read', 'POST', {}).then(function () {
            Actions['close-notifications']();
            if (n && n.soId) Actions['notif-view-so']({ dataset: { id: String(n.soId) } }); else go('notifications');
        }).catch(serverError);
    },
    'notif-view-so': function (el) {
        var u = sessionUser(); if (!u) return;
        var o = SellerOrders.byId(parseInt(el.dataset.id, 10));
        if (!o) { toast('Order not found.', 'error'); return; }
        if (!canAccessSellerOrder(u, o)) { toast('You do not have access to this order.', 'error'); return; }
        var awaiting = o.status === 'Awaiting Acceptance';
        var isOwner = o.sellerId === u.id;
        var root = document.getElementById('modal-root');
        root.innerHTML = '<div class="modal-back" data-action="close-modal"><div class="modal" style="display:block;max-width:540px;max-height:88vh;overflow:auto">' +
            '<button class="modal-x" data-action="close-modal">✕</button>' +
            '<h3 style="margin-top:0">📋 Order ORD-' + o.id + ' ' + soBadge(o.status) + '</h3>' +
            '<div style="display:flex;gap:12px;align-items:center;margin-bottom:10px">' +
            (o.productImage ? '<img src="' + o.productImage + '" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid #eee">' : '') +
            '<div><b>' + esc(o.productName) + '</b><div class="hint">🏪 ' + esc(o.storeName) + '</div></div></div>' +
            '<table style="width:100%;font-size:14px"><tbody>' +
            '<tr><td class="hint" style="padding:3px 0">Required Order Amount</td><td><b>' + money(o.amount) + '</b></td></tr>' +
            '<tr><td class="hint" style="padding:3px 0">Amount Deducted</td><td>' + money(o.deducted || 0) + (o.balanceAfterDebit != null ? ' · balance after debit ' + money(o.balanceAfterDebit) : '') + '</td></tr>' +
            '<tr><td class="hint" style="padding:3px 0">Principal Returned</td><td>' + money(o.returned || 0) + '</td></tr>' +
            '<tr><td class="hint" style="padding:3px 0">Expected Store Profit</td><td><b style="color:#067d62">' + money(o.profit) + '</b>' + (o.profitStatus === 'Paid' ? ' ✅ Paid' : o.profitCredited ? ' ✅ Credited to balance' : ' — credited at admin completion') + '</td></tr>' +
            (o.balanceAfterCompletion != null ? '<tr><td class="hint" style="padding:3px 0">Final Wallet Balance</td><td><b>' + money(o.balanceAfterCompletion) + '</b></td></tr>' : '') +
            '<tr><td class="hint" style="padding:3px 0">Assigned</td><td>' + fmtDateTime(o.assignedAt) + '</td></tr>' +
            (o.instructions ? '<tr><td class="hint" style="padding:3px 0">Instructions</td><td>' + esc(o.instructions) + '</td></tr>' : '') +
            (o.eta ? '<tr><td class="hint" style="padding:3px 0">Estimated Completion</td><td>' + esc(o.eta) + '</td></tr>' : '') +
            '</tbody></table><h4 style="margin:12px 0 6px">Order Timeline</h4>' + soTimeline(o) +
            (awaiting && isOwner ? '<div style="display:flex;gap:10px;margin-top:12px"><button class="btn btn-gold" data-action="so-accept" data-id="' + o.id + '">✔ Accept &amp; Deduct ' + money(o.amount) + '</button><button class="btn btn-danger" data-action="so-reject" data-id="' + o.id + '">✖ Reject</button></div>' : isOwner ? '<p class="hint">Only the administrator can manage processing, shipping, delivery, and completion.</p>' : '') +
            '</div></div>';
        document.body.style.overflow = 'hidden';
    },
    'so-accept': function (el) {
        return serverCall('/customer/seller-orders/' + Number(el.dataset.id), 'PATCH', { status: 'Accepted', message: 'Order accepted after available-funds verification.' })
            .then(function (r) { closeModal(); toast('Order accepted. Required funds deducted once. Available balance: ' + money(r.balance) + '.'); render(); }).catch(serverError);
    },
    'so-reject': function (el) {
        return serverCall('/customer/seller-orders/' + Number(el.dataset.id), 'PATCH', { status: 'Rejected', message: 'Order rejected by seller.' })
            .then(function () { closeModal(); toast('Order rejected.'); render(); }).catch(serverError);
    },
    'so-profit-paid': function (el) {
        return serverCall('/admin/seller-orders/' + Number(el.dataset.id), 'PATCH', { profitStatus: 'Paid', message: 'Profit payment confirmed by administrator.' })
            .then(function () { toast('Profit marked as paid.'); render(); }).catch(serverError);
    },
    'st-approve': function (el) {
        if (!confirm('Approve this Store application?')) return;
        return serverCall('/admin/stores/' + Number(el.dataset.id), 'PATCH', { status: 'approved', rejectReason: '' })
            .then(function () { toast('Store approved.'); render(); }).catch(serverError);
    },
    'st-edit': function (el) {
        var s = Stores.byId(Number(el.dataset.id)); if (!s) return;
        function field(name, label, value, type, extra) { return '<div class="field"><label>' + label + '</label><input name="' + name + '" type="' + (type || 'text') + '" value="' + esc(value == null ? '' : value) + '" ' + (extra || '') + '></div>'; }
        var root = document.getElementById('modal-root');
        root.innerHTML = '<div class="modal-back" data-action="close-modal"><div class="modal" style="display:block;max-width:680px;max-height:90vh;overflow:auto"><button class="modal-x" data-action="close-modal">✕</button><h3>Edit Store &amp; Office Information</h3><form data-form="st-edit"><input type="hidden" name="id" value="' + s.id + '">' +
            '<div class="frow">' + field('creditScore', 'Credit score (0–1000)', s.creditScore, 'number', 'min="0" max="1000" step="1" required') + field('rating', 'Rating (0–5, one decimal)', s.rating, 'number', 'min="0" max="5" step="0.1" required') + '</div>' +
            '<div class="frow">' + field('visitors', 'Configured visitors', s.visitors, 'number', 'min="0" max="2000000000" step="1" required') + field('views', 'Configured views', s.views, 'number', 'min="0" max="2000000000" step="1" required') + '</div><p class="hint">Visitors and views are manually configured display values, not independently tracked analytics.</p>' +
            field('ownerName', 'Owner', s.ownerName) + '<div class="frow">' + field('houseNumber', 'House number', s.houseNumber) + field('street', 'Street', s.street) + '</div><div class="frow">' + field('apartment', 'Apartment', s.apartment) + field('city', 'City', s.city) + '</div><div class="frow">' + field('state', 'State', s.state) + field('zip', 'ZIP', s.zip) + '</div><div class="field"><label>Office country</label><select name="officeCountry">' + worldCountryOptions(s.officeCountry || 'United States') + '</select></div>' +
            '<button class="btn btn-gold">Save Store settings</button></form></div></div>';
        document.body.style.overflow = 'hidden';
    },
    'st-reject-open': function (el) {
        var s = Stores.all().find(function (x) { return x.id === +el.dataset.id; }); if (!s) return;
        var root = document.getElementById('modal-root');
        root.innerHTML = '<div class="modal-back" data-action="close-modal"><div class="modal" style="display:block;max-width:480px">' +
            '<button class="modal-x" data-action="close-modal">✕</button><h3 style="margin-top:0">Reject Store Application</h3>' +
            '<p class="hint">Store: <b>' + esc(s.storeName) + '</b></p><form data-form="st-reject-do">' +
            '<input type="hidden" name="appid" value="' + s.id + '"><input type="hidden" name="id" value="' + s.id + '">' +
            '<div class="field"><label>Message for the customer *</label><textarea name="reason" minlength="5" required></textarea></div>' +
            '<button class="btn btn-danger">Reject Application</button></form></div></div>';
        document.body.style.overflow = 'hidden';
    },
    'notif-readall': function () {
        return serverCall('/customer/notifications/read', 'POST', {}).then(function () { toast('Notifications marked as read.'); render(); }).catch(serverError);
    },
    'st-remove': function (el) {
        if (!confirm('Delete this Store record? Stores with order history cannot be deleted.')) return;
        return serverCall('/admin/stores/' + Number(el.dataset.id), 'DELETE', {})
            .then(function () { toast('Store record deleted.'); render(); }).catch(serverError);
    },
    'st-view': function (el) {
        var admin = sessionUser();
        if (!admin || admin.role !== 'admin') { toast('Admin access is required.', 'error'); return; }
        var s = Stores.all().find(function (x) { return x.id === +el.dataset.id; });
        if (!s) return;
        var root = document.getElementById('modal-root');
        var doc = s.docImage
            ? (s.docImage.indexOf('data:application/pdf') === 0
                ? '<a class="btn btn-gold" href="' + s.docImage + '" target="_blank">📄 Open PDF Document</a>'
                : '<a href="' + s.docImage + '" target="_blank"><img src="' + s.docImage + '" style="max-width:100%;max-height:340px;border-radius:10px;border:1px solid #d5d9d9"></a>')
            : '<span class="hint">No document uploaded</span>';
        root.innerHTML = '<div class="modal-back" data-action="close-modal"><div class="modal" style="display:block;max-width:560px">' +
            '<button class="modal-x" data-action="close-modal">✕</button>' +
            '<h3 style="margin-top:0">🏪 Store Application #' + s.id + ' ' + storeStatusBadge(s.status) + '</h3>' +
            '<table style="width:100%"><tbody>' +
            '<tr><td class="hint" style="width:150px">Store Name</td><td><b>' + esc(s.storeName || '—') + '</b></td></tr>' +
            '<tr><td class="hint">Category</td><td>🏷️ ' + esc(s.category || '—') + '</td></tr>' +
            '<tr><td class="hint">Description</td><td>' + esc(s.description || '—') + '</td></tr>' +
            '<tr><td class="hint">Applicant</td><td><b>' + esc(s.userName || '—') + '</b><div class="hint">' + esc(s.userEmail || '—') + ' (user #' + (s.userId || '—') + ')</div></td></tr>' +
            '<tr><td class="hint">📞 Phone</td><td>' + esc(s.phone || '—') + '</td></tr>' +
            '<tr><td class="hint">🪪 Document</td><td><b>' + esc(s.docType || '—') + '</b></td></tr>' +
            '<tr><td class="hint">Submitted</td><td>' + fmtDateTime(s.createdAt) + '</td></tr>' +
            (s.rejectReason ? '<tr><td class="hint">Reject Reason</td><td>' + esc(s.rejectReason) + '</td></tr>' : '') +
            '</tbody></table>' +
            '<div style="margin-top:14px"><div class="hint" style="margin-bottom:6px">📎 Submitted Document (click to open full size)</div>' + doc + '</div>' +
            '</div></div>';
        document.body.style.overflow = 'hidden';
    }
};

/* ---------- forms ---------- */
var Forms = {
    'assistance': function (f) {
        return serverCall('/customer/assistance', 'POST', { country: f.country.value, message: f.message.value.trim() })
            .then(function (r) { toast('Assistance request #' + r.id + ' submitted. No order or payment was created.'); closeModal(); render(); }).catch(serverError);
    },
    'st-edit': function (f) {
        var payload = { creditScore: Number(f.creditScore.value), rating: Number(f.rating.value), visitors: Number(f.visitors.value), views: Number(f.views.value), ownerName: f.ownerName.value.trim(), houseNumber: f.houseNumber.value.trim(), street: f.street.value.trim(), apartment: f.apartment.value.trim(), city: f.city.value.trim(), state: f.state.value.trim(), zip: f.zip.value.trim(), officeCountry: f.officeCountry.value };
        return serverCall('/admin/stores/' + Number(f.id.value), 'PATCH', payload).then(function () { toast('Store settings saved and audited.'); closeModal(); render(); }).catch(serverError);
    },
    'deposit': function (f) {
        var amount = Number(f.amount.value);
        if (!(amount >= 1 && amount <= 1000000)) { toast('Enter a deposit amount from $1 to $1,000,000.', 'error'); return; }
        var storeId = f.storeId ? Number(f.storeId.value) : undefined;
        var reference = (f.reference ? f.reference.value.trim() : '');
        return serverCall('/customer/deposits', 'POST', { amount: amount, reference: reference, storeId: storeId }).then(function (r) {
            if (storeId) storeDepositContactStoreId = storeId;
            toast(storeId ? 'Deposit request sent. Contact the administrator to complete it.' : 'Deposit request #' + r.id + ' submitted for administrator review. Your balance has not changed.');
            f.reset(); render();
        }).catch(serverError);
    },
    'search': function (f) {
        shopState.q = f.querySelector('input').value;
        shopState.page = 1;
        if (route() !== 'shop') go('shop'); else render();
        window.scrollTo(0, 0);
    },
    'login': function (f) {
        return MZServer.request('/auth/login', { method: 'POST', body: { email: f.email.value.trim().toLowerCase(), password: f.password.value } })
            .then(function () { return serverSync(); }).then(function (s) {
                if (!s) throw new Error('The session could not be established.');
                toast('Welcome back, ' + s.user.name.split(' ')[0] + '!'); go(s.user.role === 'admin' ? 'admin' : 'shop');
            }).catch(serverError);
    },
    'admin-setup': function (f) {
        if (f.password.value !== f.confirm.value) { toast('Passwords do not match.', 'error'); return; }
        return MZServer.request('/auth/setup', { method: 'POST', body: { name: f.name.value.trim(), email: f.email.value.trim().toLowerCase(), password: f.password.value, confirm: f.confirm.value } })
            .then(function () { serverConfig.setupRequired = false; toast('Administrator login created. You can now sign in.'); f.reset(); render(); }).catch(serverError);
    },
    'register': function (f) {
        return MZServer.request('/auth/register', { method: 'POST', body: { name: f.name.value.trim(), email: f.email.value.trim().toLowerCase(), password: f.password.value, refcode: f.refcode ? f.refcode.value.trim() : '' } })
            .then(function () { toast('Account created. Please sign in.'); go('login'); }).catch(serverError);
    },
    'checkout': function (f) {
        var u = sessionUser(), items = cart();
        if (!u || u.role !== 'customer') { toast('Please sign in with a customer account to check out.', 'error'); return; }
        if (!items.length) { toast('Cart is empty.', 'error'); return; }
        if (!f.dataset.idempotencyKey) f.dataset.idempotencyKey = checkoutKey();
        var payload = {
            items: items.map(function (i) { return { productId: Number(i.id), qty: Number(i.qty) }; }),
            address: f.address.value.trim(), city: f.city.value.trim(), phone: f.phone.value.trim(), country: f.country.value,
            paymentMethod: f.payment.value, idempotencyKey: f.dataset.idempotencyKey
        };
        return serverCall('/customer/checkout', 'POST', payload).then(function (r) {
            saveCart([]); delete f.dataset.idempotencyKey;
            toast(r.duplicate ? 'This order was already placed. No duplicate was created.' : (payload.paymentMethod === 'COD' ? 'Order #' + r.orderId + ' placed. Payment is due on delivery.' : 'Order #' + r.orderId + ' placed and wallet payment confirmed.'));
            go('orders');
        }).catch(function (err) {
            if (err.data && err.data.unavailable) toast(esc(err.message), 'error'); else serverError(err);
        });
    },
    'add-product': function (f) {
        var editId = parseInt(f.editId.value, 10) || 0, existing = editId ? Products.byId(editId) : null;
        var images = f.images.value.split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 8);
        if (!images.length && existing) images = existing.images;
        var store = resolveProductStore({ id: editId, storeName: f.storeName.value.trim() });
        var payload = { id: editId || undefined, sku: f.sku.value.trim(), name: f.name.value.trim(), brand: f.brand.value.trim(), category: f.category.value.trim() || 'General',
            subcategory: f.subcategory.value.trim(), description: f.description.value.trim(), price: Number(f.price.value), discountPercent: Number(f.discountPercent.value),
            stock: Number(f.stock.value), images: images, storeId: store ? store.id : null };
        if (hasExcludedProductBranding(payload)) { toast('Unauthorized marketplace or private-label branding is not allowed.', 'error'); return; }
        return serverCall(editId ? '/admin/products/' + editId : '/admin/products', editId ? 'PATCH' : 'POST', payload)
            .then(function () { toast(editId ? 'Product updated.' : 'Product added.'); render(); }).catch(serverError);
    },
    'withdraw': function (f) {
        var method = f.method ? f.method.value : 'trc20';
        var destination = method === 'bank' ? (f.bankdetails ? f.bankdetails.value.trim() : '') : (f.trc20 ? f.trc20.value.trim() : '');
        return serverCall('/customer/withdrawals', 'POST', { amount: Number(f.amount.value), method: method, destination: destination, store: f.store ? f.store.value : '', storeId: f.storeId ? Number(f.storeId.value) : undefined })
            .then(function (r) { toast('Withdrawal request #' + r.id + ' submitted for administrator review.'); closeModal(); render(); }).catch(serverError);
    },
    'assign-order': function (f) {
        var payload = { storeId: Number(f.storeId.value), productId: Number(f.productId.value), quantity: Number(f.quantity.value), amount: Number(f.amount.value), profit: Number(f.profit.value), eta: f.eta.value, instructions: f.instructions.value.trim() };
        return serverCall('/admin/manual-orders', 'POST', payload).then(function (r) {
            toast('Manual order ORD-' + r.sellerOrderId + ' created. Customer order #' + r.orderId + ' is now visible to the Store owner.'); render();
        }).catch(function (err) { err.handled = true; manualOrderError(err.message); });
    },
    'so-status-change': function (f) {
        return serverCall('/admin/seller-orders/' + Number(f.id.value), 'PATCH', { status: f.status.value, message: f.message.value.trim() })
            .then(function () { toast(f.status.value === 'Completed' ? 'Order completed. Principal and profit were settled once.' : 'Seller order updated.'); render(); }).catch(serverError);
    },
    'so-terms-save': function (f) {
        return serverCall('/admin/seller-orders/' + Number(f.id.value), 'PATCH', { amount: Number(f.amount.value), profit: Number(f.profit.value), message: 'Administrator revised the amount and profit before acceptance.' })
            .then(function () { toast('Pre-acceptance amount and profit updated.'); render(); }).catch(serverError);
    },
    'profile-update': function (f) {
        return serverCall('/customer/profile', 'PATCH', { name: f.name.value.trim(), email: f.email.value.trim().toLowerCase() })
            .then(function () { toast('Profile updated.'); render(); }).catch(serverError);
    },
    'password-change': function (f) {
        return serverCall('/customer/password', 'POST', { current: f.current.value, password: f.password.value, confirm: f.confirm.value })
            .then(function () { toast('Password updated securely.'); f.reset(); render(); }).catch(serverError);
    },
    'st-reject-do': function (f) {
        return serverCall('/admin/stores/' + Number(f.id.value), 'PATCH', { status: 'rejected', rejectReason: f.reason.value.trim() })
            .then(function () { toast('Store application rejected.'); closeModal(); render(); }).catch(serverError);
    },
    'store-apply': function (f) {
        var payload = { storename: f.storename.value.trim(), storecat: f.storecat.value, description: f.description.value.trim(), gender: f.gender.value,
            country: f.country.value, phone: f.phone.value.trim(), doctype: f.doctype.value, docdata: f.docdata.value || '', refcode: f.refcode.value.trim() };
        return serverCall('/customer/stores', 'POST', payload).then(function () { toast('Store submitted for administrator review.'); render(); }).catch(serverError);
    },
    'admin-add-merchant': function (f) {
        var payload = { userId: Number(f.userId.value), storename: f.storename.value.trim(), storecat: f.storecat.value, description: f.description.value.trim(), gender: f.gender.value,
            country: f.country.value, phone: f.phone.value.trim(), doctype: f.doctype.value, docdata: f.docdata.value || '', refcode: f.refcode.value.trim() };
        return serverCall('/admin/stores', 'POST', payload).then(function () { toast('Merchant Store created and approved.'); render(); }).catch(serverError);
    },
    'admin-gen-ref': function (f) {
        return serverCall('/admin/referrals', 'POST', { count: Number(f.count.value) }).then(function () { toast('Store invitation codes generated.'); render(); }).catch(serverError);
    },
};

/* ---------- operation feedback ---------- */
var BUSY_ACTIONS = {
    'add-cart': false,
    'order-status': true, 'cancel-order': true, 'so-accept': true, 'so-reject': true,
    'st-approve': true, 'st-remove': true, 'st-prod-remove': true, 'add-to-store': true,
    'deposit-approve': true, 'deposit-reject': true, 'wd-send': true, 'wd-reject': true,
    'add-product': true, 'del-product': true, 'del-user': true, 'ban': true, 'unban': true,
    'toggle-freeze': true, 'fund': true, 'admin-add-store': true
};
function setOperationBusy(el, busy, label) {
    if (!el) return;
    var buttons = el.tagName && el.tagName.toLowerCase() === 'button' ? [el] : Array.prototype.slice.call(el.querySelectorAll('button[type="submit"],button:not([type])'));
    buttons.forEach(function (b) {
        if (busy) {
            if (b.dataset.operationBusy === 'true') return;
            b.dataset.operationBusy = 'true'; b.dataset.originalHtml = b.innerHTML; b.disabled = true;
            b.classList.add('is-busy'); b.innerHTML = '<span class="operation-spinner" aria-hidden="true"></span>' + esc(label || 'Processing…');
            b.setAttribute('aria-busy', 'true');
        } else if (b.dataset.operationBusy === 'true') {
            b.disabled = false; b.classList.remove('is-busy'); b.removeAttribute('aria-busy');
            if (b.dataset.originalHtml) b.innerHTML = b.dataset.originalHtml;
            delete b.dataset.operationBusy; delete b.dataset.originalHtml;
        }
    });
}
function runWithBusy(el, operation, label) {
    if (!el || el.dataset.operationBusy === 'true' || (el.tagName === 'BUTTON' && el.disabled)) return;
    setOperationBusy(el, true, label);
    el.dataset.operationBusy = 'true';
    var completed = false;
    function done() {
        if (completed) return; completed = true;
        setOperationBusy(el, false);
        if (el.dataset) delete el.dataset.operationBusy;
    }
    try {
        var result = operation();
        if (result && typeof result.then === 'function') {
            result.catch(function (err) { console.error('Operation failed:', err); if (!err || !err.handled) toast('The operation could not be completed. Please try again.', 'error'); }).finally(done);
        } else done();
    } catch (err) {
        console.error('Operation failed:', err); toast('The operation could not be completed. Please try again.', 'error'); done();
    }
}
/* ---------- global listeners ---------- */
window.addEventListener('storage', function (e) {
    if (e.key === 'mz_products') Products._cache = null;
    if (e.key === 'mz_notifs' && sessionUser()) { render(); return; }
    if (['mz_products', 'mz_stores', 'mz_orders', 'mz_seller_orders'].indexOf(e.key) === -1) return;
    if (e.key === 'mz_products' && ['shop', 'admin/products', 'mystore', 'seller'].indexOf(route()) !== -1 && sessionUser()) render();
    else if (['mystore', 'seller', 'admin/stores', 'admin/orders', 'admin/seller-orders'].indexOf(route()) !== -1 && sessionUser()) render();
});
document.addEventListener('click', function (e) {
    if (!e.target.closest('.notif-popover,.notification-trigger')) { var np = document.getElementById('notification-panel'); if (np && !np.hidden) { np.hidden = true; var nt = document.querySelector('.notification-trigger'); if (nt) nt.setAttribute('aria-expanded', 'false'); } }
    var el = e.target.closest('[data-action]');
    if (el && Actions[el.dataset.action] && !(el.classList.contains('modal-back') && e.target !== el)) {
        e.preventDefault();
        if (BUSY_ACTIONS[el.dataset.action]) {
            runWithBusy(el, function () { Actions[el.dataset.action](el, e); }, 'Working…');
        } else {
            try { Actions[el.dataset.action](el, e); }
            catch (err) { console.error('Action failed:', err); toast('The action could not be completed. Please try again.', 'error'); }
        }
    }
});
document.addEventListener('submit', function (e) {
    var f = e.target.closest('form[data-form]');
    if (f && Forms[f.dataset.form]) {
        e.preventDefault();
        if (f.dataset.operationBusy === 'true') return;
        if (f.dataset.form === 'search') {
            try { Forms[f.dataset.form](f); }
            catch (err) { console.error('Search failed:', err); toast('Search could not be updated.', 'error'); }
        } else {
            var labels = { login: 'Signing in…', register: 'Creating account…', checkout: 'Placing order…', 'assign-order': 'Sending order…', deposit: 'Submitting…', withdraw: 'Submitting…' };
            runWithBusy(f, function () { Forms[f.dataset.form](f); }, labels[f.dataset.form] || 'Saving…');
        }
    }
});
document.addEventListener('input', function (e) {
    if (e.target.id === 'global-q') {
        shopState.q = e.target.value;
        shopState.page = 1;
        var g = document.getElementById('shop-grid');
        if (g && route() === 'shop') g.innerHTML = shopGridHtml();
    }
    if (e.target.id === 'admin-product-q') { adminProductState.q = e.target.value; adminProductState.page = 1; render(); var apq = document.getElementById('admin-product-q'); if (apq) { apq.focus(); apq.setSelectionRange(apq.value.length, apq.value.length); } }
    if (e.target.id === 'store-q') { vAdminStores.q = e.target.value; render(); var sq = document.getElementById('store-q'); if (sq) { sq.focus(); sq.setSelectionRange(sq.value.length, sq.value.length); } }
    if (e.target.id === 'user-q') { vAdminUsers.q = e.target.value; render(); var nq = document.getElementById('user-q'); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); } }
});
document.addEventListener('change', function (e) {
    if (e.target.name === 'storeId' && e.target.closest('form[data-form="assign-order"]')) updateAssignmentStore(e.target);
    if (e.target.id === 'shop-sort') { shopState.sort = e.target.value; shopState.page = 1; var g = document.getElementById('shop-grid'); if (g) g.innerHTML = shopGridHtml(); }
    if (e.target.dataset.shopFilter) { shopState[e.target.dataset.shopFilter] = e.target.value; shopState.page = 1; if (e.target.dataset.shopFilter === 'subcat' || e.target.dataset.shopFilter === 'brand') shopState.page = 1; render(); }
    if (e.target.id === 'st-doc-file' || e.target.id === 'am-doc-file') {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.size > 2.5 * 1024 * 1024) { toast('File too large — maximum 2.5MB allowed.', 'error'); e.target.value = ''; return; }
        var reader = new FileReader();
        reader.onload = function () {
            var form = e.target.closest('form');
            if (form && form.docdata) {
                form.docdata.value = reader.result;
                var pv = document.getElementById(e.target.id + '-preview');
                if (pv) pv.innerHTML = (String(reader.result).indexOf('data:application/pdf') === 0)
                    ? '📄 <b>' + esc(file.name) + '</b> ready — will be attached on submit'
                    : '<img src="' + reader.result + '" style="display:block;max-width:min(100%,320px);max-height:320px;width:auto;height:auto;object-fit:contain;margin:12px auto 0;border-radius:8px;border:1px solid #d5d9d9">';
            }
        };
        reader.readAsDataURL(file);
    }
});
document.addEventListener('load', function (e) {
    if (e.target.tagName === 'IMG') {
        e.target.classList.add('is-loaded');
        var box = e.target.closest('.mp-img,.athumb'); if (box) box.classList.add('has-image');
    }
}, true);
document.addEventListener('error', function (e) {
    if (e.target.tagName === 'IMG') {
        e.target.classList.add('image-error');
        var box = e.target.closest('.mp-img,.athumb'); if (box) box.classList.add('has-image');
    }
}, true);
function enhanceControls(root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-action]'), function (el) {
        var tag = el.tagName.toLowerCase();
        if (['button', 'a', 'input', 'select', 'textarea'].indexOf(tag) < 0 && !el.classList.contains('modal-back')) {
            el.setAttribute('role', 'button');
            el.setAttribute('tabindex', '0');
        }
        if (el.dataset.action === 'close-modal' && !el.getAttribute('aria-label')) el.setAttribute('aria-label', 'Close dialog');
    });
    Array.prototype.forEach.call(root.querySelectorAll('.modal,.wmodal'), function (el) {
        el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    });
    Array.prototype.forEach.call(root.querySelectorAll('.acc-mi'), function (el) {
        var panel = document.getElementById('acc-p-' + el.dataset.p);
        el.setAttribute('aria-expanded', panel && panel.classList.contains('open') ? 'true' : 'false');
        if (panel) el.setAttribute('aria-controls', panel.id);
    });
}
var controlObserver = new MutationObserver(function (records) {
    records.forEach(function (rec) {
        Array.prototype.forEach.call(rec.addedNodes, function (node) {
            if (node.nodeType === 1) enhanceControls(node.parentNode || document);
        });
    });
});
controlObserver.observe(document.getElementById('app'), { childList: true, subtree: true });
controlObserver.observe(document.getElementById('modal-root'), { childList: true, subtree: true });
document.addEventListener('keydown', function (e) {
    if (document.getElementById('gallery-stage') && !e.target.closest('input,textarea,select')) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); moveGallery(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); moveGallery(1); }
    }
    if (e.key === 'Escape') {
        closeModal();
        var d = document.getElementById('mz-drawer'), o = document.getElementById('mz-overlay');
        if (d) d.classList.remove('open'); if (o) o.classList.remove('open');
    }
    if (e.key === 'Enter' || e.key === ' ') {
        var el = e.target.closest('[data-action][role="button"]');
        if (el) { e.preventDefault(); el.click(); }
    }
});
window.addEventListener('hashchange', render);

/* ---------- boot ---------- */
if (window.MZServer) {
    document.getElementById('app').innerHTML = '<div class="server-startup" role="status">Connecting to your MarketZone account…</div>';
    MZServer.ready.then(function (config) {
        serverConfig = config || serverConfig;
        return MZServer.request('/auth/session').then(function (session) {
            return session.authenticated ? serverSync() : null;
        });
    }).then(function () { init(); render(); }).catch(function (err) {
        document.getElementById('app').innerHTML = '<div class="card server-startup"><h1>MarketZone could not connect</h1><p>' + esc(err.message || 'Please try again shortly.') + '</p><button class="btn btn-primary" onclick="location.reload()">Retry</button></div>';
    });
} else {
    init();
    render();
}
})();


