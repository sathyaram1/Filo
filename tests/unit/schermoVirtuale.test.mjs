// Gli spec lanciati dagli script nel contenitore senza schermo: xvfb davanti da solo, o uno stop
// che dice cosa manca. E, nello stesso strumento, gli spec del lato arrivato da main al riallineamento.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { preparaLancioElectron, senzaSchermo } from '../../scripts/lib/schermo-virtuale.mjs';
import { shaDelRiallineamento, cambiatiPerLaScelta } from '../../scripts/finish-local.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mai = () => { throw new Error('xvfb cercato dove non serve'); };

test('su Windows, Mac e Linux con schermo il comando resta com\'è', () => {
  for (const [platform, env] of [['win32', {}], ['darwin', {}], ['linux', { DISPLAY: ':0' }], ['linux', { WAYLAND_DISPLAY: 'wayland-0' }]]) {
    const l = preparaLancioElectron('npx', ['playwright', 'test', 'tests/a.spec.mjs'], { platform, env, haXvfb: mai });
    assert.deepEqual([l.ok, l.cmd, l.args, l.env, l.nota], [true, 'npx', ['playwright', 'test', 'tests/a.spec.mjs'], undefined, ''], platform);
  }
});

test('Linux senza schermo con xvfb: xvfb-run -a davanti e la sandbox spenta', () => {
  const l = preparaLancioElectron('npx', ['playwright', 'test', 'tests/a.spec.mjs'], { platform: 'linux', env: { PATH: '/bin' }, haXvfb: () => true });
  assert.equal(l.ok, true);
  assert.equal(l.cmd, 'xvfb-run');
  assert.deepEqual(l.args, ['-a', 'npx', 'playwright', 'test', 'tests/a.spec.mjs']);
  assert.equal(l.env.ELECTRON_DISABLE_SANDBOX, '1');
  assert.equal(l.env.PATH, '/bin', 'il resto dell\'ambiente passa intatto');
  assert.match(l.nota, /xvfb-run -a/);
});

test('worker in parallelo (#1157): ognuno cerca il display da una base sua; senza indice il comando resta com\'era', () => {
  const lancio = (worker) => preparaLancioElectron('npx', ['playwright', 'test'], { platform: 'linux', env: { PATH: '/bin' }, haXvfb: () => true, worker });
  assert.deepEqual(lancio({ indice: 1, paralleli: 3 }).args, ['-a', '-n', '110', 'npx', 'playwright', 'test']);
  assert.deepEqual(lancio({ indice: 2, paralleli: 3 }).args, ['-a', '-n', '120', 'npx', 'playwright', 'test']);
  assert.match(lancio({ indice: 2, paralleli: 3 }).nota, /xvfb-run -a -n 120/);
  assert.deepEqual(lancio(null).args, ['-a', 'npx', 'playwright', 'test']);
  assert.deepEqual(preparaLancioElectron('npx', [], { platform: 'linux', env: { FILO_WORKER: '3' }, haXvfb: () => true }).args, ['-a', '-n', '130', 'npx'],
    'l\'indice arriva anche dall\'ambiente');
  assert.deepEqual(preparaLancioElectron('npx', [], { platform: 'win32', env: {}, haXvfb: mai, worker: { indice: 1 } }).args, [], 'fuori da Linux senza schermo niente cambia');
});

test('Linux senza schermo e senza xvfb: si ferma e dice cosa manca', () => {
  const l = preparaLancioElectron('npx', [], { platform: 'linux', env: { DISPLAY: '  ' }, haXvfb: () => false });
  assert.equal(l.ok, false);
  assert.match(l.motivo, /xvfb-run non c'è/);
  assert.match(l.motivo, /apt-get install -y xvfb/);
});

test('senzaSchermo guarda solo Linux', () => {
  assert.equal(senzaSchermo({ platform: 'linux', env: {} }), true);
  assert.equal(senzaSchermo({ platform: 'win32', env: {} }), false);
});

test('finish-local lancia gli spec passando dal lancio preparato, e controlla prima degli unit test', () => {
  const src = readFileSync(resolve(ROOT, 'scripts', 'finish-local.mjs'), 'utf8');
  assert.doesNotMatch(src, /run\(\s*'npx'\s*,\s*\[\s*'playwright'/, 'un npx playwright lanciato a mano salta xvfb');
  assert.match(src, /preparaLancioElectron\('npx', \['playwright', 'test'/);
  const controllo = src.indexOf("preparaLancioElectron('npx', [])");
  const unit = src.indexOf("run('npm', ['run', 'test:unit']");
  assert.ok(controllo > 0 && controllo < unit, 'senza xvfb ci si ferma prima degli unit test, non dopo');
});

test('riallineamento: il commit verificato arriva dal marcatore di chi verifica, e da nessun altro', () => {
  const sha = 'abcdef1234567890abcdef1234567890abcdef12';
  assert.equal(shaDelRiallineamento({ role: 'verifier', dal: sha }), sha);
  assert.equal(shaDelRiallineamento({ role: 'verifier' }), '');
  assert.equal(shaDelRiallineamento({ role: 'prober', dal: sha }), '', 'solo un verificatore è in un giro di riallineamento');
  assert.equal(shaDelRiallineamento({ role: 'verifier', dal: 'HEAD; rm -rf /' }), '', 'solo esadecimale');
  assert.equal(shaDelRiallineamento(null), '');
});

// Un ramo verificato, poi main che tocca un'altra area, poi il ramo riallineato con un conflitto
// risolto: la scelta deve vedere anche l'area arrivata da main e il file in conflitto.
test('riallineamento: la scelta include il lato arrivato da main e il file in conflitto', () => {
  const dir = cartellaTemporanea('riallineamento-');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
  try {
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
    scrivi('src/pages/editor/a.js', '1\n'); scrivi('src/pages/history/h.js', '1\n');
    g('add', '-A'); g('commit', '-qm', 'base');
    g('checkout', '-qb', 'lavoro');
    scrivi('src/pages/editor/a.js', 'lavoro\n'); g('commit', '-qam', 'lavoro');
    const verificato = g('rev-parse', 'HEAD');
    g('checkout', '-q', 'main');
    scrivi('src/pages/history/h.js', 'main\n'); scrivi('src/pages/editor/a.js', 'main\n'); g('commit', '-qam', 'main');
    g('checkout', '-q', 'lavoro');
    try { g('rebase', 'main'); } catch (_) { /* conflitto atteso su a.js */ }
    scrivi('src/pages/editor/a.js', 'risolto\n'); g('add', '-A');
    execFileSync('git', ['-c', 'core.editor=true', 'rebase', '--continue'], { cwd: dir, stdio: 'ignore' });

    const senza = cambiatiPerLaScelta({ base: 'main', marker: null, root: dir });
    assert.deepEqual(senza.changed, ['src/pages/editor/a.js'], 'il ramo contro main vede solo la sua area');
    const con = cambiatiPerLaScelta({ base: 'main', marker: { role: 'verifier', dal: verificato }, root: dir });
    assert.deepEqual(con.changed.sort(), ['src/pages/editor/a.js', 'src/pages/history/h.js']);
    assert.match(con.nota, /lato arrivato da main/);
    const perso = cambiatiPerLaScelta({ base: 'main', marker: { role: 'verifier', dal: 'f'.repeat(40) }, root: dir });
    assert.deepEqual(perso.changed, ['src/pages/editor/a.js']);
    assert.match(perso.nota, /qui non c'è/, 'un commit introvabile si dice, non si salta in silenzio');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// #1157: `xvfb-run -a` senza base parte da :99 in ogni worker, e due lanci a mano nello stesso momento prendono lo
// stesso display. Le ricette mandano al lanciatore, che mette la base del worker come finish:check.
test('ogni lancio a mano di xvfb-run -a che CLAUDE.md e i ruoli chiedono porta la base di display del worker', () => {
  const file = ['CLAUDE.md', ...readdirSync(resolve(ROOT, 'routines', 'roles')).filter((f) => f.endsWith('.md')).map((f) => `routines/roles/${f}`)];
  const senzaBase = [];
  for (const f of file) {
    readFileSync(resolve(ROOT, f), 'utf8').split(/\r?\n/).forEach((riga, i) => {
      if (/xvfb-run\s+-a\b/.test(riga) && !/\s-n\s/.test(riga)) senzaBase.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(senzaBase, []);
});

test('il lanciatore a mano, dove lo schermo c\'è, esegue il comando com\'è e ne restituisce l\'uscita', () => {
  const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'lancia-electron.mjs'), process.execPath, '-e', 'process.exit(7)'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, DISPLAY: ':0' },
  });
  assert.equal(r.status, 7, r.stderr);
  const vuoto = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'lancia-electron.mjs')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(vuoto.status, 2, 'senza comando dice come si usa');
});
