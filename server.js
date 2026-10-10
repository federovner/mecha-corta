// Mecha Corta 2.0 · servidor autoritativo (Node.js + Socket.IO)
// El servidor simula cada partida (reglas + IA de los bots) y los navegadores
// solo envían sus controles y dibujan lo que reciben.
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const MC = require('./public/core.js');

const PORT = process.env.PORT || 3000;
const TICK = 1 / 30;            // paso de simulación
const BETWEEN_S = 9;            // pausa entre rondas
const CROWN_S = 15;             // pantalla de coronación
const MAX_PLAYERS = 12;
const LAG_MS = +process.env.LAG_MS || 0;   // solo para pruebas: latencia artificial
const SPEED = +process.env.SPEED || 1;     // solo para pruebas: acelera la simulación

const app = express();
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));
app.get('/health', (_req, res) => res.send('ok'));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 10000, pingTimeout: 20000 });

const rooms = new Map();
const later = fn => (LAG_MS ? setTimeout(fn, LAG_MS) : fn());

// Los nombres los pone el servidor: ningún texto escrito por un jugador llega a los demás.
const HUMAN_NAMES = ['Halcón', 'Lince', 'Puma', 'Cóndor', 'Zorro', 'Nutria', 'Tejón', 'Búho', 'Coyote', 'Jaguar', 'Orca', 'Garza',
  'Tapir', 'Ibis', 'Morsa', 'Cobra', 'Gecko', 'Alce', 'Bisonte', 'Mapache', 'Delfín', 'Vicuña', 'Ocelote', 'Pingüino'];
function randomName(r) {
  const used = new Set([...r.members.values()].map(m => m.name));
  const free = HUMAN_NAMES.filter(n => !used.has(n));
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  let k = 2; while (used.has('Halcón ' + k)) k++; return 'Halcón ' + k;
}
const ROOM = 'principal'; // una única sala pública
function getRoom(code) {
  let r = rooms.get(code);
  if (!r) {
    r = { code, members: new Map(), order: [], host: null, cfg: { total: 8, diff: 'dificil', map: 0 },
      state: 'lobby', T: null, G: null, slots: null, round: 0, maps: [], seeds: [], loop: null,
      tick: 0, evBuf: [], lastGrid: '', lastPu: '', phaseT: null, gains: null };
    rooms.set(code, r);
  }
  return r;
}
const humansIn = r => r.order.map(id => r.members.get(id)).filter(Boolean);
function botName(k, r) {
  const used = new Set((r.slots || []).map(s => s.name));
  for (let i = 0; i < MC.NAMES.length; i++) {
    const n = MC.NAMES[(k + i) % MC.NAMES.length];
    if (!used.has(n)) return n;
  }
  return 'Bot ' + (k + 1);
}

// ---------- lobby ----------
function lobbyPayload(r) {
  return {
    code: r.code, state: r.state, host: r.host, cfg: r.cfg, round: r.round,
    members: humansIn(r).map(m => ({ id: m.id, name: m.name, slot: m.slot })),
  };
}
function broadcastLobby(r) { io.to(r.code).emit('lobby', lobbyPayload(r)); }
function rosterPayload(r) {
  return r.slots.map(s => ({ name: s.name, color: s.color, human: !!s.sock, prof: s.prof }));
}
function broadcastRoster(r) {
  io.to(r.code).emit('roster', { slots: rosterPayload(r), pts: r.T ? r.T.pts : {} });
  for (const m of humansIn(r)) io.to(m.id).emit('me', m.slot);
}

// ---------- tournament flow ----------
function startTournament(r) {
  const humans = humansIn(r);
  const n = Math.max(2, Math.min(MAX_PLAYERS, Math.max(r.cfg.total, humans.length)));
  r.slots = [];
  // perfiles repartidos: cada vuelta de 6 bots incluye uno de cada tipo, en orden aleatorio
  const deck = [];
  while (deck.length < n) deck.push(...MC.PROF_KEYS.slice().sort(() => Math.random() - .5));
  for (let k = 0; k < n; k++) {
    const prof = deck[k];
    r.slots.push({ name: '', color: MC.COLORS[k], prof, sock: null });
  }
  humans.forEach((m, k) => {
    if (k < n) { r.slots[k].sock = m.id; r.slots[k].name = m.name; m.slot = k; } else m.slot = -1;
  });
  r.slots.forEach((s, k) => { if (!s.sock) s.name = botName(k, r); });
  r.T = MC.newTour();
  r.maps = [0, 1, 2].map(k => (r.cfg.map + k) % MC.THEMES.length);
  r.seeds = [0, 1, 2].map(() => (Math.random() * 1e9) | 0);
  r.round = 0;
  nextRound(r);
}
function nextRound(r) {
  clearTimeout(r.phaseT);
  if (r.round >= MC.TOUR_LEN) return crown(r);
  // spectators waiting for a slot take bots before the round starts
  for (const m of humansIn(r)) if (m.slot < 0) takeBotSlot(r, m, false);
  const k = r.round++;
  r.G = MC.createGame({
    map: r.maps[k], seed: r.seeds[k], diff: r.cfg.diff, round: r.round, net: true,
    slots: r.slots.map(s => ({ name: s.name, color: s.color, human: !!s.sock, prof: s.prof })),
  });
  r.state = 'playing'; r.tick = 0; r.evBuf = []; r.lastGrid = ''; r.lastPu = ''; r.ff = 1;
  for (const m of humansIn(r)) sendRound(r, m);
  broadcastLobby(r);
  startLoop(r);
}
function sendRound(r, m) {
  const G = r.G;
  io.to(m.id).emit('round', {
    round: r.round, total: MC.TOUR_LEN, map: G.map, seed: G.seed, me: m.slot,
    slots: rosterPayload(r), grid: gridStr(G), pu: puStr(G), t: G.time, pts: r.T.pts,
  });
}
function endOfRound(r) {
  stopLoop(r);
  const G = r.G;
  const gain = MC.scoreRound(r.T, G);
  r.state = 'between';
  const last = r.round >= MC.TOUR_LEN;
  io.to(r.code).emit('results', {
    round: r.round, last, next: BETWEEN_S, result: G.result, gain, map: G.map, time: G.time,
    players: G.players.map(p => ({ id: p.id, kills: p.kills, deaths: p.deaths })),
    T: r.T, slots: rosterPayload(r),
  });
  broadcastLobby(r);
  r.phaseT = setTimeout(() => nextRound(r), BETWEEN_S * 1000);
}
function crown(r) {
  r.state = 'crown';
  io.to(r.code).emit('crown', { T: r.T, slots: rosterPayload(r), next: CROWN_S });
  broadcastLobby(r);
  r.phaseT = setTimeout(() => toLobby(r), CROWN_S * 1000);
}
function toLobby(r) {
  clearTimeout(r.phaseT); stopLoop(r);
  r.state = 'lobby'; r.G = null; r.slots = null; r.T = null; r.round = 0;
  for (const m of humansIn(r)) m.slot = -1;
  broadcastLobby(r);
}

// ---------- seats ----------
function takeBotSlot(r, m, live) {
  if (!r.slots) return false;
  let best = -1, bs = -1e9;
  r.slots.forEach((s, k) => {
    if (s.sock) return;
    let score = 0;
    if (live && r.G) { const p = r.G.players[k]; score = (p.alive ? 10 : 0) + p.lives * 3 + (p.lives > 0 ? 5 : 0); }
    if (score > bs) { bs = score; best = k; }
  });
  if (best < 0) return false;
  const s = r.slots[best];
  s.sock = m.id; s.name = m.name; m.slot = best;
  if (r.G) { MC.setG(r.G); MC.setHuman(r.G.players[best], true, m.name); }
  return true;
}
function releaseSlot(r, m) {
  if (!r.slots || m.slot < 0) return;
  const k = m.slot, s = r.slots[k];
  if (s && s.sock === m.id) {
    s.sock = null; s.name = '';
    s.name = botName(k, r);
    if (r.G) { MC.setG(r.G); MC.setHuman(r.G.players[k], false, s.name); }
  }
  m.slot = -1;
}

// ---------- fast-forward (only while no human is still playing) ----------
const FF = 4;
function botsOnly(r) {
  if (!r.G || !r.slots) return false;
  return r.slots.every((s, k) => !s.sock || (!r.G.players[k].alive && r.G.players[k].lives <= 0));
}
// ---------- simulation loop ----------
function startLoop(r) {
  stopLoop(r);
  let last = process.hrtime.bigint(), acc = 0, lastSnap = 0n;
  r.loop = setInterval(() => {
    const now = process.hrtime.bigint();
    if (r.ff > 1 && !botsOnly(r)) r.ff = 1;
    const mult = SPEED * (r.ff || 1);
    acc += Number(now - last) / 1e9 * mult; last = now;
    if (acc > 0.25 * mult) acc = 0.25 * mult;
    while (acc >= TICK) {
      acc -= TICK;
      const G = r.G;
      if (!G) return;
      MC.setG(G);
      MC.step(TICK);
      if (G.ev.length) { r.evBuf.push(...G.ev); G.ev.length = 0; }
      ++r.tick;
      const t = process.hrtime.bigint();
      if (t - lastSnap >= 62000000n || G.done) { lastSnap = t; sendSnap(r); }
      if (G.done && r.state === 'playing') { endOfRound(r); return; }
    }
  }, 1000 * TICK / 2);
}
function stopLoop(r) { if (r.loop) clearInterval(r.loop); r.loop = null; }

const r3 = v => Math.round(v * 1000) / 1000;
const r2 = v => Math.round(v * 100) / 100;
function gridStr(G) { let s = ''; for (let i = 0; i < G.N; i++) s += G.grid[i]; return s; }
function puStr(G) { let s = ''; for (let i = 0; i < G.N; i++) s += G.pu[i]; return s; }
function sendSnap(r) {
  const G = r.G;
  const s = { r: r.ff || 1, bo: botsOnly(r) ? 1 : 0, t: r3(G.time), cd: r2(G.countdown), sd: G.sudden ? 1 : 0, fi: G.fallIdx, ft: r3(G.fallTimer), et: r2(G.endT), w: G.winnerId };
  const gs = gridStr(G); if (gs !== r.lastGrid) { s.g = gs; r.lastGrid = gs; }
  const us = puStr(G); if (us !== r.lastPu) { s.u = us; r.lastPu = us; }
  s.fl = []; s.br = [];
  for (let i = 0; i < G.N; i++) {
    if (G.flame[i] > 0) s.fl.push([i, Math.round(G.flame[i] * 100), G.flameOwner[i]]);
    if (G.grid[i] === 3) s.br.push([i, Math.round(G.burn[i] * 100)]);
  }
  s.b = G.bombs.map(b => [b.id, b.cx, b.cy, r3(b.x), r3(b.y), r2(b.t), b.owner, b.range, b.pierce ? 1 : 0, [...b.pass], b.slide ? 1 : 0]);
  s.d = G.drops.map(d => [d.i, r3(d.t)]);
  s.p = G.players.map(p => [p.id, r3(p.x), r3(p.y), p.face[0], p.face[1], p.moving ? 1 : 0, p.alive ? 1 : 0, r2(p.dead), p.lives,
    r2(p.invuln), p.kills, p.deaths, p.shield ? 1 : 0, p.bombsMax, p.range, p.speedLvl, p.kick ? 1 : 0, p.pierce ? 1 : 0, p.human ? 1 : 0, p.active]);
  s.a = {}; for (const k in G.inputs) s.a[k] = G.inputs[k].ack;
  s.ev = r.evBuf; r.evBuf = [];
  later(() => io.to(r.code).emit('snap', s));
}

// ---------- sockets ----------
io.on('connection', sock => {
  let room = null;
  const me = () => (room ? room.members.get(sock.id) : null);

  function leave() {
    if (!room) return;
    const r = room, m = me();
    room = null;
    sock.leave(r.code);
    if (m) { releaseSlot(r, m); r.members.delete(sock.id); r.order = r.order.filter(id => id !== sock.id); }
    if (r.host === sock.id) r.host = r.order[0] || null;
    if (!r.members.size) { stopLoop(r); clearTimeout(r.phaseT); rooms.delete(r.code); return; }
    if (r.slots) broadcastRoster(r);
    broadcastLobby(r);
  }

  sock.on('join', () => {
    leave();
    const r = getRoom(ROOM);
    const m = { id: sock.id, name: randomName(r), slot: -1 };
    r.members.set(sock.id, m); r.order.push(sock.id);
    if (!r.host) r.host = sock.id;
    room = r; sock.join(r.code);
    sock.emit('joined', { id: sock.id, name: m.name });
    if (r.state !== 'lobby' && r.slots) {
      takeBotSlot(r, m, r.state === 'playing');
      broadcastRoster(r);
      if (r.state === 'playing' && m.slot >= 0) sendRound(r, m);
      else if (r.state === 'playing') sendRound(r, m); // espectador: sin plaza libre
    }
    broadcastLobby(r);
  });

  sock.on('cfg', (c = {}) => {
    const r = room; if (!r || r.host !== sock.id || r.state !== 'lobby') return;
    if (Number.isInteger(c.total)) r.cfg.total = Math.max(2, Math.min(MAX_PLAYERS, c.total));
    if (MC.DIFFS[c.diff]) r.cfg.diff = c.diff;
    if (Number.isInteger(c.map) && c.map >= 0 && c.map < MC.THEMES.length) r.cfg.map = c.map;
    broadcastLobby(r);
  });

  sock.on('play', () => {
    const r = room; if (!r || r.state !== 'lobby') return;
    startTournament(r);
  });

  sock.on('in', arr => {
    const r = room, m = me();
    if (!r || !r.G || !m || m.slot < 0 || !Array.isArray(arr)) return;
    const p = r.G.players[m.slot];
    if (!p || !p.human) return;
    const inp = r.G.inputs[m.slot] || (r.G.inputs[m.slot] = { q: [], dir: 0, bomb: false, budget: 0, ack: 0 });
    later(() => {
      for (const e of arr.slice(0, 20)) {
        if (!Array.isArray(e)) continue;
        const seq = e[0] | 0, d = e[1] | 0, t = +e[2], b = e[3] ? 1 : 0;
        if (seq <= inp.ack || d < 0 || d > 4 || !(t > 0)) continue;
        inp.q.push([seq, d, Math.min(t, 0.05), b]);
      }
    });
  });

  sock.on('ff', () => {
    const r = room; if (!r || r.state !== 'playing' || !botsOnly(r)) return;
    r.ff = r.ff > 1 ? 1 : FF;
  });

  sock.on('leaveRoom', leave);
  sock.on('disconnect', leave);
});

server.listen(PORT, () => console.log(`Mecha Corta en http://localhost:${PORT}`));
