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
  madoka:{id:'madoka',name:'鹿目まどか',openingHandModifier:0},
  mami:{id:'mami',name:'巴マミ',openingHandModifier:0},
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

test('Mami has no legacy opening-hand bonus', () => {
  const e = engine();
  assert.equal(e.player(0).hand.length, 0);
  assert.equal(e.player(1).hand.length, 0);
});

test('witch tribute consumes a monster after the next turn resets summon allowance', () => {
  const e = engine();
  const p=e.player(0);
  p.hand=[familiar('f8x',8),witch('wx',12,8)];
  e.summon(0,'f8x');
  e.passPriorityTo(0);
  assert.equal(e.canSummon(0,'wx'), false);
  e.endTurn(0); e.endTurn(1);
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
  assert.equal(e.player(1).field.filter(Boolean).length,1);
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
  assert.equal(deck.filter(c=>c.type===CARD_TYPES.FAMILIAR).length,13);
  assert.equal(deck.filter(c=>c.type===CARD_TYPES.WITCH).length,7);
  assert.equal(deck.filter(c=>c.type===CARD_TYPES.MAGIC).length,10);
  assert.equal(deck.filter(c=>c.type===CARD_TYPES.FAMILIAR && c.attack===3).length,5);
  assert.equal(deck.filter(c=>c.type===CARD_TYPES.WITCH && c.attack===8).length,4);
  assert.equal(deck.filter(c=>c.type===CARD_TYPES.WITCH && c.attack===10).length,2);
  assert.deepEqual(deck.filter(c=>c.effect==='boost').map(c=>c.value).sort((a,b)=>a-b),[2,2,2,3,3,3,5]);
  assert.equal(deck.filter(c=>c.effect==='draw').length,0);
  assert.equal(deck.filter(c=>c.effect==='nullifyDamage').length,3);
});

function battle(e, player = 1) {
  if (player === 1) e.endTurn(0); else { e.endTurn(0); e.endTurn(1); }
  e.enterBattlePhase(player); e.continueBattlePhase(player);
}
function passAll(e) { while (e.state.pendingDecision?.type === 'CHAIN_RESPONSE') e.respondChain(e.state.pendingDecision.player); }

test('opening hands are 5/5 and first player does not draw on turn one', () => {
  const e = new GameEngine({ players: [{ character: chars.madoka }, { character: chars.mami }], decks: [createMadokaDeck(), createMadokaDeck()] });
  assert.equal(e.player(0).hand.length,5); assert.equal(e.player(1).hand.length,5);
  e.endTurn(0); assert.equal(e.player(1).hand.length,6);
  e.endTurn(1); assert.equal(e.player(0).hand.length,6);
});

test('witches can tribute witches from a full field and invalid tributes leave state unchanged', () => {
  const e=engine(), p=e.player(0);
  p.hand=[witch('new13',13,13)];
  p.field=[witch('old8',8,8), familiar('five',5), familiar('three',3), familiar('four',4), familiar('other',3)];
  assert.equal(e.canSummon(0,'new13'),true);
  const before=e.snapshot();
  assert.throws(()=>e.summon(0,'new13',[0,0]));
  assert.deepEqual(e.snapshot(),before);
  e.summon(0,'new13',[0,1]);
  assert.equal(p.field[0].id,'new13'); assert.equal(p.field.filter(Boolean).length,4);
  assert.deepEqual(p.graveyard.map(c=>c.id),['old8','five']);
});

test('shield protects its familiar, ends the chain, and ends the battle phase', () => {
  const e=engine();
  e.player(0).field[0]=familiar('a',5); e.player(1).field[0]=familiar('b',5); e.player(1).field[1]=familiar('next',4);
  e.player(0).hand=[]; e.player(1).hand=[nullify('shield')];
  battle(e);
  const before=e.player(0).deck.length;
  e.attack(1,0,0);
  e.respondChain(1,'shield');
  assert.equal(e.state.pendingDecision,null);
  assert.equal(e.state.phase,PHASES.BATTLE);
  assert.equal(e.state.battlePhaseEnded,true);
  assert.equal(e.player(0).field[0],null);
  assert.equal(e.player(1).field[0].id,'b');
  assert.equal(e.player(0).deck.length,before);
  assert.equal(e.player(1).graveyard.some(c=>c.id==='shield'),true);
  assert.equal(e.canAttack(1,1,null),false);
  assert.equal(e.canEndTurn(1),true);
});

test('shield ends the chain, keeps earlier boosts spent, prevents battle damage, and ends the battle phase', () => {
  const e=engine();
  e.player(1).field[0]=familiar('attacker',5);
  e.player(1).field[1]=familiar('next',4);
  e.player(0).field[0]=familiar('defender',8);
  e.player(1).hand=[boost('up',5)];
  e.player(0).hand=[nullify('shield')];
  battle(e);
  const before=e.player(0).deck.length;
  e.attack(1,0,0);
  e.respondChain(1,'up');
  assert.equal(e.state.pendingDecision.player,0);
  e.respondChain(0,'shield');
  assert.equal(e.state.pendingDecision,null);
  assert.equal(e.state.chain.length,0);
  assert.equal(e.player(0).field[0].id,'defender');
  assert.equal(before-e.player(0).deck.length,0);
  assert.equal(e.player(1).graveyard.some(c=>c.id==='up'),true);
  assert.equal(e.player(0).graveyard.some(c=>c.id==='shield'),true);
  assert.equal(e.state.battlePhaseEnded,true);
  assert.equal(e.canAttack(1,1,0),false);
  assert.equal(e.canEndTurn(1),true);
});

test('direct attack requires an empty opponent field, applies Madoka reduction and exhausts attacker', () => {
  const e=engine(); e.player(1).field[0]=familiar('a',5);
  e.player(0).field[1]=familiar('block',3); battle(e);
  assert.equal(e.canAttack(1,0,null),false);
  e.player(0).field[1]=null;
  const before=e.player(0).deck.length;
  e.attack(1,0,null); passAll(e);
  assert.equal(before-e.player(0).deck.length,4);
  assert.equal(e.canAttack(1,0,null),false);
  assert.equal(e.state.priorityPlayer,1);
  e.endTurn(1); e.endTurn(0); e.enterBattlePhase(1); e.continueBattlePhase(1);
  assert.equal(e.canAttack(1,0,null),true);
});

test('direct attack boosts attacker and shield is not a legal direct-attack response', () => {
  const e=engine(); e.player(1).field[0]=familiar('a',5); battle(e);
  e.player(1).hand=[boost('up',3)];
  e.player(0).hand=[boost('invalid',5), nullify('shield')];
  const before=e.player(0).deck.length;
  e.attack(1,0,null);
  assert.equal(e.activatableChainCards(0).some(c=>c.id==='invalid'),false);
  assert.equal(e.activatableChainCards(0).some(c=>c.id==='shield'),false);
  e.respondChain(1,'up');
  assert.equal(before-e.player(0).deck.length,7);
  assert.equal(e.player(0).hand.some(c=>c.id==='shield'),true);
});

test('each monster attacks once and a newly summoned monster can attack', () => {
  const e=engine(); e.endTurn(0); e.player(1).hand=[familiar('new',5)];
  e.summon(1,'new'); e.passPriorityTo(1); e.enterBattlePhase(1); e.continueBattlePhase(1);
  assert.equal(e.canAttack(1,0,null),true); e.attack(1,0,null); passAll(e);
  assert.throws(()=>e.attack(1,0,null));
});

test('both specials are usable only once per duel', () => {
  for (const who of [0,1]) {
    const e=engine();
    if(who===1) e.endTurn(0);
    e.player(who).graveyard.push(familiar('dead',5));
    e.enterBattlePhase(who); e.activateSpecial(who);
    if(who===0) e.selectReviveTarget(who,'dead');
    e.endTurn(1-who); e.enterBattlePhase(who);
    assert.equal(e.player(who).specialUsed,true); assert.equal(e.canUseSpecial(who),false);
  }
});

test('exact zero and overdraw immediately lose without losing card records', () => {
  for (const [count, damage] of [[1,false],[2,false],[1,true],[2,true],[10,true]]) {
    const e=engine(), p=e.player(0);
    p.deck=[familiar('last1',3), ...(count===1?[]:[familiar('last2',4)])];
    const total=p.deck.length+p.hand.length+p.graveyard.length;
    if(damage) e.takeDeckDamage(0,count); else e.draw(0,count);
    assert.equal(e.state.phase,PHASES.GAME_OVER); assert.equal(e.state.winner,1);
    assert.equal(p.deck.length,0); assert.equal(p.hand.length+p.graveyard.length,total);
  }
});

test('draw magic taking the last card ends the duel before priority changes', () => {
  const e=engine(), p=e.player(0); p.deck=[familiar('last',3)]; p.hand=[drawTwo('draw')];
  e.activateMainMagic(0,'draw'); assert.equal(e.state.winner,1); assert.equal(p.hand[0].id,'last');
});

test('invalid chain response is atomic and legal choices remain available', () => {
  const e=engine(); battle(e); e.player(1).field[0]=familiar('a',5); e.player(1).hand=[boost('legal',2)];
  e.attack(1,0,null); const before=e.snapshot();
  assert.throws(()=>e.respondChain(1,'missing')); assert.deepEqual(e.snapshot(),before);
  e.respondChain(1,'legal'); passAll(e); assert.equal(e.state.priorityPlayer,1);
});
