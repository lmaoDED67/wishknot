/* WishKnot front-end. Plain JavaScript, no build step. All user text is inserted with textContent (never as HTML). */
(function () {
  'use strict';
  var CFG = window.WK_CONFIG || {};
  var Core = window.WKCore;
  var app = document.getElementById('app');

  /* ---------- tiny helpers ---------- */
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'htmlFor' || k === 'src' || k === 'href' || k === 'type' || k === 'id') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return; }
    el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function inr(n) { return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function pctOf(a, b) { return b > 0 ? Math.min(100, (a / b) * 100) : 0; }
  function brandEl() { return h('a', { class: 'brand', href: '#/' }, 'Wish', h('span', null, 'Knot')); }

  var toastTimer;
  function toast(msg, bad) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 3600);
  }
  function copyText(text) {
    function fallback() {
      var ta = h('textarea', { style: 'position:fixed;opacity:0' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      toast(ok ? 'Copied!' : 'Could not copy. Please select and copy it manually.', !ok);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied!'); }, fallback);
    } else fallback();
  }

  /* ---------- storage + API (server when available, otherwise this browser only) ---------- */
  var LS_DB = 'wishknot_db_v1';
  var LS_KEYS = 'wishknot_keys_v1';
  function lsGet(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function savedKey(id) { return (lsGet(LS_KEYS, {}) || {})[id] || ''; }
  function rememberKey(id, key) { var m = lsGet(LS_KEYS, {}) || {}; m[id] = key; lsSet(LS_KEYS, m); }

  var demoDb = { weddings: {} };
  Core.seedDemo(demoDb);

  var Api = {
    mode: 'local',
    commission: Number(CFG.COMMISSION_PERCENT) || 0,
    init: function () {
      var self = this;
      if (location.protocol === 'file:') return Promise.resolve();
      return fetch('api/health', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        if (j && j.ok) { self.mode = 'server'; if (typeof j.commissionPct === 'number') self.commission = j.commissionPct; }
      }).catch(function () { /* stay in local mode */ });
    },
    run: function (db, method, path, body, key, persist) {
      var r = Core.handle(db, method, path, body, key, { commissionPct: this.commission });
      if (r.status >= 400) throw new Error(r.data.error || 'Something went wrong.');
      if (r.mutated && persist && !lsSet(LS_DB, db)) throw new Error('This browser could not save the data (storage is full or blocked).');
      return r.data;
    },
    req: function (method, path, body, key) {
      var self = this;
      if (/^\/weddings\/demo(\/|$)/.test(path)) {
        try { return Promise.resolve(self.run(demoDb, method, path, body, key, false)); } catch (e) { return Promise.reject(e); }
      }
      if (self.mode === 'server') {
        var headers = { 'Content-Type': 'application/json' };
        if (key) headers['x-wedding-key'] = key;
        return fetch('api' + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
          .then(function (res) {
            return res.json().catch(function () { return null; }).then(function (data) {
              if (!res.ok) throw new Error((data && data.error) || 'Something went wrong. Please try again.');
              return data;
            });
          }, function () { throw new Error('Could not reach the server. Please check your internet and try again.'); });
      }
      try {
        var db = lsGet(LS_DB, { weddings: {} }) || { weddings: {} };
        if (!db.weddings) db.weddings = {};
        return Promise.resolve(self.run(db, method, path, body, key, true));
      } catch (e) { return Promise.reject(e); }
    }
  };

  /* ---------- routing ---------- */
  var cleanups = [];
  function onLeave(fn) { cleanups.push(fn); }
  function route() {
    cleanups.splice(0).forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
    document.documentElement.setAttribute('data-theme', 'blush');
    document.title = (CFG.BRAND || 'WishKnot') + ' | Wedding wishlist';
    var closeDlg = document.querySelector('dialog[open]');
    if (closeDlg) closeDlg.close();
    clear(app);
    window.scrollTo(0, 0);
    var parts = (location.hash.replace(/^#\/?/, '') || '').split('?')[0].split('/').filter(Boolean);
    var page = parts[0] || '';
    if (page === 'create') return pageCreate();
    if (page === 'w' && parts[1]) return pageGuest(parts[1]);
    if (page === 'demo') return pageGuest('demo');
    if (page === 'manage' && parts[1]) return pageManage(parts[1], parts[2]);
    if (page === 'admin') return pageAdmin();
    return pageLanding();
  }

  function guestLink(id) { return location.href.split('#')[0] + '#/w/' + id; }
  function manageLink(id, key) { return location.href.split('#')[0] + '#/manage/' + id + '/' + key; }

  /* ---------- shared pieces ---------- */
  function contactBlock() {
    var email = CFG.CONTACT_EMAIL || '';
    var name = h('input', { type: 'text', id: 'c-name', maxlength: '80', autocomplete: 'name' });
    var from = h('input', { type: 'email', id: 'c-email', maxlength: '120', autocomplete: 'email' });
    var msg = h('textarea', { id: 'c-msg', maxlength: '1500' });
    var form = h('form', { class: 'card', novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      if (!msg.value.trim()) { toast('Please write a short message first.', true); msg.focus(); return; }
      var body = msg.value.trim() + '\n\n' + (name.value.trim() ? 'From: ' + name.value.trim() : '') + (from.value.trim() ? '\nReply to: ' + from.value.trim() : '');
      location.href = 'mailto:' + email + '?subject=' + encodeURIComponent('WishKnot enquiry') + '&body=' + encodeURIComponent(body);
      toast('Opening your email app…');
    } },
      h('div', { class: 'row2' },
        h('div', { class: 'field' }, h('label', { htmlFor: 'c-name' }, 'Your name'), name),
        h('div', { class: 'field' }, h('label', { htmlFor: 'c-email' }, 'Your email'), from)),
      h('div', { class: 'field' }, h('label', { htmlFor: 'c-msg' }, 'How can we help?'), msg),
      h('button', { class: 'btn primary', type: 'submit' }, 'Send message'),
      h('p', { class: 'hint', style: 'margin-top:10px' }, 'This opens your email app with the message ready to send.'));
    return h('section', { class: 'section contact', id: 'contact' }, h('div', { class: 'wrap' }, h('div', { class: 'contact-grid' },
      h('div', null,
        h('div', { class: 'eyebrow' }, 'Contact'),
        h('h2', { style: 'margin:10px 0 14px' }, 'Questions? We’d love to help.'),
        h('p', { class: 'muted' }, 'Need help setting up your wishlist, adding your QR, or planning for a big wedding? Write to us.'),
        h('p', { style: 'margin-top:18px' }, h('a', { href: 'mailto:' + email, style: 'font-size:20px;font-weight:500' }, email))),
      form)));
  }
  function footer(extra) {
    return h('footer', { class: 'footer' }, h('div', { class: 'wrap' },
      extra || null,
      h('p', null, 'Made with love on ', h('a', { href: '#/' }, CFG.BRAND || 'WishKnot'), ' · ',
        h('a', { href: 'mailto:' + (CFG.CONTACT_EMAIL || '') }, 'Contact'))));
  }

  function wishCard(it, t, opts) {
    var conf = t.conf[it.id] || 0, pend = t.pend[it.id] || 0;
    var done = conf >= it.goal;
    var cpct = pctOf(conf, it.goal);
    var ppct = Math.min(100 - cpct, pctOf(pend, it.goal));
    var cBar = h('div', { class: 'c' }), pBar = h('div', { class: 'p' });
    cBar.style.width = '0%'; pBar.style.width = '0%';
    requestAnimationFrame(function () { requestAnimationFrame(function () { cBar.style.width = cpct + '%'; pBar.style.width = ppct + '%'; }); });
    return h('article', { class: 'wish' },
      h('div', { class: 'em', 'aria-hidden': 'true' }, it.emoji),
      h('div', null,
        h('h3', null, it.title),
        it.note ? h('p', { class: 'nt' }, it.note) : null,
        h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(cpct)), 'aria-label': it.title + ' funded' }, cBar, pBar),
        h('div', { class: 'meta' },
          h('span', null, h('b', null, inr(conf)), ' of ', inr(it.goal)),
          done ? h('span', { class: 'badge ok' }, 'Fully gifted ♥') : h('span', { class: 'muted' }, Math.floor(cpct) + '% funded')),
        opts && opts.onGift ? h('div', { class: 'act' }, h('button', { class: 'btn primary small', type: 'button', onclick: function () { opts.onGift(it); } }, done ? 'Add more love ♥' : 'Contribute')) : null));
  }
  function totals(w) {
    var t = { conf: {}, pend: {}, confTotal: 0, pendTotal: 0 };
    w.contributions.forEach(function (c) {
      if (c.status === 'confirmed') { t.conf[c.itemId] = (t.conf[c.itemId] || 0) + c.amount; t.confTotal += c.amount; }
      else { t.pend[c.itemId] = (t.pend[c.itemId] || 0) + c.amount; t.pendTotal += c.amount; }
    });
    return t;
  }
  function fmtDate(s) {
    if (!s) return '';
    var p = s.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  /* ---------- confetti ---------- */
  function confetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var cv = document.getElementById('confetti');
    var ctx = cv.getContext('2d');
    cv.width = window.innerWidth; cv.height = window.innerHeight;
    var cols = ['#c9a05c', '#b34a62', '#f0cfc9', '#ffffff', '#7a9a76'];
    var ps = [];
    for (var i = 0; i < 110; i++) {
      ps.push({ x: cv.width / 2, y: cv.height * 0.6, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 15 - 4, s: Math.random() * 7 + 4, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cols[i % cols.length] });
    }
    var frames = 0;
    (function tick() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ps.forEach(function (p) {
        p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
      });
      if (++frames < 150) requestAnimationFrame(tick); else ctx.clearRect(0, 0, cv.width, cv.height);
    })();
  }

  /* =====================================================================
     Landing page
     ===================================================================== */
  function pageLanding() {
    var mockT = { conf: { a: 105000, b: 0 }, pend: {} };
    var mock = h('div', { class: 'mock' },
      h('div', { class: 'cap' }, 'Aisha & Kabir’s wishlist'),
      wishCard({ id: 'a', emoji: '✈️', title: 'Honeymoon in Europe', note: '', goal: 300000 }, mockT),
      wishCard({ id: 'b', emoji: '🏠', title: 'First home down payment', note: '', goal: 1000000 }, { conf: { b: 51000 }, pend: {} }));

    app.appendChild(h('div', { class: 'fade' },
      h('header', { class: 'hero-l' }, h('div', { class: 'wrap' },
        h('nav', { class: 'nav' }, brandEl(),
          h('div', { class: 'nav-links' }, h('a', { class: 'link', href: '#how' }, 'How it works'), h('a', { class: 'link', href: '#contact' }, 'Contact'),
            h('a', { class: 'btn small primary', href: '#/create' }, 'Create wishlist'))),
        h('div', { class: 'grid' },
          h('div', null,
            h('div', { class: 'eyebrow' }, 'The modern wedding registry'),
            h('h1', null, 'Skip the random gifts. ', h('em', null, 'Fund your dream start.')),
            h('p', { class: 'lead' }, 'Create a beautiful wishlist of the things you are really saving for. Send one link, and your guests can see your dreams and help make them real.'),
            h('div', { class: 'cta-row' },
              h('a', { class: 'btn primary', href: '#/create' }, 'Create our wishlist'),
              h('a', { class: 'btn ghost', href: '#/demo' }, 'See a sample'))),
          mock))),
      h('section', { class: 'section', id: 'how' }, h('div', { class: 'wrap' },
        h('div', { class: 'center' }, h('div', { class: 'eyebrow' }, 'How it works'), h('h2', { style: 'margin-top:10px' }, 'Three little steps')),
        h('div', { class: 'steps' },
          h('div', { class: 'step' }, h('div', { class: 'num' }, '1'), h('h3', null, 'Build your wishlist'), h('p', { class: 'muted' }, 'Add your dreams, like a honeymoon, a first home or a dream sofa, each with a goal amount.')),
          h('div', { class: 'step' }, h('div', { class: 'num' }, '2'), h('h3', null, 'Add your payment QR'), h('p', { class: 'muted' }, 'Upload the UPI QR where you want gifts to arrive. Guests pay you directly.')),
          h('div', { class: 'step' }, h('div', { class: 'num' }, '3'), h('h3', null, 'Share the link'), h('p', { class: 'muted' }, 'Send it on WhatsApp. Guests see live progress, contribute and leave a blessing.'))),
        h('div', { class: 'feat' },
          h('div', null, h('b', null, 'A wedding page guests love'), h('span', { class: 'muted' }, 'Your names, date, countdown and a note from you.')),
          h('div', null, h('b', null, 'Live progress bars'), h('span', { class: 'muted' }, 'Everyone sees how close each dream is.')),
          h('div', null, h('b', null, 'Wall of wishes'), h('span', { class: 'muted' }, 'Blessings from guests, kept for you to read.')),
          h('div', null, h('b', null, 'Three themes'), h('span', { class: 'muted' }, 'Blush, Sage or Midnight, to match your wedding.')),
          h('div', null, h('b', null, 'You stay in control'), h('span', { class: 'muted' }, 'Confirm or remove any gift from your private dashboard.')),
          h('div', null, h('b', null, 'Works on every phone'), h('span', { class: 'muted' }, 'No app and no sign-up for guests.'))))),
      h('section', { class: 'section band' }, h('div', { class: 'wrap narrow' }, h('div', { class: 'center' },
        h('div', { class: 'eyebrow' }, 'Simple pricing'),
        h('h2', { style: 'margin-top:10px' }, 'Free to create. Fair to keep.'),
        h('div', { class: 'fee' }, h('strong', null, Api.commission + '%'),
          h('p', null, 'platform fee on the gifts you confirm. Nothing to pay upfront, no monthly charges.'))))),
      contactBlock(),
      footer()));
  }

  /* =====================================================================
     Create / edit form
     ===================================================================== */
  var EMOJIS = ['✈️', '🏠', '🛋️', '🍽️', '📱', '🚗', '💍', '🌴', '💻', '🛏️', '🍳', '💝', '🎁'];
  var PRESETS = [
    { emoji: '✈️', title: 'Honeymoon', goal: 300000 },
    { emoji: '🏠', title: 'First home down payment', goal: 1000000 },
    { emoji: '🛋️', title: 'Dream sofa', goal: 60000 },
    { emoji: '🍽️', title: 'Anniversary dinner', goal: 15000 },
    { emoji: '📱', title: 'New phone', goal: 80000 },
    { emoji: '🛏️', title: 'Bedroom makeover', goal: 50000 }
  ];
  var THEME_INFO = [
    { id: 'blush', label: 'Blush', swatch: 'linear-gradient(135deg,#fbf5f1 50%,#b34a62 50%)' },
    { id: 'sage', label: 'Sage', swatch: 'linear-gradient(135deg,#f5f7f1 50%,#4f7352 50%)' },
    { id: 'midnight', label: 'Midnight', swatch: 'linear-gradient(135deg,#14121b 50%,#dcb673 50%)' }
  ];

  function fileToQr(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('Please choose an image file (PNG or JPG).'));
      if (file.size > 15 * 1024 * 1024) return reject(new Error('That file is too large. Please choose a smaller image.'));
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('That image could not be read. Please try a PNG or JPG.')); };
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var max = 720, s = Math.min(1, max / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
          var x = c.getContext('2d');
          x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
          var out = c.toDataURL('image/png');
          if (out.length > 450000) out = c.toDataURL('image/jpeg', 0.92);
          if (out.length > Core.LIMITS.qrLen) return reject(new Error('That image is too large. Please crop it to just the QR code.'));
          resolve(out);
        };
        img.onerror = function () { reject(new Error('That image could not be read. Please try a PNG or JPG.')); };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function wishForm(initial, opts) {
    var st = {
      partner1: initial.partner1 || '', partner2: initial.partner2 || '', date: initial.date || '', message: initial.message || '',
      theme: initial.theme || 'blush', upiId: initial.upiId || '', qr: initial.qr || '',
      items: (initial.items || []).map(function (i) { return { id: i.id, emoji: i.emoji, title: i.title, goal: i.goal, note: i.note || '' }; })
    };
    if (!st.items.length) st.items = [{ emoji: PRESETS[0].emoji, title: 'Honeymoon', goal: PRESETS[0].goal, note: '' }];

    var errBox = h('div', { class: 'err', role: 'alert', style: 'display:none' });
    function showErr(m) { errBox.textContent = m; errBox.style.display = 'block'; errBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); }

    function textField(label, key, o) {
      o = o || {};
      var id = 'f-' + key;
      var inp = o.area ? h('textarea', { id: id, maxlength: String(o.max || 600), placeholder: o.ph || '' }) : h('input', { type: o.type || 'text', id: id, maxlength: String(o.max || 60), placeholder: o.ph || '', autocomplete: o.auto || 'off' });
      inp.value = st[key];
      inp.addEventListener('input', function () { st[key] = inp.value; });
      return h('div', { class: 'field' }, h('label', { htmlFor: id }, label), inp, o.hint ? h('span', { class: 'hint' }, o.hint) : null);
    }

    var itemsBox = h('div');
    var chipsBox = h('div', { class: 'chips' });
    var addBtn = h('button', { class: 'btn ghost small', type: 'button', onclick: function () { addItem({ emoji: '🎁', title: '', goal: 10000, note: '' }); } }, '+ Add a wish');

    function addItem(it) {
      if (st.items.length >= Core.LIMITS.items) { toast('You can add up to ' + Core.LIMITS.items + ' wishes.', true); return; }
      st.items.push(it); renderItems();
      var inputs = itemsBox.querySelectorAll('.item-row');
      var last = inputs[inputs.length - 1];
      if (last) { var t = last.querySelector('input[type=text]'); if (t) t.focus(); }
    }
    function renderItems() {
      clear(itemsBox);
      st.items.forEach(function (it, idx) {
        var sel = h('select', { 'aria-label': 'Icon for wish ' + (idx + 1) });
        var list = EMOJIS.indexOf(it.emoji) >= 0 ? EMOJIS : EMOJIS.concat([it.emoji]);
        list.forEach(function (e) { var o = h('option', { value: e }, e); if (e === it.emoji) o.selected = true; sel.appendChild(o); });
        sel.addEventListener('change', function () { it.emoji = sel.value; });
        var title = h('input', { type: 'text', maxlength: '60', placeholder: 'e.g. Honeymoon in Europe', 'aria-label': 'Wish ' + (idx + 1) + ' title' });
        title.value = it.title; title.addEventListener('input', function () { it.title = title.value; });
        var goal = h('input', { type: 'number', min: '1', max: String(Core.LIMITS.maxGoal), step: '1', inputmode: 'numeric', placeholder: 'Goal ₹', 'aria-label': 'Wish ' + (idx + 1) + ' goal amount in rupees' });
        goal.value = it.goal; goal.addEventListener('input', function () { it.goal = goal.value; });
        var note = h('input', { type: 'text', maxlength: '120', placeholder: 'A short line for guests (optional)', 'aria-label': 'Wish ' + (idx + 1) + ' note' });
        note.value = it.note; note.addEventListener('input', function () { it.note = note.value; });
        var rm = h('button', { class: 'x', type: 'button', 'aria-label': 'Remove wish ' + (idx + 1), onclick: function () {
          if (st.items.length === 1) { toast('Keep at least one wish on the list.', true); return; }
          st.items.splice(idx, 1); renderItems();
        } }, '×');
        itemsBox.appendChild(h('div', { class: 'item-row' }, sel, title, h('div', { class: 'goalcell' }, goal), rm, h('div', { class: 'full' }, note)));
      });
      addBtn.disabled = st.items.length >= Core.LIMITS.items;
    }
    PRESETS.forEach(function (p) {
      chipsBox.appendChild(h('button', { class: 'chip', type: 'button', onclick: function () { addItem({ emoji: p.emoji, title: p.title, goal: p.goal, note: '' }); } }, p.emoji + ' ' + p.title));
    });
    renderItems();

    var themesBox = h('div', { class: 'themes', role: 'radiogroup', 'aria-label': 'Page theme' });
    THEME_INFO.forEach(function (t) {
      var r = h('input', { type: 'radio', name: 'theme', value: t.id, checked: st.theme === t.id });
      r.addEventListener('change', function () { st.theme = t.id; });
      var sw = h('i'); sw.style.background = t.swatch;
      themesBox.appendChild(h('label', { class: 'theme-opt' }, r, h('span', null, sw, t.label)));
    });

    var qrImg = h('img', { alt: 'Your payment QR' });
    var qrPrev = h('div', { class: 'qr-prev' });
    function renderQr() {
      clear(qrPrev);
      if (st.qr) { qrImg.src = st.qr; qrPrev.appendChild(qrImg); } else qrPrev.textContent = 'No QR added yet';
      rmQr.style.display = st.qr ? '' : 'none';
    }
    var rmQr = h('button', { class: 'btn ghost small', type: 'button', onclick: function () { st.qr = ''; fileIn.value = ''; renderQr(); } }, 'Remove QR');
    var fileIn = h('input', { type: 'file', accept: 'image/*', id: 'qr-file', class: 'sr-only', onchange: function () {
      var f = fileIn.files && fileIn.files[0];
      if (!f) return;
      fileToQr(f).then(function (data) { st.qr = data; renderQr(); toast('QR added ✓'); }, function (e) { toast(e.message, true); });
    } });
    renderQr();

    var submit = h('button', { class: 'btn primary', type: 'submit' }, opts.submitLabel);
    var form = h('form', { novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      errBox.style.display = 'none';
      var payload = {
        partner1: st.partner1, partner2: st.partner2, date: st.date, message: st.message, theme: st.theme, upiId: st.upiId, qr: st.qr,
        items: st.items.map(function (it) { return { id: it.id, emoji: it.emoji, title: it.title, goal: String(it.goal).trim() === '' ? NaN : Number(it.goal), note: it.note }; })
      };
      if (!payload.partner1.trim() || !payload.partner2.trim()) return showErr('Please enter both names.');
      for (var i = 0; i < payload.items.length; i++) {
        if (!payload.items[i].title.trim()) return showErr('Wish ' + (i + 1) + ' needs a title.');
        if (!(payload.items[i].goal >= 1) || !Number.isInteger(payload.items[i].goal)) return showErr('Wish ' + (i + 1) + ' needs a goal amount in whole rupees.');
      }
      submit.disabled = true; submit.textContent = 'Saving…';
      opts.onSubmit(payload).catch(function (err) {
        submit.disabled = false; submit.textContent = opts.submitLabel; showErr(err.message || 'Could not save. Please try again.');
      });
    } },
      errBox,
      h('div', { class: 'card form-card' },
        h('h3', { style: 'margin-bottom:14px' }, 'The couple'),
        h('div', { class: 'row2' }, textField('Partner 1 name', 'partner1', { max: 40, ph: 'Aisha', auto: 'given-name' }), textField('Partner 2 name', 'partner2', { max: 40, ph: 'Kabir' })),
        textField('Wedding date', 'date', { type: 'date', hint: 'Optional. Shows a countdown on your page.' }),
        textField('A note for your guests', 'message', { area: true, max: 600, ph: 'Your love and blessings are the best gift. If you would like to give more, help us start our life together…' }),
        h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Page theme'), themesBox)),
      h('div', { class: 'card form-card' },
        h('h3', { style: 'margin-bottom:4px' }, 'Your wishlist'),
        h('p', { class: 'muted', style: 'margin-bottom:14px' }, 'List the things you are really saving for. Tap a suggestion to add it.'),
        itemsBox, chipsBox, h('div', { style: 'margin-top:12px' }, addBtn)),
      h('div', { class: 'card form-card' },
        h('h3', { style: 'margin-bottom:4px' }, 'Where gifts should go'),
        h('p', { class: 'muted', style: 'margin-bottom:14px' }, 'Upload your UPI payment QR (from PhonePe, Google Pay, Paytm or your bank app). Guests pay you directly and then tell us they have paid.'),
        h('div', { class: 'qr-box' }, qrPrev,
          h('div', { style: 'display:grid;gap:8px' }, h('label', { class: 'btn ghost small', htmlFor: 'qr-file', tabindex: '0', role: 'button', onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } } }, 'Upload QR image'), fileIn, rmQr)),
        h('div', { class: 'field', style: 'margin-top:18px' },
          h('label', { htmlFor: 'f-upiId' }, 'UPI ID (optional)'),
          (function () { var i = h('input', { type: 'text', id: 'f-upiId', maxlength: '100', placeholder: 'name@bank', autocomplete: 'off', autocapitalize: 'none' }); i.value = st.upiId; i.addEventListener('input', function () { st.upiId = i.value; }); return i; })(),
          h('span', { class: 'hint' }, 'Lets guests on a phone open their UPI app with the amount filled in.')),
        h('div', { class: 'note' }, 'WishKnot charges a ' + Api.commission + '% platform fee on gifts you confirm. You will see the exact amount on your dashboard.')),
      h('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:center' }, submit,
        opts.onCancel ? h('button', { class: 'btn ghost', type: 'button', onclick: opts.onCancel }, 'Cancel') : null));
    return form;
  }

  function pageCreate() {
    document.title = 'Create your wishlist | ' + (CFG.BRAND || 'WishKnot');
    var wrap = h('div', { class: 'wrap narrow fade', style: 'padding-bottom:40px' });
    wrap.appendChild(h('nav', { class: 'nav' }, brandEl(), h('a', { class: 'link', href: '#/', style: 'color:var(--muted);text-decoration:none' }, '← Back')));
    wrap.appendChild(h('div', { class: 'page-head' }, h('div', { class: 'eyebrow' }, 'Let’s begin'), h('h1', null, 'Create your wishlist')));
    if (Api.mode === 'local') {
      wrap.appendChild(h('div', { class: 'note', style: 'margin-bottom:18px' }, 'Preview mode: this copy of the site is not connected to a server, so your wishlist is saved only in this browser. Guests on other phones cannot open it until the site is hosted (see README).'));
    }
    wrap.appendChild(wishForm({}, {
      submitLabel: 'Create my wishlist',
      onSubmit: function (payload) {
        return Api.req('POST', '/weddings', payload).then(function (r) {
          rememberKey(r.id, r.key);
          showCreated(wrap, r.id, r.key, payload);
        });
      }
    }));
    app.appendChild(wrap);
  }

  function shareButtons(link, text) {
    return h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:10px' },
      h('button', { class: 'btn primary small', type: 'button', onclick: function () { copyText(link); } }, 'Copy link'),
      h('a', { class: 'btn ghost small', target: '_blank', rel: 'noopener', href: 'https://wa.me/?text=' + encodeURIComponent(text + ' ' + link) }, 'Share on WhatsApp'));
  }

  function showCreated(wrap, id, key, w) {
    window.scrollTo(0, 0);
    clear(wrap);
    var gl = guestLink(id), ml = manageLink(id, key);
    wrap.appendChild(h('nav', { class: 'nav' }, brandEl()));
    wrap.appendChild(h('div', { class: 'page-head center' },
      h('div', { class: 'eyebrow' }, 'All set'),
      h('h1', null, 'Your wishlist is live ♥'),
      h('p', { class: 'muted', style: 'margin-top:10px' }, 'Send the guest link to everyone you love.')));
    wrap.appendChild(h('div', { class: 'card form-card' },
      h('h3', null, 'Guest link'),
      h('p', { class: 'muted' }, 'Share this one. Guests need nothing else.'),
      h('div', { class: 'copyline' }, h('input', { type: 'text', readonly: true, value: gl, 'aria-label': 'Guest link', onfocus: function (e) { e.target.select(); } })),
      shareButtons(gl, 'Join us in celebrating ' + w.partner1 + ' & ' + w.partner2 + '! Here is our wedding wishlist:'),
      h('div', { style: 'margin-top:14px' }, h('a', { class: 'btn ghost small', href: '#/w/' + id }, 'Preview guest page'))));
    wrap.appendChild(h('div', { class: 'card form-card', style: 'border-color:var(--gold)' },
      h('h3', null, 'Your private dashboard link'),
      h('p', { class: 'muted' }, 'Keep this safe and do not share it. It lets you confirm gifts and edit your wishlist. Save it now: it is the only way back in.'),
      h('div', { class: 'copyline' }, h('input', { type: 'text', readonly: true, value: ml, 'aria-label': 'Private dashboard link', onfocus: function (e) { e.target.select(); } })),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:10px' },
        h('button', { class: 'btn primary small', type: 'button', onclick: function () { copyText(ml); } }, 'Copy dashboard link'),
        h('a', { class: 'btn ghost small', href: '#/manage/' + id + '/' + key }, 'Open dashboard'),
        h('a', { class: 'btn ghost small', href: 'mailto:?subject=' + encodeURIComponent('My wedding wishlist dashboard link') + '&body=' + encodeURIComponent(ml) }, 'Email it to myself'))));
  }

  /* =====================================================================
     Guest page
     ===================================================================== */
  function pageGuest(id) {
    app.appendChild(h('div', { class: 'wrap', style: 'padding-top:80px;text-align:center', 'aria-busy': 'true' }, h('p', { class: 'muted' }, 'Opening the wishlist…')));
    Api.req('GET', '/weddings/' + id).then(function (w) { renderGuest(w, id); }, function (e) {
      clear(app);
      app.appendChild(h('div', { class: 'wrap narrow center', style: 'padding-top:90px' },
        h('h2', null, 'Hmm, we can’t find that wishlist'), h('p', { class: 'muted', style: 'margin:12px 0 22px' }, e.message),
        h('a', { class: 'btn primary', href: '#/' }, 'Go to home')));
    });
  }

  function renderGuest(w, id) {
    var token = {};
    app.__token = token;
    document.documentElement.setAttribute('data-theme', w.theme || 'blush');
    document.title = w.partner1 + ' & ' + w.partner2 + ' | Wedding wishlist';
    clear(app);

    var root = h('div', { class: 'fade' });
    if (id === 'demo') root.appendChild(h('div', { class: 'ribbon' }, 'This is a sample page. Nothing here is real or saved. ', h('a', { href: '#/create' }, 'Create yours →')));

    // Petals
    var hero = h('header', { class: 'g-hero' });
    for (var i = 0; i < 16; i++) {
      var p = h('span', { class: 'petal' + (i % 3 === 0 ? ' g' : ''), 'aria-hidden': 'true' });
      p.style.left = (Math.random() * 100) + '%';
      p.style.animationDuration = (9 + Math.random() * 9) + 's';
      p.style.animationDelay = (-Math.random() * 14) + 's';
      p.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
      var sz = 9 + Math.random() * 12; p.style.width = sz + 'px'; p.style.height = (sz * 1.25) + 'px';
      hero.appendChild(p);
    }
    var cdBox = h('div');
    var inner = h('div', { class: 'inner' },
      h('div', { class: 'sub' }, 'Together with their families'),
      h('h1', { class: 'names' }, w.partner1, h('span', { class: 'amp' }, '&'), w.partner2),
      h('div', { class: 'sub' }, 'are getting married'),
      w.date ? h('div', { class: 'date' }, fmtDate(w.date)) : null,
      cdBox,
      h('div', { class: 'orn' }, '✦'),
      h('p', { class: 'muted', style: 'max-width:420px;margin:0 auto' }, 'Your presence is our present. If you wish to give more, here are the dreams we are saving for.'),
      h('div', { class: 'scroll-cue' }, h('a', { class: 'btn primary', href: '#wishlist', onclick: function (e) { e.preventDefault(); var t = document.getElementById('wishlist'); if (t) t.scrollIntoView({ behavior: 'smooth' }); } }, 'See our wishlist ↓')));
    hero.appendChild(inner);
    root.appendChild(hero);

    // Countdown
    if (w.date) {
      var parts = w.date.split('-').map(Number);
      var target = new Date(parts[0], parts[1] - 1, parts[2]).getTime();
      var renderCd = function () {
        var diff = target - Date.now();
        clear(cdBox);
        if (diff <= 0) { cdBox.appendChild(h('p', { class: 'sub', style: 'margin:22px 0 8px' }, 'Just married ♥')); return; }
        var d = Math.floor(diff / 86400000), hr = Math.floor(diff / 3600000) % 24, mn = Math.floor(diff / 60000) % 60;
        cdBox.appendChild(h('div', { class: 'count', role: 'timer', 'aria-label': d + ' days to go' },
          h('div', null, h('b', null, d), h('small', null, 'Days')), h('div', null, h('b', null, hr), h('small', null, 'Hours')), h('div', null, h('b', null, mn), h('small', null, 'Mins'))));
      };
      renderCd();
      var cdTimer = setInterval(renderCd, 30000);
      onLeave(function () { clearInterval(cdTimer); });
    }

    // Message
    if (w.message) {
      root.appendChild(h('section', { class: 'section' }, h('div', { class: 'wrap narrow center' },
        h('div', { class: 'eyebrow' }, 'A note from us'), h('div', { class: 'orn' }, '✦'), h('p', { class: 'letter' }, '“' + w.message + '”'),
        h('p', { class: 'muted', style: 'margin-top:14px' }, '— ' + w.partner1 + ' & ' + w.partner2))));
    }

    // Wishlist
    var wishBox = h('div', { class: 'wishgrid' });
    var wallBox = h('div');
    var statLine = h('p', { class: 'muted', style: 'margin-top:10px' });
    root.appendChild(h('section', { class: 'section', id: 'wishlist', style: 'padding-top:30px' }, h('div', { class: 'wrap' },
      h('div', { class: 'center' }, h('div', { class: 'eyebrow' }, w.partner1 + ' & ' + w.partner2 + '’s'), h('h2', { style: 'margin-top:8px' }, 'Dream Wishlist'), statLine,
        h('p', { class: 'muted', style: 'margin-top:6px' }, 'Choose a dream and give any amount. Every bit counts.')),
      wishBox)));
    root.appendChild(h('section', { class: 'section band' }, h('div', { class: 'wrap' },
      h('div', { class: 'center' }, h('div', { class: 'eyebrow' }, 'Wall of wishes'), h('h2', { style: 'margin-top:8px' }, 'Blessings from our people')), wallBox)));
    root.appendChild(h('section', { class: 'section', style: 'padding:50px 0' }, h('div', { class: 'wrap narrow center' },
      h('p', { class: 'muted' }, 'Want a wishlist like this for your own celebration?'),
      h('a', { class: 'btn ghost', style: 'margin-top:12px', href: '#/create' }, 'Create yours on ' + (CFG.BRAND || 'WishKnot')))));
    root.appendChild(footer());
    app.appendChild(root);

    var current = w;
    function paint() {
      var t = totals(current);
      clear(wishBox);
      current.items.forEach(function (it) { wishBox.appendChild(wishCard(it, t, { onGift: function (item) { openGift(current, item, id, function (fresh) { current = fresh; paint(); confetti(); }); } })); });
      var goalSum = current.items.reduce(function (s, i) { return s + i.goal; }, 0);
      statLine.textContent = inr(t.confTotal) + ' gifted of ' + inr(goalSum) + ' dreamed';
      clear(wallBox);
      var notes = current.contributions.filter(function (c) { return c.message; }).slice().reverse();
      if (!notes.length) wallBox.appendChild(h('div', { class: 'empty', style: 'margin-top:28px' }, 'Be the first to leave a blessing ♥'));
      else {
        var grid = h('div', { class: 'wall' });
        notes.slice(0, 40).forEach(function (c) {
          var it = current.items.filter(function (x) { return x.id === c.itemId; })[0];
          grid.appendChild(h('div', { class: 'wish-note' }, h('div', { class: 'who' }, c.name), it ? h('div', { class: 'for' }, 'for ' + it.emoji + ' ' + it.title) : null, h('p', null, '“' + c.message + '”')));
        });
        wallBox.appendChild(grid);
      }
    }
    paint();

    // Gentle live refresh so guests see progress move.
    if (Api.mode === 'server' && id !== 'demo') {
      var poll = setInterval(function () {
        if (document.querySelector('dialog[open]') || app.__token !== token) return;
        Api.req('GET', '/weddings/' + id).then(function (fresh) { if (app.__token === token && !document.querySelector('dialog[open]')) { current = fresh; paint(); } }, function () { /* ignore */ });
      }, 20000);
      onLeave(function () { clearInterval(poll); });
    }
  }

  function openGift(w, item, id, done) {
    var dlg = h('dialog', { 'aria-label': 'Contribute to ' + item.title });
    var body = h('div', { class: 'dlg' });
    dlg.appendChild(body);
    document.body.appendChild(dlg);
    dlg.addEventListener('close', function () { if (dlg.parentNode) dlg.parentNode.removeChild(dlg); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });

    var amount = 1000, name = '', msg = '';
    var hasPay = !!(w.qr || w.upiId);

    function stepOne() {
      clear(body);
      var amtInput = h('input', { type: 'number', min: '1', max: '1000000', step: '1', inputmode: 'numeric', id: 'g-amt', placeholder: 'Other amount' });
      var chipBtns = [];
      function syncChips() { chipBtns.forEach(function (b) { b.btn.className = 'chip' + (Number(amount) === b.v ? ' on' : ''); }); }
      var chips = h('div', { class: 'amounts' });
      [500, 1000, 2000, 5000].forEach(function (v) {
        var b = h('button', { class: 'chip', type: 'button', onclick: function () { amount = v; amtInput.value = ''; syncChips(); } }, inr(v));
        chipBtns.push({ btn: b, v: v }); chips.appendChild(b);
      });
      amtInput.addEventListener('input', function () { amount = amtInput.value === '' ? '' : Number(amtInput.value); syncChips(); });
      syncChips();
      var nameIn = h('input', { type: 'text', id: 'g-name', maxlength: '60', placeholder: 'Your name', autocomplete: 'name' }); nameIn.value = name;
      var msgIn = h('textarea', { id: 'g-msg', maxlength: '300', placeholder: 'Write a blessing (optional)' }); msgIn.value = msg; msgIn.style.minHeight = '80px';
      var err = h('div', { class: 'err', style: 'display:none', role: 'alert' });
      body.appendChild(h('div', null,
        h('div', { class: 'eyebrow' }, item.emoji + ' ' + item.title),
        h('h3', { style: 'margin-top:6px' }, 'Make it happen'),
        h('p', { class: 'muted', style: 'margin:4px 0 16px' }, 'Pick an amount. You will pay the couple directly in the next step.'),
        err,
        h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Amount'), chips, amtInput),
        h('div', { class: 'field' }, h('label', { htmlFor: 'g-name' }, 'Your name'), nameIn),
        h('div', { class: 'field' }, h('label', { htmlFor: 'g-msg' }, 'Blessing for the couple'), msgIn),
        h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
          h('button', { class: 'btn primary', type: 'button', onclick: function () {
            name = nameIn.value.trim(); msg = msgIn.value.trim();
            if (!(Number.isInteger(amount) && amount >= 1 && amount <= 1000000)) { err.textContent = 'Please choose or enter an amount in whole rupees (up to ₹10,00,000).'; err.style.display = 'block'; return; }
            if (!name) { err.textContent = 'Please tell the couple who this gift is from.'; err.style.display = 'block'; nameIn.focus(); return; }
            stepTwo();
          } }, 'Continue'),
          h('button', { class: 'btn ghost', type: 'button', onclick: function () { dlg.close(); } }, 'Cancel'))));
    }

    function upiLink() {
      return 'upi://pay?pa=' + encodeURIComponent(w.upiId) + '&pn=' + encodeURIComponent(w.partner1 + ' & ' + w.partner2) + '&am=' + encodeURIComponent(String(amount)) + '&cu=INR&tn=' + encodeURIComponent('Wedding gift: ' + item.title);
    }

    function stepTwo() {
      clear(body);
      var isDemo = id === 'demo';
      var btn = h('button', { class: 'btn primary', type: 'button' }, 'I’ve paid ' + inr(amount));
      var err = h('div', { class: 'err', style: 'display:none', role: 'alert' });
      btn.addEventListener('click', function () {
        btn.disabled = true; btn.textContent = 'Saving…';
        Api.req('POST', '/weddings/' + id + '/contributions', { itemId: item.id, amount: amount, name: name, message: msg }).then(function () {
          return Api.req('GET', '/weddings/' + id);
        }).then(function (fresh) {
          dlg.close(); toast('Thank you, ' + name + '! The couple will confirm your gift. ♥'); done(fresh);
        }, function (e) { btn.disabled = false; btn.textContent = 'I’ve paid ' + inr(amount); err.textContent = e.message; err.style.display = 'block'; });
      });
      var qrSrc = w.qr || (isDemo ? demoQr() : '');
      body.appendChild(h('div', null,
        h('div', { class: 'eyebrow center' }, item.emoji + ' ' + item.title),
        h('div', { class: 'pay-amt', style: 'margin-top:8px' }, inr(amount)),
        h('p', { class: 'muted center', style: 'margin-top:6px' }, 'Scan this QR with any UPI app to pay ' + w.partner1 + ' & ' + w.partner2),
        qrSrc ? h('img', { class: 'pay-qr', src: qrSrc, alt: isDemo ? 'Sample QR (not real)' : 'Payment QR code' }) : h('div', { class: 'empty', style: 'margin:14px 0' }, 'The couple has not added a payment QR yet.'),
        isDemo ? h('p', { class: 'hint center' }, 'Sample only. In a real wishlist, this is the couple’s own payment QR.') : null,
        w.upiId ? h('div', { class: 'upi-line' }, 'UPI ID: ', h('code', { class: 'upi' }, w.upiId), h('button', { class: 'btn ghost small', type: 'button', onclick: function () { copyText(w.upiId); } }, 'Copy')) : null,
        err,
        h('div', { class: 'stack' },
          w.upiId ? h('a', { class: 'btn ghost', href: upiLink() }, 'Open my UPI app') : null,
          hasPay || isDemo ? btn : null,
          hasPay || isDemo ? h('p', { class: 'hint center' }, 'Tap “I’ve paid” after you pay, so the couple can match your gift.') : null,
          h('button', { class: 'btn ghost', type: 'button', onclick: stepOne }, '← Back'))));
    }

    stepOne();
    dlg.showModal();
  }

  // A decorative placeholder used only on the sample page. It is not a scannable code.
  function demoQr() {
    var n = 21, cell = 10, s = '';
    var seed = 7;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    function finder(x, y) {
      return '<rect x="' + x * cell + '" y="' + y * cell + '" width="' + 7 * cell + '" height="' + 7 * cell + '" fill="#111"/><rect x="' + (x + 1) * cell + '" y="' + (y + 1) * cell + '" width="' + 5 * cell + '" height="' + 5 * cell + '" fill="#fff"/><rect x="' + (x + 2) * cell + '" y="' + (y + 2) * cell + '" width="' + 3 * cell + '" height="' + 3 * cell + '" fill="#111"/>';
    }
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      var inFinder = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
      if (!inFinder && rnd() > 0.52) s += '<rect x="' + x * cell + '" y="' + y * cell + '" width="' + cell + '" height="' + cell + '" fill="#111"/>';
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n * cell + ' ' + n * cell + '"><rect width="100%" height="100%" fill="#fff"/>' + s + finder(0, 0) + finder(n - 7, 0) + finder(0, n - 7) + '</svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  /* =====================================================================
     Organizer dashboard
     ===================================================================== */
  function pageManage(id, keyFromUrl) {
    var key = keyFromUrl || savedKey(id);
    var wrap = h('div', { class: 'wrap fade', style: 'padding-bottom:50px' });
    wrap.appendChild(h('nav', { class: 'nav' }, brandEl(), h('a', { class: 'link', href: '#/w/' + id, style: 'text-decoration:none' }, 'View guest page →')));
    app.appendChild(wrap);
    if (!key) return manageDenied(wrap, 'Open your private dashboard link to manage this wishlist.');
    Api.req('GET', '/weddings/' + id + '/verify', null, key).then(function () {
      rememberKey(id, key);
      return Api.req('GET', '/weddings/' + id);
    }).then(function (w) { renderManage(wrap, w, id, key); }, function (e) { manageDenied(wrap, e.message); });
  }
  function manageDenied(wrap, msg) {
    wrap.appendChild(h('div', { class: 'center', style: 'padding:60px 0' }, h('h2', null, 'This page is private'), h('p', { class: 'muted', style: 'margin:12px 0 22px' }, msg), h('a', { class: 'btn primary', href: '#/' }, 'Go to home')));
  }

  function renderManage(wrap, w, id, key) {
    document.title = 'Dashboard | ' + w.partner1 + ' & ' + w.partner2;
    var body = h('div');
    wrap.appendChild(body);

    function reload() {
      return Api.req('GET', '/weddings/' + id).then(function (fresh) { w = fresh; view(); }, function (e) { toast(e.message, true); });
    }
    function act(c, action, okMsg) {
      return Api.req('PATCH', '/weddings/' + id + '/contributions/' + c.id, { action: action }, key).then(function (fresh) { w = fresh; view(); toast(okMsg); }, function (e) { toast(e.message, true); });
    }

    function view() {
      clear(body);
      var t = totals(w);
      var fee = Math.round(t.confTotal * Api.commission) / 100;
      var gl = guestLink(id);
      body.appendChild(h('div', { class: 'page-head' }, h('div', { class: 'eyebrow' }, 'Private dashboard'), h('h1', null, w.partner1 + ' & ' + w.partner2)));
      body.appendChild(h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('small', null, 'Confirmed gifts'), h('b', null, inr(t.confTotal))),
        h('div', { class: 'stat' }, h('small', null, 'Waiting for you to confirm'), h('b', null, inr(t.pendTotal))),
        h('div', { class: 'stat' }, h('small', null, 'Guests who gave'), h('b', null, String(w.contributions.length))),
        h('div', { class: 'stat' }, h('small', null, 'Platform fee (' + Api.commission + '%)'), h('b', null, inr(fee)))));

      body.appendChild(h('div', { class: 'card form-card' },
        h('h3', null, 'Share with guests'),
        h('div', { class: 'copyline' }, h('input', { type: 'text', readonly: true, value: gl, 'aria-label': 'Guest link', onfocus: function (e) { e.target.select(); } })),
        shareButtons(gl, 'Join us in celebrating ' + w.partner1 + ' & ' + w.partner2 + '! Here is our wedding wishlist:')));

      var items = h('div', { class: 'wishgrid', style: 'margin-top:14px' });
      w.items.forEach(function (it) { items.appendChild(wishCard(it, t)); });
      body.appendChild(h('div', { class: 'card form-card' },
        h('div', { style: 'display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap' },
          h('h3', null, 'Your wishlist'),
          h('button', { class: 'btn ghost small', type: 'button', onclick: editView }, 'Edit wishlist & QR')),
        items));

      var list = h('div', { class: 'list' });
      if (!w.contributions.length) list.appendChild(h('div', { class: 'empty' }, 'No gifts yet. Share your link to get started.'));
      w.contributions.slice().reverse().forEach(function (c) {
        var it = w.items.filter(function (x) { return x.id === c.itemId; })[0];
        list.appendChild(h('div', { class: 'crow' },
          h('div', null,
            h('div', { class: 't' }, c.name + ' · ' + inr(c.amount) + ' ', h('span', { class: 'badge ' + (c.status === 'confirmed' ? 'ok' : 'wait') }, c.status === 'confirmed' ? 'Confirmed' : 'Waiting')),
            h('div', { class: 's' }, (it ? it.emoji + ' ' + it.title : 'Removed wish') + ' · ' + new Date(c.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })),
            c.message ? h('div', { class: 's', style: 'font-style:italic;margin-top:4px' }, '“' + c.message + '”') : null),
          h('div', { class: 'btns' },
            c.status === 'confirmed'
              ? h('button', { class: 'btn ghost small', type: 'button', onclick: function () { act(c, 'unconfirm', 'Marked as waiting.'); } }, 'Mark waiting')
              : h('button', { class: 'btn primary small', type: 'button', onclick: function () { act(c, 'confirm', 'Gift confirmed ✓'); } }, 'I received it'),
            h('button', { class: 'btn danger small', type: 'button', onclick: function () { if (window.confirm('Remove this gift from the list?')) act(c, 'delete', 'Gift removed.'); } }, 'Remove'))));
      });
      body.appendChild(h('div', { class: 'card form-card' },
        h('h3', null, 'Gifts'),
        h('p', { class: 'muted' }, 'Guests tap “I’ve paid” after paying your QR. Check your UPI app, then tap “I received it” so the progress bar fills up.'),
        list));

      var feeNote = h('div', { class: 'card form-card' },
        h('h3', null, 'Platform fee'),
        h('p', { class: 'muted', style: 'margin:6px 0 12px' }, 'WishKnot charges ' + Api.commission + '% of confirmed gifts. Right now that is ', h('b', null, inr(fee)), ' on ' + inr(t.confTotal) + '.'),
        CFG.PLATFORM_UPI_ID && fee > 0
          ? h('a', { class: 'btn primary small', href: 'upi://pay?pa=' + encodeURIComponent(CFG.PLATFORM_UPI_ID) + '&pn=' + encodeURIComponent(CFG.PLATFORM_PAYEE_NAME || 'WishKnot') + '&am=' + encodeURIComponent(fee.toFixed(2)) + '&cu=INR&tn=' + encodeURIComponent('WishKnot fee ' + id) }, 'Pay ' + inr(fee) + ' fee')
          : h('a', { class: 'btn ghost small', href: 'mailto:' + (CFG.CONTACT_EMAIL || '') + '?subject=' + encodeURIComponent('Platform fee for wishlist ' + id) }, 'Contact us to settle'));
      body.appendChild(feeNote);
      body.appendChild(contactBlockCompact());
    }

    function editView() {
      clear(body);
      window.scrollTo(0, 0);
      body.appendChild(h('div', { class: 'page-head' }, h('div', { class: 'eyebrow' }, 'Editing'), h('h1', null, 'Edit your wishlist')));
      body.appendChild(wishForm(w, {
        submitLabel: 'Save changes',
        onCancel: view,
        onSubmit: function (payload) {
          return Api.req('PUT', '/weddings/' + id, payload, key).then(function (fresh) { w = fresh; view(); window.scrollTo(0, 0); toast('Saved ✓'); });
        }
      }));
    }
    view();
  }
  function contactBlockCompact() {
    return h('p', { class: 'muted center', style: 'margin-top:26px' }, 'Need help? Write to ', h('a', { href: 'mailto:' + (CFG.CONTACT_EMAIL || '') }, CFG.CONTACT_EMAIL || ''));
  }

  /* =====================================================================
     Admin (platform owner): total platform fee across all wishlists
     ===================================================================== */
  function pageAdmin() {
    var wrap = h('div', { class: 'wrap narrow fade', style: 'padding-bottom:50px' });
    wrap.appendChild(h('nav', { class: 'nav' }, brandEl()));
    wrap.appendChild(h('div', { class: 'page-head' }, h('div', { class: 'eyebrow' }, 'Platform owner'), h('h1', null, 'Fee overview')));
    var out = h('div');
    var tok = h('input', { type: 'text', id: 'adm', autocomplete: 'off', placeholder: 'Admin token' });
    tok.type = 'password';
    var go = h('button', { class: 'btn primary', type: 'submit' }, 'Show');
    wrap.appendChild(h('form', { class: 'card form-card', onsubmit: function (e) {
      e.preventDefault();
      clear(out);
      if (Api.mode !== 'server') { out.appendChild(h('div', { class: 'err' }, 'The admin view only works when the site runs on the server.')); return; }
      fetch('api/admin/summary', { headers: { 'x-admin-token': tok.value }, cache: 'no-store' }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Failed'); return d; }); }).then(function (d) {
        out.appendChild(h('div', { class: 'stats', style: 'margin-top:18px' },
          h('div', { class: 'stat' }, h('small', null, 'Wishlists'), h('b', null, String(d.weddings.length))),
          h('div', { class: 'stat' }, h('small', null, 'Confirmed gifts'), h('b', null, inr(d.totalConfirmed))),
          h('div', { class: 'stat' }, h('small', null, 'Your fee (' + d.commissionPct + '%)'), h('b', null, inr(d.totalFeeDue)))));
        var tb = h('tbody');
        d.weddings.forEach(function (r) { tb.appendChild(h('tr', null, h('td', null, r.couple), h('td', null, String(r.contributions)), h('td', null, inr(r.confirmedTotal)), h('td', null, inr(r.pendingTotal)), h('td', null, inr(r.feeDue)))); });
        out.appendChild(h('div', { class: 'table-scroll' }, h('table', { class: 'sum' }, h('thead', null, h('tr', null, h('th', null, 'Couple'), h('th', null, 'Gifts'), h('th', null, 'Confirmed'), h('th', null, 'Waiting'), h('th', null, 'Fee due'))), tb)));
      }, function (err) { out.appendChild(h('div', { class: 'err' }, err.message)); });
    } },
      h('div', { class: 'field' }, h('label', { htmlFor: 'adm' }, 'Admin token'), tok), go, out));
    app.appendChild(wrap);
  }

  /* ---------- start ---------- */
  window.addEventListener('hashchange', function () {
    var id = location.hash;
    if (/^#(how|contact|wishlist)$/.test(id)) { var t = document.getElementById(id.slice(1)); if (t) t.scrollIntoView({ behavior: 'smooth' }); return; }
    route();
  });
  Api.init().then(route, route);
})();
