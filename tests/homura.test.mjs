import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, CARD_TYPES, PHASES } from '../src/character-engine.js';
import { CharacterAdapter } from '../src/character-adapter.js';
import { encodeSummon } from '../src/rl-adapter.js';

const familiar = (id, attack = 3) => ({ id, name: id, type: CARD_TYPES.FAMILIAR, attack, rank: attack });
const witch = (id, attack = 8) => ({ id, name: id, type: CARD_TYPES.WITCH, attack, rank: attack, tributeThreshold: attack });
const magic = (id, value = 2) => ({ id, name: `攻撃力＋${value}`, type: CARD_TYPES.MAGIC, effect: 'boost', value, chainable: true });

function makeEngine() {
  const deck = prefix => Array.from({ length: 20 }, (_, i) => familiar(`${prefix}-${i}`, 2));
  return new GameEngine({
    players: [
      { id: 'p0', name: 'ほむら', character: { id: 'homura', name: '暁美ほむら', openingHandModifier: 0 } },
      { id: 'p1', name: 'まどか', character: { id: 'madoka', name: '鹿目まどか', openingHandModifier: 0 } },
    ],
    decks: [deck('h'), deck('m')],
    openingHand: 0,
    rng: () => 0.999999,
  });
}

test('Homura special only locks the opponent chain and does not grant an extra summon', () => {
  const e = makeEngine();
  const adapter = new CharacterAdapter(e);
  e.player(0).hand = [witch('witch-13', 13), familiar('familiar-5', 5)];
  e.player(0).field[0] = familiar('already-summoned', 4);
  e.player(0).summonedThisTurn = true;

  e.enterBattlePhase(0);
  assert.equal(e.state.phase, PHASES.BATTLE_START);
  e.activateSpecial(0);

  assert.equal(e.state.homuraChainLockTurn, e.state.turn);
  assert.equal(e.state.homuraChainLockPlayer, 1);
  assert.equal(e.state.homuraExtraMonsterSummon, undefined);
  assert.equal(e.canSummon(0, 'witch-13'), false);
  assert.equal(e.canSummon(0, 'familiar-5'), false);
  assert.equal(adapter.legalActions(0).includes(encodeSummon(0, 0)), false);
  assert.equal(adapter.legalActions(0).includes(encodeSummon(1, 0)), false);

  e.continueBattlePhase(0);
  assert.equal(e.state.phase, PHASES.BATTLE);
  assert.equal(e.player(0).hand.some(card => card.id === 'witch-13'), true);
  assert.equal(e.player(0).hand.some(card => card.id === 'familiar-5'), true);
});

test('Homura boost stores its effective value before the opponent responds', () => {
  const e = makeEngine();
  e.player(0).field[0] = familiar('homura-attacker', 3);
  e.player(1).field[0] = familiar('defender', 8);
  e.player(0).hand = [magic('homura-boost', 2)];
  e.player(1).hand = [magic('opponent-boost', 2)];

  e.endTurn(0);
  e.endTurn(1);
  e.enterBattlePhase(0);
  e.continueBattlePhase(0);
  e.attack(0, 0, 0);
  e.respondChain(0, 'homura-boost');

  assert.equal(e.state.pendingDecision?.type, 'CHAIN_RESPONSE');
  assert.equal(e.state.pendingDecision?.player, 1);
  assert.equal(e.state.chain.at(-1)?.card.value, 4);

  e.respondChain(1);
  const battle = e.state.events.filter(event => event.type === 'battleEnd').at(-1);
  assert.equal(battle?.attackValue, 7);
});

test('Homura attack-up magic always gains an additional +2', () => {
  const e = makeEngine();
  e.state.battle = {
    attackerPlayer: 0,
    attackerSlot: 0,
    defenderPlayer: 1,
    defenderSlot: 0,
    direct: false,
    attackerBase: 4,
    defenderBase: 4,
    attackerBonus: 0,
    defenderBonus: 0,
    damagePrevented: [false, false],
    endBattlePhase: false,
  };

  e.resolveMagic(0, magic('boost-5', 5));
  assert.equal(e.state.battle.attackerBonus, 7);
  const event = e.state.events.at(-1);
  assert.equal(event.type, 'magic');
  assert.equal(event.card.value, 7);
});

test('the +2 attack-up passive does not modify the opponent magic', () => {
  const e = makeEngine();
  e.state.battle = {
    attackerPlayer: 0,
    attackerSlot: 0,
    defenderPlayer: 1,
    defenderSlot: 0,
    direct: false,
    attackerBase: 4,
    defenderBase: 4,
    attackerBonus: 0,
    defenderBonus: 0,
    damagePrevented: [false, false],
    endBattlePhase: false,
  };

  e.resolveMagic(1, magic('enemy-boost-5', 5));
  assert.equal(e.state.battle.defenderBonus, 5);
});
