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
const { PASSI } = await import('../../scripts/release-platform-alarm.mjs');

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

  // Giro 6 della verifica (16/09/2026): se main riceve qualcosa durante OGNI
  // corsa, nessuna versione esce e nessuno lo sa. Non si risolve (scelta
  // dell'owner), ma il caso si vede: nel riassunto del lavoro, con i due sha.
  test('quando main si e\' mosso, il riassunto del lavoro lo dice, con lo sha provato e quello attuale', () => {
    const release = senzaCommenti(job('release'));
    const primaDelBump = release.slice(0, release.indexOf('release-bump.mjs'));
    const blocco1 = primaDelBump.slice(primaDelBump.indexOf('if [ "$QUI" != "$PROVATO" ]'));
    assert.match(blocco1, /GITHUB_STEP_SUMMARY/, 'il primo fermo scrive nel riassunto del lavoro');
    assert.match(blocco1, /\$\{PROVATO[^}]*\}[\s\S]*\$QUI/, 'con lo sha provato e quello attuale di main');
    assert.match(blocco1, /main si e' mosso/);
    const dopoIlPull = release.slice(release.indexOf('git pull --rebase origin main'));
    const blocco2 = dopoIlPull.slice(dopoIlPull.indexOf('if [ "$SOTTO" != "$PROVATO" ]'));
    assert.match(blocco2, /GITHUB_STEP_SUMMARY/, 'anche il secondo fermo scrive nel riassunto');
    assert.match(blocco2, /\$\{PROVATO[^}]*\}[\s\S]*\$SOTTO/, 'con lo sha provato e quello sotto la release');
    assert.ok(blocco2.indexOf('GITHUB_STEP_SUMMARY') < blocco2.indexOf('exit 1'), 'il riassunto si scrive PRIMA di uscire');
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

// ─── Giro 2 della verifica (16/09/2026): un Electron appeso non lascia il giro muto ──
// Col solo tetto del job, un passo appeso faceva annullare il job PRIMA del
// verdetto: niente feedback, patch non pubblicata, e lo si scopriva solo
// guardando le Actions.
test('il passo della suite ha un tetto suo, sotto quello del job: scaduto, il verdetto e l\'allarme girano lo stesso', () => {
  const suite = senzaCommenti(job('suite'));
  const passo = suite.slice(suite.indexOf('name: Suite Playwright completa'));
  const m = passo.match(/timeout-minutes:\s*(\d+)/);
  assert.ok(m, 'il passo che lancia Playwright deve avere un timeout-minutes suo');
  assert.ok(Number(m[1]) < 240, 'il tetto del passo deve stare sotto quello del job, o è il job a morire prima del verdetto');
  assert.match(suite, /tetto del passo/, 'l\'allarme deve dire che la suite può essere stata interrotta dal tetto');
});

// ─── #733: una meta' di piattaforma che fallisce non tace ────────────────────
// `release-mac` e `release-linux` sono `continue-on-error` perche' un guasto su
// Linux non deve togliere l'aggiornamento a chi sta su Windows. Il prezzo era il
// silenzio: la release usciva con due file su tre, il lavoro diventava rosso in
// una pagina che nessuno apre, e per sei giorni nessuno ha saputo che Filo per
// Linux non c'era. Qui si legge che l'allarme c'e' ancora, in tutti e due.
describe('una meta\' di piattaforma che fallisce apre un feedback', () => {
  /** I passi di un job: nome, corpo e id (senza id l'allarme non sa nominarlo). */
  const passi = (testoJob) => testoJob.split(/^ {6}- name: /m).slice(1).map((corpo) => ({
    nome: corpo.split('\n')[0].trim(),
    corpo,
    id: (corpo.match(/^ {8}id: (\S+)$/m) || [])[1] || '',
  }));

  for (const [nomeJob, piattaforma] of [['release-mac', 'Mac'], ['release-linux', 'Linux']]) {
    describe(nomeJob, () => {
      const testo = senzaCommenti(job(nomeJob));
      const elenco = passi(testo);
      const iAllarme = elenco.findIndex((p) => /release-platform-alarm\.mjs/.test(p.corpo) && !/--attesi/.test(p.corpo));

      test('un guasto qui non toglie la release Windows', () => {
        assert.match(testo, /continue-on-error:\s*true/, 'un problema su una piattaforma non deve fermare le altre');
      });

      test('a guasto apre un feedback, con la stessa credenziale del cancello unit', () => {
        assert.ok(iAllarme > 0, 'manca il passo che a guasto apre il feedback: il rosso resterebbe muto');
        const allarme = elenco[iAllarme];
        assert.match(allarme.corpo, /if:\s*failure\(\)/, 'l\'allarme deve partire da QUALSIASI passo rosso, non solo dall\'ultimo');
        assert.match(allarme.corpo, /secrets\.FILO_BUILD_PASSPHRASE/, 'stessa credenziale del cancello unit e della suite rossa');
        assert.match(allarme.corpo, new RegExp(`PIATTAFORMA: ${piattaforma}`), 'il feedback deve nominare la piattaforma');
        assert.match(allarme.corpo, /VERSIONE: \$\{\{ needs\.release\.outputs\.version \}\}/, 'e la versione');
        assert.match(allarme.corpo, /github\.run_id/, 'e portare il link all\'esecuzione');
        assert.match(allarme.corpo, /ESITI: \$\{\{ toJSON\(steps\) \}\}/, 'senza gli esiti dei passi non si sa quale si e\' fermato');
        assert.ok(iAllarme === elenco.length - 2, 'l\'allarme sta in fondo, prima del solo riepilogo: piu\' su non vedrebbe i passi dopo di lui');
      });

      test('ogni passo prima dell\'allarme ha un id, e lo script sa dire cosa stava facendo', () => {
        for (const p of elenco.slice(0, iAllarme)) {
          assert.ok(p.id, `il passo «${p.nome}» non ha un id: l'allarme non potrebbe nominarlo`);
          assert.ok(PASSI[p.id], `l'id «${p.id}» manca in PASSI (scripts/release-platform-alarm.mjs): il feedback direbbe solo l'id`);
        }
      });

      test('il controllo finale chiede i file attesi allo script, ed elenca TUTTI quelli mancanti', () => {
        const controllo = elenco.find((p) => p.id === 'controllo');
        assert.ok(controllo, 'manca il controllo "i file sono davvero nella release?"');
        assert.match(controllo.corpo, new RegExp(`release-platform-alarm\\.mjs --attesi ${piattaforma}`),
          'i file attesi si chiedono allo script: qui e nel testo del feedback devono essere gli stessi');
        assert.doesNotMatch(controllo.corpo, /Filo-(Mac|Linux)\./,
          'l\'elenco dei file vive in un posto solo (PIATTAFORME dello script), qui non si ripete');
        assert.match(controllo.corpo, /mancanti=\$\{MANCANTI% \}/, 'i mancanti vanno passati all\'allarme');
        assert.match(controllo.corpo, /if \[ -n "\$MANCANTI" \]/, 'si guardano tutti i file, non si esce al primo che manca');
      });
    });
  }
});

// La regola sulla CAUSA, non sulla porta vista: `continue-on-error` su un
// lavoro vuol dire «se questo fallisce, la corsa resta verde». Un lavoro così
// che non apra un feedback è un rosso che nessuno vedrà mai — è esattamente
// come Filo per Linux è mancato da tutte le release per sei giorni.
test('ogni lavoro che può fallire lasciando la corsa verde apre un feedback', () => {
  const jobs = YML.slice(YML.search(/^jobs:\s*$/m));
  const nomi = [...jobs.matchAll(/^ {2}([a-z][\w-]*):\s*$/gm)].map((m) => m[1]);
  // `continue-on-error` del LAVORO sta a quattro spazi; quello di un passo a otto.
  const silenziosi = nomi.filter((n) => /^ {4}continue-on-error:\s*true\s*$/m.test(job(n)));
  assert.ok(silenziosi.includes('release-mac') && silenziosi.includes('release-linux'),
    'i due lavori di piattaforma devono restare continue-on-error: un guasto lì non toglie la release Windows');
  for (const n of silenziosi) {
    assert.match(senzaCommenti(job(n)), /-alarm\.mjs/,
      `\`${n}\` è continue-on-error: se fallisce la corsa resta verde, quindi DEVE aprire un feedback`);
  }
});
