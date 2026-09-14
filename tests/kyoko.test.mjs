import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { GameEngine, PHASES } from '../src/three-character-engine.js';
import { ThreeCharacterAdapter } from '../src/three-character-adapter.js';
import { ACTIONS } from '../src/rl-adapter.js';

function makeEngine() {
  return new GameEngine({
    players: [
      { id: 'p0', name: CHARACTERS.kyoko.name, character: CHARACTERS.kyoko },
      { id: 'p1', name: CHARACTERS.madoka.name, character: CHARACTERS.madoka },
    ],
    decks: [createDeck('kyoko'), createDeck('madoka')],
    rng: () => 0.5,
  });
}

function makeHomuraEngine(opponent = 'mami') {
  return new GameEngine({
    players: [
      { id: 'p0', name: CHARACTERS.homura.name, character: CHARACTERS.homura },
      { id: 'p1', name: CHARACTERS[opponent].name, character: CHARACTERS[opponent] },
    ],
    decks: [createDeck('homura'), createDeck(opponent)],
    rng: () => 0.5,
  });
}

function mechanicalDeck(character) {
  return createDeck(character).map(card => ({
    type: card.type,
    attack: card.attack ?? null,
    rank: card.rank ?? null,
    tributeThreshold: card.tributeThreshold ?? null,
    effect: card.effect ?? null,
    value: card.value ?? null,
    chainable: card.chainable ?? null,
  }));
}

function setBattleStart(engine) {
  engine.state.phase = PHASES.BATTLE_START;
  engine.state.activePlayer = 0;
  engine.state.priorityPlayer = 0;
  engine.state.pendingDecision = null;
  engine.state.turn = 5;
  engine.player(0).specialUsed = false;
}

function firstBy(deck, type, attack) {
  return { ...deck.find(card => card.type === type && card.attack === attack) };
}

test('Kyoko and Homura decks are mechanically identical to the shared deck', () => {
  const base = mechanicalDeck('madoka');
  for (const character of ['mami', 'sayaka', 'kyoko', 'homura']) assert.deepEqual(mechanicalDeck(character), base);
  assert.equal(base.length, 30);
  assert.equal(CHARACTERS.kyoko.passive, 'なし');
  assert.equal(CHARACTERS.homura.passive, '初期手札が3枚多い');
  assert.equal(CHARACTERS.homura.special, '戦闘前に手札の使い魔・魔女1体を生贄なしで追加召喚可能＋発動ターン中、相手はチェーン不可');
  assert.deepEqual([...new Set(createDeck('kyoko').filter(card => card.type === 'witch').map(card => card.tributeThreshold))].sort((a, b) => a - b), [8, 10, 13]);
  assert.deepEqual([...new Set(createDeck('homura').filter(card => card.type === 'witch').map(card => card.tributeThreshold))].sort((a, b) => a - b), [8, 10, 13]);
});

test('Kyoko can use one opposing ATK 10 monster plus her own ATK 3 familiar to summon an ATK 13 witch', () => {
  const engine = makeEngine();
  const adapter = new ThreeCharacterAdapter(engine);
  const own = engine.player(0);
  const opponent = engine.player(1);
  const ownDeck = createDeck('kyoko');
  const oppDeck = createDeck('madoka');
  const witch13 = firstBy(ownDeck, 'witch', 13);
  const familiar3 = firstBy(ownDeck, 'familiar', 3);
  const target10 = firstBy(oppDeck, 'witch', 10);
  own.hand = [witch13, familiar3];
  own.field = Array(5).fill(null);
  own.graveyard = [];
  opponent.field = [target10, null, null, null, null];
  opponent.graveyard = [];
  setBattleStart(engine);

  assert.equal(engine.canUseSpecial(0), true);
  adapter.applyAction(ACTIONS.SPECIAL, 0);
  assert.equal(engine.state.pendingDecision.type, 'KYOKO_OPPONENT_TRIBUTE');
  adapter.applyAction(adapter.legalActions(0)[0], 0);
  assert.equal(engine.state.pendingDecision.type, 'KYOKO_WITCH_SUMMON');
  const summonActions = adapter.legalActions(0);
  assert.ok(summonActions.length > 0);
  adapter.applyAction(summonActions[0], 0);

  assert.equal(opponent.field[0], null);
  assert.equal(opponent.graveyard.some(card => card.id === target10.id), true);
  assert.equal(own.graveyard.some(card => card.id === familiar3.id), true);
  assert.equal(own.field.some(card => card?.id === witch13.id), true);
  assert.equal(own.specialUsed, true);
  assert.equal(engine.state.turn, 6);
  assert.equal(engine.state.activePlayer, 1);
  const event = engine.state.events.find(item => item.type === 'opponentTribute');
  assert.equal(event?.card.id, target10.id);
});

test('Kyoko can summon an ATK 13 witch using only one opposing ATK 13 monster as tribute', () => {
  const engine = makeEngine();
  const adapter = new ThreeCharacterAdapter(engine);
  const own = engine.player(0);
  const opponent = engine.player(1);
  const witch13 = firstBy(createDeck('kyoko'), 'witch', 13);
  const target13 = firstBy(createDeck('madoka'), 'witch', 13);
  own.hand = [witch13];
  own.field = Array(5).fill(null);
  own.graveyard = [];
  opponent.field = [target13, null, null, null, null];
  opponent.graveyard = [];
  setBattleStart(engine);

  adapter.applyAction(ACTIONS.SPECIAL, 0);
  adapter.applyAction(adapter.legalActions(0)[0], 0);
  const summonActions = adapter.legalActions(0);
  assert.ok(summonActions.length > 0);
  adapter.applyAction(summonActions[0], 0);

  assert.equal(own.graveyard.length, 0);
  assert.equal(own.field.some(card => card?.id === witch13.id), true);
  assert.equal(opponent.graveyard.filter(card => card.id === target13.id).length, 1);
});

test('Kyoko special tributes only the selected opposing monster and leaves other opposing monsters in play', () => {
  const engine = makeEngine();
  const adapter = new ThreeCharacterAdapter(engine);
  const own = engine.player(0);
  const opponent = engine.player(1);
  const ownDeck = createDeck('kyoko');
  const oppDeck = createDeck('madoka');
  own.hand = [firstBy(ownDeck, 'witch', 8)];
  own.field = Array(5).fill(null);
  opponent.field = [firstBy(oppDeck, 'witch', 8), firstBy(oppDeck, 'witch', 10), null, null, null];
  const untouchedId = opponent.field[1].id;
  setBattleStart(engine);

  adapter.applyAction(ACTIONS.SPECIAL, 0);
  const targetActions = adapter.legalActions(0);
  assert.equal(targetActions.length, 2);
  adapter.applyAction(targetActions[0], 0);
  adapter.applyAction(adapter.legalActions(0)[0], 0);

  assert.equal(opponent.field[0], null);
  assert.equal(opponent.field[1]?.id, untouchedId);
  assert.equal(opponent.graveyard.length, 1);
});

test('Kyoko cannot activate her special unless an opposing monster can contribute to a legal witch summon', () => {
  const engine = makeEngine();
  const own = engine.player(0);
  const opponent = engine.player(1);
  const ownDeck = createDeck('kyoko');
  const oppDeck = createDeck('madoka');
  own.hand = [firstBy(ownDeck, 'witch', 13)];
  own.field = Array(5).fill(null);
  opponent.field = [firstBy(oppDeck, 'familiar', 3), null, null, null, null];
  setBattleStart(engine);
  assert.equal(engine.canUseSpecial(0), false);

  own.hand.push(firstBy(ownDeck, 'familiar', 5), { ...ownDeck.find(card => card.type === 'familiar' && card.attack === 5), id: 'extra-familiar-5' });
  assert.equal(engine.canUseSpecial(0), true);
});

test('Homura has no passive attack bonus in battle', () => {
  const engine = makeHomuraEngine('mami');
  const own = engine.player(0);
  const opponent = engine.player(1);
  const homuraFamiliar = firstBy(createDeck('homura'), 'familiar', 3);
  own.hand = [];
  opponent.hand = [];
  own.field = [homuraFamiliar, null, null, null, null];
  opponent.field = [firstBy(createDeck('mami'), 'familiar', 3), null, null, null, null];
  engine.state.phase = PHASES.BATTLE;
  engine.state.activePlayer = 0;
  engine.state.priorityPlayer = 0;
  engine.state.pendingDecision = null;
  engine.state.turn = 2;

  engine.attack(0, 0, 0);

  const battleEnd = engine.state.events.findLast(event => event.type === 'battleEnd');
  assert.equal(battleEnd?.attackValue, 3);
  assert.equal(battleEnd?.defendValue, 3);
  assert.equal(homuraFamiliar.attack, 3);
});

test('Homura has no passive tribute bonus', () => {
  const engine = makeHomuraEngine('mami');
  const own = engine.player(0);
  const source = createDeck('homura');
  const witch8 = firstBy(source, 'witch', 8);
  const familiars3 = source.filter(card => card.type === 'familiar' && card.attack === 3).slice(0, 2).map(card => ({ ...card }));
  own.hand = [witch8, ...familiars3];
  own.field = Array(5).fill(null);
  own.graveyard = [];
  own.summonedThisTurn = false;
  engine.state.phase = PHASES.MAIN;
  engine.state.activePlayer = 0;
  engine.state.priorityPlayer = 0;
  engine.state.pendingDecision = null;

  assert.equal(engine.validTributeSets(0, witch8).length, 0);
  assert.deepEqual(familiars3.map(card => card.attack), [3, 3]);
  assert.equal(witch8.tributeThreshold, 8);
});

test('Homura special keeps battle available, allows her boost chain, and prevents the opponent from chaining', () => {
  const engine = makeHomuraEngine('mami');
  const own = engine.player(0);
  const opponent = engine.player(1);
  const homuraDeck = createDeck('homura');
  const mamiDeck = createDeck('mami');
  const boost = { ...homuraDeck.find(card => card.type === 'magic' && card.effect === 'boost' && card.value === 2) };
  const shield = { ...mamiDeck.find(card => card.type === 'magic' && card.effect === 'nullifyDamage') };
  own.hand = [boost];
  opponent.hand = [shield];
  own.field = [firstBy(homuraDeck, 'familiar', 3), null, null, null, null];
  opponent.field = [firstBy(mamiDeck, 'familiar', 3), null, null, null, null];
  setBattleStart(engine);

  assert.equal(engine.canUseSpecial(0), true);
  engine.activateSpecial(0);
  assert.equal(own.specialUsed, true);
  assert.equal(engine.state.turn, 5);
  assert.equal(engine.state.phase, PHASES.BATTLE_START);
  assert.equal(engine.canContinueBattlePhase(0), true);

  engine.continueBattlePhase(0);
  engine.attack(0, 0, 0);
  assert.equal(engine.state.pendingDecision?.type, 'CHAIN_RESPONSE');
  assert.equal(engine.state.pendingDecision?.player, 0);
  assert.deepEqual(engine.state.pendingDecision?.options, [boost.id]);

  engine.respondChain(0, boost.id);

  assert.equal(opponent.hand.some(card => card.id === shield.id), true);
  assert.equal(own.graveyard.some(card => card.id === boost.id), true);
  assert.equal(opponent.field[0], null);
  const battleEnd = engine.state.events.findLast(event => event.type === 'battleEnd');
  assert.equal(battleEnd?.attackValue, 5);
  assert.equal(battleEnd?.defendValue, 3);
  assert.equal(engine.state.turn, 5);
  assert.equal(engine.state.activePlayer, 0);
});
