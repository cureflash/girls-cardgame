import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const sourceUrl = new URL('./four-character-rollout.mjs', import.meta.url);
const runtimeUrl = new URL('./.kyoko-pilot-runtime.mjs', import.meta.url);
let source = fs.readFileSync(sourceUrl, 'utf8');
source = source.replace(
  /const pairs = \[[\s\S]*?\];\nconst pairResults/,
  `const pairs = [\n  ['madoka', 'kyoko'],\n  ['mami', 'kyoko'],\n  ['sayaka', 'kyoko'],\n];\nconst pairResults`,
);
fs.writeFileSync(runtimeUrl, source);
const result = spawnSync(process.execPath, [runtimeUrl.pathname, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: 'inherit',
});
try { fs.unlinkSync(runtimeUrl); } catch {}
process.exit(result.status ?? 1);
