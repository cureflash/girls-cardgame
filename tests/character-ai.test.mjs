import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GENOME } from '../src/evaluation-ai.js';
import { baselineGenome, chooseBaselineAction } from '../src/baseline-ai.js';
import { GameEngine, PHASES, CARD_TYPES } from '../src/character-engine.js';
import { CharacterAdapter } from '../src/character-adapter.js';
import { CHARACTERS, createPlayerDeck, createNpcDeck } from '../src/card-data.js';
import { ACTIONS, encodeAttack } from '../src/rl-adapter.js';
import { MATCH_VARIANTS, playSeries } from '../ga/match.mjs';

test('browser baseline exposes separate Madoka and Mami policy slots', () => {
  const pair = baselineGenome();
  assert.ok(pair.madoka);
  assert.ok(pair.mami);
  assert.equal(baselineGenome('madoka'), pair.madoka);
  assert.equal(baselineGenome('mami'), pair.mami);
});

test('character-bound series evaluates both seat arrangements', () => {
  const result = playSeries(DEFAULT_GENOME, DEFAULT_GENOME, { seed: 123, repeats: 2, maxActions: 600 });
  assert.equal(MATCH_VARIANTS.length, 2);
  assert.equal(result.games, 4);
  assert.equal(result.winsMadoka + result.winsMami + result.draws, result.games);
  assert.deepEqual(new Set(result.details.map(detail => detail.madokaSeat)), new Set([0, 1]));
  for (const detail of result.details) {
    assert.ok(['madoka', 'mami', null].includes(detail.winnerCharacter));
    assert.equal(detail.madokaSeat + detail.mamiSeat, 1);
  }
});

function monster(id, attack, type = CARD_TYPES.FAMILIAR) {
  return { id, name: id, type, attack, rank: attack, tributeThreshold: type === CARD_TYPES.WITCH ? attack : undefined };
}

function magic(id, effect, value = 0) {
  return { id, name: id, type: CARD_TYPES.MAGIC, effect, value, chainable: true };
}

function nagisaEngine() {
  const engine = new GameEngine({
    players: [
      { id: 'p0', name: CHARACTERS.nagisa.name, character: CHARACTERS.nagisa },
      { id: 'p1', name: CHARACTERS.mami.name, character: CHARACTERS.mami },
    ],
    decks: [createPlayerDeck('nagisa'), createNpcDeck('mami')],
    rng: () => 0.5,
  });
  engine.state.phase = PHASES.BATTLE_START;
  engine.state.activePlayer = 0;
  engine.state.priorityPlayer = 0;
  engine.state.pendingDecision = null;
  engine.state.chain = [];
  engine.state.chainPassCount = 0;
  engine.player(0).hand = [];
  engine.player(1).hand = [];
  engine.player(0).field = Array(5).fill(null);
  engine.player(1).field = Array(5).fill(null);
  engine.player(0).specialUsed = false;
  return engine;
}

test('Nagisa special can choose attackers from both fields and can be ended early', () => {
  const engine = nagisaEngine();
  engine.player(0).field[0] = monster('own-6', 6);
  engine.player(0).field[1] = monster('own-8', 8);
  engine.player(1).field[0] = monster('enemy-3', 3);
  engine.player(1).field[1] = monster('enemy-10', 10, CARD_TYPES.WITCH);

  engine.activateSpecial(0);
  assert.equal(engine.state.pendingDecision.type, 'NAGISA_ATTACKER');
  assert.deepEqual(engine.state.pendingDecision.ownOptions, [0, 1]);
  assert.deepEqual(engine.state.pendingDecision.opponentOptions, [0, 1]);
  assert.equal(engine.state.pendingDecision.allowEnd, true);

  engine.endNagisaSpecial(0);
  assert.equal(engine.state.activePlayer, 1);
  assert.equal(engine.player(0).specialUsed, true);
});

test('Nagisa can force multiple battles and direct attack after the opponent field is empty', () => {
  const engine = nagisaEngine();
  engine.player(0).field[0] = monster('own-10', 10);
  engine.player(0).field[1] = monster('own-5', 5);
  engine.player(1).field[0] = monster('enemy-3', 3);

  engine.activateSpecial(0);
  engine.selectNagisaAttacker(0, 'self', 0);
  assert.equal(engine.state.pendingDecision.directAllowed, false);
  assert.deepEqual(engine.state.pendingDecision.opponentTargets, [0]);
  engine.resolveNagisaForcedBattle(0, 'opponent', 0);

  assert.equal(engine.player(1).field[0], null);
  assert.equal(engine.state.pendingDecision.type, 'NAGISA_ATTACKER');
  assert.deepEqual(engine.state.pendingDecision.ownOptions, [1]);

  engine.selectNagisaAttacker(0, 'self', 1);
  assert.equal(engine.state.pendingDecision.directAllowed, true);
  engine.resolveNagisaForcedBattle(0, 'direct');

  const forcedDamage = engine.state.events.filter(event => event.type === 'damage' && event.forced);
  assert.ok(forcedDamage.some(event => event.player === 1 && event.direct === false && event.amount === 7));
  assert.ok(forcedDamage.some(event => event.player === 1 && event.direct === true && event.amount === 5));
  assert.equal(engine.state.activePlayer, 1);
});

test('a lone opponent monster can be forced to attack its owner directly', () => {
  const engine = nagisaEngine();
  engine.player(1).field[0] = monster('enemy-5', 5);

  assert.equal(engine.canUseSpecial(0), true);
  engine.activateSpecial(0);
  assert.deepEqual(engine.state.pendingDecision.opponentOptions, [0]);
  engine.selectNagisaAttacker(0, 'opponent', 0);
  assert.equal(engine.state.pendingDecision.directAllowed, true);
  assert.deepEqual(engine.state.pendingDecision.ownTargets, []);
  engine.resolveNagisaForcedBattle(0, 'direct');

  const forcedDamage = engine.state.events.filter(event => event.type === 'damage' && event.forced);
  assert.ok(forcedDamage.some(event => event.player === 1 && event.direct === true && event.amount === 5));
  assert.equal(engine.player(1).field[0]?.id, 'enemy-5');
  assert.equal(engine.state.activePlayer, 1);
});

test('Nagisa passive returns the first familiar destroyed by battle each turn to hand', () => {
  const engine = nagisaEngine();
  engine.player(0).field[0] = monster('familiar-a', 3);
  engine.player(0).field[1] = monster('familiar-b', 4);

  engine.destroy(0, 0, 'battle');
  assert.equal(engine.player(0).field[0], null);
  assert.ok(engine.player(0).hand.some(card => card.id === 'familiar-a'));
  assert.ok(!engine.player(0).graveyard.some(card => card.id === 'familiar-a'));

  engine.destroy(0, 1, 'battle');
  assert.equal(engine.player(0).field[1], null);
  assert.ok(engine.player(0).graveyard.some(card => card.id === 'familiar-b'));
  assert.ok(!engine.player(0).hand.some(card => card.id === 'familiar-b'));
});

test('Nagisa passive does not return witches or familiars destroyed outside battle', () => {
  const engine = nagisaEngine();
  engine.player(0).field[0] = monster('witch-8', 8, CARD_TYPES.WITCH);
  engine.destroy(0, 0, 'battle');
  assert.ok(engine.player(0).graveyard.some(card => card.id === 'witch-8'));

  engine.player(0).field[1] = monster('familiar-special', 3);
  engine.destroy(0, 1, 'special');
  assert.ok(engine.player(0).graveyard.some(card => card.id === 'familiar-special'));
  assert.ok(!engine.player(0).hand.some(card => card.id === 'familiar-special'));
});

test('during Nagisa forced battle only Nagisa can use attack-up or shield', () => {
  const engine = nagisaEngine();
  const enemyBoost = magic('enemy-boost', 'boost', 5);
  const enemyShield = magic('enemy-shield', 'nullifyDamage', 0);
  const nagisaBoost = magic('nagisa-boost', 'boost', 5);
  const nagisaShield = magic('nagisa-shield', 'nullifyDamage', 0);
  engine.player(0).field[0] = monster('own-5', 5);
  engine.player(1).field[0] = monster('enemy-7', 7);
  engine.player(1).hand = [enemyBoost, enemyShield];
  engine.player(0).hand = [nagisaBoost, nagisaShield];

  engine.activateSpecial(0);
  engine.selectNagisaAttacker(0, 'self', 0);
  engine.resolveNagisaForcedBattle(0, 'opponent', 0);

  assert.equal(engine.state.pendingDecision.type, 'CHAIN_RESPONSE');
  assert.equal(engine.state.pendingDecision.player, 0);
  assert.equal(engine.canActivateMagic(1, enemyBoost), false);
  assert.equal(engine.canActivateMagic(1, enemyShield), false);
  assert.equal(engine.canActivateMagic(0, nagisaBoost), true);
  assert.equal(engine.canActivateMagic(0, nagisaShield), true);
  assert.ok(engine.state.pendingDecision.options.includes('nagisa-boost'));
  assert.ok(engine.state.pendingDecision.options.includes('nagisa-shield'));
});

test('Nagisa baseline AI completes multi-control special decisions legally', () => {
  const engine = nagisaEngine();
  engine.player(0).field[0] = monster('own-10', 10);
  engine.player(0).field[1] = monster('own-6', 6);
  engine.player(1).field[0] = monster('enemy-3', 3);
  engine.player(1).field[1] = monster('enemy-9', 9);
  const adapter = new CharacterAdapter(engine);

  let action = chooseBaselineAction(adapter, 0, () => 0.5);
  assert.ok(adapter.legalActions(0).includes(action));
  if (action !== ACTIONS.SPECIAL) return;

  adapter.applyAction(action, 0);
  let guard = 0;
  while (engine.state.activePlayer === 0 && engine.state.phase !== PHASES.GAME_OVER && guard++ < 30) {
    action = chooseBaselineAction(adapter, adapter.currentPlayer(), () => 0.5);
    assert.ok(adapter.legalActions(adapter.currentPlayer()).includes(action));
    adapter.applyAction(action, adapter.currentPlayer());
  }
  assert.ok(guard < 30);
});

function homuraEngine() {
  const engine = new GameEngine({
    players: [
      { id: 'p0', name: CHARACTERS.homura.name, character: CHARACTERS.homura },
      { id: 'p1', name: CHARACTERS.mami.name, character: CHARACTERS.mami },
    ],
    decks: [createPlayerDeck('homura'), createNpcDeck('mami')],
    rng: () => 0.5,
  });
  engine.state.turn = 4;
  engine.state.phase = PHASES.BATTLE_START;
  engine.state.activePlayer = 0;
  engine.state.priorityPlayer = 0;
  engine.state.pendingDecision = null;
  engine.state.chain = [];
  engine.state.chainPassCount = 0;
  engine.player(0).field = Array(5).fill(null);
  engine.player(1).field = Array(5).fill(null);
  engine.player(0).hand = [];
  engine.player(1).hand = [];
  engine.player(0).specialUsed = false;
  return engine;
}

test('Homura AI refuses special when the current special turn cannot one-shot', () => {
  const engine = homuraEngine();
  engine.player(0).field[0] = monster('homura-3', 3);
  engine.player(0).hand = [monster('homura-free-13', 13, CARD_TYPES.WITCH)];
  engine.player(1).deck = Array.from({ length: 30 }, (_, i) => monster(`opp-deck-${i}`, 3));
  const adapter = new CharacterAdapter(engine);

  const action = chooseBaselineAction(adapter, 0, () => 0.5);
  assert.notEqual(action, ACTIONS.SPECIAL);
  assert.ok(adapter.legalActions(0).includes(action));
});

test('Homura AI uses special only when it has a deterministic one-shot line and follows that line', () => {
  const engine = homuraEngine();
  engine.player(0).field[0] = monster('homura-3', 3);
  engine.player(0).hand = [monster('homura-free-13', 13, CARD_TYPES.WITCH)];
  engine.player(1).deck = Array.from({ length: 13 }, (_, i) => monster(`opp-deck-${i}`, 3));
  const adapter = new CharacterAdapter(engine);

  let action = chooseBaselineAction(adapter, 0, () => 0.5);
  assert.equal(action, ACTIONS.SPECIAL);
  adapter.applyAction(action, 0);

  let guard = 0;
  while (engine.state.phase !== PHASES.GAME_OVER && guard++ < 20) {
    const player = adapter.currentPlayer();
    action = chooseBaselineAction(adapter, player, () => 0.5);
    assert.ok(adapter.legalActions(player).includes(action));
    adapter.applyAction(action, player);
  }

  assert.equal(engine.state.phase, PHASES.GAME_OVER);
  assert.equal(engine.state.winner, 0);
  assert.equal(engine.player(0).specialUsed, true);
  assert.ok(guard < 20);
});

test('Homura AI will not take a non-special lethal direct attack', () => {
  const engine = homuraEngine();
  engine.state.phase = PHASES.BATTLE;
  engine.player(0).field[0] = monster('homura-lethal-5', 5);
  engine.player(1).deck = Array.from({ length: 5 }, (_, i) => monster(`opp-deck-${i}`, 3));
  const adapter = new CharacterAdapter(engine);
  const lethal = encodeAttack(0, null);

  assert.ok(adapter.legalActions(0).includes(lethal));
  const action = chooseBaselineAction(adapter, 0, () => 0.5);
  assert.notEqual(action, lethal);
  assert.ok(adapter.legalActions(0).includes(action));
});
