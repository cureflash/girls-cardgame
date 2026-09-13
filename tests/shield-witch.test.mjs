import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, CARD_TYPES, PHASES } from '../src/game-engine.js';

const familiar = (id, attack) => ({ id, name: id, type: CARD_TYPES.FAMILIAR, attack, rank: attack });
const witch = (id, attack) => ({ id, name: id, type: CARD_TYPES.WITCH, attack, rank: attack, tributeThreshold: attack });
const shield = id => ({ id, name: '盾', type: CARD_TYPES.MAGIC, chainable: true, effect: 'nullifyDamage', value: 0 });

function createEngine() {
  const padA = Array.from({ length: 20 }, (_, i) => familiar(`a-pad-${i}`, 1));
  const padB = Array.from({ length: 20 }, (_, i) => familiar(`b-pad-${i}`, 1));
  return new GameEngine({
    players: [
      { id: 'a', name: 'A', character: { id: 'test-a' } },
      { id: 'b', name: 'B', character: { id: 'test-b' } },
    ],
    decks: [padA, padB],
    openingHand: 0,
    rng: () => 0.999999,
  });
}

test('shield can protect a witch in battle', () => {
  const e = createEngine();
  e.player(0).field[0] = witch('defender-witch', 8);
  e.player(0).hand = [shield('shield')];
  e.player(1).field[0] = familiar('attacker', 10);

  e.endTurn(0);
  e.enterBattlePhase(1);
  e.continueBattlePhase(1);

  const deckBefore = e.player(0).deck.length;
  e.attack(1, 0, 0);

  assert.equal(e.state.pendingDecision?.player, 0);
  assert.equal(e.state.pendingDecision?.options.includes('shield'), true);

  e.respondChain(0, 'shield');

  assert.equal(e.player(0).field[0]?.id, 'defender-witch');
  assert.equal(e.player(0).deck.length, deckBefore);
  assert.equal(e.player(0).graveyard.some(card => card.id === 'shield'), true);
  assert.equal(e.state.phase, PHASES.BATTLE);
  assert.equal(e.state.battlePhaseEnded, true);
});
