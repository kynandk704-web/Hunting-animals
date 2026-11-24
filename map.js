/* map.js — Rimba Nusantara: PETA / DUNIA 3D (memakai Three.js r128)
   Berisi HANYA hal yang berkaitan dengan peta:
   - pembuatan peta (pulau dikelilingi laut, bukit, pohon; tanpa air di daratan) + pencarian tabrakan (water/blocked/hitTree/groundY)
   - dunia 3D: renderer, kamera, langit, matahari/bulan, cahaya, tanah, air, vegetasi, hujan, kunang-kunang
   - siklus waktu, cuaca, dan bencana (hanya banjir; gempa & badai petir dinonaktifkan)
   Karakter (pemain, satwa, kontrol, HUD, multiplayer, suara) ada di main.js.

   URUTAN MEMUAT: map.js dulu, baru main.js. (Lautan sudah menyatu di map.js, ocean.js tidak perlu dimuat lagi.)
   API publik tetap sama: ForestMap.generate(onProgress, onDone) lalu ForestMap.start(canvasElement)
   (ForestMap.start disediakan oleh main.js).
   Kamera: klik kanan + geser (atau tombol Q / C) memutar, roda mouse = zoom. */
(function () {
  var T = 24, N = 100, W = T * N, CELL = 120, HS = 2, rs = null;
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function R() { return rs ? rs() : Math.random(); }
  var G, F, S, HG, TC, terrain, trees = [], tb = {};
  var SPAWN = { x: 420, y: 480 };
  // GUNUNG: pusat (x, y), radius kaki gunung (r) dan tinggi puncak (h), semuanya dalam satuan dunia.
  // Ubah angka ini untuk memindah / membesarkan / meninggikan gunung.
  var MT = { x: 1750, y: 520, r: 360, h: 170 };
  function mtn(x, y) { var m = 1 - Math.hypot(x - MT.x, y - MT.y) / MT.r; return m > 0 ? m : 0; } // 0 = di luar gunung, 1 = puncak
  var extraSteps = []; // langkah tambahan pada generate() yang didaftarkan modul lain (mis. main.js memasang satwa)

  function rnd(a, b) { return a + R() * (b - a); }
  function mkNoise() {
    var g = [], i;
    for (i = 0; i < 289; i++) g.push(R());
    function sm(t) { return t * t * (3 - 2 * t); }
    return function (x, y) {
      x = Math.max(0, Math.min(x, .9999)) * 16; y = Math.max(0, Math.min(y, .9999)) * 16;
      var a = x | 0, b = y | 0, fx = sm(x - a), fy = sm(y - b);
      var p = g[b * 17 + a], q = g[b * 17 + a + 1], r = g[(b + 1) * 17 + a], s = g[(b + 1) * 17 + a + 1];
      return (p * (1 - fx) + q * fx) * (1 - fy) + (r * (1 - fx) + s * fx) * fy;
    };
  }
  var n1, n2;

  function water(x, y) {
    var i = (x / T) | 0, j = (y / T) | 0;
    return x < 0 || y < 0 || i >= N || j >= N || G[j * N + i] === 1;
  }
  function flood(x, y) { var i = (x / T) | 0, j = (y / T) | 0; return i >= 0 && j >= 0 && i < N && j < N && F[j * N + i] === 1; }
  function pblock(x, y, r) { return hitTree(x, y, r); } // tanpa dinding tepi: dunia tak berbatas
  function hitTree(x, y, r) {
    var cx = (x / CELL) | 0, cy = (y / CELL) | 0, i, j, k, l, t, dx, dy, rr;
    for (i = cx - 1; i <= cx + 1; i++) for (j = cy - 1; j <= cy + 1; j++) {
      l = tb[i + "," + j];
      if (l) for (k = 0; k < l.length; k++) {
        t = l[k]; dx = x - t.x; dy = y - t.y; rr = 6 + r;
        if (dx * dx + dy * dy < rr * rr) return true;
      }
    }
    return false;
  }
  function blocked(x, y, r) {
    return water(x, y) || water(x + r, y) || water(x - r, y) || water(x, y + r) || water(x, y - r) || hitTree(x, y, r);
  }

  /* ---------- medan 3D: jarak bertanda ke tepi air -> tinggi tanah ---------- */
  function sampS(x, y) {
    var u = x / T - .5, v = y / T - .5;
    u = u < 0 ? 0 : u > N - 1.001 ? N - 1.001 : u; v = v < 0 ? 0 : v > N - 1.001 ? N - 1.001 : v;
    var i = u | 0, j = v | 0, fx = u - i, fy = v - j;
    var a = S[j * N + i], b = S[j * N + i + 1], c = S[(j + 1) * N + i], d = S[(j + 1) * N + i + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  function groundY(x, y) {
    var st = T / HS, HV = N * HS + 1, u = x / st, v = y / st;
    u = u < 0 ? 0 : u > HV - 1.001 ? HV - 1.001 : u; v = v < 0 ? 0 : v > HV - 1.001 ? HV - 1.001 : v;
    var i = u | 0, j = v | 0, fx = u - i, fy = v - j;
    var a = HG[j * HV + i], b = HG[j * HV + i + 1], c = HG[(j + 1) * HV + i], d = HG[(j + 1) * HV + i + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  function mtH(x, y) { // tinggi tambahan dari gunung di titik (x, y)
    var m = mtn(x, y); if (m <= 0) return 0;
    var sm = m * m * (3 - 2 * m);
    return MT.h * (.7 * sm + .3 * m * m * m) + Math.sin(x / 37 + y / 53) * Math.sin(y / 41 - x / 61) * 7 * sm + (n2(x / W, y / W) - .5) * 40 * sm;
  }
  function hash2(x, y) { var h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return h - Math.floor(h); }
  function hsl(h, s, l) { var a = s * Math.min(l, 1 - l); function f(n) { var k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); } return [f(0), f(8), f(4)]; }
  function gcol(x, y, s) {
    var v = n2(x / W, y / W), hh = hash2(x * .37, y * .37), c;
    if (s < 0) { var dp = Math.min(1, -s / 2.5); return hsl(.52 - .03 * dp, .32, .3 - .13 * dp + hh * .03); }
    var gr = hsl(.27 + v * .05 - .015, .42, .24 + v * .09 + hh * .04 - (v > .6 ? .045 : 0)), sa = hsl(.12, .4, .56 + hh * .05);
    var t = Math.max(0, Math.min(1, (s - 1) / 1.6)); t = t * t * (3 - 2 * t);
    c = [sa[0] + (gr[0] - sa[0]) * t, sa[1] + (gr[1] - sa[1]) * t, sa[2] + (gr[2] - sa[2]) * t];
    var m = mtn(x, y);
    if (m > 0) {
      var rk = hsl(.09, .1, .36 + hh * .06), pk = hsl(.08, .06, .62 + hh * .06);
      var a1 = Math.max(0, Math.min(1, (m - .2) / .35)); a1 = a1 * a1 * (3 - 2 * a1);
      var a2 = Math.max(0, Math.min(1, (m - .7) / .25)); a2 = a2 * a2 * (3 - 2 * a2);
      c = [c[0] + (rk[0] - c[0]) * a1, c[1] + (rk[1] - c[1]) * a1, c[2] + (rk[2] - c[2]) * a1];
      c = [c[0] + (pk[0] - c[0]) * a2, c[1] + (pk[1] - c[1]) * a2, c[2] + (pk[2] - c[2]) * a2];
    }
    return c;
  }
  function chamfer(isT) {
    var d = new Float32Array(N * N), i, j, k, v;
    for (k = 0; k < N * N; k++) d[k] = isT(k) ? 0 : 999;
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
      k = j * N + i; v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + 1);
      if (j > 0) { v = Math.min(v, d[k - N] + 1); if (i > 0) v = Math.min(v, d[k - N - 1] + 1.414); if (i < N - 1) v = Math.min(v, d[k - N + 1] + 1.414); }
      d[k] = v;
    }
    for (j = N - 1; j >= 0; j--) for (i = N - 1; i >= 0; i--) {
      k = j * N + i; v = d[k];
      if (i < N - 1) v = Math.min(v, d[k + 1] + 1);
      if (j < N - 1) { v = Math.min(v, d[k + N] + 1); if (i < N - 1) v = Math.min(v, d[k + N + 1] + 1.414); if (i > 0) v = Math.min(v, d[k + N - 1] + 1.414); }
      d[k] = v;
    }
    return d;
  }

  /* ---------- memuat Three.js ---------- */
  function loadThree(ok, fail) {
    if (window.THREE) return ok();
    var urls = [window.ForestMap && ForestMap.threeSrc || "three.min.js",
      "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
      "https://unpkg.com/three@0.128.0/build/three.min.js"], i = 0;
    (function next() {
      if (i >= urls.length) return fail();
      var s = document.createElement("script"); s.src = urls[i++];
      s.onload = function () { if (window.THREE) ok(); else next(); };
      s.onerror = function () { if (s.parentNode) s.parentNode.removeChild(s); next(); };
      document.head.appendChild(s);
    })();
  }

  /* ---------- DUNIA (PULAU) TERSIMPAN: tiap pulau punya ID otomatis (WD-XXXXXX) dan seed sendiri ---------- */
  var WL_KEY = "fm_worlds", WC_KEY = "fm_world_cur", WL_MAX = 20;
  function wRead() {
    var a = []; try { a = JSON.parse(localStorage.getItem(WL_KEY) || "[]"); } catch (e) { a = []; }
    return Array.isArray(a) ? a.filter(function (w) { return w && typeof w.id === "string" && w.seed; }) : [];
  }
  function wWrite(a) { try { localStorage.setItem(WL_KEY, JSON.stringify(a)); } catch (e) {} }
  function wCur(id) { try { localStorage.setItem(WC_KEY, id); } catch (e) {} }
  function wId(list) {
    var ch = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", id, i;
    do { id = "WD-"; for (i = 0; i < 6; i++) id += ch.charAt(Math.floor(Math.random() * ch.length)); } while (list.some(function (w) { return w.id === id; }));
    return id;
  }
  function wMake(name, list) {
    var seed = (Math.floor(Math.random() * 4294967295) >>> 0) || 1;
    return { id: wId(list), name: name || "Pulau " + (list.length + 1), seed: seed, created: Date.now() };
  }
  var worlds = {
    max: WL_MAX,
    list: wRead,
    current: function () { // pulau yang sedang dipakai; pulau pertama dibuat otomatis
      var a = wRead(), id = null, i, w;
      try { id = localStorage.getItem(WC_KEY); } catch (e) {}
      for (i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
      if (a.length) { wCur(a[0].id); return a[0]; }
      w = wMake("", a); a.push(w); wWrite(a); wCur(w.id); return w;
    },
    create: function (name) { // pulau baru dengan ID & seed acak, langsung jadi pulau aktif
      var a = wRead(), w;
      if (a.length >= WL_MAX) return null;
      w = wMake(String(name == null ? "" : name).replace(/\s+/g, " ").trim().slice(0, 20), a); a.push(w); wWrite(a); wCur(w.id); return w;
    },
    select: function (id) {
      var a = wRead(), i; for (i = 0; i < a.length; i++) if (a[i].id === id) { wCur(id); return a[i]; }
      return null;
    }
  };

  /* ---------- pembuatan peta (bertahap supaya loading screen bisa menampilkan progres) ---------- */
  function generate(onProgress, onDone) {
    if (window.ForestMP && !ForestMap.seed) { onProgress(0, "Menghubungkan ke server…"); return ForestMP.ready(function (sd) { ForestMap.seed = sd; generate(onProgress, onDone); }); }
    if (!window.ForestMP) { var cw = worlds.current(); ForestMap.seed = cw.seed; ForestMap.world = cw; } // pulau aktif dari menu Dunia (mode server memakai seed server)
    rs = ForestMap.seed ? mulberry(ForestMap.seed) : null;
    G = new Uint8Array(N * N); trees = []; tb = {};
    var steps = [
      ["Memuat mesin 3D…", function (next) {
        loadThree(next, function () { onProgress(0, "Gagal memuat Three.js. Periksa koneksi internet lalu muat ulang halaman."); });
      }],
      ["Membentuk pulau dan garis pantai…", function () {
        n1 = mkNoise(); n2 = mkNoise();
        // hanya ada air di LAUTAN: cincin laut di tepi peta dengan garis pantai berliku. Tidak ada rawa/sungai/danau di daratan.
        for (var j = 0; j < N; j++) for (var i = 0; i < N; i++) {
          var x = i * T, y = j * T, ed = Math.min(i, j, N - 1 - i, N - 1 - j);
          if (ed < 3 + n1(i / N, j / N) * 7 && Math.hypot(x - SPAWN.x, y - SPAWN.y) > 300 && Math.hypot(x - MT.x, y - MT.y) > MT.r + 40) G[j * N + i] = 1;
        }
      }],
      ["Membentuk perbukitan dan lembah…", function () {
        var k, i, j, HV = N * HS + 1, st = T / HS, x, y, id, s, h, k2, hs, c;
        var dW = chamfer(function (q) { return G[q] === 1; }), dL = chamfer(function (q) { return G[q] !== 1; });
        S = new Float32Array(N * N);
        for (k = 0; k < N * N; k++) S[k] = G[k] === 1 ? -Math.min(30, dL[k]) : Math.min(30, dW[k]);
        HG = new Float32Array(HV * HV); TC = new Float32Array(HV * HV * 3);
        for (j = 0; j < HV; j++) for (i = 0; i < HV; i++) {
          x = i * st; y = j * st; id = j * HV + i; s = sampS(x, y);
          if (s < 0) h = Math.max(-11, s * 4.2);
          else {
            k2 = Math.min(1, s / 6); k2 = k2 * k2 * (3 - 2 * k2);
            h = Math.min(s, 3) * 1.1 + Math.max(-2, (n2(x / W, y / W) - .42) * 34) * k2 + Math.sin(x / 53) * Math.sin(y / 67) * 2.5 * k2;
            h = Math.max(h, Math.min(s, 3) * .8); // tidak ada cekungan yang tergenang air di daratan
            h += mtH(x, y); // tambahkan gunung
            hs = Math.min(x, y, W - x, W - y); h *= Math.min(1, hs / 140);
          }
          HG[id] = h; c = gcol(x, y, s); TC[id * 3] = c[0]; TC[id * 3 + 1] = c[1]; TC[id * 3 + 2] = c[2];
        }
        // peta mini
        terrain = document.createElement("canvas"); terrain.width = terrain.height = 200;
        var tg = terrain.getContext("2d"), im = tg.createImageData(200, 200), p, ss, cc;
        for (j = 0; j < 200; j++) for (i = 0; i < 200; i++) {
          x = (i + .5) / 200 * W; y = (j + .5) / 200 * W; ss = sampS(x, y); p = (j * 200 + i) * 4;
          cc = ss < 0 ? hsl(.57, .5, .3 + hash2(i, j) * .04) : gcol(x, y, ss);
          im.data[p] = cc[0] * 255; im.data[p + 1] = cc[1] * 255; im.data[p + 2] = cc[2] * 255; im.data[p + 3] = 255;
        }
        tg.putImageData(im, 0, 0);
        F = new Uint8Array(N * N); // zona rawan banjir: 3 petak dari air
        for (j = 0; j < N; j++) for (i = 0; i < N; i++) if (G[j * N + i] === 1)
          for (var dj = -3; dj <= 3; dj++) for (var di = -3; di <= 3; di++) { var ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < N && jj < N && G[jj * N + ii] === 0) F[jj * N + ii] = 1; }
      }],
      ["Menanam pepohonan rimba…", function () {
        var tries = 0;
        var GAP = 56; // jarak minimum antar-batang pohon (satuan dunia). Naikkan agar lebih renggang, turunkan agar lebih rapat
        function nearTree(px, py) {
          var cx = (px / CELL) | 0, cy = (py / CELL) | 0, i, j, k, l, o;
          for (i = cx - 1; i <= cx + 1; i++) for (j = cy - 1; j <= cy + 1; j++) {
            l = tb[i + "," + j];
            if (l) for (k = 0; k < l.length; k++) { o = l[k]; if (Math.hypot(px - o.x, py - o.y) < GAP) return true; }
          }
          return false;
        }
        while (trees.length < 500 && tries++ < 25000) {
          var x = rnd(30, W - 30), y = rnd(30, W - 30);
          if (n2(x / W, y / W) + R() * .3 < .5) continue;
          if (blocked(x, y, 12) || Math.hypot(x - SPAWN.x, y - SPAWN.y) < 110 || mtn(x, y) > .38) continue;
          if (nearTree(x, y)) continue;
          var t = { x: x, y: y, s: rnd(.8, 1.4), c: (R() * 3) | 0 };
          trees.push(t);
          var key = ((x / CELL) | 0) + "," + ((y / CELL) | 0);
          (tb[key] = tb[key] || []).push(t);
        }
      }]
    ];
    steps = steps.concat(extraSteps);
    var i = 0;
    (function run() {
      onProgress(i / steps.length, steps[i][0]);
      setTimeout(function () {
        var st = steps[i][1];
        var done = function () {
          i++;
          if (i < steps.length) run();
          else { rs = null; onProgress(1, "Rimba siap dijelajahi!"); onDone(); }
        };
        if (st.length) st(done); else { st(); done(); }
      }, 350);
    })();
  }

  /* ---------- tambahan API peta ---------- */
  function dense(x, y) { return n2(x / W, y / W) > .6; } // rimba lebat memperlambat gerak
  function newEnv(tod) { // keadaan lingkungan (waktu, cuaca, bencana); main.js menambah field milik karakter
    return { tod: tod == null ? .1 : tod, rain: 0, raining: false, rainT: rnd(40, 80), dark: 0, dis: null, disT: 35, qk: 0, sto: 0, fl: 0, rocks: [], bolts: [], strikes: [], scars: [], flash: 0, rt: 0, lt: 0, winter: 0, wOn: false, sT: rnd(150, 240) };
  }

  /* =====================================================================
     DUNIA 3D  —  dipanggil oleh main.js:  var world = ForestMap.createWorld(canvasHUD, TOUCH)
     world.update(dt, E, P, hooks)  : waktu, cuaca, bencana
     world.begin(dt, now, E, P)     : langit, cahaya, air  (sebelum karakter digambar)
     world.finish(dt, now, E, P)    : bencana, hujan, kamera, render WebGL (setelah karakter digambar)
     ===================================================================== */
  var DAY_SEC = 180, NIGHT_SEC = 180; // lama siang dan malam (detik): 3 menit masing-masing
  function createWorld(cv, TOUCH) {
    var vw = innerWidth, vh = innerHeight, dpr = 1;
    var cam = { yaw: 0, pitch: .92, dist: 430 }; // kamera orbit; diubah oleh kontrol di main.js
    var gl;
    try { gl = new THREE.WebGLRenderer({ antialias: !TOUCH, powerPreference: "high-performance" }); }
    catch (err) { alert("Browser/perangkat ini tidak mendukung WebGL, sehingga mode 3D tidak bisa dijalankan."); throw err; }
    var gc = gl.domElement;
    gc.style.cssText = "position:fixed;left:0;top:0;width:100%;height:100%;z-index:0;display:block;pointer-events:none";
    cv.parentNode.insertBefore(gc, cv);
    gl.shadowMap.enabled = true; gl.shadowMap.type = TOUCH ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

    var scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, 4, 6500);
    scene.fog = new THREE.Fog(0xbfe2f2, 140, 1000);
    scene.background = new THREE.Color(0xbfe2f2);
    var cutU = { uP: { value: new THREE.Vector4(0, 0, 1e5, 0) } };

    /* --- bahan & bentuk dasar --- */
    var BOX = new THREE.BoxGeometry(1, 1, 1), SPH = new THREE.SphereGeometry(1, 10, 8), CYL = new THREE.CylinderGeometry(1, 1, 1, 8), CONE = new THREE.ConeGeometry(1, 1, 8);
    var matC = {};
    function M(c) { return matC[c] || (matC[c] = new THREE.MeshLambertMaterial({ color: c })); }
    function mesh(geo, mat, sx, sy, sz, x, y, z, rx, ry, rz) {
      var m = new THREE.Mesh(geo, mat); m.scale.set(sx, sy, sz); m.position.set(x || 0, y || 0, z || 0);
      if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0); m.castShadow = true; return m;
    }
    function bx(w, h, d, c, x, y, z, rx, ry, rz) { return mesh(BOX, M(c), w, h, d, x, y, z, rx, ry, rz); }
    function sp(a, b, c, col, x, y, z) { return mesh(SPH, M(col), a, b, c, x, y, z); }
    function cutout(m) { // pohon/batu yang menghalangi pemain "memudar" (dither) di sekitar karakter
      m.onBeforeCompile = function (sh) {
        sh.uniforms.uP = cutU.uP;
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vZ;").replace("#include <project_vertex>", "#include <project_vertex>\nvZ = -mvPosition.z;");
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vZ;\nuniform vec4 uP;")
          .replace("void main() {", "void main() {\n if (vZ < uP.z - 8.0) { float dd = length(gl_FragCoord.xy - uP.xy); if (dd < uP.w) { float al = smoothstep(uP.w * .45, uP.w, dd); float hh = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453); if (hh > al) discard; } }");
      };
      m.customProgramCacheKey = function () { return "cut"; };
      return m;
    }

    /* --- langit, bintang, matahari, bulan --- */
    var skyGeo = new THREE.SphereGeometry(5000, 20, 14), skyN = skyGeo.attributes.position.count, skyCol = new Float32Array(skyN * 3);
    skyGeo.setAttribute("color", new THREE.BufferAttribute(skyCol, 3));
    var sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
    var starPos = new Float32Array(700 * 3), si;
    for (si = 0; si < 700; si++) { var sa = Math.random() * 6.283, se = Math.acos(Math.random() * .95 + .05); starPos[si * 3] = Math.sin(se) * Math.cos(sa) * 4700; starPos[si * 3 + 1] = Math.cos(se) * 4700; starPos[si * 3 + 2] = Math.sin(se) * Math.sin(sa) * 4700; }
    var starGeo = new THREE.BufferGeometry(); starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    var stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    stars.frustumCulled = false; scene.add(stars);
    var sunM = new THREE.Mesh(new THREE.SphereGeometry(110, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff1b0, fog: false })); sunM.frustumCulled = false; scene.add(sunM);
    var moonM = new THREE.Mesh(new THREE.SphereGeometry(80, 16, 12), new THREE.MeshBasicMaterial({ color: 0xe8eeff, fog: false })); moonM.frustumCulled = false; scene.add(moonM);

    /* --- cahaya --- */
    var hemi = new THREE.HemisphereLight(0xcfe6ff, 0x3b4a2a, .6); scene.add(hemi);
    var dl = new THREE.DirectionalLight(0xfff4dc, .9); scene.add(dl); scene.add(dl.target);
    dl.castShadow = true; dl.shadow.mapSize.set(TOUCH ? 1024 : 2048, TOUCH ? 1024 : 2048);
    dl.shadow.camera.left = -300; dl.shadow.camera.right = 300; dl.shadow.camera.top = 300; dl.shadow.camera.bottom = -300; dl.shadow.camera.near = 50; dl.shadow.camera.far = 1800;
    dl.shadow.bias = -.0004; dl.shadow.normalBias = .6; dl.shadow.camera.updateProjectionMatrix();

    /* --- tanah --- */
    var HV = N * HS + 1, stp = T / HS, vi, vj;
    var tpos = new Float32Array(HV * HV * 3), tuv = new Float32Array(HV * HV * 2), tidx = new Uint16Array((HV - 1) * (HV - 1) * 6), ii = 0;
    for (vj = 0; vj < HV; vj++) for (vi = 0; vi < HV; vi++) {
      var id = vj * HV + vi; tpos[id * 3] = vi * stp; tpos[id * 3 + 1] = HG[id]; tpos[id * 3 + 2] = vj * stp; tuv[id * 2] = vi * stp / 48; tuv[id * 2 + 1] = vj * stp / 48;
    }
    for (vj = 0; vj < HV - 1; vj++) for (vi = 0; vi < HV - 1; vi++) {
      var a0 = vj * HV + vi, b0 = a0 + 1, c0 = a0 + HV, d0 = c0 + 1;
      tidx[ii++] = a0; tidx[ii++] = c0; tidx[ii++] = b0; tidx[ii++] = b0; tidx[ii++] = c0; tidx[ii++] = d0;
    }
    var tgeo = new THREE.BufferGeometry();
    tgeo.setAttribute("position", new THREE.BufferAttribute(tpos, 3)); tgeo.setAttribute("color", new THREE.BufferAttribute(TC, 3)); tgeo.setAttribute("uv", new THREE.BufferAttribute(tuv, 2));
    tgeo.setIndex(new THREE.BufferAttribute(tidx, 1)); tgeo.computeVertexNormals(); var TC0 = new Float32Array(TC);
    var dc = document.createElement("canvas"); dc.width = dc.height = 128; var dg = dc.getContext("2d"), dk;
    dg.fillStyle = "#d8d8d8"; dg.fillRect(0, 0, 128, 128);
    for (dk = 0; dk < 900; dk++) { dg.fillStyle = "rgba(" + (Math.random() < .5 ? "255,255,255" : "90,90,90") + "," + (.1 + Math.random() * .22) + ")"; dg.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2, 1 + Math.random() * 3); }
    var dtex = new THREE.CanvasTexture(dc); dtex.wrapS = dtex.wrapT = THREE.RepeatWrapping;
    var ground = new THREE.Mesh(tgeo, new THREE.MeshLambertMaterial({ vertexColors: true, map: dtex })); ground.receiveShadow = true; scene.add(ground);

    /* --- air --- */
    var wc = document.createElement("canvas"); wc.width = wc.height = 128; var wg = wc.getContext("2d");
    wg.fillStyle = "#dcd6cc"; wg.fillRect(0, 0, 128, 128); // dasar tekstur netral agar warna air bandang (cokelat) tidak tercampur biru
    for (dk = 0; dk < 160; dk++) { wg.strokeStyle = "rgba(255,255,255," + (.1 + Math.random() * .2) + ")"; wg.lineWidth = 1 + Math.random(); wg.beginPath(); var wx0 = Math.random() * 128, wy0 = Math.random() * 128; wg.moveTo(wx0, wy0); wg.lineTo(wx0 + 8 + Math.random() * 16, wy0 + Math.random() * 3); wg.stroke(); }
    var wtex = new THREE.CanvasTexture(wc); wtex.wrapS = wtex.wrapT = THREE.RepeatWrapping; wtex.repeat.set(W / 110, W / 110);
    var wgeo = new THREE.PlaneGeometry(W, W); wgeo.rotateX(-Math.PI / 2);
    var waterM = new THREE.Mesh(wgeo, new THREE.MeshPhongMaterial({ color: 0x8a6636, transparent: true, opacity: .76, shininess: 90, specular: 0xd8c7a6, map: wtex, depthWrite: false }));
    waterM.position.set(W / 2, 0, W / 2); scene.add(waterM);

    /* --- pohon, semak, batu, rumput, bunga (instancing) --- */
    var TV = [
      { th: 44, tr: 4.4, b: [[0, 50, 0, 24], [-12, 42, 5, 15], [12, 45, -5, 14], [0, 64, 0, 15]] },
      { th: 60, tr: 3.8, b: [[0, 70, 0, 19], [9, 58, 6, 13], [-9, 62, -4, 12], [2, 84, 0, 12]] },
      { th: 34, tr: 4.8, b: [[0, 44, 0, 26], [-17, 38, 0, 15], [17, 40, 4, 15], [0, 36, -15, 15]] }];
    var PAL = [[0x1f4d25, 0x2f7a34, 0x4f9a48], [0x245a2a, 0x3a8a3c, 0x62ad52], [0x1a4426, 0x2f6f45, 0x4c8f5e]];
    var vis = trees.slice(), ti, bt;
    var trunkG = new THREE.CylinderGeometry(.62, 1, 1, 7); trunkG.translate(0, .5, 0);
    var icoG = new THREE.IcosahedronGeometry(1, 1);
    var trunkI = new THREE.InstancedMesh(trunkG, cutout(new THREE.MeshLambertMaterial({ color: 0x4e3219 })), vis.length);
    var leafI = new THREE.InstancedMesh(icoG, cutout(new THREE.MeshLambertMaterial({ color: 0xffffff })), vis.length * 4);
    var d3 = new THREE.Object3D(), tc3 = new THREE.Color(), li = 0;
    vis.forEach(function (t, k) {
      var v = TV[t.c], gy = t.out ? 0 : groundY(t.x, t.y), ry = Math.random() * 6.28, s = t.s;
      d3.position.set(t.x, gy - 1, t.y); d3.rotation.set(0, ry, 0); d3.scale.set(v.tr * s, (v.th + 2) * s, v.tr * s); d3.updateMatrix(); trunkI.setMatrixAt(k, d3.matrix);
      for (bt = 0; bt < 4; bt++) {
        var b = v.b[bt], cr = Math.cos(ry), sr = Math.sin(ry);
        d3.position.set(t.x + (b[0] * cr - b[2] * sr) * s, gy + b[1] * s, t.y + (b[0] * sr + b[2] * cr) * s);
        d3.rotation.set(Math.random() * 3, Math.random() * 3, 0); d3.scale.set(b[3] * s * (.95 + Math.random() * .2), b[3] * s * (.85 + Math.random() * .2), b[3] * s * (.95 + Math.random() * .2)); d3.updateMatrix();
        leafI.setMatrixAt(li, d3.matrix);
        tc3.setHex(PAL[t.c][bt === 3 ? 2 : bt % 3 === 0 ? 1 : bt % 3]); tc3.offsetHSL((Math.random() - .5) * .03, 0, (Math.random() - .5) * .07); leafI.setColorAt(li, tc3); li++;
      }
    });
    [trunkI, leafI].forEach(function (m) { m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false; m.instanceMatrix.needsUpdate = true; scene.add(m); });
    leafI.instanceColor.needsUpdate = true;

    /* --- pohon bisa ditebang: sembunyikan instance-nya (hideTree) lalu hapus tabrakannya (fellTree) --- */
    var ZM = new THREE.Matrix4().makeScale(0, 0, 0);
    function treeNear(x, y, rad) {
      var best = null, bd = rad * rad, q, t, d;
      for (q = 0; q < vis.length; q++) { t = vis[q]; if (t.cut) continue; d = (t.x - x) * (t.x - x) + (t.y - y) * (t.y - y); if (d < bd) { bd = d; best = t; } }
      return best;
    }
    function treeHide(t) {
      if (t.hid) return; var k = vis.indexOf(t), q; if (k < 0) return;
      trunkI.setMatrixAt(k, ZM); for (q = 0; q < 4; q++) leafI.setMatrixAt(k * 4 + q, ZM);
      trunkI.instanceMatrix.needsUpdate = true; leafI.instanceMatrix.needsUpdate = true; t.hid = 1;
    }
    FM.TV = TV; FM.PAL = PAL;
    FM.hideTree = function (x, y, rad) { var t = treeNear(x, y, rad || 16); if (!t) return null; treeHide(t); return t; };
    FM.fellTree = function (x, y, rad) {
      var t = treeNear(x, y, rad || 26), i, l, key; if (!t) return false;
      treeHide(t); t.cut = 1;
      i = trees.indexOf(t); if (i >= 0) trees.splice(i, 1);
      key = ((t.x / CELL) | 0) + "," + ((t.y / CELL) | 0); l = tb[key]; if (l) { i = l.indexOf(t); if (i >= 0) l.splice(i, 1); }
      return true;
    };

    function scatter(count, minS, fn) {
      var out = [], tries = 0;
      while (out.length < count && tries++ < count * 6) {
        var x = Math.random() * W, y = Math.random() * W, s = sampS(x, y);
        if (s < minS) continue;
        out.push([x, y, groundY(x, y)]); if (fn) fn(out[out.length - 1]);
      }
      return out;
    }
    var grassG = new THREE.ConeGeometry(1, 1, 4, 1); grassG.translate(0, .5, 0);
    var grassPts = scatter(7000, 1.3), grassI = new THREE.InstancedMesh(grassG, new THREE.MeshLambertMaterial({ color: 0xffffff }), grassPts.length);
    grassPts.forEach(function (p, k) {
      d3.position.set(p[0], p[2] - .5, p[1]); d3.rotation.set((Math.random() - .5) * .4, Math.random() * 3, (Math.random() - .5) * .4); var h = 5 + Math.random() * 8; d3.scale.set(1.2 + Math.random(), h, 1.2 + Math.random()); d3.updateMatrix(); grassI.setMatrixAt(k, d3.matrix);
      tc3.setHSL(.24 + Math.random() * .08, .5, .2 + Math.random() * .16); grassI.setColorAt(k, tc3);
    });
    grassI.frustumCulled = false; grassI.instanceMatrix.needsUpdate = true; grassI.instanceColor.needsUpdate = true; scene.add(grassI);
    var flowPts = scatter(650, 1.6), flowI = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 5, 4), new THREE.MeshLambertMaterial({ color: 0xffffff }), flowPts.length), FC = [0xffd84a, 0xff6a6a, 0xffffff, 0xff9ad0, 0xb98aff];
    flowPts.forEach(function (p, k) { d3.position.set(p[0], p[2] + 4.5, p[1]); d3.rotation.set(0, 0, 0); var s = 1.2 + Math.random() * .8; d3.scale.set(s, s, s); d3.updateMatrix(); flowI.setMatrixAt(k, d3.matrix); tc3.setHex(FC[(Math.random() * FC.length) | 0]); flowI.setColorAt(k, tc3); });
    flowI.frustumCulled = false; flowI.instanceMatrix.needsUpdate = true; flowI.instanceColor.needsUpdate = true; scene.add(flowI);
    var rockPts = scatter(260, .6), rockI = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), cutout(new THREE.MeshLambertMaterial({ color: 0xffffff })), rockPts.length);
    rockPts.forEach(function (p, k) { d3.position.set(p[0], p[2] + 1, p[1]); d3.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); var s = 3 + Math.random() * 6; d3.scale.set(s, s * (.5 + Math.random() * .4), s); d3.updateMatrix(); rockI.setMatrixAt(k, d3.matrix); tc3.setHSL(.1, .06, .35 + Math.random() * .2); rockI.setColorAt(k, tc3); });
    rockI.castShadow = true; rockI.receiveShadow = true; rockI.frustumCulled = false; rockI.instanceMatrix.needsUpdate = true; rockI.instanceColor.needsUpdate = true; scene.add(rockI);

    /* --- musim dingin: tanah, daun, dan rumput memutih (diperbarui bertahap, hanya saat nilainya berubah) --- */
    var leafBase = new Float32Array(leafI.instanceColor.array), grassBase = new Float32Array(grassI.instanceColor.array), lastW = -1;
    function tintInst(inst, base, m, r, g, b) {
      var a = inst.instanceColor.array, n = a.length, q;
      for (q = 0; q < n; q += 3) { a[q] = base[q] + (r - base[q]) * m; a[q + 1] = base[q + 1] + (g - base[q + 1]) * m; a[q + 2] = base[q + 2] + (b - base[q + 2]) * m; }
      inst.instanceColor.needsUpdate = true;
    }
    function applyWinter(w) {
      w = Math.round(w * 20) / 20; if (w === lastW) return; lastW = w;
      var n = HV * HV, q, f, m;
      for (q = 0; q < n; q++) {
        f = Math.max(0, Math.min(1, (HG[q] + .5) / 1.2)) * w * .9; m = q * 3;
        TC[m] = TC0[m] + (.93 - TC0[m]) * f; TC[m + 1] = TC0[m + 1] + (.96 - TC0[m + 1]) * f; TC[m + 2] = TC0[m + 2] + (1 - TC0[m + 2]) * f;
      }
      tgeo.attributes.color.needsUpdate = true;
      tintInst(leafI, leafBase, w * .75, .9, .95, 1); tintInst(grassI, grassBase, w * .8, .86, .9, .88);
      flowI.visible = w < .5;
    }

    /* --- objek dinamis: kolam objek (decal, cincin, daging, tombak, api, petir) --- */
    function Pool(make) { this.items = []; this.n = 0; this.make = make; }
    Pool.prototype.begin = function () { this.n = 0; };
    Pool.prototype.get = function () { var it = this.items[this.n]; if (!it) { it = this.make(); scene.add(it); this.items.push(it); } it.visible = true; this.n++; return it; };
    Pool.prototype.end = function () { for (var i = this.n; i < this.items.length; i++) this.items[i].visible = false; };
    var diskG = new THREE.CircleGeometry(1, 14); diskG.rotateX(-Math.PI / 2);
    var ringG = new THREE.RingGeometry(.86, 1, 28); ringG.rotateX(-Math.PI / 2);
    function decal(col) { var m = new THREE.Mesh(diskG, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); return m; }
    function ring(col) { return new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .6, depthWrite: false, side: THREE.DoubleSide })); }
    var poolScar = new Pool(function () { return decal(0x140e08); }), poolWarn = new Pool(function () { return ring(0xff6a30); });
    var poolRock = new Pool(function () { var g = new THREE.Group(); g.add(mesh(new THREE.DodecahedronGeometry(1, 0), M(0x7d776c), 12, 9, 11, 0, 0, 0)); return g; });
    var boltMat = new THREE.MeshBasicMaterial({ color: 0xfffacc, fog: false });
    var poolStrike = new Pool(function () { var g = new THREE.Group(), i; for (i = 0; i < 11; i++) { var m = new THREE.Mesh(BOX, boltMat); g.add(m); } return g; });

    /* --- cuaca: hujan, kunang-kunang --- */
    var NR = 800, rainPos = new Float32Array(NR * 6), rainOff = [], ri;
    for (ri = 0; ri < NR; ri++) rainOff.push([(Math.random() - .5) * 900, Math.random() * 460, (Math.random() - .5) * 900]);
    var rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
    var rainM = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xbfd4e6, transparent: true, opacity: 0, fog: false })); rainM.frustumCulled = false; scene.add(rainM);
    var NF = 50, ffPos = new Float32Array(NF * 3), ffGeo = new THREE.BufferGeometry(); ffGeo.setAttribute("position", new THREE.BufferAttribute(ffPos, 3));
    var ffM = new THREE.Points(ffGeo, new THREE.PointsMaterial({ color: 0xc8ff78, size: 4, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); ffM.frustumCulled = false; scene.add(ffM);
    var NS = 900, snowPos = new Float32Array(NS * 3), snowOff = [], sni;
    for (sni = 0; sni < NS; sni++) snowOff.push([(Math.random() - .5) * 900, Math.random() * 460, (Math.random() - .5) * 900, Math.random() * 6.28]);
    var snowGeo = new THREE.BufferGeometry(); snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPos, 3));
    var snowM = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 3.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false })); snowM.frustumCulled = false; snowM.visible = false; scene.add(snowM);

    /* --- awan: kumpulan sprite lembut yang melayang pelan mengikuti pemain (tanpa batas) --- */
    var CL_N = 16, CL_AREA = 2600, CL_Y = 300, clouds = [], cli, clj;
    var clCv = document.createElement("canvas"); clCv.width = clCv.height = 128;
    var clG = clCv.getContext("2d"), clGr = clG.createRadialGradient(64, 64, 4, 64, 64, 62);
    clGr.addColorStop(0, "rgba(255,255,255,1)"); clGr.addColorStop(.45, "rgba(255,255,255,.55)"); clGr.addColorStop(1, "rgba(255,255,255,0)");
    clG.fillStyle = clGr; clG.fillRect(0, 0, 128, 128);
    var clTex = new THREE.CanvasTexture(clCv);
    for (cli = 0; cli < CL_N; cli++) {
      var cg0 = new THREE.Group(), cmat = new THREE.SpriteMaterial({ map: clTex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false });
      var cs = .8 + Math.random() * .9;
      for (clj = 0; clj < 7; clj++) {
        var spr = new THREE.Sprite(cmat), ang = Math.random() * 6.283, rr = Math.random() * 120 * cs;
        spr.position.set(Math.cos(ang) * rr * 1.4, (Math.random() - .5) * 18, Math.sin(ang) * rr);
        var ss2 = (150 + Math.random() * 110) * cs; spr.scale.set(ss2, ss2 * .6, 1);
        cg0.add(spr);
      }
      cg0.frustumCulled = false; cg0.visible = false; scene.add(cg0);
      clouds.push({ g: cg0, m: cmat, bx: Math.random() * CL_AREA, bz: Math.random() * CL_AREA, y: CL_Y + (Math.random() - .5) * 70, sp: 6 + Math.random() * 8 });
    }
    var clTmp = new THREE.Color(), clGray = new THREE.Color(0x6e7680), clNight = new THREE.Color(0x1b2233), clGlow = new THREE.Color(0xffc9a0);

    /* --- ukuran layar --- */
    function resize(w, h, d) {
      vw = w; vh = h; dpr = d;
      gl.setPixelRatio(dpr); gl.setSize(vw, vh, false); camera.aspect = vw / vh; camera.updateProjectionMatrix();
    }

    var pv = new THREE.Vector3();
    function scr(x, y, z) { pv.set(x, y, z).project(camera); return pv.z < 1 ? { x: (pv.x * .5 + .5) * vw, y: (-pv.y * .5 + .5) * vh } : null; }

    var C = { dayZ: new THREE.Color(0x3f86cc), dayH: new THREE.Color(0xbfe2f2), ngZ: new THREE.Color(0x01020a), ngH: new THREE.Color(0x0a1224), glow: new THREE.Color(0xff9a52), stZ: new THREE.Color(0x353c44), stH: new THREE.Color(0x5d666e), tmp: new THREE.Color(), tmp2: new THREE.Color(), sunW: new THREE.Color(0xfff4dc), sunO: new THREE.Color(0xff9a50), moon: new THREE.Color(0x8aa4ff) };
    C.wZ = new THREE.Color(0x9fb4c8); C.wH = new THREE.Color(0xdfe9f0); C.ice = new THREE.Color(0xcfe6f2);
    var skyZ = new THREE.Color(), skyH = new THREE.Color(), camT = new THREE.Vector3(SPAWN.x, 20, SPAWN.y), tmpV = new THREE.Vector3(), frame = 0, bright = 1;

    /* =====================================================================
       lingkungan: waktu, cuaca, bencana.  E = keadaan bersama, P = pemain (hanya dibaca),
       hk.hurt(dmg, ax, ay, down) dan hk.cricket() = panggilan balik ke main.js
       ===================================================================== */
    function update(dt, E, P, hk) {
      var i, t0;
      // waktu, cuaca
      E.tod = (E.tod + dt * (E.tod < .6 ? .6 / DAY_SEC : .4 / NIGHT_SEC)) % 1; t0 = E.tod; // siang (tod 0..0.6) = 3 menit, malam (tod 0.6..1) = 3 menit
      E.dark = t0 < .6 ? 0 : t0 < .7 ? (t0 - .6) / .1 : t0 < .9 ? 1 : 1 - (t0 - .9) / .1;
      if (E.dark > .5 && !E.nt) { E.nt = 1; E.msg = "Malam tiba. Hati-hati, harimau lebih berani!"; E.mt = 5; }
      else if (E.dark < .2 && E.nt) { E.nt = 0; E.msg = "Fajar menyingsing."; E.mt = 4; }
      if (E.dark > .4) { E.ct = (E.ct || 0) - dt; if (E.ct <= 0) { hk.cricket(); E.ct = .4 + R() * 1.2; } }
      // cuaca: HANYA hujan, muncul & berhenti secara acak (lama dan derasnya juga acak)
      E.rainT -= dt;
      if (E.rainT <= 0) {
        E.raining = !E.raining;
        if (E.raining) { E.rainT = rnd(8, 25); E.rk = rnd(.35, 1.1); E.msg = "Hujan turun, tanah menjadi licin."; }
        else { E.rainT = rnd(20, 150); E.msg = "Hujan reda."; }
        E.mt = 4;
      }
      E.rain += ((E.sto > .5 ? 1.25 : E.raining ? (E.rk || .75) : 0) - E.rain) * Math.min(1, dt * .5);
      E.wOn = false; E.winter = 0; // salju / musim dingin dimatikan
      // ---- bencana ---- (DINONAKTIFKAN: banjir bandang tidak muncul lagi)
      E.dis = null; E.disT = 1e9;
      if (!E.dis) {
        E.disT -= dt;
        if (E.disT <= 0) {
          var tp = "banjir"; /* gempa & badai petir dinonaktifkan: hanya banjir yang tersisa */ E.dis = { type: tp, on: false, t: 7 };
          E.msg = { gempa: "⚠ Tanah mulai bergetar… GEMPA akan terjadi!", badai: "⚠ Langit menghitam… BADAI PETIR mendekat!", banjir: "⚠ Suara air menderu… BANJIR BANDANG datang!" }[tp]; E.mt = 6;
        }
      } else {
        E.dis.t -= dt;
        if (E.dis.t <= 0) {
          if (!E.dis.on) { E.dis.on = true; E.dis.t = rnd(22, 30); }
          else { E.msg = "Bencana mereda. Tetap waspada."; E.mt = 4; E.dis = null; E.disT = rnd(70, 120); }
        }
      }
      var dn = E.dis && E.dis.on ? E.dis.type : "", wn = E.dis && !E.dis.on ? E.dis.type : "";
      E.qk += ((dn === "gempa" ? 1 : wn === "gempa" ? .2 : 0) - E.qk) * Math.min(1, dt * 3);
      E.sto += ((dn === "badai" ? 1 : wn === "badai" ? .3 : 0) - E.sto) * Math.min(1, dt * .8);
      E.fl += ((dn === "banjir" ? 1 : 0) - E.fl) * Math.min(1, dt * .4);
      E.flash = Math.max(0, E.flash - dt * 3);
      E.rt -= dt;
      if (dn === "gempa" && E.rt <= 0) { E.rt = rnd(.3, .7); var ra = rnd(0, 6.28), rd = R() < .35 ? rnd(20, 90) : rnd(60, 300); E.rocks.push({ x: P.x + Math.cos(ra) * rd, y: P.y + Math.sin(ra) * rd, t: 1.1 }); }
      for (i = E.rocks.length - 1; i >= 0; i--) {
        var rk = E.rocks[i]; rk.t -= dt;
        if (rk.t <= 0) { E.scars.push({ x: rk.x, y: rk.y, t: 10, k: 1 }); if (P.z < 8 && Math.hypot(P.x - rk.x, P.y - rk.y) < 26) hk.hurt(24, P.x - rk.x, P.y - rk.y, .9); E.rocks.splice(i, 1); }
      }
      E.lt -= dt;
      if (dn === "badai" && E.lt <= 0) {
        E.lt = rnd(1.6, 3.8); var tx, ty, nt = null, nd = 280;
        if (R() < .5) trees.forEach(function (t) { var dd = Math.hypot(t.x - P.x, t.y - P.y); if (dd < nd) { nd = dd; nt = t; } });
        if (nt) { tx = nt.x; ty = nt.y; } else { var la = rnd(0, 6.28), ld = rnd(40, 280); tx = P.x + Math.cos(la) * ld; ty = P.y + Math.sin(la) * ld; }
        E.bolts.push({ x: tx, y: ty, t: 1 });
      }
      for (i = E.bolts.length - 1; i >= 0; i--) {
        var bo = E.bolts[i]; bo.t -= dt;
        if (bo.t <= 0) { E.flash = 1; E.strikes.push({ x: bo.x, y: bo.y, t: .25 }); E.scars.push({ x: bo.x, y: bo.y, t: 14, k: 0 }); if (Math.hypot(P.x - bo.x, P.y - bo.y) < 38) hk.hurt(30, P.x - bo.x, P.y - bo.y, 1.6); E.bolts.splice(i, 1); }
      }
      for (i = E.strikes.length - 1; i >= 0; i--) { E.strikes[i].t -= dt; if (E.strikes[i].t <= 0) E.strikes.splice(i, 1); }
      for (i = E.scars.length - 1; i >= 0; i--) { E.scars[i].t -= dt; if (E.scars[i].t <= 0) E.scars.splice(i, 1); }
    }

    /* =====================================================================
       render 3D, bagian 1: langit, cahaya, air  (menghitung world.WL = tinggi air, world.swimY)
       ===================================================================== */
    function begin(dt, now, E, P) {
      var tod = E.tod, dark = E.dark, sto = E.sto, rain = E.rain, i, j, k, gy = groundY(P.x, P.y), WL = E.fl * 6 + Math.sin(now / 700) * .35, p, it;
      // ---- langit & kabut ----
      var dusk = tod > .52 && tod < .7 ? 1 - Math.abs(tod - .61) / .09 : 0, dawn = tod < .12 ? 1 - tod / .12 : tod > .9 ? (tod - .9) / .1 : 0, gl2 = Math.max(dusk, dawn);
      skyZ.copy(C.dayZ).lerp(C.ngZ, dark); skyH.copy(C.dayH).lerp(C.ngH, dark);
      skyH.lerp(C.glow, gl2 * .75 * (1 - dark * .4)); skyZ.lerp(C.glow, gl2 * .15);
      var gr = Math.max(sto * .85, rain * .5);
      if (gr > 0) { skyZ.lerp(C.tmp.copy(C.stZ).multiplyScalar(1 - dark * .9), gr); skyH.lerp(C.tmp2.copy(C.stH).multiplyScalar(1 - dark * .9), gr); }
      if (E.winter > .01) { skyZ.lerp(C.tmp.copy(C.wZ).multiplyScalar(1 - dark * .9), E.winter * .55); skyH.lerp(C.tmp2.copy(C.wH).multiplyScalar(1 - dark * .9), E.winter * .7); }
      var pos = skyGeo.attributes.position, col = skyGeo.attributes.color;
      for (i = 0; i < skyN; i++) {
        var h = Math.max(0, pos.getY(i) / 5000), q = Math.pow(h, .55);
        col.setXYZ(i, skyH.r + (skyZ.r - skyH.r) * q, skyH.g + (skyZ.g - skyH.g) * q, skyH.b + (skyZ.b - skyH.b) * q);
      }
      col.needsUpdate = true;
      scene.background.copy(skyH); scene.fog.color.copy(skyH);
      scene.fog.near = 140; scene.fog.far = Math.max(520, 1000 - 380 * Math.max(dark * .6, sto * .7) - 220 * rain - 160 * E.winter);
      // ---- matahari / bulan / cahaya ----
      var ma = Math.PI * Math.min(1, tod / .6), sunY = tod < .6 ? Math.sin(ma) : 0, sunI = Math.min(1, sunY * 2.6);
      var m2 = Math.PI * Math.max(0, Math.min(1, (tod - .6) / .4));
      if (tod < .6) { tmpV.set(Math.cos(ma), .1 + .9 * Math.sin(ma), .55 * Math.sin(ma)).normalize(); sunM.position.copy(camera.position).addScaledVector(tmpV, 3300); sunM.visible = true; moonM.visible = false; dl.color.copy(C.sunO).lerp(C.sunW, Math.min(1, sunY * 3)); dl.intensity = .95 * sunI * (1 - .75 * sto) * (1 - .35 * rain); }
      else { tmpV.set(Math.cos(m2), .22 + .78 * Math.sin(m2), .4 * Math.sin(m2)).normalize(); moonM.position.copy(camera.position).addScaledVector(tmpV, 3300); moonM.visible = true; sunM.visible = false; dl.color.copy(C.moon); dl.intensity = .4 * dark * (1 - .5 * sto); }
      if (tmpV.y < .18) tmpV.y = .18;
      dl.target.position.set(P.x, gy, P.y); dl.position.set(P.x + tmpV.x * 800, gy + tmpV.y * 800, P.y + tmpV.z * 800);
      hemi.color.copy(skyZ).lerp(C.dayH, .35); hemi.groundColor.setRGB(.23 * (1 - dark * .85), .29 * (1 - dark * .85), .16 * (1 - dark * .8));
      hemi.groundColor.lerp(C.wH, E.winter * .6); hemi.intensity = (.2 + .42 * (1 - dark)) * (1 - .3 * sto) + E.flash * 1.6;
      stars.material.opacity = Math.max(0, dark - .2) * 1.2 * (1 - sto) * (1 - rain * .5); stars.position.copy(camera.position); sky.position.copy(camera.position);
      // ---- awan ----
      clTmp.setRGB(1, 1, 1).lerp(clGray, Math.min(1, Math.max(sto * .9, rain * .7))).lerp(clNight, dark * .85).lerp(clGlow, gl2 * .45 * (1 - dark));
      for (i = 0; i < clouds.length; i++) {
        var cl = clouds[i], half = CL_AREA / 2;
        var cx = P.x + ((((cl.bx + now / 1000 * cl.sp - P.x + half) % CL_AREA) + CL_AREA) % CL_AREA) - half;
        var cz = P.y + ((((cl.bz + now / 1000 * cl.sp * .35 - P.y + half) % CL_AREA) + CL_AREA) % CL_AREA) - half;
        cl.g.position.set(cx, cl.y, cz);
        var dEdge = Math.min(1, Math.hypot(cx - P.x, cz - P.y) / half), edgeF = 1 - Math.min(1, Math.max(0, (dEdge - .7) / .3));
        var dCam = cl.g.position.distanceTo(camera.position), nearF = Math.min(1, Math.max(0, (dCam - 90) / 260));
        cl.m.opacity = .85 * edgeF * nearF * (1 - .15 * E.winter);
        cl.m.color.copy(clTmp);
        cl.g.visible = cl.m.opacity > .02;
      }
      // ---- air ----
      waterM.position.y = WL; wtex.offset.x = (now / 24000) % 1; wtex.offset.y = (now / 31000) % 1;
      waterM.material.color.setRGB(.54 * (1 - dark * .7), .39 * (1 - dark * .6), .21 * (1 - dark * .5)); // warna air bandang (cokelat keruh)
      waterM.material.color.lerp(C.ice, E.winter * .55 * (1 - dark * .6)); waterM.material.opacity = .76 + .14 * E.winter;
      var swimY = Math.max(gy, WL - 13) + Math.sin(now / 300) * .8;
      applyWinter(E.winter);
      world.WL = WL; world.swimY = swimY;
    }

    /* =====================================================================
       render 3D, bagian 2: efek bencana, hujan, kunang-kunang, kamera, lalu gambar ke layar
       ===================================================================== */
    function finish(dt, now, E, P) {
      var i, j, it, gy = groundY(P.x, P.y), dark = E.dark, sto = E.sto, rain = E.rain * (1 - E.winter), WL = world.WL, swimY = world.swimY;
      var camYaw = cam.yaw, camPitch = cam.pitch, camDist = cam.dist;
      // ---- bekas hantaman, peringatan ----
      poolScar.begin(); E.scars.forEach(function (s) { var d = poolScar.get(), al = Math.min(1, s.t / 4); d.position.set(s.x, groundY(s.x, s.y) + .6, s.y); d.scale.set(s.k ? 15 : 18, 1, s.k ? 12 : 15); d.material.color.setHex(s.k ? 0x2a1e14 : 0x0a0806); d.material.opacity = (s.k ? .5 : .65) * al; }); poolScar.end();
      poolWarn.begin();
      E.rocks.forEach(function (r) { var d = poolWarn.get(), kk = Math.max(0, r.t) / 1.1; d.position.set(r.x, groundY(r.x, r.y) + .8, r.y); d.scale.set(26, 1, 26); d.material.color.setHex(0xff5028); d.material.opacity = .6 * (1 - kk); });
      E.bolts.forEach(function (b) { var d = poolWarn.get(), pl = .5 + .5 * Math.sin(now * .02); d.position.set(b.x, groundY(b.x, b.y) + .8, b.y); d.scale.set(34, 1, 34); d.material.color.setHex(0xfff078); d.material.opacity = .35 + .45 * pl; });
      if (E.fl > .3 && flood(P.x, P.y)) { it = poolWarn.get(); it.position.set(P.x, WL + .6, P.y); it.scale.set(14 + Math.sin(now / 150) * 2, 1, 14 + Math.sin(now / 150) * 2); it.material.color.setHex(0xdcf0ff); it.material.opacity = .7; }
      poolWarn.end();
      // ---- batu jatuh, petir ----
      poolRock.begin(); E.rocks.forEach(function (r) { var d = poolRock.get(); d.position.set(r.x, groundY(r.x, r.y) + 10 + Math.max(0, r.t) * 300, r.y); d.rotation.set(now / 300, now / 200, 0); }); poolRock.end();
      poolStrike.begin();
      E.strikes.forEach(function (s) {
        var g = poolStrike.get(), sg = groundY(s.x, s.y), prev = null, n = 11;
        for (j = 0; j <= n; j++) {
          var yy2 = sg + 520 * (1 - j / n), xx = j === n ? s.x : s.x + (Math.random() - .5) * 52, zz = j === n ? s.y : s.y + (Math.random() - .5) * 52;
          if (prev) { var seg = g.children[j - 1]; seg.position.set((xx + prev[0]) / 2, (yy2 + prev[1]) / 2, (zz + prev[2]) / 2); seg.lookAt(tmpV.set(xx, yy2, zz)); seg.scale.set(2.6, 2.6, Math.hypot(xx - prev[0], yy2 - prev[1], zz - prev[2])); }
          prev = [xx, yy2, zz];
        }
      });
      poolStrike.end();
      // ---- hujan ----
      if (rain > .05) {
        rainM.visible = true; rainM.material.opacity = .5 * Math.min(1, rain);
        for (i = 0; i < NR; i++) {
          var ro = rainOff[i]; ro[1] -= 650 * dt; if (ro[1] < 0) ro[1] += 460;
          var rx = P.x + ro[0], rz = P.y + ro[2], ry = gy + ro[1], o = i * 6;
          rainPos[o] = rx; rainPos[o + 1] = ry; rainPos[o + 2] = rz; rainPos[o + 3] = rx - 2; rainPos[o + 4] = ry + 11; rainPos[o + 5] = rz - 1;
        }
        rainGeo.attributes.position.needsUpdate = true;
      } else rainM.visible = false;
      // ---- kunang-kunang ----
      if (dark > .3 && sto < .5) {
        ffM.visible = true; ffM.material.opacity = .8 * dark;
        for (i = 0; i < NF; i++) { var fx = P.x + Math.sin(now / 1900 + i * 7.1) * 260 + Math.cos(i * 3.3) * 120, fz = P.y + Math.cos(now / 2300 + i * 4.7) * 260 + Math.sin(i * 5.1) * 120; ffPos[i * 3] = fx; ffPos[i * 3 + 1] = groundY(fx, fz) + 14 + Math.sin(now / 700 + i) * 8; ffPos[i * 3 + 2] = fz; }
        ffGeo.attributes.position.needsUpdate = true;
      } else ffM.visible = false;
      // ---- salju ----
      var sn = E.winter * (.45 + .55 * Math.min(1, E.rain));
      if (sn > .05) {
        snowM.visible = true; snowM.material.opacity = Math.min(.95, sn * 1.1);
        for (i = 0; i < NS; i++) {
          var so = snowOff[i]; so[1] -= (45 + (i % 5) * 10) * dt; if (so[1] < 0) so[1] += 460;
          snowPos[i * 3] = P.x + so[0] + Math.sin(now / 1300 + so[3]) * 14; snowPos[i * 3 + 1] = gy + so[1]; snowPos[i * 3 + 2] = P.y + so[2] + Math.cos(now / 1700 + so[3]) * 14;
        }
        snowGeo.attributes.position.needsUpdate = true;
      } else snowM.visible = false;
      // ---- kamera ----
      var ty = (P.sw ? swimY : gy + P.z * .6) + 16, k2 = Math.min(1, dt * 9);
      camT.x += (P.x - camT.x) * k2; camT.z += (P.y - camT.z) * k2; camT.y += (ty - camT.y) * Math.min(1, dt * 5);
      var cpf = Math.cos(camPitch), shk = E.qk * 3;
      camera.position.set(camT.x + Math.sin(camYaw) * cpf * camDist + (Math.random() - .5) * shk, camT.y + Math.sin(camPitch) * camDist + (Math.random() - .5) * shk, camT.z + Math.cos(camYaw) * cpf * camDist + (Math.random() - .5) * shk);
      var cg = groundY(camera.position.x, camera.position.z) + 14; if (camera.position.y < cg) camera.position.y = cg;
      camera.lookAt(camT.x, camT.y, camT.z); camera.updateMatrixWorld();
      // titik "memudar" pohon di sekitar karakter
      tmpV.set(P.x, (P.sw ? swimY : gy + P.z) + 18, P.y).applyMatrix4(camera.matrixWorldInverse); var vz = -tmpV.z;
      tmpV.set(P.x, (P.sw ? swimY : gy + P.z) + 18, P.y).project(camera);
      cutU.uP.value.set((tmpV.x * .5 + .5) * vw * dpr, (tmpV.y * .5 + .5) * vh * dpr, vz, vh * .12 * dpr * (430 / camDist < .5 ? .5 : Math.min(1.6, 430 / camDist)));
      gl.render(scene, camera);
    }

    var world = {
      gl: gl, scene: scene, camera: camera, cam: cam,
      BOX: BOX, SPH: SPH, CYL: CYL, CONE: CONE, M: M, mesh: mesh, bx: bx, sp: sp, cutout: cutout,
      Pool: Pool, decal: decal, ring: ring, scr: scr,
      resize: resize, update: update, begin: begin, finish: finish,
      WL: 0, swimY: 0
    };
    try { oceanAttach(world); } catch (e) { console.error("lautan gagal dipasang:", e); }
    return world;
  }

  /* =====================================================================
     LAUTAN LUAS & OMBAK  (dulu ocean.js, kini menyatu di map.js)
     - Lautan mengelilingi dunia sampai cakrawala, ombak 6 lapis + riak, buih, kilau matahari.
     - Mengikuti siang/malam & cuaca lewat warna kabut/langit dan DirectionalLight.
     Opsional: set window.OceanConfig sebelum memuat map.js, mis. { amp: 1.4, radius: 30000 }.
     Setelah dunia dibuat: world.ocean.setAmp(1.5) / world.ocean.setVisible(false).
     ===================================================================== */
  var oceanUser = window.OceanConfig || {};
  var OCFG = {
    radius: oceanUser.radius || 60000,   // jari-jari lautan (satuan dunia)
    farMin: oceanUser.farMin || 70000,   // jarak pandang kamera minimal agar cakrawala terlihat
    amp: oceanUser.amp != null ? oceanUser.amp : 1.0, // pengali tinggi ombak
    drop: oceanUser.drop != null ? oceanUser.drop : 0.6, // lautan sedikit di bawah permukaan air bawaan
    overlap: oceanUser.overlap != null ? oceanUser.overlap : 24, // tumpang tindih ke dalam tepi dunia
    rings: 170, seg: 192
  };


  /* ---------- GLSL ---------- */
  var OCEAN_COMMON = [
    "uniform float uTime; uniform float uWorld; uniform float uOverlap; uniform float uAmp;",
    "const float ASUM = 15.75;",
    // satu gelombang: puncak runcing exp(sin-1). xyz = tinggi, gradien x, gradien z. sp = jarak antar-titik mesh (meredam gelombang kecil)
    "vec3 wv(vec2 p, float t, float ang, float len, float amp, float sp) {",
    "  vec2 d = vec2(cos(ang), sin(ang));",
    "  float k = 6.28318 / len;",
    "  float w = sqrt(60.0 * k);",
    "  float ph = k * dot(d, p) - w * t;",
    "  float fade = 1.0 - smoothstep(0.35, 0.9, sp * 5.0 / len);",
    "  float e = amp * exp(sin(ph) - 1.0) * fade;",
    "  float c = cos(ph);",
    "  return vec3(e - amp * 0.466 * fade, e * c * k * d.x, e * c * k * d.y);",
    "}",
    // 6 gelombang dari arah berbeda + pelengkungan pola supaya ombak tidak terlihat seperti kisi-kisi
    "vec3 waves(vec2 p, float t, float sp) {",
    "  p += vec2(sin(p.y * 0.0117 + t * 0.21), cos(p.x * 0.0131 - t * 0.17)) * 16.0;",
    "  return wv(p, t,  0.55, 520.0, 7.0,  sp)",
    "       + wv(p, t,  0.15, 310.0, 4.0,  sp)",
    "       + wv(p, t,  1.10, 190.0, 2.4,  sp)",
    "       + wv(p, t, -0.35, 120.0, 1.3,  sp)",
    "       + wv(p, t,  0.85,  70.0, 0.7,  sp)",
    "       + wv(p, t, -0.90,  42.0, 0.35, sp);",
    "}",
    // jarak bertanda ke tepi dunia (negatif = di dalam dunia)
    "float outDist(vec2 p) {",
    "  vec2 q = abs(p - vec2(uWorld * 0.5)) - vec2(uWorld * 0.5 - uOverlap);",
    "  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);",
    "}",
    "float ampF(float d) {",
    "  return smoothstep(0.0, 400.0, d) * (0.3 + 0.7 * smoothstep(200.0, 3500.0, d)) * uAmp;",
    "}"
  ].join("\n");

  var OCEAN_VERT = OCEAN_COMMON + "\n" + [
    "uniform vec2 uCenter; uniform float uLevel;",
    "varying vec3 vPos;",
    "void main() {",
    "  vec2 p = position.xz + uCenter;",
    "  float sp = length(position.xz) * 0.046 + 0.5;",
    "  float a = ampF(outDist(p));",
    "  float h = waves(p, uTime, sp).x * a;",
    "  vPos = vec3(p.x, uLevel + h, p.y);",
    "  gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);",
    "}"
  ].join("\n");

  var OCEAN_FRAG = OCEAN_COMMON + "\n" + [
    "uniform float uLevel; uniform float uFogDist; uniform float uDay;",
    "uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uSunDir; uniform vec3 uSunCol;",
    "varying vec3 vPos;",
    "vec2 rip(vec2 p, float t, float ang, float len, float slope) {",
    "  vec2 d = vec2(cos(ang), sin(ang));",
    "  float k = 6.28318 / len;",
    "  float w = sqrt(60.0 * k);",
    "  return slope * cos(k * dot(d, p) - w * t) * d;",
    "}",
    // noise nilai + fbm untuk buih berenda dan tekstur riak halus
    "float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
    "float vn(vec2 p) {",
    "  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), f.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), f.x), f.y);",
    "}",
    "float fbm(vec2 p) {",
    "  float s = 0.0, a = 0.5;",
    "  for (int i = 0; i < 3; i++) { s += a * vn(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; }",
    "  return s / 0.875;",
    "}",
    "void main() {",
    "  vec2 p = vPos.xz;",
    "  float dOut = outDist(p);",
    "  if (dOut <= 0.0) discard;",
    "  float a = ampF(dOut);",
    "  vec3 w = waves(p, uTime, 0.0);",
    "  vec2 g = w.yz * a;",
    "  vec3 toCam = cameraPosition - vPos;",
    "  float dist = length(toCam);",
    "  vec3 V = toCam / max(dist, 0.001);",
    "  float nearK = 1.0 - smoothstep(250.0, 2600.0, dist);",
    // riak halus berlapis (5 arah) + detail noise bergerak, memudar di kejauhan agar tidak berkilap-kilap
    "  float rf = mix(0.45, 1.0, clamp(a, 0.0, 1.0)) * (0.25 + 0.75 * nearK);",
    "  g += rf * (rip(p, uTime, 2.0, 28.0, 0.09) + rip(p, uTime, -1.2, 17.0, 0.07) + rip(p, uTime, 0.4, 11.0, 0.05)",
    "           + rip(p, uTime, 1.4, 7.0, 0.035) + rip(p, uTime, -2.3, 4.5, 0.025));",
    "  vec2 q = p * 0.07 + vec2(uTime * 0.05, -uTime * 0.04);",
    "  vec2 dn = vec2(fbm(q + vec2(0.6, 0.0)) - fbm(q - vec2(0.6, 0.0)), fbm(q + vec2(0.0, 0.6)) - fbm(q - vec2(0.0, 0.6)));",
    "  g += dn * 0.28 * nearK;",
    "  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));",
    "  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), clamp(dist / 9000.0, 0.0, 0.85)));",
    "  float ndv = max(dot(N, V), 0.0);",
    "  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);",
    "  vec3 R = reflect(-V, N);",
    "  vec3 L = normalize(uSunDir);",
    "  vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.5));",
    // tinggi relatif puncak (rata-rata 0, maks ~0.5)
    "  float crest = w.x / ASUM;",
    "  float shallowK = 1.0 - smoothstep(0.0, 1500.0, dOut);",
    "  vec3 deep = vec3(0.005, 0.085, 0.19);",
    "  vec3 midc = vec3(0.02, 0.27, 0.38);",
    "  vec3 shallow = vec3(0.06, 0.52, 0.52);",
    "  float cb = clamp((crest + 0.05) / 0.5, 0.0, 1.0);",
    "  vec3 body = mix(deep, midc, clamp(cb * 0.9 + 0.1, 0.0, 1.0));",
    "  body = mix(body, shallow, clamp(shallowK * 0.85, 0.0, 1.0));",
    // hamburan cahaya di dalam air: puncak ombak yang ditembus matahari tampak toska bercahaya
    "  float sss = pow(clamp(dot(V, normalize(-L + N * 0.4)), 0.0, 1.0), 3.0) * smoothstep(0.0, 0.45, crest + 0.06) * max(L.y, 0.0);",
    "  body += vec3(0.02, 0.5, 0.42) * sss * 0.7;",
    "  body += vec3(0.0, 0.22, 0.2) * cb * cb * max(L.y, 0.0);",
    "  body *= uDay;",
    "  vec3 col = mix(body, sky, fres);",
    // kilau matahari: titik terang tajam + jalur cahaya lebar
    "  float sd = max(dot(R, L), 0.0);",
    "  col += uSunCol * (pow(sd, 500.0) * 3.0 + pow(sd, 60.0) * 0.18 + pow(sd, 8.0) * 0.03);",
    // buih: puncak ombak berenda, buih tipis yang tertinggal, garis ombak ke pantai, buih di tepi dunia
    "  float fm = fbm(p * 0.12 + vec2(uTime * 0.08, uTime * 0.05));",
    "  float fm2 = fbm(p * 0.38 - vec2(uTime * 0.10, 0.0));",
    "  float foam = smoothstep(0.13, 0.30, crest + (fm - 0.5) * 0.14) * smoothstep(0.02, 0.25, a);",
    "  foam += smoothstep(0.07, 0.20, crest + (fm2 - 0.5) * 0.16) * 0.35 * smoothstep(0.1, 0.4, a);",
    "  foam *= 0.55 + 0.9 * fm2;",
    "  float band = fract(dOut / 120.0 + uTime * 0.10);",
    "  float line = smoothstep(0.0, 0.05, band) * (1.0 - smoothstep(0.05, 0.35, band));",
    "  float shoreMask = 1.0 - smoothstep(200.0, 1100.0, dOut);",
    "  foam += line * shoreMask * (0.45 + 0.7 * fm2);",
    "  foam += (1.0 - smoothstep(0.0, 70.0, dOut)) * (0.5 + 0.5 * fm2);",
    "  foam = clamp(foam, 0.0, 1.0);",
    "  col = mix(col, vec3(0.93, 0.97, 1.0) * (0.25 + 0.75 * uDay), foam * 0.85);",
    "  float fogK = smoothstep(uFogDist * 0.15, uFogDist, dist);",
    "  col = mix(col, uHorizon, fogK);",
    "  gl_FragColor = vec4(col, 1.0);",
    "}"
  ].join("\n");


  /* ---------- geometri: cincin radial rapat di dekat kamera, renggang di kejauhan ---------- */
  function oceanGeo(THREE, R, rings, seg) {
    var r0 = 24, nv = 1 + rings * seg, pos = new Float32Array(nv * 3), i, j, r, a, idx = [];
    for (i = 0; i < rings; i++) {
      r = r0 * Math.pow(R / r0, i / (rings - 1));
      for (j = 0; j < seg; j++) {
        a = (j / seg) * Math.PI * 2;
        var o = (1 + i * seg + j) * 3;
        pos[o] = Math.cos(a) * r; pos[o + 1] = 0; pos[o + 2] = Math.sin(a) * r;
      }
    }
    for (j = 0; j < seg; j++) idx.push(0, 1 + j, 1 + (j + 1) % seg);
    for (i = 0; i < rings - 1; i++) {
      for (j = 0; j < seg; j++) {
        var A = 1 + i * seg + j, B = 1 + i * seg + (j + 1) % seg, C = 1 + (i + 1) * seg + j, D = 1 + (i + 1) * seg + (j + 1) % seg;
        idx.push(A, C, B, B, C, D);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    return g;
  }

  function oceanAttach(world) {
    var THREE = window.THREE, scene = world.scene, camera = world.camera;
    if (!THREE || !scene || !camera) throw new Error("THREE/scene/camera tidak ditemukan pada world");
    var modern = parseInt(THREE.REVISION, 10) >= 152;
    function disp(v) { return modern ? Math.pow(Math.max(v, 0), 1 / 2.2) : v; }

    var R = Math.min(OCFG.radius, OCFG.farMin * 0.9);
    var U = {
      uTime: { value: 0 }, uWorld: { value: W }, uOverlap: { value: OCFG.overlap }, uAmp: { value: OCFG.amp },
      uCenter: { value: new THREE.Vector2() }, uLevel: { value: 0 }, uFogDist: { value: R * 0.95 }, uDay: { value: 1 },
      uHorizon: { value: new THREE.Vector3(0.62, 0.78, 0.92) }, uZenith: { value: new THREE.Vector3(0.3, 0.5, 0.85) },
      uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.3).normalize() }, uSunCol: { value: new THREE.Vector3(1, 0.95, 0.8) }
    };
    var mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: OCEAN_VERT, fragmentShader: OCEAN_FRAG, side: THREE.DoubleSide });
    var mesh = new THREE.Mesh(oceanGeo(THREE, R, OCFG.rings, OCFG.seg), mat);
    mesh.frustumCulled = false; mesh.name = "lautan";
    scene.add(mesh);

    var sun = null, lastScan = -1e9, t0 = null, v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), lvl = 0;

    function update(now) {
      if (now == null) now = (window.performance ? performance.now() : Date.now());
      if (t0 === null) t0 = now;
      U.uTime.value = (now - t0) / 1000;
      U.uCenter.value.set(camera.position.x, camera.position.z);
      if (typeof world.WL === "number") lvl = world.WL;
      U.uLevel.value = lvl - OCFG.drop;
      if (camera.far < OCFG.farMin) { camera.far = OCFG.farMin; camera.updateProjectionMatrix(); }

      // warna cakrawala = warna kabut/langit saat ini (ikut siang, malam, cuaca)
      var c = scene.fog && scene.fog.color ? scene.fog.color : (scene.background && scene.background.r !== undefined ? scene.background : null);
      var hr = c ? disp(c.r) : 0.62, hg = c ? disp(c.g) : 0.78, hb = c ? disp(c.b) : 0.92;
      U.uHorizon.value.set(hr, hg, hb);
      U.uZenith.value.set(hr * 0.45, hg * 0.62, Math.min(1, hb * 0.9 + 0.05));
      U.uDay.value = Math.min(1, Math.max(0.1, (hr * 0.3 + hg * 0.59 + hb * 0.11) * 1.8));

      // arah & warna matahari dari DirectionalLight milik map.js
      if (!sun && now - lastScan > 2000) { lastScan = now; scene.traverse(function (o) { if (!sun && o.isDirectionalLight) sun = o; }); }
      if (sun) {
        sun.getWorldPosition(v1); if (sun.target) sun.target.getWorldPosition(v2); else v2.set(0, 0, 0);
        v1.sub(v2); if (v1.lengthSq() > 1e-6) U.uSunDir.value.copy(v1).normalize();
        var k = Math.min(1.5, Math.max(0.25, sun.intensity));
        U.uSunCol.value.set(disp(sun.color.r) * k, disp(sun.color.g) * k, disp(sun.color.b) * k);
      }
    }

    // dipanggil tiap frame lewat world.begin (main.js memanggilnya di awal render)
    var begin = world.begin;
    if (typeof begin === "function") {
      world.begin = function (dt, now) { var r = begin.apply(world, arguments); update(now); return r; };
    } else {
      (function loop() { update(); requestAnimationFrame(loop); })();
    }

    world.ocean = {
      mesh: mesh, uniforms: U,
      setAmp: function (v) { U.uAmp.value = v; },
      setVisible: function (b) { mesh.visible = !!b; }
    };
  }

  /* ---------- API publik peta ---------- */
  var FM = window.ForestMap = window.ForestMap || {};
  FM.worlds = worlds;
  FM.generate = generate; FM.createWorld = createWorld; FM.newEnv = newEnv;
  FM.addGenStep = function (label, fn) { extraSteps.push([label, fn]); };
  FM.getTerrain = function () { return terrain; }; FM.getTrees = function () { return trees; };
  FM.WORLD = W; FM.SPAWN = SPAWN; FM.R = R; FM.rnd = rnd;
  FM.water = water; FM.flood = flood; FM.pblock = pblock; FM.hitTree = hitTree; FM.blocked = blocked; FM.groundY = groundY; FM.dense = dense;
  FM.start = FM.start || function () { throw new Error("main.js belum dimuat. Muat main.js SETELAH map.js."); };
})();
