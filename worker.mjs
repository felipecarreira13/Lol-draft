/* EMBED_ASSETS */

const modes = ['standard', 'fearless', 'ironman'];
const names = ['ban', 'pick'];
const turns = [
  ...[0,1,0,1,0,1].map(side => [side, 0, 1]),
  ...[0,1,1,0,0,1].map(side => [side, 1, 1]),
  ...[1,0,1,0].map(side => [side, 0, 2]),
  ...[1,0,0,1].map(side => [side, 1, 2]),
].map(([side, action, phase]) => ({ side, type: names[action], phase }));
const catalog = JSON.parse(assets[3]);
const champions = new Set(catalog.champions.map(champion => champion.id));

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function issue(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

const token = () => crypto.randomUUID().replaceAll('-', '');
const cleanName = (value, fallback) => typeof value === 'string' ? value.trim().slice(0, 28) || fallback : fallback;

function restrictions(state) {
  if (state.mode === 'standard') return [];
  return state.history.flatMap(game => game.moves
    .filter(move => move.id && (state.mode === 'ironman' || move.type === 'pick'))
    .map(move => move.id));
}

function available(state, id) {
  return champions.has(id) && !state.moves.some(move => move.id === id) && !restrictions(state).includes(id);
}

function sideTeam(state, side) {
  return side === 0 ? state.blue : 3 - state.blue;
}

function clearTurn(state) {
  state.preview = null;
  state.remaining = null;
  state.deadline = null;
}

function openTurn(state, now) {
  clearTurn(state);
  state.status = state.moves.length === turns.length ? 'complete' : 'live';
  if (state.status === 'live') state.deadline = now + state.seconds * 1000;
}

function confirm(state, id, now) {
  state.moves.push({ ...turns[state.moves.length], id });
  openTurn(state, now);
}

function expire(state, now) {
  if (state.status !== 'live' || state.deadline > now) return false;
  const turn = turns[state.moves.length];
  if (state.preview) confirm(state, state.preview.id, now);
  else if (turn.type === 'ban') confirm(state, null, now);
  else {
    state.status = 'timeout';
    clearTurn(state);
  }
  return true;
}

function apply(state, role, body, now) {
  const { action, id, turn, game } = body;
  const owner = role === 'owner';
  if (!owner && role === 'spectator') issue('Este convite é apenas para assistir.', 403);
  if (action === 'join') {
    const team = Number(role);
    if (!team || body.team !== team) issue('Este convite pertence ao outro time.', 403);
    state.joined[team - 1] = true;
    return;
  }
  if (action === 'ready') {
    const team = Number(role);
    if (!team || !state.joined[team - 1]) issue('Entre como capitão para confirmar presença.', 403);
    if (state.status !== 'waiting') issue('O draft já começou.', 409);
    state.ready[team - 1] = body.ready === true;
    return;
  }
  if (action === 'preview' || action === 'confirm') {
    if (owner) issue('Picks e bans são exclusivos dos capitães.', 403);
    const current = turns[state.moves.length];
    if (!current || state.status !== 'live' || turn !== state.moves.length || game !== state.history.length) {
      issue('O turno mudou. Selecione no turno atual.', 409);
    }
    if (Number(role) !== sideTeam(state, current.side) || !state.joined[Number(role) - 1]) {
      issue('Aguarde o turno do seu time.', 403);
    }
    if (!(action === 'confirm' && current.type === 'ban' && id === null) && !available(state, id)) issue('Campeão indisponível.');
    if (action === 'confirm') confirm(state, id, now);
    else state.preview = { ...current, id };
    return;
  }
  if (!owner) issue('Ação exclusiva do dono da sala.', 403);
  switch (action) {
    case 'side':
      if (state.status !== 'waiting' || ![1, 2].includes(body.blue)) issue('Escolha o lado antes de iniciar.');
      state.blue = body.blue;
      break;
    case 'start':
      if (state.status !== 'waiting' || !state.ready.every(Boolean)) issue('Aguarde os dois capitães confirmarem.', 409);
      openTurn(state, now);
      break;
    case 'pause':
      if (state.status !== 'live') issue('O relógio já está parado.', 409);
      state.remaining = state.deadline - now;
      state.deadline = null;
      state.status = 'paused';
      break;
    case 'resume':
      if (!['paused', 'timeout'].includes(state.status)) issue('O draft não está pausado.', 409);
      state.deadline = now + (state.remaining ?? state.seconds * 1000);
      state.remaining = null;
      state.status = 'live';
      break;
    case 'undo':
      if (!state.moves.length) issue('Nenhuma ação para desfazer.', 409);
      state.moves.pop();
      openTurn(state, now);
      break;
    case 'reset':
      state.moves = [];
      state.status = 'waiting';
      state.ready = [false, false];
      clearTurn(state);
      break;
    case 'next':
      if (state.status !== 'complete' || state.history.length + 1 >= state.games) issue('Próximo jogo indisponível.', 409);
      state.history.push({ blue: state.blue, moves: state.moves });
      state.moves = [];
      state.status = 'waiting';
      state.ready = [false, false];
      clearTurn(state);
      break;
    default:
      issue('Ação desconhecida.');
  }
}

function view(row, state, role, now) {
  const preview = state.preview && Number(role) === sideTeam(state, state.preview.side)
    ? state.preview : null;
  return {
    id: row.id, role, state: { ...state, preview }, turns, locked: restrictions(state), serverNow: now,
    ...(role === 'owner' ? { links: { owner: row.owner, team1: row.team1, team2: row.team2, spectator: row.spectator } } : {}),
  };
}

async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) issue('Envie os dados da ação.');
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 4096) {
      await reader.cancel();
      issue('Dados da ação muito grandes.', 413);
    }
    text += decoder.decode(value, { stream: true });
  }
  let body;
  try { body = JSON.parse(text + decoder.decode()); } catch { issue('Dados inválidos.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) issue('Dados inválidos.');
  return body;
}

async function roomAPI(request, db, pathname) {
  const isPost = request.method === 'POST';
  if (!isPost && request.method !== 'GET') issue('Método inválido.', 405);
  if (pathname === '/api/rooms' && isPost) {
    const body = await readBody(request);
    if (!modes.includes(body.mode) || ![1, 3, 5].includes(body.games) ||
        !Number.isInteger(body.seconds) || body.seconds < 10 || body.seconds > 180 ||
        ![1, 2].includes(body.blue)) issue('Confira as configurações da sala.');
    const state = {
      teams: [cleanName(body.team1, 'Time 1'), cleanName(body.team2, 'Time 2')],
      blue: body.blue, mode: body.mode, seconds: body.seconds, games: body.games,
      moves: [], history: [], joined: [false, false], ready: [false, false], status: 'waiting',
    };
    clearTurn(state);
    const row = { id: token().slice(0, 20), owner: token(), team1: token(), team2: token(), spectator: token() };
    await db.prepare('INSERT INTO rooms (id, owner, team1, team2, spectator, state) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(row.id, row.owner, row.team1, row.team2, row.spectator, JSON.stringify(state)).run();
    return json(view(row, state, 'owner', Date.now()), 201);
  }

  const id = pathname.match(/^\/api\/rooms\/([a-f0-9]{20})$/)?.[1];
  if (!id) issue('Sala não encontrada.', 404);
  const key = request.headers.get('X-Draft-Key');
  if (!key || !/^[a-f0-9]{32}$/.test(key)) issue('Abra um convite válido para entrar na sala.', 403);
  const body = isPost ? await readBody(request) : null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const row = await db.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first();
    if (!row) issue('Sala não encontrada.', 404);
    const role = new Map([[row.owner, 'owner'], [row.team1, '1'], [row.team2, '2'], [row.spectator, 'spectator']]).get(key);
    if (!role) issue('Este convite não dá acesso à sala.', 403);
    const state = JSON.parse(row.state);
    state.ready ??= [false, false];
    const now = Date.now();
    const expired = expire(state, now);
    let error;
    if (body) {
      try { apply(state, role, body, now); }
      catch (failure) { if (!expired) throw failure; error = failure; }
    }
    if (body || expired) {
      const result = await db.prepare('UPDATE rooms SET state = ?, version = version + 1 WHERE id = ? AND version = ?')
        .bind(JSON.stringify(state), id, row.version).run();
      if (!result.meta.changes) continue;
    }
    if (error) throw error;
    return json(view(row, state, role, now));
  }
  issue('A sala foi atualizada. Tente novamente.', 409);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) {
      try { return await roomAPI(request, env.DB, pathname); }
      catch (error) {
        if (error.status) return json({ error: error.message }, error.status);
        console.error(error);
        return json({ error: 'A sala está indisponível. Tente novamente.' }, 500);
      }
    }
    const routes = { '/': 0, '/style.css': 1, '/app.js': 2, '/champions.json': 3 };
    const index = Object.hasOwn(routes, pathname) ? routes[pathname] : -1;
    if (index < 0) return new Response(null, { status: 404 });
    const types = ['text/html', 'text/css', 'application/javascript', 'application/json'];
    return new Response(assets[index], { headers: {
      'Content-Type': types[index] + '; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' https://ddragon.leagueoflegends.com data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'",
    } });
  },
};

