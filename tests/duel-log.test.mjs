import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, CARD_TYPES } from '../src/game-engine.js';
import { captureDuelState, createDuelTrace, recordDuelStep, buildDuelLog } from '../src/duel-log.js';

const familiar = (id, attack) => ({ id, code: id, name: id, type: CARD_TYPES.FAMILIAR, attack, rank: attack });

function engine() {
  const deckA = Array.from({ length: 8 }, (_, i) => familiar(`a${i}`, 3));
  const deckB = Array.from({ length: 8 }, (_, i) => familiar(`b${i}`, 4));
  return new GameEngine({
    players: [
      { id: 'p0', name: 'A', character: { id: 'madoka' } },
      { id: 'p1', name: 'B', character: { id: 'mami' } },
    ],
    decks: [deckA, deckB],
    openingHand: 1,
    rng: () => 0.999999,
  });
}

test('duel log records decision state, action, legal actions, events, and result without deck order', () => {
  const e = engine();
  const trace = createDuelTrace({ engine: e, mode: 'cpu', humanSeat: 0, rulesVersion: 'test', ai: 'baseline-ai' });
  const actor = 0;
  const before = captureDuelState(e);
  const eventStart = e.state.events.length;
  const card = e.player(0).hand[0];

  e.summon(0, card.id);
  recordDuelStep(trace, {
    engine: e,
    actor,
    controller: 'human',
    action: { type: 'summon', cardId: card.id },
    legalActions: [123],
    eventStart,
    before,
  });

  const log = buildDuelLog(trace, e);
  assert.equal(log.format, 'girls-cardgame-duel-log');
  assert.equal(log.steps.length, 1);
  assert.equal(log.steps[0].action.type, 'summon');
  assert.deepEqual(log.steps[0].legalActionIds, [123]);
  assert.equal(log.steps[0].before.players[0].hand[0].id, card.id);
  assert.equal(log.steps[0].after.players[0].field[0].id, card.id);
  assert.equal(log.steps[0].events.some(event => event.type === 'summon'), true);
  assert.equal('deck' in log.steps[0].before.players[0], false);
  assert.equal(typeof log.steps[0].before.players[0].deckCount, 'number');
  assert.equal(log.result.finished, false);
});
