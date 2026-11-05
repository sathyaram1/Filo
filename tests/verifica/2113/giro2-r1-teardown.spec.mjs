// Verifica #2113 giro 2: un lancio rosso per un errore fuori dai test (la chiusura di una fixture di worker) non
// diventa verde al rilancio dopo il tetto: lo spec non entra nella memoria dei verdi.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FINISH = join(REPO, 'scripts', 'finish-local.mjs');

test('r1 un errore nella chiusura di una fixture di worker resta rosso anche al rilancio', async () => {
  test.setTimeout(240_000);
  const dir = cartellaTemporanea('verifica-2113-g2-');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
    mkdirSync(join(dir, 'tests'), { recursive: true });
    symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(join(dir, '.gitignore'), 'node_modules\nlancia.mjs\n');
    writeFileSync(join(dir, 'playwright.config.mjs'), "export default { testDir: 'tests', workers: 1, timeout: 60_000, reporter: 'line' };\n");
    writeFileSync(join(dir, 'tests', 'x.spec.mjs'), [
      "import { test as base } from '@playwright/test';",
      "const test = base.extend({ w: [async ({}, use) => { await use(1); throw new Error('chiusura rotta'); }, { scope: 'worker' }] });",
      "test('t', ({ w }) => {});",
    ].join('\n'));
    g('add', '-A'); g('commit', '-qm', 'spec');
    const s = join(dir, 'lancia.mjs');
    writeFileSync(s, [
      `import { runSpecsALotti, memoriaSpecVerdi } from ${JSON.stringify(pathToFileURL(FINISH).href)};`,
      "import { execFileSync } from 'node:child_process';",
      `const dir = ${JSON.stringify(dir)};`,
      "const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();",
      `const ok = runSpecsALotti(['tests/x'], 'prova', { dir, moduli: ${JSON.stringify(join(REPO, 'node_modules'))} }, memoriaSpecVerdi(dir, sha));`,
      'process.stdout.write(`ESITO ${ok}\\n`);',
    ].join('\n'));
    const lancio = () => execFileSync(process.execPath, [s], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 150_000 });
    expect(lancio(), 'il primo lancio è rosso').toContain('ESITO false');
    expect(lancio(), 'il rilancio sullo stesso contenuto resta rosso').toContain('ESITO false');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
