import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { GameEngine, PHASES } from '../src/game-engine.js';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { RLAdapter, ACTIONS, encodeAttack, OBSERVATION_SIZE } from '../src/rl-adapter.js';
import { chooseBaselineAction } from '../src/baseline-ai.js';

function rngFor(seed) { return () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; }; }

test('both decks share 12/7/11 composition, one draw, and their own 13 witch; all images exist', () => {
  const decks=['madoka','mami'].map(createDeck);
  for (const deck of decks) {
    assert.equal(deck.length,30); assert.equal(new Set(deck.map(c=>c.id)).size,30);
    assert.equal(deck.filter(c=>c.type==='familiar').length,12);
    assert.equal(deck.filter(c=>c.type==='witch').length,7);
    assert.equal(deck.filter(c=>c.effect==='draw').length,1);
    assert.equal(deck.filter(c=>c.attack===13).length,1);
    for(const card of deck) assert.ok(existsSync(new URL('../'+card.image.split('?')[0],import.meta.url)),card.image);
  }
  const gameplay = deck => deck.map(({type,attack,tributeThreshold,effect,value})=>({type,attack,tributeThreshold,effect,value}));
  assert.deepEqual(gameplay(decks[0]),gameplay(decks[1]));
  assert.equal(decks[0].find(c=>c.attack===13).name,'救済の魔女');
  assert.equal(decks[1].find(c=>c.attack===13).name,'ワルプルギスの夜');
  assert.equal(decks[1].filter(c=>c.name==='芸術家の魔女').length,2);
});

test('Mami PNGs retain original card dimensions instead of thumbnail placeholders', () => {
  for(const file of new Set(createDeck('mami').filter(c=>c.type!=='magic').map(c=>c.image.split('?')[0]))) {
    const b=readFileSync(new URL('../'+file,import.meta.url));
    assert.equal(b.readUInt32BE(16),1024,file); assert.equal(b.readUInt32BE(20),1536,file);
  }
});

test('300 seeded random and tactical duels finish legally without card loss or deadlock', () => {
  for(let game=1;game<=300;game++) {
    const rng=rngFor(game), ids=game%2?['madoka','mami']:['mami','madoka'];
    const e=new GameEngine({players:ids.map(id=>({name:id,character:CHARACTERS[id]})),decks:ids.map(createDeck),rng});
    const a=new RLAdapter(e);
    for(let step=0;e.state.phase!==PHASES.GAME_OVER;step++) {
      assert.ok(step<800,`game ${game} stuck`);
      const player=a.currentPlayer(), legal=a.legalActions(player);
      assert.ok(legal.length); assert.ok(!a.legalActions(1-player).length);
      const observation=a.observation(player);
      assert.equal(observation.length,OBSERVATION_SIZE); assert.ok(observation.every(v=>v>=0&&v<=1));
      const action=game%3===0||player===0?legal[Math.floor(rng()*legal.length)]:chooseBaselineAction(a);
      a.applyAction(action);
      e.state.players.forEach((p,i)=>{
        const cards=[...p.deck,...p.hand,...p.graveyard,...p.field.filter(Boolean),...e.state.chain.filter(c=>c.player===i).map(c=>c.card)];
        assert.equal(cards.length,30,`card conservation game ${game}`); assert.equal(new Set(cards.map(c=>c.id)).size,30);
      });
    }
    assert.equal(e.player(1-e.state.winner).deck.length,0);
  }
});

test('direct action mask disappears after attack and events collect direct damage', () => {
  const e=new GameEngine({players:['madoka','mami'].map(id=>({name:id,character:CHARACTERS[id]})),decks:[createDeck('madoka'),createDeck('mami')]});
  e.endTurn(0); e.player(1).field[0]={id:'attacker',name:'attacker',type:'familiar',attack:5}; e.player(0).hand=[]; e.player(1).hand=[];
  e.enterBattlePhase(1);e.continueBattlePhase(1);const a=new RLAdapter(e);
  const direct=encodeAttack(0,null); assert.ok(a.legalActions().includes(direct));
  a.applyAction(direct); assert.ok(!a.legalActions().includes(direct));
  assert.equal(a.stats.damageTaken[0],4);
  assert.ok(!a.legalActions().includes(ACTIONS.PASS));
});
