// Verifica #2113 giro 3: un test che Playwright salta perché la preparazione del gruppo è caduta, e che al tentativo
// dopo è rosso davvero, non deve far segnare verde il suo spec: altrimenti il rilancio dopo il tetto lo salta.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FINISH = join(REPO, 'scripts', 'finish-local.mjs');
const MODULI = dirname(dirname(dirname(createRequire(import.meta.url).resolve('@playwright/test/package.json'))));

// Due strade per lo stesso salto: la preparazione del gruppo che cade, e un gruppo in fila col primo test passeggero.
const CASI = {
  'preparazione caduta': (segno) => [
    "import { test, expect } from '@playwright/test';",
    "import { existsSync, writeFileSync } from 'node:fs';",
    // La finestra che non si apre al primo colpo e si apre al secondo: il caso per cui la suite ha i tentativi.
    `test.beforeAll(() => { if (!existsSync(${segno})) { writeFileSync(${segno}, '1'); throw new Error('avvio passeggero'); } });`,
    "test('si apre', () => {});",
    "test('salva', () => { expect('salvato').toBe('perso'); });",
  ],
  'gruppo in fila': (segno) => [
    "import { test, expect } from '@playwright/test';",
    "import { existsSync, writeFileSync } from 'node:fs';",
    "test.describe.configure({ mode: 'serial' });",
    `test('si apre', () => { if (!existsSync(${segno})) { writeFileSync(${segno}, '1'); throw new Error('avvio passeggero'); } });`,
    "test('salva', () => { expect('salvato').toBe('perso'); });",
  ],
};

for (const [caso, corpo] of Object.entries(CASI)) test(`r1 ${caso}: un test saltato e poi rosso al nuovo tentativo lascia rosso il rilancio`, async () => {
  test.setTimeout(300_000);
  const dir = cartellaTemporanea('giro3-saltati-');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
    mkdirSync(join(dir, 'tests'), { recursive: true });
    symlinkSync(MODULI, join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(join(dir, '.gitignore'), 'node_modules\nprimo-avvio\n');
    // Come la suite di Filo: un nuovo tentativo per i rossi passeggeri.
    writeFileSync(join(dir, 'playwright.config.mjs'), "export default { testDir: 'tests', workers: 1, retries: 1, timeout: 60_000, reporter: 'line' };\n");
    const segno = JSON.stringify(join(dir, 'primo-avvio'));
    writeFileSync(join(dir, 'tests', 'app.spec.mjs'), corpo(segno).join('\n'));
    g('add', '-A'); g('commit', '-qm', 'spec');
    const lancio = join(dir, 'lancia.mjs');
    writeFileSync(lancio, [
      `import { runSpecsALotti, memoriaSpecVerdi } from ${JSON.stringify(pathToFileURL(FINISH).href)};`,
      "import { execFileSync } from 'node:child_process';",
      `const dir = ${JSON.stringify(dir)};`,
      "const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();",
      `const ok = runSpecsALotti(['tests/app'], 'prova', { dir, moduli: ${JSON.stringify(MODULI)} }, memoriaSpecVerdi(dir, sha));`,
      'process.stdout.write(`ESITO ${ok ? "verde" : "rosso"}\\n`);',
    ].join('\n'));
    const corsa = () => execFileSync(process.execPath, [lancio], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 150_000 });

    expect(corsa(), 'il primo lancio è rosso: «salva» fallisce a ogni tentativo').toContain('ESITO rosso');
    // Il rilancio dopo il tetto, sullo stesso contenuto: lo spec rosso va rifatto, non saltato come già verde.
    expect(corsa(), 'il rilancio resta rosso').toContain('ESITO rosso');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
