import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS } from '../src/rl-adapter.js';
import { DEFAULT_GENOME, EVALUATION_POLICY_FORMAT, EVALUATION_RULES_VERSION, chooseEvaluationAction, inspectEvaluationActions, normalizeEvaluationGenome } from '../src/evaluation-ai.js';

const familiar = (id, attack) => ({ id, name: id, type: 'familiar', attack });
const witch = (id, attack) => ({ id, name: id, type: 'witch', attack });

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
