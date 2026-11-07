import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { GameEngine, CARD_TYPES } from '../src/character-engine.js';
import { CharacterAdapter } from '../src/character-adapter.js';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { EXTRA_CARDS } from '../src/card-effects.js';
import { chooseBaselineAction } from '../src/baseline-ai.js';

// Execute the application's actual dialog renderer with a small DOM fixture.
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const start = app.indexOf('function renderDecision() {');
assert.ok(start >= 0);
const renderer = app.slice(start, app.indexOf('\n}\n', start) + 2);
const listStart = app.indexOf('function decisionCardList(');
const listRenderer = app.slice(listStart, app.indexOf('\n}\n', listStart) + 2);

class Element {
  constructor(tagName, className = '', textContent = '') {
    Object.assign(this, { tagName, className, textContent, children: [], open: false });
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function view(engine, humanTurn = () => true) {
  const dialog = new Element('dialog'), modal = new Element('div');
  const node = (tag, className, text) => new Element(tag, className, text);
  let render;
  render = runInNewContext(`${listRenderer}\n(${renderer})`, {
    engine, adapter: new CharacterAdapter(engine), CARD_TYPES, humanTurn, node,
    $: selector => {
      assert.ok(['#decision', '#modal'].includes(selector));
      return selector === '#decision' ? dialog : modal;
    },
    cardButton: card => Object.assign(node('button', 'card'), { card }),
    button: (label, onclick, className) => Object.assign(node('button', className, label), { onclick }),
    perform: action => { action(); render(); },
  });
  return {
    render, dialog,
    title: () => modal.children.find(el => el.tagName === 'h2')?.textContent,
    press: label => {
      const button = modal.children.find(el => el.tagName === 'button' && el.textContent === label);
      assert.ok(button, `Missing button ${label}`);
      button.onclick();
    },
    pick: id => {
      const cards = modal.children.find(el => el.className === 'modal-cards')?.children;
      const button = cards?.find(el => el.card.id === id);
      assert.ok(button, `Missing choice ${id}`);
      button.onclick();
    },
  };
}

const monster = (id, ownerPlayer, attack = 3) => ({ id, name: id, type: 'familiar', attack, ownerPlayer });
function spell(effect) {
  const data = EXTRA_CARDS[effect];
  return { ...data, id: effect, effect, type: CARD_TYPES.MAGIC, chainable: data.kind === 'trap' };
}
function duel(initiator = 0) {
  const ids = initiator === 0 ? ['mami', 'madoka'] : ['madoka', 'mami'];
  const engine = new GameEngine({ players: ids.map(id => ({ name: id, character: CHARACTERS[id] })), decks: ids.map(createDeck), openingHand: 0 });
  if (initiator === 1) engine.endTurn(0);
  return engine;
}
function startSwap(initiator) {
  const engine = duel(initiator);
  engine.player(initiator).hand = [spell('swap')];
  engine.player(initiator).field[0] = monster('small', initiator);
  engine.player(1 - initiator).field[0] = monster('boss', 1 - initiator, 13);
  engine.activateMainMagic(initiator, 'swap');
  while (engine.state.pendingDecision?.type === 'CHAIN_RESPONSE') engine.respondChain(engine.state.pendingDecision.player);
  return engine;
}

test('both Strong Transfer choice dialogs render and their buttons complete the exchange', () => {
  for (const initiator of [0, 1]) {
    const engine = startSwap(initiator), ui = view(engine);
    assert.equal(engine.state.pendingDecision.stage, 'swap-own');
    assert.equal(engine.state.pendingDecision.context.targets, undefined);
    ui.render();
    assert.equal(ui.dialog.open, true);
    assert.equal(ui.title(), '交換に出す自分のモンスターを選択');
    ui.pick('small');
    assert.equal(engine.state.pendingDecision.stage, 'swap-opponent');
    assert.equal(ui.title(), '交換に出す自分のモンスターを選択');
    ui.pick('boss');
    assert.equal(engine.state.pendingDecision, null);
    assert.equal(ui.dialog.open, false);
    assert.equal(engine.player(initiator).field[0].id, 'boss');
    assert.equal(engine.player(1 - initiator).field[0].id, 'small');
  }
});

test('CPU Strong Transfer hands priority to the human choice without a render error', () => {
  const engine = startSwap(1), ui = view(engine, () => engine.state.pendingDecision?.player === 0);
  ui.render();
  assert.equal(ui.dialog.open, false);
  engine.selectCardChoice(1, engine.state.pendingDecision.options[0].key);
  assert.equal(engine.state.pendingDecision.stage, 'swap-opponent');
  assert.equal(engine.state.pendingDecision.player, 0);
  ui.render();
  assert.equal(ui.dialog.open, true);
  ui.pick('boss');
  assert.equal(engine.state.pendingDecision, null);
  assert.equal(ui.dialog.open, false);
  assert.equal(engine.player(1).field[0].id, 'boss');
});

test('Mallet dialog updates its selected-hand count', () => {
  const engine = duel(), ui = view(engine);
  engine.player(0).hand = [spell('mallet'), monster('first', 0), monster('second', 0)];
  engine.activateMainMagic(0, 'mallet');
  ui.render();
  assert.equal(ui.title(), '山札に戻す手札を選択（0枚）');
  ui.pick('first');
  assert.equal(ui.title(), '山札に戻す手札を選択（1枚）');
  ui.pick('second');
  assert.equal(ui.title(), '山札に戻す手札を選択（2枚）');
});

test('Avarice dialog updates its selected-monster count', () => {
  const engine = duel(), ui = view(engine);
  engine.player(0).hand = [spell('avarice')];
  engine.player(0).graveyard = Array.from({ length: 5 }, (_, i) => monster(`grave-${i}`, 0));
  engine.activateMainMagic(0, 'avarice');
  ui.render();
  assert.equal(ui.title(), '山札に戻すモンスターを選択（0/5）');
  for (let i = 0; i < 4; i++) {
    ui.pick(`grave-${i}`);
    assert.equal(ui.title(), `山札に戻すモンスターを選択（${i + 1}/5）`);
  }
});

test('supported extra card effects finish their cost, target and response dialogs through UI buttons', () => {
  const stages = new Set();
  for (const effect of Object.keys(EXTRA_CARDS)) {
    const engine = duel(effect === 'jammer' ? 1 : 0), ui = view(engine);
    engine.player(0).hand = [spell(effect), monster('cost', 0), monster('keep', 0)];
    engine.player(1).hand = [];
    engine.player(0).field[0] = monster('own', 0);
    engine.player(1).field[0] = monster('enemy', 1, 10);
    engine.player(0).graveyard = Array.from({ length: 5 }, (_, i) => monster(`grave-${i}`, 0));
    engine.player(1).graveyard = [monster('enemy-grave', 1, 8)];
    if (effect === 'jammer') {
      engine.player(1).hand = [spell('doubleSummon')];
      engine.activateMainMagic(1, 'doubleSummon');
      assert.equal(engine.state.pendingDecision.player, 0);
      ui.render();
      ui.pick('jammer');
    } else engine.activateMainMagic(0, effect);
    for (let step = 0; engine.state.pendingDecision; step++) {
      assert.ok(step < 30, `${effect} dialogs did not finish`);
      ui.render();
      assert.ok(ui.title(), `${effect} has an empty heading`);
      const decision = engine.state.pendingDecision;
      if (decision.type === 'CHAIN_RESPONSE') { ui.press('発動しない'); continue; }
      assert.equal(decision.type, 'CARD_CHOICE');
      stages.add(decision.stage);
      if (decision.stage === 'hand' && decision.context.targets.length) {
        ui.press('選択を完了');
        continue;
      }
      const target = decision.stage === 'field' ? decision.options.find(option => option.player === 1)
        : effect === 'reborn' ? decision.options.find(option => option.player === 1)
        : decision.options[0];
      assert.ok(target, `${effect} has no choice`);
      ui.pick(target.card.id);
    }
    ui.render();
    assert.equal(ui.dialog.open, false, effect);
    assert.equal(engine.state.chain.length, 0, effect);
    assert.equal(engine.state.phase, 'MAIN', effect);
    assert.ok(engine.player(0).graveyard.some(card => card.id === effect), `${effect} did not finish resolving`);
  }
  assert.deepEqual([...stages].sort(), ['discard', 'field', 'grave', 'hand', 'recycle', 'swap-opponent', 'swap-own']);
});

test('decision dialogs render during seeded games across all six characters', () => {
  const ids = Object.keys(CHARACTERS), observed = new Set();
  for (let game = 0; game < 60; game++) {
    let seed = game + 17001;
    const rng = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const pair = [ids[game % ids.length], ids[Math.floor(game / ids.length) % ids.length]];
    const engine = new GameEngine({ players: pair.map(id => ({ name: id, character: CHARACTERS[id] })), decks: pair.map(createDeck), rng });
    const adapter = new CharacterAdapter(engine), ui = view(engine);
    for (let step = 0; !adapter.info().terminated && step < 800; step++) {
      ui.render();
      if (engine.state.pendingDecision) {
        observed.add(engine.state.pendingDecision.type);
        assert.equal(ui.dialog.open, true);
        assert.ok(ui.title(), `${pair.join('/')} has an empty decision heading`);
      } else assert.equal(ui.dialog.open, false);
      const player = adapter.currentPlayer(), legal = adapter.legalActions(player);
      const action = game % 3 === 0 ? legal[Math.floor(rng() * legal.length)] : chooseBaselineAction(adapter, player, rng);
      adapter.applyAction(action, player);
    }
    ui.render();
  }
  assert.ok(observed.has('CARD_CHOICE'));
  assert.ok(observed.has('CHAIN_RESPONSE'));
  for (const type of ['MADOKA_REVIVE', 'SAYAKA_RECYCLE', 'KYOKO_OPPONENT_TRIBUTE', 'KYOKO_WITCH_SUMMON', 'NAGISA_ATTACKER', 'NAGISA_TARGET']) {
    assert.ok(observed.has(type), `No ${type} dialog was checked`);
  }
});
