import fs from 'node:fs';
import { PHASES, CARD_TYPES } from '../src/game-engine.js';
import { chooseEvaluationAction, normalizeEvaluationGenome } from '../src/evaluation-ai.js';
import { actionDescriptor, cloneAdapter, createMatch, seededRng } from '../cfr/solver.mjs';
import { candidateActions, determinizeForPlayer } from './rollout-best-response.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function loadPair(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    madoka: normalizeEvaluationGenome(raw.madoka),
    mami: normalizeEvaluationGenome(raw.mami),
  };
}

function policyAction(adapter, player, pair) {
  const legal = adapter.legalActions(player);
  if (legal.length <= 1) return legal[0];
  const character = adapter.engine.player(player).character?.id;
  let action = chooseEvaluationAction(adapter, player, pair[character], () => 0);
  if (!legal.includes(action)) action = legal[0];
  return action;
}

function terminalScore(adapter, perspective) {
  if (adapter.engine.state.phase !== PHASES.GAME_OVER) return 0.5;
  const winner = adapter.engine.state.winner;
  if (winner === null || winner === undefined) return 0.5;
  return winner === perspective ? 1 : 0;
}

function rolloutPair(adapter, perspective, pair, maxActions) {
  for (let step = 0; step < maxActions && adapter.engine.state.phase !== PHASES.GAME_OVER; step++) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) break;
    adapter.applyAction(policyAction(adapter, player, pair), player);
  }
  return {
    score: terminalScore(adapter, perspective),
    terminated: adapter.engine.state.phase === PHASES.GAME_OVER,
  };
}

function evaluateDecision(adapter, perspective, pair, { samples, seed, maxActions, minGain }) {
  const baselineAction = policyAction(adapter, perspective, pair);
  const candidates = candidateActions(adapter, perspective);
  if (!candidates.some(item => item.action === baselineAction)) {
    candidates.push({ action: baselineAction, label: `baseline:${actionDescriptor(adapter, baselineAction, perspective)}` });
  }
  if (candidates.length === 1) return { action: baselineAction, cutoffs: 0 };

  const rows = new Map(candidates.map(item => [item.action, { ...item, total: 0, cutoffs: 0 }]));
  for (let sample = 0; sample < samples; sample++) {
    const world = determinizeForPlayer(adapter, perspective, seededRng((seed + sample * 2654435761) >>> 0));
    for (const candidate of candidates) {
      const child = cloneAdapter(world);
      if (!child.legalActions(perspective).includes(candidate.action)) throw new Error('Candidate became illegal after determinization.');
      child.applyAction(candidate.action, perspective);
      const result = rolloutPair(child, perspective, pair, maxActions);
      const row = rows.get(candidate.action);
      row.total += result.score;
      row.cutoffs += Number(!result.terminated);
    }
  }

  const ranked = [...rows.values()].map(row => ({ ...row, score: row.total / samples }))
    .sort((a, b) => b.score - a.score || a.action - b.action);
  const baseline = ranked.find(row => row.action === baselineAction);
  if (!baseline) throw new Error('Baseline action missing from candidate set.');
  const rawBest = ranked[0];
  const selected = rawBest.action !== baselineAction && rawBest.score >= baseline.score + minGain ? rawBest : baseline;
  return { action: selected.action, cutoffs: selected.cutoffs };
}

function cardMeta(card, character) {
  if (!card) return null;
  return {
    character,
    id: card.id,
    code: card.code ?? null,
    name: card.name,
    type: card.type,
    baseAttack: card.attack ?? 0,
  };
}

function captureBattle(adapter) {
  const b = adapter.engine.state.battle;
  if (!b) return null;
  const attackerPlayer = adapter.engine.player(b.attackerPlayer);
  const defenderPlayer = adapter.engine.player(b.defenderPlayer);
  return {
    attacker: cardMeta(attackerPlayer.field[b.attackerSlot], attackerPlayer.character?.id ?? 'unknown'),
    defender: b.defenderSlot === null ? null : cardMeta(defenderPlayer.field[b.defenderSlot], defenderPlayer.character?.id ?? 'unknown'),
    deckBefore: adapter.engine.state.players.map(player => player.deck.length),
  };
}

function ensureCard(bucket, meta) {
  const key = `${meta.character}:${meta.name}`;
  if (!bucket[key]) {
    bucket[key] = {
      character: meta.character,
      name: meta.name,
      type: meta.type,
      baseAttack: meta.baseAttack,
      appearances: 0,
      normalSummons: 0,
      revivals: 0,
      damagingHits: 0,
      nominalDamage: 0,
      effectiveDeckDamage: 0,
      directDamage: 0,
      battleDamage: 0,
      maxEffectiveHit: 0,
    };
  }
  return bucket[key];
}

function collectEvents(adapter, startIndex, battleBefore, cards) {
  const events = adapter.engine.state.events.slice(startIndex);
  for (const event of events) {
    if ((event.type === 'summon' || event.type === 'revive') && [CARD_TYPES.FAMILIAR, CARD_TYPES.WITCH].includes(event.card?.type)) {
      const character = adapter.engine.player(event.player).character?.id ?? 'unknown';
      const row = ensureCard(cards, cardMeta(event.card, character));
      row.appearances += 1;
      if (event.type === 'summon') row.normalSummons += 1;
      else row.revivals += 1;
    }
  }

  const damage = events.find(event => event.type === 'damage');
  const battleEnd = events.find(event => event.type === 'battleEnd');
  if (!damage || !battleEnd || !battleBefore || damage.amount <= 0) return;

  let source = null;
  if (battleEnd.direct || battleEnd.attackValue > battleEnd.defendValue) source = battleBefore.attacker;
  else if (battleEnd.defendValue > battleEnd.attackValue) source = battleBefore.defender;
  if (!source) return;

  const row = ensureCard(cards, source);
  const effective = Math.max(0, battleBefore.deckBefore[damage.player] - adapter.engine.player(damage.player).deck.length);
  row.damagingHits += 1;
  row.nominalDamage += damage.amount;
  row.effectiveDeckDamage += effective;
  if (battleEnd.direct) row.directDamage += effective;
  else row.battleDamage += effective;
  row.maxEffectiveHit = Math.max(row.maxEffectiveHit, effective);
}

function playGame({ pair, seed, samples, maxActions, minGain }) {
  const adapter = createMatch(seed, Boolean(seed & 1));
  const cards = {};
  let cutoffs = 0;

  for (let step = 0; step < maxActions && adapter.engine.state.phase !== PHASES.GAME_OVER; step++) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) break;
    let action;
    if (legal.length === 1) action = legal[0];
    else {
      const decision = evaluateDecision(adapter, player, pair, {
        samples,
        seed: (seed * 1000003 + step * 9176 + (adapter.engine.player(player).character?.id === 'mami' ? 7919 : 0)) >>> 0,
        maxActions,
        minGain,
      });
      action = decision.action;
      cutoffs += decision.cutoffs;
    }

    const eventStart = adapter.engine.state.events.length;
    const battleBefore = captureBattle(adapter);
    adapter.applyAction(action, player);
    collectEvents(adapter, eventStart, battleBefore, cards);
  }

  const winner = adapter.engine.state.winner;
  return {
    terminated: adapter.engine.state.phase === PHASES.GAME_OVER,
    winnerCharacter: winner === null || winner === undefined ? null : adapter.engine.player(winner).character?.id,
    cards,
    cutoffs,
  };
}

function mergeCard(target, source) {
  const key = `${source.character}:${source.name}`;
  if (!target[key]) target[key] = { ...source };
  else {
    for (const field of ['appearances', 'normalSummons', 'revivals', 'damagingHits', 'nominalDamage', 'effectiveDeckDamage', 'directDamage', 'battleDamage']) {
      target[key][field] += source[field];
    }
    target[key].maxEffectiveHit = Math.max(target[key].maxEffectiveHit, source.maxEffectiveHit);
  }
}

const pairFile = arg('pair', 'ga/current-meta-analysis-pair.json');
const output = arg('output', '/tmp/witch-damage-current-meta.json');
const games = Number(arg('games', 100));
const samples = Number(arg('samples', 16));
const seed = Number(arg('seed', 2026091601));
const maxActions = Number(arg('max-actions', 300));
const minGain = Number(arg('min-gain', 0.05));
const pair = loadPair(pairFile);

const report = {
  format: 'girls-cardgame-card-damage-current-meta-v1',
  pairFile, games, samples, seed, maxActions, minGain,
  wins: { madoka: 0, mami: 0, draws: 0 },
  terminated: 0,
  cutoffs: 0,
  cards: {},
};

for (let game = 0; game < games; game++) {
  const result = playGame({ pair, seed: seed + game * 65537, samples, maxActions, minGain });
  report.terminated += Number(result.terminated);
  report.cutoffs += result.cutoffs;
  if (result.winnerCharacter === 'madoka') report.wins.madoka += 1;
  else if (result.winnerCharacter === 'mami') report.wins.mami += 1;
  else report.wins.draws += 1;
  for (const row of Object.values(result.cards)) mergeCard(report.cards, row);
}

report.ranking = Object.values(report.cards)
  .map(row => ({
    ...row,
    effectiveDamagePerAppearance: row.appearances ? row.effectiveDeckDamage / row.appearances : 0,
    effectiveDamagePerDamagingHit: row.damagingHits ? row.effectiveDeckDamage / row.damagingHits : 0,
  }))
  .sort((a, b) => b.effectiveDeckDamage - a.effectiveDeckDamage || b.nominalDamage - a.nominalDamage || a.name.localeCompare(b.name, 'ja'));

fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  games,
  wins: report.wins,
  terminated: report.terminated,
  cutoffs: report.cutoffs,
  topByEffectiveDeckDamage: report.ranking.slice(0, 20),
  output,
}, null, 2));
