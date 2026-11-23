/* main.js — Rimba Nusantara: KARAKTER & PERMAINAN
   Berisi: karakter pemain (model, pose, status tubuh), satwa liar (model + AI), kontrol (keyboard/sentuh/mouse),
   multiplayer, suara, tombak, api unggun, HUD, dan loop permainan.
   Login dengan nama + kata sandi (akun + ID otomatis RN-XXXXXX, permainan dijeda sampai login). Menu terpadu "☰ Menu" (Esc): tab Profil (P), Rakit (R), Tas (I), Misi (J), Dunia/pulau baru (N), Opsi, Bantuan (H), Admin (K, khusus owner). Isi tas (kayu, daging, alat, zirah, perahu) tersimpan per akun.
   Peta/dunia 3D (langit, tanah, air, vegetasi, cuaca, bencana, kamera) ada di map.js.

   URUTAN MEMUAT: map.js dulu, baru main.js.
   API tetap sama: ForestMap.generate(onProgress, onDone) lalu ForestMap.start(canvasElement)
   (canvasElement dipakai sebagai lapisan HUD 2D transparan). */
(function () {
  var FM = window.ForestMap;
  if (!FM || !FM.createWorld) throw new Error("main.js harus dimuat SETELAH map.js");
  var W = FM.WORLD, SPAWN = FM.SPAWN, R = FM.R, rnd = FM.rnd;
  var water = FM.water, flood = FM.flood, pblock = FM.pblock, hitTree = FM.hitTree, blocked = FM.blocked, groundY = FM.groundY;
  var animals = [];
  /* ZONA AMAN: lingkaran di sekitar titik awal. Satwa liar tidak bisa masuk / menyerang di dalamnya, nyawa pulih pelan.
     Ubah SAFE.r untuk memperbesar/memperkecil. Dapat dibaca modul lain lewat ForestMap.safeZone. */
  var SAFE = { x: SPAWN.x, y: SPAWN.y, r: 170 };
  function inSafe(x, y, m) { return Math.hypot(x - SAFE.x, y - SAFE.y) < SAFE.r + (m || 0); }
  FM.safeZone = SAFE;
  function extend(a, b) { for (var k in b) a[k] = b[k]; return a; }

  var D = {
    rusa:    { e: "🦌", name: "Rusa",       hp: 2, sp: 95,  fr: 180, pts: 3,  r: 11, n: 22 },
    kancil:  { e: "🐇", name: "Kancil",     hp: 1, sp: 130, fr: 200, pts: 5,  r: 8,  n: 18 },
    babi:    { e: "🐗", name: "Babi hutan", hp: 3, sp: 80,  fr: 0,   pts: 4,  r: 11, n: 18 },
    ayam:    { e: "🐓", name: "Ayam hutan", hp: 1, sp: 85,  fr: 150, pts: 1,  r: 8,  n: 28 },
    monyet:  { e: "🐒", name: "Monyet",     hp: 1, sp: 140, fr: 220, pts: 4,  r: 9,  n: 16 },
    merak:   { e: "🦚", name: "Merak",      hp: 1, sp: 100, fr: 170, pts: 6,  r: 10, n: 10 },
    biawak:  { e: "🦎", name: "Biawak",     hp: 2, sp: 55,  fr: 0,   pts: 3,  r: 9,  n: 10, aggr: 1, dmg: 7 },
    ular:    { e: "🐍", name: "Ular",       hp: 1, sp: 0,   fr: 0,   pts: 4,  r: 8,  n: 12, ambush: 1 },
    banteng: { e: "🐂", name: "Banteng",    hp: 4, sp: 90,  fr: 0,   pts: 8,  r: 14, n: 8 },
    gajah:   { e: "🐘", name: "Gajah",      hp: 8, sp: 80,  fr: 0,   pts: 12, r: 18, n: 3 },
    buaya:   { e: "🐊", name: "Buaya",      hp: 5, sp: 150, fr: 0,   pts: 12, r: 13, n: 5,  croc: 1 },
    harimau: { e: "🐅", name: "Harimau",    hp: 5, sp: 125, fr: 0,   pts: 15, r: 13, n: 4,  tiger: 1 }
  };

  function newAnimal(type, far) {
    var d = D[type], x, y, tries = 0;
    do {
      x = rnd(60, W - 60); y = rnd(60, W - 60); tries++;
    } while ((inSafe(x, y, d.r + 30) || blocked(x, y, d.r) || (far && Math.hypot(x - far.x, y - far.y) < 700) || (d.croc && !(water(x + 34, y) || water(x - 34, y) || water(x, y + 34) || water(x, y - 34)))) && tries < 700);
    return { type: type, d: d, x: x, y: y, hx: x, hy: y, hp: d.hp, vx: 0, vy: 0, t: 0, angry: false, face: 1, hd: Math.random() * 6.283 };
  }

  FM.animals = D;
  // satwa dibuat saat generate() (memakai seed peta supaya sama untuk semua pemain)
  FM.addGenStep("Melepas satwa liar…", function () {
    animals = [];
    for (var k in D) for (var i = 0; i < D[k].n; i++) animals.push(newAnimal(k, SPAWN));
  });

  /* ---------- permainan ---------- */
  function start(cv) {
    var ctx = cv.getContext("2d"), vw, vh, dpr;
    var TOUCH = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    var P, E, spears, floats, kills, score, keys = {}, stick = null, last = performance.now(), stumps = [], logs = [], toolUI = null, HITS = 5, houses = [], houseReg = [], menuOpen = false;
    var mini = FM.getTerrain();
    var orbit = null;

    function reset(fromStore) {
      var keep = (!fromStore && KEEP_BAG_ON_DEATH && P && loggedIn && invKey) ? invData() : null; // mati/mulai ulang: tas ikut dibawa
      var kadm = (!fromStore && P && loggedIn && isAdmin()) ? { inv: !!P.inv, icesp: !!P.icesp } : null; // mode admin tetap aktif setelah mati
      P = { x: SPAWN.x, y: SPAWN.y, hp: 100, a: 0, cd: 0, st: 100, hu: 85, th: 90, bleed: 0, meat: 0, eat: 0, walk: 0, face: 1, still: 0, z: 0, vz: 0, down: 0, dm: 1, hurt: 0, kx: 0, ky: 0, pois: 0, tp: 100, wet: 0, lx: SPAWN.x, ly: SPAWN.y, sw: false, wasSw: false, tool: "spear", cdm: .45, ca: 0, pend: 0, ch: null, wood: 0, armor: false, has: { sword: false, rod: false, boat: false }, rid: false, fs: null, fly: false, jail: 0, ice: 0, inv: false, icesp: false, q: [], qd: 0, inSafe: null };
      E = extend(FM.newEnv(E ? E.tod : .1), { foot: [], ft: 0, msg: "", mt: 0, drops: [], rip: [] });
      spears = []; floats = []; kills = {}; score = 0; logs = []; houses = []; closeCraft(); closeProfile();
      if (keep) applyInv(keep); else if (fromStore) loadInv();
      ensureQuests();
      if (kadm) { P.inv = kadm.inv; P.icesp = kadm.icesp; }
      if (toolUI) toolUI();
    }
    reset();

    /* dunia 3D (peta, langit, cahaya, air, vegetasi, cuaca, kamera) dibuat oleh map.js */
    var world = FM.createWorld(cv, TOUCH), THREE = window.THREE, scene = world.scene, camera = world.camera, cam = world.cam, scr = world.scr;
    cv.style.position = "fixed"; cv.style.left = "0"; cv.style.top = "0"; cv.style.width = "100%"; cv.style.height = "100%"; cv.style.zIndex = "1"; cv.style.background = "transparent";
    var BOX = world.BOX, SPH = world.SPH, CYL = world.CYL, CONE = world.CONE, M = world.M, mesh = world.mesh, bx = world.bx, sp = world.sp;
    var Pool = world.Pool, decal = world.decal, ring = world.ring;

    /* --- lampu milik karakter --- */
    var torch = new THREE.PointLight(0xffa04a, 0, 320, 1.2); scene.add(torch);
    /* --- Zona Aman: tiang bendera + bola cahaya hijau di tepi lingkaran --- */
    (function mkSafePosts() {
      var N = 20, i, an, px, py, g, pm = new THREE.MeshLambertMaterial({ color: 0x6b4a2a }), cm = new THREE.MeshBasicMaterial({ color: 0x8dffb0 }), fm2 = new THREE.MeshLambertMaterial({ color: 0x2f9e4f, side: THREE.DoubleSide });
      var pg = new THREE.CylinderGeometry(1.8, 2.4, 1, 8), cg = new THREE.SphereGeometry(4.2, 10, 8), fg = new THREE.BoxGeometry(14, 9, .8), pole, cap, flag;
      for (i = 0; i < N; i++) {
        an = i / N * 6.2832; px = SAFE.x + Math.cos(an) * SAFE.r; py = SAFE.y + Math.sin(an) * SAFE.r;
        if (water(px, py)) continue;
        g = new THREE.Group(); pole = new THREE.Mesh(pg, pm); cap = new THREE.Mesh(cg, cm); flag = new THREE.Mesh(fg, fm2);
        pole.scale.set(1, 56, 1); pole.position.y = 28; cap.position.y = 61; flag.position.set(8, 47, 0); flag.rotation.y = -an;
        g.add(pole); g.add(cap); g.add(flag); g.position.set(px, groundY(px, py), py); scene.add(g);
      }
    })();
    var fireL = []; (function () { for (var i = 0; i < 3; i++) { var l = new THREE.PointLight(0xff8a30, 0, 300, 1.2); scene.add(l); fireL.push(l); } })();

    /* --- karakter pemain (pengembara rimba) --- */
    var PCOL = { SK: 0xc58b5b, SKD: 0xa8714a, RED: 0xb02a2a, KAIN: 0x5a2412, HAIR: 0x1a1008, GOLD: 0xe3b95a, SHOE: 0x3a2410, IRON: 0x9aa3aa, IRND: 0x636c73 };
    var KAING = new THREE.CylinderGeometry(1, 1.28, 1, 10), BANDG = new THREE.CylinderGeometry(1, 1, 1, 10);
    function makePlayer() {
      var mats = {}, k;
      for (k in PCOL) mats[k] = new THREE.MeshLambertMaterial({ color: PCOL[k] });
      function pb(w, h, d, key, x, y, z, rx, ry, rz) { return mesh(BOX, mats[key], w, h, d, x, y, z, rx, ry, rz); }
      var root = new THREE.Group(), tilt = new THREE.Group(), legs = [], hd = new THREE.Group(), armL = new THREE.Group(), armR = new THREE.Group(), spear = new THREE.Group();
      root.add(tilt);
      [3.2, -3.2].forEach(function (z) { var p = new THREE.Group(); p.position.set(0, 14, z); p.add(pb(4.6, 13.5, 4.4, "SK", 0, -6.8, 0), pb(5.8, 3, 5, "SHOE", .9, -12.8, 0)); tilt.add(p); legs.push(p); });
      tilt.add(mesh(KAING, mats.KAIN, 5.3, 11, 5.9, 0, 11.2, 0), mesh(BANDG, mats.GOLD, 5.5, 1.5, 6.1, 0, 15.6, 0));
      tilt.add(pb(6.4, 11.5, 10.5, "SK", 0, 22, 0), pb(6.9, 2.4, 10.9, "RED", 0, 16.9, 0), pb(6.8, 2.2, 12.6, "RED", 0, 22.5, 0, .85, 0, 0));
      hd.position.set(0, 27.5, 0);
      hd.add(pb(8, 8, 8, "SK", 0, 4.4, 0), pb(8.6, 2.8, 8.6, "HAIR", 0, 8.7, 0), pb(2.4, 8, 8.6, "HAIR", -3.1, 4.6, 0), pb(8.7, 2.2, 8.8, "RED", 0, 7.1, 0), pb(2.4, 3.4, 2.4, "RED", -4.6, 8.2, 2.8),
        mesh(BOX, M(0x111111), .8, 1.6, 1.4, 4.05, 5, 2), mesh(BOX, M(0x111111), .8, 1.6, 1.4, 4.05, 5, -2), mesh(BOX, M(0x6b2a1a), .6, .8, 3, 4.05, 2.2, 0));
      tilt.add(hd);
      armL.position.set(0, 26, -6.4); armL.add(pb(3.8, 11, 3.8, "SKD", 0, -5.5, 0));
      armR.position.set(0, 26, 6.4); armR.add(pb(3.8, 11, 3.8, "SK", 0, -5.5, 0));
      spear.position.set(0, -10, 0); spear.add(mesh(BOX, M(0xcfa86a), 34, 1.1, 1.1, 8, 0, 0), mesh(CONE, M(0xcfd3d6), 1.5, 6, 1.5, 28, 0, 0, 0, 0, -Math.PI / 2));
      armR.add(spear);
      var axe = new THREE.Group(); axe.position.set(0, -10, 0); axe.visible = false; // kapak: gagang kayu + mata besi, ikut ayunan lengan
      axe.add(mesh(BOX, M(0x7a5230), 1.5, 18, 1.5, 0, -6, 0), mesh(BOX, M(0x9aa3aa), 6.5, 6, 1.6, 3.4, -13, 0), mesh(BOX, M(0xd9dfe3), .8, 7.4, 1.4, 6.9, -13, 0));
      armR.add(axe); tilt.add(armL, armR);
      var sword = new THREE.Group(); sword.position.set(0, -10, 0); sword.visible = false; // pedang: gagang + pelindung tangan + bilah
      sword.add(mesh(BOX, M(0x5a3a1c), 1.5, 5, 1.5, 0, -1, 0), mesh(BOX, M(0xe3b95a), 7, 1.3, 1.9, 0, -4, 0), mesh(BOX, M(0xdfe6ea), 2.6, 22, .8, 0, -15.5, 0), mesh(BOX, M(0xdfe6ea), 1.5, 3, .7, 0, -28, 0));
      armR.add(sword);
      var rod = new THREE.Group(); rod.position.set(0, -10, 0); rod.visible = false; // joran pancing
      rod.add(mesh(BOX, M(0x7a5a2a), 30, 1, 1, 12, 0, 0), mesh(BOX, M(0x3a3a3a), 2.4, 2.4, 2.4, 1, -1.6, 0));
      armR.add(rod);
      var aparts = []; function ap(par, m) { m.visible = false; par.add(m); aparts.push(m); } // zirah: hanya tampil jika dipakai
      ap(tilt, pb(7.4, 10.4, 11.6, "IRON", 0, 22.4, 0)); ap(tilt, pb(7.8, 2, 11.8, "IRND", 0, 27.4, 0)); ap(tilt, pb(7, 4.4, 11.2, "IRND", 0, 15.2, 0));
      ap(armL, pb(5, 3.4, 5, "IRON", 0, -.4, 0)); ap(armR, pb(5, 3.4, 5, "IRON", 0, -.4, 0));
      ap(hd, pb(9, 3.6, 9, "IRON", 0, 9.3, 0)); ap(hd, pb(.8, 4.4, 1.4, "IRND", 4.7, 5.4, 0)); ap(hd, pb(2.6, 2.2, 2.6, "RED", -1, 12, 0));
      var wound = pb(1, 3, 3, "RED", 3.4, 24, 2); wound.visible = false; tilt.add(wound);
      return { root: root, tilt: tilt, legs: legs, hd: hd, armL: armL, armR: armR, spear: spear, axe: axe, sword: sword, rod: rod, aparts: aparts, arOn: false, mats: mats, wound: wound };
    }
    function axeArm(cd, cdm) { // sudut lengan kanan saat memegang kapak: angkat -> tebas -> kembali
      if (cd <= 0) return .5;
      var u = 1 - Math.min(1, cd / cdm), x;
      if (u < .4) { x = u / .4; return .5 + 2.2 * x * x * (3 - 2 * x); }
      if (u < .62) return 2.7 - 2.35 * ((u - .4) / .22);
      return .35 + .15 * ((u - .62) / .38);
    }
    function posePlayer(pm, s, y, now) {
      var sw = Math.sin(s.walk || 0), qk = E.qk, sto = E.sto, bl = s.bleed ? 1 : 0, st = s.st == null ? 100 : s.st, swim = s.sw ? 1 : 0, cd = s.cd || 0;
      var sg = sw * (bl ? .45 : .85), armUp = qk * 1.1 + sto * 1.3 + swim * .5, lean = (bl ? 1.5 : 0) + sto * 2 + qk + swim * 2.5;
      var br = Math.sin(now / (st < 25 ? 140 : 900)) * .5 + sto * 1.5 - qk * .5 + Math.sin(now / 40) * qk * .6, bob = Math.abs(sw) * (bl ? .5 : 1);
      var dn = 0, wt = s.wet || 0, hurt = s.hurt || 0, shiv = wt > .5 && (E.dark > .4 || sto > .3) ? Math.sin(now / 35) * .7 : 0, k, c, kk = wt * .4;
      if (s.down > 0) dn = Math.max(0, Math.min(1, (s.dm - s.down) * 6, s.down * 6));
      pm.legs[0].rotation.z = sg; pm.legs[1].rotation.z = -sg;
      pm.armL.rotation.set(armUp, 0, -sg * .9);
      var rz = 1.25 - Math.sin(Math.max(0, Math.min(1, cd / (s.cdm || .45))) * Math.PI) * 1.5, tn = s.tool || "spear", ax = tn === "axe" || tn === "sword";
      if (ax) rz = axeArm(cd, s.cdm || .6);
      pm.armR.rotation.set(-armUp * .6, 0, rz);
      pm.spear.rotation.z = -pm.armR.rotation.z + .25; pm.spear.visible = tn === "spear" && cd <= .05; pm.axe.visible = tn === "axe"; pm.sword.visible = tn === "sword"; pm.rod.visible = tn === "rod"; pm.rod.rotation.z = -pm.armR.rotation.z + .75;
      var arOn = !!(s.armor || s.ar); if (pm.arOn !== arOn) { pm.arOn = arOn; pm.aparts.forEach(function (m) { m.visible = arOn; }); }
      pm.hd.position.y = 27.5 + br * .4; pm.hd.rotation.z = -lean * .03;
      pm.tilt.rotation.set(dn * 1.45 * (s.face || 1), 0, -lean * .06 - swim * .25); pm.tilt.scale.y = 1 - (qk * .16 + sto * .08); pm.tilt.position.set(0, 0, shiv);
      pm.root.position.y = y + bob + dn * 4.5;
      pm.wound.visible = !!bl;
      for (k in pm.mats) {
        c = PCOL[k]; pm.mats[k].color.setRGB(((c >> 16) * (1 - kk) + 20 * kk) / 255, (((c >> 8) & 255) * (1 - kk) + 40 * kk) / 255, ((c & 255) * (1 - kk) + 60 * kk) / 255);
        pm.mats[k].emissive.setRGB(hurt > 0 ? Math.min(1, hurt * 2) * .55 : 0, 0, 0);
      }
    }
    var me = makePlayer(); scene.add(me.root);

    /* --- perahu, kail pancing, rumah (model) --- */
    function makeBoat() {
      var g = new THREE.Group(), wd = 0x8a5a2b, dk = 0x5a3a1c;
      g.add(bx(46, 3, 18, dk, 0, 0, 0), bx(40, 5, 2.4, wd, -2, 3, 8.4), bx(40, 5, 2.4, wd, -2, 3, -8.4), bx(2.6, 6, 18, wd, -22.5, 3, 0),
        bx(14, 5, 2.4, wd, 25, 3, 4.8, 0, .75, 0), bx(14, 5, 2.4, wd, 25, 3, -4.8, 0, -.75, 0), bx(3, 1.4, 17, dk, -8, 2, 0), bx(3, 1.4, 17, dk, 6, 2, 0),
        bx(30, .8, 1.2, 0xc9a56a, 0, 6, 11.5, 0, .4, .35), bx(30, .8, 1.2, 0xc9a56a, 0, 6, -11.5, 0, -.4, -.35));
      g.visible = false; return g;
    }
    function boatShow(b, on, x, y, z, a) { b.visible = !!on; if (on) { b.position.set(x, y, z); b.rotation.y = -a; } }
    var myBoat = makeBoat(); scene.add(myBoat);
    var bob = new THREE.Mesh(new THREE.SphereGeometry(2.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b2f })), fline = new THREE.Mesh(new THREE.BoxGeometry(.4, .4, 1), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }));
    fline.rotation.order = "YXZ"; bob.visible = false; fline.visible = false; scene.add(bob, fline);
    var ROOFG = new THREE.CylinderGeometry(0, 1, 1, 4), ROOFM = new THREE.MeshLambertMaterial({ color: 0xa8873c });
    function mkHouse() { // rumah kayu 76x76, pintu di sisi +x (arah depan), atap rumbia
      var g = new THREE.Group(), wd = 0x8a5a2b, roof = new THREE.Mesh(ROOFG, ROOFM);
      g.add(bx(76, 10, 76, 0x5a4026, 0, -4.6, 0), bx(4, 26, 76, wd, -36, 13, 0), bx(76, 26, 4, wd, 0, 13, -36), bx(76, 26, 4, wd, 0, 13, 36),
        bx(4, 26, 16, wd, 36, 13, -30), bx(4, 26, 16, wd, 36, 13, 30), bx(4, 6, 44, wd, 36, 23, 0), bx(30, 4, 14, 0xd8c9a0, -18, 3, -24), bx(8, 3, 12, 0xb23a3a, -30, 5, -24));
      roof.position.y = 41; roof.scale.set(62, 30, 62); roof.rotation.y = Math.PI / 4; g.add(roof); g.userData.roof = roof; return g;
    }
    var HW = [[-38, -34, -38, 38], [-38, 38, -38, -34], [-38, 38, 34, 38], [34, 38, -38, -22], [34, 38, 22, 38]]; // dinding (u0,u1,v0,v1); celah pintu |v|<22
    function houseLocal(h, x, y) { var dx = x - h.x, dy = y - h.y, c = Math.cos(h.a), s = Math.sin(h.a); return { u: dx * c + dy * s, v: -dx * s + dy * c }; }
    function inHouse(x, y, m) { m = m || 0; for (var i = 0; i < houses.length; i++) { var h = houses[i], l = houseLocal(h, x, y); if (Math.abs(l.u) < 34 + m && Math.abs(l.v) < 34 + m) return h; } return null; }
    function houseBlock(x, y, r) {
      for (var i = 0; i < houses.length; i++) {
        var h = houses[i]; if (Math.abs(x - h.x) > 70 || Math.abs(y - h.y) > 70) continue;
        var l = houseLocal(h, x, y);
        for (var j = 0; j < 5; j++) { var w = HW[j]; if (l.u > w[0] - r && l.u < w[1] + r && l.v > w[2] - r && l.v < w[3] + r) return true; }
      }
      return false;
    }
    function pblk(x, y, r) { return pblock(x, y, r) || houseBlock(x, y, r); }

    /* --- satwa: model 3D sederhana (low-poly) --- */
    function legsFor(g, y0, pts, lh, lw, col, sock) {
      var out = [];
      pts.forEach(function (p) {
        var pv = new THREE.Group(); pv.position.set(p[0], y0, p[1]); pv.add(bx(lw, lh, lw, col, 0, -lh / 2, 0));
        if (sock) pv.add(bx(lw * 1.12, lh * .3, lw * 1.12, sock, 0, -lh + lh * .15, 0));
        g.add(pv); out.push(pv);
      });
      return out;
    }
    function eyes(h, x, y, z, s, c) { h.add(bx(s, s * 1.2, s, c || 0x0a0a0a, x, y, z), bx(s, s * 1.2, s, c || 0x0a0a0a, x, y, -z)); }
    function chain(parent, n, mk, step) { // rantai ruas bersarang (ekor, belalai) -> array pivot
      var piv = [], p = parent, i;
      for (i = 0; i < n; i++) { p.add(mk(i)); var nx = new THREE.Group(); nx.position.set(step[0], step[1], step[2]); p.add(nx); piv.push(nx); p = nx; }
      return piv;
    }
    var B = {};
    B.rusa = function () {
      var g = new THREE.Group(), c = 0xa8764a, hd = new THREE.Group(), i;
      g.add(bx(24, 10, 9, c, 0, 19, 0), bx(19, 3.6, 9.4, 0xe6d6b8, 0, 15.4, 0), bx(5, 12, 5.4, c, 11.5, 27, 0, 0, 0, -.5), bx(3, 3, 2.4, 0xf2eee4, -12.5, 23.5, 0));
      for (i = 0; i < 9; i++) g.add(sp(.85, .5, .85, 0xf4e7d0, -8 + i * 2, 24.1, (i % 3 - 1) * 2.8));
      hd.position.set(16, 33, 0); hd.add(bx(8, 5.6, 5, c, 2.5, 0, 0), bx(4, 3.4, 3.4, 0x5a4030, 7.5, -1, 0), bx(1, 1.4, 2, 0x111111, 9.6, -.3, 0)); eyes(hd, 4, 1.3, 2.5, .9);
      [1, -1].forEach(function (s) { hd.add(bx(1, 3.6, 1.6, c, -.5, 3.5, 3.2 * s, .6 * s, 0, 0), bx(.9, 9, .9, 0xd5c096, 0, 7.5, 1.6 * s, 0, 0, -.3), bx(.7, 5, .7, 0xd5c096, 1.8, 9.5, 1.6 * s, 0, 0, -1), bx(.7, 4, .7, 0xd5c096, -.6, 11.5, 1.6 * s, 0, 0, .3)); });
      g.add(hd); return { g: g, head: hd, legs: legsFor(g, 14, [[8, 3.2], [8, -3.2], [-8, 3.2], [-8, -3.2]], 14, 2.4, 0x8a5e3a, 0x2a1c10) };
    };
    B.kancil = function () {
      var g = new THREE.Group(), c = 0x9a5a30, hd = new THREE.Group();
      g.add(bx(14, 6, 5.4, c, 0, 11, 0), bx(11, 2, 5.6, 0xf0e4d0, 0, 8.8, 0), bx(9, .8, 5.6, 0xf4ead8, 0, 12.6, 0), bx(2.4, 2.4, 2, 0xffffff, -7.5, 12, 0), bx(3, 7, 3, c, 7, 14.5, 0, 0, 0, -.5));
      hd.position.set(9.5, 17.5, 0); hd.add(bx(5, 3.8, 3.4, c, 1.5, 0, 0), bx(2.4, 2, 2, 0x4a3020, 4.6, -.7, 0), bx(1.2, 2.4, .6, c, -.3, 3, 1.6, 0, 0, .1), bx(1.2, 2.4, .6, c, -.3, 3, -1.6, 0, 0, .1)); eyes(hd, 2.3, .9, 1.7, 1);
      g.add(hd); return { g: g, head: hd, legs: legsFor(g, 8, [[5, 1.9], [5, -1.9], [-5, 1.9], [-5, -1.9]], 8, 1.3, 0x7a4624, 0x1a120a), vs: 80 };
    };
    B.babi = function () {
      var g = new THREE.Group(), c = 0x4a3a30, hd = new THREE.Group();
      g.add(bx(22, 11, 10, c, 0, 13.5, 0), bx(18, 2.6, 2, 0x1c1410, 0, 19.6, 0), bx(14, 3, 10.2, 0x6a5444, 1, 9.8, 0), bx(1.6, 5, 1.6, 0x2a1e18, -11.5, 14.5, 0, 0, 0, .4));
      hd.position.set(12, 12.5, 0); hd.add(bx(9, 7, 6.4, c, 3, 0, 0), bx(4.5, 4.2, 5, 0x8c6a5a, 8.5, -1.5, 0), bx(1, 1.2, 1, 0x111111, 11, -1, 1.4), bx(1, 1.2, 1, 0x111111, 11, -1, -1.4), bx(.9, 3.4, .9, 0xf2ecd8, 8, -3.6, 2.7, 0, 0, .3), bx(.9, 3.4, .9, 0xf2ecd8, 8, -3.6, -2.7, 0, 0, .3), bx(2, 3.4, 1, c, 1, 4.2, 2.6), bx(2, 3.4, 1, c, 1, 4.2, -2.6)); eyes(hd, 5, 1.6, 3, .9);
      g.add(hd); return { g: g, head: hd, legs: legsFor(g, 8, [[7, 3.8], [7, -3.8], [-7, 3.8], [-7, -3.8]], 8, 3, 0x3a2c24, 0x1a1210) };
    };
    B.ayam = function () {
      var g = new THREE.Group(), i;
      g.add(sp(6.5, 4.8, 4.2, 0x7a3c1c, 0, 10.5, 0), sp(4, 2.8, .8, 0x5a2810, -1, 11, 3.8), sp(4, 2.8, .8, 0x5a2810, -1, 11, -3.8), sp(3.2, 3.8, 3.4, 0x2a2a2a, 4, 11.5, 0), sp(2.4, 4, 2.4, 0xd8872a, 5.5, 15, 0), sp(2.5, 2.5, 2.2, 0xd8872a, 7, 18.5, 0), bx(2.4, 2.6, .8, 0xd02020, 7, 21.2, 0), bx(.8, 1.8, .8, 0xd02020, 8.6, 16.4, 0), mesh(CONE, M(0xe8b820), 1.1, 2.8, 1.1, 9.6, 18.2, 0, 0, 0, -Math.PI / 2));
      eyes(g, 8.2, 19.2, 1.9, .7);
      for (i = -1; i <= 1; i++) g.add(bx(1.1, 10, 2.6, i ? 0x1d4a3a : 0x6a2a14, -8, 15.5, i * 1.8, i * .3, 0, .5 + Math.abs(i) * .2));
      return { g: g, legs: legsFor(g, 7, [[0, 1.8], [0, -1.8]], 7, .9, 0xd8b030), ph: [0, Math.PI], vs: 60, freq: .4 };
    };
    B.monyet = function () {
      var g = new THREE.Group(), c = 0x7a6048, hd = new THREE.Group(), i;
      g.add(bx(10, 9, 7, c, 0, 12, 0, 0, 0, .3), bx(6, 7, 7.2, 0xc8a888, 1.5, 11.5, 0, 0, 0, .3));
      for (i = 0; i < 7; i++) g.add(bx(1.6, 1.6, 1.6, c, -6.5 - i * 1.7, 10 + Math.pow(i, 1.55) * .9, 0));
      hd.position.set(5.5, 18.5, 0); hd.add(sp(4.2, 4, 4, c, 0, 0, 0), bx(2.6, 3.4, 5, 0xd8b898, 3.2, -.5, 0), sp(1.6, 1.6, 1, c, -.5, 0, 4.4), sp(1.6, 1.6, 1, c, -.5, 0, -4.4)); eyes(hd, 4.5, .9, 1.6, .8);
      g.add(hd); return { g: g, head: hd, legs: legsFor(g, 8, [[3.5, 3.4], [3.5, -3.4], [-4, 3.2], [-4, -3.2]], 8, 2.4, 0x6a5038, 0x2a1c10), vs: 90 };
    };
    B.merak = function () {
      var g = new THREE.Group(), i, f;
      g.add(sp(8, 5, 4.2, 0x1c5a9a, 0, 14, 0), bx(2.6, 12, 2.6, 0x1e6fbf, 7.5, 21, 0, 0, 0, -.25), sp(2.5, 2.4, 2.2, 0x1e6fbf, 9.5, 28, 0), mesh(CONE, M(0xd8c070), 1, 2.6, 1, 12, 27.6, 0, 0, 0, -Math.PI / 2), bx(.4, 4, .4, 0x2a8a6a, 9, 31.5, 0), sp(.9, .9, .9, 0x2a8a6a, 9, 33.6, 0));
      eyes(g, 11, 28.6, 1.8, .6);
      for (i = 0; i < 13; i++) { f = new THREE.Group(); f.position.set(-7, 13, 0); f.rotation.y = (i - 6) * .15; var f2 = new THREE.Group(); f2.rotation.z = .45; f2.add(bx(27, .5, 1.5, i % 2 ? 0x2a8a4a : 0x1d7a5a, -13.5, 0, 0), sp(1.7, .5, 1.3, 0x2250a0, -26, 0, 0)); f.add(f2); g.add(f); }
      return { g: g, legs: legsFor(g, 9, [[0, 2], [0, -2]], 9, 1, 0x8a8a7a), ph: [0, Math.PI], vs: 70, freq: .35 };
    };
    B.biawak = function () {
      var g = new THREE.Group(), c = 0x4e5a2c, i;
      g.add(bx(16, 5, 6.4, c, 0, 7.5, 0), bx(8, 3.4, 4.2, 0x5e6a34, 11, 8, 0), bx(3, 2.4, 2.8, 0x3e4a22, 15.5, 7.6, 0), bx(14, 2, 6, 0xb8b070, 0, 5.4, 0));
      for (i = 0; i < 6; i++) g.add(bx(1.6, .6, 4, 0xc8b84a, -6 + i * 2.4, 10.2, 0));
      eyes(g, 12, 9.8, 1.9, .8);
      var tr0 = new THREE.Group(); tr0.position.set(-8, 7.2, 0); g.add(tr0); var tail = chain(tr0, 4, function (k) { return bx(8, 3.8 - k * .7, 4.6 - k * .9, c, -4, 0, 0); }, [-8, 0, 0]);
      return { g: g, legs: legsFor(g, 5.4, [[6, 4.2], [6, -4.2], [-5, 4.2], [-5, -4.2]], 5.4, 2.4, 0x3e4a22), vs: 40, sway: function (now, amp) { for (var k = 0; k < tail.length; k++) tail[k].rotation.y = Math.sin(now / 220 - k * .8) * (.25 + amp * .3); } };
    };
    B.ular = function () {
      var g = new THREE.Group(), segs = [], i, r, s;
      for (i = 0; i < 16; i++) { r = 3.1 * (1 - i / 16 * .55) + .3; s = sp(r, r, r, i % 2 ? 0x4a6a2a : 0xd0b030, 0, 3, 0); segs.push(s); g.add(s); }
      segs[0].scale.set(3.8, 2.8, 3.4); var eL = bx(.9, .9, .9, 0xffd030, 0, 0, 0), eR = bx(.9, .9, .9, 0xffd030, 0, 0, 0); g.add(eL, eR);
      var tongue = bx(2.6, .35, .35, 0xd02040, 0, 0, 0); g.add(tongue);
      return { g: g, legs: [], upd: function (now, amp) {
        for (var i = 0; i < 16; i++) { var s = i / 15; segs[i].position.set(14 - s * 38 + Math.sin(now / 900) * .8, 3 + Math.max(0, .3 - s) * 45, Math.sin(s * 8 + now / 260) * 4 * (.4 + s)); }
        var hp0 = segs[0].position; eL.position.set(hp0.x + 2, hp0.y + 1.2, hp0.z + 2.2); eR.position.set(hp0.x + 2, hp0.y + 1.2, hp0.z - 2.2);
        tongue.position.set(hp0.x + 5, hp0.y - .5, hp0.z); tongue.visible = ((now / 300) | 0) % 3 === 0;
      } };
    };
    B.banteng = function () {
      var g = new THREE.Group(), c = 0x3b2a20, hd = new THREE.Group();
      g.add(bx(30, 15, 13, c, 0, 20.5, 0), sp(8, 5, 6.5, c, 5, 28, 0), bx(5, 11, 13.2, 0xe8dcc8, -13, 20, 0), bx(8, 10, 9, c, 14, 24, 0, 0, 0, -.3), bx(1.2, 10, 1.2, 0x2a1c14, -15.8, 20, 0, 0, 0, .15), bx(7, 4, 9, 0x5a4636, 12, 17, 0));
      hd.position.set(20, 22, 0); hd.add(bx(10, 8, 7.5, c, 3, 0, 0), bx(3, 5.4, 6, 0x1a1210, 8.5, -1.2, 0), bx(1, 1.2, 1.2, 0x666666, 10.2, -.8, 1.4), bx(1, 1.2, 1.2, 0x666666, 10.2, -.8, -1.4)); eyes(hd, 5, 1.8, 3.8, 1);
      [1, -1].forEach(function (s) { hd.add(bx(1.8, 1.8, 5, 0xe8dcc0, 0, 3, 5.5 * s, 0, .3 * s, 0), bx(1.4, 6, 1.4, 0xe8dcc0, .6, 6, 8.6 * s, 0, 0, .15), bx(1, 2, 3.6, c, -1, 2, 4.6 * s)); });
      g.add(hd); return { g: g, head: hd, legs: legsFor(g, 13, [[10, 4.8], [10, -4.8], [-10, 4.8], [-10, -4.8]], 13, 3.6, c, 0xf0e8d8), vs: 80 };
    };
    B.gajah = function () {
      var g = new THREE.Group(), c = 0x7e7a78, hd = new THREE.Group();
      g.add(bx(44, 26, 24, c, 0, 33, 0), bx(2, 14, 2, 0x6a6664, -22.5, 30, 0), bx(30, 6, 24.4, 0x8e8a88, 2, 22, 0));
      hd.position.set(27, 40, 0); hd.add(bx(16, 18, 16, c, 5, 0, 0), sp(8, 7, 8, c, 4, 8, 0), bx(1.8, 17, 15, 0x6e6a68, -1, 2, 10.5, 0, .45, 0), bx(1.8, 17, 15, 0x6e6a68, -1, 2, -10.5, 0, -.45, 0), bx(11, 2, 2, 0xf4efe0, 12, -6, 6, 0, 0, -.3), bx(11, 2, 2, 0xf4efe0, 12, -6, -6, 0, 0, -.3)); eyes(hd, 11, 3, 7.4, 1.3);
      var tg = new THREE.Group(); tg.position.set(12, -2, 0); tg.rotation.z = .45; hd.add(tg);
      var tk = chain(tg, 5, function (k) { var w = [6.6, 5.6, 4.8, 4, 3.2][k]; return bx(w, 8.4, w, c, 0, -4.2, 0); }, [0, -8, 0]);
      g.add(hd); return { g: g, head: hd, legs: legsFor(g, 20, [[14, 8], [14, -8], [-14, 8], [-14, -8]], 20, 9, c, 0xd8d0c0), vs: 70, freq: .2, amp: .55, sway: function (now) { for (var k = 0; k < tk.length; k++) tk[k].rotation.z = Math.sin(now / 520 - k * .7) * .16 + .08; } };
    };
    B.buaya = function () {
      var g = new THREE.Group(), c = 0x3d4d2c, i;
      g.add(bx(26, 5, 11, c, 2, 5.5, 0), bx(24, 1.5, 10.6, 0xb8bf90, 2, 3, 0), bx(10, 4.4, 8, c, 17, 5.5, 0), bx(12, 3.2, 5, c, 26, 4.8, 0), bx(16, 1.8, 6.2, 0x9aa57a, 24, 3, 0), sp(1.7, 1.7, 1.7, 0x2a3a1c, 14.5, 8.8, 3), sp(1.7, 1.7, 1.7, 0x2a3a1c, 14.5, 8.8, -3), bx(.8, .8, .8, 0xe8d040, 15.6, 9, 3.2), bx(.8, .8, .8, 0xe8d040, 15.6, 9, -3.2));
      for (i = 0; i < 7; i++) g.add(bx(2, 1.6, 9, 0x2d3b20, -8 + i * 3.4, 8.4, 0));
      var tr0 = new THREE.Group(); tr0.position.set(-12, 5.5, 0); g.add(tr0); var tail = chain(tr0, 4, function (k) { return bx(9, 4.6 - k * .9, 9 - k * 1.8, c, -4.5, 0, 0); }, [-9, 0, 0]);
      return { g: g, legs: legsFor(g, 4.5, [[9, 6.4], [9, -6.4], [-7, 6.4], [-7, -6.4]], 4.5, 3, c), vs: 80, amp: .5, sway: function (now, amp) { for (var k = 0; k < tail.length; k++) tail[k].rotation.y = Math.sin(now / 200 - k * .8) * (.2 + amp * .35); } };
    };
    B.harimau = function () {
      var g = new THREE.Group(), c = 0xdf7a1e, hd = new THREE.Group(), i;
      g.add(bx(30, 11, 9, c, 0, 18.5, 0), bx(26, 3.2, 9.2, 0xf6ead6, 0, 14.3, 0), bx(8, 10, 8, c, 14, 22, 0, 0, 0, -.4));
      for (i = 0; i < 8; i++) g.add(bx(1.3, 11.6, 9.6, 0x16100a, -12 + i * 3.4, 18.6 + (i % 2) * .5, 0));
      hd.position.set(20, 24, 0); hd.add(bx(9, 8, 8.6, c, 2, 0, 0), bx(3.6, 4.2, 6, 0xf6ead6, 7, -1.5, 0), bx(1, 1.2, 1.8, 0x201010, 9, -.2, 0), bx(1.2, 3.4, 2.6, c, -1, 5, 3.6), bx(1.2, 3.4, 2.6, c, -1, 5, -3.6), bx(.5, 1, 3, 0x16100a, 6, 3, 0)); eyes(hd, 6, 1.6, 3.2, 1.1, 0xffe066);
      var tr0 = new THREE.Group(); tr0.position.set(-15, 21, 0); tr0.rotation.z = -.5; g.add(tr0); var tail = chain(tr0, 4, function (k) { return bx(7, 2.6, 2.6, k % 2 ? 0x16100a : c, -3.5, 0, 0); }, [-7, 0, 0]);
      g.add(hd); return { g: g, head: hd, legs: legsFor(g, 13, [[10, 3.4], [10, -3.4], [-10, 3.4], [-10, -3.4]], 13, 3.6, c, 0xf6ead6), vs: 100, sway: function (now) { for (var k = 1; k < tail.length; k++) tail[k].rotation.y = Math.sin(now / 260 - k * .9) * .35; } };
    };
    function mkModel(a) { var m = B[a.type](); m.t = 0; m.ph = m.ph || [0, Math.PI, Math.PI, 0]; m.px = a.x; m.py = a.y; m.sp = 0; scene.add(m.g); return m; }
    function killModel(a) { if (a.m3) { scene.remove(a.m3.g); a.m3 = null; } if (a.ice3) { scene.remove(a.ice3); a.ice3 = null; } }

    /* --- objek dinamis karakter: jejak kaki, riak, daging, tombak, api unggun --- */
    var poolFoot = new Pool(function () { return decal(0x1e140a); }), poolRip = new Pool(function () { return ring(0xe1f0ff); });
    var poolMeat = new Pool(function () {
      var g = new THREE.Group(); g.add(sp(4.6, 3.6, 3.6, 0xb04a2a, 0, 4.5, 0), bx(1.4, 6, 1.4, 0xf0e6d0, 5, 5.5, 0, 0, 0, 1.3)); var rg = ring(0xffe27a); rg.scale.set(8, 1, 8); rg.position.y = .5; g.add(rg); return g;
    });
    var poolIceSp = new Pool(function () { var g = new THREE.Group(); g.add(bx(22, 1.4, 1.4, 0xbfe9ff, 0, 0, 0), mesh(CONE, M(0x6fd0ff), 2, 6, 2, 12, 0, 0, 0, 0, -Math.PI / 2)); return g; });
    var poolSpear = new Pool(function () { var g = new THREE.Group(); g.add(bx(22, 1, 1, 0xe8d9a8, 0, 0, 0), mesh(CONE, M(0xd8dcde), 1.4, 5, 1.4, 12, 0, 0, 0, 0, -Math.PI / 2)); return g; });
    var logMatB = new THREE.MeshLambertMaterial({ color: 0x6b4423 }), logMatL = new THREE.MeshLambertMaterial({ color: 0x2f6b2a });
    var logGB = new THREE.CylinderGeometry(3, 4.4, 64, 8), logGL = new THREE.SphereGeometry(17, 8, 6);
    var poolLog = new Pool(function () { // pohon yang sedang roboh; pivot di pangkal batang
      var g = new THREE.Group(), pv = new THREE.Group(), tr = new THREE.Mesh(logGB, logMatB), cr = new THREE.Mesh(logGL, logMatL);
      tr.position.y = 32; cr.position.y = 72; cr.scale.y = .8; pv.add(tr, cr); g.add(pv); g.userData.pv = pv; return g;
    });
    var flameMats = [0xffe9a0, 0xff9a30, 0xe0400f].map(function (c) { return new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending }); });
    var fireReg = [];
    function mkFire() {
      var g = new THREE.Group(), i, fl = [];
      for (i = 0; i < 8; i++) { var an = i / 8 * 6.283; g.add(mesh(new THREE.DodecahedronGeometry(1, 0), M(0x6b6b66), 4, 3, 4, Math.cos(an) * 12, 1.5, Math.sin(an) * 12)); }
      g.add(bx(24, 3.6, 3.6, 0x4a2d14, 0, 3, 0, 0, .5, 0), bx(24, 3.6, 3.6, 0x4a2d14, 0, 4.6, 0, 0, -.5, 0));
      for (i = 0; i < 3; i++) { var f = new THREE.Mesh(CONE, flameMats[i]); f.position.y = 5; g.add(f); fl.push(f); }
      g.userData.fl = fl; return g;
    }

    /* --- ukuran layar --- */
    function size() {
      dpr = Math.min(devicePixelRatio || 1, TOUCH ? 1.5 : 2); vw = innerWidth; vh = innerHeight;
      cv.width = vw * dpr; cv.height = vh * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      world.resize(vw, vh, dpr);
    }
    addEventListener("resize", size); size();

    /* =====================================================================
       multiplayer, suara, kontrol
       ===================================================================== */
    var loggedIn = false, remote = [], rspears = [], myName = "", myBub = { s: "", t: 0 }, fires = [], fireCd = 0, muted = false, AC = null;

    /* ---------- ID MANUSIA OTOMATIS ----------
       Setiap manusia otomatis punya ID unik "RN-XXXXXX". ID pemain ini dibuat sekali lalu disimpan di peramban
       (localStorage) supaya tetap sama saat main lagi. Manusia lain memakai ID dari server (atau ID yang mereka kirim lewat state.uid). */
    var OWNER_ID = "RN-UJQS22"; // ID khusus owner: dicadangkan, hanya terbuka lewat Kunci Owner (lihat blok OWNER di bawah)
    function genId() {
      var ch = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", a = "", b = null, i;
      try { b = crypto.getRandomValues(new Uint8Array(6)); } catch (e) {}
      for (i = 0; i < 6; i++) a += ch.charAt((b ? b[i] : (Math.random() * 256) | 0) % ch.length);
      if ("RN-" + a === OWNER_ID) return genId(); // ID owner tidak pernah dibagikan ke siapa pun
      return "RN-" + a;
    }
    var myId = (function () {
      var v = null; try { v = localStorage.getItem("fm_player_id"); } catch (e) {}
      if (!v || !/^RN-[A-Z0-9]{6}$/.test(v) || v === OWNER_ID) { v = genId(); try { localStorage.setItem("fm_player_id", v); } catch (e) {} }
      return v;
    })();
    var joinT = Date.now();
    function idOf(r) {
      var u = r.uid || (r.id != null ? "RN-" + String(r.id).replace(/[^A-Za-z0-9]/g, "").slice(-6).toUpperCase() : "RN-??????");
      if (u === OWNER_ID && !(r.oex > Date.now())) return "RN-??????"; // klaim owner tanpa tanda tangan sah = palsu
      return u;
    }
    function labelOf(name, id) { return (name ? name + " · " : "") + id; }
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    addEventListener("pointerdown", function () { if (AC && AC.state === "suspended") AC.resume(); });
    function beep(f, t0, len, vol, type) { var o = AC.createOscillator(), g = AC.createGain(); o.type = type || "sine"; o.frequency.value = f; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + .008); g.gain.linearRampToValueAtTime(0, t0 + len); o.connect(g); g.connect(AC.destination); o.start(t0); o.stop(t0 + len + .02); }
    function cricket() { if (!AC || muted) return; var t = AC.currentTime, f = 3900 + R() * 900, n = 3 + (R() * 3 | 0); for (var i = 0; i < n; i++) beep(f, t + i * .07, .035, .02 * E.dark); }
    function crackle() { if (!AC || muted) return; beep(90 + R() * 260, AC.currentTime, .025, .03, "sawtooth"); }
    function nearFire(x, y, r) { for (var i = 0; i < fires.length; i++) if (Math.hypot(fires[i].x - x, fires[i].y - y) < r) return fires[i]; return null; }
    function buildFire() {
      if (P.hp <= 0 || P.sw || P.down > 0 || fireCd > 0) return;
      if (water(P.x, P.y)) { E.msg = "Tidak bisa membuat api di air."; E.mt = 2; return; }
      if (E.rain > .5 && E.winter < .5) { E.msg = "Hujan terlalu deras untuk menyalakan api."; E.mt = 2.5; return; }
      var mine = fires.filter(function (f) { return f.mine; }); if (mine.length >= 2) fires.splice(fires.indexOf(mine[0]), 1);
      fires.push({ x: P.x, y: P.y + 6, t: 120, mine: true }); fireCd = 6; E.msg = "Api unggun menyala. Harimau takut mendekat, nyawa pulih pelan."; E.mt = 4; questEv("fire");
      if (net.emit) net.emit("fire", { x: P.x, y: P.y + 6 });
    }
    var net = window.ForestMap.net = {
      emit: null,
      get: function () { return { x: P.x, y: P.y, a: P.a, walk: P.walk, face: P.face, hp: P.hp, z: P.z, down: P.down, dm: P.dm, bleed: P.bleed, hurt: P.hurt, wet: P.wet, st: P.st, sw: P.sw, tool: P.tool, ar: P.armor ? 1 : 0, rid: P.rid ? 1 : 0, uid: myId, jl: P.jail > 0 ? 1 : 0, ice: P.ice > 0 ? 1 : 0, fly: P.fly ? 1 : 0, inv: P.inv ? 1 : 0, oc: (ownerOK && ownerCert) ? ownerCert : 0 }; },
      myId: myId,
      getId: function () { return myId; },
      setId: function (id) { if (!id || String(id) === OWNER_ID) return; myId = String(id); net.myId = myId; try { localStorage.setItem("fm_player_id", myId); } catch (e) {} },
      getProfile: function (id) { var r = id == null ? null : net.find(id); return r ? { id: idOf(r), name: r.name || "", hp: r.p.hp } : { id: myId, name: myName, hp: P.hp, score: score }; },
      setName: function (n) { myName = n; },
      fire: function (id, d) { fires.push({ x: d.x, y: d.y, t: 120 }); },
      sync: function (t) { E.tod = t; },
      find: function (id) { for (var i = 0; i < remote.length; i++) if (remote[i].id === id) return remote[i]; },
      upsert: function (id, name, s) {
        if (id == null || id === "") id = "anon-" + (name || "?"); // setiap manusia selalu punya id
        var r = net.find(id);
        if (!r) { r = { id: id, name: name, p: { x: s.x, y: s.y, walk: 0 }, tx: s.x, ty: s.y, say: { s: "", t: 0 } }; remote.push(r); }
        r.name = name || r.name; r.tx = s.x; r.ty = s.y; if (s.uid) r.uid = String(s.uid);
        for (var k in s) if (k !== "x" && k !== "y" && k !== "walk" && k !== "oc") r.p[k] = s[k];
        if (s.oc) verifyCert(r, s.oc);
        if (!(r.oex > Date.now())) { r.p.inv = 0; r.p.fly = 0; } // invisible/terbang adalah kuasa owner: pemain biasa tidak bisa memalsukannya
      },
      remove: function (id) { var r = net.find(id); if (r && r.m3) scene.remove(r.m3.root); if (r && r.boat) scene.remove(r.boat); if (r && r.ice3) scene.remove(r.ice3); remote = remote.filter(function (r) { return r.id !== id; }); },
      say: function (id, text) { var b = id == null ? myBub : (net.find(id) || {}).say; if (b) { b.s = text; b.t = 7; } },
      spear: function (id, d) { rspears.push({ x: d.x, y: d.y, a: d.a, d: 0, ice: !!d.ice }); }
    };
    function remoteStep(dt) {
      var i, r, k = Math.min(1, dt * 10);
      for (i = 0; i < remote.length; i++) {
        r = remote[i]; var dd = Math.hypot(r.tx - r.p.x, r.ty - r.p.y);
        r.p.x += (r.tx - r.p.x) * k; r.p.y += (r.ty - r.p.y) * k; r.p.walk = dd > 2 ? r.p.walk + dt * 9 : r.p.walk * .8; r.say.t -= dt;
      }
      myBub.t -= dt;
      for (i = rspears.length - 1; i >= 0; i--) { var q = rspears[i], st = 440 * dt; q.x += Math.cos(q.a) * st; q.y += Math.sin(q.a) * st; q.d += st; if (q.d > 260 || hitTree(q.x, q.y, 2)) rspears.splice(i, 1); }
    }
    function tag(p, name, say, col) { // p = titik layar di atas kepala
      if (!p) return;
      var x = p.x, y = p.y;
      ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.font = "bold 11px system-ui,sans-serif";
      if (name) { var w = ctx.measureText(name).width + 10; ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(x - w / 2, y - 16, w, 14); ctx.fillStyle = col; ctx.fillText(name, x, y - 5); }
      if (say.t > 0) { var t = say.s.length > 36 ? say.s.slice(0, 35) + "…" : say.s; ctx.font = "12px system-ui,sans-serif"; var tw = ctx.measureText(t).width + 14; ctx.fillStyle = "rgba(255,255,255,.93)"; ctx.fillRect(x - tw / 2, y - 42, tw, 20); ctx.fillStyle = "#222"; ctx.fillText(t, x, y - 28); }
      ctx.restore();
    }

    function throwSpear(a) {
      if (P.hp <= 0 || P.cd > 0 || P.down > 0) return;
      if (P.sw) { E.msg = "Tidak bisa melempar tombak saat berenang."; E.mt = 1.5; return; }
      P.cd = P.cdm = .45; var ic = !!(P.icesp && isAdmin()); spears.push({ x: P.x, y: P.y, a: a, d: 0, ice: ic }); if (net.emit) net.emit("spear", { x: P.x, y: P.y, a: a, ice: ic ? 1 : 0 });
    }
    /* ---------- kapak & menebang pohon ---------- */
    function thunk() { if (!AC || muted) return; var t = AC.currentTime; beep(95 + R() * 40, t, .07, .09, "square"); beep(420 + R() * 120, t, .02, .04, "sawtooth"); }
    function crashSnd() { if (!AC || muted) return; var t = AC.currentTime; for (var i = 0; i < 6; i++) beep(150 - i * 15 + R() * 20, t + i * .07, .09, .07, "sawtooth"); }
    var TMSG = { spear: "Tombak dipegang.", axe: "Kapak dipegang. Ayunkan ke arah pohon (klik / F).", sword: "Pedang dipegang. Tebas satwa di depanmu (klik / F).", rod: "Pancingan dipegang. Arahkan ke air lalu klik / F." };
    function setTool(t) {
      if (P.hp <= 0 || P.tool === t) return;
      if ((t === "sword" || t === "rod") && !P.has[t]) { E.msg = "Belum punya " + (t === "sword" ? "pedang" : "pancingan") + ". Rakit dulu (tekan R)."; E.mt = 2.5; return; }
      P.tool = t; P.pend = 0; P.fs = null; E.msg = TMSG[t]; E.mt = 2.5;
      if (toolUI) toolUI();
    }
    function toggleTool() {
      var all = ["spear", "axe"]; if (P.has.sword) all.push("sword"); if (P.has.rod) all.push("rod");
      setTool(all[(all.indexOf(P.tool) + 1) % all.length]);
    }
    function findTree(a) { // cari batang pohon terdekat di depan karakter (jarak 16-40, sudut +-35 derajat)
      var offs = [0, .3, -.3, .6, -.6], ds = [16, 22, 28, 34, 40], i, j, ang, px, py;
      for (j = 0; j < ds.length; j++) for (i = 0; i < offs.length; i++) {
        ang = a + offs[i]; px = P.x + Math.cos(ang) * ds[j]; py = P.y + Math.sin(ang) * ds[j];
        if (hitTree(px, py, 3)) return { x: px, y: py };
      }
      return null;
    }
    function swingAxe(a) {
      if (P.hp <= 0 || P.cd > 0 || P.down > 0) return;
      if (P.sw || P.z > 0) { E.msg = "Tidak bisa menebang saat berenang atau melompat."; E.mt = 1.5; return; }
      if (P.st < 8) { E.msg = "Tenagamu habis. Istirahat dulu."; E.mt = 1.5; return; }
      P.a = P.ca = a; P.cd = P.cdm = .6; P.pend = .37; P.st = Math.max(0, P.st - 6); // kena tepat saat tebasan turun
    }
    function act(a) { if (P.jail > 0 || P.ice > 0) return; var t = P.tool; if (t === "axe") swingAxe(a); else if (t === "sword") swingSword(a); else if (t === "rod") useRod(a); else throwSpear(a); }
    /* ---------- pedang & luka satwa ---------- */
    function hitAnimal(k, dmg) {
      var a = animals[k]; a.hp -= dmg; a.fl3 = .2; if (a.d.aggr) a.angry = true;
      floats.push({ x: a.x, y: a.y, h: a.d.r * 2 + 6, t: .8, s: a.hp > 0 ? "−" + dmg : "+" + a.d.pts, c: a.hp > 0 ? "#ffd3c0" : "#ffe27a" });
      if (a.hp <= 0) {
        kills[a.type] = (kills[a.type] || 0) + 1; score += a.d.pts; questEv("kill", a.type); var mp = { rusa: 2, kancil: 1, babi: 2, ayam: 1, banteng: 3, harimau: 1, monyet: 1, merak: 2, biawak: 1, ular: 1, gajah: 5, buaya: 3 }[a.type]; E.drops.push({ x: a.x, y: a.y, m: mp, t: 90 }); floats.push({ x: a.x, y: a.y, h: a.d.r * 2 + 22, t: 1.2, s: "🍖 daging!", c: "#ffd0b0" });
        killModel(a); animals[k] = newAnimal(a.type, P);
      }
    }
    function slash() { if (!AC || muted) return; var t = AC.currentTime; beep(760, t, .05, .05, "sawtooth"); beep(320, t + .03, .07, .04, "sawtooth"); }
    function swingSword(a) {
      if (P.hp <= 0 || P.cd > 0 || P.down > 0) return;
      if (P.sw) { E.msg = "Tidak bisa menebas saat berenang."; E.mt = 1.5; return; }
      if (P.st < 5) { E.msg = "Tenagamu habis. Istirahat dulu."; E.mt = 1.5; return; }
      P.a = P.ca = a; P.cd = P.cdm = .42; P.pend = .25; P.st = Math.max(0, P.st - 4); // kena tepat saat tebasan turun
    }
    function swordHit() { // menebas semua satwa di busur depan (jangkauan ~46, sudut +-63 derajat), 2 damage
      if (P.hp <= 0 || P.down > 0) return;
      var i, an, dx, dy, d, df, TP = Math.PI * 2;
      for (i = 0; i < animals.length; i++) {
        an = animals[i]; dx = an.x - P.x; dy = an.y - P.y; d = Math.hypot(dx, dy);
        if (d > 46 + an.d.r) continue;
        df = Math.abs((((Math.atan2(dy, dx) - P.ca + Math.PI) % TP) + TP) % TP - Math.PI);
        if (d > an.d.r + 6 && df > 1.1) continue;
        hitAnimal(i, 2);
      }
      slash();
    }
    /* ---------- pancingan ---------- */
    function useRod(a) {
      if (P.hp <= 0 || P.down > 0) return;
      if (P.fs) { // tarik kail
        if (P.fs.bite > 0) {
          var n = R() < .2 ? 2 : 1; P.meat += n; score += 2; P.fs = null; P.cd = P.cdm = .4;
          floats.push({ x: P.x, y: P.y, h: 46, t: 1.2, s: "🐟 +" + n + " ikan", c: "#bfe8ff" }); E.msg = "Dapat ikan! +" + n + " daging"; E.mt = 3; questEv("fish");
        } else { P.fs = null; E.msg = "Terlalu cepat, ikannya kabur. Tunggu sampai menggigit."; E.mt = 2.5; }
        return;
      }
      if (P.cd > 0) return;
      if (P.sw) { E.msg = "Tidak bisa memancing saat berenang."; E.mt = 1.5; return; }
      var ds = [24, 40, 56, 72, 90], j, wx, wy, f = null;
      for (j = 0; j < ds.length && !f; j++) { wx = P.x + Math.cos(a) * ds[j]; wy = P.y + Math.sin(a) * ds[j]; if (water(wx, wy)) f = { x: wx, y: wy }; }
      if (!f) { E.msg = "Arahkan pancing ke air (sungai/danau)."; E.mt = 2; return; }
      P.a = P.ca = a; P.cd = P.cdm = .5; P.fs = { x: f.x, y: f.y, t: rnd(3, 7), bite: 0 };
      E.msg = "Kail dilempar. Tunggu ikan menggigit, lalu klik / F."; E.mt = 3;
    }
    /* ---------- perahu ---------- */
    function waterSpot() {
      var rs = [12, 22, 34, 48, 62], offs = [0, .4, -.4, .8, -.8, 1.2, -1.2, 1.6, -1.6, 2, -2, 2.4, -2.4, 2.8, -2.8, 3.14], i, j, x, y;
      for (j = 0; j < rs.length; j++) for (i = 0; i < offs.length; i++) {
        x = P.x + Math.cos(P.a + offs[i]) * rs[j]; y = P.y + Math.sin(P.a + offs[i]) * rs[j];
        if (water(x, y) && !pblk(x, y, 8)) return { x: x, y: y };
      }
      return null;
    }
    function toggleBoat() {
      if (P.hp <= 0 || P.down > 0) return;
      if (!P.has.boat) { E.msg = "Belum punya perahu. Rakit dulu (tekan R)."; E.mt = 2.5; return; }
      if (P.rid) { P.rid = false; P.fs = null; E.msg = "Turun dari perahu."; E.mt = 2; if (toolUI) toolUI(); return; }
      if (P.z > 0) return;
      var sp0 = water(P.x, P.y) ? { x: P.x, y: P.y } : waterSpot();
      if (!sp0) { E.msg = "Dekati tepi air untuk naik perahu."; E.mt = 2.5; return; }
      P.x = sp0.x; P.y = sp0.y; P.rid = true; P.fs = null; E.msg = "Naik perahu. Dayung di atas air, tanpa tenaga terkuras. Menepi untuk turun."; E.mt = 3.5;
      if (toolUI) toolUI();
    }
    /* ---------- rumah ---------- */
    function houseFits(x, y) {
      var cs = [[0, 0], [-38, -38], [38, -38], [-38, 38], [38, 38]], g0 = groundY(x, y), i, px, py;
      if (x < 80 || y < 80 || x > W - 80 || y > W - 80 || blocked(x, y, 44)) return false;
      for (i = 0; i < cs.length; i++) { px = x + cs[i][0]; py = y + cs[i][1]; if (water(px, py) || Math.abs(groundY(px, py) - g0) > 10) return false; }
      for (i = 0; i < houses.length; i++) if (Math.hypot(houses[i].x - x, houses[i].y - y) < 100) return false;
      return true;
    }
    function findHouseSpot() {
      var ds = [78, 98, 120], offs = [0, .5, -.5, 1, -1, 1.6, -1.6, 2.4, -2.4], i, j, x, y;
      for (j = 0; j < ds.length; j++) for (i = 0; i < offs.length; i++) {
        x = P.x + Math.cos(P.a + offs[i]) * ds[j]; y = P.y + Math.sin(P.a + offs[i]) * ds[j];
        if (houseFits(x, y)) return { x: x, y: y, a: Math.atan2(P.y - y, P.x - x) }; // pintu menghadap pemain
      }
      return null;
    }
    /* ---------- menu rakit ---------- */
    var RECIPES = [
      { cat: "Pelindung", id: "armor", ico: "🛡️", name: "Zirah Pelindung", desc: "Dipakai otomatis. Luka dari satwa & bencana berkurang separuh.", wood: 15 },
      { cat: "Senjata & Alat", id: "sword", ico: "⚔️", name: "Pedang", desc: "Tebas satwa di depanmu, 2x damage tombak. Ganti alat: tombol 3 / X.", wood: 10 },
      { cat: "Senjata & Alat", id: "rod", ico: "🎣", name: "Pancingan", desc: "Lempar ke air, tunggu gigitan, lalu tarik untuk dapat ikan (daging). Tombol 4.", wood: 6, meat: 1 },
      { cat: "Angkutan", id: "boat", ico: "⛵", name: "Perahu", desc: "Layari sungai tanpa berenang & tanpa tenaga terkuras. Naik/turun: B.", wood: 25 },
      { cat: "Bangunan", id: "house", ico: "🏠", name: "Rumah", desc: "Dibangun di depanmu. Berlindung dari hujan & bencana, memulihkan nyawa & suhu. Maks 2.", wood: 40, max: 2 }
    ];
    var cmEl = null, cmBox = null, cmStat = null, cmRes = null;
    function owned(id) { return id === "armor" ? !!P.armor : id === "house" ? houses.length >= 2 : !!P.has[id]; }
    function setStat(t) { if (cmStat) cmStat.textContent = t || ""; }
    function renderCraft() {
      if (!cmBox) return;
      if (cmRes) cmRes.innerHTML = '<span>🪵 Kayu <b>' + P.wood + '</b></span><span>🍖 Daging <b>' + P.meat + '</b></span>';
      var h = '', lastCat = '';
      RECIPES.forEach(function (r) {
        var own = owned(r.id), ok = P.wood >= r.wood && P.meat >= (r.meat || 0);
        if (r.cat !== lastCat) { lastCat = r.cat; h += '<div class="cm-sec">' + r.cat + '</div>'; }
        h += '<div class="cm-row' + (own ? ' own' : '') + '"><div class="cm-ico">' + r.ico + '</div><div class="cm-inf"><b>' + r.name + (r.max ? ' (' + houses.length + '/' + r.max + ')' : '') + '</b><small>' + r.desc + '</small><div class="cm-cost"><span class="' + (P.wood >= r.wood ? '' : 'no') + '">🪵 ' + r.wood + '</span>' + (r.meat ? '<span class="' + (P.meat >= r.meat ? '' : 'no') + '">🍖 ' + r.meat + '</span>' : '') + '</div></div>' +
          '<button class="cm-go" data-id="' + r.id + '"' + (own || !ok ? ' disabled' : '') + '>' + (own ? (r.max ? 'Penuh' : 'Dimiliki') : (!ok ? 'Kurang' : (r.max ? 'Bangun' : 'Rakit'))) + '</button></div>';
      });
      cmBox.innerHTML = h;
    }
    function openCraft() { openMenu("craft"); }
    function closeCraft() { closeMenu(); }
    function toggleCraft() { toggleMenu("craft"); }
    function chime() { if (!AC || muted) return; var t = AC.currentTime; beep(520, t, .08, .05, "triangle"); beep(780, t + .08, .14, .05, "triangle"); }
    function craft(id) {
      var r = null, i; for (i = 0; i < RECIPES.length; i++) if (RECIPES[i].id === id) r = RECIPES[i];
      if (!r || P.hp <= 0) return;
      if (owned(id)) { setStat(id === "house" ? "Kamu sudah punya 2 rumah." : r.name + " sudah kamu miliki."); return; }
      var meat = r.meat || 0;
      if (P.wood < r.wood || P.meat < meat) { setStat("Bahan kurang: butuh " + r.wood + " kayu" + (meat ? " + " + meat + " daging" : "") + "."); return; }
      var spot = null;
      if (id === "house") { spot = findHouseSpot(); if (!spot) { setStat("Tidak ada lahan lapang & datar di depanmu. Cari tempat terbuka, jauh dari air dan pohon."); return; } }
      P.wood -= r.wood; P.meat -= meat;
      if (id === "armor") { P.armor = true; E.msg = "Zirah terpasang! Luka dari satwa & bencana berkurang separuh."; }
      else if (id === "sword") { P.has.sword = true; setTool("sword"); }
      else if (id === "rod") { P.has.rod = true; setTool("rod"); }
      else if (id === "boat") { P.has.boat = true; E.msg = "Perahu siap! Dekati air lalu naik (B / tombol PERAHU)."; }
      else if (id === "house") { houses.push({ x: spot.x, y: spot.y, a: spot.a }); E.msg = "Rumah berdiri! Masuk lewat pintunya untuk berlindung."; }
      E.mt = 4; floats.push({ x: P.x, y: P.y, h: 50, t: 1.4, s: "✔ " + r.name, c: "#f0d9a0" });
      questEv("craft"); chime(); if (toolUI) toolUI(); saveInv();
      if (id === "house") closeCraft(); else { setStat("✔ " + r.name + " berhasil dirakit!"); renderCraft(); }
    }


    /* ---------- INVENTARIS (TAS): tersimpan per akun di localStorage ---------- */
    var KEEP_BAG_ON_DEATH = true; // true: isi tas tetap ada setelah mati. Ubah ke false jika ingin hilang saat mati.
    var INV_PREFIX = "fm_inv_", invKey = null, invSig = "", invT = 0, bagBox = null, bagStat = null;
    var TOOLS = [
      { id: "spear", ico: "🔱", name: "Tombak", desc: "Lempar ke satwa. Tombol 1.", key: "1" },
      { id: "axe", ico: "🪓", name: "Kapak", desc: "Tebang pohon untuk dapat kayu. Tombol 2.", key: "2" },
      { id: "sword", ico: "⚔️", name: "Pedang", desc: "Tebas satwa di depanmu. Tombol 3.", key: "3" },
      { id: "rod", ico: "🎣", name: "Pancingan", desc: "Pancing ikan dari air. Tombol 4.", key: "4" }
    ];
    function invData() {
      return { v: 1, wood: P.wood, meat: P.meat, armor: !!P.armor, has: { sword: !!P.has.sword, rod: !!P.has.rod, boat: !!P.has.boat }, tool: P.tool, q: qSave(), qd: P.qd | 0 };
    }
    function applyInv(d) {
      if (!d || typeof d !== "object") return;
      var n = function (v) { v = Math.floor(+v); return isFinite(v) && v > 0 ? Math.min(v, 9999) : 0; }, h = d.has || {}, OK = { spear: 1, axe: 1, sword: 1, rod: 1 };
      P.wood = n(d.wood); P.meat = n(d.meat); P.armor = !!d.armor;
      P.has.sword = !!h.sword; P.has.rod = !!h.rod; P.has.boat = !!h.boat;
      P.tool = (OK[d.tool] && (d.tool === "spear" || d.tool === "axe" || P.has[d.tool])) ? d.tool : "spear";
      qLoad(d.q); P.qd = n(d.qd);
    }
    function loadInv() {
      var raw = null; if (!invKey) return;
      try { raw = localStorage.getItem(INV_PREFIX + invKey); } catch (e) {}
      if (!raw) { invSig = ""; return; }
      try { applyInv(JSON.parse(raw)); invSig = JSON.stringify(invData()); } catch (e) { invSig = ""; }
    }
    function saveInv() {
      if (!loggedIn || !invKey || !P) return;
      var sg = JSON.stringify(invData()); if (sg === invSig) return;
      try { localStorage.setItem(INV_PREFIX + invKey, sg); invSig = sg; } catch (e) {}
    }
    var EAT_HP = 20, EAT_HU = 20; // satu daging = +20% nyawa dan +20% kenyang
    function eatMeat() { // makan 1 daging; mengembalikan pesan hasil
      if (P.hp <= 0) return "";
      if (P.meat <= 0) return "Tidak ada daging di tas. Berburu atau memancing dulu.";
      if (P.hp >= 100 && P.hu >= 100) return "Nyawa dan perutmu sudah penuh, daging disimpan.";
      P.meat--; P.hp = Math.min(100, P.hp + EAT_HP); P.hu = Math.min(100, P.hu + EAT_HU);
      floats.push({ x: P.x, y: P.y, h: 34, t: 1.4, s: "+20% nyawa +20% lapar", c: "#ffd0b0" });
      E.msg = "Kamu makan daging: nyawa +20%, kenyang +20%."; E.mt = 3; questEv("eat"); saveInv();
      return "✔ Makan daging: nyawa +20%, kenyang +20%.";
    }
    function bagSay(t) { if (bagStat) bagStat.textContent = t || ""; }
    function renderBag() {
      if (!bagBox) return;
      var h = '<div id="bg-res"><span>🪵 Kayu <b>' + P.wood + '</b></span><span>🍖 Daging <b>' + P.meat + '</b></span><span>⭐ Skor <b>' + score + '</b></span></div>';
      h += '<div class="mn-sec">Makanan</div>';
      h += '<div class="bg-row' + (P.meat > 0 ? '' : ' lock') + '"><div class="cm-ico">🍖</div><div class="cm-inf"><b>Daging × ' + P.meat + '</b><small>Dimakan: nyawa +20% dan kenyang +20%.</small></div>' +
        '<button class="cm-go" data-eat="1"' + (P.meat > 0 && P.hp > 0 ? '' : ' disabled') + '>Makan</button></div>';
      h += '<div class="mn-sec">Alat</div>';
      TOOLS.forEach(function (t) {
        var has = t.id === "spear" || t.id === "axe" || !!P.has[t.id], on = P.tool === t.id;
        h += '<div class="bg-row' + (has ? '' : ' lock') + (on ? ' on' : '') + '"><div class="cm-ico">' + t.ico + '</div><div class="cm-inf"><b>' + t.name + '</b><small>' + (has ? t.desc : 'Belum dimiliki. Rakit di tab Rakit.') + '</small></div>' +
          '<button class="cm-go" data-tool="' + t.id + '"' + (!has || on ? ' disabled' : '') + '>' + (on ? 'Dipegang' : has ? 'Pakai' : '🔒') + '</button></div>';
      });
      h += '<div class="mn-sec">Perlengkapan</div>';
      h += '<div class="bg-row' + (P.armor ? '' : ' lock') + '"><div class="cm-ico">🛡️</div><div class="cm-inf"><b>Zirah Pelindung</b><small>' + (P.armor ? 'Terpasang. Luka berkurang separuh.' : 'Belum dimiliki.') + '</small></div></div>';
      h += '<div class="bg-row' + (P.has.boat ? '' : ' lock') + '"><div class="cm-ico">⛵</div><div class="cm-inf"><b>Perahu</b><small>' + (P.has.boat ? 'Dimiliki. Naik/turun: B.' : 'Belum dimiliki.') + '</small></div></div>';
      h += '<div class="bg-row' + (houses.length ? '' : ' lock') + '"><div class="cm-ico">🏠</div><div class="cm-inf"><b>Rumah</b><small>Dibangun ' + houses.length + ' dari 2. Rumah berdiri di dunia, bukan di dalam tas.</small></div></div>';
      bagBox.innerHTML = h;
    }
    function equipFromBag(id) {
      if (P.hp <= 0 || P.tool === id) return;
      setTool(id); saveInv(); renderBag(); bagSay(P.tool === id ? "✔ " + TMSG[id] : "Alat belum dimiliki.");
    }
    function bagSave() { try { saveInv(); } catch (e) {} }
    addEventListener("pagehide", bagSave); addEventListener("beforeunload", bagSave);
    document.addEventListener("visibilitychange", function () { if (document.hidden) bagSave(); });

    /* ---------- DUNIA BARU: buat / pilih pulau (ID pulau otomatis, pulau tersimpan di perangkat) ---------- */
    var wdBox = null, wdStat = null, wdArm = null, wdLock = !!window.ForestMP;
    function wdSay(t) { if (wdStat) wdStat.textContent = t || ""; }
    function renderWorld() {
      if (!wdBox) return;
      var W0 = FM.worlds, cur = FM.world || (W0 && W0.current()), list = W0 ? W0.list() : [], h = "", i, w, on;
      if (!W0) { wdBox.innerHTML = '<div class="pf-empty">Fitur dunia butuh map.js versi terbaru.</div>'; return; }
      h += '<div class="pf-card me"><div class="pf-av">🌍</div><div class="pf-inf"><b>' + esc(cur ? cur.name : "Pulau") + ' <small>(aktif)</small></b><span class="pf-id">' + esc(cur ? cur.id : "-") + '</span></div></div>';
      if (wdLock) h += '<div class="mn-note">Mode server: pulau ditentukan server, jadi pulau baru tidak bisa dibuat dari sini.</div>';
      h += '<div class="pf-edit"><input id="wd-name" maxlength="20" placeholder="Nama pulau baru (boleh kosong)"' + (wdLock ? ' disabled' : '') + '></div>' +
        '<button class="pf-btn" style="width:100%" data-w="new"' + (wdLock ? ' disabled' : '') + '>' + (wdArm === "new" ? '⚠ Ketuk lagi untuk membuat & pindah' : '🏝️ Buat Pulau Baru') + '</button>' +
        '<div class="mn-note">Pulau baru punya ID otomatis dan bentuk yang berbeda. Isi tas, akun, dan ID-mu ikut terbawa. Rumah yang sudah dibangun tetap di pulau lamanya.</div>' +
        '<div class="mn-sec">Pulau tersimpan (' + list.length + '/' + W0.max + ')</div>';
      for (i = list.length - 1; i >= 0; i--) {
        w = list[i]; on = cur && w.id === cur.id;
        h += '<div class="bg-row' + (on ? ' on' : '') + '"><div class="cm-ico">' + (on ? '📍' : '🏝️') + '</div><div class="cm-inf"><b>' + esc(w.name) + '</b><small>' + esc(w.id) + '</small></div>' +
          '<button class="cm-go" data-w="go" data-id="' + esc(w.id) + '"' + (on || wdLock ? ' disabled' : '') + '>' + (on ? 'Aktif' : (wdArm === w.id ? 'Yakin?' : 'Masuk')) + '</button></div>';
      }
      wdBox.innerHTML = h;
    }
    function wdTravel(fn) {
      var w = fn(); if (!w) { wdSay("⚠ Gagal: daftar pulau penuh atau penyimpanan tidak tersedia."); wdArm = null; renderWorld(); return; }
      saveInv(); wdSay("✔ Menuju " + w.name + " (" + w.id + ")…");
      setTimeout(function () { try { location.reload(); } catch (e) { wdSay("Muat ulang halaman secara manual untuk masuk ke " + w.name + "."); } }, 250);
    }
    function wdAct(k, id) {
      if (wdLock) return;
      if (wdArm !== (k === "new" ? "new" : id)) { wdArm = k === "new" ? "new" : id; wdSay("Ketuk sekali lagi untuk pindah. Permainan akan dimuat ulang."); renderWorld(); return; }
      wdArm = null;
      if (k === "new") { var inp = wdBox.querySelector("#wd-name"); wdTravel(function () { return FM.worlds.create(inp ? inp.value : ""); }); }
      else wdTravel(function () { return FM.worlds.select(id); });
    }


    /* =====================================================================
       MISI (QUEST) — selesaikan misi untuk mendapat KAYU + DAGING
       Selalu ada 3 misi aktif. Saat satu selesai, hadiah langsung masuk tas dan misi baru muncul.
       Buka dengan tombol J atau menu ☰ > Misi. Progres tersimpan per akun bersama isi tas.
       Menambah misi: tambah satu baris di QT (ev = jenis peristiwa, lo/hi = jumlah, bw/wu = kayu, bm/mu = daging).
       ===================================================================== */
    /* MISI-BEGIN */
    var QT = [
      { ev: "chop", ico: "🪓", txt: "Tebang {n} pohon", desc: "Pakai kapak (tombol 2).", lo: 3, hi: 6, bw: 3, wu: 2, bm: 1, mu: 0 },
      { ev: "kill", ty: ["ayam", "kancil", "monyet", "merak"], ico: "🏹", txt: "Buru {n} satwa kecil", desc: "Ayam hutan, kancil, monyet, atau merak.", lo: 2, hi: 4, bw: 3, wu: 2, bm: 0, mu: 1 },
      { ev: "kill", ty: ["rusa", "babi", "banteng", "biawak"], ico: "🦌", txt: "Buru {n} satwa besar", desc: "Rusa, babi hutan, banteng, atau biawak.", lo: 1, hi: 3, bw: 4, wu: 6, bm: 1, mu: 2 },
      { ev: "kill", ty: ["ular"], ico: "🐍", txt: "Singkirkan {n} ular", desc: "Hati-hati, gigitannya berbisa.", lo: 1, hi: 2, bw: 4, wu: 4, bm: 1, mu: 1 },
      { ev: "kill", ty: ["harimau"], ico: "🐅", txt: "Kalahkan {n} harimau", desc: "Misi berbahaya, hadiah besar.", lo: 1, hi: 1, bw: 22, wu: 0, bm: 6, mu: 0 },
      { ev: "kill", ty: ["buaya"], ico: "🐊", txt: "Kalahkan {n} buaya", desc: "Cari di tepi sungai.", lo: 1, hi: 1, bw: 20, wu: 0, bm: 6, mu: 0 },
      { ev: "kill", ty: ["gajah"], ico: "🐘", txt: "Kalahkan {n} gajah", desc: "Satwa terbesar di rimba.", lo: 1, hi: 1, bw: 30, wu: 0, bm: 8, mu: 0 },
      { ev: "fish", ico: "🎣", txt: "Tangkap {n} ikan", desc: "Pancingan (tombol 4) di tepi air.", lo: 2, hi: 4, bw: 2, wu: 3, bm: 1, mu: 1 },
      { ev: "fire", ico: "🔥", txt: "Nyalakan {n} api unggun", desc: "Tombol G.", lo: 2, hi: 3, bw: 2, wu: 3, bm: 1, mu: 0 },
      { ev: "eat", ico: "🍖", txt: "Makan {n} daging", desc: "Tahan E; hanya jika nyawa/perut belum penuh.", lo: 2, hi: 3, bw: 4, wu: 2, bm: 1, mu: 1 },
      { ev: "craft", ico: "🔨", txt: "Rakit {n} benda", desc: "Buka menu Rakit (R).", lo: 1, hi: 1, bw: 8, wu: 0, bm: 2, mu: 0 },
      { ev: "trip", ico: "🧭", txt: "Jelajah {n} m, lalu pulang", desc: "Menjauhlah dari tepi Zona Aman sejauh ini, lalu kembali ke dalamnya.", lo: 450, hi: 800, step: 50, bw: 8, wu: .03, bm: 3, mu: .004 }
    ];
    var QN = 3, qBox = null, qStat = null, qArm = -1;
    function qMake(t) {
      var T = QT[t], st = T.step || 1, n = T.lo + Math.floor(Math.random() * ((T.hi - T.lo) / st + 1)) * st;
      return { t: t, n: n, p: 0, w: Math.max(1, Math.round(T.bw + T.wu * n)), m: Math.max(1, Math.round(T.bm + T.mu * n)), far: 0 };
    }
    function qNew(skip) { // misi baru yang jenisnya belum ada di daftar aktif (dan bukan yang barusan selesai)
      var used = {}, i, t, tries = 0;
      for (i = 0; i < P.q.length; i++) if (i !== skip) used[P.q[i].t] = 1;
      if (skip != null && P.q[skip]) used[P.q[skip].t] = 1;
      do { t = Math.floor(Math.random() * QT.length); } while (used[t] && ++tries < 60);
      return qMake(t);
    }
    function ensureQuests() {
      if (!QT || !P) return;
      if (!P.q) P.q = [];
      if (P.q.length > QN) P.q.length = QN;
      while (P.q.length < QN) P.q.push(qNew(null));
    }
    function qText(q) { var T = QT[q.t]; return T ? T.txt.replace("{n}", q.n) : "?"; }
    function qSave() {
      return (P && P.q ? P.q : []).map(function (q) { return { t: q.t, n: q.n, p: QT[q.t] && QT[q.t].ev === "trip" ? 0 : q.p, w: q.w, m: q.m }; });
    }
    function qLoad(arr) { // validasi data tersimpan (tidak dipercaya begitu saja)
      var out = [], used = {}, i, x, T, I = function (v, lo, hi) { v = Math.floor(+v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo; };
      if (Array.isArray(arr)) for (i = 0; i < arr.length && out.length < QN; i++) {
        x = arr[i]; if (!x || typeof x !== "object") continue;
        T = QT[I(x.t, -1, QT.length)]; if (!T || used[x.t]) continue;
        var n = I(x.n, T.lo, T.hi);
        used[x.t] = 1; out.push({ t: x.t | 0, n: n, p: Math.min(n - 1, I(x.p, 0, n)), w: I(x.w, 1, 999), m: I(x.m, 1, 999), far: 0 });
      }
      P.q = out; ensureQuests();
    }
    function questDone(i) {
      var q = P.q[i], g;
      if (!q) return;
      P.wood = Math.min(9999, P.wood + q.w); P.meat = Math.min(9999, P.meat + q.m); score += 15; P.qd = (P.qd | 0) + 1;
      floats.push({ x: P.x, y: P.y, h: 62, t: 2.4, s: "✅ Misi selesai!", c: "#9dff9d" });
      floats.push({ x: P.x, y: P.y, h: 44, t: 2.4, s: "🪵 +" + q.w + "   🍖 +" + q.m, c: "#ffe9a8" });
      E.msg = "✅ Misi selesai: " + qText(q) + " → +" + q.w + " kayu, +" + q.m + " daging"; E.mt = 5;
      chime(); g = qNew(i); P.q[i] = g; saveInv();
      if (menuOpen && menuTab === "quest") renderQuest();
    }
    function questEv(ev, sub) { // dipanggil dari aksi permainan; naikkan progres semua misi yang cocok
      if (!QT || !P || !P.q) return;
      var i, q, T, done = [];
      for (i = 0; i < P.q.length; i++) {
        q = P.q[i]; T = QT[q.t];
        if (!T || T.ev !== ev || q.p >= q.n) continue;
        if (T.ty && T.ty.indexOf(sub) < 0) continue;
        q.p++; if (q.p >= q.n) done.push(i);
      }
      for (i = 0; i < done.length; i++) questDone(done[i]);
    }
    function questTick() { // misi jelajah: jauhi Zona Aman sejauh n, lalu pulang ke dalamnya dalam satu perjalanan
      if (!QT || !P.q) return;
      var dh = Math.hypot(P.x - SAFE.x, P.y - SAFE.y), inside = dh < SAFE.r, i, q, done = [];
      for (i = 0; i < P.q.length; i++) {
        q = P.q[i]; if (!QT[q.t] || QT[q.t].ev !== "trip") continue;
        if (!inside) { if (dh - SAFE.r > (q.far || 0)) q.far = dh - SAFE.r; q.p = Math.min(q.n - 1, Math.floor(q.far)); }
        else if ((q.far || 0) >= q.n) done.push(i);
        else { q.far = 0; q.p = 0; }
      }
      for (i = 0; i < done.length; i++) questDone(done[i]);
    }
    function qSay(t) { if (qStat) qStat.textContent = t || ""; }
    function qReroll(i) {
      if (!P.q || !P.q[i]) return;
      if (qArm !== i) { qArm = i; qSay("Ketuk \"Yakin?\" sekali lagi untuk mengganti misi ini (progresnya hilang)."); renderQuest(); return; }
      qArm = -1; P.q[i] = qNew(i); saveInv(); qSay("Misi diganti."); renderQuest();
    }
    function renderQuest() {
      if (!qBox || !P || !P.q) return;
      var h = '<div id="bg-res"><span>🪵 Kayu <b>' + P.wood + '</b></span><span>🍖 Daging <b>' + P.meat + '</b></span><span>✅ Selesai <b>' + (P.qd | 0) + '</b></span></div>';
      var dh = Math.hypot(P.x - SAFE.x, P.y - SAFE.y), inside = dh < SAFE.r, i, q, T, pct;
      h += '<div class="mn-sec">🛡️ Zona Aman</div><div class="mn-note">' + (inside ? 'Kamu berada di dalam Zona Aman: satwa liar tidak bisa masuk dan nyawa pulih pelan.' : 'Zona Aman (lingkaran bertiang hijau) berjarak ' + Math.round(dh - SAFE.r) + ' m dari sini. Di dalamnya satwa liar tidak bisa masuk dan nyawa pulih pelan.') + '</div>';
      h += '<div class="mn-sec">📜 Misi aktif</div>';
      for (i = 0; i < P.q.length; i++) {
        q = P.q[i]; T = QT[q.t]; if (!T) continue;
        pct = Math.max(0, Math.min(100, Math.round(q.p / q.n * 100)));
        h += '<div class="cm-row"><div class="cm-ico">' + T.ico + '</div><div class="cm-inf"><b>' + esc(qText(q)) + '</b><small>' + esc(T.desc) + '</small><div class="qp"><i style="width:' + pct + '%"></i></div>' +
          '<div class="cm-cost"><span>' + q.p + ' / ' + q.n + (T.ev === "trip" ? ' m' : '') + '</span><span>Hadiah: 🪵 ' + q.w + '</span><span>🍖 ' + q.m + '</span></div></div>' +
          '<button class="cm-go" data-qr="' + i + '">' + (qArm === i ? 'Yakin?' : '↻ Ganti') + '</button></div>';
      }
      qBox.innerHTML = h;
    }
    /* MISI-END */

    /* =====================================================================
       PANEL ADMIN (OWNER)  — hanya untuk akun dengan ID OWNER_ID
       Isi: Terbang · Penjara · Jailbreak · Iceplayer
       KEAMANAN ID OWNER (anti-palsu):
       1) ID OWNER_ID dicadangkan: tidak pernah dibuat acak, tidak bisa dipasang lewat setId / localStorage.
       2) Akun ber-ID owner hanya bisa masuk dengan "Kunci Owner" (dipakai sebagai kata sandi); tidak ada masuk-otomatis.
       3) Ke pemain lain, owner dibuktikan dengan TANDA TANGAN DIGITAL (ECDSA P-256): lencana/ID owner, chat owner, perintah
          admin, invisible & terbang hanya diakui jika tanda tangannya sah terhadap kunci publik OWNER_PUB.
          Kunci privatnya hanya bisa dibuka dengan Kunci Owner. Event "admin" tetap diteruskan server -> net.admin(id, data).
       Catatan: butuh HTTPS atau localhost (WebCrypto). Mengubah klien sendiri tidak bisa membuat pemain lain percaya.
       ===================================================================== */
    var OWNER_SALT = "4fb1838f69b932f6f8e05b94f4949300", OWNER_HASH = "cfc849f1187fb34efdfb952a7c419daa5d2b6f33e42c580be0cd1fa8c9124ff5"; // pengecekan lokal Kunci Owner (hash bergaram, bukan teks asli)
    var OWNER_PUB = {"kty": "EC", "crv": "P-256", "x": "Jthy_bXetJb3SKMgI1BExCybdUxBLSPC-lqGvX17H2M", "y": "GRHYMH1D2kMMIb7nvX02C2doppHcjr6PbPlej_SAXzo"}; // kunci PUBLIK owner (ECDSA P-256): dipakai SEMUA pemain untuk memeriksa tanda tangan
    var OWNER_WRAP = {"s": "7c39a2121368c1bf5460978627ef7a68", "iv": "fd211e834465bbf9f114af18", "d": "f8b9b50f61b30912db3509ed23e236c14a194c2c5e8ffe4dad32984fce159dda2331a341f5292d47810954ccba1cf8f6de8fa92fc0278e50c38a8137eeae6cb08ac845f2ecdbd142b6a384f81630faca2989dc8d2dab54cead6f5612c4e8948bd570fade636c93d48c47cc8242c42251f5c54a1f6637f4e68567dbc163bc9455e1acb2d4c3e3f509390e3d0e732172a48d929422eb3e0aaaacb3b41f07f8d7c561179c5d816ecaa0910f780f1ffa87156d5e3edc0d53997088188c51f4dfc51edf3282feb8fdc1b5dc3a7f0eefe4716ee0388c6d7f8369f3d3ee6df1f2ee", "n": 250000}; // kunci PRIVAT owner, terenkripsi AES-GCM dengan Kunci Owner (tanpa Kunci Owner tidak bisa dibuka)
    var ownerOK = false, ownerPriv = null, ownerCert = null, ocT = 0, seenNonce = {}, ownerPubP = null, SUBTLE = null;
    try { SUBTLE = (window.crypto && window.crypto.subtle) || null; } catch (e) {}
    function h2b(h) { var u = new Uint8Array(h.length / 2), i; for (i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16); return u; }
    function b2h(b) { var u = new Uint8Array(b), o = "", i, t; for (i = 0; i < u.length; i++) { t = u[i].toString(16); o += (t.length < 2 ? "0" : "") + t; } return o; }
    function ownerPubKey() {
      if (!SUBTLE) return Promise.resolve(null);
      if (!ownerPubP) ownerPubP = SUBTLE.importKey("jwk", OWNER_PUB, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]).catch(function () { return null; });
      return ownerPubP;
    }
    function ownerVerify(msg, sig) { // true hanya jika msg benar-benar ditandatangani kunci privat owner
      return ownerPubKey().then(function (k) {
        if (!k || typeof sig !== "string" || !/^[0-9a-f]{128}$/.test(sig)) return false;
        return SUBTLE.verify({ name: "ECDSA", hash: "SHA-256" }, k, h2b(sig), new TextEncoder().encode(msg));
      }).catch(function () { return false; });
    }
    function ownerSign(msg) {
      if (!SUBTLE || !ownerPriv) return Promise.resolve(null);
      return SUBTLE.sign({ name: "ECDSA", hash: "SHA-256" }, ownerPriv, new TextEncoder().encode(msg)).then(b2h).catch(function () { return null; });
    }
    function unlockOwner(pw) { // buka kunci privat memakai Kunci Owner; hanya berhasil jika Kunci Owner benar
      ownerPriv = null; ownerCert = null;
      if (!SUBTLE) return Promise.resolve(false);
      return SUBTLE.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]).then(function (b) {
        return SUBTLE.deriveKey({ name: "PBKDF2", salt: h2b(OWNER_WRAP.s), iterations: OWNER_WRAP.n, hash: "SHA-256" }, b, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
      }).then(function (k) { return SUBTLE.decrypt({ name: "AES-GCM", iv: h2b(OWNER_WRAP.iv) }, k, h2b(OWNER_WRAP.d)); })
        .then(function (pt) { return SUBTLE.importKey("jwk", JSON.parse(new TextDecoder().decode(pt)), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]); })
        .then(function (k) { ownerPriv = k; refreshCert(); return true; }).catch(function () { return false; });
    }
    function refreshCert() { // sertifikat kehadiran owner: berlaku 60 dtk, diperbarui tiap 20 dtk
      if (!ownerOK) return; var t = Date.now();
      ownerSign("own|" + OWNER_ID + "|" + t).then(function (sg) { if (sg && ownerOK) ownerCert = { t: t, sg: sg }; });
    }
    function verifyCert(r, oc) {
      if (!oc || typeof oc !== "object" || typeof oc.sg !== "string" || r.ocSg === oc.sg) return;
      var t = +oc.t; if (!isFinite(t) || Math.abs(Date.now() - t) > 60000) return;
      r.ocSg = oc.sg;
      ownerVerify("own|" + OWNER_ID + "|" + t, oc.sg).then(function (ok) { if (ok) r.oex = t + 60000; else r.ocSg = null; });
    }
    function admMsg(p) { return ["adm", p.cmd, p.toUid || "", +p.sec || 0, p.t, p.n].join("|"); }
    function sendAdmin(p) { // perintah admin ke pemain lain WAJIB ditandatangani owner (anti-palsu)
      if (!net.emit) return "nonet";
      if (!ownerOK || !ownerPriv) return "nokey";
      p.t = Date.now(); p.n = genSalt().slice(0, 16);
      ownerSign(admMsg(p)).then(function (sg) { if (!sg) return; p.sg = sg; net.emit("admin", p); });
      return "";
    }
    var flyU = false, flyD = false, flyBox = null, flyOn = false, adBox = null, adStat = null, adSel = "me", adSj = 120, adSi = 20;
    var invShown = false, PRISON = null, prisonG = null, prisonGone = true, prisonK = 0, jbT = 0, iceMe = null, iceMat = null;
    function isAdmin() { return !!loggedIn && ownerOK === true && myId === OWNER_ID; }
    function prisonSpot() { // lokasi penjara: lahan datar & lapang dekat titik awal (sama untuk semua pemain di pulau yang sama)
      if (PRISON) return PRISON;
      var rr, an, x, y, spot = null;
      for (rr = 70; rr <= 480 && !spot; rr += 30) for (an = 0; an < 6.28 && !spot; an += .35) {
        x = SPAWN.x + Math.cos(an) * rr; y = SPAWN.y + Math.sin(an) * rr;
        if (x < 90 || y < 90 || x > W - 90 || y > W - 90) continue;
        if (blocked(x, y, 60) || water(x, y) || FM.dense(x, y)) continue;
        if (Math.abs(groundY(x + 26, y + 26) - groundY(x - 26, y - 26)) > 5 || Math.abs(groundY(x + 26, y - 26) - groundY(x - 26, y + 26)) > 5) continue;
        spot = { x: x, y: y };
      }
      return (PRISON = spot || { x: SPAWN.x + 160, y: SPAWN.y });
    }
    function buildPrison() {
      var ps = prisonSpot(), g = new THREE.Group(), bars = new THREE.Group(), IRON = M(0x4a4f55), DARK = M(0x2c2f33), STONE = M(0x77746c), H = 34, S = 22, i, o;
      g.add(mesh(BOX, STONE, 50, 1, 50, 0, 0, 0), mesh(BOX, DARK, 52, 3, 52, 0, H + 3, 0));
      [[-S, -S], [S, -S], [-S, S], [S, S]].forEach(function (c) { g.add(mesh(BOX, DARK, 3.4, H + 3, 3.4, c[0], (H + 3) / 2, c[1])); });
      for (i = -3; i <= 3; i++) { o = i * 6; bars.add(mesh(BOX, IRON, 1.3, H, 1.3, o, H / 2 + 1, -S), mesh(BOX, IRON, 1.3, H, 1.3, o, H / 2 + 1, S), mesh(BOX, IRON, 1.3, H, 1.3, -S, H / 2 + 1, o), mesh(BOX, IRON, 1.3, H, 1.3, S, H / 2 + 1, o)); }
      [7, H - 4].forEach(function (yy) { bars.add(mesh(BOX, IRON, 2 * S, 1.6, 1.4, 0, yy, -S), mesh(BOX, IRON, 2 * S, 1.6, 1.4, 0, yy, S), mesh(BOX, IRON, 1.4, 1.6, 2 * S, -S, yy, 0), mesh(BOX, IRON, 1.4, 1.6, 2 * S, S, yy, 0)); });
      g.add(bars); g.userData.bars = bars; g.position.set(ps.x, groundY(ps.x, ps.y), ps.y); scene.add(g); return g;
    }
    function mkIce() {
      if (!iceMat) iceMat = new THREE.MeshLambertMaterial({ color: 0x9fe3ff, transparent: true, opacity: .55, emissive: 0x2a5a78 });
      var g = new THREE.Group(); g.add(mesh(BOX, iceMat, 20, 44, 22, 0, 22, 0), mesh(BOX, iceMat, 16, 36, 26, 0, 22, 0, 0, .7, 0)); g.visible = false; scene.add(g); return g;
    }
    prisonG = buildPrison(); prisonG.visible = false; iceMe = mkIce(); // penjara tersembunyi sampai ada yang dipenjara
    function ghostMe() { // badan sendiri jadi transparan saat invisible (hanya terlihat samar oleh owner)
      if (!me.ghostInit) { // klon material alat (cache bersama) agar tidak ikut mengubah objek lain
        me.ghostInit = true; var own = {}, gk; for (gk in me.mats) own[me.mats[gk].uuid] = 1;
        me.root.traverse(function (o) { if (o.material && !Array.isArray(o.material) && !own[o.material.uuid]) o.material = o.material.clone(); });
      }
      me.root.traverse(function (o) { if (o.material && !Array.isArray(o.material)) { o.material.transparent = invShown; o.material.opacity = invShown ? .32 : 1; o.material.needsUpdate = true; } if (o.isMesh) o.castShadow = !invShown; });
    }
    function iceAnimal(a, ag) { // balok es di satwa yang beku
      if (!(a.frz > 0)) { if (a.ice3) a.ice3.visible = false; return; }
      if (!a.ice3) { a.ice3 = mkIce(); var k = Math.max(.6, a.d.r / 11); a.ice3.scale.set(k, k, k); }
      a.ice3.visible = true; a.ice3.position.set(a.x, ag, a.y);
    }
    function iceHitPlayer(r) { // tombak es mengenai pemain: kirim perintah beku lewat jalur admin
      var sec = Math.max(3, Math.min(600, adSi || 20));
      floats.push({ x: r.p.x, y: r.p.y, h: 50, t: 1.2, s: "❄ Beku " + sec + " dtk", c: "#bfeaff" });
      sendAdmin({ cmd: "ice", to: r.id, toUid: idOf(r), sec: sec, from: myId });
    }
    function toggleInv() {
      if (!isAdmin() || P.hp <= 0) return;
      P.inv = !P.inv; E.msg = P.inv ? "👻 Invisible HIDUP: pemain lain dan satwa tidak melihatmu." : "Invisible MATI."; E.mt = 3;
    }
    function toggleIceSp() {
      if (!isAdmin() || P.hp <= 0) return;
      P.icesp = !P.icesp; if (P.icesp) setTool("spear");
      E.msg = P.icesp ? "❄ Tombak Es HIDUP: lempar tombak (tombol 1) untuk membekukan." : "Tombak Es MATI."; E.mt = 3;
    }
    function adminRender(dt, gy) {
      if (invShown !== !!P.inv) { invShown = !!P.inv; ghostMe(); }
      // penjara: tersembunyi normalnya; muncul hanya saat ada yang dipenjara (diri sendiri atau pemain lain), hilang lagi saat semua bebas / jailbreak
      var need = P.jail > 0, ri;
      if (jbT > 0) jbT -= dt;
      if (!need) for (ri = 0; ri < remote.length; ri++) if (remote[ri].p.jl) { need = true; break; }
      prisonGone = !(need && jbT <= 0); // hanya terlihat saat ada yang dipenjara
      prisonK += ((prisonGone ? 0 : 1) - prisonK) * Math.min(1, dt * 4); if (prisonGone && prisonK < .02) prisonK = 0;
      prisonG.visible = prisonK > 0; prisonG.scale.setScalar(Math.max(.001, prisonK));
      iceMe.visible = P.ice > 0 && P.hp > 0; if (iceMe.visible) iceMe.position.set(P.x, gy + P.z, P.y);
    }
    function iceShow(r, rg) {
      if (!r.p.ice && !r.ice3) return;
      if (!r.ice3) r.ice3 = mkIce();
      r.ice3.visible = !!r.p.ice && r.p.hp > 0 && !r.p.inv; if (r.ice3.visible) r.ice3.position.set(r.p.x, rg + (r.p.z || 0), r.p.y);
    }
    function outPoint(ps) { var k, x, y; for (k = 0; k < 8; k++) { x = ps.x + Math.cos(k * .785) * 36; y = ps.y + Math.sin(k * .785) * 36; if (!blocked(x, y, 8)) return { x: x, y: y }; } return { x: ps.x + 36, y: ps.y }; }
    function jailMe(sec) {
      prisonGone = false; jbT = 0; var ps = prisonSpot(); P.jail = Math.max(1, sec); P.fly = false; P.rid = false; P.fs = null; P.pend = 0; P.vz = 0; P.z = 0; P.kx = P.ky = 0;
      P.x = ps.x; P.y = ps.y; P.lx = P.x; P.ly = P.y;
      E.msg = "🔒 Kamu dipenjara selama " + Math.round(sec) + " detik."; E.mt = 5; if (toolUI) toolUI();
    }
    function releaseMe(msg) {
      if (P.jail <= 0) return; var o = outPoint(prisonSpot());
      P.jail = 0; P.x = o.x; P.y = o.y; P.lx = P.x; P.ly = P.y; E.msg = msg || "Kamu bebas dari penjara."; E.mt = 4;
    }
    function freezeMe(sec) { P.ice = Math.max(1, Math.min(600, sec)); P.fly = false; P.fs = null; P.pend = 0; keys = {}; E.msg = "🧊 Kamu membeku!"; E.mt = 4; }
    function thawMe(msg) { if (P.ice <= 0) return; P.ice = 0; E.msg = msg || "Esnya mencair."; E.mt = 3; }
    function jailbreakFX() {
      prisonGone = true; jbT = 1.5; chime();
      if (P.jail > 0) releaseMe("🚨 JAILBREAK! Penjara runtuh, kamu bebas!"); else { E.msg = "🚨 JAILBREAK! Penjara menghilang, semua tahanan bebas."; E.mt = 4; }
    }
    function toggleFly() {
      if (!isAdmin() || P.hp <= 0) return;
      if (P.jail > 0 || P.ice > 0) { adSay("Tidak bisa terbang saat dipenjara atau beku."); return; }
      P.fly = !P.fly; P.rid = false; P.fs = null; P.vz = 0; if (P.fly) P.z = Math.max(P.z, 40);
      E.msg = P.fly ? "✈ Mode terbang HIDUP. Spasi/▲ naik, V/▼ turun, Shift cepat." : "Mode terbang MATI."; E.mt = 3;
    }
    function adminTick() {
      if (!isAdmin()) {
        P.fly = false; P.inv = false; P.icesp = false;
        if (mnTabs && mnTabs.admin && mnTabs.admin.style.display !== "none") mnTabs.admin.style.display = "none"; // tombol tab admin dipaksa tetap tersembunyi
        if (adBox && adBox.firstChild) adBox.innerHTML = "";
        if (menuOpen && menuTab === "admin") switchTab("profile");
      }
      if (flyBox && flyOn !== !!P.fly) { flyOn = !!P.fly; flyBox.style.display = flyOn ? "flex" : "none"; if (!flyOn) { flyU = false; flyD = false; } }
    }
    (function mkFlyUI() {
      if (!TOUCH) return;
      var css = document.createElement("style");
      css.textContent = "#fm-fly{position:fixed;z-index:5;right:calc(14px + env(safe-area-inset-right,0px));top:44%;display:none;flex-direction:column;gap:10px}#fm-fly div{width:58px;height:58px;border-radius:50%;border:3px solid rgba(255,255,255,.85);background:rgba(70,130,200,.85);color:#fff;font:700 24px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;touch-action:none;user-select:none;-webkit-user-select:none}";
      document.head.appendChild(css);
      flyBox = document.createElement("div"); flyBox.id = "fm-fly";
      flyBox.innerHTML = '<div data-d="u">▲</div><div data-d="d">▼</div>'; document.body.appendChild(flyBox);
      function set(e, v) { var t = e.target; if (!t || !t.getAttribute) return; var d = t.getAttribute("data-d"); if (d === "u") flyU = v; else if (d === "d") flyD = v; e.preventDefault(); }
      flyBox.addEventListener("pointerdown", function (e) { set(e, true); try { e.target.setPointerCapture(e.pointerId); } catch (er) {} });
      flyBox.addEventListener("pointerup", function (e) { set(e, false); }); flyBox.addEventListener("pointercancel", function (e) { set(e, false); });
    })();
    // pesan dari owner (multiplayer): dipanggil oleh server/transport sebagai net.admin(idPengirim, data)
    net.admin = function (id, d) {
      if (!d || typeof d.sg !== "string" || typeof d.cmd !== "string") return;
      var t = +d.t, n = String(d.n || ""), cmd = d.cmd, toUid = String(d.toUid || ""), now = Date.now(), q;
      if (!isFinite(t) || Math.abs(now - t) > 120000 || !n || seenNonce[n]) return; // kedaluwarsa / sudah pernah dipakai (anti-ulang)
      if (["jailbreak", "prison", "ice", "thaw", "free"].indexOf(cmd) < 0) return;
      ownerVerify(admMsg({ cmd: cmd, toUid: toUid, sec: d.sec, t: t, n: n }), d.sg).then(function (ok) {
        if (!ok || seenNonce[n]) return; // tanda tangan palsu -> abaikan
        seenNonce[n] = t; for (q in seenNonce) if (now - seenNonce[q] > 300000) delete seenNonce[q];
        var sec = Math.max(1, Math.min(3600, +d.sec || 60));
        if (cmd === "jailbreak") { jailbreakFX(); return; }
        if (toUid !== myId || !loggedIn || P.hp <= 0) return;
        if (cmd === "prison") jailMe(sec); else if (cmd === "ice") freezeMe(sec); else if (cmd === "thaw") thawMe(); else if (cmd === "free") releaseMe("Kamu dibebaskan oleh admin.");
      });
    };
    function adSay(t) { if (adStat) adStat.textContent = t || ""; }
    function renderAdmin() {
      if (!adBox) return;
      if (!isAdmin()) { adBox.innerHTML = ""; if (adStat) adStat.textContent = ""; return; } // hanya owner terverifikasi yang boleh melihat isi panel
      var h = "", i, r, sel = adSel;
      if (sel !== "me" && !net.find(sel)) sel = adSel = "me";
      h += '<div class="pf-card me"><div class="pf-av">🛠️</div><div class="pf-inf"><b>Panel Admin <small>(Owner)</small></b><span class="pf-id">' + esc(OWNER_ID) + '</span></div></div>' +
        '<div class="mn-sec">Terbang (diri sendiri)</div>' +
        '<button class="mn-opt" data-ad="fly"><span>✈ Terbang</span><b>' + (P.fly ? "HIDUP" : "MATI") + '</b></button>' +
        '<div class="mn-note">WASD / joystick = arah · Spasi atau ▲ naik · V atau ▼ turun · Shift = cepat. Bisa melewati pohon dan air.</div>' +
        '<div class="mn-sec">Mode lain (diri sendiri)</div>' +
        '<button class="mn-opt" data-ad="inv"><span>👻 Invisible</span><b>' + (P.inv ? "HIDUP" : "MATI") + '</b></button>' +
        '<button class="mn-opt" data-ad="icesp"><span>❄ Tombak Es</span><b>' + (P.icesp ? "HIDUP" : "MATI") + '</b></button>' +
        '<div class="mn-note">Invisible: tak terlihat pemain lain dan tak dikejar satwa (kamu tampak samar di layarmu). Tombak Es: lempar tombak (tombol 1) untuk membekukan satwa 20 dtk, atau pemain sesuai durasi Iceplayer.</div>' +
        '<div class="mn-sec">Pilih target</div>' +
        '<div class="bg-row' + (sel === "me" ? ' on' : '') + '" data-ad="sel" data-id="me" style="cursor:pointer"><div class="cm-ico">🧑</div><div class="cm-inf"><b>Diriku</b><small>' + esc(myName || "") + ' · ' + esc(myId) + '</small></div></div>';
      for (i = 0; i < remote.length; i++) { r = remote[i]; h += '<div class="bg-row' + (sel === r.id ? ' on' : '') + '" data-ad="sel" data-id="' + esc(r.id) + '" style="cursor:pointer"><div class="cm-ico">🧍</div><div class="cm-inf"><b>' + esc(r.name || "Tanpa nama") + '</b><small>' + esc(idOf(r)) + '</small></div></div>'; }
      if (!remote.length) h += '<div class="mn-note">Belum ada pemain lain. Perintah bisa dicoba pada dirimu sendiri.</div>';
      h += '<div class="mn-sec">Aksi pada target</div>' +
        '<div class="pf-edit"><input id="ad-sj" type="number" min="5" max="3600" value="' + adSj + '" title="detik"><button class="pf-btn" data-ad="prison">🔒 Penjara</button></div>' +
        '<div class="pf-edit"><input id="ad-si" type="number" min="3" max="600" value="' + adSi + '" title="detik"><button class="pf-btn" data-ad="ice">🧊 Iceplayer</button></div>' +
        '<div class="pf-edit"><button class="pf-btn" data-ad="thaw" style="flex:1">🔥 Cairkan</button><button class="pf-btn" data-ad="free" style="flex:1">🔓 Bebaskan</button></div>' +
        '<div class="mn-note">Angka di kiri = durasi (detik).</div>' +
        '<div class="mn-sec">Jailbreak</div>' +
        '<button class="pf-btn" style="width:100%" data-ad="jailbreak">🚨 Jailbreak: bebaskan semua tahanan</button>';
      adBox.innerHTML = h;
    }
    function adTarget() { if (adSel === "me") return { me: true }; var r = net.find(adSel); return r ? { r: r } : null; }
    function adNum(id, def, lo, hi) { var el = adBox.querySelector(id), v = el ? parseInt(el.value, 10) : NaN; if (!isFinite(v)) v = def; return Math.max(lo, Math.min(hi, v)); }
    function adAct(k, id) {
      if (!isAdmin()) return;
      if (k === "sel") { adSel = id; renderAdmin(); return; }
      if (k === "fly") { toggleFly(); renderAdmin(); return; }
      if (k === "inv") { toggleInv(); renderAdmin(); return; }
      if (k === "icesp") { toggleIceSp(); renderAdmin(); return; }
      var sj = adNum("#ad-sj", adSj, 5, 3600), si = adNum("#ad-si", adSi, 3, 600); adSj = sj; adSi = si;
      if (k === "jailbreak") { jailbreakFX(); var jr = sendAdmin({ cmd: "jailbreak", to: "all", from: myId }); adSay(jr === "nokey" ? "⚠ Jailbreak lokal OK, tapi tidak terkirim: kunci tanda tangan belum aktif (butuh HTTPS)." : "✔ Jailbreak! Penjara menghilang dan semua tahanan bebas."); renderAdmin(); return; }
      var t = adTarget(); if (!t) { adSay("⚠ Target sudah tidak ada."); renderAdmin(); return; }
      var sec = k === "prison" ? sj : si, nm = t.me ? "dirimu" : (t.r.name || idOf(t.r));
      if (t.me) {
        if (k === "prison") jailMe(sec); else if (k === "ice") freezeMe(sec); else if (k === "thaw") thawMe(); else if (k === "free") releaseMe("Kamu dibebaskan.");
        adSay("✔ " + k + " diterapkan pada " + nm + ".");
      } else {
        var sr = sendAdmin({ cmd: k, to: t.r.id, toUid: idOf(t.r), sec: sec, from: myId });
        adSay(sr === "nonet" ? "⚠ Belum terhubung ke multiplayer, perintah ke pemain lain tidak terkirim." : sr === "nokey" ? "⚠ Kunci tanda tangan owner belum aktif (butuh HTTPS/WebCrypto), perintah ditolak." : "✔ Perintah " + k + " dikirim ke " + nm + " (bertanda tangan). Berhasil bila server meneruskan event admin.");
      }
      renderAdmin();
    }

    /* ---------- CHAT GLOBAL: semua pemain di pulau melihat pesan ----------
       Tombol "💬 Chat" (tepat di bawah tombol Menu) membuka/menutup panel chat: ketuk sekali = buka, ketuk lagi = tutup.
       Dikirim lewat net.emit("chat", {text, name, uid}); pesan masuk ditangani net.chat(idPengirim, data).
       Server multiplayer perlu meneruskan event "chat" ke semua pemain (seperti event "fire"/"spear"). */
    var chatLog = [], chatEl = null, chatBtn = null, chatPanel = null, chatIn = null, chatOpen = false, chatLast = 0, chatRx = {}, chatUnread = 0;
    var CHAT_LABEL = TOUCH ? "💬 Chat" : "💬 Chat [Enter]";
    function cleanMsg(t) { return String(t == null ? "" : t).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120); }
    function chatBadge() {
      if (!chatBtn) return;
      chatBtn.textContent = CHAT_LABEL + (chatUnread > 0 && !chatOpen ? " (" + Math.min(chatUnread, 99) + ")" : "");
      chatBtn.classList.toggle("on", chatOpen); chatBtn.classList.toggle("unread", chatUnread > 0 && !chatOpen);
    }
    function addChat(n, id, t, me, sys) {
      chatLog.push({ n: n, id: id, t: t, me: !!me, sys: !!sys }); if (chatLog.length > 100) chatLog.shift();
      if (!chatOpen && !me && !sys) { chatUnread++; chatBadge(); }
      renderChat();
    }
    function renderChat() {
      if (!chatEl || !chatOpen) return;
      var nb = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 40, i, m, d, b, it, ob;
      chatEl.textContent = "";
      for (i = Math.max(0, chatLog.length - 60); i < chatLog.length; i++) {
        m = chatLog[i]; d = document.createElement("div"); d.className = "ch-l" + (m.me ? " me" : "") + (m.sys ? " sys" : "");
        if (!m.sys && m.id === OWNER_ID) { d.className += " owner"; ob = document.createElement("span"); ob.className = "ch-ow"; ob.textContent = "👑 OWNER"; d.appendChild(ob); d.appendChild(document.createTextNode(" ")); } // lencana owner
        if (!m.sys) { b = document.createElement("b"); b.textContent = m.n || "Pemain"; d.appendChild(b); it = document.createElement("i"); it.textContent = " " + m.id; d.appendChild(it); d.appendChild(document.createTextNode(": ")); }
        d.appendChild(document.createTextNode(m.t)); chatEl.appendChild(d);
      }
      if (nb) chatEl.scrollTop = chatEl.scrollHeight;
    }
    function chatReset() { chatLog = []; chatUnread = 0; addChat("", "", "Chat global aktif. Pesanmu terlihat oleh semua pemain di pulau ini.", false, true); chatBadge(); }
    function sendChat(text) {
      var t = cleanMsg(text); if (!t || !loggedIn) return;
      var now = Date.now(); if (now - chatLast < 1200) { addChat("", "", "Pelan-pelan, tunggu sebentar sebelum mengirim lagi.", false, true); return; } chatLast = now;
      addChat(myName, myId, t, true); net.say(null, t);
      if (net.emit) {
        var pay = { text: t, name: myName, uid: myId };
        if (ownerOK && ownerPriv) { var ts = Date.now(); ownerSign("chat|" + ts + "|" + t).then(function (sg) { if (sg) { pay.ts = ts; pay.sg = sg; } net.emit("chat", pay); }); }
        else net.emit("chat", pay);
      } else addChat("", "", "Belum terhubung ke multiplayer: pesan hanya terlihat olehmu.", false, true);
    }
    net.chat = function (id, d) {
      if (!d || !loggedIn) return;
      var t = cleanMsg(d.text != null ? d.text : d.t); if (!t) return;
      var r = net.find(id), raw = r ? (r.uid || idOf(r)) : (d.uid ? String(d.uid).replace(/[^A-Za-z0-9\-]/g, "").slice(0, 12) : "RN-??????");
      if (!r && raw === myId) return; // gema pesan sendiri dari server
      var uid = raw === OWNER_ID ? "RN-??????" : raw; // klaim ID owner tidak dipercaya sebelum tanda tangannya terbukti
      var now = Date.now(), rk = r ? "i" + id : uid; if (now - (chatRx[rk] || 0) < 300) return; chatRx[rk] = now;
      var nm = String((r && r.name) || d.name || "Pemain").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 16) || "Pemain";
      function show(u) { addChat(nm, u, t, false); if (r) net.say(id, t); }
      if (raw === OWNER_ID) {
        var ts = +d.ts;
        if (isFinite(ts) && Math.abs(now - ts) < 120000) ownerVerify("chat|" + ts + "|" + t, d.sg).then(function (ok) { show(ok ? OWNER_ID : "RN-??????"); });
        else show("RN-??????");
        return;
      }
      show(uid);
    };
    function openChatInput(focus) {
      if (!chatPanel || !loggedIn || menuOpen) return;
      if (!chatOpen) { chatOpen = true; keys = {}; chatUnread = 0; chatPanel.style.display = "flex"; chatBadge(); chatEl.scrollTop = 1e9; }
      renderChat(); chatEl.scrollTop = chatEl.scrollHeight;
      if (focus) setTimeout(function () { try { chatIn.focus(); } catch (e) {} }, 30);
    }
    function closeChatInput() {
      if (!chatPanel || !chatOpen) return;
      chatOpen = false; chatPanel.style.display = "none"; try { chatIn.blur(); } catch (e) {} chatBadge();
    }
    function toggleChat() { if (chatOpen) closeChatInput(); else openChatInput(!TOUCH); } // layar sentuh: papan ketik baru muncul saat kolom diketuk
    /* ---------- PAPAN INFO (nyawa, tenaga, lapar, tas, buruan, misi): bisa disembunyikan ---------- */
    var hudOn = true, infoBtn = null;
    try { hudOn = localStorage.getItem("fm_hud") !== "0"; } catch (e) {}
    function toggleHud() {
      hudOn = !hudOn;
      try { localStorage.setItem("fm_hud", hudOn ? "1" : "0"); } catch (e) {}
      if (infoBtn) infoBtn.className = hudOn ? "" : "off";
      if (infoBtn) infoBtn.textContent = hudOn ? "👁 Info" : "🚫 Info";
      E.msg = hudOn ? "Papan info ditampilkan." : "Papan info disembunyikan."; E.mt = 2;
    }
    function syncChatUI() {
      if (!chatBtn) return;
      if (infoBtn) infoBtn.style.display = loggedIn ? "block" : "none";
      chatBtn.style.display = loggedIn ? "block" : "none";
      if (!loggedIn) closeChatInput();
      chatBadge();
    }
    (function mkChatUI() {
      var BW = TOUCH ? "104px" : "140px", PW = "min(64vw,300px)", R = "right:calc(12px + env(safe-area-inset-right,0px))", T = function (px) { return "top:calc(" + px + "px + env(safe-area-inset-top,0px))"; };
      var css = document.createElement("style");
      css.textContent =
        // tombol Menu dan Chat: lebar & gaya sama, tersusun rapi satu kolom di kanan
        "#fm-mb,#fm-chb,#fm-inf{width:" + BW + ";box-sizing:border-box;text-align:center;padding:9px 4px !important;white-space:nowrap}" +
        "#fm-chb{position:fixed;z-index:6;" + R + ";" + T(196) + ";display:none;border-radius:10px;border:2px solid #e0b64a;background:rgba(42,29,16,.92);color:#f3ead6;font:700 13px Georgia,serif;cursor:pointer;touch-action:manipulation;user-select:none;-webkit-user-select:none}" +
        "#fm-inf{position:fixed;z-index:6;" + R + ";" + T(240) + ";display:none;border-radius:10px;border:2px solid #e0b64a;background:rgba(42,29,16,.92);color:#f3ead6;font:700 13px Georgia,serif;cursor:pointer;touch-action:manipulation;user-select:none;-webkit-user-select:none}#fm-inf:active{filter:brightness(1.25)}#fm-inf.off{background:#e0b64a;color:#2a1d10}" +
        "#fm-chb:active{filter:brightness(1.25)}#fm-chb.on{background:#e0b64a;color:#2a1d10}#fm-chb.unread{border-color:#ff8a5c;box-shadow:0 0 0 2px rgba(255,138,92,.45)}" +
        // panel chat: terbuka tepat di bawah tombol Chat
        "#fm-chp{position:fixed;z-index:7;" + R + ";" + T(284) + ";width:" + PW + ";display:none;flex-direction:column;gap:6px;padding:8px;border-radius:12px;border:2px solid #e0b64a;background:rgba(24,16,9,.88);color:#f3ead6;font:12px Georgia,serif;box-sizing:border-box}" +
        "#fm-chl{max-height:min(34vh,230px);min-height:64px;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}" +
        ".ch-l{padding:3px 4px;line-height:1.35;word-break:break-word;border-bottom:1px solid rgba(255,255,255,.07)}.ch-l b{color:#ffe27a}.ch-l.me b{color:#9fe0ff}.ch-l i{opacity:.55;font-style:normal;font-size:10.5px}.ch-l.sys{color:#ffe9a8;opacity:.8;font-style:italic}" +
        ".ch-l.owner{border-left:3px solid #e0b64a;background:linear-gradient(90deg,rgba(224,182,74,.22),rgba(224,182,74,0))}.ch-l.owner b{color:#ffd54a}.ch-ow{display:inline-block;background:#e0b64a;color:#2a1d10;border-radius:5px;padding:0 5px;font:700 10px Georgia,serif;letter-spacing:.4px;vertical-align:1px}" +
        "#fm-chi{display:flex;gap:6px}#fm-chi input{flex:1;min-width:0;padding:9px 10px;border-radius:9px;border:2px solid #7a6330;background:rgba(42,29,16,.96);color:#f3ead6;font:16px Georgia,serif}#fm-chi input:focus{outline:none;border-color:#ffe27a}" +
        "#fm-chi button{padding:0 12px;border-radius:9px;border:0;background:#e0b64a;color:#2a1d10;font:700 13px Georgia,serif;cursor:pointer;touch-action:manipulation}";
      document.head.appendChild(css);
      chatBtn = document.createElement("div"); chatBtn.id = "fm-chb";
      chatBtn.addEventListener("pointerdown", function (e) { e.preventDefault(); e.stopPropagation(); toggleChat(); }); // ketuk = buka, ketuk lagi = tutup
      infoBtn = document.createElement("div"); infoBtn.id = "fm-inf"; infoBtn.className = hudOn ? "" : "off"; infoBtn.textContent = hudOn ? "👁 Info" : "🚫 Info";
      infoBtn.addEventListener("pointerdown", function (e) { e.preventDefault(); e.stopPropagation(); toggleHud(); });
      document.body.appendChild(infoBtn);
      chatPanel = document.createElement("div"); chatPanel.id = "fm-chp";
      chatPanel.innerHTML = '<div id="fm-chl"></div><div id="fm-chi"><input id="fm-chin" maxlength="120" placeholder="Tulis pesan…" autocomplete="off" enterkeyhint="send"><button id="fm-chs">Kirim</button></div>';
      chatPanel.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      document.body.appendChild(chatBtn); document.body.appendChild(chatPanel);
      chatEl = chatPanel.querySelector("#fm-chl"); chatIn = chatPanel.querySelector("#fm-chin");
      function go() { var v = chatIn.value; chatIn.value = ""; sendChat(v); if (!TOUCH) chatIn.focus(); } // panel tetap terbuka untuk lanjut mengobrol
      chatIn.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } else if (e.key === "Escape") { e.preventDefault(); closeChatInput(); } });
      chatPanel.querySelector("#fm-chs").addEventListener("click", go);
      chatBadge();
    })();

    /* ---------- PROFIL MANUSIA: lihat ID sendiri & ID manusia lain ---------- */
    var pmQ = "", pmEl = null, pmBody = null, pmStat = null, pmSel = null, pmPw = false, pmTimer = 0, pmList = [];
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    function fmtT(ms) { var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60); return (h ? h + " j " : "") + mm + " mnt " + (s % 60) + " dtk"; }
    function statusOf(p) { return p.hp <= 0 ? "Tumbang" : p.down > 0 ? "Terjatuh" : p.rid ? "Naik perahu" : p.sw ? "Berenang" : p.bleed ? "Terluka" : "Sehat"; }
    function copyText(t) {
      try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t); return true; } } catch (e) {}
      var ta = document.createElement("textarea"), ok = false; ta.value = t; ta.style.cssText = "position:fixed;opacity:0;left:0;top:0";
      document.body.appendChild(ta); ta.select(); try { ok = document.execCommand("copy"); } catch (e) {} document.body.removeChild(ta); return ok;
    }
    function pmSay(t) { if (pmStat) pmStat.textContent = t; }
    function renderProfile() {
      if (!pmBody) return;
      var a = document.activeElement;
      if (a && a.id === "pf-q") { var rs0 = pmBody.querySelector("#pf-res"); if (rs0) rs0.innerHTML = playerListHTML(); return; } // sedang mengetik pencarian: segarkan hasilnya saja
      if (a && a.id === "pf-name") return; // jangan timpa saat mengetik nama
      var h = "", i, r, d, row = function (k, v) { return '<div class="pf-k">' + k + '</div><div class="pf-v">' + v + '</div>'; };
      pmList = remote.filter(function (r) { return !r.p.inv; });
      var sel = null; if (pmSel != null) { for (i = 0; i < pmList.length; i++) if (pmList[i].id === pmSel) sel = pmList[i]; if (!sel) pmSel = null; }
      if (sel) {
        d = Math.round(Math.hypot(sel.p.x - P.x, sel.p.y - P.y));
        h += '<button class="pf-btn pf-back" data-act="back">← Kembali</button>' +
          '<div class="pf-card"><div class="pf-av">🧍</div><div class="pf-inf"><b>' + esc(sel.name || "Tanpa nama") + '</b><span class="pf-id">' + esc(idOf(sel)) + '</span></div></div>' +
          '<button class="pf-btn" data-act="copy" data-v="' + esc(idOf(sel)) + '">📋 Salin ID</button>' +
          '<div class="pf-grid">' + row("Status", statusOf(sel.p)) + row("Nyawa", Math.max(0, Math.round(sel.p.hp == null ? 100 : sel.p.hp))) + row("Jarak", d + " langkah") + row("Alat", esc(sel.p.tool || "-")) + '</div>';
      } else {
        h += '<div class="pf-card me"><div class="pf-av">🧑</div><div class="pf-inf"><b>' + esc(myName || "Tanpa nama") + ' <small>(kamu)</small></b><span class="pf-id">' + esc(myId) + '</span></div></div>' +
          '<button class="pf-btn" data-act="copy" data-v="' + esc(myId) + '">📋 Salin ID</button>' +
          '<div class="pf-edit"><input id="pf-name" maxlength="16" placeholder="Nama kamu" value="' + esc(myName) + '"><button class="pf-btn" data-act="savename">Simpan</button></div>' +
          (pmPw ? '<div class="pf-sec">Ganti kata sandi</div><div class="pf-pw"><input id="pf-old" type="password" maxlength="64" placeholder="Kata sandi lama" autocomplete="current-password"><input id="pf-new" type="password" maxlength="64" placeholder="Kata sandi baru (min. 6)" autocomplete="new-password"><input id="pf-new2" type="password" maxlength="64" placeholder="Ulangi kata sandi baru" autocomplete="new-password"><div class="pf-edit"><button class="pf-btn" data-act="savepw">Simpan</button><button class="pf-btn pf-back" data-act="cancelpw">Batal</button></div></div>'
            : '<button class="pf-btn pf-out" data-act="pwform">🔑 Ganti kata sandi</button>') +
          '<button class="pf-btn pf-out" data-act="logout">🚪 Keluar (ganti akun)</button>' +
          '<div class="pf-grid">' + row("Waktu main", fmtT(Date.now() - joinT)) + row("Skor", score) + row("Kayu", P.wood) + row("Daging", P.meat) + row("Nyawa", Math.max(0, Math.round(P.hp))) + row("Status", statusOf(P)) + '</div>' +
          '<div class="pf-sec">Cari pemain</div><div class="pf-edit"><input id="pf-q" maxlength="24" placeholder="🔍 Cari nama atau ID (mis. RN-ABC123)" value="' + esc(pmQ) + '" autocomplete="off" autocapitalize="characters" spellcheck="false"></div><div id="pf-res">' + playerListHTML() + '</div>';
      }
      pmBody.innerHTML = h;
    }
    function playerListHTML() { // daftar pemain + pencarian (nama atau ID, sebagian pun boleh)
      pmList = remote.filter(function (r) { return !r.p.inv; });
      var q = pmQ.trim().toLowerCase(), qn = q.replace(/[^a-z0-9]/g, ""), rows = "", n = 0, i, r, k, a, acc, online = {};
      function hit(name, id) { if (!q) return true; return String(name || "").toLowerCase().indexOf(q) >= 0 || !!(qn && String(id || "").toLowerCase().replace(/[^a-z0-9]/g, "").indexOf(qn) >= 0); }
      for (i = 0; i < pmList.length; i++) {
        r = pmList[i]; online[idOf(r)] = 1; if (!hit(r.name, idOf(r))) continue; n++;
        rows += '<div class="pf-row" data-sel="' + i + '"><div class="pf-av s">🧍</div><div class="pf-inf"><b>' + esc(r.name || "Tanpa nama") + '</b><span class="pf-id s">' + esc(idOf(r)) + '</span></div><span class="pf-go">›</span></div>';
      }
      if (q) { // pencarian juga mencakup akun yang tersimpan di perangkat ini (meski sedang tidak online)
        acc = accLoad();
        for (k in acc) { a = acc[k]; if (!a || a.id === myId || online[a.id] || !hit(a.name, a.id)) continue; n++;
          rows += '<div class="pf-row"><div class="pf-av s">💾</div><div class="pf-inf"><b>' + esc(a.name) + '</b><span class="pf-id s">' + esc(a.id) + '</span></div><button class="pf-btn" data-act="copy" data-v="' + esc(a.id) + '">Salin</button></div>'; }
      }
      return '<div class="pf-sec">' + (q ? 'Hasil pencarian' : 'Manusia di pulau') + ' (' + n + ')</div>' + (n ? rows :
        '<div class="pf-empty">' + (q ? 'Tidak ditemukan. Pencarian mencakup pemain yang sedang online di pulau ini dan akun yang tersimpan di perangkat ini.' : 'Belum ada manusia lain. Ajak temanmu bergabung!') + '</div>');
    }
    function openProfile() { openMenu("profile"); }
    function closeProfile() { closeMenu(); }
    function toggleProfile() { toggleMenu("profile"); }

    /* =====================================================================
       MENU UTAMA TERPADU  (☰ Menu)  — satu tombol, satu jendela, empat tab:
       👤 Profil · 🔨 Rakit · ⚙ Opsi · ❓ Bantuan
       Pintasan keyboard: P profil · R rakit · H bantuan · Esc buka/tutup menu
       ===================================================================== */
    var mnEl = null, menuTab = "profile", mnTabs = {}, mnPanes = {}, mnOpts = null;
    function renderOpts() {
      if (!mnOpts) return;
      mnOpts.innerHTML =
        '<div class="mn-sec">Suara</div><button class="mn-opt" data-opt="sound"><span>🔊 Suara permainan</span><b>' + (muted ? "MATI" : "HIDUP") + '</b></button>' +
        '<div class="mn-sec">Cuaca</div><button class="mn-opt" data-opt="winter"><span>❄ Musim dingin</span><b>' + (E.wOn ? "HIDUP" : "MATI") + '</b></button>' +
        '<div class="mn-note">Pengaturan ini berlaku selama kamu bermain.</div>';
    }
    function helpHTML() {
      var G = [
        ["🚶 Gerak", [["W A S D", "Jalan"], ["Shift", "Lari"], ["Spasi", "Lompat"]]],
        ["⚔️ Aksi", [["Klik / F", "Serang"], ["X", "Ganti alat"], ["1 2 3 4", "Tombak · Kapak · Pedang · Pancing"], ["E", "Minum / makan"], ["G", "Api unggun"], ["B", "Naik / turun perahu"]]],
        ["📋 Menu", [["R", "Rakit"], ["I", "Tas"], ["J", "Misi (quest)"], ["N", "Dunia / pulau baru"], ["P", "Profil"], ["Enter", "Chat global"], ["H", "Bantuan"], ["Esc", "Buka / tutup menu"]]],
        ["🎥 Kamera", [["Klik kanan + geser / Q C", "Putar kamera"], ["Roda mouse", "Zoom"], ["Geser / cubit (layar sentuh)", "Putar / zoom kamera"]]],
        ["🛡️ Zona Aman", [["Lingkaran bertiang hijau", "Satwa liar tidak bisa masuk; nyawa pulih pelan"], ["Misi", "Selesai = hadiah kayu + daging"]]],
        ["⚙️ Lainnya", [["M", "Suara"], ["T", "Musim dingin"]]]
      ], h = "", i, j;
      if (TOUCH) h += '<div class="mn-note">Di layar sentuh: pakai joystick di kiri dan tombol di layar. Geser satu jari untuk memutar kamera, cubit dua jari untuk zoom, ketuk singkat untuk menyerang. Tombol ☰ Menu membuka Profil, Rakit, Tas, Dunia, Opsi, dan Bantuan.</div>';
      for (i = 0; i < G.length; i++) {
        h += '<div class="mn-sec">' + G[i][0] + '</div>';
        for (j = 0; j < G[i][1].length; j++) h += '<div class="hp-row"><kbd>' + G[i][1][j][0] + '</kbd><span>' + G[i][1][j][1] + '</span></div>';
      }
      return h;
    }
    function switchTab(t) {
      if (t === "admin" && !isAdmin()) t = "profile";
      menuTab = t; qArm = -1;
      for (var k in mnTabs) { mnTabs[k].classList.toggle("on", k === t); mnPanes[k].classList.toggle("on", k === t); }
      clearInterval(pmTimer); pmPw = false;
      if (t === "profile") { pmSel = null; pmSay("ID-mu dibuat otomatis dan tersimpan di perangkat ini."); renderProfile(); pmTimer = setInterval(function () { if (!pmPw) renderProfile(); }, 1000); }
      else if (t === "craft") { setStat("Kayu didapat dengan menebang pohon pakai kapak (tombol 2)."); renderCraft(); }
      else if (t === "bag") { bagSay("Ketuk alat untuk memegangnya. Isi tas tersimpan otomatis di akunmu."); renderBag(); pmTimer = setInterval(renderBag, 1000); }
      else if (t === "quest") { qSay("Selesaikan misi untuk mendapat kayu dan daging. Hadiah langsung masuk tas."); renderQuest(); pmTimer = setInterval(renderQuest, 1000); }
      else if (t === "world") { wdArm = null; wdSay("Buat pulau baru atau kembali ke pulau yang pernah kamu buat."); renderWorld(); }
      else if (t === "admin") { adSay("Perintah ke pemain lain dikirim lewat multiplayer."); renderAdmin(); pmTimer = setInterval(function () { var a = document.activeElement; if (!(a && a.tagName === "INPUT")) renderAdmin(); }, 1500); }
      else if (t === "opts") renderOpts();
    }
    function openMenu(tab) { if (P.hp <= 0 || !mnEl || !loggedIn) return; closeChatInput(); menuOpen = true; keys = {}; mnEl.style.display = "flex"; if (mnTabs.admin) mnTabs.admin.style.display = isAdmin() ? "" : "none"; switchTab(tab || menuTab); }
    function closeMenu() { if (mnEl) mnEl.style.display = "none"; clearInterval(pmTimer); pmPw = false; menuOpen = false; }
    function toggleMenu(tab) { if (menuOpen && (!tab || menuTab === tab)) closeMenu(); else openMenu(tab); }
    (function mkMenuUI() {
      var css = document.createElement("style");
      css.textContent =
        "#fm-mb{position:fixed;z-index:6;right:calc(12px + env(safe-area-inset-right,0px));top:calc(152px + env(safe-area-inset-top,0px));padding:9px 13px;border-radius:10px;border:2px solid #e0b64a;background:rgba(42,29,16,.92);color:#f3ead6;font:700 13px Georgia,serif;cursor:pointer;touch-action:manipulation;user-select:none;-webkit-user-select:none}#fm-mb:active{filter:brightness(1.25)}" +
        "#fm-mn{position:fixed;left:0;top:0;right:0;bottom:0;z-index:20;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);padding:10px}" +
        "#fm-mp{width:min(94vw,460px);height:min(86vh,580px);display:flex;flex-direction:column;overflow:hidden;background:#2a1d10;border:2px solid #e0b64a;border-radius:12px;color:#f3ead6;font-family:Georgia,serif;box-shadow:0 8px 30px rgba(0,0,0,.6)}" +
        ".mn-h{display:flex;align-items:center;justify-content:space-between;padding:10px 14px 6px;font-size:18px;font-weight:700;color:#e0b64a}.mn-x{width:34px;height:34px;border-radius:50%;border:2px solid #e0b64a;background:none;color:#f3ead6;font-size:16px;cursor:pointer}" +
        ".mn-tabs{display:flex;gap:4px;padding:0 10px 8px;border-bottom:1px solid rgba(224,182,74,.35)}.mn-tab{flex:1;min-width:0;padding:8px 2px;border-radius:9px;border:1px solid transparent;background:rgba(255,255,255,.06);color:#f3ead6;font:700 10.5px Georgia,serif;cursor:pointer;touch-action:manipulation;text-align:center;line-height:1.25}.mn-tab span{display:block;font-size:18px}.mn-tab.on{background:#e0b64a;color:#2a1d10}" +
        ".mn-pane{display:none;flex:1;min-height:0;flex-direction:column}.mn-pane.on{display:flex}" +
        ".mn-scroll{flex:1;min-height:0;overflow:auto;padding:4px 14px 10px;-webkit-overflow-scrolling:touch}" +
        ".mn-sec{margin:14px 0 4px;padding-left:8px;border-left:3px solid #e0b64a;font-size:13px;font-weight:700;color:#e0b64a}.mn-note{opacity:.75;font-size:12px;line-height:1.4;padding:8px 2px}" +
        ".mn-opt{display:flex;width:100%;align-items:center;justify-content:space-between;gap:10px;padding:12px;margin-top:6px;border-radius:10px;border:0;background:rgba(255,255,255,.08);color:#f3ead6;font:14px Georgia,serif;cursor:pointer;touch-action:manipulation}.mn-opt b{color:#2a1d10;background:#e0b64a;border-radius:6px;padding:3px 9px;font-size:12px}" +
        ".hp-row{display:flex;gap:10px;align-items:center;padding:6px 8px;margin-top:4px;background:rgba(255,255,255,.05);border-radius:8px;font-size:13px}.hp-row kbd{flex:0 0 42%;max-width:42%;padding:3px 7px;border-radius:6px;background:rgba(0,0,0,.4);border:1px solid rgba(224,182,74,.5);font:700 11.5px ui-monospace,Menlo,Consolas,monospace;color:#ffe9a8}" +
        ".mn-st{min-height:34px;padding:8px 14px;border-top:1px solid rgba(224,182,74,.3);background:rgba(0,0,0,.25);font-size:12px;color:#ffe9a8}" +
        // rakit
        "#fm-cr{display:flex;gap:8px;margin:8px 14px 4px}#fm-cr span{flex:1;text-align:center;font-size:14px;padding:6px 8px;background:rgba(0,0,0,.35);border-radius:8px}" +
        ".cm-sec{margin:12px 0 2px;padding-left:8px;border-left:3px solid #e0b64a;font-size:13px;font-weight:700;color:#e0b64a}" +
        ".cm-row{display:flex;gap:10px;align-items:center;padding:9px;margin-top:6px;background:rgba(255,255,255,.06);border-radius:10px}.cm-row.own{opacity:.6}.cm-ico{font-size:30px;width:38px;text-align:center}.cm-inf{flex:1;min-width:0}.cm-inf small{display:block;opacity:.8;font-size:11.5px;line-height:1.3;margin-top:2px}" +
        ".cm-cost{margin-top:4px;font-size:12px}.cm-cost span{margin-right:8px}.cm-cost .no{color:#ff8a78}.cm-go{min-width:72px;padding:9px 8px;border-radius:8px;border:0;background:#e0b64a;color:#2a1d10;font:700 13px Georgia,serif;cursor:pointer}.cm-go:disabled{background:#5a4a38;color:#a89a84;cursor:default}" +
        // tas
        "#bg-res{display:flex;gap:8px;margin:8px 0 2px}#bg-res span{flex:1;text-align:center;font-size:13px;padding:6px 4px;background:rgba(0,0,0,.35);border-radius:8px}" +
        ".bg-row{display:flex;gap:10px;align-items:center;padding:9px;margin-top:6px;background:rgba(255,255,255,.06);border-radius:10px}.bg-row.lock{opacity:.5}.bg-row.on{border:1px solid #e0b64a;background:rgba(224,182,74,.14)}" +
        // profil
        ".pf-card{display:flex;gap:12px;align-items:center;padding:12px;margin:4px 0 8px;background:rgba(255,255,255,.07);border-radius:12px}.pf-card.me{border:1px solid rgba(224,182,74,.6)}" +
        ".pf-av{font-size:38px;width:52px;height:52px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.3);border-radius:50%}.pf-av.s{font-size:24px;width:40px;height:40px}" +
        ".pf-inf{flex:1;min-width:0}.pf-inf b{display:block;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pf-inf small{opacity:.7;font-weight:400;font-size:12px}" +
        ".pf-id{display:inline-block;margin-top:4px;padding:3px 9px;border-radius:6px;background:#e0b64a;color:#2a1d10;font:700 15px ui-monospace,Menlo,Consolas,monospace;letter-spacing:1px}.pf-id.s{font-size:12px;padding:2px 7px}" +
        ".pf-btn{padding:9px 12px;border-radius:8px;border:0;background:#e0b64a;color:#2a1d10;font:700 13px Georgia,serif;cursor:pointer;touch-action:manipulation}.pf-btn:active{filter:brightness(1.15)}.pf-back{background:rgba(255,255,255,.12);color:#f3ead6;margin-bottom:6px}" +
        ".pf-edit{display:flex;gap:8px;margin:10px 0}.pf-edit input{flex:1;min-width:0;padding:9px 10px;border-radius:8px;border:1px solid rgba(224,182,74,.6);background:rgba(0,0,0,.35);color:#f3ead6;font:14px Georgia,serif}" +
        ".pf-grid{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;padding:10px 12px;background:rgba(0,0,0,.25);border-radius:10px;font-size:13px;margin-top:6px}.pf-k{opacity:.7}.pf-v{text-align:right;font-weight:700}" +
        ".pf-sec{margin:14px 0 4px;padding-left:8px;border-left:3px solid #e0b64a;font-size:13px;font-weight:700;color:#e0b64a}.pf-empty{opacity:.7;font-size:12.5px;padding:8px 4px}" +
        ".pf-row{display:flex;gap:10px;align-items:center;padding:8px 10px;margin-top:6px;background:rgba(255,255,255,.06);border-radius:10px;cursor:pointer}.pf-row:active{background:rgba(255,255,255,.12)}.pf-go{font-size:22px;opacity:.6}.pf-out{width:100%;margin-top:6px;background:rgba(255,255,255,.12);color:#f3ead6}.pf-pw input{width:100%;box-sizing:border-box;margin-top:6px;padding:9px 10px;border-radius:8px;border:1px solid rgba(224,182,74,.6);background:rgba(0,0,0,.35);color:#f3ead6;font:14px Georgia,serif}";
      document.head.appendChild(css);

      css.textContent += ".qp{height:7px;border-radius:4px;background:rgba(0,0,0,.45);margin-top:6px;overflow:hidden}.qp i{display:block;height:100%;background:linear-gradient(90deg,#c98a2a,#ffe27a)}";
      var b = document.createElement("div"); b.id = "fm-mb"; b.textContent = TOUCH ? "☰ Menu" : "☰ Menu [Esc]";
      b.addEventListener("pointerdown", function (e) { e.preventDefault(); e.stopPropagation(); toggleMenu(); });
      document.body.appendChild(b);

      mnEl = document.createElement("div"); mnEl.id = "fm-mn";
      mnEl.innerHTML = '<div id="fm-mp"><div class="mn-h"><span>☰ Menu</span><button class="mn-x" id="fm-mx">✕</button></div>' +
        '<div class="mn-tabs"><button class="mn-tab" data-tab="profile"><span>👤</span>Profil</button><button class="mn-tab" data-tab="craft"><span>🔨</span>Rakit</button><button class="mn-tab" data-tab="bag"><span>🎒</span>Tas</button><button class="mn-tab" data-tab="quest"><span>📜</span>Misi</button><button class="mn-tab" data-tab="world"><span>🌍</span>Dunia</button><button class="mn-tab" data-tab="opts"><span>⚙️</span>Opsi</button><button class="mn-tab" data-tab="help"><span>❓</span>Bantuan</button><button class="mn-tab" data-tab="admin" style="display:none"><span>🛠️</span>Admin</button></div>' +
        '<div class="mn-pane" data-pane="profile"><div class="mn-scroll" id="fm-pl"></div><div class="mn-st" id="fm-ps"></div></div>' +
        '<div class="mn-pane" data-pane="craft"><div id="fm-cr"></div><div class="mn-scroll" id="fm-cl"></div><div class="mn-st" id="fm-cs"></div></div>' +
        '<div class="mn-pane" data-pane="bag"><div class="mn-scroll" id="fm-bl"></div><div class="mn-st" id="fm-bgs"></div></div>' +
        '<div class="mn-pane" data-pane="quest"><div class="mn-scroll" id="fm-ql"></div><div class="mn-st" id="fm-qs"></div></div>' +
        '<div class="mn-pane" data-pane="world"><div class="mn-scroll" id="fm-wl"></div><div class="mn-st" id="fm-ws"></div></div>' +
        '<div class="mn-pane" data-pane="admin"><div class="mn-scroll" id="fm-al"></div><div class="mn-st" id="fm-as"></div></div>' +
        '<div class="mn-pane" data-pane="opts"><div class="mn-scroll" id="fm-ol"></div></div>' +
        '<div class="mn-pane" data-pane="help"><div class="mn-scroll" id="fm-hl"></div></div></div>';
      document.body.appendChild(mnEl);
      cmEl = mnEl;
      var tb = mnEl.querySelectorAll(".mn-tab"), pn = mnEl.querySelectorAll(".mn-pane"), i;
      for (i = 0; i < tb.length; i++) mnTabs[tb[i].getAttribute("data-tab")] = tb[i];
      for (i = 0; i < pn.length; i++) mnPanes[pn[i].getAttribute("data-pane")] = pn[i];
      pmBody = mnEl.querySelector("#fm-pl"); pmStat = mnEl.querySelector("#fm-ps");
      cmBox = mnEl.querySelector("#fm-cl"); cmRes = mnEl.querySelector("#fm-cr"); cmStat = mnEl.querySelector("#fm-cs");
      bagBox = mnEl.querySelector("#fm-bl"); bagStat = mnEl.querySelector("#fm-bgs");
      qBox = mnEl.querySelector("#fm-ql"); qStat = mnEl.querySelector("#fm-qs");
      qBox.addEventListener("click", function (e) {
        var t = e.target; while (t && t !== qBox && !(t.getAttribute && t.getAttribute("data-qr") != null)) t = t.parentNode;
        if (t && t !== qBox) qReroll(parseInt(t.getAttribute("data-qr"), 10));
      });
      bagBox.addEventListener("click", function (e) {
        var t = e.target; while (t && t !== bagBox && !(t.getAttribute && (t.getAttribute("data-tool") || t.getAttribute("data-eat")))) t = t.parentNode;
        if (!t || t === bagBox || t.disabled) return;
        if (t.getAttribute("data-eat")) { bagSay(eatMeat()); renderBag(); } else equipFromBag(t.getAttribute("data-tool"));
      });
      wdBox = mnEl.querySelector("#fm-wl"); wdStat = mnEl.querySelector("#fm-ws");
      wdBox.addEventListener("click", function (e) {
        var t = e.target; while (t && t !== wdBox && !(t.getAttribute && t.getAttribute("data-w"))) t = t.parentNode;
        if (t && t !== wdBox && !t.disabled) wdAct(t.getAttribute("data-w"), t.getAttribute("data-id"));
      });
      adBox = mnEl.querySelector("#fm-al"); adStat = mnEl.querySelector("#fm-as");
      adBox.addEventListener("click", function (e) {
        var t = e.target; while (t && t !== adBox && !(t.getAttribute && t.getAttribute("data-ad"))) t = t.parentNode;
        if (t && t !== adBox) adAct(t.getAttribute("data-ad"), t.getAttribute("data-id"));
      });
      mnOpts = mnEl.querySelector("#fm-ol"); mnEl.querySelector("#fm-hl").innerHTML = helpHTML();

      mnEl.addEventListener("pointerdown", function (e) { if (e.target === mnEl) closeMenu(); });
      mnEl.querySelector("#fm-mx").addEventListener("click", closeMenu);
      mnEl.querySelector(".mn-tabs").addEventListener("click", function (e) {
        var t = e.target; while (t && t.getAttribute && !t.getAttribute("data-tab")) t = t.parentNode;
        if (t && t.getAttribute) switchTab(t.getAttribute("data-tab"));
      });
      // Rakit
      cmBox.addEventListener("click", function (e) {
        var t = e.target; while (t && t !== cmBox && !(t.classList && t.classList.contains("cm-go"))) t = t.parentNode;
        if (t && t !== cmBox && !t.disabled) craft(t.getAttribute("data-id"));
      });
      // Opsi
      mnOpts.addEventListener("click", function (e) {
        var t = e.target; while (t && t !== mnOpts && !(t.getAttribute && t.getAttribute("data-opt"))) t = t.parentNode;
        if (!t || t === mnOpts) return;
        var o = t.getAttribute("data-opt");
        if (o === "sound") { muted = !muted; E.msg = muted ? "Suara dimatikan." : "Suara dinyalakan."; E.mt = 2; }
        else if (o === "winter") { E.wOn = !E.wOn; E.sT = rnd(220, 320); E.msg = E.wOn ? "❄ Musim dingin tiba." : "Musim dingin berakhir."; E.mt = 3; }
        renderOpts();
      });
      // Profil
      pmBody.addEventListener("input", function (e) { if (e.target && e.target.id === "pf-q") { pmQ = e.target.value; var el = pmBody.querySelector("#pf-res"); if (el) el.innerHTML = playerListHTML(); } });
      pmBody.addEventListener("click", function (e) {
        var t = e.target, act = null, row = null;
        while (t && t !== pmBody) { if (t.getAttribute && t.getAttribute("data-act") && !act) act = t; if (t.getAttribute && t.getAttribute("data-sel") != null && !row) row = t; t = t.parentNode; }
        if (act) {
          var k = act.getAttribute("data-act");
          if (k === "copy") pmSay(copyText(act.getAttribute("data-v")) ? "✔ ID disalin: " + act.getAttribute("data-v") : "Gagal menyalin. Tekan lama pada ID untuk menyalin manual.");
          else if (k === "back") { pmSel = null; renderProfile(); }
          else if (k === "savename") { var inp = pmBody.querySelector("#pf-name"), er = renameMe(inp ? inp.value : ""); if (er) pmSay("⚠ " + er); else { pmSay("✔ Nama diganti menjadi " + myName + ". ID tetap " + myId + "."); if (inp) inp.blur(); renderProfile(); } }
          else if (k === "logout") logout();
          else if (k === "pwform") { pmPw = true; renderProfile(); pmSay("Masukkan kata sandi lama, lalu kata sandi baru."); setTimeout(function () { var o = pmBody.querySelector("#pf-old"); if (o) o.focus(); }, 30); }
          else if (k === "cancelpw") { pmPw = false; renderProfile(); pmSay(""); }
          else if (k === "savepw") {
            var g = function (id) { var el = pmBody.querySelector(id); return el ? el.value : ""; }, e2 = changePw(g("#pf-old"), g("#pf-new"), g("#pf-new2"));
            if (e2) pmSay("⚠ " + e2); else { pmPw = false; renderProfile(); pmSay("✔ Kata sandi berhasil diganti."); }
          }
        } else if (row) { var rr = pmList[parseInt(row.getAttribute("data-sel"), 10)]; if (rr) { pmSel = rr.id; renderProfile(); } }
      });
    })();
    function chopHit() {
      if (P.hp <= 0 || P.down > 0 || P.sw) return;
      var t = findTree(P.ca), i;
      if (!t) { if (E.mt <= 0) { E.msg = "Dekati pohon, lalu ayunkan kapak ke arahnya."; E.mt = 2; } return; }
      for (i = 0; i < stumps.length; i++) if (Math.hypot(stumps[i].x - t.x, stumps[i].y - t.y) < 14) { E.msg = "Pohon ini sudah ditebang."; E.mt = 2; return; }
      if (!P.ch || Math.hypot(P.ch.x - t.x, P.ch.y - t.y) > 26) P.ch = { x: t.x, y: t.y, n: 0, t: 0 };
      P.ch.n++; P.ch.t = 3; thunk();
      floats.push({ x: t.x, y: t.y, h: 34, t: .6, s: "tak!", c: "#ffe9c0" });
      if (P.ch.n >= HITS) fell(P.ch);
    }
    function fell(c) {
      // map.js boleh menyediakan ForestMap.fellTree(x, y, radius) -> true jika pohonnya benar-benar dihapus dari dunia
      var removed = typeof FM.fellTree === "function" && FM.fellTree(c.x, c.y, 26) === true;
      if (removed) logs.push({ x: c.x, y: c.y, a: P.ca, t: 0 }); else stumps.push({ x: c.x, y: c.y });
      P.ch = null; P.wood += 3; crashSnd();
      floats.push({ x: c.x, y: c.y, h: 50, t: 1.4, s: "+3 kayu", c: "#f0d9a0" });
      E.msg = "Pohon tumbang! +3 kayu"; E.mt = 3; questEv("chop");
    }
    function jump() { if (P.hp > 0 && !(P.ice > 0) && !P.sw && !P.rid && P.z === 0 && P.down <= 0) { P.vz = 230; } }
    function hurtP(dmg, ax, ay, down) {
      if (inHouse(P.x, P.y, 6)) { dmg *= .25; down = 0; } // rumah meredam bencana
      if (P.armor) dmg *= .5;
      P.hp -= dmg; P.bleed = 1; P.hurt = .5; var l = Math.hypot(ax, ay) || 1; P.kx = ax / l * 170; P.ky = ay / l * 170;
      if (down) { P.down = P.dm = down; } E.msg = "Kamu terluka!"; E.mt = 2;
    }
    function mkControls() {
      var css = document.createElement("style");
      css.textContent = ".fm-b{position:fixed;z-index:5;border-radius:50%;border:3px solid rgba(255,255,255,.85);color:#fff;font:700 12px system-ui,sans-serif;white-space:pre-line;display:flex;align-items:center;justify-content:center;text-align:center;touch-action:none;user-select:none;-webkit-user-select:none;opacity:.9}.fm-b:active{filter:brightness(1.3);transform:scale(.94)}#fm-js{position:fixed;z-index:5;left:calc(36px + env(safe-area-inset-left,0px));bottom:calc(28px + env(safe-area-inset-bottom,0px));width:150px;height:150px;border-radius:50%;border:3px solid rgba(255,255,255,.7);background:rgba(255,255,255,.12);touch-action:none}#fm-kn{position:absolute;left:50%;top:50%;width:62px;height:62px;margin:-31px 0 0 -31px;border-radius:50%;background:rgba(235,235,235,.85)}#fm-pad{position:fixed;z-index:5;right:calc(14px + env(safe-area-inset-right,0px));bottom:calc(18px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;align-items:flex-end;gap:10px;pointer-events:none}#fm-pad .fm-r{display:flex;align-items:flex-end;gap:8px}#fm-pad .fm-b{position:static;pointer-events:auto}#fm-pad .fm-u{font-size:10px;border-width:2px}@media (max-width:480px){#fm-pad{transform:scale(.9);transform-origin:bottom right}}";
      document.head.appendChild(css);
      var js = document.createElement("div"), kn = document.createElement("div"); js.id = "fm-js"; kn.id = "fm-kn"; js.appendChild(kn); document.body.appendChild(js);
      function mv2(e) {
        var r = js.getBoundingClientRect(), dx = e.clientX - (r.left + 75), dy = e.clientY - (r.top + 75), l = Math.hypot(dx, dy) || 1, m = Math.min(l, 55);
        stick.dx = dx / l * m / 55; stick.dy = dy / l * m / 55; kn.style.transform = "translate(" + stick.dx * 55 + "px," + stick.dy * 55 + "px)";
      }
      js.addEventListener("pointerdown", function (e) { js.setPointerCapture(e.pointerId); stick = { id: e.pointerId, dx: 0, dy: 0 }; mv2(e); });
      js.addEventListener("pointermove", function (e) { if (stick && stick.id === e.pointerId) mv2(e); });
      function end(e) { if (stick && stick.id === e.pointerId) { stick = null; kn.style.transform = ""; } }
      js.addEventListener("pointerup", end); js.addEventListener("pointercancel", end);
      var pad = document.createElement("div"), rowU = document.createElement("div"), rowM = document.createElement("div");
      pad.id = "fm-pad"; rowU.className = "fm-r"; rowM.className = "fm-r"; pad.appendChild(rowU); pad.appendChild(rowM); document.body.appendChild(pad);
      function btn(label, bg, size, row, down, up, small) {
        var b = document.createElement("div"); b.className = "fm-b" + (small ? " fm-u" : ""); b.textContent = label;
        b.style.cssText = "background:" + bg + ";width:" + size + "px;height:" + size + "px";
        b.addEventListener("pointerdown", function (e) { e.preventDefault(); b.setPointerCapture(e.pointerId); down(); });
        if (up) { b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); }
        row.appendChild(b); return b;
      }
      /* baris atas: aksi pendukung · baris bawah: gerak (LARI, LOMPAT) + aksi utama (alat aktif) */
      btn("GANTI\nALAT", "rgba(120,90,50,.94)", 46, rowU, toggleTool, null, true);
      btn("MINUM\nMAKAN", "rgba(50,120,200,.94)", 46, rowU, function () { keys.e = true; }, function () { keys.e = false; }, true);
      btn("API", "rgba(220,90,30,.94)", 46, rowU, buildFire, null, true);
      var bt = btn("PERAHU", "rgba(40,110,150,.94)", 46, rowU, toggleBoat, null, true); bt.style.display = "none";
      btn("LARI", "rgba(190,60,45,.92)", 54, rowM, function () { keys.shift = true; }, function () { keys.shift = false; });
      btn("LOMPAT", "rgba(30,180,90,.94)", 60, rowM, jump);
      var atk = btn("TOMBAK", "rgba(200,130,30,.94)", 78, rowM, function () { act(P.a); });
      toolUI = function () { atk.textContent = { spear: "TOMBAK", axe: "TEBANG", sword: "TEBAS", rod: "PANCING" }[P.tool]; bt.style.display = P.has.boat ? "flex" : "none"; bt.textContent = P.rid ? "TURUN" : "PERAHU"; };
    }
    if (TOUCH) mkControls();
    addEventListener("keydown", function (e) {
      if (/INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || "")) return;
      if (!loggedIn) return; // belum login: permainan dijeda
      var kl = e.key.toLowerCase();
      if (e.key === "Enter" && !menuOpen) { e.preventDefault(); if (chatOpen) { try { chatIn.focus(); } catch (er) {} } else openChatInput(true); return; }
      if (e.key === "Escape") { if (chatOpen) { closeChatInput(); return; } if (menuOpen) closeMenu(); else openMenu(); return; }
      if (kl === "p" && P.hp > 0) { toggleMenu("profile"); return; }
      if (kl === "r" && P.hp > 0) { toggleMenu("craft"); return; }
      if (kl === "i" && P.hp > 0) { toggleMenu("bag"); return; }
      if (kl === "n" && P.hp > 0) { toggleMenu("world"); return; }
      if (kl === "k" && P.hp > 0 && isAdmin()) { toggleMenu("admin"); return; }
      if (kl === "j" && P.hp > 0) { toggleMenu("quest"); return; }
      if (kl === "h" && P.hp > 0) { toggleMenu("help"); return; }
      if (kl === "v") { toggleHud(); return; }
      if (menuOpen) return;
      keys[e.key.toLowerCase()] = true;
      if (e.key === " ") { e.preventDefault(); jump(); }
      if (e.key.toLowerCase() === "f") act(P.a);
      if (e.key.toLowerCase() === "x") toggleTool(); if (e.key === "1") setTool("spear"); if (e.key === "2") setTool("axe"); if (e.key === "3") setTool("sword"); if (e.key === "4") setTool("rod"); if (kl === "b") toggleBoat();
      if (e.key.toLowerCase() === "g") buildFire();
      if (e.key.toLowerCase() === "m") { muted = !muted; E.msg = muted ? "Suara dimatikan." : "Suara dinyalakan."; E.mt = 2; }
      if (e.key.toLowerCase() === "t") { E.wOn = !E.wOn; E.sT = rnd(220, 320); E.msg = E.wOn ? "❄ Musim dingin tiba." : "Musim dingin berakhir."; E.mt = 3; }
      if (e.key.toLowerCase() === "r" && P.hp <= 0) reset();
    });
    addEventListener("keyup", function (e) { keys[e.key.toLowerCase()] = false; });

    var ray = new THREE.Raycaster(), ndc = new THREE.Vector3(), aimPl = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), aimHit = new THREE.Vector3();
    function aimAngle(cx, cy) {
      ndc.set(cx / vw * 2 - 1, -(cy / vh) * 2 + 1, .5); ray.setFromCamera(ndc, camera);
      aimPl.constant = -(groundY(P.x, P.y) + P.z + 16);
      var h = ray.ray.intersectPlane(aimPl, aimHit);
      return h ? Math.atan2(aimHit.z - P.y, aimHit.x - P.x) : P.a;
    }
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    var tps = {}, pinch = null; // sentuhan aktif di kanvas: geser 1 jari = putar kamera, cubit 2 jari = zoom, ketuk singkat = serang
    function tpIds() { return Object.keys(tps); }
    function tpDist() { var ids = tpIds(), a = tps[ids[0]], b = tps[ids[1]]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; }
    cv.style.touchAction = "none";
    cv.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "touch") {
        if (P.hp <= 0) { reset(); return; }
        tps[e.pointerId] = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false };
        try { cv.setPointerCapture(e.pointerId); } catch (er) {}
        if (tpIds().length >= 2) { pinch = { d: tpDist(), dist: cam.dist }; tpIds().forEach(function (k) { tps[k].moved = true; }); }
        return;
      }
      if (e.button === 2 || e.button === 1) { orbit = { id: e.pointerId, x: e.clientX, y: e.clientY }; try { cv.setPointerCapture(e.pointerId); } catch (er) {} return; }
      if (P.hp <= 0) { reset(); return; }
      act(aimAngle(e.clientX, e.clientY));
    });
    cv.addEventListener("pointermove", function (e) {
      var tp = tps[e.pointerId];
      if (tp) {
        var dx = e.clientX - tp.x, dy = e.clientY - tp.y; tp.x = e.clientX; tp.y = e.clientY;
        if (!tp.moved && Math.hypot(e.clientX - tp.sx, e.clientY - tp.sy) > 10) tp.moved = true;
        if (pinch && tpIds().length >= 2) cam.dist = Math.max(200, Math.min(900, pinch.dist * pinch.d / tpDist())); // jari merenggang = mendekat
        else if (tp.moved) { cam.yaw -= dx * .006; cam.pitch = Math.max(.35, Math.min(1.35, cam.pitch + dy * .004)); }
        return;
      }
      if (orbit && orbit.id === e.pointerId) {
        cam.yaw -= (e.clientX - orbit.x) * .006; cam.pitch = Math.max(.35, Math.min(1.35, cam.pitch + (e.clientY - orbit.y) * .004)); orbit.x = e.clientX; orbit.y = e.clientY;
      }
    });
    function orbitEnd(e) {
      var tp = tps[e.pointerId];
      if (tp) {
        delete tps[e.pointerId];
        if (e.type === "pointerup" && !tp.moved && !pinch && performance.now() - tp.t < 450 && P.hp > 0) act(aimAngle(e.clientX, e.clientY)); // ketukan singkat = serang
        if (tpIds().length < 2) pinch = null;
        return;
      }
      if (orbit && orbit.id === e.pointerId) orbit = null;
    }
    cv.addEventListener("pointerup", orbitEnd); cv.addEventListener("pointercancel", orbitEnd);
    cv.addEventListener("wheel", function (e) { e.preventDefault(); cam.dist = Math.max(200, Math.min(900, cam.dist * (e.deltaY > 0 ? 1.08 : .926))); }, { passive: false });

    var envHooks = { hurt: hurtP, cricket: cricket }; // panggilan balik untuk world.update (bencana melukai pemain, suara jangkrik)

    /* =====================================================================
       logika permainan (tidak berubah dari versi 2D)
       ===================================================================== */
    function update(dt) {
      var i, a, d, mx = 0, my = 0;
      if (P.hp <= 0) return;
      adminTick();
      var safeMe = inSafe(P.x, P.y, 0);
      if (keys.q) cam.yaw += 1.6 * dt; if (keys.c) cam.yaw -= 1.6 * dt;
      if (keys.a || keys.arrowleft) mx -= 1; if (keys.d || keys.arrowright) mx += 1;
      if (keys.w || keys.arrowup) my -= 1; if (keys.s || keys.arrowdown) my += 1;
      if (stick) { mx = stick.dx; my = stick.dy; }
      if (menuOpen || P.ice > 0) { mx = 0; my = 0; }
      { var cyw = Math.cos(cam.yaw), syw = Math.sin(cam.yaw), rmx = mx * cyw + my * syw, rmy = -mx * syw + my * cyw; mx = rmx; my = rmy; } // arah gerak relatif kamera
      var l = Math.hypot(mx, my), mv = l > .05, sprint = mv && (keys.shift || (stick && l > .95)) && P.st > 5;
      var flyFast = !!P.fly && !!(keys.shift || (stick && l > .95)); if (P.fly) sprint = false;
      world.update(dt, E, P, envHooks); // waktu, cuaca, bencana (map.js)
      // medan
      var shore = water(P.x + 28, P.y) || water(P.x - 28, P.y) || water(P.x, P.y + 28) || water(P.x, P.y - 28);
      var dense = FM.dense(P.x, P.y), spd = sprint ? 165 : 105;
      P.sw = water(P.x, P.y) && P.z <= 0 && !P.rid; if (P.sw || P.rid) sprint = false;
      if (shore) spd *= .82;
      if (dense) spd *= .8;
      spd *= 1 - .18 * E.rain;
      if (P.hu < 20 || P.th < 20 || P.tp < 20) spd *= .85;
      spd *= 1 - .12 * E.winter; // salju memperlambat
      if (P.tool === "axe" && P.cd > 0) spd *= .35; if (P.tool === "sword" && P.cd > 0) spd *= .6; // melambat saat mengayun kapak
      if (P.bleed) spd *= .75;
      if (P.st <= 5) spd *= .65;
      if (P.sw) spd = 62 * (1 - .3 * E.fl);
      if (P.rid) spd = 125 * (1 - .15 * E.rain) * (P.bleed ? .8 : 1);
      if (P.sw && !P.wasSw) { E.msg = "Kamu berenang. Tenaga terkuras, jangan sampai habis!"; E.mt = 3.5; }
      P.wasSw = P.sw;
      var dn = E.dis && E.dis.on ? E.dis.type : "";
      var inFl = flood(P.x, P.y), blk = pblk, hse = inHouse(P.x, P.y, 0);
      if (inFl) spd *= 1 - .45 * E.fl;
      if (P.fly) spd = flyFast ? 340 : 190;
      if (P.down > 0) { P.down -= dt; mv = false; sprint = false; }
      P.hurt = Math.max(0, P.hurt - dt);
      if (P.pois > 0) { P.pois -= dt; P.hp -= 1.2 * dt; }
      P.wet = Math.max(0, Math.min(1, P.wet + ((P.sw ? .8 : (E.rain > .3 && !hse) || (inFl && E.fl > .3) ? .14 : -.04) * dt)));
      if (dn === "gempa" && P.z <= 0 && P.down <= 0 && R() < dt * (mv ? .22 : .06)) { P.down = P.dm = 1.2; E.msg = "Kamu terjatuh karena guncangan!"; E.mt = 2; }
      if (E.sto > .2 && P.z <= 0) { var wx = P.x + 14 * E.sto * dt; if (!pblk(wx, P.y, 8)) P.x = wx; }
      if (inFl && E.fl > .3 && P.z <= 0) {
        var pw = (P.st <= 0 ? 110 : 55) * E.fl, px2 = P.x + pw * dt, py2 = P.y + pw * .35 * dt;
        if (!pblk(px2, P.y, 8)) P.x = px2;
        if (!pblk(P.x, py2, 8)) P.y = py2;
        if (P.st <= 0) P.hp -= 6 * E.fl * dt;
        E.msg = "Arus deras! Cari tanah tinggi!"; E.mt = .4;
      }
      if (mv) {
        if (l > 1) { mx /= l; my /= l; }
        P.a = Math.atan2(my, mx); P.face = mx >= 0 ? 1 : -1;
        var nx = P.x + mx * spd * dt + rnd(-1, 1) * E.qk * 30 * dt, ny = P.y + my * spd * dt + rnd(-1, 1) * E.qk * 30 * dt;
        if (P.fly || !blk(nx, P.y, 8)) P.x = nx;
        if (P.fly || !blk(P.x, ny, 8)) P.y = ny;
        if (P.fly) { P.x = Math.max(30, Math.min(W - 30, P.x)); P.y = Math.max(30, Math.min(W - 30, P.y)); }
        P.walk += dt * (spd / 105) * (P.bleed ? 7 : 9); P.still = 0;
        E.ft -= dt;
        if (E.ft <= 0) { E.ft = sprint ? .18 : .3; if (P.sw) E.rip.push({ x: P.x, y: P.y, t: 1.2 }); else if (!P.fly && !P.inv) { E.foot.push({ x: P.x, y: P.y + 7, t: 8, k: E.foot.length % 2 }); if (E.foot.length > 50) E.foot.shift(); } }
      } else { P.still += dt; P.walk *= .8; }
      if (P.rid && !water(P.x, P.y)) { P.rid = false; P.fs = null; E.msg = "Perahu ditarik ke darat."; E.mt = 2; if (toolUI) toolUI(); }
      if (P.fly) { // terbang: tanpa gravitasi, naik/turun dengan Spasi/V atau tombol ▲▼
        var fvy = ((keys[" "] || flyU) ? 1 : 0) - ((keys.v || flyD) ? 1 : 0);
        P.z = Math.max(4, Math.min(700, P.z + fvy * (flyFast ? 240 : 150) * dt)); P.vz = 0;
        if (!blocked(P.x, P.y, 8)) { P.lx = P.x; P.ly = P.y; }
      } else if (P.z > 0 || P.vz) {
        P.vz -= 640 * dt; P.z += P.vz * dt;
        if (P.z <= 0) { P.z = 0; P.vz = 0; if (hitTree(P.x, P.y, 8)) { P.x = P.lx; P.y = P.ly; E.msg = "Gagal mendarat! Kembali ke tepi."; E.mt = 2.5; } }
      } else if (!blocked(P.x, P.y, 8)) { P.lx = P.x; P.ly = P.y; }
      if (P.kx || P.ky) {
        var kx2 = P.x + P.kx * dt, ky2 = P.y + P.ky * dt;
        if (!pblk(kx2, P.y, 8)) P.x = kx2;
        if (!pblk(P.x, ky2, 8)) P.y = ky2;
        P.kx *= .88; P.ky *= .88; if (Math.abs(P.kx) + Math.abs(P.ky) < 5) P.kx = P.ky = 0;
      }
      if (P.jail > 0) { // dipenjara: terkurung di dalam sel
        var ps0 = prisonSpot(); P.jail -= dt; P.kx = P.ky = 0;
        P.x = Math.max(ps0.x - 17, Math.min(ps0.x + 17, P.x)); P.y = Math.max(ps0.y - 17, Math.min(ps0.y + 17, P.y));
        if (P.jail <= 0) releaseMe("Masa tahanan selesai. Kamu bebas.");
      }
      if (P.ice > 0) { P.ice -= dt; if (P.ice <= 0) thawMe("Esnya mencair."); }
      // kebutuhan tubuh
      // stamina HANYA berkurang saat lari (hemat: ~20 dtk lari terus-menerus); jalan, berenang, lompat tidak memakainya
      var stR = sprint ? -5 : mv ? 12 : 25; if (stR > 0 && P.hu < 20) stR *= .6; // lapar memperlambat pemulihan
      P.st = Math.max(0, Math.min(100, P.st + stR * dt));
      if (P.sw && P.st <= 0) { P.hp -= 8 * dt; E.msg = "Tenagamu habis, kamu tenggelam! Segera ke tepi!"; E.mt = .4; }
      P.hu = Math.max(0, P.hu - dt * (sprint ? .55 : .3));
      P.th = Math.max(0, P.th - dt * (sprint ? .8 : .45) * (E.rain > .5 ? .6 : 1));
      if (P.hu <= 0 || P.th <= 0) P.hp -= 1.5 * dt;
      if (P.bleed) {
        P.hp -= 1.4 * dt;
        if (P.still > 5) { P.bleed = 0; E.msg = "Luka dibalut dengan kain. Pendarahan berhenti."; E.mt = 4; }
      } else if (P.still > 3 && P.hp < 100 && P.hu > 25 && P.th > 25) P.hp = Math.min(100, P.hp + 2 * dt);
      if (safeMe) { // Zona Aman: luka cepat berhenti, racun mereda, nyawa pulih pelan
        if (P.bleed && P.still > 1.5) P.bleed = 0;
        if (P.pois > 0) P.pois = Math.max(0, P.pois - 5 * dt);
        if (!P.bleed && P.hp > 0 && P.hp < 100 && P.hu > 15 && P.th > 15) P.hp = Math.min(100, P.hp + 1.2 * dt);
      }
      if (P.inSafe === null) P.inSafe = safeMe;
      else if (P.inSafe !== safeMe) { P.inSafe = safeMe; E.msg = safeMe ? "🛡️ Zona Aman: satwa liar tidak bisa masuk." : "⚠ Kamu meninggalkan Zona Aman. Waspada satwa liar!"; E.mt = 3; if (safeMe) chime(); }
      fireCd -= dt;
      for (i = fires.length - 1; i >= 0; i--) { fires[i].t -= dt * (1 + 2 * E.rain * (1 - E.winter)); if (fires[i].t <= 0) fires.splice(i, 1); }
      var nf = nearFire(P.x, P.y, 150) || hse;
      if (nf) {
        if (!P.bleed && P.hp > 0 && P.hp < 100 && P.hu > 15 && P.th > 15) P.hp = Math.min(100, P.hp + 1.5 * dt);
        if (nf.t) { E.fireT = (E.fireT || 0) - dt; if (E.fireT <= 0) { crackle(); E.fireT = .12 + R() * .4; } }
      }
      // suhu tubuh: turun di musim dingin (lebih cepat saat malam, basah, atau berenang), naik dekat api unggun
      var cold = E.winter * (.5 + (E.dark > .5 ? .5 : 0) + P.wet * .8 + (P.sw ? 1.2 : 0));
      if (nf) P.tp = Math.min(100, P.tp + 9 * dt);
      else if (cold > .02) P.tp = Math.max(0, P.tp - cold * dt);
      else P.tp = Math.min(100, P.tp + 4 * dt);
      if (P.tp < 25 && !P.coldMsg) { P.coldMsg = 1; E.msg = "Kamu mulai kedinginan! Nyalakan api unggun (G)."; E.mt = 4; } else if (P.tp > 40) P.coldMsg = 0;
      if (P.tp <= 0) { P.hp -= 2 * dt; E.msg = "Kamu membeku! Cari api unggun!"; E.mt = .4; }
      if (keys.e && !mv) {
        if (shore && (P.th < 95 || P.meat <= 0)) { P.th = Math.min(100, P.th + 35 * dt); E.msg = "Minum dari sungai…"; E.mt = .3; }
        else if (P.meat > 0 && (P.hp < 100 || P.hu < 100)) {
          P.eat += dt; E.msg = nf ? (nf.t ? "Memanggang daging di api unggun…" : "Memanggang daging di dalam rumah…") : "Memanggang daging…"; E.mt = .3;
          if (P.eat >= (nf ? 1.2 : 2.5)) { P.eat = 0; eatMeat(); } // +20% nyawa & +20% kenyang
        } else if (P.meat > 0) { P.eat = 0; E.msg = "Nyawa dan perutmu sudah penuh."; E.mt = .3; }
      } else P.eat = 0;
      E.mt -= dt;
      for (i = E.drops.length - 1; i >= 0; i--) {
        var dr2 = E.drops[i]; dr2.t -= dt;
        if (dr2.t <= 0) { E.drops.splice(i, 1); continue; }
        if (P.z < 6 && !P.sw && Math.hypot(P.x - dr2.x, P.y - dr2.y) < 22) { P.meat += dr2.m; floats.push({ x: dr2.x, y: dr2.y, h: 16, t: 1, s: "+" + dr2.m + " daging", c: "#ffd0b0" }); E.drops.splice(i, 1); }
      }
      for (i = E.rip.length - 1; i >= 0; i--) { E.rip[i].t -= dt; if (E.rip[i].t <= 0) E.rip.splice(i, 1); }
      for (i = E.foot.length - 1; i >= 0; i--) { E.foot[i].t -= dt; if (E.foot[i].t <= 0) E.foot.splice(i, 1); }
      P.cd -= dt;
      if (P.pend > 0) { P.pend -= dt; if (P.pend <= 0) { if (P.tool === "sword") swordHit(); else chopHit(); } }
      if (P.fs) { // pancing: menunggu gigitan, lalu ada jeda singkat untuk menarik
        var fs0 = P.fs;
        if (mv || P.sw || P.down > 0 || P.tool !== "rod") { P.fs = null; }
        else if (fs0.bite > 0) { fs0.bite -= dt; if (fs0.bite <= 0) { P.fs = null; E.msg = "Ikan lepas…"; E.mt = 2; } }
        else { fs0.t -= dt; if (fs0.t <= 0) { fs0.bite = 1.1; E.msg = "🐟 Ikan menggigit! Tarik sekarang (klik / F)!"; E.mt = 1.2; if (AC && !muted) beep(520, AC.currentTime, .06, .05, "sine"); } }
      }
      if (P.ch) { P.ch.t -= dt; if (P.ch.t <= 0) P.ch = null; }

      var hp0 = P.hp; safeMe = inSafe(P.x, P.y, 0); questTick();
      for (i = 0; i < animals.length; i++) {
        a = animals[i];
        { var sx = a.x - SAFE.x, sy = a.y - SAFE.y, sdd = Math.hypot(sx, sy), sr = SAFE.r + a.d.r; // satwa tidak boleh berada di Zona Aman
          if (sdd < sr) { if (sdd < 1) { sx = 1; sy = 0; sdd = 1; } a.x = SAFE.x + sx / sdd * (sr + 2); a.y = SAFE.y + sy / sdd * (sr + 2); } }
        d = (P.inv || safeMe) ? 1e9 : Math.hypot(P.x - a.x, P.y - a.y); // pemain invisible / di Zona Aman tidak terlihat satwa
        if (a.frz > 0) { a.frz -= dt; continue; } // satwa beku: diam
        if (a.d.ambush) { a.cd = (a.cd || 0) - dt; if (d < 55 && P.z < 8 && a.cd <= 0) { a.cd = 1.6; P.hp -= 6; P.pois = 8; E.msg = "Digigit ular berbisa!"; E.mt = 3; } continue; }
        if (a.d.croc) {
          var fl2 = E.dis && E.dis.on && E.dis.type === "banjir" ? 1 : 0, hd = Math.hypot(a.hx - a.x, a.hy - a.y), tg = d < 90 + 80 * fl2 && P.z < 8 && hd < 170;
          var ca = tg ? Math.atan2(P.y - a.y, P.x - a.x) : Math.atan2(a.hy - a.y, a.hx - a.x);
          if (tg || hd > 6) { var cs = tg ? a.d.sp : 50, cx2 = a.x + Math.cos(ca) * cs * dt, cy2 = a.y + Math.sin(ca) * cs * dt; if (!inSafe(cx2, cy2, a.d.r)) { a.x = cx2; a.y = cy2; } a.face = Math.cos(ca) > 0 ? -1 : 1; }
          if (d < 28 && P.z < 8) { P.hp -= 20 * dt; P.bleed = 1; }
          continue;
        }
        var sp = 0, ang = a.t > 0 ? a.ang : 0;
        a.t -= dt;
        if (a.d.tiger && d < 240 + 110 * E.dark && !nf) { a.ang = Math.atan2(P.y - a.y, P.x - a.x); sp = a.d.sp; if (d < 22 && P.z < 8) { P.hp -= 14 * dt; P.bleed = 1; } }
        else if (nf && a.d.tiger && d < 260) { a.ang = Math.atan2(a.y - P.y, a.x - P.x); sp = a.d.sp * .8; }
        else if (a.angry && !nf) { a.ang = Math.atan2(P.y - a.y, P.x - a.x); sp = a.d.sp * 1.15; if (d < 13 + a.d.r && P.z < 8) { P.hp -= (a.d.dmg || 9) * dt; P.bleed = 1; } if (d > 380) a.angry = false; }
        else if (a.d.fr && d < a.d.fr) { a.ang = Math.atan2(a.y - P.y, a.x - P.x) + rnd(-.3, .3); sp = a.d.sp; }
        else {
          if (a.t <= 0) { a.t = rnd(1, 3); a.ang = rnd(0, 6.28); a.idle = R() < .4; }
          sp = a.idle ? 0 : a.d.sp * .35;
        }
        if (sp) {
          var ax = a.x + Math.cos(a.ang) * sp * dt, ay = a.y + Math.sin(a.ang) * sp * dt;
          if (!blocked(ax, ay, a.d.r * .7) && !inSafe(ax, ay, a.d.r)) { a.x = ax; a.y = ay; a.face = Math.cos(a.ang) > 0 ? -1 : 1; }
          else { a.ang += 2 + R() * 2; a.t = .5; }
        }
      }

      if (P.armor && P.hp < hp0) P.hp = hp0 - (hp0 - P.hp) * .5; // zirah meredam serangan satwa
      for (i = spears.length - 1; i >= 0; i--) {
        var s = spears[i], step = 440 * dt, hit = false;
        s.x += Math.cos(s.a) * step; s.y += Math.sin(s.a) * step; s.d += step;
        if (s.d > 260 || hitTree(s.x, s.y, 2)) { spears.splice(i, 1); continue; }
        for (var k = 0; k < animals.length && !hit; k++) {
          a = animals[k];
          if (Math.hypot(s.x - a.x, s.y - a.y) < a.d.r + 5) {
            hit = true; hitAnimal(k, 1);
            if (s.ice && animals[k] === a) { a.frz = 20; floats.push({ x: a.x, y: a.y, h: a.d.r * 2 + 14, t: 1, s: "❄ Beku", c: "#bfeaff" }); } // tombak es membekukan satwa 20 dtk
          }
        }
        if (!hit && s.ice) for (var rj = 0; rj < remote.length && !hit; rj++) { // tombak es mengenai pemain lain
          var rr = remote[rj]; if (rr.p.hp > 0 && !rr.p.inv && Math.hypot(s.x - rr.p.x, s.y - rr.p.y) < 11) { hit = true; iceHitPlayer(rr); }
        }
        if (hit) spears.splice(i, 1);
      }
      for (i = floats.length - 1; i >= 0; i--) { floats[i].t -= dt; floats[i].h += 28 * dt; if (floats[i].t <= 0) floats.splice(i, 1); }
    }

    /* =====================================================================
       render 3D karakter. Langit/cahaya/air/bencana/hujan/kamera digambar oleh map.js
       (world.begin sebelum, world.finish sesudah bagian ini)
       ===================================================================== */
    var frame = 0;
    function render3(dt, now) {
      frame++;
      var dark = E.dark, sto = E.sto, i, j, it, gy = groundY(P.x, P.y);
      world.begin(dt, now, E, P);
      var WL = world.WL, swimY = world.swimY;
      // ---- lampu obor ----
      var tl = Math.max(dark, sto * .55);
      torch.position.set(P.x, gy + P.z + 30, P.y); torch.intensity = tl > .02 && P.hp > 0 ? 1.7 * tl * (.92 + Math.sin(now / 90) * .04 + Math.sin(now / 37) * .03) : 0;
      // ---- pemain ----
      var bY = WL + Math.sin(now / 500) * .6, by0 = P.rid ? WL + 1.5 : gy + P.z;
      if (P.hp > 0) { me.root.visible = true; me.root.position.set(P.x, 0, P.y); me.root.rotation.y = -P.a; posePlayer(me, P, P.rid ? bY + 1.5 : P.sw ? swimY : gy + P.z, now); } else me.root.visible = false;
      adminRender(dt, gy);
      // ---- perahu, kail & pancing ----
      boatShow(myBoat, P.hp > 0 && P.rid, P.x, bY - .5, P.y, P.a);
      if (P.fs && P.hp > 0) {
        var rf = P.fs, rby = WL + .8 + Math.sin(now / 280) * .5 - (rf.bite > 0 ? 2.4 + Math.sin(now / 45) * 1.2 : 0);
        var rtx = P.x + Math.cos(P.a) * 30, rty = by0 + 41, rtz = P.y + Math.sin(P.a) * 30, rdx = rf.x - rtx, rdy = rby - rty, rdz = rf.y - rtz, rhz = Math.hypot(rdx, rdz) || .001;
        bob.visible = true; fline.visible = true; bob.position.set(rf.x, rby, rf.y);
        fline.position.set(rtx + rdx / 2, rty + rdy / 2, rtz + rdz / 2); fline.scale.set(1, 1, Math.hypot(rhz, rdy)); fline.rotation.set(-Math.atan2(rdy, rhz), Math.atan2(rdx, rdz), 0);
      } else { bob.visible = false; fline.visible = false; }
      // ---- rumah ----
      var inside = inHouse(P.x, P.y, 2);
      houses.forEach(function (h) { h.seen = frame; if (!h.o3) { h.o3 = mkHouse(); scene.add(h.o3); houseReg.push(h); } h.o3.position.set(h.x, groundY(h.x, h.y), h.y); h.o3.rotation.y = -h.a; h.o3.userData.roof.visible = inside !== h; });
      for (i = houseReg.length - 1; i >= 0; i--) if (houseReg[i].seen !== frame) { scene.remove(houseReg[i].o3); houseReg.splice(i, 1); }
      // ---- pemain lain ----
      remote.forEach(function (r) {
        if (!r.m3) { r.m3 = makePlayer(); scene.add(r.m3.root); }
        var rg = groundY(r.p.x, r.p.y), rsw = r.p.sw ? Math.max(rg, WL - 13) : r.p.rid ? WL + 1.5 : rg + (r.p.z || 0);
        r.m3.root.visible = r.p.hp > 0 && !r.p.inv; r.m3.root.position.set(r.p.x, 0, r.p.y); r.m3.root.rotation.y = -(r.p.a || 0); posePlayer(r.m3, r.p, rsw, now);
        if (!r.boat) { r.boat = makeBoat(); scene.add(r.boat); } boatShow(r.boat, r.p.rid && r.p.hp > 0 && !r.p.inv, r.p.x, WL - .5, r.p.y, r.p.a || 0);
        iceShow(r, rg);
      });
      // ---- satwa ----
      for (i = 0; i < animals.length; i++) {
        var a = animals[i], dd = Math.hypot(a.x - P.x, a.y - P.y);
        if (dd > 760) { if (a.m3) a.m3.g.visible = false; if (a.ice3) a.ice3.visible = false; continue; }
        if (!a.m3) { a.m3 = mkModel(a); }
        var m = a.m3, ag = groundY(a.x, a.y), mvd = Math.hypot(a.x - m.px, a.y - m.py);
        iceAnimal(a, ag);
        m.g.visible = true; m.sp += ((mvd / Math.max(dt, .001)) - m.sp) * Math.min(1, dt * 8);
        if (mvd > .04) { var tg = Math.atan2(a.y - m.py, a.x - m.px), df = ((tg - a.hd + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; a.hd += df * Math.min(1, dt * 10); }
        m.px = a.x; m.py = a.y;
        var spd = m.sp, amp = Math.min(1, spd / (m.vs || 60)) * (m.amp || .8); m.t += spd * dt * (m.freq || .28);
        for (j = 0; j < m.legs.length; j++) m.legs[j].rotation.z = Math.sin(m.t + m.ph[j]) * amp;
        if (m.sway) m.sway(now, amp); if (m.upd) m.upd(now, amp);
        if (m.head) m.head.rotation.z = Math.sin(now / 700 + a.x) * .06 - (a.angry ? .15 : 0);
        var yy = ag + Math.abs(Math.sin(m.t)) * amp * 1.2;
        if (a.d.croc) { var wlv = WL; yy = Math.max(ag, wlv - 4.2) + Math.sin(now / 500 + a.x) * .4; }
        m.g.position.set(a.x, yy, a.y); m.g.rotation.y = -a.hd;
        if (a.fl3 > 0) { a.fl3 -= dt; var pz = 1 + a.fl3 * .8; m.g.scale.set(pz, pz, pz); } else m.g.scale.set(1, 1, 1);
      }
      // ---- bekas kaki, riak ----
      poolFoot.begin(); E.foot.forEach(function (f) { var d = poolFoot.get(), fx = f.x + (f.k ? 4 : -4); d.position.set(fx, groundY(fx, f.y) + .5, f.y); d.scale.set(3, 1, 1.7); d.material.opacity = Math.min(.4, f.t / 8 * .4); }); poolFoot.end();
      poolRip.begin(); E.rip.forEach(function (r) { var d = poolRip.get(), kk = 1 - r.t / 1.2, sc = 6 + kk * 18; d.position.set(r.x, WL + .5, r.y); d.scale.set(sc, 1, sc); d.material.opacity = .6 * (1 - kk); }); if (P.sw && P.hp > 0) { it = poolRip.get(); var sc2 = 12 + Math.sin(now / 160) * 2; it.position.set(P.x, WL + .5, P.y); it.scale.set(sc2, 1, sc2); it.material.opacity = .7; } poolRip.end();
      // ---- daging di tanah ----
      poolMeat.begin(); E.drops.forEach(function (d) { if (d.t > 10 || ((now / 200) | 0) % 2) { var g = poolMeat.get(); g.position.set(d.x, groundY(d.x, d.y) + 2 + Math.sin(now / 300 + d.x) * 1.5, d.y); g.rotation.y = now / 600; } }); poolMeat.end();
      // ---- tombak ----
      poolSpear.begin(); poolIceSp.begin(); spears.concat(rspears).forEach(function (s) { var g = (s.ice ? poolIceSp : poolSpear).get(); g.position.set(s.x, groundY(s.x, s.y) + 17, s.y); g.rotation.y = -s.a; }); poolSpear.end(); poolIceSp.end();
      // ---- pohon roboh ----
      poolLog.begin();
      for (i = logs.length - 1; i >= 0; i--) {
        var lg = logs[i]; lg.t += dt; if (lg.t > 8) { logs.splice(i, 1); continue; }
        var lo = poolLog.get(), lf = Math.min(1, lg.t / 1.1), ls = lg.t > 6 ? (8 - lg.t) / 2 : 1;
        lo.position.set(lg.x, groundY(lg.x, lg.y), lg.y); lo.rotation.y = -lg.a; lo.userData.pv.rotation.z = -lf * lf * 1.35; lo.scale.set(ls, ls, ls);
      }
      poolLog.end();
      // ---- api unggun ----
      fires.forEach(function (f) { f.seen = frame; if (!f.o3) { f.o3 = mkFire(); scene.add(f.o3); fireReg.push(f); } });
      for (i = fireReg.length - 1; i >= 0; i--) if (fireReg[i].seen !== frame) { scene.remove(fireReg[i].o3); fireReg.splice(i, 1); }
      var sorted = fires.slice().sort(function (u, v) { return Math.hypot(u.x - P.x, u.y - P.y) - Math.hypot(v.x - P.x, v.y - P.y); });
      fires.forEach(function (f) {
        var kk = Math.min(1, f.t / 12), fl = 1 + Math.sin(now / 70 + f.x) * .12 + Math.sin(now / 130) * .1;
        f.o3.position.set(f.x, groundY(f.x, f.y), f.y);
        f.o3.userData.fl.forEach(function (c, n) { var hh = (22 - n * 5) * kk * fl * (1 + Math.sin(now / (60 + n * 25) + n) * .1), r = (7 - n * 1.6) * kk; c.scale.set(Math.max(.01, r), Math.max(.01, hh), Math.max(.01, r)); c.position.y = 4 + hh / 2; });
      });
      fireL.forEach(function (l, n) {
        var f = sorted[n];
        if (f) { l.position.set(f.x, groundY(f.x, f.y) + 18, f.y); l.intensity = (.8 + .7 * Math.max(dark, sto * .5)) * Math.min(1, f.t / 10) * (.9 + Math.sin(now / 90 + n) * .06 + Math.sin(now / 37) * .04); } else l.intensity = 0;
      });
      world.finish(dt, now, E, P);
    }

    /* =====================================================================
       HUD 2D (di atas dunia 3D)
       ===================================================================== */
    function hud() {
      var i, p, gy = groundY(P.x, P.y);
      ctx.clearRect(0, 0, vw, vh);
      // vinyet halus + kilat + warna cedera
      var vg = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * .45, vw / 2, vh / 2, Math.max(vw, vh) * .75);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(5,8,4," + (.35 + .25 * Math.max(E.dark, E.sto * .6)) + ")"); ctx.fillStyle = vg; ctx.fillRect(0, 0, vw, vh);
      if (E.flash > 0) { ctx.fillStyle = "rgba(255,255,255," + .75 * E.flash + ")"; ctx.fillRect(0, 0, vw, vh); }
      if (P.hurt > 0) { ctx.fillStyle = "rgba(255,40,20," + .25 * Math.min(1, P.hurt * 2) + ")"; ctx.fillRect(0, 0, vw, vh); }
      // label nama & balon chat
      remote.forEach(function (r) { if (r.p.hp > 0 && !r.p.inv) tag(scr(r.p.x, groundY(r.p.x, r.p.y) + (r.p.z || 0) + 44, r.p.y), labelOf(r.name, idOf(r)), r.say, "#9fe0ff"); });
      if (P.hp > 0) tag(scr(P.x, (P.sw ? gy : gy + P.z) + 44, P.y), labelOf(myName, myId) + (P.inv ? " 👻" : ""), myBub, "#ffe27a");
      // bar nyawa satwa & tanda bahaya
      animals.forEach(function (a) {
        var dd = Math.hypot(a.x - P.x, a.y - P.y); if (dd > 520) return;
        var danger = a.angry || (a.d.tiger && dd < 240);
        if (a.hp >= a.d.hp && !danger) return;
        var q = scr(a.x, groundY(a.x, a.y) + a.d.r * 2.4 + 14, a.y); if (!q) return;
        if (a.hp < a.d.hp) { ctx.fillStyle = "#400"; ctx.fillRect(q.x - 12, q.y, 24, 3); ctx.fillStyle = "#e4503c"; ctx.fillRect(q.x - 12, q.y, 24 * a.hp / a.d.hp, 3); }
        if (danger) { ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#ff5a3c"; ctx.fillText("!", q.x, q.y - 4); }
      });
      E.drops.forEach(function (d) { var q = scr(d.x, groundY(d.x, d.y) + 16, d.y); if (q) { ctx.font = "bold 11px Georgia"; ctx.textAlign = "center"; ctx.fillStyle = "#ffe9c0"; ctx.fillText("x" + d.m, q.x, q.y); } });
      ctx.font = "bold 15px Georgia"; ctx.textAlign = "center";
      floats.forEach(function (f) { var q = scr(f.x, groundY(f.x, f.y) + f.h, f.y); if (!q) return; ctx.globalAlpha = Math.min(1, f.t * 2); ctx.fillStyle = f.c; ctx.fillText(f.s, q.x, q.y); });
      ctx.globalAlpha = 1;
      if (P.ch && P.ch.t > 0) { // progres tebangan di atas pohon
        var cq = scr(P.ch.x, groundY(P.ch.x, P.ch.y) + 48, P.ch.y);
        if (cq) { ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(cq.x - 16, cq.y, 32, 5); ctx.fillStyle = "#e0b64a"; ctx.fillRect(cq.x - 16, cq.y, 32 * P.ch.n / HITS, 5); }
      }

      // HUD
      if (P.fs) { var fq = scr(P.fs.x, world.WL + 16, P.fs.y); if (fq) { ctx.font = "bold 14px Georgia"; ctx.textAlign = "center"; ctx.fillStyle = P.fs.bite > 0 ? "#ffe27a" : "rgba(243,234,214,.8)"; ctx.fillText(P.fs.bite > 0 ? "🐟 TARIK!" : "…", fq.x, fq.y); } }
      var hs = Math.min(1, vh / 420), hvw = vw / hs; ctx.save(); ctx.scale(hs, hs);
      if (hudOn) {
      ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(12, 12, 232, 96);
      [["Nyawa", P.hp, "#d8452f"], ["Tenaga", P.st, "#c9c13a"], ["Lapar", P.hu, "#d98a2b"], ["Haus", P.th, "#4a9ad8"], ["Suhu", P.tp, "#8fd3e8"]].forEach(function (b, n) {
        ctx.fillStyle = "#222"; ctx.fillRect(66, 18 + n * 14, 170, 8);
        ctx.fillStyle = b[2]; ctx.fillRect(66, 18 + n * 14, 170 * Math.max(0, b[1]) / 100, 8);
        ctx.fillStyle = "#f3ead6"; ctx.font = "11px Georgia"; ctx.textAlign = "left"; ctx.fillText(b[0], 18, 26 + n * 14);
      });
      var tl = E.dark > .6 ? "Malam" : E.tod > .5 ? "Senja" : E.tod < .08 ? "Fajar" : E.tod < .35 ? "Pagi" : "Siang"; if (E.winter > .5) tl += " ❄";
      ctx.fillStyle = "#f3ead6"; ctx.font = "bold 12px Georgia";
      if (E.dark > .3) { ctx.fillStyle = "rgba(235,235,210," + E.dark + ")"; ctx.beginPath(); ctx.arc(226, 94, 7, 0, 7); ctx.fill(); ctx.fillStyle = "rgb(24,22,20)"; ctx.beginPath(); ctx.arc(229, 92, 6, 0, 7); ctx.fill(); }
      ctx.fillStyle = "#f3ead6"; ctx.fillText(tl + (E.rain > .5 ? (E.winter > .5 ? " · Salju" : " · Hujan") : "") + (P.bleed ? " · Luka" : ""), 18, 100);
      // kelompok "Tas": bahan, skor, alat aktif, perlengkapan
      ctx.font = "11px Georgia"; ctx.textAlign = "left"; ctx.fillStyle = "rgba(243,234,214,.7)"; ctx.fillText("Tas", 14, 124);
      var ty = 128; ctx.font = "14px serif";
      [["\uD83E\uDEB5 " + P.wood, 12], ["🍖 " + P.meat, 88], ["⭐ " + score, 164]].forEach(function (c) { ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(c[1], ty, 72, 22); ctx.fillStyle = "#f3ead6"; ctx.fillText(c[0], c[1] + 4, ty + 16); });
      var TN = { spear: "🔱 Tombak", axe: "🪓 Kapak", sword: "⚔️ Pedang", rod: "🎣 Pancing" };
      ctx.fillStyle = P.tool !== "spear" ? "rgba(224,182,74,.55)" : "rgba(0,0,0,.5)"; ctx.fillRect(12, ty + 25, 104, 22); ctx.fillStyle = "#f3ead6"; ctx.fillText(TN[P.tool], 16, ty + 41);
      var cx2 = 120; [[P.armor, "🛡️", 34, 0], [P.has.boat, "⛵", 34, P.rid], [houses.length, "🏠" + houses.length, 40, 0]].forEach(function (c) { if (!c[0]) return; ctx.fillStyle = c[3] ? "rgba(224,182,74,.55)" : "rgba(0,0,0,.5)"; ctx.fillRect(cx2, ty + 25, c[2], 22); ctx.fillStyle = "#f3ead6"; ctx.fillText(c[1], cx2 + 4, ty + 41); cx2 += c[2] + 4; });
      // kelompok "Buruan": hitungan satwa, 4 kolom
      ctx.font = "11px Georgia"; ctx.fillStyle = "rgba(243,234,214,.7)"; ctx.fillText("Buruan", 14, 191);
      var ci = 0; ctx.font = "14px serif";
      for (var k in D) {
        var kx = 12 + (ci % 4) * 58, ky = 196 + ((ci / 4) | 0) * 25; ci++;
        ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(kx, ky, 54, 22);
        ctx.fillStyle = "#f3ead6"; ctx.fillText(D[k].e + " " + (kills[k] || 0), kx + 4, ky + 16);
      }
      // pelacak misi aktif
      if (QT && P.q && P.q.length) {
        var qy = 196 + Math.ceil(ci / 4) * 25 + 14; ctx.font = "11px Georgia"; ctx.textAlign = "left"; ctx.fillStyle = "rgba(243,234,214,.7)"; ctx.fillText("Misi (J)", 14, qy - 4);
        P.q.forEach(function (q, qi) {
          var T = QT[q.t]; if (!T) return; var yy = qy + qi * 21, tx = T.ico + " " + qText(q);
          ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(12, yy, 232, 19);
          ctx.fillStyle = "rgba(224,182,74,.6)"; ctx.fillRect(12, yy + 16, 232 * Math.min(1, q.p / q.n), 3);
          ctx.fillStyle = "#f3ead6"; ctx.font = "11px Georgia"; ctx.textAlign = "left";
          if (tx.length > 30) tx = tx.slice(0, 29) + "…";
          ctx.fillText(tx, 16, yy + 13); ctx.textAlign = "right"; ctx.fillText(q.p + "/" + q.n, 240, yy + 13); ctx.textAlign = "left";
        });
      }
      }
      var mx = hvw - 142; ctx.drawImage(mini, mx, 12, 130, 130);
      ctx.strokeStyle = "#e0b64a"; ctx.lineWidth = 2; ctx.strokeRect(mx, 12, 130, 130);
      var sc = 130 / W;
      ctx.strokeStyle = "rgba(120,255,160,.95)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(mx + SAFE.x * sc, 12 + SAFE.y * sc, Math.max(2.5, SAFE.r * sc), 0, 7); ctx.stroke(); // Zona Aman
      animals.forEach(function (an) { if (Math.hypot(P.x - an.x, P.y - an.y) < 420) { ctx.fillStyle = an.d.tiger ? "#ff5a3c" : "#ffe27a"; ctx.fillRect(mx + an.x * sc - 1.5, 12 + an.y * sc - 1.5, 3, 3); } });
      remote.forEach(function (r) { if (r.p.inv) return; ctx.fillStyle = "#6fd0ff"; ctx.fillRect(mx + r.p.x * sc - 2, 12 + r.p.y * sc - 2, 4, 4); });
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(mx + P.x * sc, 12 + P.y * sc, 3.5, 0, 7); ctx.fill();
      ctx.restore();
      if (E.dis) {
        var nm = { gempa: "GEMPA BUMI", badai: "BADAI PETIR", banjir: "BANJIR BANDANG" }[E.dis.type], tipd = { gempa: "Lompat untuk menghindari batu jatuh", badai: "Jauhi pohon tinggi, cari tempat terbuka", banjir: "Menjauh dari sungai, cari tanah tinggi" }[E.dis.type];
        ctx.fillStyle = E.dis.on ? "rgba(150,20,20,.82)" : "rgba(180,130,10,.82)"; ctx.fillRect(vw / 2 - 150, 10, 300, 42);
        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "bold 14px Georgia";
        ctx.fillText("⚠ " + nm + (E.dis.on ? " · " + Math.ceil(E.dis.t) + " dtk" : " · bersiap!"), vw / 2, 28);
        ctx.font = "12px Georgia"; ctx.fillText(tipd, vw / 2, 44);
      }
      if (P.hp > 0 && inSafe(P.x, P.y, 0)) { var cy0 = E.dis ? 84 : 40; ctx.fillStyle = "rgba(30,110,60,.85)"; ctx.fillRect(vw / 2 - 72, cy0 - 14, 144, 22); ctx.fillStyle = "#e8ffe8"; ctx.font = "bold 12px Georgia"; ctx.textAlign = "center"; ctx.fillText("🛡️ ZONA AMAN", vw / 2, cy0 + 2); }
      var tags = []; if (P.inv) tags.push("👻 Invisible"); if (P.icesp) tags.push("❄ Tombak Es"); if (P.jail > 0) tags.push("🔒 Penjara " + Math.ceil(P.jail) + " dtk"); if (P.ice > 0) tags.push("🧊 Beku " + Math.ceil(P.ice) + " dtk"); if (P.fly) tags.push("✈ Terbang"); if (P.bleed) tags.push("Luka berdarah"); if (P.pois > 0) tags.push("Keracunan"); if (P.sw) tags.push("Berenang"); if (P.wet > .6) tags.push("Basah kuyup");
      if (tags.length) { ctx.fillStyle = "#ffb8a8"; ctx.font = "12px Georgia"; ctx.textAlign = "center"; ctx.fillText(tags.join(" · "), vw / 2, E.dis ? 66 : 24); }
      if (E.mt > 0 && E.msg) { ctx.fillStyle = "#ffe9a8"; ctx.font = "bold 15px Georgia"; ctx.textAlign = "center"; ctx.fillText(E.msg, vw / 2, vh - 40); }
      ctx.fillStyle = "rgba(243,234,214,.7)"; ctx.font = "12px Georgia"; ctx.textAlign = "center";
      if (!TOUCH) ctx.fillText("WASD jalan · Shift lari · Spasi lompat · klik/F serang   |   R Rakit · P Profil · H Bantuan · V Papan Info · Esc Menu", vw / 2, vh - 12);
      if (P.hp <= 0) {
        ctx.fillStyle = "rgba(0,0,0,.7)"; ctx.fillRect(0, 0, vw, vh);
        ctx.fillStyle = "#e0b64a"; ctx.font = "bold 30px Georgia"; ctx.fillText("Sang penjelajah gugur", vw / 2, vh / 2 - 8);
        ctx.fillStyle = "#f3ead6"; ctx.font = "16px Georgia"; ctx.fillText("Skor akhir " + score + "  ·  ketuk atau tekan R untuk mengulang", vw / 2, vh / 2 + 24);
      }
    }


    /* =====================================================================
       LOGIN DENGAN NAMA + KATA SANDI
       - Nama 2–16 karakter, kata sandi 6–64 karakter. Nama baru otomatis dibuatkan akun + ID unik (RN-XXXXXX).
       - Kata sandi disimpan sebagai hash SHA-256 bergaram (8000 putaran), tidak pernah sebagai teks asli. 5x salah = terkunci 30 detik.
       - Akun lama tanpa kata sandi diminta membuat kata sandi saat login berikutnya.
       - Sesi disimpan (token acak): membuka game lagi langsung masuk tanpa kata sandi, sampai menekan "Keluar" di menu Profil.
       - Permainan dijeda sampai login. "Ganti kata sandi" dan "Keluar" ada di menu Profil.
       - Catatan: akun tersimpan di localStorage perangkat ini (bukan server), jadi bukan keamanan tingkat server.
       Hook untuk multiplayer: ForestMap.net.onLogin = function (info) {...}  /  net.onLogout = function () {...}
       ===================================================================== */
    /* ---------- kata sandi: tidak pernah disimpan polos; disimpan sebagai hash SHA-256 bergaram (8000 putaran) ---------- */
    var SHA_K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    function sha256(str) {
      var s = unescape(encodeURIComponent(str)), l = s.length, n = (((l + 8) >> 6) + 1) * 16, w = new Array(n), i, j, t;
      for (i = 0; i < n; i++) w[i] = 0;
      for (i = 0; i < l; i++) w[i >> 2] |= s.charCodeAt(i) << (24 - (i % 4) * 8);
      w[l >> 2] |= 0x80 << (24 - (l % 4) * 8); w[n - 1] = l * 8;
      var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], X = new Array(64);
      function rr(x, c) { return (x >>> c) | (x << (32 - c)); }
      for (i = 0; i < n; i += 16) {
        for (j = 0; j < 16; j++) X[j] = w[i + j];
        for (j = 16; j < 64; j++) { var s0 = rr(X[j - 15], 7) ^ rr(X[j - 15], 18) ^ (X[j - 15] >>> 3), s1 = rr(X[j - 2], 17) ^ rr(X[j - 2], 19) ^ (X[j - 2] >>> 10); X[j] = (X[j - 16] + s0 + X[j - 7] + s1) | 0; }
        var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
        for (j = 0; j < 64; j++) {
          var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + SHA_K[j] + X[j]) | 0;
          var S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) | 0;
          h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
      }
      var out = ""; for (i = 0; i < 8; i++) { t = (H[i] >>> 0).toString(16); out += "00000000".slice(t.length) + t; }
      return out;
    }
    function genSalt() { var b = null, s = "", i, t; try { b = crypto.getRandomValues(new Uint8Array(16)); } catch (e) {} for (i = 0; i < 16; i++) { t = (b ? b[i] : (Math.random() * 256) | 0).toString(16); s += (t.length < 2 ? "0" : "") + t; } return s; }
    function derive(pw, salt) { var h = sha256(salt + "|" + pw), i; for (i = 0; i < 8000; i++) h = sha256(h + salt + pw); return h; }
    function checkPw(pw, name) {
      if (pw.length < 6) return "Kata sandi minimal 6 karakter.";
      if (pw.length > 64) return "Kata sandi maksimal 64 karakter.";
      if (name && pw.toLowerCase() === name.toLowerCase()) return "Kata sandi tidak boleh sama dengan nama.";
      return "";
    }
    var ACC_KEY = "fm_accounts", SES_KEY = "fm_session", TOK_KEY = "fm_token", accMem = null, lgEl = null, lgIn = null, lgPw = null, lgPw2 = null, lgErr = null, lgList = null, NAME_RX;
    try { NAME_RX = new RegExp("^[\\p{L}\\p{N} _.\\-]{2,16}$", "u"); } catch (e) { NAME_RX = /^[A-Za-z0-9 _.\-]{2,16}$/; }
    function accLoad() {
      if (accMem) return accMem;
      var o = {}; try { o = JSON.parse(localStorage.getItem(ACC_KEY) || "{}") || {}; } catch (e) { o = {}; }
      return (accMem = o);
    }
    function accSave() { try { localStorage.setItem(ACC_KEY, JSON.stringify(accMem)); } catch (e) {} }
    function cleanName(n) { return String(n == null ? "" : n).replace(/\s+/g, " ").trim(); }
    function checkName(n) {
      if (n.length < 2) return "Nama minimal 2 karakter.";
      if (n.length > 16) return "Nama maksimal 16 karakter.";
      if (!NAME_RX.test(n)) return "Nama hanya boleh huruf, angka, spasi, titik, garis bawah, dan strip.";
      return "";
    }
    function usedId(id) { var a = accLoad(), k; for (k in a) if (a[k].id === id) return true; return false; }
    function loginAs(raw, pw, pw2) {
      var name = cleanName(raw), err = checkName(name);
      if (err) return err;
      pw = String(pw == null ? "" : pw);
      var acc = accLoad(), k = name.toLowerCase(), a = acc[k], isNew = !a, id, now = Date.now(), own = false, okc = null;
      function isKey() { if (okc === null) okc = derive(pw, OWNER_SALT) === OWNER_HASH; return okc; } // cocokkan dengan Kunci Owner
      if (a && a.id === OWNER_ID) { // ID OWNER dilindungi: hanya terbuka dengan Kunci Owner (sebagai kata sandi)
        if ((a.lockUntil || 0) > now) return "Terlalu banyak percobaan. Coba lagi dalam " + Math.ceil((a.lockUntil - now) / 1000) + " detik.";
        if (!isKey()) {
          a.fails = (a.fails || 0) + 1;
          if (a.fails >= 5) { a.lockUntil = now + 30000; a.fails = 0; accSave(); return "Terlalu banyak percobaan salah. Coba lagi dalam 30 detik."; }
          accSave(); return "ID ini milik OWNER. Masukkan Kunci Owner sebagai kata sandi. (" + a.fails + "/5)";
        }
        a.fails = 0; a.lockUntil = 0; own = true;
        if (!a.hash) { a.salt = genSalt(); a.hash = derive(pw, a.salt); }
      } else if (!a || !a.hash) { // akun baru, atau akun lama yang belum punya kata sandi -> buat kata sandi
        err = checkPw(pw, name); if (err) return err;
        if (pw !== String(pw2 == null ? "" : pw2)) return "Konfirmasi kata sandi tidak sama.";
        if (!a) {
          id = (Object.keys(acc).length === 0 && myId !== OWNER_ID) ? myId : genId(); // akun pertama mewarisi ID perangkat ini
          while (usedId(id) || id === OWNER_ID) id = genId();
          a = acc[k] = { name: name, id: id, created: now, logins: 0 };
        }
        a.salt = genSalt(); a.hash = derive(pw, a.salt);
        if (isKey()) { // Kunci Owner cocok -> akun ini resmi menjadi OWNER; pemegang ID owner lain (jika ada) diganti ID baru
          for (var q in acc) if (acc[q] !== a && acc[q].id === OWNER_ID) { var nid = genId(); while (usedId(nid)) nid = genId(); acc[q].id = nid; }
          a.id = OWNER_ID; own = true;
        }
      } else {
        if ((a.lockUntil || 0) > now) return "Terlalu banyak percobaan. Coba lagi dalam " + Math.ceil((a.lockUntil - now) / 1000) + " detik.";
        if (derive(pw, a.salt) !== a.hash) {
          a.fails = (a.fails || 0) + 1;
          if (a.fails >= 5) { a.lockUntil = now + 30000; a.fails = 0; accSave(); return "Terlalu banyak percobaan salah. Coba lagi dalam 30 detik."; }
          accSave(); return "Kata sandi salah. (" + a.fails + "/5)";
        }
        a.fails = 0; a.lockUntil = 0;
      }
      a.name = name;
      a.token = genSalt() + genSalt(); // token sesi: dipakai untuk masuk otomatis sampai Keluar ditekan
      enter(a, k, isNew ? "new" : "login", own);
      if (own) unlockOwner(pw).then(function (ok) { if (E) { E.msg = ok ? "👑 Owner terverifikasi. Tanda tangan digital aktif." : "👑 Owner aktif lokal, tetapi tanda tangan digital tidak tersedia (butuh HTTPS)."; E.mt = 5; } });
      return "";
    }
    // masuk ke permainan setelah akun terverifikasi (kata sandi benar) atau sesi tersimpan valid
    function enter(a, k, how, own) {
      if (a.id === OWNER_ID && !own) return; // ID owner tidak boleh dimasuki tanpa Kunci Owner
      ownerOK = !!own && a.id === OWNER_ID; ownerPriv = null; ownerCert = null;
      a.last = Date.now(); a.logins = (a.logins || 0) + 1; accSave(); invKey = a.id;
      try { localStorage.setItem(SES_KEY, k); localStorage.setItem(TOK_KEY, a.token || ""); localStorage.setItem("fm_player_id", a.id); } catch (e) {}
      myName = a.name; myId = a.id; net.myId = myId; joinT = Date.now(); loggedIn = true; syncChatUI(); chatReset();
      if (lgPw) { lgPw.value = ""; lgPw2.value = ""; }
      reset(true); // muat isi tas akun ini
      E.msg = (how === "new" ? "Akun baru dibuat. Selamat datang, " : how === "auto" ? "Masuk otomatis sebagai " : "Selamat datang kembali, ") + a.name + "! ID: " + myId; E.mt = 5;
      if (lgEl) lgEl.style.display = "none";
      if (typeof net.onLogin === "function") { try { net.onLogin({ name: a.name, id: myId, isNew: how === "new", auto: how === "auto" }); } catch (e) {} }
    }
    // sesi tersimpan: tidak perlu kata sandi lagi sampai Keluar
    function resumeSession() {
      var k = null, t = null; try { k = localStorage.getItem(SES_KEY); t = localStorage.getItem(TOK_KEY); } catch (e) {}
      var a = k && accLoad()[k];
      if (!a || !a.hash || !a.token || !t || a.token !== t || a.id === OWNER_ID) return false; // akun owner tidak pernah masuk-otomatis
      enter(a, k, "auto"); return true;
    }
    function changePw(o, n, n2) {
      var a = accLoad()[myName.toLowerCase()]; if (!a) return "Akun tidak ditemukan.";
      if (a.id === OWNER_ID) return "Akun OWNER memakai Kunci Owner; kata sandinya tidak bisa diganti dari sini.";
      o = String(o == null ? "" : o); n = String(n == null ? "" : n);
      if (a.hash && derive(o, a.salt) !== a.hash) return "Kata sandi lama salah.";
      var er = checkPw(n, myName); if (er) return er;
      if (n !== String(n2 == null ? "" : n2)) return "Konfirmasi kata sandi baru tidak sama.";
      a.salt = genSalt(); a.hash = derive(n, a.salt); a.fails = 0; a.lockUntil = 0; accSave(); return "";
    }
    function renameMe(raw) {
      var nm = cleanName(raw), err = checkName(nm); if (err) return err;
      var acc = accLoad(), ok = nm.toLowerCase(), ck = myName.toLowerCase();
      if (ok !== ck && acc[ok]) return "Nama itu sudah dipakai akun lain di perangkat ini.";
      var a = acc[ck] || { id: myId, created: Date.now(), logins: 1 };
      delete acc[ck]; a.name = nm; acc[ok] = a; accSave();
      try { localStorage.setItem(SES_KEY, ok); } catch (e) {}
      myName = nm; if (net.setName) net.setName(nm);
      return "";
    }
    function logout() {
      saveInv(); closeMenu(); keys = {}; P.fly = false; P.inv = false; P.icesp = false; loggedIn = false; syncChatUI(); pmSel = null; invKey = null; invSig = "";
      try { localStorage.removeItem(SES_KEY); localStorage.removeItem(TOK_KEY); } catch (e) {}
      var ca = accLoad()[myName.toLowerCase()]; if (ca) { delete ca.token; accSave(); }
      if (typeof net.onLogout === "function") { try { net.onLogout({ name: myName, id: myId }); } catch (e) {} }
      if (ownerOK || myId === OWNER_ID) { ownerOK = false; ownerPriv = null; ownerCert = null; myId = genId(); net.myId = myId; try { localStorage.setItem("fm_player_id", myId); } catch (e) {} } // lepas status owner
      showLogin(myName, "Kamu sudah keluar.");
    }
    function renderAccList() {
      if (!lgList) return;
      var acc = accLoad(), arr = [], k, i, h = "";
      for (k in acc) arr.push(acc[k]);
      arr.sort(function (x, y) { return (y.last || 0) - (x.last || 0); });
      if (!arr.length) { lgList.innerHTML = ""; return; }
      h = '<div class="lg-sec">Akun di perangkat ini</div><div class="lg-chips">';
      for (i = 0; i < arr.length && i < 6; i++) h += '<button class="lg-chip" data-i="' + i + '"><b>' + esc(arr[i].name) + '</b><span>' + esc(arr[i].id) + '</span></button>';
      lgList.innerHTML = h + '</div>';
      lgList._arr = arr;
    }
    function showLogin(prefill, msg) {
      if (!lgEl) return;
      lgEl.style.display = "flex"; lgIn.value = prefill || ""; lgPw.value = ""; lgPw2.value = ""; lgErr.textContent = msg || ""; lgErr.className = msg ? "ok" : "";
      if (lgEl._mode) lgEl._mode();
      renderAccList();
      setTimeout(function () { try { (prefill ? lgPw : lgIn).focus(); } catch (e) {} }, 50);
    }
    (function mkLoginUI() {
      var css = document.createElement("style");
      css.textContent =
        "#fm-lg{position:fixed;left:0;top:0;right:0;bottom:0;z-index:30;display:none;align-items:center;justify-content:center;padding:14px;background:radial-gradient(ellipse at center,rgba(12,26,18,.72),rgba(4,10,8,.93));-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);font-family:Georgia,serif;color:#f3ead6}" +
        "#fm-lgc{width:min(92vw,380px);max-height:92vh;overflow:auto;padding:22px 20px 18px;background:#2a1d10;border:2px solid #e0b64a;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.65);text-align:center}" +
        "#fm-lgc .lg-logo{font-size:44px;line-height:1}#fm-lgc h2{margin:6px 0 2px;font-size:24px;color:#e0b64a}#fm-lgc p{margin:0 0 14px;font-size:13.5px;opacity:.85}" +
        "#fm-lgn,#fm-lgp,#fm-lgp2{width:100%;box-sizing:border-box;padding:12px 12px;border-radius:10px;border:2px solid rgba(224,182,74,.7);background:rgba(0,0,0,.4);color:#f3ead6;font:16px Georgia,serif;text-align:center}#fm-lgn:focus,#fm-lgp:focus,#fm-lgp2:focus{outline:none;border-color:#ffe27a}" +
        "#fm-lgp,#fm-lgp2{margin-top:8px}#fm-lgs{display:block;margin:8px 0 0;font-size:12px;opacity:.8;text-align:left;cursor:pointer}#fm-lgs input{width:auto;margin:0 4px 0 0;vertical-align:middle}#fm-lgh{margin-top:6px;font-size:12px;color:#ffe9a8;text-align:left;min-height:15px}#fm-lge{min-height:18px;margin:8px 0 6px;font-size:12.5px;color:#ff9a88}#fm-lge.ok{color:#ffe9a8}" +
        "#fm-lgb{width:100%;padding:12px;border-radius:10px;border:0;background:#e0b64a;color:#2a1d10;font:700 16px Georgia,serif;cursor:pointer;touch-action:manipulation}#fm-lgb:active{filter:brightness(1.15)}" +
        "#fm-lgc small{display:block;margin-top:12px;font-size:11.5px;line-height:1.4;opacity:.65}" +
        ".lg-sec{margin:16px 0 6px;font-size:12px;font-weight:700;color:#e0b64a;text-align:left}.lg-chips{display:flex;flex-wrap:wrap;gap:6px}" +
        ".lg-chip{flex:1 1 44%;min-width:0;padding:8px 9px;border-radius:9px;border:1px solid rgba(224,182,74,.5);background:rgba(255,255,255,.07);color:#f3ead6;font:13px Georgia,serif;cursor:pointer;text-align:left;touch-action:manipulation}.lg-chip b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lg-chip span{display:block;margin-top:2px;font:11px ui-monospace,Menlo,Consolas,monospace;opacity:.7}.lg-chip:active{background:rgba(224,182,74,.25)}";
      document.head.appendChild(css);
      lgEl = document.createElement("div"); lgEl.id = "fm-lg";
      lgEl.innerHTML = '<div id="fm-lgc"><div class="lg-logo">🌴</div><h2>Rimba Nusantara</h2><p>Masuk dengan namamu untuk mulai menjelajah.</p>' +
        '<input id="fm-lgn" maxlength="16" placeholder="Nama kamu" autocomplete="username" autocapitalize="words" spellcheck="false">' +
        '<input id="fm-lgp" type="password" maxlength="64" placeholder="Kata sandi" autocomplete="current-password">' +
        '<input id="fm-lgp2" type="password" maxlength="64" placeholder="Ulangi kata sandi" autocomplete="new-password" style="display:none">' +
        '<label id="fm-lgs"><input type="checkbox" id="fm-lgv"> Tampilkan kata sandi</label><div id="fm-lgh"></div><div id="fm-lge"></div>' +
        '<button id="fm-lgb">Masuk</button><div id="fm-lga"></div>' +
        '<small>Nama baru otomatis dibuatkan akun dan ID. Kata sandi disimpan sebagai hash di perangkat ini, bukan teks asli. Setelah masuk, kamu tidak perlu memasukkan kata sandi lagi sampai menekan Keluar.</small></div>';
      document.body.appendChild(lgEl);
      lgIn = lgEl.querySelector("#fm-lgn"); lgPw = lgEl.querySelector("#fm-lgp"); lgPw2 = lgEl.querySelector("#fm-lgp2");
      lgErr = lgEl.querySelector("#fm-lge"); lgList = lgEl.querySelector("#fm-lga");
      var lgBtn = lgEl.querySelector("#fm-lgb"), lgHint = lgEl.querySelector("#fm-lgh");
      // mode: masuk (akun ada) / daftar (nama baru) / buat kata sandi (akun lama tanpa kata sandi)
      function lgMode() {
        var n = cleanName(lgIn.value), a = n ? accLoad()[n.toLowerCase()] : null, mode = !n || (a && a.hash) ? "login" : (a ? "setpw" : "register");
        lgPw2.style.display = mode === "login" ? "none" : "block";
        lgPw.setAttribute("autocomplete", mode === "login" ? "current-password" : "new-password");
        lgBtn.textContent = mode === "login" ? "Masuk" : mode === "register" ? "Daftar & Masuk" : "Buat Kata Sandi & Masuk";
        lgHint.textContent = a && a.id === OWNER_ID ? "👑 Akun OWNER: isi kata sandi dengan Kunci Owner." : mode === "register" ? "Nama baru: buat kata sandi (minimal 6 karakter)." : mode === "setpw" ? "Akun ini belum punya kata sandi. Buat sekarang." : "";
      }
      function submit() { var er = loginAs(lgIn.value, lgPw.value, lgPw2.value); if (er) { lgErr.textContent = "⚠ " + er; lgErr.className = ""; } }
      lgEl.querySelector("#fm-lgv").addEventListener("change", function (e) { var t = e.target.checked ? "text" : "password"; lgPw.type = t; lgPw2.type = t; });
      lgBtn.addEventListener("click", submit);
      [lgIn, lgPw, lgPw2].forEach(function (el) { el.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); if (el === lgIn && lgPw.value === "") lgPw.focus(); else submit(); } }); });
      lgIn.addEventListener("input", function () { lgErr.textContent = ""; lgMode(); });
      lgPw.addEventListener("input", function () { lgErr.textContent = ""; });
      lgEl._mode = lgMode;
      lgList.addEventListener("click", function (e) {
        var t = e.target; while (t && t !== lgList && !(t.getAttribute && t.getAttribute("data-i") != null)) t = t.parentNode;
        if (!t || t === lgList || !lgList._arr) return;
        var a = lgList._arr[parseInt(t.getAttribute("data-i"), 10)]; if (a) { lgIn.value = a.name; lgErr.textContent = ""; lgMode(); lgPw.value = ""; lgPw.focus(); }
      });
      var lastS = null; try { lastS = localStorage.getItem(SES_KEY); } catch (e) {}
      var la = lastS && accLoad()[lastS];
      showLogin(la ? la.name : "", la ? "Selamat datang kembali! Masukkan kata sandi untuk lanjut sebagai " + la.name + "." : "");
      resumeSession(); // sudah pernah login & belum Keluar -> langsung masuk tanpa kata sandi
    })();
    // API tambahan
    net.getName = function () { return myName; };
    net.login = function (name, password, confirm) { return loginAs(name, password, confirm == null ? password : confirm); };
    net.logout = logout;
    net.isLoggedIn = function () { return loggedIn; };

    (function loop(now) {
      requestAnimationFrame(loop);
      var dt = Math.min(.05, (now - last) / 1000); last = now;
      if (loggedIn) { remoteStep(dt); update(dt); if ((invT -= dt) <= 0) { invT = 1.5; saveInv(); } if (ownerOK && (ocT -= dt) <= 0) { ocT = 20; refreshCert(); } }
      render3(dt, performance.now());
      if (loggedIn) hud(); else ctx.clearRect(0, 0, vw, vh);
    })(last);
  }

  FM.start = start;
})();
