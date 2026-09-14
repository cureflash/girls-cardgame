import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, CARD_TYPES, PHASES } from '../src/character-engine.js';
import { CharacterAdapter } from '../src/character-adapter.js';
import { encodeSummon } from '../src/rl-adapter.js';

const familiar = (id, attack = 3) => ({ id, name: id, type: CARD_TYPES.FAMILIAR, attack, rank: attack });
const witch = (id, attack = 8) => ({ id, name: id, type: CARD_TYPES.WITCH, attack, rank: attack, tributeThreshold: attack });

function makeEngine() {
  const deck = prefix => Array.from({ length: 20 }, (_, i) => familiar(`${prefix}-${i}`, 2));
  return new GameEngine({
    players: [
      { id: 'p0', name: 'ほむら', character: { id: 'homura', name: '暁美ほむら', openingHandModifier: 1 } },
      { id: 'p1', name: 'まどか', character: { id: 'madoka', name: '鹿目まどか', openingHandModifier: 0 } },
    ],
    decks: [deck('h'), deck('m')],
    openingHand: 0,
    rng: () => 0.999999,
  });
}

test('Homura special enables one tribute-free witch summon before battle', () => {
  const e = makeEngine();
  const adapter = new CharacterAdapter(e);
  e.player(0).hand = [witch('witch-13', 13), witch('witch-8', 8)];
  e.player(0).field[0] = familiar('already-summoned', 4);
  e.player(0).summonedThisTurn = true;

  e.enterBattlePhase(0);
  assert.equal(e.state.phase, PHASES.BATTLE_START);
  e.activateSpecial(0);

  assert.equal(e.state.homuraChainLockTurn, e.state.turn);
  assert.equal(e.state.homuraChainLockPlayer, 1);
  assert.deepEqual(e.validTributeSets(0, e.player(0).hand[0]), [{ slots: [], handIds: [], total: 0, homuraFree: true }]);
  assert.equal(e.canSummon(0, 'witch-13'), true);
  assert.equal(adapter.legalActions(0).includes(encodeSummon(0, 0)), true);

  adapter.applyAction(encodeSummon(0, 0), 0);

  assert.equal(e.player(0).field.some(card => card?.id === 'witch-13'), true);
  assert.equal(e.player(0).hand.some(card => card.id === 'witch-13'), false);
  assert.equal(e.state.homuraExtraWitchSummon, null);
  assert.equal(e.canSummon(0, 'witch-8'), false, 'the extra summon is limited to one witch');
});

test('Homura may skip the extra witch summon and proceed to battle', () => {
  const e = makeEngine();
  e.player(0).hand = [witch('witch-8', 8)];
  e.enterBattlePhase(0);
  e.activateSpecial(0);
  assert.equal(e.canSummon(0, 'witch-8'), true);

  e.continueBattlePhase(0);

  assert.equal(e.state.phase, PHASES.BATTLE);
  assert.equal(e.state.homuraExtraWitchSummon, null);
  assert.equal(e.player(0).hand.some(card => card.id === 'witch-8'), true);
});
