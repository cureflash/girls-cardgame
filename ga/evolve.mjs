import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_GENOME, normalizeEvaluationGenome } from '../src/evaluation-ai.js';
import { cloneGenome, crossover, mutate, mulberry32, populationDiversity, randomGenome, tournamentSelect } from './genetics.mjs';
import { playSeries } from './match.mjs';

const PAIR_FORMAT = 'girls-cardgame-eval-pair-v1';
const CHARACTERS = Object.freeze(['madoka', 'mami']);
const otherCharacter = character => character === 'madoka' ? 'mami' : 'madoka';

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
    output: 'models/ga-split',
    resume: null,
    bootstrap: null,
  };
  const map = {
    '--population': ['population', Number], '--generations': ['generations', Number], '--opponents': ['opponents', Number],
    '--repeats': ['repeats', Number], '--elite-fraction': ['eliteFraction', Number], '--immigrant-fraction': ['immigrantFraction', Number],
    '--random-crossover-fraction': ['randomCrossoverFraction', Number], '--mutation-rate': ['mutationRate', Number],
    '--mutation-sigma': ['mutationSigma', Number], '--hall-opponents': ['hallOpponents', Number], '--max-actions': ['maxActions', Number],
    '--seed': ['seed', Number], '--output': ['output', String], '--resume': ['resume', String], '--bootstrap': ['bootstrap', String],
  };
  for (let i = 0; i < argv.length; i++) {
    const spec = map[argv[i]];
    if (!spec) continue;
    if (i + 1 >= argv.length) throw new Error(`Missing value for ${argv[i]}`);
    out[spec[0]] = spec[1](argv[++i]);
  }
  if (out.population < 4) throw new Error('--population must be at least 4');
  if (out.generations < 1 || out.opponents < 1 || out.repeats < 1) throw new Error('generation/opponent/repeat counts must be positive');
  if (out.resume && out.bootstrap) throw new Error('--resume and --bootstrap cannot be used together');
  return out;
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

function loadHall(dir, character) {
  if (!fs.existsSync(dir)) return [];
  const pattern = new RegExp(`^champion-${character}-\\d+\\.json$`);
  return fs.readdirSync(dir)
    .filter(name => pattern.test(name))
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

function shuffledIndices(size, rng) {
  const values = Array.from({ length: size }, (_, i) => i);
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

function crossSchedule(madokaSize, mamiSize, opponents, rng) {
  const pairs = new Set();
  for (let m = 0; m < madokaSize; m++) {
    for (const a of shuffledIndices(mamiSize, rng).slice(0, Math.min(opponents, mamiSize))) pairs.add(`${m}:${a}`);
  }
  for (let a = 0; a < mamiSize; a++) {
    for (const m of shuffledIndices(madokaSize, rng).slice(0, Math.min(opponents, madokaSize))) pairs.add(`${m}:${a}`);
  }
  return [...pairs].map(key => key.split(':').map(Number));
}

function emptyStats(size) {
  return Array.from({ length: size }, () => ({ games: 0, wins: 0, losses: 0, draws: 0, points: 0 }));
}

function recordSeries(stats, index, series, character) {
  const wins = character === 'madoka' ? series.winsMadoka : series.winsMami;
  const losses = character === 'madoka' ? series.winsMami : series.winsMadoka;
  stats[index].wins += wins;
  stats[index].losses += losses;
  stats[index].draws += series.draws;
  stats[index].games += series.games;
  stats[index].points += wins + 0.5 * series.draws;
}

function scoredPopulation(population, stats) {
  return population.map((genome, i) => ({
    genome,
    ...stats[i],
    fitness: stats[i].games ? stats[i].points / stats[i].games : 0,
  })).sort((a, b) => b.fitness - a.fitness || b.wins - a.wins || a.losses - b.losses);
}

function evaluatePopulations(populations, halls, args, rng, generation) {
  const stats = {
    madoka: emptyStats(populations.madoka.length),
    mami: emptyStats(populations.mami.length),
  };
  let seedOffset = generation * 1_000_003 + args.seed;

  for (const [madokaIndex, mamiIndex] of crossSchedule(populations.madoka.length, populations.mami.length, args.opponents, rng)) {
    const series = playSeries(populations.madoka[madokaIndex], populations.mami[mamiIndex], {
      seed: seedOffset++, repeats: args.repeats, maxActions: args.maxActions,
    });
    recordSeries(stats.madoka, madokaIndex, series, 'madoka');
    recordSeries(stats.mami, mamiIndex, series, 'mami');
  }

  const mamiHallOpponents = selectHall(halls.mami, args.hallOpponents, rng);
  for (let i = 0; i < populations.madoka.length; i++) {
    for (const opponent of mamiHallOpponents) {
      const series = playSeries(populations.madoka[i], opponent, { seed: seedOffset++, repeats: 1, maxActions: args.maxActions });
      recordSeries(stats.madoka, i, series, 'madoka');
    }
  }

  const madokaHallOpponents = selectHall(halls.madoka, args.hallOpponents, rng);
  for (let i = 0; i < populations.mami.length; i++) {
    for (const opponent of madokaHallOpponents) {
      const series = playSeries(opponent, populations.mami[i], { seed: seedOffset++, repeats: 1, maxActions: args.maxActions });
      recordSeries(stats.mami, i, series, 'mami');
    }
  }

  return {
    madoka: scoredPopulation(populations.madoka, stats.madoka),
    mami: scoredPopulation(populations.mami, stats.mami),
  };
}

function validationAnchors(seed, character) {
  const salt = character === 'madoka' ? 0x13579bdf : 0x5f3759df;
  const rng = mulberry32(seed ^ salt);
  return [
    cloneGenome(DEFAULT_GENOME, { id: `validation-${character}-default` }),
    randomGenome(rng, { id: `validation-${character}-random-a`, broad: true }),
    randomGenome(rng, { id: `validation-${character}-random-b`, broad: true }),
    randomGenome(rng, { id: `validation-${character}-random-c`, broad: false }),
  ];
}

function validateChampion(character, champion, opponentAnchors, args) {
  let games = 0, wins = 0, draws = 0, truncated = 0;
  const byAnchor = [];
  for (let i = 0; i < opponentAnchors.length; i++) {
    const opponent = opponentAnchors[i];
    const series = character === 'madoka'
      ? playSeries(champion, opponent, { seed: args.seed + 9_000_000 + i * 1000, repeats: 2, maxActions: args.maxActions })
      : playSeries(opponent, champion, { seed: args.seed + 9_000_000 + i * 1000, repeats: 2, maxActions: args.maxActions });
    const characterWins = character === 'madoka' ? series.winsMadoka : series.winsMami;
    const opponentWins = character === 'madoka' ? series.winsMami : series.winsMadoka;
    games += series.games;
    wins += characterWins;
    draws += series.draws;
    truncated += series.truncated;
    byAnchor.push({ id: opponent.id, games: series.games, wins: characterWins, losses: opponentWins, draws: series.draws });
  }
  return { games, wins, draws, truncated, score: games ? (wins + 0.5 * draws) / games : 0, byAnchor };
}

function breedNext(scored, args, rng, generation, character) {
  const size = args.population;
  const eliteCount = Math.max(2, Math.min(size - 1, Math.round(size * args.eliteFraction)));
  const immigrantCount = Math.max(1, Math.round(size * args.immigrantFraction));
  const randomCrossCount = Math.max(1, Math.round(size * args.randomCrossoverFraction));
  const parentPool = scored.slice(0, Math.max(eliteCount, Math.ceil(size / 2)));
  const next = scored.slice(0, eliteCount).map((entry, i) => cloneGenome(entry.genome, {
    generation: generation + 1,
    id: `g${generation + 1}-${character}-elite-${i}`,
    parents: [entry.genome.id],
  }));

  const normalChildrenTarget = Math.max(0, size - immigrantCount - randomCrossCount);
  while (next.length < normalChildrenTarget) {
    const a = tournamentSelect(parentPool, rng, 3);
    const b = tournamentSelect(parentPool, rng, 3);
    let child = crossover(a, b, rng, { generation: generation + 1, id: `g${generation + 1}-${character}-child-${next.length}` });
    child = mutate(child, rng, { rate: args.mutationRate, sigma: args.mutationSigma });
    next.push(child);
  }

  for (let i = 0; i < randomCrossCount && next.length < size - immigrantCount; i++) {
    const strong = tournamentSelect(parentPool, rng, 3);
    const randomParent = randomGenome(rng, { generation: generation + 1, broad: true, id: `g${generation + 1}-${character}-random-parent-${i}` });
    let child = crossover(strong, randomParent, rng, { generation: generation + 1, id: `g${generation + 1}-${character}-random-cross-${i}` });
    child = mutate(child, rng, { rate: Math.max(args.mutationRate, 0.35), sigma: args.mutationSigma });
    next.push(child);
  }

  while (next.length < size) {
    next.push(randomGenome(rng, { generation: generation + 1, broad: true, id: `g${generation + 1}-${character}-immigrant-${next.length}` }));
  }
  return next;
}

function loadBootstrap(file) {
  if (!file) return null;
  const data = readJson(file);
  if (data?.format === PAIR_FORMAT && data.madoka && data.mami) {
    return { madoka: normalizeEvaluationGenome(data.madoka), mami: normalizeEvaluationGenome(data.mami) };
  }
  const common = normalizeEvaluationGenome(data);
  return { madoka: common, mami: common };
}

function newPopulation(character, args, rng, bootstrap) {
  const population = [cloneGenome(bootstrap ?? DEFAULT_GENOME, { generation: 0, id: `g0-${character}-${bootstrap ? 'bootstrap' : 'default'}` })];
  if (bootstrap && population.length < args.population) {
    population.push(cloneGenome(DEFAULT_GENOME, { generation: 0, id: `g0-${character}-default` }));
  }
  while (population.length < args.population) {
    population.push(randomGenome(rng, { generation: 0, broad: population.length % 4 === 0, id: `g0-${character}-random-${population.length}` }));
  }
  return population;
}

function initialState(args, rng) {
  if (args.resume) {
    const saved = readJson(args.resume);
    if (!saved.populations?.madoka || !saved.populations?.mami) throw new Error('Resume file must contain populations.madoka and populations.mami.');
    const populations = {};
    for (const character of CHARACTERS) {
      populations[character] = saved.populations[character].map(item => normalizeEvaluationGenome(item.genome ?? item));
      if (populations[character].length !== args.population) {
        throw new Error(`Resume ${character} population has ${populations[character].length} genomes; expected ${args.population}`);
      }
    }
    return { generation: Number(saved.generation ?? 0) + 1, populations };
  }

  const bootstrap = loadBootstrap(args.bootstrap);
  return {
    generation: 0,
    populations: {
      madoka: newPopulation('madoka', args, rng, bootstrap?.madoka),
      mami: newPopulation('mami', args, rng, bootstrap?.mami),
    },
  };
}

function summarizedEntry(entry) {
  return {
    ...entry.genome,
    fitness: entry.fitness,
    results: { games: entry.games, wins: entry.wins, losses: entry.losses, draws: entry.draws },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureDir(args.output);
  const rng = mulberry32(args.seed);
  const anchors = {
    madoka: validationAnchors(args.seed, 'madoka'),
    mami: validationAnchors(args.seed, 'mami'),
  };
  const initial = initialState(args, rng);
  let populations = initial.populations;
  let halls = {
    madoka: loadHall(args.output, 'madoka'),
    mami: loadHall(args.output, 'mami'),
  };

  for (let generation = initial.generation; generation < initial.generation + args.generations; generation++) {
    const scored = evaluatePopulations(populations, halls, args, rng, generation);
    const champions = {
      madoka: cloneGenome(scored.madoka[0].genome, { generation, id: `champion-madoka-g${generation}` }),
      mami: cloneGenome(scored.mami[0].genome, { generation, id: `champion-mami-g${generation}` }),
    };
    const validation = {
      madoka: validateChampion('madoka', champions.madoka, anchors.mami, args),
      mami: validateChampion('mami', champions.mami, anchors.madoka, args),
    };
    const diversity = {
      madoka: populationDiversity(populations.madoka),
      mami: populationDiversity(populations.mami),
    };
    const headToHead = playSeries(champions.madoka, champions.mami, {
      seed: args.seed + 8_000_000 + generation * 97,
      repeats: 4,
      maxActions: args.maxActions,
    });
    const metrics = {
      generation,
      populationPerCharacter: args.population,
      madoka: {
        championFitness: scored.madoka[0].fitness,
        championWins: scored.madoka[0].wins,
        championLosses: scored.madoka[0].losses,
        championDraws: scored.madoka[0].draws,
        validationScore: validation.madoka.score,
        validation: validation.madoka,
        diversity: diversity.madoka,
        hallSize: halls.madoka.length,
      },
      mami: {
        championFitness: scored.mami[0].fitness,
        championWins: scored.mami[0].wins,
        championLosses: scored.mami[0].losses,
        championDraws: scored.mami[0].draws,
        validationScore: validation.mami.score,
        validation: validation.mami,
        diversity: diversity.mami,
        hallSize: halls.mami.length,
      },
      headToHead: {
        games: headToHead.games,
        winsMadoka: headToHead.winsMadoka,
        winsMami: headToHead.winsMami,
        draws: headToHead.draws,
        truncated: headToHead.truncated,
      },
    };

    const suffix = String(generation).padStart(3, '0');
    writeJson(path.join(args.output, `champion-madoka-${suffix}.json`), champions.madoka);
    writeJson(path.join(args.output, `champion-mami-${suffix}.json`), champions.mami);
    writeJson(path.join(args.output, 'latest-madoka.json'), champions.madoka);
    writeJson(path.join(args.output, 'latest-mami.json'), champions.mami);
    writeJson(path.join(args.output, 'latest.json'), {
      format: PAIR_FORMAT,
      generation,
      madoka: champions.madoka,
      mami: champions.mami,
    });
    writeJson(path.join(args.output, `generation-${suffix}.json`), {
      generation,
      metrics,
      populations: {
        madoka: scored.madoka.map(summarizedEntry),
        mami: scored.mami.map(summarizedEntry),
      },
    });
    fs.appendFileSync(path.join(args.output, 'metrics.jsonl'), JSON.stringify(metrics) + '\n');
    console.log(JSON.stringify({
      generation,
      madoka: { fitness: scored.madoka[0].fitness, validation: validation.madoka.score, diversity: diversity.madoka, champion: champions.madoka.id },
      mami: { fitness: scored.mami[0].fitness, validation: validation.mami.score, diversity: diversity.mami, champion: champions.mami.id },
      headToHead: { madoka: headToHead.winsMadoka, mami: headToHead.winsMami, draws: headToHead.draws },
    }));

    halls = {
      madoka: [...halls.madoka, champions.madoka],
      mami: [...halls.mami, champions.mami],
    };
    populations = {
      madoka: breedNext(scored.madoka, args, rng, generation, 'madoka'),
      mami: breedNext(scored.mami, args, rng, generation, 'mami'),
    };
  }
}

main();
