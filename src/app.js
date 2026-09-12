import { GameEngine } from './engine.js';
import { label, tributeCost, isSpadeBoost } from './cards.js';
import { runAiMain, runAiChainStep, runAiAceStep } from './ai.js';

let engine;
let selectedHandUid = null;
let selectedTributes = new Set();

const $ = (id) => document.getElementById(id);

function newGame(humanCharacter = 'madoka') {
  const aiCharacter = humanCharacter === 'madoka' ? 'mami' : 'madoka';
  engine = new GameEngine({ humanCharacter, aiCharacter });
  selectedHandUid = null;
  selectedTributes = new Set();
  render();
  maybeRunAi();
}

function cardArtPath(characterId, card) {
  return `assets/cards/${characterId}/${card.code}.png`;
}

function characterArtPath(characterId) {
  return `assets/characters/${characterId}.png`;
}

function cardElement(card, owner, zone) {
  const el = document.createElement('button');
  el.className = `card ${card.suit === 'H' || card.suit === 'D' ? 'red' : ''}`;
  el.type = 'button';
  el.dataset.uid = card.uid;
  const art = cardArtPath(owner.characterId, card);
  el.innerHTML = `
    <img class="card-art" src="${art}" alt="" />
    <span class="fallback-card">
      <span class="rank">${card.kind === 'joker' ? 'JOKER' : card.rank}</span>
      <span class="suit">${card.suitSymbol}</span>
      <span class="value">${card.kind === 'familiar' ? `ATK ${card.value}` : card.kind === 'ace' ? 'DMG 0' : 'SPECIAL'}</span>
    </span>`;
  const img = el.querySelector('img');
  img.addEventListener('error', () => img.classList.add('missing'));

  if (zone === 'hand' && owner.id === 'human') {
    if (card.uid === selectedHandUid) el.classList.add('selected');
    el.addEventListener('click', () => {
      selectedHandUid = selectedHandUid === card.uid ? null : card.uid;
      render();
    });
  }

  if (zone === 'field' && owner.id === 'human') {
    if (selectedTributes.has(card.uid)) el.classList.add('tribute-selected');
    el.addEventListener('click', () => {
      if (selectedTributes.has(card.uid)) selectedTributes.delete(card.uid);
      else selectedTributes.add(card.uid);
      render();
    });
  }
  return el;
}

function renderPlayer(player, prefix, hideHand = false) {
  $(`${prefix}-name`).textContent = player.character.name;
  $(`${prefix}-ability`).textContent = player.character.ability;
  $(`${prefix}-deck`).textContent = player.deck.length;
  $(`${prefix}-grave`).textContent = player.grave.length;
  const portrait = $(`${prefix}-portrait`);
  portrait.src = characterArtPath(player.characterId);
  portrait.onerror = () => portrait.classList.add('missing');

  const hand = $(`${prefix}-hand`);
  hand.innerHTML = '';
  if (hideHand) {
    for (let i = 0; i < player.hand.length; i += 1) {
      const back = document.createElement('div');
      back.className = 'card card-back';
      back.textContent = '★';
      hand.append(back);
    }
  } else {
    player.hand.forEach((card) => hand.append(cardElement(card, player, 'hand')));
  }

  const field = $(`${prefix}-field`);
  field.innerHTML = '';
  player.field.forEach((card) => field.append(cardElement(card, player, 'field')));
}

function selectedCard() {
  return engine.players[0].hand.find((c) => c.uid === selectedHandUid) ?? null;
}

function renderControls() {
  const human = engine.players[0];
  const currentIsHuman = engine.currentPlayer === human;
  const battle = engine.battle;
  $('turn-label').textContent = engine.winner
    ? `${engine.winner.character.name} 勝利`
    : `${engine.currentPlayer.character.name}のターン`;

  const summonBtn = $('summon-btn');
  const ritualBtn = $('ritual-btn');
  const jokerBtn = $('joker-btn');
  const endBtn = $('end-btn');
  const card = selectedCard();

  summonBtn.disabled = !currentIsHuman || Boolean(battle) || !card || card.kind !== 'familiar' || human.summonUsed;
  ritualBtn.disabled = !currentIsHuman || Boolean(battle) || !card || card.suit !== 'H' || card.kind !== 'familiar' || human.summonUsed;
  jokerBtn.disabled = !currentIsHuman || Boolean(battle) || !card || card.kind !== 'joker';
  endBtn.disabled = !currentIsHuman || Boolean(battle) || Boolean(engine.winner);

  const cost = card?.kind === 'familiar' ? tributeCost(card) : 0;
  $('selection-info').textContent = card
    ? `${label(card)}を選択中${cost ? ` / 生贄${cost}枚` : ''}`
    : '手札を選択してください';

  const battlePanel = $('battle-panel');
  battlePanel.hidden = !currentIsHuman || Boolean(battle) || engine.turn === 0 || human.field.length === 0;
  const attackerSelect = $('attacker-select');
  const targetSelect = $('target-select');
  attackerSelect.innerHTML = human.field.map((c) => `<option value="${c.uid}">${label(c)} (${c.value})</option>`).join('');
  const enemy = engine.players[1];
  targetSelect.innerHTML = enemy.field.length
    ? enemy.field.map((c) => `<option value="${c.uid}">${label(c)} (${c.value})</option>`).join('')
    : '<option value="">直接攻撃</option>';

  const chainPanel = $('chain-panel');
  chainPanel.hidden = !(battle && battle.stage === 'chain');
  if (battle && battle.stage === 'chain') {
    $('chain-score').textContent = `攻撃側 ${battle.attackerPower} : 防御側 ${battle.defenderPower}`;
    const humanTurn = battle.chainTurn === 0;
    $('chain-who').textContent = humanTurn ? 'あなたのチェーン' : 'AI応答中';
    const boosts = human.hand.filter(isSpadeBoost);
    const buttons = $('spade-buttons');
    buttons.innerHTML = '';
    boosts.forEach((c) => {
      const b = document.createElement('button');
      b.textContent = `${label(c)} +${c.value}`;
      b.disabled = !humanTurn;
      b.onclick = () => { engine.playSpadeBoost(human, c.uid); render(); maybeRunAi(); };
      buttons.append(b);
    });
    $('pass-chain-btn').disabled = !humanTurn;
  }

  const acePanel = $('ace-panel');
  const humanLoses = battle?.stage === 'ace' && battle.result.loserIndex === 0;
  acePanel.hidden = !humanLoses;
  if (humanLoses) {
    $('ace-damage').textContent = battle.result.rawDamage;
    $('use-ace-btn').disabled = !engine.canUseAce(human);
  }
}

function render() {
  renderPlayer(engine.players[1], 'ai', true);
  renderPlayer(engine.players[0], 'human', false);
  renderControls();
  $('log').textContent = engine.log.slice(-18).join('\n');
}

function maybeRunAi() {
  if (engine.winner) { render(); return; }

  let safety = 0;
  while (safety++ < 20) {
    if (engine.battle?.stage === 'chain' && engine.battle.chainTurn === 1) {
      runAiChainStep(engine);
      render();
      continue;
    }
    if (engine.battle?.stage === 'ace' && engine.battle.result.loserIndex === 1) {
      runAiAceStep(engine);
      render();
      continue;
    }
    if (engine.battle?.stage === 'ace' && engine.battle.result.loserIndex === 0) {
      render();
      return;
    }
    if (engine.currentPlayer.id === 'ai' && !engine.battle) {
      runAiMain(engine);
      render();
      if (engine.battle) continue;
      engine.endTurn();
      render();
      return;
    }
    return;
  }
}

$('summon-btn').onclick = () => {
  const human = engine.players[0];
  const card = selectedCard();
  if (!card) return;
  const result = engine.normalSummon(human, card.uid, [...selectedTributes]);
  if (!result.ok) alert(result.error);
  else { selectedHandUid = null; selectedTributes.clear(); }
  render();
};

$('ritual-btn').onclick = () => {
  const human = engine.players[0];
  const heart = selectedCard();
  if (!heart) return;
  const eligible = human.hand.filter((c) => c.kind === 'familiar' && c.uid !== heart.uid && c.value < heart.value);
  if (!eligible.length) { alert('儀式召喚できる使い魔が手札にいません'); return; }
  const text = eligible.map((c, i) => `${i + 1}: ${label(c)} (${c.value})`).join('\n');
  const chosen = Number(prompt(`召喚する使い魔を番号で選択\n${text}`, '1')) - 1;
  if (!Number.isInteger(chosen) || !eligible[chosen]) return;
  const result = engine.ritualSummon(human, heart.uid, eligible[chosen].uid);
  if (!result.ok) alert(result.error);
  else selectedHandUid = null;
  render();
};

$('joker-btn').onclick = () => {
  const card = selectedCard();
  if (!card) return;
  const mode = confirm('OK: 全フィールドの使い魔を破壊\nキャンセル: 自分の場を全生贄にして合計攻撃力の使い魔にする') ? 'blackhole' : 'ra';
  const result = engine.playJoker(engine.players[0], card.uid, mode);
  if (!result.ok) alert(result.error);
  else selectedHandUid = null;
  render();
};

$('attack-btn').onclick = () => {
  const attackerUid = $('attacker-select').value;
  const targetUid = $('target-select').value || null;
  const result = engine.startBattle(attackerUid, targetUid);
  if (!result.ok) alert(result.error);
  render();
  maybeRunAi();
};

$('pass-chain-btn').onclick = () => {
  engine.passChain(engine.players[0]);
  render();
  maybeRunAi();
};

$('use-ace-btn').onclick = () => {
  const ace = engine.players[0].hand.find((c) => c.kind === 'ace');
  engine.resolveBattle(true, ace?.uid ?? null);
  render();
  maybeRunAi();
};

$('take-damage-btn').onclick = () => {
  engine.resolveBattle(false);
  render();
  maybeRunAi();
};

$('end-btn').onclick = () => {
  engine.endTurn();
  selectedHandUid = null;
  selectedTributes.clear();
  render();
  maybeRunAi();
};

$('new-madoka-btn').onclick = () => newGame('madoka');
$('new-mami-btn').onclick = () => newGame('mami');

newGame('madoka');
