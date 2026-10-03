// Verifica locale «unit-sulla-fusione», giro 3, rilievo 1: due test verdi da soli che sulla fusione si rompono
// sempre quando girano insieme non sono instabili. La prova deve dire rosso sulla fusione, non fondere.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const unit = (cwd) => { try { execFileSync(process.execPath, ['scripts/run-unit-tests.mjs'], { cwd, stdio: 'ignore' }); return 'verde'; } catch (_) { return 'rosso'; } };

// Ogni file scrive lo stesso file di lavoro, aspetta e lo rilegge: da solo passa, in parallelo con l'altro mai.
const testCon = (chi) => `import test from 'node:test'; import assert from 'node:assert';
import { writeFileSync, readFileSync, rmSync } from 'node:fs'; import { join } from 'node:path'; import { tmpdir } from 'node:os';
test('${chi} usa il file di lavoro', async () => {
  const f = join(tmpdir(), 'filo-prova-condivisa.json');
  writeFileSync(f, JSON.stringify({ chi: '${chi}' }));
  await new Promise((r) => setTimeout(r, 1500));
  assert.strictEqual(JSON.parse(readFileSync(f, 'utf8')).chi, '${chi}');
  rmSync(f, { force: true });
});
`;

test('due lavori verdi da soli e sempre rossi insieme: la prova dice rosso sulla fusione', async () => {
  test.setTimeout(300000);
  const dir = cartellaTemporanea('giro3-r1-');
  const tmp = join(dir, 'tmp');
  mkdirSync(tmp);
  const vecchi = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  try {
    const origin = join(dir, 'origin.git');
    git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
    const lavoro = join(dir, 'lavoro');
    git(dir, 'clone', '-q', origin, lavoro);
    mkdirSync(join(lavoro, 'scripts', 'lib'), { recursive: true });
    mkdirSync(join(lavoro, 'tests', 'unit'), { recursive: true });
    copyFileSync(join(ROOT, 'scripts', 'run-unit-tests.mjs'), join(lavoro, 'scripts', 'run-unit-tests.mjs'));
    copyFileSync(join(ROOT, 'scripts', 'lib', 'riga-di-comando.mjs'), join(lavoro, 'scripts', 'lib', 'riga-di-comando.mjs'));
    writeFileSync(join(lavoro, 'package.json'), '{"type":"module"}\n');
    writeFileSync(join(lavoro, 'tests', 'unit', 'base.test.mjs'), "import test from 'node:test'; test('base', () => {});\n");
    git(lavoro, 'add', '-A'); git(lavoro, 'commit', '-qm', 'base'); git(lavoro, 'push', '-q', 'origin', 'main');

    const altro = join(dir, 'altro');
    git(dir, 'clone', '-q', origin, altro);
    writeFileSync(join(altro, 'tests', 'unit', 'salva-main.test.mjs'), testCon('main'));
    git(altro, 'add', '-A'); git(altro, 'commit', '-qm', 'main'); git(altro, 'push', '-q', 'origin', 'main');

    git(lavoro, 'checkout', '-q', '-b', 'ramo');
    writeFileSync(join(lavoro, 'tests', 'unit', 'salva-ramo.test.mjs'), testCon('ramo'));
    git(lavoro, 'add', '-A'); git(lavoro, 'commit', '-qm', 'ramo');
    const punta = git(lavoro, 'rev-parse', 'HEAD');

    process.env.TEMP = tmp; process.env.TMP = tmp; process.env.TMPDIR = tmp;
    // I due lati da soli sono verdi; la fusione, tre volte su tre, rossa.
    expect(unit(lavoro)).toBe('verde');
    expect(unit(altro)).toBe('verde');
    const fusa = join(dir, 'fusa');
    git(dir, 'clone', '-q', origin, fusa);
    git(fusa, 'merge', '-q', '--no-edit', join(lavoro, '.git') ? punta : punta);
    expect([unit(fusa), unit(fusa), unit(fusa)]).toEqual(['rosso', 'rosso', 'rosso']);

    const { provaUnitSullaFusione } = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'unit-sulla-fusione.mjs')).href);
    const r = provaUnitSullaFusione({ root: lavoro, punta, scrivi: () => {} });
    expect(r.esito).toBe('rosso_sulla_fusione');
  } finally {
    Object.assign(process.env, vecchi);
    for (const [k, v] of Object.entries(vecchi)) if (v === undefined) delete process.env[k];
    rmSync(dir, { recursive: true, force: true });
  }
});
