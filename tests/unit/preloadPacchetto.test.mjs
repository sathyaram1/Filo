// Sentinella del preload delle pagine web impacchettato per la sandbox (#834): src/main/preloadPacchetto.js porta dentro
// tutto quello che page-preload.js richiede, e la sua `require` si comporta come quella di Node. Le pagine web, la
// finestrella di accesso, la shell e il fumetto non tornano senza sandbox. Le prove nell'app: tests/sandbox-pagine-web.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import vm from 'node:vm';
import nodeUrl from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { leggiWorkflow } from '../helpers/workflowInVigore.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const { componi, scrivi, runtime, NEL_PACCHETTO } = require('../../src/main/preloadPacchetto.js');
const leggi = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

// I moduli di Node chiesti da qualcuno nel pacchetto che la sandbox non ha, col perché va bene così.
const ASSENTI_AMMESSI = {
  'src/shared/feedbackClientIdHash.js → node:crypto': 'cardTagSync, che lo chiede, gira solo nel main e negli script',
};

const pacchetto = componi();

test('il pacchetto si compone, è JavaScript valido ed è sempre lo stesso a parità di sorgenti', () => {
  assert.doesNotThrow(() => new vm.Script(pacchetto.codice, { filename: 'page-preload.js' }));
  assert.equal(componi().codice, pacchetto.codice, 'due composizioni diverse: il Mac universale fonde due copie che devono coincidere');
  assert.ok(pacchetto.moduli.length >= 40, `solo ${pacchetto.moduli.length} moduli: la lettura delle dipendenze è rotta`);
});

test('un file con un errore di sintassi cade da solo, al suo require, non spegne il pacchetto', () => {
  assert.deepEqual(pacchetto.rotti, [], 'un modulo del pacchetto non si legge');
  const radice = cartellaTemporanea('filo-pacchetto-rotto-');
  try {
    mkdirSync(join(radice, 'src', 'preload'), { recursive: true });
    writeFileSync(join(radice, 'src', 'preload', 'page-preload.js'),
      "let e = null; try { require('./rotto.js'); } catch (x) { e = x.name; } globalThis.esito = { buono: require('./buono.js'), e };\n");
    writeFileSync(join(radice, 'src', 'preload', 'rotto.js'), 'const = 1;\n');
    writeFileSync(join(radice, 'src', 'preload', 'buono.js'), 'module.exports = 42;\n');
    const prima = console.error;
    console.error = () => {};
    let r;
    try { r = componi({ radice, ingresso: 'src/preload/page-preload.js' }); } finally { console.error = prima; }
    assert.equal(r.rotti.length, 1);
    assert.match(r.rotti[0], /^src\/preload\/rotto\.js: /);
    // Gira come nel preload: il file rotto lo dice al suo require, gli altri lavorano.
    const mondo = { require: () => { throw new Error('niente'); }, console };
    vm.runInNewContext(r.codice, mondo);
    assert.deepEqual({ ...mondo.esito }, { buono: 42, e: 'SyntaxError' });
  } finally { togliCartella(radice); }
});

test('ogni require dei moduli impacchettati si legge da fermo', () => {
  assert.deepEqual(pacchetto.dinamici, [], 'una require() con un percorso calcolato non entra nel pacchetto: scrivila con una stringa o un path.join di costanti');
});

test('i moduli di Node che la sandbox non ha sono solo quelli ammessi', () => {
  assert.deepEqual(pacchetto.assenti, Object.keys(ASSENTI_AMMESSI).sort(),
    'nella sandbox del preload Node non c\'è: usa le API del browser (crypto.getRandomValues, URL…) o aggiungi qui il caso col suo perché');
});

test('ci sono tutti i content script che page-preload.js carica', () => {
  const src = leggi('src', 'preload', 'page-preload.js');
  const basi = { SHARED_DIR: 'src/shared', CONTENT_DIR: 'src/content' };
  const attesi = [...src.matchAll(/require\(path\.join\((SHARED_DIR|CONTENT_DIR), '([^']+)'\)\)/g)].map((m) => `${basi[m[1]]}/${m[2]}`);
  assert.ok(attesi.length >= 40, 'lettura dell\'elenco rotta');
  for (const f of attesi) assert.ok(pacchetto.moduli.includes(f), `${f} manca dal pacchetto`);
  for (const f of [...src.matchAll(/require\('\.\/([^']+)'\)/g)].map((m) => `src/preload/${m[1]}`)) {
    assert.ok(pacchetto.moduli.includes(f), `${f} manca dal pacchetto`);
  }
});

test('i fogli che i pannelli chiusi dei content script leggono viaggiano nel pacchetto', () => {
  const nomi = new Set(readdirSync(join(ROOT, 'src', 'styles')));
  for (const f of ['src/content/menu.js', 'src/content/popup.js']) {
    const fogli = [...leggi(f).matchAll(/'([\w-]+\.css)'/g)].map((m) => m[1]).filter((n) => nomi.has(n));
    assert.ok(fogli.length >= 2, `${f}: nessun foglio letto, la prova non guarda più niente`);
    for (const n of fogli) assert.ok(pacchetto.testi.includes(`src/styles/${n}`), `${f} legge ${n}, che non è nel pacchetto`);
  }
  // Il testo dentro è quello del file, intero.
  const r = runtime({}, eval(`(${pacchetto.codice.match(/const TESTI = (\{[\s\S]*?\n\});/)[1]})`), () => { throw new Error('no'); });
  assert.equal(r('node:fs').readFileSync('/src/content/../styles/menu.css', 'utf8'), leggi('src', 'styles', 'menu.css'));
});

// Un preload finto: moduli scritti qui, con la stessa `require` del pacchetto.
function finto(moduli, testi = {}, dellaSandbox = (s) => { throw new Error(`module not found: ${s}`); }) {
  const MODULI = {};
  for (const [k, src] of Object.entries(moduli)) {
    MODULI[k] = k.endsWith('.json')
      ? new Function('exports', 'require', 'module', `module.exports = ${src};`)
      : new Function('exports', 'require', 'module', '__filename', '__dirname', src);
  }
  return runtime(MODULI, testi, dellaSandbox);
}

test('la require del pacchetto risolve come Node: relativi, estensioni, json, path.join di __dirname, una volta sola', () => {
  globalThis.__conteggio = 0;
  const r = finto({
    '/src/preload/a.js': `const path = require('node:path'); module.exports = { b: require('./b'), dati: require('../vendor/d.json'),
      c: require(path.join(__dirname, '..', 'shared', 'c.js')), di: __dirname, file: __filename, ancora: require('./b.js') };`,
    '/src/preload/b.js': 'globalThis.__conteggio++; exports.nome = "b";',
    '/src/shared/c.js': 'module.exports = this === exports;',
    '/src/vendor/d.json': '{ "regole": [1, 2] }',
  });
  const a = r('/src/preload/a.js');
  assert.equal(a.b.nome, 'b');
  assert.equal(a.ancora, a.b);
  assert.equal(globalThis.__conteggio, 1, 'un modulo richiesto due volte gira una volta');
  assert.deepEqual(a.dati, { regole: [1, 2] });
  assert.equal(a.c, true, 'this del modulo è il suo exports, come in Node');
  assert.equal(a.di, '/src/preload');
  assert.equal(a.file, '/src/preload/a.js');
  delete globalThis.__conteggio;
});

test('un modulo caduto a metà si riprova, uno che manca lo dice, i moduli della sandbox li dà la sandbox', () => {
  globalThis.__tentativi = 0;
  const r = finto({
    '/x.js': 'if (++globalThis.__tentativi === 1) throw new Error("prima volta"); module.exports = "ok";',
  }, {}, (s) => (s === 'electron' ? { ipcRenderer: 'finto' } : (() => { throw new Error(`module not found: ${s}`); })()));
  assert.throws(() => r('/x.js'), /prima volta/);
  assert.equal(r('/x.js'), 'ok');
  assert.throws(() => r('/manca.js'), (e) => e.code === 'MODULE_NOT_FOUND' && /preloadPacchetto/.test(e.message));
  assert.deepEqual(r('electron'), { ipcRenderer: 'finto' });
  assert.throws(() => r('node:crypto'), /module not found: node:crypto/);
  delete globalThis.__tentativi;
});

test('fs del pacchetto legge solo i testi che porta, e un file assente si fa sentire', () => {
  const r = finto({}, { '/src/styles/a.css': 'p{}' });
  const fs = r('fs');
  assert.equal(fs.readFileSync('/src/content/../styles/a.css', 'utf8'), 'p{}');
  assert.equal(fs.existsSync('/src/styles/a.css'), true);
  const errori = [];
  const prima = console.error;
  console.error = (...a) => errori.push(a.join(' '));
  try {
    assert.throws(() => fs.readFileSync('/src/styles/b.css', 'utf8'), (e) => e.code === 'ENOENT');
  } finally { console.error = prima; }
  assert.equal(errori.length, 1, 'un foglio che manca lascia un pannello senza stile: deve dirlo');
});

test('domainToASCII e domainToUnicode del pacchetto rispondono come quelli di Node', () => {
  const url = finto({}, {}, (s) => (s === 'url' ? { parse() {} } : null))('node:url');
  const casi = ['example.com', 'EXAMPLE.com', 'xn--fsqu00a.xn--3lr804guic', '例子.公司', 'pаypal.com', 'xn--pypal-4ve.com',
    'münchen.de', 'faß.de', 'аррӏе.com', 'xn--80ak6aa92e.com', '💩.la', 'xn--ls8h.la', 'ＥＸＡＭＰＬＥ.com', 'www.xn--80aswg.xn--p1ai',
    'xn--zz', 'xn--', 'example.com.', '1.2.3.4', '[::1]', '::1', 'a b.com', 'user@host', 'example.com:80', 'a/b', 'ex%41mple.com', ''];
  for (const c of casi) {
    assert.equal(url.domainToASCII(c), nodeUrl.domainToASCII(c), `domainToASCII(${JSON.stringify(c)})`);
    assert.equal(url.domainToUnicode(c), nodeUrl.domainToUnicode(c), `domainToUnicode(${JSON.stringify(c)})`);
  }
  assert.equal(typeof url.parse, 'function', 'il resto del url della sandbox resta');
});

test('scrivi() mette il file intero e non lo riscrive se non cambia', () => {
  const dir = cartellaTemporanea('filo-pacchetto-');
  try {
    const dest = join(dir, 'sotto', 'page-preload.js');
    scrivi(dest);
    assert.equal(readFileSync(dest, 'utf8'), pacchetto.codice);
    const prima = statSync(dest).mtimeMs;
    scrivi(dest);
    assert.equal(statSync(dest).mtimeMs, prima);
    assert.deepEqual(readdirSync(dirname(dest)), ['page-preload.js'], 'nessun file provvisorio lasciato indietro');
  } finally { togliCartella(dir); }
});

test('il pacchetto di Filo porta il preload impacchettato, scritto prima dell\'asar', () => {
  const pkg = JSON.parse(leggi('package.json'));
  assert.equal(pkg.build.beforePack, 'src/main/preloadPacchetto.js');
  assert.ok(existsSync(join(ROOT, pkg.build.beforePack)));
  assert.equal(typeof require(join(ROOT, pkg.build.beforePack)).default, 'function', 'electron-builder chiama il default del modulo');
  const dentro = relative(ROOT, NEL_PACCHETTO).split('\\').join('/');
  assert.equal(dentro, 'generato/page-preload.js');
  assert.ok(pkg.build.files.includes('generato/**/*'), 'build.files non porta generato/: il pacchetto partirebbe senza preload');
  assert.match(leggi('.gitignore'), /^generato\/$/m, 'il file generato non va nel repo');
});

test('i pacchetti per Windows, Mac e Linux si guardano dentro prima di uscire', () => {
  for (const f of ['release.yml', 'verifica-mac.yml', 'verifica-linux.yml']) {
    const w = leggiWorkflow(f);
    assert.match(w, /extractFile\(process\.argv\[1\], 'generato\/page-preload\.js'\)/, `${f}: nessuno controlla il preload nell'asar`);
    assert.match(w, /componi\(\)\.codice/, `${f}: il preload nel pacchetto non si confronta coi sorgenti`);
  }
});

test('le pagine web, la finestrella di accesso, la shell e il fumetto non tornano fuori dalla sandbox', () => {
  const dir = join(ROOT, 'src', 'main');
  const tutti = [];
  const giro = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) giro(p); else if (e.endsWith('.js')) tutti.push(p); } };
  giro(dir);
  for (const p of tutti) {
    // Il codice, non i commenti che raccontano la scelta delle pagine interne.
    const src = readFileSync(p, 'utf8').split('\n').filter((r) => !/^\s*\/\//.test(r)).join('\n');
    const f = relative(ROOT, p).split('\\').join('/');
    assert.doesNotMatch(src, /sandbox:\s*false/, `${f}: sandbox spenta`);
    assert.doesNotMatch(src, /nodeIntegration:\s*true/, `${f}: Node dentro una pagina`);
    assert.doesNotMatch(src, /contextIsolation:\s*false/, `${f}: senza isolamento`);
  }
  const tabs = leggi('src', 'main', 'tabs.js');
  assert.match(tabs, /sandbox: !isInternal,/, 'le schede web nascono in sandbox; solo le interne, decise a parte, no');
  assert.doesNotMatch(tabs, /page-preload\.js'\)/, 'le schede web usano il preload impacchettato, non quello da disco');
});
