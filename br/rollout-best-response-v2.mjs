import { PHASES } from '../src/game-engine.js';
import { chooseBaselineAction } from '../src/baseline-ai.js';
import { actionDescriptor, cloneAdapter, createMatch, seededRng } from '../cfr/solver.mjs';
import {
  BEST_RESPONSE_FORMAT,
  candidateActions,
  determinizeForPlayer,
} from './rollout-best-response.mjs';

export const BEST_RESPONSE_V2_FORMAT = `${BEST_RESPONSE_FORMAT}-conservative-v2`;

function terminalScore(adapter, perspective) {
  if (adapter.engine.state.phase !== PHASES.GAME_OVER) return 0.5;
  const winner = adapter.engine.state.winner;
  if (winner === null || winner === undefined) return 0.5;
  return winner === perspective ? 1 : 0;
}

function rolloutBaseline(adapter, perspective, maxActions) {
  let steps = 0;
  for (; steps < maxActions && adapter.engine.state.phase !== PHASES.GAME_OVER; steps++) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) break;
    let action = legal.length === 1 ? legal[0] : chooseBaselineAction(adapter, player);
    if (!legal.includes(action)) action = legal[0];
    adapter.applyAction(action, player);
  }
  return {
    score: terminalScore(adapter, perspective),
    terminated: adapter.engine.state.phase === PHASES.GAME_OVER,
    steps,
  };
}

function candidatesIncludingBaseline(adapter, perspective) {
  const candidates = candidateActions(adapter, perspective);
  const legal = adapter.legalActions(perspective);
  const baselineAction = legal.length === 1 ? legal[0] : chooseBaselineAction(adapter, perspective);
  if (legal.includes(baselineAction) && !candidates.some(candidate => candidate.action === baselineAction)) {
    candidates.push({
      action: baselineAction,
      label: `baseline:${actionDescriptor(adapter, baselineAction, perspective)}`,
    });
  }
  return { candidates, baselineAction };
}

/**
 * Paired hidden-information rollout: every candidate is evaluated on the same
 * sampled hidden worlds. The planner only deviates from baseline when the
 * estimated advantage clears minGain.
 */
export function evaluateDecisionV2(adapter, perspective, {
  samples = 16,
  seed = 1,
  maxActions = 220,
  minGain = 0.05,
} = {}) {
  const { candidates, baselineAction } = candidatesIncludingBaseline(adapter, perspective);
  if (!candidates.length) throw new Error('No candidate actions.');
  if (candidates.length === 1) {
    const only = candidates[0];
    return {
      action: only.action,
      label: only.label,
      selectedScore: 0.5,
      rawBestScore: 0.5,
      baselineAction,
      baselineScore: 0.5,
      estimatedGain: 0,
      candidates: [{ ...only, score: 0.5, wins: 0, losses: 0, draws: samples, cutoffs: 0 }],
      forced: true,
      deviated: false,
    };
  }

  const accum = new Map(candidates.map(candidate => [candidate.action, {
    ...candidate,
    total: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    cutoffs: 0,
  }]));

  for (let sample = 0; sample < samples; sample++) {
    const world = determinizeForPlayer(
      adapter,
      perspective,
      seededRng((seed + sample * 2654435761) >>> 0),
    );
    for (const candidate of candidates) {
      const child = cloneAdapter(world);
      const legal = child.legalActions(perspective);
      if (!legal.includes(candidate.action)) {
        throw new Error(`Candidate ${candidate.action} became illegal after determinization.`);
      }
      child.applyAction(candidate.action, perspective);
      const result = rolloutBaseline(child, perspective, maxActions);
      const row = accum.get(candidate.action);
      row.total += result.score;
      if (!result.terminated) row.cutoffs += 1;
      if (result.score === 1) row.wins += 1;
      else if (result.score === 0) row.losses += 1;
      else row.draws += 1;
    }
  }

  const rows = [...accum.values()].map(row => ({
    action: row.action,
    label: row.label,
    score: row.total / samples,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    cutoffs: row.cutoffs,
  })).sort((a, b) => b.score - a.score || a.action - b.action);

  const rawBest = rows[0];
  const baselineRow = rows.find(row => row.action === baselineAction);
  if (!baselineRow) throw new Error('Baseline action was not retained as a candidate.');
  const selected = rawBest.action !== baselineAction && rawBest.score >= baselineRow.score + minGain
    ? rawBest
    : baselineRow;

  return {
    action: selected.action,
    label: selected.label,
    selectedScore: selected.score,
    rawBestScore: rawBest.score,
    rawBestLabel: rawBest.label,
    baselineAction,
    baselineScore: baselineRow.score,
    estimatedGain: selected.score - baselineRow.score,
    rawEstimatedGain: rawBest.score - baselineRow.score,
    candidates: rows,
    forced: false,
    deviated: selected.action !== baselineAction,
  };
}

export function playBestResponseGameV2({
  character = 'madoka',
  seed = 1,
  samples = 16,
  maxActions = 220,
  minGain = 0.05,
} = {}) {
  const swapped = character === 'madoka' ? Boolean(seed & 1) : !Boolean(seed & 1);
  const adapter = createMatch(seed, swapped);
  const perspective = adapter.engine.state.players.findIndex(player => player.character?.id === character);
  const decisionStats = [];
  const actionCounts = {};
  let plannerDecisions = 0;
  let deviations = 0;
  let rolloutCutoffs = 0;

  for (let step = 0; step < maxActions && adapter.engine.state.phase !== PHASES.GAME_OVER; step++) {
    const player = adapter.currentPlayer();
    const legal = adapter.legalActions(player);
    if (!legal.length) break;
    let action;

    if (player !== perspective) {
      action = legal.length === 1 ? legal[0] : chooseBaselineAction(adapter, player);
      if (!legal.includes(action)) action = legal[0];
    } else if (legal.length === 1) {
      action = legal[0];
    } else {
      const decision = evaluateDecisionV2(adapter, perspective, {
        samples,
        seed: (seed * 1000003 + step * 9176 + plannerDecisions * 37) >>> 0,
        maxActions,
        minGain,
      });
      action = decision.action;
      plannerDecisions += 1;
      deviations += Number(decision.deviated);
      const selectedRow = decision.candidates.find(row => row.action === decision.action);
      rolloutCutoffs += selectedRow?.cutoffs ?? 0;
      actionCounts[decision.label] = (actionCounts[decision.label] ?? 0) + 1;
      decisionStats.push({
        turn: adapter.engine.state.turn,
        phase: adapter.engine.state.phase,
        label: decision.label,
        selectedScore: decision.selectedScore,
        baselineScore: decision.baselineScore,
        estimatedGain: decision.estimatedGain,
        rawBestLabel: decision.rawBestLabel,
        rawEstimatedGain: decision.rawEstimatedGain,
        deviated: decision.deviated,
      });
    }
    adapter.applyAction(action, player);
  }

  const winner = adapter.engine.state.winner;
  return {
    character,
    seed,
    terminated: adapter.engine.state.phase === PHASES.GAME_OVER,
    winnerCharacter: winner === null || winner === undefined ? null : adapter.engine.player(winner).character?.id,
    plannerDecisions,
    deviations,
    rolloutCutoffs,
    actionCounts,
    decisionStats,
  };
}

export function evaluateBestResponseV2({
  character = 'madoka',
  games = 40,
  samples = 16,
  seed = 910001,
  maxActions = 220,
  minGain = 0.05,
} = {}) {
  const summary = {
    format: BEST_RESPONSE_V2_FORMAT,
    character,
    games,
    samples,
    minGain,
    wins: 0,
    losses: 0,
    draws: 0,
    terminated: 0,
    plannerDecisions: 0,
    deviations: 0,
    rolloutCutoffs: 0,
    actionCounts: {},
    meanAcceptedGain: 0,
  };
  let acceptedGain = 0;

  for (let game = 0; game < games; game++) {
    const result = playBestResponseGameV2({
      character,
      seed: seed + game * 65537,
      samples,
      maxActions,
      minGain,
    });
    if (result.terminated) summary.terminated += 1;
    if (result.winnerCharacter === character) summary.wins += 1;
    else if (result.winnerCharacter === null) summary.draws += 1;
    else summary.losses += 1;
    summary.plannerDecisions += result.plannerDecisions;
    summary.deviations += result.deviations;
    summary.rolloutCutoffs += result.rolloutCutoffs;
    for (const [key, value] of Object.entries(result.actionCounts)) {
      summary.actionCounts[key] = (summary.actionCounts[key] ?? 0) + value;
    }
    for (const decision of result.decisionStats) {
      if (decision.deviated) acceptedGain += decision.estimatedGain;
    }
  }

  summary.winRate = summary.wins / games;
  summary.deviationRate = summary.plannerDecisions ? summary.deviations / summary.plannerDecisions : 0;
  summary.meanAcceptedGain = summary.deviations ? acceptedGain / summary.deviations : 0;
  return summary;
}
