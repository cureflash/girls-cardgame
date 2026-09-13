import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS } from '../src/rl-adapter.js';
import { GameEngine, CARD_TYPES } from '../src/game-engine.js';
import { RLAdapter } from '../src/rl-adapter.js';
import { DEFAULT_GENOME, EVALUATION_POLICY_FORMAT, EVALUATION_RULES_VERSION, chooseEvaluationAction, inspectEvaluationActions, normalizeEvaluationGenome } from '../src/evaluation-ai.js';

const familiar = (id, attack) => ({ id, name: id, type: 'familiar', attack });
const witch = (id, attack) => ({ id, name: id, type: 'witch', attack });
const boost = (id, value) => ({ id, name:id, type:CARD_TYPES.MAGIC, chainable:true, effect:'boost', value });
const shield = (id) => ({ id, name:id, type:CARD_TYPES.MAGIC, chainable:true, effect:'nullifyDamage' });

function specialAdapter(opponentField, ownField = [familiar('mami-familiar', 5)]) {
  const players = [
    { character: { id: 'mami' }, deck: Array(20), hand: [], field: [...ownField, ...Array(5 - ownField.length).fill(null)], graveyard: [], specialUsed: false },
    { character: { id: 'madoka' }, deck: Array(20), hand: [], field: [...opponentField, ...Array(5 - opponentField.length).fill(null)], graveyard: [], specialUsed: false },
  ];
  const engine = {
    state: { pendingDecision: null, battle: null, chain: [] },
    player(index) { return players[index]; },
    opponent(index) { return 1 - index; },
  };
  return { engine, currentPlayer: () => 0, legalActions: () => [ACTIONS.SPECIAL, ACTIONS.CONTINUE_BATTLE] };
}

test('evaluation policy format and rules version are explicit', () => {
  assert.equal(DEFAULT_GENOME.format, EVALUATION_POLICY_FORMAT);
  assert.equal(DEFAULT_GENOME.rulesVersion, EVALUATION_RULES_VERSION);
  assert.equal(normalizeEvaluationGenome(DEFAULT_GENOME).weights.terminalWin, 1000);
});

test('default evaluation AI conserves Tiro Finale against one weak monster', () => {
  const adapter = specialAdapter([familiar('weak', 3)]);
  assert.equal(chooseEvaluationAction(adapter, 0, DEFAULT_GENOME, () => 0), ACTIONS.CONTINUE_BATTLE);
});

test('default evaluation AI uses Tiro Finale against a large board', () => {
  const adapter = specialAdapter([familiar('a', 5), familiar('b', 5), witch('w', 8)]);
  assert.equal(chooseEvaluationAction(adapter, 0, DEFAULT_GENOME, () => 0), ACTIONS.SPECIAL);
});

test('action inspection exposes interpretable feature contributions', () => {
  const ranked = inspectEvaluationActions(specialAdapter([familiar('weak', 3)]), 0, DEFAULT_GENOME);
  const tiro = ranked.find(item => item.action === ACTIONS.SPECIAL);
  assert.ok(tiro);
  assert.equal(tiro.features.specialRemovalCount, 0.2);
  assert.ok(tiro.features.specialRemovalPower > 0);
  assert.equal(tiro.features.turnEnds, 1);
});

function shieldBattleAdapter(defender) {
  const chars = [{ id:'madoka', name:'鹿目まどか' }, { id:'mami', name:'巴マミ' }];
  const pad = Array.from({ length: 20 }, (_, i) => familiar(`pad${i}`, 2));
  const engine = new GameEngine({
    players: chars.map((character, i) => ({ id:`p${i}`, name:character.name, character })),
    decks: [pad, pad.map((card, i) => ({ ...card, id:`m${i}` }))],
    openingHand: 0,
    rng: () => 0.999999,
  });
  engine.endTurn(0);
  engine.player(1).field[0] = familiar('attacker', 5);
  engine.player(0).field[0] = defender;
  engine.player(1).hand = [boost('up', 5)];
  engine.player(0).hand = [shield('shield')];
  engine.enterBattlePhase(1);
  engine.continueBattlePhase(1);
  engine.attack(1, 0, 0);
  engine.respondChain(1, 'up');
  return new RLAdapter(engine);
}

test('shield action projection treats battle damage as zero', () => {
  const ranked = inspectEvaluationActions(shieldBattleAdapter(familiar('defender', 8)), 0, DEFAULT_GENOME);
  const pass = ranked.find(item => item.action === ACTIONS.PASS);
  const useShield = ranked.find(item => item.action !== ACTIONS.PASS);
  assert.ok(pass.features.damageToSelf > 0);
  assert.equal(useShield.features.shieldUse, 1);
  assert.equal(useShield.features.damageToSelf, 0);
});

test('shield action projection preserves a witch from destruction', () => {
  const ranked = inspectEvaluationActions(shieldBattleAdapter(witch('defender-witch', 8)), 0, DEFAULT_GENOME);
  const useShield = ranked.find(item => item.action !== ACTIONS.PASS);
  assert.equal(useShield.features.shieldUse, 1);
  assert.equal(useShield.features.damageToSelf, 0);
  assert.equal(useShield.features.ownPowerLost, 0);
  assert.equal(useShield.features.shieldSavedPower, 8 / 13);
});
