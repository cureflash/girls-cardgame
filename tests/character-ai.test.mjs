import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GENOME } from '../src/evaluation-ai.js';
import { baselineGenome, chooseBaselineAction } from '../src/baseline-ai.js';
import { GameEngine, PHASES, CARD_TYPES } from '../src/character-engine.js';
import { CharacterAdapter } from '../src/character-adapter.js';
import { CHARACTERS, createPlayerDeck, createNpcDeck } from '../src/card-data.js';
import { ACTIONS } from '../src/rl-adapter.js';
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
  assert.deepEqual(new Set(result.details.map(detail => detail.mamiSeat)), new Set([0, 1]));
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

test('Nagisa forced battle can make a lone enemy attack its own controller directly', () => {
  const engine = nagisaEngine();
  engine.player(1).field[0] = monster('enemy-5', 5);

  engine.activateSpecial(0);
  assert.equal(engine.state.pendingDecision.type, 'NAGISA_ATTACKER');
  engine.selectNagisaAttacker(0, 0);
  assert.equal(engine.state.pendingDecision.type, 'NAGISA_TARGET');
  assert.equal(engine.state.pendingDecision.directAllowed, true);
  engine.resolveNagisaForcedBattle(0, 'direct');

  const damage = engine.state.events.find(event => event.type === 'damage' && event.forced);
  assert.equal(damage.player, 1);
  assert.equal(damage.amount, 5);
  assert.equal(damage.direct, true);
  assert.equal(engine.state.activePlayer, 1);
  assert.equal(engine.player(0).specialUsed, true);
});

test('Nagisa can choose attacker and force enemy-on-enemy combat when two enemies exist', () => {
  const engine = nagisaEngine();
  engine.player(1).field[0] = monster('enemy-3', 3);
  engine.player(1).field[1] = monster('enemy-10', 10, CARD_TYPES.WITCH);

  engine.activateSpecial(0);
  engine.selectNagisaAttacker(0, 0);
  assert.deepEqual(engine.state.pendingDecision.opponentTargets, [1]);
  assert.equal(engine.state.pendingDecision.directAllowed, false);
  engine.resolveNagisaForcedBattle(0, 'opponent', 1);

  assert.equal(engine.player(1).field[0], null);
  assert.equal(engine.player(1).field[1]?.id, 'enemy-10');
  const damage = engine.state.events.find(event => event.type === 'damage' && event.forced);
  assert.equal(damage.player, 1);
  assert.equal(damage.amount, 7);
});

test('controlled attacker cannot receive magic while Nagisa defender can', () => {
  const engine = nagisaEngine();
  const enemyBoost = magic('enemy-boost', 'boost', 5);
  const nagisaBoost = magic('nagisa-boost', 'boost', 5);
  const nagisaShield = magic('nagisa-shield', 'nullifyDamage', 0);
  engine.player(1).field[0] = monster('enemy-5', 5);
  engine.player(0).field[0] = monster('own-3', 3);
  engine.player(1).hand = [enemyBoost];
  engine.player(0).hand = [nagisaBoost, nagisaShield];

  engine.activateSpecial(0);
  engine.selectNagisaAttacker(0, 0);
  engine.resolveNagisaForcedBattle(0, 'self', 0);

  assert.equal(engine.canActivateMagic(1, enemyBoost), false);
  assert.equal(engine.state.pendingDecision.type, 'CHAIN_RESPONSE');
  assert.equal(engine.state.pendingDecision.player, 0);
  assert.ok(engine.state.pendingDecision.options.includes('nagisa-boost'));
  assert.ok(engine.state.pendingDecision.options.includes('nagisa-shield'));
});

test('Nagisa AI holds the special when the forced battle value is too low', () => {
  const engine = nagisaEngine();
  engine.player(1).field[0] = monster('enemy-5', 5);
  const adapter = new CharacterAdapter(engine);

  const action = chooseBaselineAction(adapter, 0);
  assert.ok(adapter.legalActions(0).includes(action));
  assert.notEqual(action, ACTIONS.SPECIAL);
});

test('Nagisa baseline AI uses the special when the forced battle value is high and completes its staged target selection', () => {
  const engine = nagisaEngine();
  engine.player(1).field[0] = monster('enemy-13', 13);
  const adapter = new CharacterAdapter(engine);

  let action = chooseBaselineAction(adapter, 0);
  assert.equal(action, ACTIONS.SPECIAL);
  adapter.applyAction(action, 0);

  action = chooseBaselineAction(adapter, 0);
  assert.ok(adapter.legalActions(0).includes(action));
  adapter.applyAction(action, 0);

  action = chooseBaselineAction(adapter, 0);
  assert.ok(adapter.legalActions(0).includes(action));
  adapter.applyAction(action, 0);

  const damage = engine.state.events.find(event => event.type === 'damage' && event.forced);
  assert.equal(damage.player, 1);
  assert.equal(damage.amount, 13);
});
