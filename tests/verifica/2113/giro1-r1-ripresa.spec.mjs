// Verifica #2113 giro 1: il controllo di fine lavoro fermato dal tetto di un comando in sottofondo, rilanciato,
// riparte dagli spec non ancora verdi anche dopo che chi verifica ha committato le sue prove, e non perde gli spec
// già passati in un lotto finito rosso o interrotto a metà.
import { test, expect } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FINISH = join(REPO, 'scripts', 'finish-local.mjs');

function repoProva(prefisso) {
  const dir = cartellaTemporanea(prefisso);
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  return { dir, g };
}

// Due spec in un lotto solo: il primo passa e lascia un segno, il secondo è rosso o lento.
function alberoConDueSpec(secondo) {
  const { dir, g } = repoProva('verifica-2113-');
  mkdirSync(join(dir, 'tests'), { recursive: true });
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'), 'dir');
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
  writeFileSync(join(dir, 'playwright.config.mjs'), "export default { testDir: 'tests', workers: 1, timeout: 300_000, reporter: 'line' };\n");
  writeFileSync(join(dir, 'tests', 'a-verde.spec.mjs'), [
    "import { test } from '@playwright/test';",
    "import { writeFileSync } from 'node:fs';",
    `test('verde', () => { writeFileSync(${JSON.stringify(join(dir, 'a-fatto'))}, '1'); });`,
  ].join('\n'));
  writeFileSync(join(dir, 'tests', 'b-altro.spec.mjs'), [
    "import { test, expect } from '@playwright/test';",
    secondo === 'rosso' ? "test('rosso', () => { expect(1).toBe(2); });" : "test('lento', async () => { await new Promise((r) => setTimeout(r, 120_000)); });",
  ].join('\n'));
  g('add', '-A'); g('commit', '-qm', 'spec');
  return { dir, g };
}

// Lo stesso lancio del controllo: spec a lotti, memoria dei verdi sulla punta della cartella.
function scriptLancio(dir) {
  const s = join(dir, 'lancia.mjs');
  writeFileSync(s, [
    `import { runSpecsALotti, memoriaSpecVerdi } from ${JSON.stringify(pathToFileURL(FINISH).href)};`,
    "import { execFileSync } from 'node:child_process';",
    `const dir = ${JSON.stringify(dir)};`,
    "const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();",
    `runSpecsALotti(['tests/a-verde', 'tests/b-altro'], 'prova', { dir, moduli: ${JSON.stringify(join(REPO, 'node_modules'))} }, memoriaSpecVerdi(dir, sha));`,
  ].join('\n'));
  return s;
}

async function verdiDopo(dir, g) {
  const { memoriaSpecVerdi } = await import(pathToFileURL(FINISH).href);
  return memoriaSpecVerdi(dir, g('rev-parse', 'HEAD')).verdi;
}

test('r1 dopo che chi verifica ha committato una prova del giro, il controllo rilanciato riparte dagli spec già verdi', async () => {
  const { dir, g } = repoProva('verifica-2113-');
  try {
    writeFileSync(join(dir, 'a.txt'), '1\n'); g('add', '-A'); g('commit', '-qm', 'lavoro');
    const { memoriaSpecVerdi } = await import(pathToFileURL(FINISH).href);
    memoriaSpecVerdi(dir, g('rev-parse', 'HEAD')).segna(['tests/editor', 'tests/history']);

    // Il salvataggio automatico committa la prova appena scritta: è il cammino normale di chi verifica.
    mkdirSync(join(dir, 'tests', 'verifica', '2113'), { recursive: true });
    writeFileSync(join(dir, 'tests', 'verifica', '2113', 'giro1-r1-x.spec.mjs'), '// prova\n');
    g('add', '-A'); g('commit', '-qm', 'auto: prova del giro');
    expect([...(await verdiDopo(dir, g))].sort(), 'il rilancio riparte da capo').toEqual(['tests/editor', 'tests/history']);

    // Un cambio al codice del lavoro invece li rimette in gioco tutti.
    writeFileSync(join(dir, 'a.txt'), '2\n'); g('add', '-A'); g('commit', '-qm', 'auto: codice');
    expect([...(await verdiDopo(dir, g))]).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('r1 uno spec verde in un lotto con un rosso resta ricordato: il rilancio non lo rifà', async () => {
  test.setTimeout(180_000);
  const { dir, g } = alberoConDueSpec('rosso');
  try {
    execFileSync(process.execPath, [scriptLancio(dir)], { cwd: dir, stdio: 'ignore', timeout: 150_000 });
    expect(existsSync(join(dir, 'a-fatto')), 'lo spec verde ha girato').toBe(true);
    expect([...(await verdiDopo(dir, g))]).toContain('tests/a-verde');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('r1 uno spec verde in un lotto interrotto a metà dal tetto del comando resta ricordato', async () => {
  test.setTimeout(240_000);
  const { dir, g } = alberoConDueSpec('lento');
  try {
    const figlio = spawn(process.execPath, [scriptLancio(dir)], { cwd: dir, stdio: 'ignore', detached: true });
    const scadenza = Date.now() + 150_000;
    while (!existsSync(join(dir, 'a-fatto')) && Date.now() < scadenza) await new Promise((r) => setTimeout(r, 500));
    expect(existsSync(join(dir, 'a-fatto')), 'lo spec verde ha girato').toBe(true);
    await new Promise((r) => setTimeout(r, 5_000));
    // Il tetto di un comando in sottofondo uccide tutto il gruppo, senza dargli il tempo di salvare.
    try { process.kill(-figlio.pid, 'SIGKILL'); } catch (_) { /* già uscito */ }
    expect([...(await verdiDopo(dir, g))]).toContain('tests/a-verde');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
