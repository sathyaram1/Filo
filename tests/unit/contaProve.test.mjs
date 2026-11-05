// #1363: il numero di prove che un lavoro aggiunge o tocca lo conta uno script, non il modello che legge il diff.
// Si contano i casi SCRITTI (test(), it() e le varianti che dichiarano un caso), mai quelli dentro stringhe e commenti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import {
  PROVE_SERVER, casiDiProva, confrontaCasi, contaProve, rigaDelConto, testoDelConto, tipoDiFile, tipoDiFileServer,
} from '../../scripts/lib/conta-prove.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('tipoDiFile: unit e spec sono prove del lavoro, quelle dei giri stanno a parte, il resto non è una prova', () => {
  assert.equal(tipoDiFile('tests/unit/contaProve.test.mjs'), 'unit');
  assert.equal(tipoDiFile('tests/menu.spec.mjs'), 'spec');
  assert.equal(tipoDiFile('tests/sotto/cartella/x.spec.js'), 'spec');
  assert.equal(tipoDiFile('tests\\unit\\win.test.mjs'), 'unit');
  assert.equal(tipoDiFile('tests/verifica/1363/giro1-r1-x.spec.mjs'), 'giro');
  for (const no of ['tests/verifica/1363/aiuto.mjs', 'tests/helpers/percorsi.mjs', 'tests/fixtures/electron.mjs', 'src/x.test.mjs', 'tests/unit/dati.json', 'scripts/a.spec.mjs']) {
    assert.equal(tipoDiFile(no), '', no);
  }
});

test('casiDiProva: conta i casi dichiarati, non le chiamate dentro stringhe, commenti, regex e template', () => {
  const src = [
    "import { test } from '@playwright/test';",
    "const re = /test\\(x, () => 1\\)/; // test('nel commento', () => {})",
    '/* it("nel blocco", () => {}) */',
    "const finto = `test('in un template', () => {}) ${ fn(`annidato ${ 'test(\"x\", () => {})' }`) }`;",
    "test('uno', async ({ page }) => { test.skip(cond, 'motivo'); const s = \"test('due', () => {})\"; });",
    'it("due con it", function () {});',
    "test.describe('gruppo', () => {",
    '  test.only(`tre ${n}`, corpo);',
    "  test.fixme('quattro', () => {});",
    "  test.fail('cinque', async () => {});",
    "  test.skip('sei', () => {});",
    '});',
    'test.fail();',
    "test.skip(({ browserName }) => browserName === 'webkit', 'non qui');",
    'x.test(y, () => {}); mytest(z, () => {});',
    'const n = a / b; test(\'sette dopo una divisione\', () => {});',
  ].join('\n');
  assert.deepEqual(casiDiProva(src).map((c) => c.titolo), ['uno', 'due con it', '`tre ${n}`', 'quattro', 'cinque', 'sei', 'sette dopo una divisione']);
});

test('casiDiProva: i titoli letterali si leggono senza virgolette né escape', () => {
  const src = "test('l\\'ultima voce resta', () => {});\ntest(\"con \\\"virgolette\\\"\", () => {});\ntest(`riga ${1}`, () => {});";
  assert.deepEqual(casiDiProva(src).map((c) => c.titolo), ["l'ultima voce resta", 'con "virgolette"', '`riga ${1}`']);
});

test('confrontaCasi: aggiunti, toccati e tolti; spazi e a capo non toccano un caso, lo stesso titolo due volte restano due', () => {
  const prima = "test('a', () => { x(1); });\ntest('b', () => { y(); });\ntest('c', () => {});\ntest('d', () => {});";
  const dopo = "test('a', () => {\n  x(1);\n});\ntest('b', () => { y(2); });\ntest('d', () => {});\ntest('d', () => {});\ntest('e', () => {});";
  assert.deepEqual(confrontaCasi(prima, dopo), { aggiunti: ['d', 'e'], toccati: ['b'], tolti: ['c'] });
  assert.deepEqual(confrontaCasi('', "test('nuovo', () => {});"), { aggiunti: ['nuovo'], toccati: [], tolti: [] });
  assert.deepEqual(confrontaCasi("test('via', () => {});", ''), { aggiunti: [], toccati: [], tolti: ['via'] });
});

test('contaProve: le prove dei giri non entrano nel conto del lavoro, i file che non sono prove non contano', () => {
  const conto = contaProve([
    { percorso: 'tests/unit/a.test.mjs', prima: null, dopo: "test('x', () => {}); test('y', () => {});" },
    { percorso: 'tests/menu.spec.mjs', prima: "test('m', () => { a(); });", dopo: "test('m', () => { b(); });" },
    { percorso: 'tests/verifica/9/giro1-r1-x.spec.mjs', prima: null, dopo: "test('r1 rosso', () => {});" },
    { percorso: 'tests/helpers/aiuto.mjs', prima: null, dopo: "test('non conta', () => {});" },
    { percorso: 'src/codice.js', prima: '', dopo: "test('nemmeno', () => {});" },
  ]);
  assert.deepEqual(conto.lavoro, { aggiunti: 2, toccati: 1, tolti: 0 });
  assert.deepEqual(conto.totali.giro, { aggiunti: 1, toccati: 0, tolti: 0 });
  assert.equal(rigaDelConto(conto), 'prove aggiunte 2 (unit 2, spec 0), toccate 1, tolte 0');
  const testo = testoDelConto(conto, { codice: [{ percorso: 'src/codice.js', aggiunte: 10, tolte: 2 }] });
  assert.match(testo, /tests\/unit\/a\.test\.mjs \(unit\): aggiunti 2: «x», «y»/);
  assert.match(testo, /Prove dei giri di verifica \(fuori dalla suite, non contano qui\): aggiunte 1/);
  assert.match(testo, /Codice cambiato fuori da tests\/: 1 file, \+10 −2 righe/);
  assert.doesNotMatch(testo, /giro1-r1/, 'i file dei giri non si elencano fra le prove del lavoro');
});

test('le prove del server stanno in functions/test/, e il suo codice si conta fuori da lì (#2049)', () => {
  assert.equal(tipoDiFileServer('functions/test/battito-misura.test.js'), 'unit');
  assert.equal(tipoDiFileServer('functions\\test\\sotto\\win.test.mjs'), 'unit');
  for (const no of ['functions/battito.js', 'functions/test/aiuto.js', 'tests/unit/a.test.mjs', 'test/a.test.js']) assert.equal(tipoDiFileServer(no), '', no);
  const conto = contaProve([
    { percorso: 'functions/test/battito.test.js', prima: null, dopo: "test('la misura si sostituisce', () => {});" },
    { percorso: 'tests/unit/a.test.mjs', prima: null, dopo: "test('non è del server', () => {});" },
  ], { prove: PROVE_SERVER });
  assert.equal(rigaDelConto(conto), 'prove aggiunte 1 (unit 1, spec 0), toccate 0, tolte 0');
  const testo = testoDelConto(conto, { codice: [{ percorso: 'functions/battito.js', aggiunte: 1, tolte: 1 }], prove: PROVE_SERVER });
  assert.match(testo, /functions\/test\/battito\.test\.js \(unit\): aggiunti 1: «la misura si sostituisce»/);
  assert.match(testo, /Codice cambiato fuori da functions\/test\/: 1 file, \+1 −1 righe/);
  assert.match(testoDelConto(contaProve([])), /Codice cambiato fuori da tests\/: nessun file/, 'senza dirlo le regole sono quelle dell\'app');
});

function repoDiProva() {
  const casa = cartellaTemporanea('filo-conta-prove-');
  const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: casa, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(casa, f)), { recursive: true }); writeFileSync(resolve(casa, f), t, 'utf8'); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('tests/unit/vecchio.test.mjs', "test('resta', () => { a(); });\ntest('cambia', () => { b(); });\n");
  scrivi('tests/spostato.spec.mjs', "test('spostato', () => {});\n");
  scrivi('src/calcolo.js', 'module.exports = 1;\n');
  g('add', '-A'); g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD');
  g('checkout', '-q', '-b', 'claude/lavoro');
  scrivi('tests/unit/vecchio.test.mjs', "test('resta', () => { a(); });\ntest('cambia', () => { b(2); });\ntest('nuovo', () => {});\n");
  mkdirSync(resolve(casa, 'tests', 'sotto'), { recursive: true });
  g('mv', 'tests/spostato.spec.mjs', 'tests/sotto/spostato.spec.mjs');
  scrivi('tests/verifica/7/giro1-r1-x.spec.mjs', "test('r1 rosso', () => {});\n");
  scrivi('src/calcolo.js', 'module.exports = 2;\nmodule.exports.b = 3;\n');
  g('add', '-A'); g('commit', '-qm', 'lavoro');
  return { casa, base };
}

test('lo script conta sul repo vero: casi aggiunti e toccati, uno spostamento non è una prova nuova, i giri a parte', (t) => {
  const { casa, base } = repoDiProva();
  t.after(() => togliCartella(casa));
  const r = spawnSync(process.execPath, [resolve(REPO, 'scripts', 'conta-prove.mjs'), '--base', base, '--json'], {
    env: { ...process.env, FILO_REPO_ROOT: casa }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.conto.lavoro, { aggiunti: 1, toccati: 1, tolti: 0 });
  assert.deepEqual(out.conto.totali.giro, { aggiunti: 1, toccati: 0, tolti: 0 });
  assert.deepEqual(out.codice, [{ percorso: 'src/calcolo.js', aggiunte: 2, tolte: 1 }]);
  const testo = spawnSync(process.execPath, [resolve(REPO, 'scripts', 'conta-prove.mjs'), '--base', base], { env: { ...process.env, FILO_REPO_ROOT: casa }, encoding: 'utf8' });
  assert.match(testo.stdout, /prove aggiunte 1 \(unit 1, spec 0\), toccate 1, tolte 0/);
});

/** Il clone di filo-security di un lavoro server: il ramo omonimo con una prova in functions/test/, e main andato avanti. */
function serverDiProva(ramo) {
  const srv = cartellaTemporanea('filo-conta-prove-server-');
  const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: srv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(srv, f)), { recursive: true }); writeFileSync(resolve(srv, f), t, 'utf8'); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('functions/battito.js', 'module.exports = 1;\n');
  scrivi('functions/test/vecchia.test.js', "it('resta com\\'era', () => {});\n");
  g('add', '-A'); g('commit', '-qm', 'base del server');
  g('checkout', '-q', '-b', ramo);
  scrivi('functions/battito.js', 'module.exports = 2;\n');
  scrivi('functions/test/battito.test.js', "it('la misura nuova sostituisce la vecchia', () => {});\ntest('e resta una sola', () => {});\n");
  g('add', '-A'); g('commit', '-qm', 'lavoro del server');
  g('checkout', '-q', 'main');
  scrivi('functions/altro.js', 'module.exports = 3;\n');
  scrivi('functions/test/altro.test.js', "it('di un altro lavoro', () => {});\n");
  g('add', '-A'); g('commit', '-qm', 'main del server va avanti');
  g('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { srv, g };
}

test('con --server lo script conta anche le prove del server del ramo omonimo, come la lettura del diff (#2093)', (t) => {
  const { casa, base } = repoDiProva();
  const { srv, g: gs } = serverDiProva('claude/lavoro');
  t.after(() => togliCartella(casa));
  t.after(() => togliCartella(srv));
  const conta = (...a) => spawnSync(process.execPath, [resolve(REPO, 'scripts', 'conta-prove.mjs'), '--base', base, ...a], {
    env: { ...process.env, FILO_REPO_ROOT: casa }, encoding: 'utf8',
  });
  const j = conta('--server', srv, '--json');
  assert.equal(j.status, 0, j.stderr);
  const out = JSON.parse(j.stdout);
  assert.deepEqual(out.conto.lavoro, { aggiunti: 1, toccati: 1, tolti: 0 }, 'il conto dell\'app resta quello di prima');
  assert.equal(out.server.ramo, 'claude/lavoro');
  assert.deepEqual(out.server.conto.lavoro, { aggiunti: 2, toccati: 0, tolti: 0 }, 'il main del server andato avanti non è il lavoro');
  assert.deepEqual(out.server.codice, [{ percorso: 'functions/battito.js', aggiunte: 1, tolte: 1 }]);
  assert.equal(out.server.diff, undefined, 'il conto non si porta dietro il diff');

  const testo = conta('--server', srv);
  assert.equal(testo.status, 0, testo.stderr);
  assert.match(testo.stdout, /prove aggiunte 1 \(unit 1, spec 0\), toccate 1, tolte 0/);
  const server = testo.stdout.slice(testo.stdout.indexOf('Server, ramo claude/lavoro di filo-security'));
  assert.match(server, /^Server, ramo claude\/lavoro di filo-security, da [0-9a-f]{12} a [0-9a-f]{12}\.\nProve del lavoro, contate dallo script: prove aggiunte 2 \(unit 2, spec 0\)/);
  assert.match(server, /functions\/test\/battito\.test\.js \(unit\): aggiunti 2: «la misura nuova sostituisce la vecchia», «e resta una sola»/);
  assert.match(server, /Codice cambiato fuori da functions\/test\/: 1 file, \+1 −1 righe\.\n- functions\/battito\.js: \+1 −1/);
  assert.doesNotMatch(conta().stdout, /Server/, 'senza --server il conto è solo dell\'app');

  gs('checkout', '-q', '-b', 'claude/vuoto', 'main');
  gs('branch', '-q', '-D', 'claude/lavoro');
  const senzaRamo = conta('--server', srv);
  assert.equal(senzaRamo.status, 3, 'chi chiede il server e non l\'ha non riceve un conto che sembra intero');
  assert.match(senzaRamo.stdout, /prove aggiunte 1 \(unit 1, spec 0\)/, 'il conto dell\'app arriva lo stesso');
  assert.match(senzaRamo.stdout, /Server: le prove di filo-security non si sono potute contare: in .* il ramo claude\/lavoro non c'è, né locale né scaricato da origin\./);
  const nessunClone = conta('--server', resolve(srv, 'non-clonato'));
  assert.equal(nessunClone.status, 3);
  assert.match(nessunClone.stdout, /non si sono potute contare: il clone del server non c'è/);

  gs('branch', '-q', 'claude/lavoro', 'main');
  const vuoto = conta('--server', srv, '--json');
  assert.equal(vuoto.status, 0, vuoto.stderr);
  assert.match(JSON.parse(vuoto.stdout).server.vuoto, /non ha commit fuori dal main del server/);
  assert.match(conta('--server', srv).stdout, /Server: il ramo claude\/lavoro del server non ha commit fuori dal main del server, nessuna prova da contare\./);
});

// La misura che ha fatto nascere #1363: nell'esperimento del 31/08 la versione finale di #500 aveva 48 prove.
test('sul lavoro fuso di #500 il conto dà le 48 prove dell\'esperimento', (t) => {
  const c = ['10ffd0cd752e', '9f76fce171d6'];
  if (c.some((sha) => spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: REPO }).status !== 0)) {
    t.skip('storia di #500 non scaricata in questo clone');
    return;
  }
  const r = spawnSync(process.execPath, [resolve(REPO, 'scripts', 'conta-prove.mjs'), '--base', c[0], '--head', c[1], '--json'], {
    env: { ...process.env, FILO_REPO_ROOT: REPO }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).conto.lavoro.aggiunti, 48);
});
