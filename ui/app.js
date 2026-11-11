const $ = id => document.getElementById(id);
const format = { standard: 'Padrão', fearless: 'Fearless', ironman: 'Ironman' };
const lanes = { all: 'Todas', top: 'Topo', jungle: 'Selva', mid: 'Meio', bot: 'Atirador', support: 'Suporte' };
const laneMarks = { all: '⊞', top: '◩', jungle: '♠', mid: '◇', bot: '◪', support: '✧' };
const base = 'https://ddragon.leagueoflegends.com/cdn/';
const colors = ['blue', 'red'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const normalize = value => value.normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, '');
let room = new URLSearchParams(location.search).get('sala');
let key = new URLSearchParams(location.hash.slice(1)).get('chave');
if (room && !key) {
  try { key = localStorage.getItem('draft-owner-' + room); } catch {}
  if (!key) try { key = sessionStorage.getItem('draft-key-' + room); } catch {}
}
let catalog, data, clockOffset = 0, filter = 'all', busy = false, revision = 0, polling = false;
let selected = null, currentTurn = '';
const cache = new Map();

function html(element, markup) {
  if (cache.get(element) === markup) return;
  element.innerHTML = markup;
  cache.set(element, markup);
}

function notice(message) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

const byId = id => catalog.byId.get(id);
const icon = champion => base + catalog.patch + '/img/champion/' + champion.image;
const splash = champion => base + 'img/champion/splash/' + champion.id + '_0.jpg';
const teamName = (state, side) => state.teams[(side === 0 ? state.blue : 3 - state.blue) - 1];
const canDraft = () => {
  if (!data || data.state.status !== 'live') return false;
  const side = data.turns[data.state.moves.length]?.side;
  return side !== undefined && Number(data.role) === (side === 0 ? data.state.blue : 3 - data.state.blue) &&
    data.state.joined[Number(data.role) - 1];
};

async function api(action, body, id = room, access = key) {
  const response = await fetch('/api/rooms' + (id ? '/' + id : ''), {
    method: action ? 'POST' : 'GET',
    headers: { ...(access ? { 'X-Draft-Key': access } : {}), ...(action ? { 'Content-Type': 'application/json' } : {}) },
    ...(action ? { body: JSON.stringify({ action, ...body }) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'Falha ao conectar.'), { status: response.status });
  return result;
}

function update(snapshot) {
  data = snapshot;
  clockOffset = snapshot.serverNow - Date.now();
  const turn = [snapshot.state.history.length, snapshot.state.moves.length, snapshot.state.blue].join('/');
  if (turn !== currentTurn || snapshot.state.preview?.id !== selected) selected = snapshot.state.preview?.id ?? null;
  currentTurn = turn;
  render();
}

async function action(name, extra = {}) {
  if (busy) return;
  busy = true;
  revision++;
  try {
    const state = data.state;
    update(await api(name, { turn: state.moves.length, game: state.history.length, ...extra }));
    notice('');
  } catch (error) {
    notice(error.message);
  } finally {
    busy = false;
    renderSelection();
  }
}

async function refresh() {
  if (!room || busy || polling) return;
  const before = revision;
  polling = true;
  try {
    const snapshot = await api();
    if (revision !== before) return;
    if (snapshot.role === 'owner' && location.hash) rememberOwner(room, key);
    update(snapshot);
  } catch (error) {
    if (revision !== before) return;
    if (!data) {
      notice(error.message);
      $('connection').hidden = false;
    }
    $('connection').textContent = 'Sem conexão';
    $('connection').className = 'connection offline';
  } finally {
    polling = false;
  }
}

function bansMarkup(moves, side, turn, state) {
  const bans = moves.filter(move => move.type === 'ban' && move.side === side);
  const current = turn?.type === 'ban' && turn.side === side && state.status === 'live';
  return Array.from({ length: 5 }, (_, index) => {
    const ban = bans[index];
    const champion = byId(ban?.id);
    const title = champion ? champion.name : ban ? 'Ban pulado' : 'Ban ' + (index + 1);
    return '<div class="ban ' + (champion ? 'filled' : '') + (current && index === bans.length ? ' active' : '') +
      '" title="' + escape(title) + '" aria-label="' + escape(title) + '">' +
      (champion ? '<img src="' + icon(champion) + '" alt="">' : '<span>╱</span>') + '</div>';
  }).join('');
}

function sideMarkup(state, side, turn) {
  const picks = state.moves.filter(move => move.type === 'pick' && move.side === side);
  const active = turn?.side === side && ['live','paused','timeout'].includes(state.status);
  const name = teamName(state, side);
  const teamIndex = (side === 0 ? state.blue : 3 - state.blue) - 1;
  const teamStatus = state.ready[teamIndex] ? '✓ PRONTO' : state.joined[teamIndex] ? 'CAPITÃO NA SALA' : 'AGUARDANDO CAPITÃO';
  const slots = Array.from({ length: 5 }, (_, index) => {
    const champion = byId(picks[index]?.id);
    const target = active && turn.type === 'pick' && index === picks.length;
    const number = (side === 0 ? 'B' : 'R') + (index + 1);
    return '<div class="slot ' + (champion ? 'filled' : '') + (target ? ' active' : '') + '">' +
      (champion ? '<img src="' + splash(champion) + '" alt="">' : '<i aria-hidden="true">◇</i>') +
      '<span class="slot-number">' + number + '</span><span class="slot-name">' +
      (champion ? escape(champion.name) : target ? 'Selecionando…' : 'Aguardando escolha') + '</span>' +
      (champion ? '<span class="slot-check" title="Confirmado">✓</span>' : '') + '</div>';
  }).join('');
  return '<div class="team-head"><div class="team-sigil" aria-hidden="true"><span>' + (side === 0 ? '◈' : '◆') +
    '</span></div><div class="team-info"><div class="team-side"><span></span> LADO ' + (side === 0 ? 'AZUL' : 'VERMELHO') +
    '</div><h2 title="' + escape(name) + '">' + escape(name) + '</h2><div class="team-status">' + teamStatus + '</div></div></div>' +
    '<div class="bans-title"><span>BANIMENTOS</span><span>' + state.moves.filter(move => move.type === 'ban' && move.side === side).length +
    ' / 5</span></div><div class="bans">' + bansMarkup(state.moves, side, turn, state) +
    '</div><div class="picks-title"><span>ESCOLHAS</span><span>' + picks.length + ' / 5</span></div><div class="picks">' + slots + '</div>';
}

function timerValue() {
  const state = data?.state;
  if (!state) return 0;
  if (state.status === 'live') return Math.ceil(Math.max(0, state.deadline - Date.now() - clockOffset) / 1000);
  if (state.status === 'paused') return Math.ceil(state.remaining / 1000);
  return 0;
}

function tick() {
  const clock = $('clock');
  if (!clock) return;
  const seconds = timerValue();
  clock.textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  $('timerBar').style.setProperty('--progress', (seconds / data.state.seconds * 100) + '%');
  clock.classList.toggle('urgent', seconds <= 5);
}

function phaseMarkup(state, turns, turn) {
  const labels = { waiting: 'Aguardando os times', complete: 'Draft concluído', paused: 'Draft pausado', timeout: 'Tempo esgotado' };
  const title = labels[state.status] || ('Fase de ' + (turn?.type === 'ban' ? 'banimento' : 'escolha') + ' ' + turn?.phase);
  const clock = ['live','paused','timeout'].includes(state.status);
  const subtitle = state.status === 'live' ? teamName(state, turn.side) + (turn.type === 'ban' ? ' · Banindo' : ' · Escolhendo') :
    state.status === 'waiting' ? state.ready.every(Boolean) ? 'Os dois capitães estão prontos' : 'Confirmação dos capitães' :
    state.status === 'complete' ? 'Todos os turnos foram concluídos' :
    state.status === 'timeout' ? 'O dono da sala pode retomar o turno' : 'Relógio em pausa';
  return '<div class="phase-box ' + (turn ? colors[turn.side] : '') + '"><div class="phase-title">' + title +
    '</div>' + (clock ? '<div id="clock" class="clock"></div><div class="timer-bar" id="timerBar"><span></span></div>' :
    '<div class="phase-emblem" aria-hidden="true">◇</div>') + '<div class="turn-caption">' + escape(subtitle) +
    '</div><div class="timeline" aria-label="' + state.moves.length + ' de 20 turnos concluídos">' +
    turns.map((item, index) => '<span ' + (index === state.moves.length && clock ? 'aria-current="step" ' : '') + 'title="' + (item.type === 'ban' ? 'Ban' : 'Pick') + ' ' + (item.side === 0 ? 'azul' : 'vermelho') +
      '" class="' + colors[item.side] + (item.type === 'pick' ? ' pick-tick' : '') + (index < state.moves.length ? ' done' :
      index === state.moves.length && clock ? ' current' : '') + (index && turns[index - 1].type !== item.type ? ' break' : '') +
      '"></span>').join('') + '</div></div>';
}

function heroMarkup(state) {
  if (state.status === 'waiting') {
    const team = Number(data.role);
    const bothReady = state.ready.every(Boolean);
    const button = data.role === 'owner'
      ? '<button class="button primary" data-lobby="start"' + (bothReady ? '' : ' disabled') + '>▶ Iniciar draft</button>'
      : team ? '<button class="button ' + (state.ready[team - 1] ? 'secondary' : 'primary') +
        '" data-lobby="ready">' + (state.ready[team - 1] ? 'Cancelar prontidão' : '✓ Estou pronto') + '</button>' : '';
    const cards = colors.map((color, side) => {
      const teamIndex = (side === 0 ? state.blue : 3 - state.blue) - 1;
      return '<div class="ready-card ' + color + '"><span>LADO ' + (side === 0 ? 'AZUL' : 'VERMELHO') +
        '</span><strong>' + escape(state.teams[teamIndex]) + '</strong><small class="' + (state.ready[teamIndex] ? 'is-ready' : '') +
        '">' + (state.ready[teamIndex] ? '● Pronto' : state.joined[teamIndex] ? '◉ Na sala' : '○ Aguardando capitão') + '</small></div>';
    }).join('');
    $('hero').className = 'hero lobby';
    html($('hero'), '<div class="lobby-content"><div class="eyebrow">LOBBY DO DRAFT</div><h2>Jogo ' + (state.history.length + 1) +
      '</h2><p>' + state.seconds + ' s por turno · Ordem competitiva</p><div class="ready-cards">' + cards + '</div>' + button +
      '<p class="hint">' + (bothReady ? 'O organizador pode iniciar o draft.' : 'O início é liberado quando os dois capitães estiverem prontos.') +
      '</p></div>');
    return;
  }
  const last = [...state.moves].reverse().find(move => move.id);
  const champion = byId(last?.id);
  const display = champion ?? byId('Kaisa');
  const tone = last ? colors[last.side] : 'neutral';
  const label = champion ? (last.type === 'ban' ? 'ÚLTIMO BAN CONFIRMADO' : 'ÚLTIMO PICK CONFIRMADO') : 'SUMMONER’S RIFT';
  const hero = $('hero');
  hero.className = 'hero ' + tone + (champion ? '' : ' idle');
  html(hero, '<img class="hero-image" src="' + splash(display) + '" alt="' + (champion ? escape(champion.name) : '') +
    '"><div class="hero-shade"></div><div class="hero-top"><span><i></i>' + label + '</span><span>◈</span></div>' +
    '<div class="hero-caption"><div class="hero-line"></div><h2>' + (champion ? escape(champion.name) : 'Arena de draft') +
    '</h2><p>' + (champion ? escape(champion.title) : 'As escolhas aparecem aqui durante o draft.') +
    '</p></div><span class="corner one"></span><span class="corner two"></span>');
}

function renderControls() {
  const controls = $('ownerControls');
  controls.hidden = data?.role !== 'owner';
  if (controls.hidden) return;
  const s = data.state;
  const button = (action, label, style = 'secondary') => '<button class="button ' + style + '" data-action="' + action + '">' + label + '</button>';
  const main = s.status === 'waiting' ? '' :
    s.status === 'live' ? button('pause', 'Pausar relógio') :
    ['paused','timeout'].includes(s.status) ? button('resume', '▶ Retomar', 'primary') :
    s.history.length + 1 < s.games ? button('next', 'Próximo jogo →', 'primary') : '';
  html(controls, '<div><span class="eyebrow">DONO DA SALA</span>' +
    (s.status === 'waiting' ? '<label class="side-change">Lado azul <select id="changeSide"><option value="1"' +
      (s.blue === 1 ? ' selected' : '') + '>' + escape(s.teams[0]) + '</option><option value="2"' +
      (s.blue === 2 ? ' selected' : '') + '>' + escape(s.teams[1]) + '</option></select></label>' :
      '<span class="control-label">Controles do draft</span>') +
    '</div><div class="control-actions">' + (s.moves.length ? button('undo', '↶ Desfazer') : '') +
    (s.status !== 'waiting' ? button('reset', 'Reiniciar jogo') : '') + main + '</div>');
}

function renderRoster() {
  const { state, locked } = data;
  const used = new Map(state.moves.filter(move => move.id).map(move => [move.id, move.type === 'pick' ? 'Escolhido' : 'Banido']));
  for (const id of locked) used.set(id, 'Bloqueado na série');
  const query = normalize($('search').value);
  const champions = catalog.champions.filter(champion =>
    (filter === 'all' || champion.roles.includes(filter)) &&
    (!query || normalize(champion.name).includes(query) || normalize(champion.id).includes(query)) &&
    (!$('only').checked || !used.has(champion.id)));
  $('resultCount').textContent = champions.length;
  html($('filters'), Object.entries(lanes).map(([id, name]) => '<button type="button" class="filter' + (id === filter ? ' active' : '') +
    '" data-lane="' + id + '" aria-pressed="' + (id === filter) + '"><span aria-hidden="true">' + laneMarks[id] + '</span>' + name + '</button>').join(''));
  const enabled = canDraft();
  html($('roster'), champions.map(champion => {
    const reason = used.get(champion.id);
    const roles = champion.roles.map(role => lanes[role]).join(', ');
    return '<button type="button" data-id="' + champion.id + '" class="champion' + (champion.id === selected ? ' chosen' : '') +
      (reason ? ' unavailable' : '') + '" ' + (!enabled || reason ? 'disabled ' : '') +
      'title="' + escape(champion.name + ' · ' + roles + (reason ? ' · ' + reason : '')) + '" aria-pressed="' + (champion.id === selected) +
      '"><span class="portrait"><img src="' + icon(champion) + '" alt="" loading="lazy"></span><span class="champion-name">' +
      escape(champion.name) + '</span></button>';
  }).join('') || '<p class="no-results">Nenhum campeão encontrado.</p>');
  renderSelection();
}

function renderSelection() {
  const panel = $('selection');
  const champion = byId(selected);
  panel.hidden = !canDraft();
  if (panel.hidden) return;
  const type = data.turns[data.state.moves.length]?.type;
  html(panel, '<span>' + (champion ? escape(champion.name) + ' · ' + champion.roles.map(role => lanes[role]).join(', ') :
    'Selecione um campeão para ' + (type === 'ban' ? 'banir' : 'escolher') + '.') + '</span><div>' +
    (type === 'ban' ? '<button class="button secondary" id="skipBan">Sem banimento</button>' : '') + '<button class="button primary" id="confirmPick"' +
    (!champion || busy ? ' disabled' : '') + '>' + (type === 'ban' ? 'Confirmar ban' : 'Confirmar escolha') + '</button></div>');
}

function render() {
  const { state, turns, role, locked } = data;
  const turn = turns[state.moves.length];
  const spectator = role === 'spectator';
  const captain = role === '1' || role === '2';
  $('home').hidden = true;
  $('roomContent').hidden = false;
  $('roomNav').hidden = false;
  $('crumb').textContent = spectator ? 'ESPECTADOR' : role === 'owner' ? 'DONO DA SALA' : 'CAPITÃO · ' + state.teams[Number(role) - 1];
  $('connection').className = 'connection online';
  $('connection').textContent = 'Conectado';
  $('connection').hidden = false;
  $('linksButton').hidden = role !== 'owner';
  const showCatalog = captain && state.status !== 'waiting';
  $('navCatalog').hidden = !showCatalog;
  $('catalog').hidden = !showCatalog;
  $('hero').hidden = showCatalog;
  html($('roomMeta'), '<span class="meta-chip">◈ &nbsp;' + format[state.mode] + '</span><span class="meta-chip">' +
    'Jogo ' + (state.history.length + 1) + ' / ' + state.games + '</span>');
  html($('blueSide'), sideMarkup(state, 0, turn));
  html($('redSide'), sideMarkup(state, 1, turn));
  html($('phase'), phaseMarkup(state, turns, turn));
  if (!showCatalog) heroMarkup(state);
  tick();
  renderControls();
  $('lockedBar').hidden = !locked.length;
  html($('lockedBar'), locked.length ? '<strong>Bloqueados na série</strong><div>' +
    locked.map(id => '<img src="' + icon(byId(id)) + '" alt="' + escape(byId(id).name) + '" title="' + escape(byId(id).name) + '">').join('') + '</div>' : '');
  if (showCatalog) renderRoster();
  if (captain && !state.joined[Number(role) - 1] && !$('claim').open) {
    html($('claimTeam'), '<option value="">Selecione seu time</option>' + state.teams.map((team, index) =>
      '<option value="' + (index + 1) + '">' + escape(team) + '</option>').join(''));
    $('claim').showModal();
  }
}

function roomPath(id) {
  return '/?sala=' + encodeURIComponent(id);
}

function invite(id, token) {
  return location.origin + roomPath(id) + '#chave=' + token;
}

function rememberOwner(id, token) {
  try {
    localStorage.setItem('draft-owner-' + id, token);
    localStorage.setItem('draft-last-owner-room', id);
  } catch {}
  try { sessionStorage.setItem('draft-key-' + id, token); } catch {}
  history.replaceState(null, '', roomPath(id));
}

function showHome() {
  $('home').hidden = false;
  try {
    const id = localStorage.getItem('draft-last-owner-room');
    if (id && localStorage.getItem('draft-owner-' + id)) {
      $('resumeRoom').href = roomPath(id);
      $('resumeRoom').hidden = false;
    }
  } catch {}
}

function showLinks() {
  const { state, links, id } = data;
  const rows = [['Capitão · ' + state.teams[0], links.team1], ['Capitão · ' + state.teams[1], links.team2],
    ['Espectadores', links.spectator]];
  html($('linkRows'), rows.map(([label, token], index) => '<label class="link-row">' + escape(label) + '<span><input readonly value="' +
    escape(invite(id, token)) + '" aria-label="' + escape(label) + '"><button class="button secondary" type="button" data-copy="' +
    index + '">Copiar</button></span></label>').join(''));
  $('copyStatus').textContent = '';
  $('links').showModal();
}

$('newRoom').addEventListener('click', () => $('setup').showModal());
$('linksButton').addEventListener('click', showLinks);
document.querySelectorAll('dialog .close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('claim').addEventListener('cancel', event => event.preventDefault());
for (const id of ['team1','team2']) $(id).addEventListener('input', () => {
  $('blueSelect').options[id === 'team1' ? 0 : 1].text = $(id).value.trim() || (id === 'team1' ? 'Time 1' : 'Time 2');
});
$('setupForm').addEventListener('change', event => {
  if (event.target.name === 'mode' && event.target.value !== 'standard' && $('games').value === '1') $('games').value = '3';
});
$('setupForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !catalog) return;
  busy = true;
  const form = Object.fromEntries(new FormData(event.currentTarget));
  const submit = event.submitter;
  submit.disabled = true;
  $('formError').hidden = true;
  try {
    const snapshot = await api('create', { ...form, blue: Number(form.blue), games: Number(form.games), seconds: Number(form.seconds) }, null, null);
    room = snapshot.id;
    key = snapshot.links.owner;
    rememberOwner(room, key);
    $('setup').close();
    update(snapshot);
    showLinks();
  } catch (error) {
    $('formError').textContent = error.message;
    $('formError').hidden = false;
  } finally {
    submit.disabled = false;
    busy = false;
  }
});
$('claimForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  revision++;
  $('claimError').hidden = true;
  try {
    update(await api('join', { team: Number($('claimTeam').value) }));
    $('claim').close();
  } catch (error) {
    $('claimError').textContent = error.message;
    $('claimError').hidden = false;
  } finally {
    busy = false;
  }
});
$('links').addEventListener('click', async event => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  const input = button.previousElementSibling;
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(input.value);
    else {
      input.select();
      if (!document.execCommand('copy')) throw new Error();
    }
    $('copyStatus').textContent = 'Link copiado.';
  } catch {
    input.select();
    $('copyStatus').textContent = 'Link selecionado. Use Ctrl+C para copiar.';
  }
});
$('hero').addEventListener('click', event => {
  const name = event.target.closest('[data-lobby]')?.dataset.lobby;
  if (name === 'start') action('start');
  if (name === 'ready') action('ready', { ready: !data.state.ready[Number(data.role) - 1] });
});
$('ownerControls').addEventListener('change', event => {
  if (event.target.id === 'changeSide') action('side', { blue: Number(event.target.value) });
});
$('ownerControls').addEventListener('click', event => {
  const name = event.target.closest('[data-action]')?.dataset.action;
  if (!name || (name === 'reset' && !confirm('Reiniciar as escolhas e banimentos deste jogo?'))) return;
  action(name);
});
$('filters').addEventListener('click', event => {
  const id = event.target.closest('[data-lane]')?.dataset.lane;
  if (id) { filter = id; renderRoster(); $('filters').querySelector('[data-lane="' + id + '"]').focus(); }
});
$('search').addEventListener('input', renderRoster);
$('only').addEventListener('change', renderRoster);
$('roster').addEventListener('click', event => {
  const id = event.target.closest('[data-id]')?.dataset.id;
  if (!id || !canDraft()) return;
  action('preview', { id });
});
$('selection').addEventListener('click', event => {
  if (event.target.id === 'skipBan' && canDraft()) action('confirm', { id: null });
  if (event.target.id === 'confirmPick' && selected && canDraft()) action('confirm', { id: selected });
});

async function init() {
  if (!room) showHome();
  try {
    const response = await fetch('/champions.json');
    if (!response.ok) throw new Error();
    catalog = await response.json();
    catalog.byId = new Map(catalog.champions.map(champion => [champion.id, champion]));
    const [year, patch] = catalog.patch.split('.');
    $('patch').textContent = 'Patch ' + (Number(year) + 10) + '.' + patch;
    $('newRoom').disabled = false;
    if (room) await refresh();
    setInterval(tick, 200);
    setInterval(refresh, 1250);
  } catch {
    notice('Não foi possível carregar os campeões. Atualize a página para tentar de novo.');
  }
}

init();
