import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/character-engine.js';
import { CharacterAdapter } from '../src/character-adapter.js';
import { ACTIONS, OBSERVATION_SIZE } from '../src/rl-adapter.js';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { EXTRA_CARDS } from '../src/card-effects.js';
import { chooseBaselineAction } from '../src/baseline-ai.js';

const monster = (id, attack = 3, ownerPlayer = 0, type = 'familiar') => ({ id, name: id, attack, type, ownerPlayer, tributeThreshold: type === 'witch' ? attack : undefined });
const spell = (effect, id = effect, ownerPlayer = 0) => ({ ...EXTRA_CARDS[effect], id, effect, type: 'magic', ownerPlayer, chainable: ['evacuation', 'jammer'].includes(effect) });
function duel() {
  return new GameEngine({ players: ['mami', 'madoka'].map(id => ({ name: id, character: CHARACTERS[id] })), decks: [0, 1].map(owner => Array.from({ length: 15 }, (_, i) => monster(`deck-${owner}-${i}`, 3, owner))), openingHand: 0, rng: () => .999999 });
}
function choose(e, id) {
  const d = e.state.pendingDecision;
  const option = d.options.find(x => x.card.id === id);
  assert.ok(option, `choice ${id} in ${d.stage}`);
  e.selectCardChoice(d.player, option.key);
  if (!e.state.pendingDecision && e.state.phase === 'MAIN' && e.state.priorityPlayer !== e.state.activePlayer) e.passPriorityTo(e.state.activePlayer);
}
function pass(e) {
  for (let i = 0; e.state.pendingDecision?.type === 'CHAIN_RESPONSE'; i++) {
    assert.ok(i < 100);
    e.respondChain(e.state.pendingDecision.player);
  }
  if (!e.state.pendingDecision && e.state.phase === 'MAIN' && e.state.priorityPlayer !== e.state.activePlayer) e.passPriorityTo(e.state.activePlayer);
}

test('Madoka and Mami each add two copies of both traps and no spells', () => {
  const expected = { evacuation: 2, jammer: 2 };
  for (const character of ['mami', 'madoka']) {
    const deck = createDeck(character), extra = deck.slice(30);
    assert.equal(extra.length, 4);
    assert.deepEqual(Object.fromEntries(Object.keys(expected).map(effect => [effect, extra.filter(c => c.effect === effect).length])), expected);
    assert.ok(extra.every(c => c.type === 'magic' && c.kind === 'trap'));
    assert.equal(deck.filter(c => c.type === 'familiar').length, 13);
    assert.equal(deck.filter(c => c.type === 'witch').length, 7);
  }
});

test('Double Summon grants exactly a second summon, does not stack, and resets next turn', () => {
  const e = duel();
  e.player(0).hand = [monster('first'), monster('second'), monster('third'), spell('doubleSummon'), spell('doubleSummon', 'second-double')];
  e.summon(0, 'first'); e.passPriorityTo(0);
  e.activateMainMagic(0, 'doubleSummon'); pass(e);
  assert.equal(e.remainingSummons(0), 1);
  assert.equal(e.canActivateMainMagic(0, 'second-double'), false);
  e.summon(0, 'second'); e.passPriorityTo(0);
  assert.equal(e.canSummon(0, 'third'), false);
  e.endTurn(0); e.endTurn(1);
  assert.equal(e.remainingSummons(0), 1);
  e.summon(0, 'third');
});

test('removal and Jammer costs stay paid when the removal is negated', () => {
  const e = duel();
  e.player(0).hand = [spell('doomed'), monster('discard-a')];
  e.player(1).hand = [spell('jammer', 'jammer-b', 1), monster('discard-b', 3, 1)];
  e.player(1).field[0] = monster('target', 13, 1, 'witch');
  e.activateMainMagic(0, 'doomed');
  assert.throws(() => e.selectCardChoice(1, 'invalid'));
  choose(e, 'discard-a'); choose(e, 'target');
  assert.equal(e.state.pendingDecision.player, 1);
  e.respondChain(1, 'jammer-b'); choose(e, 'discard-b'); pass(e);
  assert.equal(e.player(1).field[0].id, 'target');
  assert.deepEqual(e.player(0).graveyard.map(c => c.id).sort(), ['discard-a', 'doomed']);
  assert.deepEqual(e.player(1).graveyard.map(c => c.id).sort(), ['discard-b', 'jammer-b']);
  assert.equal(e.state.phase, 'MAIN');
});

test('a spell target that leaves in a higher chain link is not replaced by another monster', () => {
  const e = duel();
  e.player(0).hand = [spell('doomed'), monster('cost')];
  e.player(1).hand = [spell('evacuation', 'escape', 1)];
  e.player(1).field[0] = monster('target', 13, 1);
  e.player(1).field[1] = monster('other', 4, 1);
  e.activateMainMagic(0, 'doomed'); choose(e, 'cost'); choose(e, 'target');
  e.respondChain(1, 'escape'); choose(e, 'target'); pass(e);
  assert.equal(e.player(1).field[0], null);
  assert.equal(e.player(1).field[1].id, 'other');
  assert.ok(e.player(1).hand.some(c => c.id === 'target'));
});

test('Evacuation can answer a direct attack and cancels it without dealing phantom damage', () => {
  const e = duel(); e.endTurn(0);
  e.player(1).field[0] = monster('attacker', 13, 1, 'witch');
  e.player(0).hand = [spell('evacuation')];
  const life = e.player(0).deck.length;
  e.enterBattlePhase(1); e.continueBattlePhase(1); e.attack(1, 0);
  e.respondChain(0, 'evacuation'); choose(e, 'attacker'); pass(e);
  assert.equal(e.player(0).deck.length, life);
  assert.ok(e.player(1).hand.some(c => c.id === 'attacker'));
  assert.equal(e.state.battle, null);
  assert.ok(e.canEndTurn(1));
});

test('Jammer negates a boost in battle and is unavailable against traps', () => {
  const e = duel(); e.endTurn(0);
  e.player(1).field[0] = monster('attacker', 5, 1);
  e.player(0).field[0] = monster('defender', 8);
  e.player(1).hand = [{ id: 'boost', name: 'boost', type: 'magic', effect: 'boost', value: 5, chainable: true }];
  e.player(0).hand = [spell('jammer'), monster('cost')];
  e.enterBattlePhase(1); e.continueBattlePhase(1); e.attack(1, 0, 0);
  e.respondChain(1, 'boost'); e.respondChain(0, 'jammer'); choose(e, 'cost'); pass(e);
  assert.equal(e.player(1).field[0], null);
  assert.equal(e.player(0).field[0].id, 'defender');

  const t = duel(); t.player(0).hand = [spell('evacuation')]; t.player(1).hand = [spell('jammer', 'j', 1), monster('x', 3, 1)];
  t.player(1).field[0] = monster('bounce', 5, 1);
  t.activateMainMagic(0, 'evacuation'); choose(t, 'bounce');
  assert.ok(!t.state.pendingDecision || !t.state.pendingDecision.options.includes('j'));
});

test('each controller chooses the monster to swap; destruction and bounce respect original ownership', () => {
  const e = duel();
  e.player(0).hand = [spell('swap'), spell('evacuation')];
  e.player(0).field[0] = monster('weak', 3);
  e.player(1).field[0] = monster('boss', 13, 1, 'witch');
  e.player(1).field[1] = monster('alternative', 4, 1);
  e.activateMainMagic(0, 'swap'); pass(e);
  assert.equal(e.state.pendingDecision.player, 0); choose(e, 'weak');
  assert.equal(e.state.pendingDecision.player, 1); choose(e, 'boss');
  assert.equal(e.player(0).field[0].id, 'boss');
  assert.equal(e.player(1).field[0].id, 'weak');
  e.activateMainMagic(0, 'evacuation'); choose(e, 'boss'); pass(e);
  assert.ok(e.player(1).hand.some(c => c.id === 'boss'));
  e.destroy(1, 0, 'battle');
  assert.ok(e.player(0).graveyard.some(c => c.id === 'weak'));
  assert.equal(e.state.phase, 'MAIN');
});

test('Mallet exchanges only selected cards, preserves deck size, and spends its activation card', () => {
  const e = duel();
  e.player(0).hand = [spell('mallet'), monster('keep'), monster('return-a'), monster('return-b')];
  const size = e.player(0).deck.length;
  e.activateMainMagic(0, 'mallet'); choose(e, 'return-a'); choose(e, 'return-b');
  e.selectCardChoice(0); pass(e);
  assert.equal(e.player(0).hand.length, 3);
  assert.ok(e.player(0).hand.some(c => c.id === 'keep'));
  assert.equal(e.player(0).deck.length, size);
  assert.ok(e.player(0).graveyard.some(c => c.id === 'mallet'));
});

test('a controlled opposing witch used as tribute goes to its original owner graveyard', () => {
  const e = duel();
  e.player(0).field[0] = monster('borrowed-boss', 13, 1, 'witch');
  e.player(0).hand = [monster('own-boss', 13, 0, 'witch')];
  e.summon(0, 'own-boss', [0]);
  assert.ok(e.player(1).graveyard.some(c => c.id === 'borrowed-boss'));
  assert.equal(e.player(0).graveyard.length, 0);
});

test('Reincarnation can retrieve its discarded monster and never offers an impossible cost', () => {
  const e = duel();
  e.player(0).hand = [spell('reincarnate'), monster('discard-and-retrieve'), spell('jammer')];
  e.activateMainMagic(0, 'reincarnate');
  assert.deepEqual(e.state.pendingDecision.options.map(x => x.card.id), ['discard-and-retrieve']);
  choose(e, 'discard-and-retrieve'); choose(e, 'discard-and-retrieve'); pass(e);
  assert.ok(e.player(0).hand.some(c => c.id === 'discard-and-retrieve'));
});

test('Reborn can use either graveyard without consuming normal summon and keeps original owner', () => {
  const e = duel();
  e.player(0).hand = [spell('reborn'), monster('normal')];
  e.player(1).graveyard = [monster('enemy-boss', 13, 1, 'witch')];
  e.activateMainMagic(0, 'reborn'); choose(e, 'enemy-boss'); pass(e);
  assert.equal(e.player(0).field[0].id, 'enemy-boss');
  assert.equal(e.player(0).field[0].ownerPlayer, 1);
  assert.ok(e.canSummon(0, 'normal'));
  e.destroy(0, 0, 'battle');
  assert.equal(e.player(1).graveyard[0].id, 'enemy-boss');
});

test('Avarice returns exactly five distinct monsters and yields a net three deck cards', () => {
  const e = duel(); e.player(0).hand = [spell('avarice')];
  e.player(0).graveyard = Array.from({ length: 5 }, (_, i) => monster(`grave-${i}`));
  const before = e.player(0).deck.length;
  e.activateMainMagic(0, 'avarice');
  for (let i = 0; i < 4; i++) choose(e, `grave-${i}`);
  assert.throws(() => e.selectCardChoice(0, 'grave:0:grave-0'));
  choose(e, 'grave-4'); pass(e);
  assert.equal(e.player(0).deck.length, before + 3);
  assert.equal(e.player(0).hand.length, 2);
  assert.deepEqual(e.player(0).graveyard.map(c => c.id), ['avarice']);
});

test('all new choices are exposed to adapters/CPU and observations keep opponent hand identities private', () => {
  const e = duel(), a = new CharacterAdapter(e);
  e.player(0).hand = [spell('doomed'), monster('cost')]; e.player(1).field[0] = monster('target', 13, 1);
  e.activateMainMagic(0, 'doomed');
  const first = a.observation(0); e.player(1).hand = [monster('hidden-a', 3, 1)];
  const hidden = a.observation(0); e.player(1).hand = [monster('hidden-b', 13, 1)];
  assert.deepEqual(a.observation(0), hidden);
  assert.equal(first.length, OBSERVATION_SIZE);
  while (e.state.pendingDecision) {
    const player = a.currentPlayer(), action = chooseBaselineAction(a, player, () => 0);
    assert.ok(a.legalActions(player).includes(action)); a.applyAction(action, player);
  }
  assert.equal(e.player(1).field[0], null);
  assert.ok(!a.legalActions(0).includes(ACTIONS.CHOICE_BASE));
});
