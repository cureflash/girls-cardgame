import readline from 'node:readline';
import { GameEngine } from '../src/character-engine.js';
import { CHARACTERS, createDeck } from '../src/card-data.js';
import { CharacterAdapter } from '../src/character-adapter.js';
import { rlSpec } from '../src/rl-adapter.js';
import { chooseBaselineAction } from '../src/baseline-ai.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function deckFor(characterId) {
  return createDeck(characterId);
}

let engine = null;
let adapter = null;

function payload() {
  if (!adapter) throw new Error('Environment has not been reset.');
  const player = adapter.currentPlayer();
  const info = adapter.info();
  return {
    ok: true,
    player,
    observation: adapter.observation(player),
    mask: adapter.actionMask(player),
    ...info,
  };
}

function reset(message = {}) {
  const ids = Array.isArray(message.characters) && message.characters.length === 2
    ? message.characters
    : ['madoka', 'mami'];
  for (const id of ids) if (!CHARACTERS[id]) throw new Error(`Unknown character: ${id}`);
  const seed = Number.isInteger(message.seed) ? message.seed : Math.floor(Math.random() * 0x7fffffff);
  const players = ids.map((id, i) => ({ id: `p${i + 1}`, name: `${id}-${i + 1}`, character: CHARACTERS[id] }));
  engine = new GameEngine({
    players,
    decks: ids.map(deckFor),
    openingHand: Number.isInteger(message.openingHand) ? message.openingHand : 5,
    rng: mulberry32(seed),
  });
  adapter = new CharacterAdapter(engine);
  return { ...payload(), seed };
}

function handle(message) {
  switch (message.cmd) {
    case 'spec':
      return { ok: true, ...rlSpec() };
    case 'reset':
      return reset(message);
    case 'step': {
      if (!adapter) throw new Error('Environment has not been reset.');
      const player = adapter.currentPlayer();
      adapter.applyAction(message.action, player);
      return payload();
    }
    case 'state':
      return payload();
    case 'expert-action':
      if (!adapter) throw new Error('Environment has not been reset.');
      return { ok: true, action: chooseBaselineAction(adapter, adapter.currentPlayer(), engine.rng) };
    default:
      throw new Error(`Unknown command: ${message.cmd}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
  if (!line.trim()) return;
  try {
    const message = JSON.parse(line);
    process.stdout.write(`${JSON.stringify(handle(message))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error?.message ?? String(error) })}\n`);
  }
});
