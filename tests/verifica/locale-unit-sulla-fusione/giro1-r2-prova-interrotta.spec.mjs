// Prova del giro 1 (verifica locale #929), rilievo 2: una prova degli unit sulla fusione interrotta a metà
// (Ctrl+C, timeout di chi l'ha lanciata) non deve lasciare un worktree registrato col collegamento a node_modules,
// che un `git worktree remove --force` qualunque attraverserebbe svuotando il node_modules vero.

import { test, expect } from '@playwright/test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LIB = pathToFileURL(resolve(ROOT, 'scripts', 'lib', 'unit-sulla-fusione.mjs')).href;

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function scrivi(p, s) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); }
function commit(dir, files, msg) {
  for (const [p, s] of Object.entries(files)) scrivi(join(dir, p), s);
  git(dir, 'add', '-A'); git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', msg);
  return git(dir, 'rev-parse', 'HEAD');
}
function togliCollegamento(p) {
  if (process.platform === 'win32') spawnSync('cmd', ['/d', '/c', 'rmdir', p]);
  else { try { rmSync(p); } catch (_) { /* già via */ } }
}
function uccidiAlbero(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)]);
  else { try { process.kill(-pid, 'SIGKILL'); } catch (_) { /* già morto */ } }
}

/** Un repo con origin, un ramo e main andato avanti: la prova deve fare la fusione e lanciare gli unit. */
function preparaRepo(base, testDelRamo) {
  const origin = join(base, 'origin.git');
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  const work = join(base, 'work');
  git(base, 'clone', '-q', origin, work);
  git(work, 'checkout', '-q', '-b', 'main');
  mkdirSync(join(work, 'scripts', 'lib'), { recursive: true });
  copyFileSync(join(ROOT, 'scripts', 'run-unit-tests.mjs'), join(work, 'scripts', 'run-unit-tests.mjs'));
  copyFileSync(join(ROOT, 'scripts', 'lib', 'riga-di-comando.mjs'), join(work, 'scripts', 'lib', 'riga-di-comando.mjs'));
  copyFileSync(join(ROOT, 'scripts', 'lib', 'riepilogo-unit.mjs'), join(work, 'scripts', 'lib', 'riepilogo-unit.mjs'));
  commit(work, {
    '.gitignore': 'node_modules\n',
    'tests/unit/a.test.mjs': "import test from 'node:test';\ntest('a', () => {});\n",
  }, 'base');
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', 'ramo');
  const punta = commit(work, { 'tests/unit/b.test.mjs': testDelRamo }, 'ramo');
  const altro = join(base, 'altro');
  git(base, 'clone', '-q', origin, altro);
  commit(altro, { 'nota.txt': 'main avanza\n' }, 'main avanza');
  git(altro, 'push', '-q', 'origin', 'main');
  return { work, punta };
}

test('una prova interrotta non lascia un worktree col collegamento ai moduli veri', async () => {
  test.setTimeout(180_000);
  const base = cartellaTemporanea('filo-929-r2-');
  const moduli = join(base, 'moduli-veri');
  mkdirSync(join(moduli, 'electron', 'dist'), { recursive: true });
  writeFileSync(join(moduli, 'electron', 'dist', 'canarino.txt'), 'c');
  const temp = join(base, 'temp');
  mkdirSync(temp);
  const env = { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp };
  delete env.NODE_TEST_CONTEXT;

  try {
    // 1. Una prova lunga, interrotta mentre gli unit girano sulla fusione.
    const lento = preparaRepo(join(base, 'r1') && (mkdirSync(join(base, 'r1')), join(base, 'r1')),
      "import test from 'node:test';\ntest('lento', async () => { await new Promise((r) => setTimeout(r, 120000)); });\n");
    symlinkSync(moduli, join(lento.work, 'node_modules'), 'junction');
    const codice = `const L = await import(${JSON.stringify(LIB)}); L.provaUnitSullaFusione({ root: ${JSON.stringify(lento.work)}, punta: ${JSON.stringify(lento.punta)} });`;
    const figlio = spawn(process.execPath, ['--input-type=module', '-e', codice], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let uscita = '';
    await new Promise((ok, ko) => {
      const t = setTimeout(() => ko(new Error(`la prova non è partita: ${uscita}`)), 60_000);
      figlio.stdout.on('data', (d) => { uscita += d; if (/Unit sul risultato della fusione/.test(uscita)) { clearTimeout(t); ok(); } });
      figlio.on('exit', () => { clearTimeout(t); ko(new Error(`la prova è finita da sola: ${uscita}`)); });
    });
    await new Promise((r) => setTimeout(r, 1500));
    uccidiAlbero(figlio.pid);
    await new Promise((r) => setTimeout(r, 2000));

    // 2. La prova dopo (un altro finish, magari giorni dopo) parte e finisce normalmente.
    const dopo = spawnSync(process.execPath, ['--input-type=module', '-e',
      `const L = await import(${JSON.stringify(LIB)}); const r = L.provaUnitSullaFusione({ root: ${JSON.stringify(lento.work)}, punta: ${JSON.stringify(lento.punta)}, timeoutMs: 5000 }); console.log(JSON.stringify(r));`],
    { env, encoding: 'utf8', timeout: 90_000 });
    expect(dopo.status, dopo.stderr).not.toBeNull();

    // 3. Quello che resta: nessun worktree registrato fuori da `work`, e il canarino dei moduli c'è.
    const registrati = git(lento.work, 'worktree', 'list', '--porcelain').split('\n')
      .filter((r) => r.startsWith('worktree ')).map((r) => r.slice(9)).filter((p) => resolve(p) !== resolve(lento.work));
    expect(registrati, 'worktree di prova rimasti registrati dopo l’interruzione').toEqual([]);
    expect(existsSync(join(moduli, 'electron', 'dist', 'canarino.txt'))).toBe(true);
  } finally {
    // Pulizia sicura: prima ogni collegamento rimasto sotto temp, poi il resto.
    const giro = (d) => {
      for (const n of (existsSync(d) ? readdirSync(d) : [])) {
        const p = join(d, n);
        let st; try { st = lstatSync(p); } catch (_) { continue; }
        if (n === 'node_modules' && (st.isSymbolicLink() || process.platform === 'win32')) { togliCollegamento(p); continue; }
        if (st.isDirectory() && !st.isSymbolicLink()) giro(p);
      }
    };
    giro(temp);
    giro(base);
    if (existsSync(join(moduli, 'electron', 'dist', 'canarino.txt'))) rmSync(base, { recursive: true, force: true });
  }
});
