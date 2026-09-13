import { ACTIONS, ATTACK_TARGETS, tributeMaskToSlots } from './rl-adapter.js';

// Tactical fallback and training opponent. Reads own hand and public information only.
export function chooseBaselineAction(adapter, player = adapter.currentPlayer()) {
  const e = adapter.engine, s = e.state, self = e.player(player), opp = e.player(1 - player);
  const legal = adapter.legalActions(player);
  if (!legal.length) throw new Error('AI has no legal action.');
  function score(action) {
    if (s.pendingDecision?.type === 'MADOKA_REVIVE') return self.graveyard[action - ACTIONS.REVIVE_BASE].attack;
    if (s.pendingDecision?.type === 'CHAIN_RESPONSE') {
      if (action === ACTIONS.PASS) return 0;
      const card = self.hand[action - ACTIONS.CHAIN_BASE], b = s.battle;
      const values = [b.attackerBase + b.attackerBonus, b.defenderBase + b.defenderBonus];
      const mine = b.attackerPlayer === player ? 0 : 1;
      const prevented = [...b.damagePrevented];
      for (const item of s.chain) {
        if (item.card.effect === 'boost') values[item.player === b.attackerPlayer ? 0 : 1] += item.card.value;
        if (item.card.effect === 'nullifyDamage') prevented[item.player] = true;
      }
      const difference = values[mine] - values[1 - mine];
      if (card.effect === 'nullifyDamage') {
        const damage = b.direct ? (mine === 1 ? values[0] : 0) : Math.max(0, -difference);
        return !prevented[player] && damage > 0 ? (damage >= self.deck.length ? 100 : damage - 0.5) : -5;
      }
      if (b.direct) return prevented[1 - player] ? -5 : card.value - 0.5;
      if (difference <= 0 && difference + card.value > 0) return 20 - card.value * 0.1;
      if (difference > 0 && !prevented[1 - player]) return difference + card.value >= opp.deck.length ? 100 : -1;
      return -2;
    }
    if (action === ACTIONS.PASS) return 0;
    if (action === ACTIONS.END_TURN) return -10;
    if (action === ACTIONS.ENTER_BATTLE || action === ACTIONS.CONTINUE_BATTLE) return 0;
    if (action === ACTIONS.SPECIAL) {
      const ownPower = self.field.reduce((v,c) => v + (c?.attack || 0), 0);
      const otherPower = opp.field.reduce((v,c) => v + (c?.attack || 0), 0);
      if (self.character.id === 'mami') return otherPower > 0 && (otherPower >= ownPower || opp.field.filter(Boolean).length >= 2) ? 25 : -5;
      const best = Math.max(0, ...self.graveyard.map(c => c.attack || 0));
      return best >= 8 || (ownPower === 0 && best > 0) ? 15 : -5;
    }
    if (action >= ACTIONS.SUMMON_BASE && action < ACTIONS.ATTACK_BASE) {
      const offset = action - ACTIONS.SUMMON_BASE;
      const card = self.hand[Math.floor(offset / 32)];
      const tributes = tributeMaskToSlots(offset % 32).map(slot => self.field[slot]);
      const total = tributes.reduce((v,c) => v + c.attack, 0);
      return 8 + card.attack - total * 0.65 - tributes.length * 0.15;
    }
    if (action >= ACTIONS.ATTACK_BASE && action < ACTIONS.MAIN_MAGIC_BASE) {
      const offset = action - ACTIONS.ATTACK_BASE;
      const attack = self.field[Math.floor(offset / ATTACK_TARGETS)].attack;
      const target = offset % ATTACK_TARGETS;
      if (target === 5) return 30 + attack;
      const defense = opp.field[target].attack;
      if (attack > defense) return 20 + defense + (attack - defense) * 0.2;
      if (attack === defense) return 1;
      return -20;
    }
    if (action >= ACTIONS.MAIN_MAGIC_BASE && action < ACTIONS.CHAIN_BASE) return self.deck.length > 5 && self.hand.length < 8 ? 10 : -20;
    return -30;
  }
  return legal.reduce((best, action) => score(action) > score(best) ? action : best, legal[0]);
}
