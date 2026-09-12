import { tributeCost, canBeSummoned, isSpadeBoost, isHeartRitual } from './cards.js';
import { RULES } from './config.js';

function weakestFieldUids(player, count) {
  return [...player.field]
    .sort((a, b) => a.value - b.value)
    .slice(0, count)
    .map((c) => c.uid);
}

export function runAiMain(engine) {
  const ai = engine.players[1];
  if (engine.currentPlayer !== ai || engine.winner || engine.battle) return;

  const joker = ai.hand.find((c) => c.kind === 'joker');
  if (joker && engine.opponent.field.length >= 3 && ai.field.length <= 1) {
    engine.playJoker(ai, joker.uid, 'blackhole');
  }

  if (!ai.summonUsed) {
    const summonable = ai.hand
      .filter(canBeSummoned)
      .map((card) => ({ card, cost: tributeCost(card) }))
      .filter(({ cost }) => cost <= ai.field.length)
      .sort((a, b) => b.card.value - a.card.value);

    if (summonable.length) {
      const { card, cost } = summonable[0];
      engine.normalSummon(ai, card.uid, weakestFieldUids(ai, cost));
    } else {
      const hearts = ai.hand.filter(isHeartRitual).sort((a, b) => b.value - a.value);
      for (const heart of hearts) {
        const target = ai.hand
          .filter((c) => canBeSummoned(c) && c.uid !== heart.uid && c.value < heart.value)
          .sort((a, b) => b.value - a.value)[0];
        if (target) {
          engine.ritualSummon(ai, heart.uid, target.uid);
          break;
        }
      }
    }
  }

  if (engine.turn > 0 && ai.attacksUsed < RULES.attacksPerTurn && ai.field.length) {
    const attacker = [...ai.field].sort((a, b) => b.value - a.value)[0];
    const enemy = engine.opponent;
    const target = enemy.field.length
      ? [...enemy.field].sort((a, b) => a.value - b.value)[0]
      : null;
    engine.startBattle(attacker.uid, target?.uid ?? null);
  }
}

export function runAiChainStep(engine) {
  const ai = engine.players[1];
  const battle = engine.battle;
  if (!battle || battle.stage !== 'chain' || battle.chainTurn !== 1) return false;

  const aiIsAttacker = battle.attackerPlayerIndex === 1;
  const ownPower = aiIsAttacker ? battle.attackerPower : battle.defenderPower;
  const enemyPower = aiIsAttacker ? battle.defenderPower : battle.attackerPower;
  const boosts = ai.hand.filter(isSpadeBoost).sort((a, b) => a.value - b.value);

  if (ownPower <= enemyPower) {
    const needed = enemyPower - ownPower + 1;
    const card = boosts.find((c) => c.value >= needed);
    if (card) {
      engine.playSpadeBoost(ai, card.uid);
      return true;
    }
  }

  engine.passChain(ai);
  return true;
}

export function runAiAceStep(engine) {
  const ai = engine.players[1];
  const battle = engine.battle;
  if (!battle || battle.stage !== 'ace') return false;
  if (battle.result.loserIndex !== 1) return false;
  const ace = ai.hand.find((c) => c.kind === 'ace');
  const use = Boolean(ace && battle.result.rawDamage >= RULES.aiAceThreshold);
  engine.resolveBattle(use, ace?.uid ?? null);
  return true;
}
