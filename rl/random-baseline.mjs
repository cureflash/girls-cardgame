import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [path.join(here, 'server.mjs')], { stdio: ['pipe', 'pipe', 'inherit'] });
const reader = readline.createInterface({ input: child.stdout });
const pending = [];
reader.on('line', line => pending.shift()?.(JSON.parse(line)));

function request(message) {
  return new Promise(resolve => {
    pending.push(resolve);
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

const games = Number(process.argv[2] ?? 100);
const maxActions = Number(process.argv[3] ?? 1000);
let wins = [0, 0];
let truncated = 0;
let totalTurns = 0;
let totalActions = 0;

for (let game = 0; game < games; game++) {
  let state = await request({ cmd: 'reset', seed: game + 1 });
  let actions = 0;
  while (!state.terminated && actions < maxActions) {
    const legal = state.mask.flatMap((v, i) => v ? [i] : []);
    if (!legal.length) throw new Error('No legal actions in a non-terminal state.');
    const action = legal[Math.floor(Math.random() * legal.length)];
    state = await request({ cmd: 'step', action });
    actions++;
  }
  if (state.terminated) wins[state.winner]++;
  else truncated++;
  totalTurns += state.turn;
  totalActions += actions;
}

console.log(JSON.stringify({
  games,
  wins,
  truncated,
  averageTurns: totalTurns / games,
  averageActions: totalActions / games,
}, null, 2));
child.kill();
