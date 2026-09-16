// La suite completa gira in GitHub prima di pubblicare (release.yml, job `suite`).
//
// PERCHÉ QUESTA SENTINELLA
//   Dal 2026-09-15 nessun agente lancia più la suite Playwright completa: i
//   testi del repo (CLAUDE.md, README, i ruoli) dicono che gira nel lavoro di
//   release, ogni sei ore, e che un rosso nuovo ferma la versione. Se il job
//   sparisce o perde un pezzo — il verdetto, lo schermo virtuale, la dipendenza
//   del job Windows — i testi restano e la promessa no: si pubblicherebbe
//   senza suite, e nessuno se ne accorgerebbe. Qui si legge il workflow com'è.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const YML = readFileSync(resolve(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

// I commenti raccontano: si guardano solo le righe di comando/configurazione.
const senzaCommenti = (s) => s.split(/\r?\n/).filter((r) => !/^\s*#/.test(r)).join('\n');

/** Il testo di un job (dalla sua riga `  nome:` alla successiva). */
function job(nome) {
  const inizio = YML.search(new RegExp(`^\\s{2}${nome}:\\s*$`, 'm'));
  assert.ok(inizio >= 0, `nel workflow manca il job \`${nome}\``);
  const resto = YML.slice(inizio + 1);
  const fine = resto.search(/^\s{2}[a-z][\w-]*:\s*$/m);
  return fine >= 0 ? YML.slice(inizio, inizio + 1 + fine) : YML.slice(inizio);
}

describe('il job `suite`', () => {
  const suite = senzaCommenti(job('suite'));

  test('esiste, su Linux, prima del lavoro Windows, con quattro ore di tetto', () => {
    assert.ok(YML.search(/^\s{2}suite:/m) < YML.search(/^\s{2}release:/m), 'la suite deve stare PRIMA del lavoro che pubblica');
    assert.match(suite, /runs-on:\s*ubuntu-latest/, 'la suite gira su Linux, come nel contenitore delle routine');
    assert.match(suite, /timeout-minutes:\s*240/, 'senza tetto un Electron appeso terrebbe il runner per sei ore');
  });

  test('lancia Playwright come nel contenitore senza schermo, con l\'esito in un JSON', () => {
    // Senza questi due Electron non parte proprio (tests/rossi-noti.json, nota).
    assert.match(suite, /xvfb-run -a/, 'manca lo schermo virtuale');
    assert.match(suite, /ELECTRON_DISABLE_SANDBOX=1/, 'manca il sandbox spento');
    assert.match(suite, /npx playwright test/, 'la suite non viene lanciata');
    assert.match(suite, /--reporter=[\w,]*json/, 'senza il reporter JSON il verdetto non ha niente da leggere');
    assert.match(suite, /PLAYWRIGHT_JSON_OUTPUT_NAME=suite-risultati\.json/, 'il JSON va in un file, non a schermo');
    assert.match(suite, /apt-get install -y xvfb/, 'xvfb va installato: sul runner non c\'è');
    assert.match(suite, /ensure-electron\.mjs/, 'il binario di Electron va assicurato');
  });

  test('il verdetto lo dà suite-verdict.mjs, e un rosso nuovo apre un feedback con la stessa credenziale del cancello unit', () => {
    assert.match(suite, /node scripts\/suite-verdict\.mjs suite-risultati\.json --out rossi-nuovi\.txt/);
    assert.match(suite, /steps\.verdetto\.outcome == 'failure'/, 'l\'allarme deve partire dal verdetto, non dall\'uscita di Playwright');
    assert.match(suite, /build-alarm\.mjs/, 'un rosso nuovo deve diventare un feedback, non un silenzio');
    const secretsUnit = new Set((senzaCommenti(job('release')).match(/secrets\.FILO_BUILD_PASSPHRASE/g) || []));
    const secretsSuite = new Set((suite.match(/secrets\.FILO_BUILD_PASSPHRASE/g) || []));
    assert.equal(secretsUnit.size, 1, 'il cancello unit usa FILO_BUILD_PASSPHRASE');
    assert.deepEqual([...secretsSuite], [...secretsUnit], 'l\'allarme della suite usa lo stesso secret del cancello unit');
    // Il tetto dell'elenco si dice, col numero di quelli rimasti fuori.
    assert.match(suite, /head -80/);
    assert.match(suite, /elenco tagliato/);
    assert.match(suite, /N_TUTTE - 80/);
    assert.match(suite, /exit 1/, 'a rosso nuovo il job deve uscire rosso');
  });

  test('esito e tracce restano allegati per sette giorni', () => {
    assert.match(suite, /actions\/upload-artifact@v4/);
    assert.match(suite, /retention-days:\s*7/);
    assert.match(suite, /suite-risultati\.json/);
    assert.match(suite, /test-results\//, 'senza screenshot e trace dei rossi, chi prende il feedback rilancia un\'ora di suite');
    assert.match(suite, /if:\s*always\(\)/, 'l\'artifact va caricato anche a suite rossa: è proprio allora che serve');
  });

  test('decide se c\'è qualcosa di nuovo con la STESSA logica del lavoro Windows', () => {
    const blocco = (testo) => {
      const da = testo.indexOf('git fetch --tags --force');
      assert.ok(da >= 0, 'manca il controllo "qualcosa di nuovo dal tag"');
      const dopo = testo.slice(da);
      const fine = dopo.search(/^\s{10}fi\s*$/m);
      assert.ok(fine >= 0);
      return dopo.slice(0, fine)
        .split(/\r?\n/)
        .map((r) => r.trim())
        .filter((r) => r && !(r.startsWith('echo ') && !r.includes('GITHUB_OUTPUT')))
        .map((r) => r.replace(/should_release=/g, 'run='));
    };
    assert.deepEqual(blocco(suite), blocco(senzaCommenti(job('release'))),
      'le due decisioni "c\'è qualcosa di nuovo dal tag?" devono restare identiche');
  });
});

describe('`solo_suite`: provare la suite su un ramo senza pubblicare', () => {
  test('è un input booleano dell\'avvio a mano, spento di default', () => {
    const on = senzaCommenti(YML.slice(0, YML.search(/^jobs:/m)));
    assert.match(on, /workflow_dispatch:/);
    assert.match(on, /solo_suite:/);
    const input = on.slice(on.indexOf('solo_suite:'));
    assert.match(input, /type:\s*boolean/);
    assert.match(input, /default:\s*false/);
  });

  test('con solo_suite la suite gira sempre, sul ramo scelto; senza, su main', () => {
    const suite = senzaCommenti(job('suite'));
    assert.match(suite, /ref:\s*\$\{\{\s*inputs\.solo_suite && github\.ref \|\| 'main'\s*\}\}/,
      'il checkout deve seguire il ramo scelto con solo_suite e main altrimenti');
    assert.match(suite, /if \[ "\$\{\{ inputs\.solo_suite \}\}" = "true" \]/, 'con solo_suite il controllo "qualcosa di nuovo" si salta');
  });

  test('il lavoro Windows aspetta la suite e con solo_suite non parte (e il Mac dipende ancora da Windows)', () => {
    const release = senzaCommenti(job('release'));
    assert.match(release, /needs:\s*suite/, 'senza `needs: suite` si pubblicherebbe senza aspettare la suite');
    assert.match(release, /if:\s*\$\{\{\s*success\(\) && !inputs\.solo_suite\s*\}\}/,
      'il lavoro Windows parte solo a suite verde e senza solo_suite (su cron `inputs` è vuoto: la condizione resta vera)');
    assert.match(senzaCommenti(job('release-mac')), /needs:\s*release/, 'il Mac resta appeso a Windows');
  });
});

// La suite prova main all'inizio e dura un'ora e un quarto; il lavoro Windows
// riprendeva main COM'È dopo, e quello che era entrato nel frattempo usciva
// senza essere mai passato dalla suite (giro del 14/09, verifica).
describe('si pubblica SOLO il commit che la suite ha provato', () => {
  test('la suite dice quale commit ha provato, prima ancora di decidere se girare', () => {
    const suite = senzaCommenti(job('suite'));
    assert.match(suite, /outputs:\s*\n\s*sha:\s*\$\{\{\s*steps\.provato\.outputs\.sha\s*\}\}/, 'la suite deve esporre il commit provato');
    assert.match(suite, /id:\s*provato[\s\S]*?git rev-parse HEAD/, 'il commit provato si legge dal checkout');
    assert.ok(suite.indexOf('id: provato') < suite.indexOf('git fetch --tags --force'),
      'si legge PRIMA del controllo "c\'è qualcosa di nuovo": deve esserci anche quando la suite non gira');
  });

  test('il lavoro Windows lo confronta due volte: prima del numero di versione e dopo l\'allineamento', () => {
    const release = senzaCommenti(job('release'));
    const primaDelBump = release.slice(0, release.indexOf('release-bump.mjs'));
    assert.match(primaDelBump, /needs\.suite\.outputs\.sha/, 'prima di chiedere il numero: se main si è mosso non si pubblica');
    assert.match(primaDelBump, /should_release=false/, 'main mosso → should_release=false, senza feedback: la prossima corsa riprova');
    const dopoIlPull = release.slice(release.indexOf('git pull --rebase origin main'));
    assert.match(dopoIlPull, /needs\.suite\.outputs\.sha/, 'dopo il pull: sotto il commit di release deve esserci il commit provato');
    assert.match(dopoIlPull, /HEAD~1/);
    assert.match(dopoIlPull, /exit 1/, 'codice mai provato non si costruisce');
  });
});

// Nel contenitore delle routine (Linux, senza schermo, da root) un comando
// con xvfb-run ma senza la sandbox spenta non fa partire Electron: un testo
// che lo scrive a metà è la trappola che ogni giro riscopriva (giro del
// 14/09, verifica: il ruolo di chi sonda lo scriveva a metà).
describe('il comando del contenitore è scritto intero, dovunque compaia', () => {
  test('ogni riga con `xvfb-run -a` in CLAUDE.md, nei ruoli e nei rossi noti porta anche ELECTRON_DISABLE_SANDBOX=1', () => {
    const files = ['CLAUDE.md', 'tests/rossi-noti.json',
      ...readdirSync(resolve(ROOT, 'routines', 'roles')).filter((n) => n.endsWith('.md')).map((n) => `routines/roles/${n}`)];
    let trovate = 0;
    for (const f of files) {
      for (const riga of readFileSync(resolve(ROOT, f), 'utf8').split(/\r?\n/)) {
        if (!/xvfb-run -a/.test(riga)) continue;
        trovate += 1;
        assert.match(riga, /ELECTRON_DISABLE_SANDBOX=1/, `${f}: «${riga.trim().slice(0, 120)}» — metà comando`);
      }
    }
    assert.ok(trovate >= 3, 'il comando del contenitore deve stare scritto in CLAUDE.md, nei ruoli e nei rossi noti');
  });
});
