// Gli spec nel contenitore senza schermo, lanciati dagli script o con un npx playwright test a mano (#739): xvfb
// da solo, o uno stop che dice cosa manca. E, nello stesso strumento, gli spec del lato arrivato da main al riallineamento.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { accendiSchermo, preparaLancioElectron, senzaSchermo, xvfbDisponibile } from '../../scripts/lib/schermo-virtuale.mjs';
import { datiWorker } from '../../scripts/lib/dati-worker.mjs';
import { aspettaChe, TETTO_ATTESA_MS } from '../helpers/attese.mjs';
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
  assert.doesNotMatch(src, /run\([^)]*cli\.js/, 'nemmeno il Playwright della cartella di prova');
  // Nella cartella staccata dei controlli (#1480) Playwright si chiama dal node_modules collegato, sempre dal lancio preparato.
  assert.match(src, /preparaLancioElectron\(process\.execPath, \[join\(albero\.moduli, '@playwright', 'test', 'cli\.js'\), 'test'/);
  const controllo = src.indexOf("preparaLancioElectron('npx', [])");
  const unit = src.indexOf("'run-unit-tests.mjs')], 'Controlli di logica'");
  assert.ok(controllo > 0 && controllo < unit, 'senza xvfb ci si ferma prima degli unit test, non dopo');
});

test('riallineamento: il commit verificato arriva dal marcatore di chi verifica, e da nessun altro', () => {
  const sha = 'abcdef1234567890abcdef1234567890abcdef12';
  assert.equal(shaDelRiallineamento({ role: 'verifier', dal: sha }), sha);
  assert.equal(shaDelRiallineamento({ role: 'verifier' }), '');
  assert.equal(shaDelRiallineamento({ role: 'new-work', dal: sha }), '', 'solo un verificatore è in un giro di riallineamento');
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
    togliCartella(dir);
  }
});

// #1157: `xvfb-run -a` senza base parte da :99 in ogni worker, e due lanci a mano nello stesso momento prendono lo
// stesso display. Le ricette mandano al lanciatore, che mette la base del worker come finish:check.
test('ogni lancio a mano di xvfb-run -a che CLAUDE.md e i ruoli chiedono porta la base di display del worker', () => {
  const file = ['CLAUDE.md', ...readdirSync(resolve(ROOT, 'routines', 'roles')).filter((f) => f.endsWith('.md')).map((f) => `routines/roles/${f}`)];
  const senzaBase = [];
  for (const f of file) {
    readFileSync(resolve(ROOT, f), 'utf8').split(/\r?\n/).forEach((riga, i) => {
      if (/xvfb-run\s+-a\b/.test(riga) && !/\s-n\s/.test(riga)) senzaBase.push(`${f}:${i + 1}: ${riga.trim().slice(0, 120)}`);
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

// #739: un `npx playwright test` lanciato a mano, senza lo schermo che finish:check mette davanti, faceva uscire rossi
// in tre secondi tutti gli spec. Ci pensa il globalSetup, con lo stesso piano dei lanci da script.
const LINUX_CON_XVFB = process.platform === 'linux' && xvfbDisponibile();
const senzaLinuxXvfb = LINUX_CON_XVFB ? false : 'serve Linux con xvfb-run';
const numero = (display) => display.slice(1);
const spento = (display) => aspettaChe(() => !existsSync(`/tmp/.X${numero(display)}-lock`), { cosa: `Xvfb ${display} spento` });
// Al figlio una temporanea sua: con quella della corsa degli unit test ereditata, il suo teardown la toglierebbe
// sotto ai file di prova che girano insieme (centotrenta rossi finti).
const ambienteSenzaSchermo = (temp) => {
  const env = { ...process.env, TMPDIR: temp, TEMP: temp, TMP: temp };
  for (const k of ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'ELECTRON_DISABLE_SANDBOX']) delete env[k];
  return env;
};

test('il globalSetup di Playwright è quello che accende lo schermo', () => {
  const config = readFileSync(resolve(ROOT, 'playwright.config.js'), 'utf8');
  assert.match(config, /globalSetup:\s*'\.\/tests\/fixtures\/prima-della-corsa\.mjs'/);
  const setup = readFileSync(resolve(ROOT, 'tests', 'fixtures', 'prima-della-corsa.mjs'), 'utf8');
  assert.match(setup, /await accendiSchermo\(/);
  assert.ok(setup.indexOf('assicuraMotore(') < setup.indexOf('await accendiSchermo('), 'sul motore sbagliato ci si ferma prima di accendere');
});

test('accendiSchermo su Windows, Mac e Linux con schermo non lancia niente e non tocca l\'ambiente', async () => {
  const lancia = () => { throw new Error('xvfb lanciato dove non serve'); };
  for (const [platform, env] of [['win32', {}], ['darwin', {}], ['linux', { DISPLAY: ':0' }], ['linux', { WAYLAND_DISPLAY: 'wayland-0' }]]) {
    const prima = { ...env };
    const s = await accendiSchermo({ platform, env, haXvfb: mai, lancia });
    assert.equal(s.display, '', platform);
    assert.deepEqual(env, prima, platform);
    await s.spegni();
  }
});

test('accendiSchermo senza xvfb si ferma con la riga che dice cosa manca', async () => {
  const env = { PATH: '/bin' };
  await assert.rejects(accendiSchermo({ platform: 'linux', env, haXvfb: () => false, lancia: mai }), /xvfb-run non c'è.*apt-get install -y xvfb/s);
  assert.deepEqual(env, { PATH: '/bin' });
});

test('accendiSchermo: uno xvfb-run che esce o risponde storto si dice, col suo messaggio, e l\'ambiente resta com\'era', async () => {
  const finto = (codice) => (_cmd, _args, opzioni) => spawn(process.execPath, ['-e', codice], opzioni);
  const env = { PATH: process.env.PATH };
  await assert.rejects(
    accendiSchermo({ platform: 'linux', env, haXvfb: () => true, worker: null, lancia: finto('process.stderr.write("xvfb-run: error: xauth command not found\\n"); process.exit(3)') }),
    /è uscito \(3\) prima di accendere lo schermo.*xauth command not found/s,
  );
  await assert.rejects(
    accendiSchermo({ platform: 'linux', env, haXvfb: () => true, worker: null, lancia: finto('process.stdout.write("boh\\n\\n"); process.stdin.resume()') }),
    /display che non si capisce: "boh"/,
  );
  await assert.rejects(
    accendiSchermo({ platform: 'linux', env, haXvfb: () => true, worker: null, attesaMs: 300, lancia: finto('process.stdin.resume()') }),
    /non si è acceso in 0\.3 s/,
  );
  assert.deepEqual(env, { PATH: process.env.PATH });
});

test('accendiSchermo accende un Xvfb vero, lo dà all\'ambiente e allo spegnimento lo chiude e rimette tutto', { skip: senzaLinuxXvfb }, async () => {
  const env = { PATH: process.env.PATH };
  // Dalla base del worker (#1157), come i lanci veri: i worker in parallelo non si contendono il display.
  const s = await accendiSchermo({ env, worker: datiWorker({ root: ROOT }) });
  try {
    assert.match(env.DISPLAY, /^:\d+$/);
    assert.equal(s.display, env.DISPLAY);
    assert.equal(env.ELECTRON_DISABLE_SANDBOX, '1');
    assert.ok(existsSync(env.XAUTHORITY), 'il cookie per entrare nello schermo esiste');
    assert.ok(existsSync(`/tmp/.X11-unix/X${numero(env.DISPLAY)}`), 'Xvfb ascolta');
    assert.match(s.nota, new RegExp(`schermo virtuale ${env.DISPLAY} \\(xvfb-run -a( -n \\d+)?\\)`));
  } finally {
    const { DISPLAY: display, XAUTHORITY: auth } = env;
    await s.spegni();
    assert.deepEqual(env, { PATH: process.env.PATH }, 'l\'ambiente torna quello di prima');
    await spento(display);
    assert.ok(!existsSync(auth), 'il cookie se ne va');
  }
});

test('chi accende lo schermo ed esce senza spegnerlo non lascia Xvfb acceso', { skip: senzaLinuxXvfb }, async () => {
  // Come il runner che esce di colpo: la temporanea della corsa (col cookie dentro) se ne va all'uscita.
  const codice = `import(${JSON.stringify(pathToFileURL(resolve(ROOT, 'tests', 'helpers', 'percorsi.mjs')).href)})`
    + `.then(() => import(${JSON.stringify(pathToFileURL(resolve(ROOT, 'scripts', 'lib', 'schermo-virtuale.mjs')).href)}))`
    + '.then(async (m) => { const s = await m.accendiSchermo(); console.log(s.display); process.exit(0); })';
  const temp = cartellaTemporanea('schermo-uscita-');
  try {
    const r = spawnSync(process.execPath, ['-e', codice], { cwd: ROOT, encoding: 'utf8', env: ambienteSenzaSchermo(temp), timeout: TETTO_ATTESA_MS });
    assert.equal(r.status, 0, r.stderr);
    const display = r.stdout.trim();
    assert.match(display, /^:\d+$/);
    await spento(display);
    assert.deepEqual(readdirSync(temp), [], 'la corsa del figlio, cookie compreso, se n\'è andata');
  } finally {
    togliCartella(temp);
  }
});

test('il globalSetup vero, senza schermo, dà display e sandbox spenta ai lavoratori e alla fine li ritira', { skip: senzaLinuxXvfb }, async () => {
  const codice = `import(${JSON.stringify(pathToFileURL(resolve(ROOT, 'tests', 'fixtures', 'prima-della-corsa.mjs')).href)})`
    + `.then(async (m) => { const fine = await m.default({ configFile: ${JSON.stringify(resolve(ROOT, 'playwright.config.js'))} });`
    + ' const e = () => ({ DISPLAY: process.env.DISPLAY, ELECTRON_DISABLE_SANDBOX: process.env.ELECTRON_DISABLE_SANDBOX });'
    + ' const durante = e(); await fine(); console.log(JSON.stringify({ durante, dopo: e() })); })';
  const temp = cartellaTemporanea('schermo-globalsetup-');
  try {
    const r = spawnSync(process.execPath, ['-e', codice], { cwd: ROOT, encoding: 'utf8', env: ambienteSenzaSchermo(temp), timeout: TETTO_ATTESA_MS });
    assert.equal(r.status, 0, r.stderr);
    const { durante, dopo } = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.match(durante.DISPLAY, /^:\d+$/);
    assert.equal(durante.ELECTRON_DISABLE_SANDBOX, '1');
    assert.match(r.stderr, /schermo virtuale :\d+/, 'chi lancia vede una riga su cosa è successo');
    assert.deepEqual(dopo, {});
    await spento(durante.DISPLAY);
  } finally {
    togliCartella(temp);
  }
});
