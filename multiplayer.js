/* multiplayer.js — Rimba Nusantara: TRANSPORT MULTIPLAYER (Firebase Realtime Database)
   Dimuat SETELAH map.js dan main.js. Memakai hook ForestMap.net dari main.js:
     net.get()  -> state pemain lokal        net.upsert / net.remove -> pemain jarak jauh
     net.emit   -> kirim event (fire, spear, chat, admin)   net.fire/spear/chat/admin -> event masuk
     net.onLogin / net.onLogout / net.setName
   Struktur database:
     rn/players/<ID>  = { name, s:{...state}, ts }     (dihapus otomatis saat putus lewat onDisconnect)
     rn/events/<push> = { type, from, data, t }          (dibersihkan sendiri setelah beberapa detik)
   PENTING: Rules database harus mengizinkan baca/tulis pada "rn" (lihat README di jawaban). */
(function () {
  "use strict";
  var FM = window.ForestMap;
  if (!FM) { console.error("[multiplayer] ForestMap tidak ada: map.js & main.js harus dimuat dulu"); return; }
  // ForestMap.net baru dibuat main.js saat tombol Play ditekan, jadi dipasang belakangan lewat attach()
  var net = { status: "connecting" };

  var CFG = {
    apiKey: "AIzaSyCebKHJs-e-oUKDp4UbCN64o6rBL8SC7bI",
    authDomain: "berburu-animals.firebaseapp.com",
    databaseURL: "https://berburu-animals-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "berburu-animals",
    appId: "1:824631771581:web:4b5e2302ae57e763ce92d4"
  };
  var SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
  var ROOT = "rn";
  var SEND_MS = 120, BEAT_MS = 4000, STALE_MS = 15000, EVENT_TTL = 8000;
  var EVENTS = { fire: 1, spear: 1, chat: 1, admin: 1 };

  var F = null, db = null, offset = 0, ready = false, joined = false;
  var uid = null, name = "", lastSent = "", lastSendT = 0, tickTimer = null, sweepTimer = null;
  var playersRef = null, eventsRef = null, meRef = null, unsubs = [], seen = {};

  var lastErr = "", badge = null;
  function fail(e, where) {
    var msg = String((e && (e.code || e.message)) || e);
    lastErr = /permission/i.test(msg) ? "Rules database menolak akses (publish database.rules.json)" : where + ": " + msg;
    console.warn("[multiplayer]", where, e); status("error"); paint();
  }
  function paint() {
    try {
      if (!badge && document.body && document.createElement) {
        badge = document.createElement("div");
        badge.style.cssText = "position:fixed;left:6px;top:calc(env(safe-area-inset-top,0px) + 6px);z-index:2147483647;font:11px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.55);padding:3px 7px;border-radius:4px;max-width:70vw;pointer-events:none";
        document.body.appendChild(badge);
      }
      if (!badge) return;
      var st = net.status, n = joined && net._list ? net._list().length + 1 : 0;
      badge.textContent = st === "online" ? "🟢 Online · " + n + " pemain" : st === "error" ? "🔴 " + (lastErr || "Error") : st === "offline" ? "🟠 Terputus, menyambung…" : "⏳ Menghubungkan…";
    } catch (e) {}
  }
  function status(s) { net.status = s; try { if (typeof net.onStatus === "function") net.onStatus(s); } catch (e) {} }
  function now() { return Date.now() + offset; }
  function clean(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } } // buang undefined/NaN
  function r1(v) { return typeof v === "number" && isFinite(v) ? Math.round(v * 10) / 10 : v; }

  function snapshotState() {
    var s = clean(net.get && net.get());
    if (!s) return null;
    s.x = r1(s.x); s.y = r1(s.y); s.a = r1(s.a); s.z = r1(s.z);
    if (s.walk != null) delete s.walk; // animasi jalan dihitung lokal di penerima dari selisih posisi
    return s;
  }

  function init(cb) {
    if (window.__RN_FB) { F = window.__RN_FB; setup(cb); return; } // injeksi untuk pengujian
    Promise.all([import(SDK + "firebase-app.js"), import(SDK + "firebase-database.js")]).then(function (m) {
      var app = m[0].initializeApp(CFG), d = m[1];
      F = { db: d.getDatabase(app, CFG.databaseURL), ref: d.ref, set: d.set, update: d.update, remove: d.remove, push: d.push,
        onValue: d.onValue, onChildAdded: d.onChildAdded, onChildChanged: d.onChildChanged, onChildRemoved: d.onChildRemoved,
        onDisconnect: d.onDisconnect, query: d.query, limitToLast: d.limitToLast, serverTimestamp: d.serverTimestamp };
      setup(cb);
    }).catch(function (e) { fail(e, "muat Firebase (butuh HTTPS/localhost & internet)"); });
  }

  function setup(cb) {
    db = F.db;
    F.onValue(F.ref(db, ".info/serverTimeOffset"), function (s) { offset = +s.val() || 0; });
    F.onValue(F.ref(db, ".info/connected"), function (s) {
      var on = !!s.val(); status(on ? "online" : "offline");
      if (on && joined) announce(); // sambung ulang: daftarkan lagi kehadiran + onDisconnect
    });
    ready = true; if (cb) cb();
  }

  // ---------- kehadiran pemain ----------
  function announce() {
    if (!meRef) return;
    try { F.onDisconnect(meRef).remove(); } catch (e) {}
    pushState(true);
  }

  function pushState(force) {
    if (!joined || !meRef) return;
    var s = snapshotState(); if (!s) return;
    var sig = JSON.stringify(s), t = Date.now();
    if (!force && sig === lastSent && t - lastSendT < BEAT_MS) return;
    lastSent = sig; lastSendT = t;
    F.set(meRef, { name: name, s: s, ts: F.serverTimestamp ? F.serverTimestamp() : now() }).then(function () { if (net.status === "error") { lastErr = ""; status("online"); } }).catch(function (e) { fail(e, "tulis pemain"); });
  }

  function onPlayer(snap) {
    var id = snap.key, v = snap.val();
    if (id === uid || !v || !v.s) return;
    if (v.ts && now() - v.ts > STALE_MS) { net.remove(id); return; }
    var s = v.s; s.uid = id;
    net.upsert(id, String(v.name || "Pemain").slice(0, 16), s);
    var r = net.find(id); if (r) r.seenAt = Date.now();
  }
  function onGone(snap) { if (snap.key !== uid) net.remove(snap.key); }

  function sweep() { // buang pemain yang tidak kirim detak (tab ditutup paksa / sinyal hilang)
    var t = Date.now(), list = net._list ? net._list() : null;
    if (!list) return;
    for (var i = list.length - 1; i >= 0; i--) if (list[i].seenAt && t - list[i].seenAt > STALE_MS) net.remove(list[i].id);
  }

  // ---------- event (chat, tombak, api, admin) ----------
  function onEvent(snap) {
    var k = snap.key, v = snap.val();
    if (seen[k] || !v || v.from === uid || !EVENTS[v.type]) return;
    seen[k] = 1;
    if (v.t && now() - v.t > EVENT_TTL) return; // abaikan riwayat lama
    var h = net[v.type]; if (typeof h !== "function") return;
    try { h(v.from, v.data || {}); } catch (e) { console.error("[multiplayer] handler", v.type, e); }
  }

  // ---------- siklus hidup ----------
  function join(info) {
    if (!ready) { setTimeout(function () { join(info); }, 400); return; }
    if (joined) leave();
    uid = String(info.id); name = String(info.name || "Pemain").slice(0, 16); seen = {};
    playersRef = F.ref(db, ROOT + "/players"); eventsRef = F.ref(db, ROOT + "/events"); meRef = F.ref(db, ROOT + "/players/" + uid);
    joined = true;
    unsubs.push(F.onChildAdded(playersRef, onPlayer, function (e) { fail(e, "baca pemain"); }), F.onChildChanged(playersRef, onPlayer), F.onChildRemoved(playersRef, onGone));
    unsubs.push(F.onChildAdded(F.query(eventsRef, F.limitToLast(50)), onEvent));
    announce();
    tickTimer = setInterval(function () { pushState(false); }, SEND_MS);
    sweepTimer = setInterval(sweep, 3000);
  }

  function leave() {
    if (!joined) return;
    joined = false;
    clearInterval(tickTimer); clearInterval(sweepTimer);
    unsubs.forEach(function (u) { try { if (typeof u === "function") u(); } catch (e) {} }); unsubs = [];
    try { F.onDisconnect(meRef).cancel(); } catch (e) {}
    try { F.remove(meRef); } catch (e) {}
    // bersihkan semua pemain jarak jauh dari layar
    if (net._list) net._list().slice().forEach(function (r) { net.remove(r.id); });
  }

  function attach() {
  var real = FM.net; real.status = net.status; net = real;
  net.emit = function (type, data) {
    if (!ready || !joined || !eventsRef || !EVENTS[type]) return;
    var d = clean(data); if (!d) return;
    var ref = F.push(eventsRef);
    F.set(ref, { type: type, from: uid, data: d, t: F.serverTimestamp ? F.serverTimestamp() : now() }).then(function () {
      setTimeout(function () { try { F.remove(ref); } catch (e) {} }, EVENT_TTL);
    }).catch(function (e) { fail(e, "kirim event"); });
  };

  net.onLogin = function (info) { join(info); };
  net.onLogout = function () { leave(); };
  var oldSetName = net.setName;
  net.setName = function (n) { if (oldSetName) oldSetName(n); name = String(n || "Pemain").slice(0, 16); if (joined) pushState(true); };
  net.leave = leave;
  if (net.isLoggedIn && net.isLoggedIn()) join({ id: net.myId, name: net.getName() }); // sudah login otomatis sebelum hook terpasang
  }
  var wt = setInterval(function () { if (FM.net) { clearInterval(wt); attach(); } }, 30);

  // pemain keluar otomatis dihapus: tutup tab / pindah aplikasi (onDisconnect jadi cadangan bila koneksi putus mendadak)
  window.addEventListener("pagehide", function () { if (joined) { try { F.remove(meRef); } catch (e) {} } });
  window.addEventListener("pageshow", function () { if (ready && uid && !joined && net.isLoggedIn && net.isLoggedIn() && net.getName) join({ id: net.myId, name: net.getName() }); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && joined) announce(); });

  console.log("[multiplayer] v2 dimuat");
  status("connecting");
  setInterval(paint, 1000); paint();
  init();
  window.RNMultiplayer = { leave: leave, join: join, status: function () { return net.status; } };
})();
