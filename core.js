/*
 * WishKnot core: all data rules live here.
 * The same file runs on the server (Node) and in the browser (demo / offline mode),
 * so both behave identically.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WKCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var L = {
    items: 12, title: 60, note: 120, name: 60, partner: 40, msg: 300, wmsg: 600,
    maxAmount: 1000000, maxGoal: 10000000, qrLen: 600000, contribs: 3000
  };
  var THEMES = ['blush', 'sage', 'midnight'];

  function httpErr(status, message) { var e = new Error(message); e.status = status; return e; }

  function cryptoObj() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) return globalThis.crypto;
    if (typeof require === 'function') return require('crypto').webcrypto;
    throw new Error('No secure random source available');
  }
  function rid(n) {
    var chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    var a = new Uint8Array(n);
    cryptoObj().getRandomValues(a);
    var s = '';
    for (var i = 0; i < n; i++) s += chars[a[i] % chars.length];
    return s;
  }

  function clean(v, max) {
    if (typeof v !== 'string') return '';
    var s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    return Array.from(s).slice(0, max).join('');
  }
  function toInt(v) {
    var n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return typeof n === 'number' && Number.isInteger(n) ? n : NaN;
  }
  function validDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }

  function parseWeddingInput(input, existingItems) {
    if (!input || typeof input !== 'object') throw httpErr(400, 'Missing details.');
    var partner1 = clean(input.partner1, L.partner);
    var partner2 = clean(input.partner2, L.partner);
    if (!partner1 || !partner2) throw httpErr(400, 'Please enter both names.');

    var date = typeof input.date === 'string' ? input.date.trim() : '';
    if (date && !validDate(date)) throw httpErr(400, 'That wedding date is not valid.');

    var message = clean(input.message, L.wmsg);
    var theme = THEMES.indexOf(input.theme) >= 0 ? input.theme : 'blush';

    var upiId = typeof input.upiId === 'string' ? input.upiId.trim() : '';
    if (upiId && !/^[a-zA-Z0-9.\-_]{2,100}@[a-zA-Z][a-zA-Z0-9]{1,30}$/.test(upiId)) {
      throw httpErr(400, 'That UPI ID does not look right (it should look like name@bank).');
    }

    var qr = typeof input.qr === 'string' ? input.qr : '';
    if (qr) {
      if (qr.length > L.qrLen) throw httpErr(400, 'The QR image is too large. Please upload a smaller one.');
      if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(qr)) throw httpErr(400, 'The QR must be a PNG or JPG image.');
    }

    if (!Array.isArray(input.items) || input.items.length < 1) throw httpErr(400, 'Add at least one wish to your wishlist.');
    if (input.items.length > L.items) throw httpErr(400, 'You can add up to ' + L.items + ' wishes.');
    var known = {};
    (existingItems || []).forEach(function (it) { known[it.id] = true; });
    var seen = {};
    var items = input.items.map(function (raw) {
      raw = raw || {};
      var title = clean(raw.title, L.title);
      if (!title) throw httpErr(400, 'Every wish needs a title.');
      var goal = toInt(raw.goal);
      if (!(goal >= 1 && goal <= L.maxGoal)) throw httpErr(400, 'Every wish needs a goal amount between 1 and ' + L.maxGoal + '.');
      var id = typeof raw.id === 'string' && known[raw.id] && !seen[raw.id] ? raw.id : rid(8);
      seen[id] = true;
      return { id: id, title: title, emoji: clean(raw.emoji, 4) || '🎁', note: clean(raw.note, L.note), goal: goal };
    });
    return { partner1: partner1, partner2: partner2, date: date, message: message, theme: theme, upiId: upiId, qr: qr, items: items };
  }

  function publicView(w) {
    var c = {};
    Object.keys(w).forEach(function (k) { if (k !== 'key') c[k] = w[k]; });
    return c;
  }

  function summary(db, pct) {
    var rows = Object.keys(db.weddings).map(function (id) {
      var w = db.weddings[id];
      var conf = 0, pend = 0, n = 0;
      w.contributions.forEach(function (c) { n++; if (c.status === 'confirmed') conf += c.amount; else pend += c.amount; });
      return {
        id: id, couple: w.partner1 + ' & ' + w.partner2, createdAt: w.createdAt,
        contributions: n, confirmedTotal: conf, pendingTotal: pend, feeDue: Math.round(conf * pct) / 100
      };
    });
    var totalFee = rows.reduce(function (s, r) { return s + r.feeDue; }, 0);
    var totalConf = rows.reduce(function (s, r) { return s + r.confirmedTotal; }, 0);
    return { commissionPct: pct, weddings: rows, totalConfirmed: totalConf, totalFeeDue: Math.round(totalFee * 100) / 100 };
  }

  function getWedding(db, id) {
    var w = typeof id === 'string' && Object.prototype.hasOwnProperty.call(db.weddings, id) ? db.weddings[id] : null;
    if (!w) throw httpErr(404, 'We could not find that wishlist. Please check the link.');
    return w;
  }
  function requireKey(w, key) {
    if (typeof key !== 'string' || !key || key !== w.key) throw httpErr(403, 'This private link is not valid.');
  }

  /*
   * handle(db, method, path, body, key, opts) -> { status, data, mutated }
   * path examples: /weddings, /weddings/abc123, /weddings/abc123/contributions
   */
  function handle(db, method, path, body, key, opts) {
    try {
      var m;
      if (method === 'POST' && path === '/weddings') {
        var parsed = parseWeddingInput(body, []);
        var id = rid(8);
        while (db.weddings[id]) id = rid(8);
        var w = Object.assign({ id: id, key: rid(24), createdAt: new Date().toISOString(), contributions: [] }, parsed);
        db.weddings[id] = w;
        return { status: 201, data: { id: id, key: w.key }, mutated: true };
      }
      if ((m = /^\/weddings\/([a-z0-9]{4,24})$/.exec(path))) {
        var w1 = getWedding(db, m[1]);
        if (method === 'GET') return { status: 200, data: publicView(w1), mutated: false };
        if (method === 'PUT') {
          requireKey(w1, key);
          var p = parseWeddingInput(body, w1.items);
          var keep = {};
          p.items.forEach(function (it) { keep[it.id] = true; });
          w1.items.forEach(function (old) {
            if (!keep[old.id] && w1.contributions.some(function (c) { return c.itemId === old.id; })) {
              throw httpErr(409, '"' + old.title + '" already has gifts, so it cannot be removed.');
            }
          });
          Object.assign(w1, p);
          return { status: 200, data: publicView(w1), mutated: true };
        }
      }
      if ((m = /^\/weddings\/([a-z0-9]{4,24})\/verify$/.exec(path)) && method === 'GET') {
        var w2 = getWedding(db, m[1]);
        requireKey(w2, key);
        return { status: 200, data: { ok: true }, mutated: false };
      }
      if ((m = /^\/weddings\/([a-z0-9]{4,24})\/contributions$/.exec(path)) && method === 'POST') {
        var w3 = getWedding(db, m[1]);
        body = body || {};
        var item = w3.items.filter(function (it) { return it.id === body.itemId; })[0];
        if (!item) throw httpErr(400, 'That wish no longer exists.');
        var amount = toInt(body.amount);
        if (!(amount >= 1 && amount <= L.maxAmount)) throw httpErr(400, 'Please enter an amount between ₹1 and ₹' + L.maxAmount.toLocaleString('en-IN') + '.');
        if (w3.contributions.length >= L.contribs) throw httpErr(429, 'This wishlist has reached its limit.');
        var c = {
          id: rid(10), itemId: item.id, name: clean(body.name, L.name) || 'A well-wisher',
          amount: amount, message: clean(body.message, L.msg), status: 'pending', createdAt: new Date().toISOString()
        };
        w3.contributions.push(c);
        return { status: 201, data: c, mutated: true };
      }
      if ((m = /^\/weddings\/([a-z0-9]{4,24})\/contributions\/([a-z0-9]{4,24})$/.exec(path)) && method === 'PATCH') {
        var w4 = getWedding(db, m[1]);
        requireKey(w4, key);
        var idx = -1;
        w4.contributions.forEach(function (c, i) { if (c.id === m[2]) idx = i; });
        if (idx < 0) throw httpErr(404, 'That gift was not found.');
        var action = body && body.action;
        if (action === 'confirm') w4.contributions[idx].status = 'confirmed';
        else if (action === 'unconfirm') w4.contributions[idx].status = 'pending';
        else if (action === 'delete') w4.contributions.splice(idx, 1);
        else throw httpErr(400, 'Unknown action.');
        return { status: 200, data: publicView(w4), mutated: true };
      }
      throw httpErr(404, 'Not found.');
    } catch (e) {
      if (e && e.status) return { status: e.status, data: { error: e.message }, mutated: false };
      throw e;
    }
  }

  // A sample wishlist used by the public demo page (kept in memory only).
  function seedDemo(db) {
    var items = [
      { id: 'honeymoon', title: 'Honeymoon in Europe', emoji: '✈️', note: 'Two weeks, three countries, zero alarms.', goal: 300000 },
      { id: 'home', title: 'First home down payment', emoji: '🏠', note: 'The keys to our first little place.', goal: 1000000 },
      { id: 'sofa', title: 'The dream sofa', emoji: '🛋️', note: 'For many, many movie nights.', goal: 60000 },
      { id: 'dinner', title: 'Anniversary dinner', emoji: '🍽️', note: 'One fancy night out, on you.', goal: 15000 }
    ];
    var t = Date.now();
    function c(i, item, name, amount, message, status) {
      return { id: 'demo' + i, itemId: item, name: name, amount: amount, message: message, status: status, createdAt: new Date(t - i * 3600000).toISOString() };
    }
    db.weddings.demo = {
      id: 'demo', key: 'demo-key', createdAt: new Date(t).toISOString(),
      partner1: 'Aisha', partner2: 'Kabir', date: '2027-02-14', theme: 'blush', upiId: '', qr: '',
      message: 'Your love and blessings are the best gift we could ask for. If you would like to give something more, help us start our life together with a few dreams we are saving for. Thank you for celebrating with us!',
      items: items,
      contributions: [
        c(1, 'honeymoon', 'Neha', 5000, 'Send us pictures of the Eiffel Tower!', 'confirmed'),
        c(2, 'honeymoon', 'Rohan & Meera', 10000, 'Bon voyage, you two ❤️', 'confirmed'),
        c(3, 'home', 'Sharma Uncle', 51000, 'Blessings for your new home.', 'confirmed'),
        c(4, 'sofa', 'Priya', 2500, 'For the sofa where I will be sleeping at your place.', 'confirmed'),
        c(5, 'dinner', 'Arjun', 1500, 'Dinner is on me. Congratulations!', 'confirmed')
      ]
    };
  }

  return { handle: handle, summary: summary, seedDemo: seedDemo, LIMITS: L, THEMES: THEMES };
});
