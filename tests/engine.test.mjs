import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, CARD_TYPES, PHASES } from '../src/game-engine.js';
import { createMadokaDeck } from '../src/card-data.js';

const familiar = (id, atk) => ({ id, name:id, type:CARD_TYPES.FAMILIAR, attack:atk, rank:atk });
const witch = (id, atk, threshold) => ({ id, name:id, type:CARD_TYPES.WITCH, attack:atk, tributeThreshold:threshold, rank:atk });
const boost = (id, value) => ({ id, name:id, type:CARD_TYPES.MAGIC, chainable:true, effect:'boost', value });
const nullify = (id) => ({ id, name:id, type:CARD_TYPES.MAGIC, chainable:true, effect:'nullifyDamage' });
const drawTwo = (id) => ({ id, name:id, type:CARD_TYPES.MAGIC, chainable:false, effect:'draw', value:2 });
const chars = {
  madoka:{id:'madoka',name:'鹿目まどか'},
  mami:{id:'mami',name:'巴マミ'},
};

function engine() {
  const pad = Array.from({length:20},(_,i)=>familiar(`pad${i}`,2));
  return new GameEngine({
    players:[{id:'a',name:'A',character:chars.madoka},{id:'b',name:'B',character:chars.mami}],
    decks:[[familiar('f8',8),boost('s6',6),nullify('ace'),witch('w12',12,8),...pad],[familiar('f5',5),boost('s10',10),...pad.map((c,i)=>({...c,id:`b${i}`}))]],
    openingHand:0,
    rng:()=>0.999999,
  });
}

test('Mami starts with one additional card', () => {
  const e = engine();
  assert.equal(e.player(0).hand.length, 0);
  assert.equal(e.player(1).hand.length, 1);
});

test('witch requires familiar tribute attack threshold in main phase', () => {
  const e = engine();
  const p=e.player(0);
  p.hand=[familiar('f8x',8),witch('wx',12,8)];
  e.summon(0,'f8x');
  e.passPriorityTo(0);
  e.summon(0,'wx',[0]);
  assert.equal(p.field.filter(Boolean).length,1);
  assert.equal(p.field.find(Boolean).id,'wx');
  assert.equal(p.graveyard.some(c=>c.id==='f8x'),true);
});

test('summoning is main-phase only and attacking is battle-phase only', () => {
  const e = engine();
  e.player(0).hand=[familiar('f3',3)];
  e.player(0).field[0]=familiar('atk',5);
  e.player(1).field[0]=familiar('def',4);

  assert.equal(e.state.phase, PHASES.MAIN);
  assert.equal(e.canSummon(0,'f3'), true);
  assert.equal(e.canAttack(0,0,0), false);
  assert.throws(() => e.attack(0,0,0));

  e.enterBattlePhase(0);
  assert.equal(e.state.phase, PHASES.BATTLE_START);
  assert.equal(e.canSummon(0,'f3'), false);
  assert.equal(e.canAttack(0,0,0), false);

  e.continueBattlePhase(0);
  assert.equal(e.state.phase, PHASES.BATTLE);
  assert.equal(e.canSummon(0,'f3'), false);
  assert.equal(e.canAttack(0,0,0), false, 'first player still cannot attack on turn 1');
});

test('Madoka reduces battle damage by one and chain resolution returns to battle phase', () => {
  const e = engine();
  e.endTurn(0);
  e.player(1).field[0]=familiar('atk',8);
  e.player(0).field[0]=familiar('def',5);
  e.enterBattlePhase(1);
  e.continueBattlePhase(1);
  const before=e.player(0).deck.length;
  e.attack(1,0,0);
  while(e.state.pendingDecision) e.respondChain(e.state.pendingDecision.player,null);
  assert.equal(before-e.player(0).deck.length,2);
  assert.equal(e.state.phase, PHASES.BATTLE);
});

test('Tiro Finale is available only at battle start and skips the battle phase', () => {
  const e=engine();
  e.player(0).field[0]=familiar('a1',3);
  e.player(1).field[0]=familiar('b1',4);
  e.endTurn(0);

  assert.equal(e.canUseSpecial(1), false);
  e.enterBattlePhase(1);
  assert.equal(e.state.phase, PHASES.BATTLE_START);
  assert.equal(e.canUseSpecial(1), true);

  e.activateSpecial(1);
  assert.equal(e.player(0).field.filter(Boolean).length,0);
  assert.equal(e.player(1).field.filter(Boolean).length,0);
  assert.equal(e.state.pendingDecision,null);
  assert.equal(e.state.activePlayer,0);
  assert.equal(e.state.phase,PHASES.MAIN);
  assert.equal(e.state.turn,3);
});

test('Pluvia Magica revives one monster then skips battle and ends the turn', () => {
  const e=engine();
  e.player(0).graveyard.push(familiar('dead',7));

  assert.equal(e.canUseSpecial(0), false);
  e.enterBattlePhase(0);
  assert.equal(e.canUseSpecial(0), true);
  e.activateSpecial(0);
  assert.equal(e.state.pendingDecision.type,'MADOKA_REVIVE');

  e.selectReviveTarget(0,'dead');
  assert.equal(e.player(0).field.some(c=>c?.id==='dead'),true);
  assert.equal(e.state.activePlayer,1);
  assert.equal(e.state.phase,PHASES.MAIN);
  assert.equal(e.state.turn,2);
});

test('continuing past battle start closes the special-move window', () => {
  const e=engine();
  e.player(0).graveyard.push(familiar('dead',7));
  e.enterBattlePhase(0);
  assert.equal(e.canUseSpecial(0), true);
  e.continueBattlePhase(0);
  assert.equal(e.state.phase,PHASES.BATTLE);
  assert.equal(e.canUseSpecial(0), false);
  assert.throws(() => e.activateSpecial(0));
});

test('chain prompts both players and resolves back into battle phase', () => {
  const e=engine();
  e.endTurn(0);
  e.endTurn(1);
  e.player(0).field[0]=familiar('a5',5);
  e.player(1).field[0]=familiar('b8',8);
  e.player(0).hand=[boost('p0s10',10)];
  e.player(1).hand=[boost('p1s6',6)];

  e.enterBattlePhase(0);
  e.continueBattlePhase(0);
  e.attack(0,0,0);
  assert.equal(e.state.phase,PHASES.CHAIN);
  assert.equal(e.state.pendingDecision.player,0);
  e.respondChain(0,'p0s10');
  assert.equal(e.state.pendingDecision.player,1);
  e.respondChain(1,'p1s6');
  assert.equal(e.state.pendingDecision,null);
  assert.equal(e.player(1).field[0],null);
  assert.equal(e.state.phase,PHASES.BATTLE);
});

test('draw-two magic remains a main-phase action', () => {
  const e=engine();
  const p=e.player(0);
  p.hand=[drawTwo('cup')];
  const before=p.deck.length;
  e.activateMainMagic(0,'cup');
  assert.equal(p.hand.length,2);
  assert.equal(before-p.deck.length,2);
  assert.equal(p.graveyard.some(c=>c.id==='cup'),true);
});

test('main-phase magic is not legal after entering battle phase', () => {
  const e=engine();
  const p=e.player(0);
  p.hand=[drawTwo('cup')];
  e.enterBattlePhase(0);
  assert.equal(e.canActivateMainMagic(0,'cup'), false);
  assert.throws(() => e.activateMainMagic(0,'cup'));
});

test('Madoka deck is exactly 30 cards with the agreed distribution', () => {
  const deck=createMadokaDeck();
  assert.equal(deck.length,30);
  assert.equal(deck.filter(c=>c.type===CARD_TYPES.FAMILIAR).length,12);
  assert.equal(deck.filter(c=>c.type===CARD_TYPES.WITCH).length,6);
  assert.equal(deck.filter(c=>c.type===CARD_TYPES.MAGIC).length,12);
  assert.equal(deck.filter(c=>c.type===CARD_TYPES.WITCH && c.attack===8).length,4);
  assert.equal(deck.filter(c=>c.type===CARD_TYPES.WITCH && c.attack===10).length,2);
  assert.deepEqual(deck.filter(c=>c.effect==='boost').map(c=>c.value).sort((a,b)=>a-b),[2,2,2,3,3,3,5]);
  assert.equal(deck.filter(c=>c.effect==='draw').length,2);
  assert.equal(deck.filter(c=>c.effect==='nullifyDamage').length,3);
});
