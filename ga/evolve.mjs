import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_GENOME, normalizeEvaluationGenome } from '../src/evaluation-ai.js';
import { cloneGenome, crossover, mutate, mulberry32, populationDiversity, randomGenome, tournamentSelect } from './genetics.mjs';
import { playSeries } from './match.mjs';

function parseArgs(argv) {
  const out = {
    population: 16,
    generations: 30,
    opponents: 5,
    repeats: 1,
    eliteFraction: 0.25,
    immigrantFraction: 0.125,
    randomCrossoverFraction: 0.125,
    mutationRate: 0.25,
    mutationSigma: 0.35,
    hallOpponents: 3,
    maxActions: 600,
    seed: 1,
    output: 'models/ga',
    resume: null,
  };
  const map = {
    '--population': ['population', Number], '--generations': ['generations', Number], '--opponents': ['opponents', Number],
    '--repeats': ['repeats', Number], '--elite-fraction': ['eliteFraction', Number], '--immigrant-fraction': ['immigrantFraction', Number],
    '--random-crossover-fraction': ['randomCrossoverFraction', Number], '--mutation-rate': ['mutationRate', Number],
    '--mutation-sigma': ['mutationSigma', Number], '--hall-opponents': ['hallOpponents', Number], '--max-actions': ['maxActions', Number],
    '--seed': ['seed', Number], '--output': ['output', String], '--resume': ['resume', String],
  };
  for (let i = 0; i < argv.length; i++) {
    const spec = map[argv[i]];
    if (!spec) continue;
    if (i + 1 >= argv.length) throw new Error(`Missing value for ${argv[i]}`);
    out[spec[0]] = spec[1](argv[++i]);
  }
  if (out.population < 4) throw new Error('--population must be at least 4');
  if (out.generations < 1 || out.opponents < 1 || out.repeats < 1) throw new Error('generation/opponent/repeat counts must be positive');
  return out;
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

function loadHall(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => /^champion-\d+\.json$/.test(name))
    .sort()
    .map(name => normalizeEvaluationGenome(readJson(path.join(dir, name))));
}

function selectHall(hall, count, rng) {
  if (!hall.length || count <= 0) return [];
  const chosen = [];
  const push = genome => { if (genome && !chosen.some(x => x.id === genome.id)) chosen.push(genome); };
  push(hall[0]);
  push(hall.at(-1));
  while (chosen.length < Math.min(count, hall.length)) push(hall[Math.floor(rng() * hall.length)]);
  return chosen.slice(0, count);
}

function pairSchedule(size, opponents, rng) {
  const pairs = new Set();
  for (let i = 0; i < size; i++) {
    const candidates = Array.from({ length: size }, (_, j) => j).filter(j => j !== i);
    for (let k = candidates.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      [candidates[k], candidates[j]] = [candidates[j], candidates[k]];
    }
    for (const j of candidates.slice(0, Math.min(opponents, candidates.length))) pairs.add(i < j ? `${i}:${j}` : `${j}:${i}`);
  }
  return [...pairs].map(key => key.split(':').map(Number));
}

function recordSeries(stats, index, series, perspectiveA = true) {
  const wins = perspectiveA ? series.winsA : series.winsB;
  const losses = perspectiveA ? series.winsB : series.winsA;
  stats[index].wins += wins;
  stats[index].losses += losses;
  stats[index].draws += series.draws;
  stats[index].games += series.games;
  stats[index].points += wins + 0.5 * series.draws;
}

function evaluatePopulation(population, hall, args, rng, generation) {
  const stats = population.map(() => ({ games: 0, wins: 0, losses: 0, draws: 0, points: 0 }));
  let seedOffset = generation * 1_000_003 + args.seed;
  for (const [a, b] of pairSchedule(population.length, args.opponents, rng)) {
    const series = playSeries(population[a], population[b], { seed: seedOffset++, repeats: args.repeats, maxActions: args.maxActions });
    recordSeries(stats, a, series, true);
    recordSeries(stats, b, series, false);
  }
  const hallOpponents = selectHall(hall, args.hallOpponents, rng);
  for (let i = 0; i < population.length; i++) {
    for (const opponent of hallOpponents) {
      if (opponent.id === population[i].id) continue;
      const series = playSeries(population[i], opponent, { seed: seedOffset++, repeats: 1, maxActions: args.maxActions });
      recordSeries(stats, i, series, true);
    }
  }
  return population.map((genome, i) => ({
    genome,
    ...stats[i],
    fitness: stats[i].games ? stats[i].points / stats[i].games : 0,
  })).sort((a, b) => b.fitness - a.fitness || b.wins - a.wins || a.losses - b.losses);
}

function validationAnchors(seed) {
  const rng = mulberry32(seed ^ 0x5f3759df);
  return [
    cloneGenome(DEFAULT_GENOME, { id: 'validation-default' }),
    randomGenome(rng, { id: 'validation-random-a', broad: true }),
    randomGenome(rng, { id: 'validation-random-b', broad: true }),
    randomGenome(rng, { id: 'validation-random-c', broad: false }),
  ];
}

function validateChampion(champion, anchors, args, generation) {
  let games = 0, wins = 0, draws = 0, truncated = 0;
  const byAnchor = [];
  for (let i = 0; i < anchors.length; i++) {
    const series = playSeries(champion, anchors[i], { seed: args.seed + 9_000_000 + generation * 1000 + i, repeats: 2, maxActions: args.maxActions });
    games += series.games; wins += series.winsA; draws += series.draws; truncated += series.truncated;
    byAnchor.push({ id: anchors[i].id, games: series.games, wins: series.winsA, losses: series.winsB, draws: series.draws });
  }
  return { games, wins, draws, truncated, score: games ? (wins + 0.5 * draws) / games : 0, byAnchor };
}

function breedNext(scored, args, rng, generation) {
  const size = args.population;
  const eliteCount = Math.max(2, Math.min(size - 1, Math.round(size * args.eliteFraction)));
  const immigrantCount = Math.max(1, Math.round(size * args.immigrantFraction));
  const randomCrossCount = Math.max(1, Math.round(size * args.randomCrossoverFraction));
  const parentPool = scored.slice(0, Math.max(eliteCount, Math.ceil(size / 2)));
  const next = scored.slice(0, eliteCount).map((entry, i) => cloneGenome(entry.genome, {
    generation: generation + 1,
    id: `g${generation + 1}-elite-${i}`,
    parents: [entry.genome.id],
  }));

  const normalChildrenTarget = Math.max(0, size - immigrantCount - randomCrossCount);
  while (next.length < normalChildrenTarget) {
    const a = tournamentSelect(parentPool, rng, 3);
    const b = tournamentSelect(parentPool, rng, 3);
    let child = crossover(a, b, rng, { generation: generation + 1 });
    child = mutate(child, rng, { rate: args.mutationRate, sigma: args.mutationSigma });
    next.push(child);
  }

  for (let i = 0; i < randomCrossCount && next.length < size - immigrantCount; i++) {
    const strong = tournamentSelect(parentPool, rng, 3);
    const randomParent = randomGenome(rng, { generation: generation + 1, broad: true, id: `g${generation + 1}-random-parent-${i}` });
    let child = crossover(strong, randomParent, rng, { generation: generation + 1, id: `g${generation + 1}-random-cross-${i}` });
    child = mutate(child, rng, { rate: Math.max(args.mutationRate, 0.35), sigma: args.mutationSigma });
    next.push(child);
  }

  while (next.length < size) next.push(randomGenome(rng, { generation: generation + 1, broad: true, id: `g${generation + 1}-immigrant-${next.length}` }));
  return next;
}

function initialPopulation(args, rng) {
  if (!args.resume) {
    const population = [cloneGenome(DEFAULT_GENOME, { generation: 0, id: 'g0-default' })];
    while (population.length < args.population) population.push(randomGenome(rng, { generation: 0, broad: population.length % 4 === 0 }));
    return { generation: 0, population };
  }
  const saved = readJson(args.resume);
  const population = (saved.population ?? saved).map(item => normalizeEvaluationGenome(item.genome ?? item));
  if (population.length !== args.population) throw new Error(`Resume population has ${population.length} genomes; expected ${args.population}`);
  return { generation: Number(saved.generation ?? population[0]?.generation ?? 0) + 1, population };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureDir(args.output);
  const rng = mulberry32(args.seed);
  const anchors = validationAnchors(args.seed);
  const initial = initialPopulation(args, rng);
  let population = initial.population;
  let hall = loadHall(args.output);

  for (let generation = initial.generation; generation < initial.generation + args.generations; generation++) {
    const scored = evaluatePopulation(population, hall, args, rng, generation);
    const champion = cloneGenome(scored[0].genome, { generation, id: `champion-g${generation}` });
    const validation = validateChampion(champion, anchors, args, generation);
    const diversity = populationDiversity(population);
    const metrics = {
      generation,
      population: population.length,
      championFitness: scored[0].fitness,
      championWins: scored[0].wins,
      championLosses: scored[0].losses,
      championDraws: scored[0].draws,
      validationScore: validation.score,
      validation,
      diversity,
      hallSize: hall.length,
    };

    writeJson(path.join(args.output, `champion-${String(generation).padStart(3, '0')}.json`), champion);
    writeJson(path.join(args.output, 'latest.json'), champion);
    writeJson(path.join(args.output, `generation-${String(generation).padStart(3, '0')}.json`), {
      generation,
      metrics,
      population: scored.map(entry => ({ ...entry.genome, fitness: entry.fitness, results: { games: entry.games, wins: entry.wins, losses: entry.losses, draws: entry.draws } })),
    });
    fs.appendFileSync(path.join(args.output, 'metrics.jsonl'), JSON.stringify(metrics) + '\n');
    console.log(JSON.stringify({ generation, fitness: scored[0].fitness, validation: validation.score, diversity, champion: champion.id }));

    hall = [...hall, champion];
    population = breedNext(scored, args, rng, generation);
  }
}

main();
