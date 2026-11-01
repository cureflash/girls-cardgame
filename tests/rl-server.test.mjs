import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

test('RL server uses canonical characters, forty-card decks and legal expert actions', async () => {
  const child = spawn(process.execPath, [new URL('../rl/server.mjs', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'pipe'] });
  const reader = readline.createInterface({ input: child.stdout });
  const pending = [];
  reader.on('line', line => pending.shift()?.(JSON.parse(line)));
  const request = message => new Promise(resolve => {
    pending.push(resolve);
    child.stdin.write(JSON.stringify(message) + '\n');
  });
  try {
    const spec = await request({ cmd: 'spec' });
    let state = await request({ cmd: 'reset', seed: 17 });
    assert.equal(state.observation.length, spec.observationSize);
    assert.equal(state.mask.length, spec.actionCount);
    for (let i = 0; i < 100 && !state.terminated; i++) {
      const expert = await request({ cmd: 'expert-action' });
      assert.equal(expert.ok, true);
      assert.equal(state.mask[expert.action], 1);
      state = await request({ cmd: 'step', action: expert.action });
      assert.equal(state.ok, true);
    }
    const sayaka = await request({ cmd: 'reset', characters: ['sayaka', 'homura'], seed: 1 });
    assert.equal(sayaka.ok, true);
    assert.ok(sayaka.mask.some(Boolean));
  } finally {
    reader.close();
    child.kill();
  }
});
