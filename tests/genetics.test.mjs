import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GENOME } from '../src/evaluation-ai.js';
import { crossover, mutate, mulberry32, populationDiversity, randomGenome } from '../ga/genetics.mjs';

test('genetic operators preserve terminal win/loss safety weights', () => {
  const rng = mulberry32(42);
  const a = randomGenome(rng, { broad: true, id: 'a' });
  const b = randomGenome(rng, { broad: true, id: 'b' });
  const child = mutate(crossover(a, b, rng, { id: 'child' }), rng, { rate: 1, sigma: 1, resetRate: 1 });
  assert.equal(child.weights.terminalWin, DEFAULT_GENOME.weights.terminalWin);
  assert.equal(child.weights.terminalLoss, DEFAULT_GENOME.weights.terminalLoss);
});

test('random immigrants and crossover maintain population diversity', () => {
  const rng = mulberry32(7);
  const population = Array.from({ length: 8 }, (_, i) => randomGenome(rng, { broad: i % 2 === 0, id: `g${i}` }));
  population.push(crossover(population[0], population[1], rng, { id: 'cross' }));
  assert.ok(populationDiversity(population) > 0.5);
});
