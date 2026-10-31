import { isExtraCard, isMonster } from './card-effects.js';
import { ACTIONS } from './rl-adapter.js';

const maxAttack = cards => Math.max(0, ...cards.filter(isMonster).map(c => c.attack ?? 0));
const minAttack = cards => Math.min(Infinity, ...cards.filter(isMonster).map(c => c.attack ?? 0));
function handValue(card, hand) {
  if (card.type === 'familiar') return 12 + card.attack;
  if (card.type === 'witch') return (hand.some(c => c.type === 'familiar') ? 8 : 2) + card.attack / 2;
  return ({ reborn: 18, evacuation: 14, jammer: 10, nullifyDamage: 10, doomed: 9, avarice: 8 }[card.effect] ?? 5) + (card.value ?? 0);
}

// Public board/own hand only. Existing evaluation genomes still score legacy actions.
export function cardEffectScore(adapter, player, action) {
  const e = adapter.engine, s = e.state, self = e.player(player), opp = e.player(1 - player), d = s.pendingDecision;
  if (d?.type === 'CARD_CHOICE') {
    if (action === ACTIONS.PASS) return 0;
    const option = d.options[action - ACTIONS.CHOICE_BASE], card = option?.card;
    if (!card) return -1000;
    if (d.stage.startsWith('swap-')) return -(card.attack ?? 0);
    if (d.stage === 'discard') return -handValue(card, self.hand);
    if (d.stage === 'hand') {
      const selected = new Set(d.context.targets.map(x => x.card.id));
      const remaining = self.hand.filter(x => x.id !== d.context.cardId && !selected.has(x.id));
      const familiars = remaining.filter(x => x.type === 'familiar').length;
      if (card.type === 'witch') return familiars < 2 || remaining.filter(x => x.type === 'witch').length > 1 ? 3 : -4;
      if (card.type === 'familiar') return familiars > 3 ? 1 : -5;
      return familiars === 0 || remaining.filter(x => x.effect === card.effect).length > 1 ? 2 : -2;
    }
    if (d.stage === 'recycle') return -(card.attack ?? 0);
    if (d.stage === 'grave') return card.attack ?? 0;
    if (d.stage === 'field') {
      let score = (option.player === player ? -1 : 1) * (card.attack ?? 0);
      if (s.battle && option.player !== player && [s.battle.attackerCardId, s.battle.defenderCardId].includes(card.id)) score += 50;
      return score;
    }
    return 0;
  }
  const chain = d?.type === 'CHAIN_RESPONSE';
  const index = chain ? action - ACTIONS.CHAIN_BASE : action - ACTIONS.MAIN_MAGIC_BASE;
  if (chain ? action < ACTIONS.CHAIN_BASE || action >= ACTIONS.REVIVE_BASE : action < ACTIONS.MAIN_MAGIC_BASE || action >= ACTIONS.CHAIN_BASE) return null;
  const card = self.hand[index];
  if (!isExtraCard(card)) return null;
  switch (card.effect) {
    case 'evacuation': {
      if (!opp.field.some(isMonster)) return -30;
      const b = s.battle;
      if (b) {
        let atk = b.attackerBase + b.attackerBonus, def = b.defenderBase + b.defenderBonus;
        for (const item of s.chain) if (item.card.effect === 'boost' && !item.negated) {
          if (item.player === b.attackerPlayer) atk += item.card.value; else def += item.card.value;
        }
        const losing = player === b.attackerPlayer ? atk <= def : b.direct || def <= atk;
        return losing ? 120 : -30;
      }
      return 8 + maxAttack(opp.field);
    }
    case 'doomed': return opp.field.some(isMonster) ? 8 + maxAttack(opp.field) : -30;
    case 'doubleSummon': {
      const monsters = self.hand.filter(isMonster);
      return monsters.length >= (e.summonsUsed(player) ? 1 : 2) && monsters.some(c => c.type === 'familiar' || e.validTributeSets(player, c).length) ? 16 : -30;
    }
    case 'swap': {
      const gain = minAttack(opp.field) - minAttack(self.field);
      return gain > 0 ? 12 + gain * 2 : -30;
    }
    case 'mallet': return self.hand.some(c => c.type === 'witch') && !self.hand.some(c => c.type === 'familiar') ? 18 : -10;
    case 'reincarnate': return !self.hand.some(c => c.type === 'familiar') && self.graveyard.some(c => c.type === 'familiar') ? 18 : maxAttack(self.graveyard) - 3;
    case 'reborn': return 25 + Math.max(maxAttack(self.graveyard), maxAttack(opp.graveyard));
    case 'avarice': return self.deck.length < 15 ? 24 : 4;
    case 'jammer': {
      const item = s.chain.at(-1);
      if (!item || item.player === player) return -100;
      if (item.card.effect === 'boost' && s.battle) {
        const b = s.battle;
        let atk = b.attackerBase + b.attackerBonus, def = b.defenderBase + b.defenderBonus;
        for (const x of s.chain) if (x.card.effect === 'boost' && !x.negated) {
          if (x.player === b.attackerPlayer) atk += x.card.value; else def += x.card.value;
        }
        return (player === b.attackerPlayer ? atk <= def : b.direct || def <= atk) ? 100 : -20;
      }
      return ['doomed', 'swap', 'reborn', 'avarice', 'reincarnate'].includes(item.card.effect) ? 100 : -20;
    }
    default: return null;
  }
}
