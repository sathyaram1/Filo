// Il verdetto sulla suite completa (scripts/suite-verdict.mjs).
//
// PERCHÉ QUESTI TEST
//   Da questo script dipende se una versione esce o no: la suite completa gira
//   solo in GitHub, a ogni fusione su main, e nel contenitore senza schermo ha
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
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';
import {
  normalizzaSpec,
  statoFinale,
  raccogliCasi,
  casiDellaVoce,
  vocePerCaso,
  verdetto,
  leggiArgomenti,
  primaRiga,
  classificaErroriGlobali,
  chiaviDelVerdetto,
  eTettoDellaCorsa,
  nomeEsitoParte,
  partiSenzaEsito,
  rossiDellePartiMancanti,
  rigaRosso,
  FUORI_DAI_CASI,
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

  test('i teardown scaduti sono avvisi da soli, rossi se c\'è un altro rosso; il resto è sempre rosso', () => {
    const td = { message: '[31mWorker teardown timeout of 60000ms exceeded.[39m\n…' };
    const altro = { message: 'Error: Cannot find module x' };
    assert.equal(primaRiga(td), 'Worker teardown timeout of 60000ms exceeded.', 'senza colori, prima riga');
    assert.deepEqual(classificaErroriGlobali([td, td], false), { rossi: [], avvisi: [primaRiga(td), primaRiga(td)] });
    assert.deepEqual(classificaErroriGlobali([td], true), { rossi: [primaRiga(td)], avvisi: [] });
    assert.deepEqual(classificaErroriGlobali([td, altro], false), { rossi: ['Error: Cannot find module x', primaRiga(td)], avvisi: [] });
    assert.deepEqual(classificaErroriGlobali([altro], false), { rossi: ['Error: Cannot find module x'], avvisi: [] });
    assert.deepEqual(classificaErroriGlobali(undefined, false), { rossi: [], avvisi: [] });
  });

  test('gli argomenti: file, --out, --rossi; un\'opzione ignota è un errore', () => {
    assert.deepEqual(leggiArgomenti(['r.json', '--out', 'n.txt', '--rossi', 'k.json', '--chiavi', 'c.txt']),
      { file: 'r.json', out: 'n.txt', rossi: 'k.json', chiavi: 'c.txt', parti: 0, esiti: '' });
    assert.deepEqual(leggiArgomenti(['r.json', '--parti', '4', '--esiti', 'blob-report']),
      { file: 'r.json', out: '', rossi: '', chiavi: '', parti: 4, esiti: 'blob-report' });
    for (const n of ['0', '-1', '2.5', 'tre', undefined]) {
      assert.throws(() => leggiArgomenti(['r.json', '--parti', n, '--esiti', 'b'].filter((x) => x !== undefined)), /--parti/, String(n));
    }
    assert.throws(() => leggiArgomenti(['r.json', '--parti', '4']), /vanno insieme/, 'senza la cartella le parti non si possono contare');
    assert.throws(() => leggiArgomenti(['r.json', '--esiti', 'b']), /vanno insieme/);
    assert.equal(leggiArgomenti(['r.json']).chiavi, '');
    assert.throws(() => leggiArgomenti(['r.json', '--chiavi']), /vuole un percorso/);
    assert.throws(() => leggiArgomenti(['r.json', '--boh']), /non capita/);
    assert.throws(() => leggiArgomenti(['r.json', '--out']), /vuole un percorso/);
  });

  // Una chiave per spec, non per caso: dieci casi rotti dalla stessa modifica
  // sono un guasto, e il server non deve aprire dieci feedback.
  test('le chiavi dell\'allarme: una per spec con rossi nuovi, e una per gli errori fuori dai casi', () => {
    const v = verdetto(jsonSintetico(), NOTI.contenitore.specs);
    assert.deepEqual(chiaviDelVerdetto(v), ['suite:tests/delta.spec.mjs'], 'i rossi noti coperti non sono chiavi');
    const due = { nuovi: [
      { spec: 'delta', titolo: 'a' }, { spec: 'delta', titolo: 'b' }, { spec: 'tests\\wallet-credits.spec.mjs', titolo: 'c' },
      { spec: FUORI_DAI_CASI, titolo: 'Error: Cannot find module' }, { spec: FUORI_DAI_CASI, titolo: 'altro' },
    ] };
    assert.deepEqual(chiaviDelVerdetto(due), ['suite:tests/delta.spec.mjs', 'suite:tests/wallet-credits.spec.mjs', 'suite:fuori-dai-casi']);
    assert.deepEqual(chiaviDelVerdetto(verdetto(jsonSintetico({ conNuovo: false }), NOTI.contenitore.specs)), []);
    assert.deepEqual(chiaviDelVerdetto(undefined), []);
  });
});

// #1485: la suite in fila ha passato il tetto del passo e il JSON non c'era; ora gira in parti, e ognuna lascia il suo
// esito. Una parte che non lo lascia, o il tetto di Playwright scaduto, non deve mai sembrare un verde.
describe('le parti della suite e il tetto di tempo', () => {
  test('il tetto della corsa si riconosce nei testi di Playwright, vecchi e nuovi; un caso scaduto no', () => {
    assert.ok(eTettoDellaCorsa('Timed out waiting 8400s for the test suite to run'));
    assert.ok(eTettoDellaCorsa('Timed out waiting 2.5s for the teardown for test suite to run'));
    assert.ok(eTettoDellaCorsa('Timed out waiting 3600s for the entire test run'));
    assert.ok(eTettoDellaCorsa(primaRiga({ message: '\u001b[31mTimed out waiting 8400s for the test suite to run\u001b[39m' })), 'coi colori, come nel JSON');
    assert.ok(!eTettoDellaCorsa('Test timeout of 60000ms exceeded.'), 'un caso scaduto è un rosso suo, non il tetto della suite');
    assert.ok(!eTettoDellaCorsa('Worker teardown timeout of 60000ms exceeded.'));
    assert.ok(!eTettoDellaCorsa(''));
  });

  test('il tetto scaduto è UN rosso `suite:tetto` col numero dei casi mai girati, anche con soli rossi noti', () => {
    const j = jsonSintetico({ conNuovo: false });
    j.suites.push({ title: 'eps.spec.mjs', file: 'eps.spec.mjs', specs: [{ title: 'mai girato', tests: [{ status: 'skipped', results: [] }] },
      { title: 'neanche questo', tests: [{ status: 'skipped', results: [] }] }] });
    j.errors = [{ message: '\u001b[31mTimed out waiting 8400s for the test suite to run\u001b[39m' },
      { message: 'Timed out waiting 8400s for the teardown for test suite to run' }];
    const v = verdetto(j, NOTI.contenitore.specs);
    assert.equal(v.nuovi.length, 1, 'i due testi dello stesso tetto sono un rosso solo');
    assert.match(rigaRosso(v.nuovi[0]), /^la suite ha passato il suo tetto di tempo \(Timed out waiting 8400s for the test suite to run\): 2 casi non sono girati/);
    assert.deepEqual(chiaviDelVerdetto(v), ['suite:tetto']);
    const conTeardown = verdetto({ ...j, errors: [...j.errors, { message: 'Worker teardown timeout of 60000ms exceeded.' }] }, NOTI.contenitore.specs);
    assert.equal(conTeardown.avvisi.length, 0, 'con la suite fermata a metà un teardown scaduto non è più un avviso: la corsa è rossa');
  });

  test('una parte è senza esito se il suo file non c\'è; ognuna diventa un rosso `suite:non-partita`', () => {
    assert.equal(nomeEsitoParte(3), 'parte-3.zip');
    assert.deepEqual(partiSenzaEsito(4, ['parte-1.zip', 'parte-3.zip', 'report-2.zip', 'parte-4.zip.tmp']), [2, 4]);
    assert.deepEqual(partiSenzaEsito(2, ['parte-1.zip', 'parte-2.zip']), []);
    assert.deepEqual(partiSenzaEsito(3, undefined), [1, 2, 3]);
    assert.deepEqual(partiSenzaEsito(0, []), []);
    const rossi = rossiDellePartiMancanti([2, 4], 4);
    assert.deepEqual(rossi.map(rigaRosso).map((r) => r.split(':')[0]), ['parte 2 di 4 della suite senza esito', 'parte 4 di 4 della suite senza esito']);
    assert.deepEqual(chiaviDelVerdetto({ nuovi: [...rossi, { spec: 'delta', titolo: 'x' }] }), ['suite:non-partita', 'suite:tests/delta.spec.mjs']);
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
    assert.match(r.stdout, /Rossi NUOVI: 1/);
    assert.match(readFileSync(out, 'utf8'), /errore fuori dai casi: Error: Cannot find module/);
  });

  // Il teardown scaduto come lo scrive Playwright: coi colori del terminale e
  // l'elenco degli ultimi test del worker sotto (corsa 35101566321, tre volte).
  const TEARDOWN = { message: '[31mWorker teardown timeout of 60000ms exceeded.[39m\n\n[31mFailed worker ran 171 tests, last 10 tests were:[39m\ntests/beta.spec.mjs:1:1 › caso rosso noto' };

  test('teardown scaduti con soli rossi noti → uscita 0, e restano nel riassunto come avvisi col numero e il testo', () => {
    const jsonFile = join(dir, 'teardown-noti.json');
    const out = join(dir, 'nuovi-4.txt');
    const j = jsonSintetico({ conNuovo: false });
    j.errors = [TEARDOWN, TEARDOWN, TEARDOWN];
    writeFileSync(jsonFile, JSON.stringify(j), 'utf8');
    const r = lancia(jsonFile, out);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Rossi NUOVI: 0/);
    assert.match(r.stdout, /AVVISI[^\n]*: 3/);
    assert.equal((r.stdout.match(/! Worker teardown timeout of 60000ms exceeded\./g) || []).length, 3, 'ogni avviso sta nel riassunto, senza colori');
    assert.equal(readFileSync(out, 'utf8'), '', 'un avviso non è un rosso nuovo');
  });

  test('teardown scaduto insieme a un rosso nuovo → uscita 1, e il teardown conta fra i rossi', () => {
    const jsonFile = join(dir, 'teardown-nuovo.json');
    const out = join(dir, 'nuovi-5.txt');
    const j = jsonSintetico();
    j.errors = [TEARDOWN];
    writeFileSync(jsonFile, JSON.stringify(j), 'utf8');
    const r = lancia(jsonFile, out);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /Rossi NUOVI: 2/);
    assert.match(r.stdout, /AVVISI[^\n]*: 0/);
    const nuovi = readFileSync(out, 'utf8');
    assert.match(nuovi, /tests\/delta\.spec\.mjs › questo è nuovo/);
    assert.match(nuovi, /errore fuori dai casi: Worker teardown timeout of 60000ms exceeded\./);
  });

  test('teardown scaduto insieme a un altro errore fuori dai casi → uscita 1, tutti e due rossi', () => {
    const jsonFile = join(dir, 'teardown-altro.json');
    const out = join(dir, 'nuovi-6.txt');
    const j = jsonSintetico({ conNuovo: false });
    j.errors = [TEARDOWN, { message: 'Error: Cannot find module ../helpers/sparito.mjs' }];
    writeFileSync(jsonFile, JSON.stringify(j), 'utf8');
    const r = lancia(jsonFile, out);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /Rossi NUOVI: 2/);
  });

  const conChiavi = (jsonFile, chiavi) => spawnSync(process.execPath,
    [CLI, jsonFile, '--out', join(dir, 'n-chiavi.txt'), '--rossi', fileNoti, '--chiavi', chiavi], { encoding: 'utf8' });

  test('--chiavi: un rosso nuovo scrive la chiave del suo spec, un verde un file vuoto', () => {
    const rosso = join(dir, 'chiavi-rosso.json');
    const errore = join(dir, 'chiavi-errore.json');
    const verde = join(dir, 'chiavi-verde.json');
    writeFileSync(rosso, JSON.stringify(jsonSintetico()), 'utf8');
    const j = jsonSintetico();
    j.errors = [{ message: 'Error: Cannot find module x' }];
    writeFileSync(errore, JSON.stringify(j), 'utf8');
    writeFileSync(verde, JSON.stringify(jsonSintetico({ conNuovo: false })), 'utf8');
    assert.equal(conChiavi(rosso, join(dir, 'k1.txt')).status, 1);
    assert.equal(readFileSync(join(dir, 'k1.txt'), 'utf8'), 'suite:tests/delta.spec.mjs\n');
    assert.equal(conChiavi(errore, join(dir, 'k2.txt')).status, 1);
    assert.equal(readFileSync(join(dir, 'k2.txt'), 'utf8'), 'suite:tests/delta.spec.mjs\nsuite:fuori-dai-casi\n');
    assert.equal(conChiavi(verde, join(dir, 'k3.txt')).status, 0);
    assert.equal(readFileSync(join(dir, 'k3.txt'), 'utf8'), '');
  });

  test('--chiavi: una suite che non è partita scrive `suite:non-partita`', () => {
    assert.equal(conChiavi(join(dir, 'non-esiste.json'), join(dir, 'k4.txt')).status, 2);
    assert.equal(readFileSync(join(dir, 'k4.txt'), 'utf8'), 'suite:non-partita\n');
    const vuoto = join(dir, 'chiavi-vuoto.json');
    writeFileSync(vuoto, JSON.stringify({ suites: [], errors: [] }), 'utf8');
    assert.equal(conChiavi(vuoto, join(dir, 'k5.txt')).status, 2);
    assert.equal(readFileSync(join(dir, 'k5.txt'), 'utf8'), 'suite:non-partita\n');
  });

  const conParti = (jsonFile, esiti, n, suffisso) => spawnSync(process.execPath, [CLI, jsonFile, '--out', join(dir, `n-${suffisso}.txt`),
    '--rossi', fileNoti, '--chiavi', join(dir, `k-${suffisso}.txt`), '--parti', String(n), '--esiti', esiti], { encoding: 'utf8' });
  const esiti = (nome, parti) => {
    const d = join(dir, nome);
    mkdirSync(d, { recursive: true });
    for (const k of parti) writeFileSync(join(d, nomeEsitoParte(k)), 'zip', 'utf8');
    return d;
  };

  test('--parti: una parte senza esito → uscita 2, e i rossi delle altre si elencano lo stesso', () => {
    const jsonFile = join(dir, 'parti-una-manca.json');
    writeFileSync(jsonFile, JSON.stringify(jsonSintetico()), 'utf8');
    const r = conParti(jsonFile, esiti('esiti-1-3', [1, 3]), 3, 'p1');
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /Rossi NUOVI: 2/);
    const nuovi = readFileSync(join(dir, 'n-p1.txt'), 'utf8');
    assert.match(nuovi, /^parte 2 di 3 della suite senza esito/m);
    assert.match(nuovi, /tests\/delta\.spec\.mjs › questo è nuovo/, 'i rossi delle parti arrivate servono al feedback');
    assert.equal(readFileSync(join(dir, 'k-p1.txt'), 'utf8'), 'suite:non-partita\nsuite:tests/delta.spec.mjs\n');
  });

  test('--parti: anche senza rossi nuovi, una parte mancante non è un verde', () => {
    const jsonFile = join(dir, 'parti-verde.json');
    writeFileSync(jsonFile, JSON.stringify(jsonSintetico({ conNuovo: false })), 'utf8');
    assert.equal(conParti(jsonFile, esiti('esiti-1', [1]), 2, 'p2').status, 2);
    assert.equal(readFileSync(join(dir, 'k-p2.txt'), 'utf8'), 'suite:non-partita\n');
    assert.equal(conParti(jsonFile, esiti('esiti-1-2', [1, 2]), 2, 'p3').status, 0, 'con tutte le parti è il verdetto di sempre');
    assert.equal(readFileSync(join(dir, 'n-p3.txt'), 'utf8'), '');
  });

  test('--parti: nessuna parte e nessun JSON → uscita 2, e il file dei nuovi elenca le parti', () => {
    const r = conParti(join(dir, 'non-esiste.json'), join(dir, 'cartella-che-non-c-e'), 2, 'p4');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Nessuna delle 2 parti/);
    assert.equal(readFileSync(join(dir, 'n-p4.txt'), 'utf8').split('\n').filter(Boolean).length, 2);
    assert.equal(readFileSync(join(dir, 'k-p4.txt'), 'utf8'), 'suite:non-partita\n');
  });

  test.after(() => { try { togliCartella(dir); } catch (_) { /* best effort */ } });
});

// La strada di suite.yml fatta girare con Playwright vero: parti con --shard, l'esito di ognuna col nome che il
// verdetto cerca, una parte fermata dal suo tetto, l'unione in un JSON solo. Se un aggiornamento di Playwright
// cambiasse uno di questi pezzi, la suite in GitHub direbbe «senza esito» a ogni corsa.
describe('le parti con Playwright vero, come in suite.yml', () => {
  const ROOT = resolve(__dirname, '..', '..');
  const CLI_PW = resolve(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
  // Dentro tests/.smoke (ignorata da git): gli spec di prova trovano @playwright/test risalendo ai node_modules.
  const dir = resolve(ROOT, 'tests', '.smoke', 'suite-verdict-parti');
  const pulito = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PLAYWRIGHT_|PW_|TEST_WORKER_INDEX|TEST_PARALLEL_INDEX)/.test(k)));
  const pw = (args, env = {}) => spawnSync(process.execPath, [CLI_PW, ...args], { cwd: dir, encoding: 'utf8', env: { ...pulito(), ...env }, timeout: TETTO_ATTESA_MS });

  test('una parte fermata dal tetto lascia l\'esito, e il verdetto unito dice il tetto e il rosso dell\'altra', { skip: !existsSync(CLI_PW) && 'manca @playwright/test' }, () => {
    togliCartella(dir);
    mkdirSync(join(dir, 'prove'), { recursive: true });
    writeFileSync(join(dir, 'playwright.config.mjs'), "export default { testDir: './prove', workers: 1, fullyParallel: false, retries: 0 };\n", 'utf8');
    writeFileSync(join(dir, 'prove', 'a.spec.mjs'), "import { test } from '@playwright/test';\ntest('lento', async () => { await new Promise(() => {}); });\ntest('dopo il lento', () => {});\n", 'utf8');
    writeFileSync(join(dir, 'prove', 'b.spec.mjs'), "import { test, expect } from '@playwright/test';\ntest('rosso', () => { expect(1).toBe(2); });\ntest('verde', () => {});\n", 'utf8');
    const tutti = join(dir, 'blob-tutti');
    mkdirSync(tutti, { recursive: true });
    for (const [k, extra] of [[1, ['--global-timeout=1500']], [2, []]]) {
      // Senza la cartella l'esito andrebbe accanto al package.json del repo, come in GitHub: qui resta nella prova.
      const r = pw(['test', '--config', 'playwright.config.mjs', `--shard=${k}/2`, ...extra, '--reporter=blob'],
        { PLAYWRIGHT_BLOB_OUTPUT_NAME: nomeEsitoParte(k), PLAYWRIGHT_BLOB_OUTPUT_DIR: join(dir, 'blob-report') });
      const fatti = existsSync(join(dir, 'blob-report')) ? readdirSync(join(dir, 'blob-report')) : [];
      assert.ok(fatti.includes(nomeEsitoParte(k)), `parte ${k}: nessun ${nomeEsitoParte(k)} (${fatti.join(', ')})\n${r.stdout}${r.stderr}`);
      copyFileSync(join(dir, 'blob-report', nomeEsitoParte(k)), join(tutti, nomeEsitoParte(k)));
    }
    const unito = pw(['merge-reports', '--reporter=json', tutti], { PLAYWRIGHT_JSON_OUTPUT_NAME: 'suite-risultati.json' });
    assert.ok(existsSync(join(dir, 'suite-risultati.json')), `l'unione non ha scritto il JSON\n${unito.stdout}${unito.stderr}`);
    writeFileSync(join(dir, 'noti.json'), JSON.stringify({ contenitore: { specs: [] } }), 'utf8');
    const v = spawnSync(process.execPath, [CLI, join(dir, 'suite-risultati.json'), '--rossi', join(dir, 'noti.json'),
      '--out', join(dir, 'nuovi.txt'), '--chiavi', join(dir, 'chiavi.txt'), '--parti', '2', '--esiti', tutti], { encoding: 'utf8' });
    assert.equal(v.status, 1, v.stdout + v.stderr);
    const nuovi = readFileSync(join(dir, 'nuovi.txt'), 'utf8');
    assert.match(nuovi, /^tests\/b\.spec\.mjs › rosso$/m, 'il rosso della parte arrivata in fondo');
    assert.match(nuovi, /^la suite ha passato il suo tetto di tempo .*: [12] casi non sono girati/m, 'a macchina carica il tetto può scadere prima del caso lento');
    assert.deepEqual(readFileSync(join(dir, 'chiavi.txt'), 'utf8').split('\n').filter(Boolean).sort(), ['suite:tests/b.spec.mjs', 'suite:tetto']);
  });

  test.after(() => { try { togliCartella(dir); } catch (_) { /* best effort */ } });
});

// I rossi noti VERI devono citare titoli che esistono, altrimenti il primo
// giro in GitHub li segnalerebbe come nuovi e nessuna versione uscirebbe.
test('ogni caso dei rossi noti del contenitore è il titolo di un test che esiste in quello spec', () => {
  const ROOT = resolve(__dirname, '..', '..');
  const j = JSON.parse(readFileSync(resolve(ROOT, 'tests', 'rossi-noti.json'), 'utf8'));
  for (const voce of j.contenitore.specs) {
    // Il titolo va confrontato come lo vede Playwright: nel sorgente un
    // apostrofo dentro una stringa a virgolette singole è scritto `\'`.
    const src = readFileSync(resolve(ROOT, `${voce.spec}.spec.mjs`), 'utf8').replace(/\s+/g, ' ').replace(/\\'/g, "'");
    for (const titolo of casiDellaVoce(voce)) {
      assert.ok(src.includes(titolo),
        `${voce.spec}: il caso «${titolo}» non è il titolo di un test di quello spec: la voce non coprirebbe niente`);
    }
  }
});
