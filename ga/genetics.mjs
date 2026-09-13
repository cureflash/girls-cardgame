import { DEFAULT_GENOME, DEFAULT_WEIGHTS, FEATURE_NAMES, makeEvaluationGenome, normalizeEvaluationGenome } from '../src/evaluation-ai.js';

const LOCKED = new Set(['terminalWin', 'terminalLoss']);
export const EVOLVABLE_FEATURES = Object.freeze(FEATURE_NAMES.filter(name => !LOCKED.has(name)));

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function gaussian(rng = Math.random) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function randomGenome(rng = Math.random, { generation = 0, id = null, broad = false } = {}) {
  const weights = {};
  for (const name of FEATURE_NAMES) {
    if (LOCKED.has(name)) {
      weights[name] = DEFAULT_WEIGHTS[name];
      continue;
    }
    if (broad) weights[name] = (rng() * 2 - 1) * 10;
    else {
      const center = DEFAULT_WEIGHTS[name];
      const sigma = Math.max(0.8, Math.abs(center) * 0.45);
      weights[name] = center + gaussian(rng) * sigma;
    }
  }
  return makeEvaluationGenome(weights, {
    generation,
    id: id ?? `g${generation}-random-${Math.floor(rng() * 1e9).toString(36)}`,
  });
}

export function crossover(parentA, parentB, rng = Math.random, { generation = Math.max(parentA.generation ?? 0, parentB.generation ?? 0) + 1, id = null } = {}) {
  const a = normalizeEvaluationGenome(parentA);
  const b = normalizeEvaluationGenome(parentB);
  const weights = {};
  for (const name of FEATURE_NAMES) {
    if (LOCKED.has(name)) weights[name] = DEFAULT_WEIGHTS[name];
    else weights[name] = rng() < 0.5 ? a.weights[name] : b.weights[name];
  }
  return makeEvaluationGenome(weights, {
    generation,
    id: id ?? `g${generation}-child-${Math.floor(rng() * 1e9).toString(36)}`,
    parents: [a.id, b.id],
  });
}

export function mutate(genome, rng = Math.random, { rate = 0.25, sigma = 0.35, resetRate = 0.02 } = {}) {
  const source = normalizeEvaluationGenome(genome);
  const weights = { ...source.weights };
  for (const name of EVOLVABLE_FEATURES) {
    if (rng() >= rate) continue;
    if (rng() < resetRate) {
      weights[name] = (rng() * 2 - 1) * 10;
      continue;
    }
    const scale = Math.max(0.5, Math.abs(weights[name]) * 0.2, Math.abs(DEFAULT_WEIGHTS[name]) * 0.15);
    weights[name] += gaussian(rng) * sigma * scale;
    weights[name] = Math.max(-50, Math.min(50, weights[name]));
  }
  return makeEvaluationGenome(weights, source);
}

export function tournamentSelect(scored, rng = Math.random, size = 3) {
  if (!scored.length) throw new Error('Cannot select from an empty population.');
  let best = null;
  for (let i = 0; i < size; i++) {
    const candidate = scored[Math.floor(rng() * scored.length)];
    if (!best || candidate.fitness > best.fitness) best = candidate;
  }
  return best.genome;
}

export function populationDiversity(population) {
  if (population.length < 2) return 0;
  let totalStd = 0;
  for (const name of EVOLVABLE_FEATURES) {
    const values = population.map(genome => normalizeEvaluationGenome(genome).weights[name]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    totalStd += Math.sqrt(variance);
  }
  return totalStd / EVOLVABLE_FEATURES.length;
}

export function cloneGenome(genome, meta = {}) {
  const source = normalizeEvaluationGenome(genome);
  return makeEvaluationGenome(source.weights, {
    generation: meta.generation ?? source.generation,
    id: meta.id ?? source.id,
    parents: meta.parents ?? source.parents,
  });
}

export const BASELINE_GENOME = DEFAULT_GENOME;
