// La mappa prova → file (#2502): dagli indirizzi registrati ai file del repo, dagli offset alle righe, dal diff alle
// righe del commit della mappa, e dalle righe agli spec, dal più specifico al più largo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  percorsoDaIndirizzo, iniziDiRiga, rigaDi, durateDaRapporto, unisciRegistrazioni, costruisciMappa, righeDellaMappa,
  mappaDaRegistro, blocchiDelDiff, righeDelBlocco, rigaSullaMappa, proveDelCambio,
} from '../../scripts/lib/mappaProve.mjs';
import { leggiArgomenti, testoScelta, leggiMappa } from '../../scripts/mappa-prove.mjs';
import { specDellaScelta, testoDellaMappa } from '../../scripts/finish-local.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const ROOT = '/repo/Filo';

test('gli indirizzi delle pagine e dei preload diventano file del repo, gli altri no', () => {
  assert.equal(percorsoDaIndirizzo('filo://shell/shell.js', ROOT), 'src/renderer/shell.js');
  assert.equal(percorsoDaIndirizzo('filo://shared/messages.js', ROOT), 'src/shared/messages.js');
  assert.equal(percorsoDaIndirizzo('filo://options/options.js', ROOT), 'src/pages/options/options.js');
  assert.equal(percorsoDaIndirizzo('filo://newtab/', ROOT), 'src/pages/dashboard/dashboard.html');
  assert.equal(percorsoDaIndirizzo('filo://src/content/leggi.js', ROOT), 'src/content/leggi.js');
  assert.equal(percorsoDaIndirizzo('/repo/Filo/src/preload/shell-preload.js', ROOT), 'src/preload/shell-preload.js');
  assert.equal(percorsoDaIndirizzo('file:///repo/Filo/src/main/tabs.js', ROOT), 'src/main/tabs.js');
  assert.equal(percorsoDaIndirizzo('C:\\repo\\Filo\\src\\main\\tabs.js', 'C:\\repo\\Filo'), 'src/main/tabs.js');
  for (const fuori of ['node:events', 'node:electron/js2c/sandbox_bundle', '', 'filo://asset/icona.svg', '/repo/Filo-altro/src/x.js', '/repo/Filo/tests/x.mjs', 'https://example.org/a.js', '/repo/Filo/src/../../etc/passwd']) {
    assert.equal(percorsoDaIndirizzo(fuori, ROOT), null, fuori);
  }
});

test('un offset cade sulla sua riga', () => {
  const inizi = iniziDiRiga('a\nbc\n\nd');
  assert.deepEqual(inizi, [0, 2, 5, 6]);
  assert.deepEqual([0, 1, 2, 4, 5, 6, 99].map((o) => rigaDi(inizi, o)), [1, 1, 2, 2, 3, 4, 4]);
});

test('i tempi di ogni spec vengono dall\'ultimo tentativo di ogni caso, anche dentro i describe', () => {
  const rapporto = { suites: [
    { file: 'a.spec.mjs', specs: [{ tests: [{ results: [{ duration: 100 }, { duration: 30 }] }] }], suites: [{ specs: [{ tests: [{ results: [{ duration: 5 }] }] }] }] },
    { file: 'b.spec.mjs', specs: [{ tests: [{ results: [{ duration: 7 }] }] }] },
  ] };
  assert.deepEqual([...durateDaRapporto(rapporto)], [['tests/a.spec.mjs', 35], ['tests/b.spec.mjs', 7]]);
});

const SORGENTE = {
  // righe: 1 commento, 2-4 funzione a, 5-7 funzione b, 8 chiamata
  'src/main/x.js': '// x\nfunction a() {\n  return 1;\n}\nfunction b() {\n  return 2;\n}\na();\n',
  'src/renderer/shell.js': '(() => {\n  function c() {}\n  function d() {}\n  c();\n})();\n',
};
const off = (rel, frammento) => SORGENTE[rel].indexOf(frammento);
const fine = (rel, frammento) => off(rel, frammento) + frammento.length;

function registrazioni() {
  const x = 'src/main/x.js';
  const s = 'src/renderer/shell.js';
  return [
    // la prova A esegue a(), in due lanci; la B carica x e basta; la C passa dalla shell e da d()
    { prova: 'tests/a.spec.mjs', processo: 'main', file: { [x]: [[0, SORGENTE[x].length], [off(x, 'function a'), fine(x, 'return 1;\n}')]] } },
    { prova: 'tests/a.spec.mjs', processo: 'main', file: { [x]: [[off(x, 'function a'), fine(x, 'return 1;\n}')]] } },
    { prova: 'tests/b.spec.mjs', processo: 'main', file: { [x]: [[0, SORGENTE[x].length]] } },
    { prova: 'tests/c.spec.mjs', processo: 'pagine', indirizzi: { 'filo://shell/shell.js': [[0, SORGENTE[s].length], [off(s, '() => {'), fine(s, 'c();\n})')], [off(s, 'function d'), fine(s, 'function d() {}')]], 'node:events': [[0, 10]] } },
    { prova: '', processo: 'main', file: { [x]: [[0, 3]] } },
  ];
}

function mappa() {
  const unite = unisciRegistrazioni(registrazioni(), ROOT);
  return costruisciMappa({ registrazioni: unite, sorgente: (rel) => SORGENTE[rel] ?? null, root: ROOT, durate: new Map([['tests/a.spec.mjs', 3000], ['tests/b.spec.mjs', 1000]]), commit: 'abc' });
}

test('le registrazioni di una prova diventano una, e la mappa scrive righe e insiemi una volta', () => {
  const unite = unisciRegistrazioni(registrazioni(), ROOT);
  assert.deepEqual(unite.map((u) => u.prova), ['tests/a.spec.mjs', 'tests/b.spec.mjs', 'tests/c.spec.mjs', '']);
  assert.equal(unite[0].file['src/main/x.js'].length, 2, 'i due lanci della stessa prova non doppiano la funzione');
  assert.deepEqual(Object.keys(unite[2].file), ['src/renderer/shell.js'], 'node:events non è un file del repo');
  const m = mappa();
  assert.equal(m.senzaProva, 1, 'la registrazione senza prova si conta, non entra');
  assert.deepEqual(m.prove, [{ spec: 'tests/a.spec.mjs', ms: 3000 }, { spec: 'tests/b.spec.mjs', ms: 1000 }, { spec: 'tests/c.spec.mjs', ms: 0 }]);
  const x = m.file['src/main/x.js'];
  assert.deepEqual(x.funzioni.map(([da, a]) => [da, a]), [[1, 8], [2, 4]]);
  assert.deepEqual(m.insiemi[x.carico], [0, 1]);
  assert.deepEqual(m.insiemi[x.funzioni[1][2]], [0]);
});

test('la mappa passa dal registro e torna uguale, anche coi tempi di GitHub davanti alle righe', () => {
  const m = mappa();
  const righe = righeDellaMappa(m).map((r) => `2026-11-26T00:00:00.1234567Z ${r}`);
  const letta = mappaDaRegistro(['altro', ...righe, 'altro ancora'].join('\n'));
  assert.deepEqual(letta.mappa, m);
  assert.match(mappaDaRegistro('[mappa-prove] 2/2 abc').errore || '', /manca il pezzo 1 di 2/);
  assert.match(mappaDaRegistro('niente').errore, /nessuna riga/);
});

test('il diff -U0: righe toccate nella numerazione di prima, aggiunte fra due righe, file nuovi e tolti', () => {
  const diff = [
    'diff --git a/src/main/x.js b/src/main/x.js', '--- a/src/main/x.js', '+++ b/src/main/x.js',
    '@@ -3 +3 @@', '-  return 1;', '+  return 3;',
    '@@ -6,0 +7,2 @@', '+// due', '+// righe',
    'diff --git a/src/n.js b/src/n.js', 'new file mode 100644', '--- /dev/null', '+++ b/src/n.js', '@@ -0,0 +1 @@', '+x',
    'diff --git a/src/v.js b/src/v.js', '--- a/src/v.js', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-a', '-b',
  ].join('\n');
  const { file, nuovi, tolti } = blocchiDelDiff(diff);
  assert.deepEqual(file.get('src/main/x.js').flatMap(righeDelBlocco), [3, 6, 7]);
  assert.deepEqual(nuovi, ['src/n.js']);
  assert.deepEqual(tolti, ['src/v.js']);
});

test('una riga di adesso torna alla riga del commit della mappa, oltre i cambi arrivati dopo', () => {
  // dal commit della mappa a oggi: aggiunte 2 righe dopo la 2, tolta la 10, cambiata la 20 (in 3 righe)
  const verso = [{ da: 2, n: 0, nuovoDa: 3, nuovoN: 2 }, { da: 10, n: 1, nuovoDa: 11, nuovoN: 0 }, { da: 20, n: 1, nuovoDa: 21, nuovoN: 3 }];
  assert.equal(rigaSullaMappa(1, verso), 1);
  assert.equal(rigaSullaMappa(2, verso), 2);
  assert.equal(rigaSullaMappa(3, verso), 2, 'una riga aggiunta dopo va dove è stata aggiunta');
  assert.equal(rigaSullaMappa(5, verso), 3);
  assert.equal(rigaSullaMappa(11, verso), 9);
  assert.equal(rigaSullaMappa(12, verso), 11);
  assert.equal(rigaSullaMappa(22, verso), 20, 'dentro un cambio va al suo inizio');
  assert.equal(rigaSullaMappa(24, verso), 21);
  assert.equal(rigaSullaMappa(7, []), 7);
});

test('dalle righe agli spec: prima chi passa dalla funzione cambiata, poi chi carica solo il file', () => {
  const m = mappa();
  const dentroA = proveDelCambio(m, new Map([['src/main/x.js', [3]]]));
  assert.deepEqual(dentroA.prove.map((p) => [p.spec, p.livello]), [['tests/a.spec.mjs', 'funzione']]);
  assert.deepEqual(proveDelCambio(m, new Map([['src/main/x.js', [3]]]), { soglia: 0 }).prove.map((p) => p.livello), ['larga'],
    'una funzione che oltre la soglia di spec eseguono vale come la suite intera');
  const fuoriDaA = proveDelCambio(m, new Map([['src/main/x.js', [8]]]));
  assert.deepEqual(fuoriDaA.prove.map((p) => [p.spec, p.livello]), [['tests/b.spec.mjs', 'file'], ['tests/a.spec.mjs', 'file']], 'stesso livello: prima il più breve');
  const insieme = proveDelCambio(m, new Map([['src/main/x.js', [3, 8]], ['src/renderer/shell.js', [3]], ['src/nuovo.js', [1]]]));
  // a passa dalla funzione cambiata e carica il file cambiato, c solo dalla funzione: a pesa di più.
  assert.deepEqual(insieme.prove.map((p) => [p.spec, p.livello]), [['tests/a.spec.mjs', 'funzione'], ['tests/c.spec.mjs', 'funzione'], ['tests/b.spec.mjs', 'file']]);
  assert.deepEqual(insieme.senzaProve, ['src/nuovo.js']);
  const interoIife = proveDelCambio(m, new Map([['src/renderer/shell.js', [5]]]));
  assert.deepEqual(interoIife.prove.map((p) => p.livello), ['file'], 'la IIFE che avvolge il file vale come il caricamento');
  const fileIntero = proveDelCambio(m, new Map([['src/main/x.js', null]]));
  assert.deepEqual(fileIntero.prove.map((p) => [p.spec, p.file]), [['tests/b.spec.mjs', ['src/main/x.js']], ['tests/a.spec.mjs', ['src/main/x.js']]]);
});

test('lo strumento: opzioni capite, e il testo dice i due livelli, i tempi e i file che nessuno prova', () => {
  assert.deepEqual(leggiArgomenti(['--base', 'origin/main', 'src/a.js']), { comando: 'scegli', file: ['src/a.js'], json: false, base: 'origin/main' });
  assert.match(leggiArgomenti(['--boh']).errore, /non capita/);
  assert.match(leggiArgomenti(['costruisci']).errore, /--registrazioni/);
  const m = mappa();
  const { prove, senzaProve } = proveDelCambio(m, new Map([['src/main/x.js', [3, 8]]]));
  const t = testoScelta({ prove, senzaProve, nuovi: ['src/n.js'], mappa: m, fonte: 'corsa 1' });
  assert.match(t, /passano dalle funzioni cambiate \(1, circa 3 s\)/);
  assert.match(t, /caricano solo i file cambiati \(1, circa 1 s\)/);
  assert.match(t, /Nessuna prova li fa eseguire.*src\/n\.js/);
  assert.match(t, /In tutto 2 spec, circa 4 s/);
});

test('la mappa si legge da un file, JSON o registro', () => {
  const dir = cartellaTemporanea('mappa-prove-');
  try {
    const m = mappa();
    writeFileSync(join(dir, 'm.json'), JSON.stringify(m));
    writeFileSync(join(dir, 'registro.txt'), righeDellaMappa(m).join('\n'));
    assert.deepEqual(leggiMappa({ file: join(dir, 'm.json') }).mappa, m);
    assert.deepEqual(leggiMappa({ file: join(dir, 'registro.txt') }).mappa, m);
    assert.match(leggiMappa({ file: join(dir, 'manca.json') }).errore, /non leggo/);
  } finally { togliCartella(dir); }
});

test('finish:check: coi file che la mappa conosce sceglie lei dalle righe cambiate, gli altri restano per area', () => {
  const dir = cartellaTemporanea('mappa-finish-');
  try {
    const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const scrivi = (rel, testo) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), testo); };
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
    scrivi('src/main/x.js', SORGENTE['src/main/x.js']);
    for (const s of ['a', 'b', 'x-area', 'y-cosa']) scrivi(`tests/${s}.spec.mjs`, '');
    g('add', '-A'); g('commit', '-qm', 'base');
    const commitMappa = g('rev-parse', 'HEAD');
    // Dopo la mappa main aggiunge due righe in cima: la riga cambiata dal ramo va riportata indietro di due.
    scrivi('src/main/x.js', `// uno\n// due\n${SORGENTE['src/main/x.js']}`);
    g('commit', '-qam', 'main va avanti');
    g('checkout', '-q', '-b', 'lavoro');
    // Una riga dentro a() e una del modulo, che gira a ogni caricamento.
    scrivi('src/main/x.js', `// uno\n// due\n${SORGENTE['src/main/x.js'].replace('return 1;', 'return 9;').replace('a();\n', 'a(); a();\n')}`);
    scrivi('src/main/y.js', 'module.exports = 1;\n');
    g('add', '-A'); g('commit', '-qm', 'lavoro');
    const m = { ...mappa(), commit: commitMappa };
    const scelta = specDellaScelta({ changed: ['src/main/x.js', 'src/main/y.js'], base: 'main', root: dir, mappa: m });
    assert.deepEqual(scelta.specs.sort(), ['tests/a', 'tests/y-cosa'], 'a passa da a(); y è nuovo e va per area; x-area non serve più');
    assert.deepEqual(scelta.mappa.soloCaricano, ['tests/b']);
    const testo = testoDellaMappa({ letta: { mappa: m, fonte: 'corsa 7' }, daMappa: scelta.mappa });
    assert.match(testo, /corsa 7.*1 spec passano dalle funzioni cambiate/);
    assert.match(testo, /Altri 1 caricano soltanto i file cambiati.*suite su main/);
    const senza = specDellaScelta({ changed: ['src/main/x.js'], base: 'main', root: dir });
    assert.deepEqual(senza.specs.sort(), ['tests/x-area'], 'senza mappa resta la scelta per area');
    assert.match(testoDellaMappa({ letta: { errore: 'gh non c\'è' }, daMappa: null }), /non disponibile \(gh non c'è\): scelgo gli spec per area/);
  } finally { togliCartella(dir); }
});
