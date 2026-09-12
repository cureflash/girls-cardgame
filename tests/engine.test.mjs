import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, CARD_TYPES } from '../src/game-engine.js';

const familiar = (id, atk) => ({ id, name:id, type:CARD_TYPES.FAMILIAR, attack:atk });
const witch = (id, atk, threshold) => ({ id, name:id, type:CARD_TYPES.WITCH, attack:atk, tributeThreshold:threshold });
const boost = (id, value) => ({ id, name:id, type:CARD_TYPES.MAGIC, chainable:true, effect:'boost', value });
const nullify = (id) => ({ id, name:id, type:CARD_TYPES.MAGIC, chainable:true, effect:'nullifyDamage' });
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

test('witch requires familiar tribute attack threshold', () => {
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

test('Madoka reduces battle damage by one', () => {
  const e = engine();
  e.state.turn=2; e.state.activePlayer=1; e.state.priorityPlayer=1;
  e.player(1).field[0]=familiar('atk',8);
  e.player(0).field[0]=familiar('def',5);
  const before=e.player(0).deck.length;
  e.attack(1,0,0);
  while(e.state.pendingDecision) e.respondChain(e.state.pendingDecision.player,null);
  assert.equal(before-e.player(0).deck.length,2);
});

test('Tiro Finale destroys all monsters and cannot be chained', () => {
  const e=engine();
  e.player(0).field[0]=familiar('a1',3);
  e.player(1).field[0]=familiar('b1',4);
  e.state.priorityPlayer=1;
  e.activateSpecial(1);
  assert.equal(e.player(0).field.filter(Boolean).length,0);
  assert.equal(e.player(1).field.filter(Boolean).length,0);
  assert.equal(e.state.pendingDecision,null);
});

test('Pluvia Magica revives one familiar or witch', () => {
  const e=engine();
  e.player(0).graveyard.push(familiar('dead',7));
  e.state.priorityPlayer=0;
  e.activateSpecial(0);
  assert.equal(e.state.pendingDecision.type,'MADOKA_REVIVE');
  e.selectReviveTarget(0,'dead');
  assert.equal(e.player(0).field.some(c=>c?.id==='dead'),true);
});

test('chain prompts the acting player, then the opponent, and resolves after both are done', () => {
  const e=engine();
  e.state.turn=2; e.state.activePlayer=0; e.state.priorityPlayer=0;
  e.player(0).field[0]=familiar('a5',5);
  e.player(1).field[0]=familiar('b8',8);
  e.player(0).hand=[boost('p0s10',10)];
  e.player(1).hand=[boost('p1s6',6)];
  e.attack(0,0,0);
  assert.equal(e.state.pendingDecision.player,0);
  e.respondChain(0,'p0s10');
  assert.equal(e.state.pendingDecision.player,1);
  e.respondChain(1,'p1s6');
  assert.equal(e.state.pendingDecision,null);
  assert.equal(e.player(1).field[0],null);
});

test('special moves can be reused whenever the player has priority', () => {
  const e=engine();
  e.state.priorityPlayer=1;
  e.activateSpecial(1);
  e.passPriorityTo(1);
  assert.equal(e.canUseSpecial(1), true);
});
