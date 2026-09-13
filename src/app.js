import { GameEngine, CARD_TYPES, PHASES } from './game-engine.js';
import { CHARACTERS, createDeck } from './card-data.js';
import { RLAdapter } from './rl-adapter.js';
import { chooseBaselineAction } from './baseline-ai.js';
import { Policy } from './policy.js';

const $ = selector => document.querySelector(selector);
let engine, adapter, human = 0, mode = 'cpu', policy = null, timer, generation = 0, eventCursor = 0;
let selection = null, tributes = [], attacker = null, target = null;
const node = (tag, className, text) => { const el = document.createElement(tag); el.className = className; if (text !== undefined) el.textContent = text; return el; };
const typeName = card => ({ familiar: '使い魔', witch: '魔女', magic: '魔法' })[card.type];
function description(card) {
  if (card.type === CARD_TYPES.WITCH) return `攻撃力 ${card.attack}。生贄の攻撃力合計 ${card.tributeThreshold} 以上で召喚。`;
  if (card.type === CARD_TYPES.FAMILIAR) return `攻撃力 ${card.attack}。生贄なしで召喚できます。`;
  if (card.effect === 'draw') return 'メインフェイズに2枚ドロー。山札が0枚になると敗北します。';
  if (card.effect === 'boost') return `戦闘中の自分の使い魔・魔女の攻撃力を＋${card.value}。この戦闘のみ有効。`;
  return 'この戦闘で自分が受けるダメージを0にします。カードの破壊は防ぎません。';
}
function clear() { selection = null; tributes = []; attacker = null; target = null; }
function humanTurn() { return mode === 'local' || adapter.currentPlayer() === human; }
function notify(text = '') { $('#notice').textContent = text; $('#notice').hidden = !text; }
function showDetail(card) {
  const root = $('#card-detail');
  root.replaceChildren();
  const img = node('img', 'detail-image'); img.src = card.image; img.alt = card.name;
  root.append(img, node('small', 'card-type', typeName(card)), node('h3', '', card.name), node('p', '', description(card)));
}
function start() {
  clearTimeout(timer); generation++; clear(); eventCursor = 0; notify();
  const chosen = $('#character').value;
  human = $('#seat').value === 'second' ? 1 : 0;
  mode = $('#mode').value;
  const ids = human === 0 ? [chosen, chosen === 'madoka' ? 'mami' : 'madoka'] : [chosen === 'madoka' ? 'mami' : 'madoka', chosen];
  engine = new GameEngine({ players: ids.map((id, i) => ({ id: `p${i}`, name: CHARACTERS[id].name, character: CHARACTERS[id] })), decks: ids.map(createDeck) });
  adapter = new RLAdapter(engine);
  $('#card-detail').replaceChildren(node('p', 'muted', 'カードに触れると、ここに詳細を表示します。'), node('div', 'detail-placeholder', '✦'));
  finishAction();
}
function perform(fn) {
  try { notify(); fn(); clear(); finishAction(); }
  catch (error) { notify(error.message); render(); }
}
function finishAction() {
  // Main-phase actions have no available opponent response. Return priority automatically.
  const s = engine.state;
  if (s.phase !== PHASES.GAME_OVER && !s.pendingDecision && s.priorityPlayer !== s.activePlayer) engine.passPriorityTo(s.activePlayer);
  const events = s.events.slice(eventCursor); eventCursor = s.events.length;
  render();
  for (const detail of events) window.dispatchEvent(new CustomEvent('duel:event', { detail }));
  scheduleAI();
}
function scheduleAI() {
  clearTimeout(timer);
  if (engine.state.phase === PHASES.GAME_OVER || humanTurn()) return;
  const duel = generation;
  timer = setTimeout(() => {
    if (duel !== generation) return;
    perform(() => {
      const player = adapter.currentPlayer(), legal = adapter.legalActions(player);
      let action;
      try { action = policy ? policy.choose(adapter.observation(player), legal) : chooseBaselineAction(adapter, player); }
      catch (error) { policy = null; $('#ai-name').textContent = '基本AI'; notify(`${error.message} 基本AIで続けます。`); action = chooseBaselineAction(adapter, player); }
      adapter.applyAction(action, player);
    });
  }, 450);
}
function button(text, fn, className = 'primary', disabled = false) {
  const b = node('button', className, text); b.disabled = disabled; b.onclick = fn; return b;
}
function selectedCard() { return selection ? engine.player(selection.owner).hand.find(c => c.id === selection.id) : null; }
function attackable(owner, slot) { return [...Array(5).keys(), null].some(t => engine.canAttack(owner, slot, t)); }
function cardButton(card, owner, zone, slot) {
  const b = node('button', `card ${card.type}`);
  b.dataset.cardId = card.id;
  b.setAttribute('aria-label', `${card.name}、${description(card)}`);
  const visual = node('div', 'card-visual'), img = node('img', 'card-image');
  img.src = card.image; img.alt = ''; img.draggable = false;
  visual.append(img);
  const caption = node('div', 'card-caption'); caption.append(node('span', 'card-name', card.name), node('b', 'card-value', card.attack ? `ATK ${card.attack}` : card.effect === 'boost' ? `＋${card.value}` : card.effect === 'draw' ? '2枚ドロー' : 'ダメージ 0'));
  b.append(visual, caption);
  const selected = zone === 'hand' ? selection?.owner === owner && selection?.id === card.id : attacker?.owner === owner && attacker.slot === slot;
  b.classList.toggle('selected', selected);
  b.setAttribute('aria-pressed', String(selected));
  b.onmouseenter = () => showDetail(card); b.onfocus = () => showDetail(card);
  b.onclick = () => {
    showDetail(card);
    if (!humanTurn() || engine.state.pendingDecision || engine.state.phase === PHASES.GAME_OVER) return;
    const player = adapter.currentPlayer();
    if (zone === 'hand' && owner === player) { selection = { owner, id: card.id }; tributes = []; attacker = null; target = null; }
    if (zone === 'field' && owner === player) {
      const handCard = selectedCard();
      if (handCard?.type === CARD_TYPES.WITCH && engine.canSummon(player, handCard.id)) tributes = tributes.includes(slot) ? tributes.filter(s => s !== slot) : [...tributes, slot];
      else if (attackable(owner, slot)) { selection = null; tributes = []; attacker = { owner, slot }; target = null; }
    } else if (zone === 'field' && attacker && owner !== attacker.owner && engine.canAttack(attacker.owner, attacker.slot, slot)) target = slot;
    render();
  };
  if (humanTurn() && !engine.state.pendingDecision) {
    const canPlay = zone === 'hand' && (engine.canSummon(owner, card.id) || engine.canActivateMainMagic(owner, card.id));
    const canAttack = zone === 'field' && attackable(owner, slot);
    const canTarget = zone === 'field' && attacker && owner !== attacker.owner && engine.canAttack(attacker.owner, attacker.slot, slot);
    b.classList.toggle('playable', canPlay || canAttack);
    b.classList.toggle('targetable', !!canTarget);
    b.classList.toggle('target-selected', !!canTarget && target === slot);
    b.classList.toggle('tribute', zone === 'field' && owner === selection?.owner && tributes.includes(slot));
    if (canAttack) visual.append(node('span', 'card-badge', '攻撃可能'));
  }
  if (zone === 'field' && card.attackedTurn === engine.state.turn) visual.append(node('span', 'card-badge used', '攻撃済み'));
  return b;
}
function renderPlayer(index, selector) {
  const p = engine.player(index), root = $(selector), s = engine.state;
  root.replaceChildren(); root.dataset.character = p.character.id;
  root.classList.toggle('active', s.activePlayer === index);
  const head = node('div', 'player-head');
  const name = node('div', 'player-identity');
  name.append(node('small', '', mode === 'cpu' ? index === human ? 'YOU' : 'AI' : `PLAYER ${index + 1}`), node('h2', '', p.name), node('span', 'passive', p.character.passive));
  const stats = node('div', 'stats');
  const life = node('div', 'life'); life.append(node('small', '', '山札 / LIFE'), node('b', '', String(p.deck.length)));
  const grave = button(`墓地 ${p.graveyard.length}`, () => showGrave(index), 'quiet');
  stats.append(node('span', 'hand-count', `手札 ${p.hand.length}`), grave, life); head.append(name, stats);
  root.append(head);
  if (selector === '#top-player') {
    const backs = node('div', 'hidden-hand'); backs.setAttribute('aria-label', `非公開の手札 ${p.hand.length}枚`);
    for (let i = 0; i < Math.min(p.hand.length, 12); i++) backs.append(node('span', 'card-back', '✦'));
    if (p.hand.length > 12) backs.append(node('span', '', `＋${p.hand.length - 12}`));
    root.append(backs);
  }
  const field = node('div', 'field');
  p.field.forEach((card, slot) => { const zone = node('div', 'zone'); zone.dataset.slot = slot; zone.append(card ? cardButton(card, index, 'field', slot) : node('span', 'empty-slot', `✧ ${slot + 1}`)); field.append(zone); });
  root.append(field);
  if (selector === '#bottom-player') {
    const info = node('div', 'hand-heading');
    info.append(node('b', '', '手札'), node('span', '', p.summonedThisTurn && index === s.activePlayer ? 'このターンの召喚は使用済み' : '召喚は1ターンに1体'), node('span', '', `必殺技：${p.specialUsed ? '使用済み' : '未使用'}`));
    const hand = node('div', 'hand'); p.hand.forEach(card => hand.append(cardButton(card, index, 'hand')));
    root.append(info, hand);
  }
}
function renderActions() {
  const s = engine.state, p = adapter.currentPlayer(), card = selectedCard(), root = $('#actions');
  root.replaceChildren();
  let hint = '';
  if (s.phase === PHASES.GAME_OVER) { hint = `${engine.player(s.winner).name}の勝利！`; root.append(button('もう一度対戦', start)); }
  else if (!humanTurn()) hint = `${engine.player(p).name}が考えています…`;
  else if (s.pendingDecision) hint = '発動するカードを選んでください。';
  else {
    if (s.phase === PHASES.MAIN) {
      hint = engine.player(p).summonedThisTurn ? '召喚済みです。魔法を使うか、バトルへ進めます。' : '光っている手札を選んで召喚・発動できます。';
      if (card) {
        hint = `${card.name}：${description(card)}`;
        if (card.type !== CARD_TYPES.MAGIC) {
          const total = tributes.reduce((n, slot) => n + (engine.player(p).field[slot]?.attack || 0), 0);
          if (card.type === CARD_TYPES.WITCH && engine.canSummon(p, card.id)) hint = `生贄を場から選択：合計 ${total} / 必要 ${card.tributeThreshold} 以上`;
          root.append(button(card.type === CARD_TYPES.WITCH ? '生贄を捧げて召喚' : '召喚する', () => perform(() => engine.summon(p, card.id, tributes)), 'primary', !engine.canSummon(p, card.id) || (card.type === CARD_TYPES.WITCH && total < card.tributeThreshold)));
        } else if (card.effect === 'draw') root.append(button('魔法を発動', () => perform(() => engine.activateMainMagic(p, card.id)), 'primary', !engine.canActivateMainMagic(p, card.id)));
      }
      root.append(button('バトルフェイズへ', () => perform(() => engine.enterBattlePhase(p)), 'secondary'));
    }
    if (s.phase === PHASES.BATTLE_START) {
      const self = engine.player(p);
      hint = self.specialUsed ? '必殺技は使用済みです。バトルを始めましょう。' : '必殺技を使うと、このターンのバトルはスキップします。';
      root.append(button(self.character.special, () => perform(() => engine.activateSpecial(p)), 'special', !engine.canUseSpecial(p)), button('バトル開始', () => perform(() => engine.continueBattlePhase(p))));
    }
    if (s.phase === PHASES.BATTLE) {
      hint = s.turn === 1 ? '先攻の初ターンは攻撃できません。ターンを終了してください。' : '攻撃可能な自分のカードを選んでください。';
      if (attacker) {
        hint = target === null ? '相手のカードを選ぶか、相手の場が空なら直接攻撃できます。' : `${engine.player(1 - p).field[target].name}に攻撃します。`;
        if (engine.canAttack(p, attacker.slot, null)) root.append(button('直接攻撃する', () => perform(() => engine.attack(p, attacker.slot, null))));
        else root.append(button('攻撃する', () => perform(() => engine.attack(p, attacker.slot, target)), 'primary', target === null));
        root.append(button('選択を解除', () => { clear(); render(); }, 'quiet'));
      }
    }
    if (engine.canEndTurn(p)) root.append(button('ターン終了', () => perform(() => engine.endTurn(p)), 'quiet'));
  }
  $('#hint').textContent = hint;
}
function render() {
  const s = engine.state;
  $('#turn').textContent = `TURN ${String(s.turn).padStart(2, '0')}`;
  $('#turn-name').textContent = s.phase === PHASES.GAME_OVER ? 'デュエル終了' : `${engine.player(s.activePlayer).name}のターン`;
  const bottom = mode === 'local' ? adapter.currentPlayer() : human;
  renderPlayer(1 - bottom, '#top-player'); renderPlayer(bottom, '#bottom-player');
  for (const el of $('#phases').children) { const active = el.dataset.phase === (s.phase === PHASES.CHAIN ? PHASES.BATTLE : s.phase); el.classList.toggle('current', active); if (active) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current'); }
  renderActions();
  $('#chain-stack').replaceChildren(...s.chain.map((item, i) => node('span', 'chain-item', `CHAIN ${i + 1} · ${item.card.name}`)));
  $('#log').replaceChildren(...s.logs.slice(-30).reverse().map(text => node('li', '', text)));
  renderDecision();
}
function renderDecision() {
  const dialog = $('#decision'), d = engine.state.pendingDecision;
  if (!d || !humanTurn()) { if (dialog.open) dialog.close(); return; }
  const root = $('#modal'), p = engine.player(d.player);
  root.replaceChildren();
  const heading = node('h2', '', d.type === 'CHAIN_RESPONSE' ? '魔法で応じますか？' : '蘇生するカードを選択'); heading.id = 'decision-title';
  root.append(node('small', 'eyebrow', p.name), heading);
  if (d.type === 'CHAIN_RESPONSE') {
    const b = engine.state.battle;
    let atk = b.attackerBase + b.attackerBonus, def = b.defenderBase + b.defenderBonus;
    for (const item of engine.state.chain) if (item.card.effect === 'boost') { if (item.player === b.attackerPlayer) atk += item.card.value; else def += item.card.value; }
    root.append(node('p', '', b.direct ? `直接攻撃 · 攻撃力 ${atk}` : `攻撃 ${atk} ／ 防御側の攻撃力 ${def}`), node('p', 'muted', '魔法を選んで発動。選ばない場合は「発動しない」。'));
  }
  const list = node('div', 'modal-cards');
  for (const id of d.options) {
    const card = (d.type === 'CHAIN_RESPONSE' ? p.hand : p.graveyard).find(c => c.id === id);
    const b = cardButton(card, d.player, 'choice');
    b.onclick = () => perform(() => d.type === 'CHAIN_RESPONSE' ? engine.respondChain(d.player, id) : engine.selectReviveTarget(d.player, id));
    list.append(b);
  }
  root.append(list);
  if (d.type === 'CHAIN_RESPONSE') root.append(button('発動しない', () => perform(() => engine.respondChain(d.player)), 'secondary'));
  if (!dialog.open) dialog.showModal();
}
function showGrave(index) {
  if (engine.state.pendingDecision) return;
  const root = $('#modal'), p = engine.player(index); root.replaceChildren();
  const title = node('h2', '', `${p.name}の墓地`); title.id = 'decision-title'; root.append(title);
  const list = node('div', 'modal-cards');
  p.graveyard.forEach(card => list.append(cardButton(card, index, 'grave')));
  root.append(list, button('閉じる', () => $('#decision').close(), 'secondary'));
  $('#decision').showModal();
}
$('#decision').addEventListener('cancel', e => { if (engine.state.pendingDecision) e.preventDefault(); });
$('#new-game').onclick = () => { if (engine.state.phase === PHASES.GAME_OVER) start(); else $('#restart').showModal(); };
$('#cancel-restart').onclick = () => $('#restart').close();
$('#confirm-restart').onclick = () => { $('#restart').close(); start(); };
$('#policy-file').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 40 * 1024 * 1024) throw new Error('AIファイルは40MB以下にしてください。');
    const loaded = new Policy(JSON.parse(await file.text())); policy = loaded;
    $('#ai-name').textContent = '強化学習AI'; notify('学習済みAIを読み込みました。'); scheduleAI();
  } catch (error) { notify(`読み込めませんでした：${error.message}`); }
  event.target.value = '';
};
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !engine.state.pendingDecision) { clear(); render(); } });
start();
