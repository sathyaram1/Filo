// Un errore della suite fuori dai casi che nomina un file ha la chiave di quel file: una prova che non si carica
// ferma tutta la suite, e con la chiave generica un feedback già aperto per un altro motivo la inghiottirebbe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import {
  fileDellErrore, chiaviSenzaCasi, chiaviDelVerdetto, verdetto, CHIAVE_NON_PARTITA, ultimoTestDelWorker,
} from '../../scripts/suite-verdict.mjs';

const VERDETTO = fileURLToPath(new URL('../../scripts/suite-verdict.mjs', import.meta.url));
const RADICE = '/home/runner/work/Filo/Filo';

// Le forme che Playwright 1.60 scrive nel JSON quando un file non si carica.
const IMPORT_MANCANTE = {
  message: `Error: Cannot find module '${RADICE}/tests/helpers/spostato.mjs' imported from ${RADICE}/tests/rotto.spec.mjs`,
};
const AIUTO_ROTTO = {
  message: `SyntaxError: ${RADICE}/tests/helpers/aiuto.mjs: Unexpected token (1:18)`,
  location: { file: `${RADICE}/tests/usa-aiuto.spec.mjs`, line: 1, column: 18 },
};
const WINDOWS_CON_SPAZIO = {
  message: "Error: Cannot find module 'C:\\Users\\agenti AI\\r\\tests\\non-esiste.mjs' imported from C:\\Users\\agenti AI\\r\\tests\\rotto.spec.mjs",
};

test('il file è chi non si carica: l\'importatore, o lo spec della posizione anche se l\'errore sta in un aiuto', () => {
  assert.equal(fileDellErrore(IMPORT_MANCANTE, RADICE), 'tests/rotto.spec.mjs');
  assert.equal(fileDellErrore(AIUTO_ROTTO, RADICE), 'tests/usa-aiuto.spec.mjs');
  assert.equal(fileDellErrore(WINDOWS_CON_SPAZIO, 'D:/a/Filo/Filo'), 'tests/rotto.spec.mjs');
  assert.equal(fileDellErrore({ message: 'Worker teardown timeout of 60000ms exceeded.' }, RADICE), '');
});

test('una suite senza casi ha le chiavi dei file che non si caricano, e la suite non partita solo senza file', () => {
  assert.deepEqual(chiaviSenzaCasi([IMPORT_MANCANTE, AIUTO_ROTTO], RADICE),
    ['suite:tests/rotto.spec.mjs', 'suite:tests/usa-aiuto.spec.mjs']);
  assert.deepEqual(chiaviSenzaCasi([{ message: 'Error: qualcosa senza file' }], RADICE), [CHIAVE_NON_PARTITA]);
  assert.deepEqual(chiaviSenzaCasi([], RADICE), [CHIAVE_NON_PARTITA]);
});

test('con dei casi, un errore che nomina un file prende la sua chiave; il teardown resta fuori dai casi', () => {
  const json = {
    suites: [{ title: 'a.spec.mjs', file: 'a.spec.mjs', specs: [{ title: 'x', file: 'a.spec.mjs', tests: [{ status: 'unexpected' }] }] }],
    errors: [
      { message: 'Error: boom', location: { file: `${RADICE}/tests/fixtures/electron.mjs`, line: 3, column: 1 } },
      { message: 'Worker teardown timeout of 60000ms exceeded.' },
    ],
  };
  assert.deepEqual(chiaviDelVerdetto(verdetto(json, [])),
    ['suite:tests/a.spec.mjs', 'suite:tests/fixtures/electron.mjs', 'suite:fuori-dai-casi']);
});

// Il teardown scaduto come lo scrive Playwright 1.60: sotto, gli ultimi test del worker dal più vecchio (main, 28/09).
const teardown = (quanti, righe) => {
  const m = `\u001b[31mWorker teardown timeout of 60000ms exceeded.\u001b[39m\n\n\u001b[31mFailed worker ran ${quanti}:\u001b[39m\n${righe.join('\n')}`;
  return { message: m, stack: m };
};
const CENSUS = 'tests/model-usage-census.spec.mjs:111:1 › il pulsante «Prova» usa il modello configurato';
const NAV = 'tests/nav-indietro-avanti.spec.mjs:61:1 › Alt+← torna alla pagina precedente';
const CRASH = 'tests/net-error-page.spec.mjs:95:1 › renderer crashato: pagina d\'errore "scheda bloccata" invece del bianco';
const spec = (file, casi) => ({ title: file, file, specs: casi.map(([title, line, status]) => ({ title, file, line, tests: [{ status }] })) });
const CORSA_DI_MAIN = {
  suites: [
    spec('model-usage-census.spec.mjs', [['il pulsante «Prova» usa il modello configurato', 111, 'expected']]),
    spec('nav-indietro-avanti.spec.mjs', [['Alt+← torna alla pagina precedente', 61, 'expected']]),
    spec('net-error-page.spec.mjs', [['renderer crashato: pagina d\'errore "scheda bloccata" invece del bianco', 95, 'unexpected']]),
    spec('wallet-credits.spec.mjs', [['riscattato l’invito, la home smette di mandare a riscattarlo', 40, 'unexpected']]),
  ],
  errors: [teardown('1014 tests, last 10 tests were', [CENSUS, NAV, CRASH]), teardown('1 test', [CRASH]), teardown('1 test', [CRASH])],
};
const NOTI = [{ spec: 'tests/net-error-page', caso: 'renderer crashato: pagina d\'errore "scheda bloccata" invece del bianco' }];

test('il teardown dietro a un rosso noto è il suo strascico: l\'allarme nomina solo il rosso nuovo, non un file verde', () => {
  const v = verdetto(CORSA_DI_MAIN, NOTI);
  assert.deepEqual(chiaviDelVerdetto(v), ['suite:tests/wallet-credits.spec.mjs']);
  assert.equal(v.nuovi.filter((c) => c.strascicoDi === 'tests/net-error-page.spec.mjs:95').length, 3,
    'restano fra i rossi della corsa, ognuno col caso di cui è lo strascico');
});

test('il file di un teardown è quello dell\'ultimo test del suo worker, mai il primo dell\'elenco', () => {
  const allaFine = teardown('1014 tests, last 10 tests were', [CENSUS, NAV]);
  assert.deepEqual(ultimoTestDelWorker(allaFine), { spec: 'nav-indietro-avanti', riga: 61 });
  assert.equal(fileDellErrore(allaFine, RADICE), 'tests/nav-indietro-avanti.spec.mjs');
  assert.deepEqual(ultimoTestDelWorker({ message: 'Failed worker ran 2 tests:\n[electron] › tests\\a.spec.mjs:3:1 › x\n[electron] › tests\\b.spec.mjs:9:2 › y' }),
    { spec: 'b', riga: 9 }, 'col progetto davanti e le barre di Windows');
  const json = { ...CORSA_DI_MAIN, errors: [allaFine] };
  assert.deepEqual(chiaviDelVerdetto(verdetto(json, NOTI)),
    ['suite:tests/wallet-credits.spec.mjs', 'suite:tests/nav-indietro-avanti.spec.mjs'],
    'dopo un caso verde il worker che non chiude è un guasto di quello spec');
});

test('dietro a un rosso nuovo il teardown non aggiunge chiavi; se restano solo strascichi la chiave è quella generica', () => {
  const json = { ...CORSA_DI_MAIN, errors: [teardown('1 test', ['tests/wallet-credits.spec.mjs:40:1 › riscattato'])] };
  assert.deepEqual(chiaviDelVerdetto(verdetto(json, NOTI)), ['suite:tests/wallet-credits.spec.mjs']);
  assert.deepEqual(chiaviDelVerdetto({ nuovi: [{ spec: '(fuori dai casi)', titolo: 'x', strascicoDi: 'tests/a.spec.mjs:1' }] }),
    ['suite:fuori-dai-casi']);
});

test('dalla riga di comando: una prova che non si carica scrive la sua chiave, non quella della suite non partita', () => {
  const dir = cartellaTemporanea('suite-chiavi-errori');
  try {
    writeFileSync(join(dir, 'suite.json'), JSON.stringify({ suites: [], errors: [IMPORT_MANCANTE] }));
    let codice = 0;
    try {
      execFileSync(process.execPath, [VERDETTO, join(dir, 'suite.json'), '--chiavi', join(dir, 'chiavi.txt')], { stdio: 'pipe' });
    } catch (e) { codice = e.status; }
    assert.equal(codice, 2, 'una suite che non ha eseguito niente resta un non verde');
    assert.deepEqual(readFileSync(join(dir, 'chiavi.txt'), 'utf8').split(/\r?\n/).filter(Boolean), ['suite:tests/rotto.spec.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
