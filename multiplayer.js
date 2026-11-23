
/* Firebase Multiplayer untuk Hunting Animals 3D */
(function () {
  'use strict';

  var ROOT = 'https://berburu-animals-default-rtdb.asia-southeast1.firebasedatabase.app';
  var net = window.ForestMap && window.ForestMap.net;

  if (!net) {
    console.error('ForestMap.net belum tersedia. Muat file ini setelah main.js');
    return;
  }

  var active = false;
  var myId = '';
  var myName = 'Pemburu';
  var writeBusy = false;
  var pollBusy = false;
  var writeTimer = null;
  var pollTimer = null;
  var playerPath = '';
  var lastPlayers = {};
  var seenEvents = {};

  function request(path, method, body) {
    var options = {
      method: method || 'GET',
      cache: 'no-store',
      headers: {}
    };

    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    return fetch(ROOT + '/' + path + '.json', options).then(function (r) {
      if (!r.ok) throw new Error('Firebase HTTP ' + r.status);
      return r.status === 204 ? null : r.json();
    });
  }

  function safeId(id) {
    return encodeURIComponent(String(id).replace(/[.#$\[\]\/]/g, '_'));
  }

  function stopTimers() {
    if (writeTimer) clearInterval(writeTimer);
    if (pollTimer) clearInterval(pollTimer);
    writeTimer = null;
    pollTimer = null;
  }

  function disconnect() {
    var oldPath = playerPath;
    active = false;
    stopTimers();

    if (oldPath) {
      request(oldPath, 'DELETE').catch(function () {});
    }

    if (net.emit === emitEvent) net.emit = null;

    playerPath = '';
    myId = '';
  }

  function emitEvent(type, data) {
    if (!active) return;

    request('events', 'POST', {
      type: String(type || ''),
      from: myId,
      name: myName,
      data: data || {},
      time: Date.now()
    }).catch(function (e) {
      console.warn('Gagal mengirim event:', e);
    });
  }

  function writeMyState() {
    if (!active || writeBusy) return;

    var state;
    try {
      state = net.get();
    } catch (e) {
      return;
    }

    if (!state) return;

    writeBusy = true;

    request(playerPath, 'PUT', {
      id: myId,
      name: myName,
      state: state,
      updated: Date.now()
    }).catch(function (e) {
      console.warn('Gagal mengirim posisi:', e);
    }).then(function () {
      writeBusy = false;
    });
  }

  function applyPlayers(players) {
    var now = Date.now();
    players = players || {};

    var present = {};

    Object.keys(players).forEach(function (key) {
      var p = players[key];

      if (!p || !p.id || p.id === myId || !p.state) return;
      if (now - (+p.updated || 0) > 12000) return;

      present[String(p.id)] = true;

      net.upsert(
        String(p.id),
        String(p.name || 'Pemburu'),
        p.state
      );
    });

    Object.keys(lastPlayers).forEach(function (id) {
      if (!present[id]) net.remove(id);
    });

    lastPlayers = present;
  }

  function applyEvents(events) {
    if (!events) return;

    Object.keys(events).sort().forEach(function (key) {
      var ev = events[key];

      if (!ev || seenEvents[key] || ev.from === myId) return;

      seenEvents[key] = true;

      if (ev.time && Date.now() - ev.time > 120000) return;

      var data = ev.data || {};
      var from = String(ev.from || '');

      if (ev.type === 'chat' && net.chat) {
        net.chat(from, data);
      } else if (ev.type === 'fire' && net.fire) {
        net.fire(from, data);
      } else if (ev.type === 'spear' && net.spear) {
        net.spear(from, data);
      } else if (ev.type === 'admin' && net.admin) {
        net.admin(from, data);
      }
    });

    var keys = Object.keys(seenEvents);

    if (keys.length > 1500) {
      keys.slice(0, keys.length - 1000).forEach(function (key) {
        delete seenEvents[key];
      });
    }
  }

  function poll() {
    if (!active || pollBusy) return;

    pollBusy = true;

    Promise.all([
      request('players', 'GET'),
      request('events', 'GET')
    ]).then(function (values) {
      if (!active) return;

      applyPlayers(values[0]);
      applyEvents(values[1]);

    }).catch(function (e) {
      console.warn('Gagal membaca Firebase:', e);

    }).then(function () {
      pollBusy = false;
    });
  }

  function connect(info) {
    disconnect();

    myId = String(
      (info && info.id) ||
      (net.getId && net.getId()) ||
      net.myId ||
      ''
    );

    myName = String(
      (info && info.name) || 'Pemburu'
    ).slice(0, 24);

    if (!myId) {
      console.warn('ID pemain kosong.');
      return;
    }

    playerPath = 'players/' + safeId(myId);
    active = true;

    net.emit = emitEvent;

    writeMyState();
    poll();

    writeTimer = setInterval(writeMyState, 300);
    pollTimer = setInterval(poll, 900);

    console.log('Firebase multiplayer aktif:', myName);
  }

  net.onLogin = connect;
  net.onLogout = disconnect;

  if (net.myId && net.getName && net.getName()) {
    connect({
      id: net.myId,
      name: net.getName()
    });
  }

  window.addEventListener('pagehide', disconnect);
  window.addEventListener('beforeunload', disconnect);

})();
  
