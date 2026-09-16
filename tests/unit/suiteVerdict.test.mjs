// Il verdetto sulla suite completa (scripts/suite-verdict.mjs).
//
// PERCHÉ QUESTI TEST
//   Da questo script dipende se una versione esce o no: la suite completa gira
//   solo in GitHub prima di pubblicare, e nel contenitore senza schermo ha
//   rossi d'ambiente scritti in tests/rossi-noti.json. Le cose che possono
//   andare male in modo costoso sono opposte:
//
//     · un rosso NUOVO coperto per sbaglio da una voce dei rossi noti (una
//       regressione arriverebbe agli utenti con la suite «verde»);
//     · un rosso NOTO non riconosciuto (la suite rossa a ogni giro, nessuna
//       versione esce più: il guasto che ha tenuto ferma la pubblicazione dal
//       18/08/2026);
//     · un JSON assente scambiato per un verde: un cancello che non gira non è
//       un cancello aperto.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import {
  normalizzaSpec,
  statoFinale,
  raccogliCasi,
  casiDellaVoce,
  vocePerCaso,
  verdetto,
  leggiArgomenti,
} from '../../scripts/suite-verdict.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', '..', 'scripts', 'suite-verdict.mjs');

// Un test del JSON di Playwright con l'esito finale che vogliamo.
const t = (status) => ({ status, results: [{ status: status === 'expected' ? 'passed' : 'failed', retry: 0 }] });
const spec = (title, status) => ({ title, tests: [t(status)] });

/** Un JSON come lo scrive Playwright: suite radice per file, describe sotto. */
function jsonSintetico({ conNuovo = true } = {}) {
  return {
    suites: [
      { title: 'alfa.spec.mjs', file: 'alfa.spec.mjs', specs: [spec('tutto bene', 'expected')] },
      {
        title: 'beta.spec.mjs',
        file: 'beta.spec.mjs',
        specs: [spec('caso rosso noto', 'unexpected'), spec('caso verde accanto', 'expected')],
      },
      {
        title: 'gamma.spec.mjs',
        file: 'gamma.spec.mjs',
        specs: [spec('qualunque cosa qui', 'unexpected'), spec('anche questa', 'unexpected')],
      },
      {
        title: 'delta.spec.mjs',
        file: 'delta.spec.mjs',
        specs: [
          spec('una volta rosso poi verde', 'flaky'),
          spec('saltato', 'skipped'),
          ...(conNuovo ? [spec('questo è nuovo', 'unexpected')] : []),
        ],
        suites: [{
          title: 'dentro un describe',
          specs: [spec('caso noto sotto un describe', 'unexpected')],
        }],
      },
    ],
    errors: [],
    stats: {},
  };
}

const NOTI = {
  contenitore: {
    specs: [
      { spec: 'tests/beta', caso: 'caso rosso noto', perche: 'ambiente', feedback: '#1' },
      { spec: 'tests/gamma', perche: 'tutto lo spec', feedback: '#2' },
      { spec: 'tests/delta', caso: ['caso noto sotto un describe', 'un altro titolo'], perche: 'due sorelle', feedback: '#3' },
    ],
  },
};

describe('le funzioni pure', () => {
  test('il nome dello spec non bada a barre, prefisso tests/ e suffisso', () => {
    for (const forma of ['tests/capture-composite', 'tests\\capture-composite.spec.mjs', 'capture-composite.spec.mjs', './tests/capture-composite.spec.js']) {
      assert.equal(normalizzaSpec(forma), 'capture-composite', forma);
    }
  });

  test('lo stato finale si ricava dai tentativi quando Playwright non lo scrive', () => {
    assert.equal(statoFinale({ results: [{ status: 'failed' }, { status: 'passed' }] }), 'flaky');
    assert.equal(statoFinale({ results: [{ status: 'failed' }, { status: 'timedOut' }] }), 'unexpected');
    assert.equal(statoFinale({ results: [{ status: 'passed' }] }), 'expected');
    assert.equal(statoFinale({ results: [] }), 'skipped');
    assert.equal(statoFinale({ status: 'unexpected', results: [{ status: 'passed' }] }), 'unexpected', 'lo stato scritto vince');
  });

  test('i casi si appiattiscono col describe nella cornice', () => {
    const casi = raccogliCasi(jsonSintetico());
    const sotto = casi.find((c) => c.titolo === 'caso noto sotto un describe');
    assert.equal(sotto.spec, 'delta');
    assert.equal(sotto.titoloCompleto, 'dentro un describe › caso noto sotto un describe');
    assert.equal(casi.find((c) => c.titolo === 'tutto bene').titoloCompleto, 'tutto bene', 'il nome del file non è una cornice');
  });

  test('`caso` può essere una stringa o un elenco', () => {
    assert.deepEqual(casiDellaVoce({ caso: ' a  b ' }), ['a b']);
    assert.deepEqual(casiDellaVoce({ caso: ['x', '', 'y'] }), ['x', 'y']);
    assert.deepEqual(casiDellaVoce({}), []);
  });

  test('una voce copre il suo caso, o tutto lo spec se non ne dichiara uno', () => {
    const noti = NOTI.contenitore.specs;
    assert.ok(vocePerCaso({ spec: 'beta.spec.mjs', titolo: 'caso rosso noto', titoloCompleto: 'caso rosso noto' }, noti));
    assert.equal(vocePerCaso({ spec: 'beta.spec.mjs', titolo: 'caso verde accanto', titoloCompleto: 'caso verde accanto' }, noti), null,
      'la voce con un caso NON copre gli altri casi dello stesso spec');
    assert.ok(vocePerCaso({ spec: 'gamma', titolo: 'qualunque', titoloCompleto: 'qualunque' }, noti), 'solo spec = tutto lo spec');
    assert.ok(vocePerCaso({ spec: 'delta', titolo: 'caso noto sotto un describe', titoloCompleto: 'dentro un describe › caso noto sotto un describe' }, noti),
      'il titolo nudo copre anche il caso dentro un describe');
    assert.equal(vocePerCaso({ spec: 'delta', titolo: 'questo è nuovo', titoloCompleto: 'questo è nuovo' }, noti), null);
  });

  test('il verdetto separa verdi, flaky, saltati, noti coperti e nuovi', () => {
    const v = verdetto(jsonSintetico(), NOTI.contenitore.specs);
    assert.equal(v.totale, 9);
    assert.equal(v.verdi, 2);
    assert.equal(v.flaky, 1, 'un flaky ripassato non è un rosso');
    assert.equal(v.saltati, 1);
    assert.equal(v.notiCoperti.length, 4, 'beta (caso), gamma (due, tutto lo spec), delta (describe)');
    assert.deepEqual(v.nuovi.map((c) => c.titolo), ['questo è nuovo']);
    assert.equal(verdetto(jsonSintetico({ conNuovo: false }), NOTI.contenitore.specs).nuovi.length, 0);
  });

  test('gli argomenti: file, --out, --rossi; un\'opzione ignota è un errore', () => {
    assert.deepEqual(leggiArgomenti(['r.json', '--out', 'n.txt', '--rossi', 'k.json']), { file: 'r.json', out: 'n.txt', rossi: 'k.json' });
    assert.throws(() => leggiArgomenti(['r.json', '--boh']), /non capita/);
    assert.throws(() => leggiArgomenti(['r.json', '--out']), /vuole un percorso/);
  });
});

describe('lo script da riga di comando', () => {
  const dir = cartellaTemporanea('suite-verdict-');
  const fileNoti = join(dir, 'rossi-noti.json');
  writeFileSync(fileNoti, JSON.stringify(NOTI), 'utf8');

  const lancia = (jsonFile, out) => spawnSync(process.execPath, [CLI, jsonFile, '--out', out, '--rossi', fileNoti], { encoding: 'utf8' });

  test('un rosso nuovo → uscita 1, e il file dei nuovi lo nomina con spec e titolo', () => {
    const jsonFile = join(dir, 'con-nuovo.json');
    const out = join(dir, 'nuovi-1.txt');
    writeFileSync(jsonFile, JSON.stringify(jsonSintetico()), 'utf8');
    const r = lancia(jsonFile, out);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /Rossi NUOVI: 1/);
    assert.match(r.stdout, /Rossi noti del contenitore, coperti: 4/);
    const nuovi = readFileSync(out, 'utf8');
    assert.match(nuovi, /tests\/delta\.spec\.mjs › questo è nuovo/);
    assert.doesNotMatch(nuovi, /caso rosso noto/, 'i noti coperti non stanno fra i nuovi');
  });

  test('senza rossi nuovi → uscita 0, file dei nuovi vuoto', () => {
    const jsonFile = join(dir, 'senza-nuovo.json');
    const out = join(dir, 'nuovi-0.txt');
    writeFileSync(jsonFile, JSON.stringify(jsonSintetico({ conNuovo: false })), 'utf8');
    const r = lancia(jsonFile, out);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Rossi NUOVI: 0/);
    assert.equal(readFileSync(out, 'utf8'), '');
  });

  test('JSON assente → uscita 2 con un messaggio chiaro: non è un verde', () => {
    const r = lancia(join(dir, 'non-esiste.json'), join(dir, 'nuovi-2.txt'));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /NON è partita/);
    assert.ok(!existsSync(join(dir, 'nuovi-2.txt')));
  });

  test('JSON illeggibile o senza casi → uscita 2', () => {
    const rotto = join(dir, 'rotto.json');
    writeFileSync(rotto, '{ non è json', 'utf8');
    assert.equal(lancia(rotto, join(dir, 'n.txt')).status, 2);
    const vuoto = join(dir, 'vuoto.json');
    writeFileSync(vuoto, JSON.stringify({ suites: [], errors: [{ message: 'Error: il fixture non si carica' }] }), 'utf8');
    const r = lancia(vuoto, join(dir, 'n.txt'));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /nessun caso/);
  });

  test('un errore fuori dai casi (un file che non si carica) è un rosso nuovo, non un verde', () => {
    const jsonFile = join(dir, 'errore-globale.json');
    const out = join(dir, 'nuovi-3.txt');
    const j = jsonSintetico({ conNuovo: false });
    j.errors = [{ message: 'Error: Cannot find module ../helpers/sparito.mjs\n    at …' }];
    writeFileSync(jsonFile, JSON.stringify(j), 'utf8');
    const r = lancia(jsonFile, out);
    assert.equal(r.status, 1);
    assert.match(readFileSync(out, 'utf8'), /errore fuori dai casi: Error: Cannot find module/);
  });

  test.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ } });
});

// I rossi noti VERI devono citare titoli che esistono, altrimenti il primo
// giro in GitHub li segnalerebbe come nuovi e nessuna versione uscirebbe.
test('ogni caso dei rossi noti del contenitore è il titolo di un test che esiste in quello spec', () => {
  const ROOT = resolve(__dirname, '..', '..');
  const j = JSON.parse(readFileSync(resolve(ROOT, 'tests', 'rossi-noti.json'), 'utf8'));
  for (const voce of j.contenitore.specs) {
    const src = readFileSync(resolve(ROOT, `${voce.spec}.spec.mjs`), 'utf8').replace(/\s+/g, ' ');
    for (const titolo of casiDellaVoce(voce)) {
      assert.ok(src.includes(titolo),
        `${voce.spec}: il caso «${titolo}» non è il titolo di un test di quello spec: la voce non coprirebbe niente`);
    }
  }
});
