// Giro 4, rilievo 2: un `test.only` rimasto in una prova non deve fare di una suite con rossi una suite verde.
// Configurazione vera del repo e verdetto vero, su una cartella di prove finte, con CI=true come in GitHub.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea, collegaCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const esegui = (args, cwd) => new Promise((ok) => {
  const p = spawn(process.execPath, args, { cwd, env: { ...process.env, CI: 'true' } });
  let out = '';
  p.stdout.on('data', (c) => { out += c; });
  p.stderr.on('data', (c) => { out += c; });
  p.on('close', (code) => ok({ code, out }));
});

test('con un test.only dimenticato la suite non risulta verde', async () => {
  test.setTimeout(120_000);
  const cartella = cartellaTemporanea('test-only-');
  collegaCartella(join(ROOT, 'node_modules'), join(cartella, 'node_modules'));
  mkdirSync(join(cartella, 'tests'));
  writeFileSync(join(cartella, 'tests', 'rotta.spec.mjs'),
    "import { test, expect } from '@playwright/test';\ntest('rotta davvero', () => { expect(1).toBe(2); });\n");
  writeFileSync(join(cartella, 'tests', 'a-fuoco.spec.mjs'),
    "import { test, expect } from '@playwright/test';\ntest.only('messa a fuoco mentre la si provava', () => { expect(1).toBe(1); });\n");
  const risultati = join(cartella, 'suite-risultati.json');
  writeFileSync(join(cartella, 'pw.config.mjs'), [
    `import base from ${JSON.stringify(pathToFileURL(join(ROOT, 'playwright.config.js')).href)};`,
    `export default { ...base, testDir: ${JSON.stringify(join(cartella, 'tests'))}, retries: 0,`,
    `  reporter: [['json', { outputFile: ${JSON.stringify(risultati)} }]] };`,
  ].join('\n'));

  await esegui([join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '-c', join(cartella, 'pw.config.mjs')], cartella);
  const v = await esegui([join(ROOT, 'scripts', 'suite-verdict.mjs'), risultati], ROOT);
  // Uscita 0 = verde = il commit si pubblica, con la prova rotta mai eseguita.
  expect(v.code, v.out).not.toBe(0);
});
