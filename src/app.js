import { GameEngine, CARD_TYPES, PHASES } from './game-engine.js';
import { CHARACTERS, createPrototypeDeck } from './card-data.js';

const $ = (sel) => document.querySelector(sel);
let engine;
let selectedHandCard = null;
let selectedTributes = [];
let selectedAttacker = null;

function start() {
  engine = new GameEngine({
    players: [
      { id: 'p1', name: 'P1 まどか', character: CHARACTERS.madoka },
      { id: 'p2', name: 'P2 マミ', character: CHARACTERS.mami },
    ],
    decks: [createPrototypeDeck(), createPrototypeDeck()],
  });
  render();
}

function label(card) {
  if (!card) return '';
  if (card.type === CARD_TYPES.FAMILIAR) return `${card.suit}${card.rank}\n使い魔\nATK ${card.attack}`;
  if (card.type === CARD_TYPES.WITCH) return `${card.suit}${card.rank}\n魔女\nATK ${card.attack}\n生贄合計≥${card.tributeThreshold}`;
  return `${card.suit}${card.rank === 1 ? 'A' : card.rank}\n魔法\n${card.effect === 'boost' ? `+${card.value}` : 'ダメージ0'}`;
}

function renderCard(card, { owner, zone, slot = null } = {}) {
  const el = document.createElement('button');
  el.className = `card ${card.type}`;
  el.dataset.cardId = card.id;
  el.innerHTML = `<span>${label(card).replaceAll('\n', '<br>')}</span>`;
  const img = new Image();
  img.onload = () => { el.style.backgroundImage = `url('${card.image}')`; el.classList.add('has-image'); };
  img.src = card.image;

  if (zone === 'hand') {
    el.onclick = () => { selectedHandCard = card.id; selectedTributes = []; render(); };
    if (selectedHandCard === card.id) el.classList.add('selected');
  } else if (zone === 'field') {
    el.onclick = () => onFieldClick(owner, slot);
    if (selectedAttacker?.owner === owner && selectedAttacker?.slot === slot) el.classList.add('selected');
    if (selectedTributes.includes(slot) && owner === engine.state.priorityPlayer) el.classList.add('tribute');
  }
  return el;
}

function render() {
  const s = engine.state;
  $('#turn').textContent = `TURN ${s.turn} / 優先権: ${engine.player(s.priorityPlayer).name}`;
  $('#status').textContent = s.phase === PHASES.GAME_OVER ? `${engine.player(s.winner).name} WIN` : s.phase;
  renderPlayer(1, '#top-player');
  renderPlayer(0, '#bottom-player');
  renderActions();
  renderChain();
  renderLog();
  renderModal();
}

function renderPlayer(index, selector) {
  const p = engine.player(index);
  const root = $(selector);
  root.querySelector('.player-name').textContent = `${p.name} / 山札 ${p.deck.length} / 手札 ${p.hand.length} / 墓地 ${p.graveyard.length}`;
  root.querySelector('.character-name').textContent = p.character.name;
  root.querySelector('.passive').textContent = p.character.passive;
  root.querySelector('.special-name').textContent = p.character.special;

  const charImg = root.querySelector('.character-image');
  charImg.style.display = '';
  charImg.src = p.character.image;
  charImg.onerror = () => { charImg.style.display = 'none'; };

  const field = root.querySelector('.field');
  field.innerHTML = '';
  p.field.forEach((card, slot) => {
    const zone = document.createElement('div');
    zone.className = 'zone';
    if (card) zone.appendChild(renderCard(card, { owner: index, zone: 'field', slot }));
    else zone.innerHTML = `<span class="slot-number">${slot + 1}</span>`;
    field.appendChild(zone);
  });

  const hand = root.querySelector('.hand');
  hand.innerHTML = '';
  p.hand.forEach(card => hand.appendChild(renderCard(card, { owner: index, zone: 'hand' })));
}

function onFieldClick(owner, slot) {
  const s = engine.state;
  const priority = s.priorityPlayer;
  if (owner === priority && priority === s.activePlayer) {
    const chosen = engine.player(owner).field[slot];
    if (!chosen) return;
    if (selectedHandCard) {
      const handCard = engine.player(priority).hand.find(c => c.id === selectedHandCard);
      if (handCard?.type === CARD_TYPES.WITCH && chosen.type === CARD_TYPES.FAMILIAR) {
        selectedTributes = selectedTributes.includes(slot) ? selectedTributes.filter(x => x !== slot) : [...selectedTributes, slot];
        render();
        return;
      }
    }
    selectedAttacker = { owner, slot };
    render();
  } else if (selectedAttacker && selectedAttacker.owner === priority) {
    try {
      engine.attack(priority, selectedAttacker.slot, slot);
      selectedAttacker = null;
      selectedHandCard = null;
      selectedTributes = [];
      render();
    } catch (e) { alert(e.message); }
  }
}

function renderActions() {
  const s = engine.state;
  const root = $('#actions');
  root.innerHTML = '';
  if (s.phase === PHASES.GAME_OVER || s.pendingDecision) return;
  const p = engine.player(s.priorityPlayer);
  const card = p.hand.find(c => c.id === selectedHandCard);

  if (s.priorityPlayer === s.activePlayer && card && [CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(card.type)) {
    root.appendChild(actionButton('召喚', () => {
      try {
        engine.summon(s.priorityPlayer, card.id, selectedTributes);
        selectedHandCard = null;
        selectedTributes = [];
        render();
      } catch (e) { alert(e.message); }
    }));
  }

  if (engine.canUseSpecial(s.priorityPlayer)) {
    root.appendChild(actionButton(p.character.special, () => {
      try { engine.activateSpecial(s.priorityPlayer); render(); } catch (e) { alert(e.message); }
    }, 'special-button'));
  }

  if (s.priorityPlayer === s.activePlayer) {
    root.appendChild(actionButton('ターン終了', () => {
      try {
        engine.endTurn(s.priorityPlayer);
        selectedHandCard = null;
        selectedAttacker = null;
        render();
      } catch (e) { alert(e.message); }
    }));
  } else {
    root.appendChild(actionButton('優先権を返す', () => { engine.passPriorityTo(s.activePlayer); render(); }));
  }
}

function actionButton(text, fn, className = '') {
  const b = document.createElement('button');
  b.className = `action ${className}`;
  b.textContent = text;
  b.onclick = fn;
  return b;
}

function renderChain() {
  const root = $('#chain-stack');
  root.innerHTML = '';
  engine.state.chain.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'chain-item';
    div.textContent = `CHAIN ${i + 1}  ${engine.player(item.player).name}: ${item.card.name}`;
    root.appendChild(div);
  });
}

function renderLog() {
  $('#log').innerHTML = engine.state.logs.slice(-10).reverse().map(x => `<div>${x}</div>`).join('');
}

function renderModal() {
  const d = engine.state.pendingDecision;
  const backdrop = $('#modal-backdrop');
  const modal = $('#modal');
  if (!d) { backdrop.classList.add('hidden'); return; }
  backdrop.classList.remove('hidden');
  const p = engine.player(d.player);
  modal.innerHTML = `<h2>${p.name}</h2>`;

  if (d.type === 'CHAIN_RESPONSE') {
    modal.innerHTML += '<h3>チェーンしますか？</h3><p>発動可能な魔法を選択してください。</p>';
    const list = document.createElement('div');
    list.className = 'modal-card-list';
    d.options.forEach(id => {
      const card = p.hand.find(c => c.id === id);
      if (!card) return;
      const b = renderCard(card);
      b.onclick = () => { engine.respondChain(d.player, id); render(); };
      list.appendChild(b);
    });
    modal.appendChild(list);
    modal.appendChild(actionButton('発動しない', () => { engine.respondChain(d.player, null); render(); }));
  }

  if (d.type === 'MADOKA_REVIVE') {
    modal.innerHTML += '<h3>プルウィア☆マギカ</h3><p>墓地から蘇生する使い魔・魔女を1体選択。</p>';
    const list = document.createElement('div');
    list.className = 'modal-card-list';
    d.options.forEach(id => {
      const card = p.graveyard.find(c => c.id === id);
      if (!card) return;
      const b = renderCard(card);
      b.onclick = () => { engine.selectReviveTarget(d.player, id); render(); };
      list.appendChild(b);
    });
    modal.appendChild(list);
  }
}

$('#new-game').onclick = start;
start();
