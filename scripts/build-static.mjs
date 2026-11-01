import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

const output = new URL('../dist/', import.meta.url);
mkdirSync(output, { recursive: true });
// Preserve the preview server's working directory when rebuilding.
for (const name of readdirSync(output)) rmSync(new URL(name, output), { recursive: true, force: true });
for (const name of ['index.html', 'styles.css', 'portraits.css', 'styles-v20260913.css', 'src', 'assets']) {
  const source = new URL(`../${name}`, import.meta.url);
  if (!existsSync(source)) throw new Error(`Missing static input: ${name}`);
  cpSync(source, new URL(name, output), { recursive: true });
}
console.log('Static game prepared in dist/');
