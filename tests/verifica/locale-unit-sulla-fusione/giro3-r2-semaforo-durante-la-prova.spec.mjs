// Verifica locale «unit-sulla-fusione», giro 3, rilievo 2: mentre il cancello delle routine fa girare gli unit sulla
// fusione il lavoro deve restare vivo sul server. Server finto con la finestra di silenzio ridotta a pochi secondi e
// una prova che dura di più: la richiesta di fusione deve arrivare con il semaforo ancora vivo.
import { test, expect } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());
const SILENZIO_MS = 4000;
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('una prova degli unit più lunga della finestra di silenzio del semaforo non fa arrivare la fusione a biglietto morto', async () => {
  test.setTimeout(300000);
  const dir = cartellaTemporanea('giro3-r2-');
  const tmp = join(dir, 'tmp');
  mkdirSync(tmp);
  let ultimoSegno = Date.now();
  const chiamate = [];
  const server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      const via = req.url.replace(/^\//, '');
      const vivo = Date.now() - ultimoSegno <= SILENZIO_MS;
      chiamate.push({ via, vivo });
      res.setHeader('Content-Type', 'application/json');
      if (!vivo) { res.statusCode = 403; res.end(JSON.stringify({ ok: false, reason: 'dead_ticket' })); return; }
      ultimoSegno = Date.now();
      if (via === 'routineHeartbeat') { res.end(JSON.stringify({ ok: true, expiresAt: new Date(ultimoSegno + SILENZIO_MS).toISOString() })); return; }
      if (via === 'routineMerge') { res.end(JSON.stringify({ ok: true, result: 'merged', sha: 'f'.repeat(40) })); return; }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
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
    writeFileSync(join(altro, 'nuovo.txt'), 'main va avanti\n');
    git(altro, 'add', '-A'); git(altro, 'commit', '-qm', 'main avanti'); git(altro, 'push', '-q', 'origin', 'main');

    // Gli unit del ramo durano più della finestra di silenzio, come sul repo vero durano più di un'ora nei casi lenti.
    git(lavoro, 'checkout', '-q', '-b', 'claude/prova');
    writeFileSync(join(lavoro, 'tests', 'unit', 'lungo.test.mjs'), `import test from 'node:test'; test('lungo', async () => { await new Promise((r) => setTimeout(r, ${SILENZIO_MS * 3})); });\n`);
    git(lavoro, 'add', '-A'); git(lavoro, 'commit', '-qm', 'ramo'); git(lavoro, 'push', '-q', 'origin', 'claude/prova');

    const env = {
      ...process.env, FILO_REPO_ROOT: lavoro, FILO_ROUTINE_TICKET: 'biglietto-finto',
      FILO_ROUTINE_API: `http://127.0.0.1:${server.address().port}`, TEMP: tmp, TMP: tmp, TMPDIR: tmp,
    };
    ultimoSegno = Date.now();
    const esito = await new Promise((ok) => {
      const c = spawn(process.execPath, [join(ROOT, 'scripts', 'merge-gate.mjs'), 'claude/prova'], { cwd: lavoro, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      c.stdout.on('data', (d) => { out += d; });
      c.stderr.on('data', (d) => { out += d; });
      c.on('close', (code) => ok({ code, out }));
    });
    expect(chiamate.some((c) => c.via === 'routineMerge'), esito.out).toBe(true);
    expect(esito.code, esito.out).toBe(0);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
