import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import './build.mjs';

const { default: worker } = await import('./dist/server/index.js');
const roster = JSON.parse(readFileSync('ui/champions.json')).champions;
const sql = readFileSync('drizzle/0000_rooms.sql', 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  const DB = {
    prepare(query) {
      const statement = db.prepare(query);
      return { bind: (...args) => ({
        first: () => statement.get(...args),
        run: () => ({ meta: { changes: statement.run(...args).changes } }),
      }) };
    },
  };
  async function call(id, key, payload) {
    const url = 'https://draft.test/api/rooms' + (id ? '/' + id : '');
    const response = await worker.fetch(new Request(url, {
      method: payload ? 'POST' : 'GET',
      headers: key ? { 'X-Draft-Key': key } : {},
      body: payload ? JSON.stringify(payload) : undefined,
    }), { DB });
    return { status: response.status, data: await response.json() };
  }
  async function create(mode) {
    const result = await call(null, null, { team1: 'Aurora', team2: 'Eclipse', blue: 2, mode, games: 3, seconds: 30 });
    assert.equal(result.status, 201);
    const { id, links } = result.data;
    return {
      id, links,
      as: (role, action, extra = {}) => call(id, links[role], action ? { action, ...extra } : undefined),
      expire() {
        const state = JSON.parse(db.prepare('SELECT state FROM rooms WHERE id = ?').get(id).state);
        state.deadline = Date.now() - 1;
        db.prepare('UPDATE rooms SET state = ? WHERE id = ?').run(JSON.stringify(state), id);
      },
    };
  }
  return { create };
}

async function ready(as) {
  for (const team of [1, 2]) {
    assert.equal((await as('team' + team, 'join', { team })).status, 200);
    assert.equal((await as('team' + team, 'ready', { ready: true })).status, 200);
  }
}

for (const mode of ['standard', 'fearless', 'ironman']) test(mode + ' validates access, readiness, every draft turn and series locks', async () => {
  const { as } = await fixture().create(mode);
  assert.equal((await as('owner', 'start')).status, 409);
  assert.equal((await as('team1', 'join', { team: 2 })).status, 403);
  assert.equal((await as('team1', 'ready', { ready: true })).status, 403);
  assert.equal((await as('spectator', 'ready', { ready: true })).status, 403);
  await ready(as);
  assert.equal((await as('team1', 'ready', { ready: false })).status, 200);
  assert.equal((await as('owner', 'start')).status, 409);
  assert.equal((await as('team1', 'ready', { ready: true })).status, 200);
  let game = (await as('owner', 'start')).data;
  assert.equal(game.state.status, 'live');
  assert.equal(game.turns.map(turn => turn.side).join(''), '01010101100110101001');
  assert.equal(game.turns.map(turn => turn.type[0]).join(''), 'bbbbbbppppppbbbbpppp');
  assert.equal((await as('team1', 'preview', { id: 'Ahri', turn: 0, game: 0 })).status, 403);
  const selection = { id: 'Ahri', turn: 0, game: 0 };
  assert.equal((await as('owner', 'preview', selection)).status, 403);
  assert.equal((await as('owner', 'confirm', selection)).status, 403);
  assert.equal((await as('spectator', 'confirm', selection)).status, 403);
  const preview = await as('team2', 'preview', selection);
  assert.equal(preview.status, 200);
  assert.equal(preview.data.state.preview.id, 'Ahri');
  assert.equal((await as('owner')).data.state.preview, null);
  assert.equal((await as('team1')).data.state.preview, null);
  const viewer = (await as('spectator')).data;
  assert.equal(viewer.state.preview, null);
  assert.equal(viewer.links, undefined);
  for (const [index, turn] of game.turns.entries()) {
    const role = turn.side === 0 ? 'team2' : 'team1';
    const result = await as(role, 'confirm', { id: roster[index].id, turn: index, game: 0 });
    assert.equal(result.status, 200);
    if (index === 0) assert.equal((await as(role, 'confirm', { id: roster[1].id, turn: 0, game: 0 })).status, 409);
    game = result.data;
  }
  assert.equal(game.state.status, 'complete');
  assert.equal(game.state.moves.length, 20);
  const next = (await as('owner', 'next')).data;
  assert.deepEqual(next.state.ready, [false, false]);
  assert.equal(next.locked.length, { standard: 0, fearless: 10, ironman: 20 }[mode]);
  assert.equal((await as('owner', 'side', { blue: 1 })).data.state.blue, 1);
  await ready(as);
  await as('owner', 'start');
  assert.equal((await as('team1', 'confirm', { id: roster[6].id, turn: 0, game: 1 })).status, mode === 'standard' ? 200 : 400);
});

test('expired ban skips, pending selection is confirmed, and an expired empty pick pauses', async () => {
  const { as, expire } = await fixture().create('standard');
  await ready(as);
  await as('owner', 'start');
  expire();
  assert.equal((await as('spectator')).data.state.moves[0].id, null);
  assert.equal((await as('team1', 'preview', { id: 'Ahri', turn: 1, game: 0 })).status, 200);
  expire();
  assert.equal((await as('spectator')).data.state.moves[1].id, 'Ahri');
  const candidate = { id: null, turn: 2, game: 0 };
  const racing = await Promise.all([as('team2', 'confirm', candidate), as('team2', 'confirm', candidate)]);
  assert.deepEqual(racing.map(item => item.status).sort(), [200, 409]);
  for (let turn = 3; turn < 6; turn++) {
    const role = turn % 2 ? 'team1' : 'team2';
    assert.equal((await as(role, 'confirm', { id: null, turn, game: 0 })).status, 200);
  }
  expire();
  assert.equal((await as('spectator')).data.state.status, 'timeout');
  assert.equal((await as('owner', 'resume')).data.state.status, 'live');
  assert.equal((await as('owner', 'reset')).data.state.status, 'waiting');
});

