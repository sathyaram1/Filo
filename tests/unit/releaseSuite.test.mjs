// La suite completa gira in GitHub a ogni fusione su main (suite.yml); la pubblicazione (release.yml)
// prende il commit più nuovo di main con la suite verde. Qui si legge che i due workflow lo fanno davvero:
// i testi del repo lo promettono, e un pezzo mancante pubblicherebbe senza suite, in silenzio.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { valutaCondizione, scriptDelPasso, usciteDelLavoro, eseguiPasso, haBash } from '../helpers/azioniGithub.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const YML = readFileSync(resolve(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
const SUITE_YML = readFileSync(resolve(ROOT, '.github', 'workflows', 'suite.yml'), 'utf8');
const SCEGLI_JS = readFileSync(resolve(ROOT, 'scripts', 'ultima-suite-verde.mjs'), 'utf8');
const { PASSI, casella } = await import('../../scripts/release-platform-alarm.mjs');
const { CHIAVE_FERMO, SOGLIA_ORE, LAVORO_UNIT_WINDOWS } = await import('../../scripts/ultima-suite-verde.mjs');
const { nomeEsitoParte, rossiDellePartiMancanti } = await import('../../scripts/suite-verdict.mjs');
const { chiaviDelRegistroUnit } = await import('../../scripts/build-alarm.mjs');

// I commenti raccontano: si guardano solo le righe di comando/configurazione.
const senzaCommenti = (s) => s.split(/\r?\n/).filter((r) => !/^\s*#/.test(r)).join('\n');

/** Il testo di un job (dalla sua riga `  nome:` alla successiva). */
function job(nome, testo = YML) {
  const inizio = testo.search(new RegExp(`^\\s{2}${nome}:\\s*$`, 'm'));
  assert.ok(inizio >= 0, `nel workflow manca il job \`${nome}\``);
  const resto = testo.slice(inizio + 1);
  const fine = resto.search(/^\s{2}[a-z][\w-]*:\s*$/m);
  return fine >= 0 ? testo.slice(inizio, inizio + 1 + fine) : testo.slice(inizio);
}

/** I passi di un job: nome, corpo e id. */
const passi = (testoJob) => testoJob.split(/^ {6}- name: /m).slice(1).map((corpo) => ({
  nome: corpo.split('\n')[0].trim(),
  corpo,
  id: (corpo.match(/^ {8}id: (\S+)$/m) || [])[1] || '',
}));

const intestazione = (testo) => senzaCommenti(testo.slice(0, testo.search(/^jobs:/m)));

describe('suite.yml: la suite completa a ogni fusione su main', () => {
  const suite = senzaCommenti(job('suite', SUITE_YML));
  const elenco = passi(suite);
  const verdettoJob = senzaCommenti(job('verdetto', SUITE_YML));
  const elencoVerdetto = passi(verdettoJob);
  const unitJob = senzaCommenti(job(LAVORO_UNIT_WINDOWS, SUITE_YML));
  const avvisoJob = senzaCommenti(job('avviso', SUITE_YML));
  const elencoAvviso = passi(avvisoJob);
  const suitePasso = elenco.find((p) => /npx playwright test/.test(p.corpo));
  const parti = ((suite.match(/^\s+parte:\s*\[([^\]]*)\]\s*$/m) || [])[1] || '').split(',').map((x) => Number(x.trim()));
  const tetto = (testo) => Number((testo.match(/timeout-minutes:\s*(\d+)/) || [])[1]);

  test('parte a ogni spinta su main, e a mano su qualunque ramo', () => {
    const on = intestazione(SUITE_YML);
    assert.match(on, /^on:\s*\n\s+push:\s*\n\s+branches:\s*\[main\]/m, 'senza la spinta su main nessun commit viene provato');
    assert.match(on, /workflow_dispatch:/, 'senza l\'avvio a mano un ramo non si può provare');
    assert.doesNotMatch(on, /paths(-ignore)?:/, 'ogni fusione va provata: un filtro sui percorsi lascerebbe commit senza verdetto');
    assert.ok(suitePasso, 'nessun passo lancia la suite');
    assert.doesNotMatch(suitePasso.corpo, /^\s+if:/m, 'la suite gira sempre: nessun controllo «c\'è qualcosa di nuovo»');
  });

  test('una suite partita arriva in fondo; le fusioni arrivate intanto si raccolgono nell\'ultima', () => {
    const on = intestazione(SUITE_YML);
    assert.match(on, /concurrency:\s*\n\s+group:\s*suite-\$\{\{\s*github\.ref\s*\}\}\s*\n\s+cancel-in-progress:\s*false/,
      'annullare una suite a metà butta un\'ora e non dice niente di nessun commit');
  });

  test('prova il commit della spinta; l\'avviso lo prende con la storia, per elencare i commit dopo l\'ultimo verde', () => {
    for (const lavoro of [suite, verdettoJob, avvisoJob]) {
      assert.match(lavoro, /ref:\s*\$\{\{\s*github\.sha\s*\}\}/);
    }
    assert.match(avvisoJob, /fetch-depth:\s*0/);
  });

  test('permessi di sola lettura: legge le corse, non scrive niente', () => {
    const on = intestazione(SUITE_YML);
    assert.match(on, /permissions:\s*\n\s+contents:\s*read\s*\n\s+actions:\s*read/);
    assert.doesNotMatch(SUITE_YML, /:\s*write\b/, 'la suite non ha niente da scrivere');
  });

  // #1485: in fila su una macchina la suite ha passato il tetto del passo (200 minuti) e cresceva ancora.
  test('su Linux, divisa in parti che girano insieme: matrice, --shard e verdetto contano le stesse parti', () => {
    assert.match(suite, /runs-on:\s*ubuntu-latest/, 'la suite gira su Linux, come nel contenitore delle routine');
    assert.match(verdettoJob, /runs-on:\s*ubuntu-latest/);
    assert.ok(parti.length >= 2, 'la suite in fila su una macchina sola passava il suo tetto');
    assert.deepEqual(parti, parti.map((_, i) => i + 1), 'le parti si contano da 1 senza buchi: una parte saltata è un pezzo di suite mai provato');
    assert.match(suite, /fail-fast:\s*false/, 'una parte rossa non deve fermare le altre: i loro rossi servono al feedback');
    assert.ok(suitePasso.corpo.includes(`--shard=\${{ matrix.parte }}/${parti.length}`), 'Playwright deve dividere la suite in tante parti quante la matrice');
    const v = elencoVerdetto.find((p) => p.id === 'verdetto');
    assert.ok(v?.corpo.includes(`--parti ${parti.length} --esiti blob-report`), 'il verdetto deve sapere quante parti aspettare');
  });

  test('lancia Playwright come nel contenitore senza schermo, e ogni parte lascia l\'esito col nome che il verdetto cerca', () => {
    assert.match(suitePasso.corpo, /run: ELECTRON_DISABLE_SANDBOX=1 PLAYWRIGHT_BLOB_OUTPUT_NAME=.+ xvfb-run -a npx playwright test --shard=.+ --global-timeout=\d+ --reporter=list,blob$/m,
      'senza sandbox spenta e schermo virtuale Electron non parte; senza l\'esito della parte il verdetto non ha niente da leggere');
    assert.ok(suitePasso.corpo.includes(`PLAYWRIGHT_BLOB_OUTPUT_NAME=${nomeEsitoParte('${{ matrix.parte }}')} `),
      'il verdetto cerca l\'esito di ogni parte con il suo nome: chiamato in un altro modo, la parte risulterebbe senza esito');
    assert.match(suite, /apt-get install -y xvfb/, 'xvfb va installato: sul runner non c\'è');
    assert.match(suite, /ensure-electron\.mjs/, 'il binario di Electron va assicurato');
    assert.match(suite, /node scripts\/npm-ci-ritenta\.mjs/, 'le dipendenze si installano con lo script che ritenta un download che non arriva');
  });

  test('tre tetti in fila: Playwright chiude la parte prima del passo, il passo prima del lavoro', () => {
    const globale = Number((suitePasso.corpo.match(/--global-timeout=(\d+)/) || [])[1]);
    const passo = tetto(suitePasso.corpo);
    const lavoro = tetto(suite.split(/^ {4}steps:/m)[0]);
    assert.ok(globale > 0 && passo > 0 && lavoro > 0, 'ognuno dei tre tetti va scritto');
    assert.ok(globale < passo * 60_000, 'scaduto il tetto di Playwright la parte chiude da sé e lascia l\'esito dei casi girati');
    assert.ok(passo < lavoro, 'il tetto del passo deve stare sotto quello del lavoro, o l\'esito della parte non si carica');
    assert.ok(passo * parti.length >= 400, 'tetti abbondanti: la suite intera deve poter durare il doppio di quando passava i 200 minuti in fila');
    assert.match(suitePasso.corpo, /continue-on-error:\s*true/, 'l\'uscita di Playwright è rossa anche per i soli rossi noti');
    assert.ok(tetto(verdettoJob.split(/^ {4}steps:/m)[0]) > 0, 'anche il verdetto ha il suo tetto');
  });

  test('il verdetto gira dopo tutte le parti, anche con una rossa, ma non a corsa annullata', () => {
    assert.match(verdettoJob, /^ {4}needs:\s*suite\s*$/m);
    const se = (verdettoJob.match(/^ {4}if:\s*(.+)$/m) || [])[1] || '';
    for (const result of ['success', 'failure']) {
      assert.equal(valutaCondizione(se, { needs: { suite: { result, outputs: {} } } }), true, `con le parti ${result} il verdetto deve girare`);
    }
    assert.equal(valutaCondizione(se, { needs: { suite: { result: 'failure', outputs: {} } }, cancellata: true }), false);
  });

  test('il verdetto unisce gli esiti di tutte le parti e lo dà suite-verdict.mjs, che scrive le chiavi dell\'allarme', () => {
    const carica = elenco.find((p) => /upload-artifact/.test(p.corpo) && /blob-report/.test(p.corpo));
    assert.ok(carica, 'ogni parte deve caricare il suo esito');
    assert.match(carica.corpo, /name:\s*suite-esito-\$\{\{\s*matrix\.parte\s*\}\}/);
    assert.match(carica.corpo, /if:\s*always\(\)/, 'una parte con rossi ha l\'esito che serve di più');
    const scarica = elencoVerdetto.find((p) => /download-artifact/.test(p.corpo));
    assert.ok(scarica);
    assert.match(scarica.corpo, /pattern:\s*suite-esito-\*/);
    assert.match(scarica.corpo, /merge-multiple:\s*true/, 'gli esiti delle parti vanno in una cartella sola, quella che il verdetto conta');
    assert.match(scarica.corpo, /path:\s*blob-report\s*$/m);
    assert.ok(elencoVerdetto.some((p) => /PLAYWRIGHT_JSON_OUTPUT_NAME=suite-risultati\.json npx playwright merge-reports --reporter=json blob-report/.test(p.corpo)));
    assert.match(verdettoJob, /node scripts\/suite-verdict\.mjs suite-risultati\.json --out rossi-nuovi\.txt --chiavi chiavi-allarme\.txt/);
    assert.match(verdettoJob, /steps\.verdetto\.outcome == 'failure'/, 'l\'allarme deve partire dal verdetto, non dall\'uscita di Playwright');
    assert.match(rossiDellePartiMancanti([2], 4)[0].titolo, /tetto del passo/, 'una parte senza esito può essere stata fermata dal tetto: si dice');
  });

  // #1429: dalla cloud registro e allegati non si scaricano, e chi risolve «pubblicazione ferma» non vedeva i rossi.
  test('i rossi nuovi restano leggibili con l\'API, come annotazioni, anche su un ramo', () => {
    const passo = elencoVerdetto.find((p) => /annotazioni-github\.mjs/.test(p.corpo));
    assert.ok(passo, 'senza annotazioni i rossi di una corsa li legge solo chi apre GitHub da un browser');
    assert.match(passo.corpo, /annotazioni-github\.mjs rossi-nuovi\.txt/);
    assert.match(passo.corpo, /if:\s*always\(\) && steps\.verdetto\.outcome == 'failure'\s*$/m);
    assert.match(passo.corpo, /continue-on-error:\s*true/, 'un\'annotazione non scritta non dice niente del commit');
    assert.ok(elencoVerdetto.indexOf(passo) > elencoVerdetto.findIndex((p) => p.id === 'verdetto'));
  });

  test('esito, verdetto e tracce restano allegati per sette giorni, anche a suite rossa', () => {
    const finale = elencoVerdetto.find((p) => /upload-artifact/.test(p.corpo));
    const tracce = elenco.find((p) => /upload-artifact/.test(p.corpo) && /test-results\//.test(p.corpo));
    assert.ok(finale && tracce, 'senza screenshot e trace dei rossi, chi prende il feedback rilancia un\'ora di suite');
    for (const passo of [finale, tracce, ...elenco.filter((p) => /upload-artifact/.test(p.corpo))]) {
      assert.match(passo.corpo, /actions\/upload-artifact@v4/);
      assert.match(passo.corpo, /retention-days:\s*7/);
      assert.match(passo.corpo, /if:\s*always\(\)/, 'l\'artifact va caricato anche a suite rossa: è proprio allora che serve');
      assert.match(passo.corpo, /continue-on-error:\s*true/,
        'un caricamento fallito farebbe rossa una suite verde, e l\'allarme la chiamerebbe «suite non partita»');
    }
    assert.match(finale.corpo, /suite-risultati\.json/);
    assert.match(finale.corpo, /verdetto\.log/);
    assert.match(tracce.corpo, /name:\s*suite-tracce-\$\{\{\s*matrix\.parte\s*\}\}/, 'due parti con lo stesso nome di artifact: la seconda verrebbe respinta');
  });

  // #1504: la parola della costruzione sta in un lavoro suo, nell'ambiente fisso. I lavori che fanno girare il codice
  // provato (npm ci, prove) non nominano segreti: senza ambiente un segreto arriva col valore omonimo del repo.
  describe('un rosso nuovo su main apre un feedback, da un lavoro a parte', () => {
    const allarme = elencoAvviso.find((p) => /build-alarm\.mjs/.test(p.corpo) && /Suite Playwright rossa/.test(p.corpo));
    const allarmeUnit = elencoAvviso.find((p) => /build-alarm\.mjs/.test(p.corpo) && /Unit test rossi su Windows/.test(p.corpo));
    const seAvviso = (avvisoJob.match(/^ {4}if:\s*(.+)$/m) || [])[1] || '';
    const corsa = ({ ref = 'refs/heads/main', suite: s = 'success', verdetto = 'success', unit = 'success', cancellata = false } = {}) => ({
      github: { ref },
      cancellata,
      needs: {
        suite: { result: s, outputs: {} },
        verdetto: { result: verdetto, outputs: {} },
        [LAVORO_UNIT_WINDOWS]: { result: unit, outputs: {} },
      },
    });
    const passoCon = (re) => elencoAvviso.find((p) => re.test(p.corpo));
    const condizione = (p) => (p.corpo.match(/^ {8}if:\s*(.+)$/m) || [])[1] || '';

    test('gira su main a ogni rosso, anche con npm ci rosso prima della suite; salta una corsa verde, un ramo, una corsa annullata', () => {
      assert.match(avvisoJob, /^ {4}needs:\s*\[\s*suite,\s*verdetto,\s*unit-windows\s*\]\s*$/m, '`avviso` legge gli esiti di tutti i lavori provati');
      const apre = {
        'rossi nuovi della suite': { verdetto: 'failure' },
        'npm ci rosso in una parte, prima della suite': { suite: 'failure', verdetto: 'failure' },
        'una parte rossa con il verdetto verde': { suite: 'failure' },
        'unit rossi su Windows': { unit: 'failure' },
        'unit su Windows fermati dal tetto del lavoro': { unit: 'cancelled' },
        'suite e unit rossi insieme': { verdetto: 'failure', unit: 'failure' },
      };
      for (const [caso, esiti] of Object.entries(apre)) {
        assert.equal(valutaCondizione(seAvviso, corsa(esiti)), true, `${caso}: su main il feedback non partirebbe`);
      }
      assert.equal(valutaCondizione(seAvviso, corsa()), false, 'una corsa verde salta l\'avviso');
      assert.equal(valutaCondizione(seAvviso, corsa({ ref: 'refs/heads/prova', verdetto: 'failure', unit: 'failure' })), false,
        'su un ramo l\'avviso si salta prima dell\'ambiente, che lo respingerebbe');
      assert.equal(valutaCondizione(seAvviso, corsa({ verdetto: 'failure', cancellata: true })), false);
    });

    test('un passo per lavoro rosso, e il secondo parte anche se il primo non ha consegnato', () => {
      assert.ok(allarme && allarmeUnit, 'un rosso deve diventare un feedback, non un silenzio');
      const scaricaSuite = passoCon(/download-artifact[\s\S]*name:\s*suite-playwright-/);
      const scaricaUnit = passoCon(/download-artifact[\s\S]*name:\s*unit-windows-registro/);
      for (const p of [allarme, scaricaSuite]) {
        assert.equal(valutaCondizione(condizione(p), corsa({ verdetto: 'failure' })), true, `«${p.nome}» salta a suite rossa`);
        assert.equal(valutaCondizione(condizione(p), corsa({ suite: 'failure', verdetto: 'failure' })), true, `«${p.nome}» salta con una parte rossa`);
        assert.equal(valutaCondizione(condizione(p), corsa({ unit: 'failure' })), false, `«${p.nome}» apre la suite per un rosso degli unit`);
      }
      for (const p of [allarmeUnit, scaricaUnit]) {
        assert.equal(valutaCondizione(condizione(p), corsa({ unit: 'failure' })), true, `«${p.nome}» salta a unit rossi`);
        assert.equal(valutaCondizione(condizione(p), corsa({ verdetto: 'failure' })), false, `«${p.nome}» apre gli unit per un rosso della suite`);
      }
      for (const p of [allarme, allarmeUnit, scaricaSuite, scaricaUnit]) {
        assert.match(condizione(p), /^always\(\) && !cancelled\(\)/, `«${p.nome}» senza always(): dopo un passo rosso verrebbe saltato`);
      }
    });

    test('la credenziale sta solo in `avviso`, nell\'ambiente fisso, e lì il codice non si installa', () => {
      assert.match(allarme.corpo, /secrets\.FILO_BUILD_PASSPHRASE/);
      assert.match(allarmeUnit.corpo, /secrets\.FILO_BUILD_PASSPHRASE/);
      assert.match(senzaCommenti(job('release')), /secrets\.FILO_BUILD_PASSPHRASE/, 'il cancello unit usa FILO_BUILD_PASSPHRASE');
      assert.match(avvisoJob, /^ {4}environment:\s*rilascio\s*$/m, 'la parola si legge solo nell\'ambiente `rilascio`, scritto fisso');
      for (const [nome, testo] of [['suite', suite], ['verdetto', verdettoJob], [LAVORO_UNIT_WINDOWS, unitJob]]) {
        assert.doesNotMatch(testo, /secrets\.|environment:/, `\`${nome}\` fa girare il codice provato: niente segreti né ambiente`);
      }
      assert.doesNotMatch(avvisoJob, /npm-ci-ritenta|^\s*(?:run:\s*)?(?:npm|npx|yarn|pnpm)\s/m,
        'in `avviso` niente installazione: lo stesso lavoro che legge la parola non esegue dipendenze');
      assert.match(allarme.corpo, /PARTI_ESITO:\s*\$\{\{\s*needs\.suite\.result\s*\}\}/, 'l\'allarme deve sapere se una parte è rossa fuori dalla suite');
    });

    test('gli strumenti dell\'avviso usano solo moduli di Node: senza npm ci un import da node_modules lo farebbe tacere', () => {
      const daVedere = [...new Set([...avvisoJob.matchAll(/node (scripts\/[\w./-]+\.mjs)/g)].map((m) => m[1]))];
      assert.ok(daVedere.length >= 2, 'l\'avviso chiama build-alarm.mjs e ultima-suite-verde.mjs');
      const visti = new Set();
      while (daVedere.length) {
        const rel = daVedere.pop();
        if (visti.has(rel)) continue;
        visti.add(rel);
        const src = readFileSync(resolve(ROOT, rel), 'utf8');
        const importati = [...src.matchAll(/^\s*import\s+(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm)].map((m) => m[1] || m[2]);
        for (const spec of importati) {
          if (spec.startsWith('node:')) continue;
          assert.ok(spec.startsWith('.'), `${rel} importa «${spec}»: in \`avviso\` non c'è npm ci`);
          daVedere.push(posix.normalize(posix.join(posix.dirname(rel), spec)));
        }
      }
    });

    test('legge gli allegati dei lavori provati, gli stessi che loro caricano', () => {
      const caricaVerdetto = elencoVerdetto.find((p) => /upload-artifact/.test(p.corpo));
      const caricaUnit = passi(unitJob).find((p) => /upload-artifact/.test(p.corpo));
      for (const [scarica, carica, cartella] of [
        [passoCon(/download-artifact[\s\S]*name:\s*suite-playwright-/), caricaVerdetto, 'esiti-suite'],
        [passoCon(/download-artifact[\s\S]*name:\s*unit-windows-registro/), caricaUnit, 'esiti-unit'],
      ]) {
        assert.ok(scarica && carica);
        const nome = (p) => (p.corpo.match(/^ {10}name:\s*(\S+)\s*$/m) || [])[1];
        assert.equal(nome(scarica), nome(carica), 'l\'avviso cerca un allegato con un altro nome: resterebbe senza dati');
        assert.match(scarica.corpo, /continue-on-error:\s*true/, 'un allegato che manca non ferma l\'avviso');
        assert.match(scarica.corpo, new RegExp(`path:\\s*${cartella}\\s*$`, 'm'), 'gli allegati in una cartella loro, lontano dagli strumenti');
        const letti = [...avvisoJob.matchAll(new RegExp(`${cartella}/([\\w.-]+)`, 'g'))].map((m) => m[1]);
        assert.ok(letti.length, `l'avviso non legge niente da ${cartella}`);
        for (const f of letti) assert.ok(carica.corpo.includes(f), `l'avviso legge ${f}, che «${carica.nome}» non carica`);
      }
    });

    test('il testo: i rossi con un tetto dichiarato, il link alla corsa, i commit entrati dopo l\'ultimo verde', () => {
      assert.match(allarme.corpo, /head -80/);
      assert.match(allarme.corpo, /elenco tagliato/);
      assert.match(allarme.corpo, /N_TUTTE - 80/);
      assert.match(allarme.corpo, /actions\/runs\/\$\{\{ github\.run_id \}\}/, 'chi prende il feedback deve arrivare alla corsa');
      assert.match(allarme.corpo, /node scripts\/ultima-suite-verde\.mjs --stampa/);
      assert.match(allarme.corpo, /git log --first-parent --format='%h %s' "\$\{VERDE\}\.\.HEAD"/);
      assert.match(allarme.corpo, /head -40/);
      assert.match(allarme.corpo, /N_COMMIT - 40/, 'anche il taglio dei commit si dice');
      assert.match(allarme.corpo, /Nessuna suite verde su main/, 'senza un verde lo si dice, invece di un elenco vuoto');
      assert.match(allarme.corpo, /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
      assert.doesNotMatch(allarme.corpo, /prima di ogni pubblicazione/, 'la suite non gira più prima della pubblicazione');
    });

    test('le chiavi: quelle del verdetto, o `suite:non-partita` se il verdetto non c\'è', () => {
      assert.match(allarme.corpo, /--chiavi-da esiti-suite\/chiavi-allarme\.txt/);
      assert.match(allarme.corpo, /--chiave suite:non-partita/);
      assert.match(allarme.corpo, /-s esiti-suite\/chiavi-allarme\.txt/);
    });

    // I passi si fanno girare con lo strumento dell'allarme finto: gli allegati ci sono o mancano, l'invio va o no.
    describe('i passi dell\'avviso, fatti girare', { skip: !haBash && 'serve bash' }, () => {
      const ALLARME_FINTO = [
        "import { writeFileSync } from 'node:fs';",
        "writeFileSync(new URL('../allarme.json', import.meta.url), JSON.stringify(process.argv.slice(2)));",
        'process.exit(Number(process.env.INVIO_ESITO || 0));',
      ].join('\n');
      const gira = (passo, { file = {}, env = {} } = {}) => {
        const r = eseguiPasso(`cd "$CARTELLA_PASSO"\n${scriptDelPasso(passo.corpo)}`, {
          env: { CARTELLA_PASSO: '{{dir}}', FILO_BUILD_PASSPHRASE: 'x', GH_TOKEN: '', ESECUZIONE: 'https://github.com/o/r/actions/runs/1', ...env },
          file: { 'scripts/build-alarm.mjs': ALLARME_FINTO, 'scripts/ultima-suite-verde.mjs': '', ...file },
          leggi: ['allarme.json'],
        });
        const argv = r.letti['allarme.json'] ? JSON.parse(r.letti['allarme.json']) : null;
        return { stato: r.stato, registro: r.registro, titolo: argv?.[0], testo: argv?.[1] || '', chiavi: argv?.slice(2) };
      };

      test('suite senza allegato (npm ci rosso in una parte): feedback con la chiave «non partita»', () => {
        const r = gira(allarme, { env: { PARTI_ESITO: 'failure' } });
        assert.equal(r.stato, 0, r.registro);
        assert.equal(r.titolo, 'Suite Playwright rossa su main: commit non pubblicabile');
        assert.deepEqual(r.chiavi, ['--chiave', 'suite:non-partita']);
        assert.match(r.testo, /Una parte della suite NON e partita/);
        assert.match(r.testo, /actions\/runs\/1/);
      });

      test('suite con i rossi nuovi: feedback coi rossi e le chiavi del verdetto', () => {
        const r = gira(allarme, {
          env: { PARTI_ESITO: 'success' },
          file: {
            'esiti-suite/chiavi-allarme.txt': 'suite:tests/a.spec.mjs\n',
            'esiti-suite/rossi-nuovi.txt': 'tests/a.spec.mjs › il caso rosso\n',
            'esiti-suite/verdetto.log': 'Rossi nuovi: 1\n',
            'esiti-suite/suite-risultati.json': '{}',
          },
        });
        assert.equal(r.stato, 0, r.registro);
        assert.deepEqual(r.chiavi, ['--chiavi-da', 'esiti-suite/chiavi-allarme.txt']);
        assert.match(r.testo, /Rossi nuovi \(1\):\ntests\/a\.spec\.mjs › il caso rosso/);
        assert.match(r.testo, /Verdetto:\nRossi nuovi: 1/);
        assert.doesNotMatch(r.testo, /NON e partita|non ha lasciato il JSON/);
      });

      test('un allarme non consegnato fa rosso `avviso`', () => {
        const r = gira(allarme, { env: { PARTI_ESITO: 'failure', INVIO_ESITO: '1' } });
        assert.notEqual(r.stato, 0);
        assert.match(r.registro, /non consegnato/);
      });

      test('unit senza registro: feedback con la chiave «non partiti»', () => {
        const r = gira(allarmeUnit);
        assert.equal(r.stato, 0, r.registro);
        assert.equal(r.titolo, 'Unit test rossi su Windows: commit non pubblicabile');
        assert.deepEqual(r.chiavi, ['--chiave', 'unit-windows:non-partiti']);
        assert.match(r.testo, /Gli unit test NON sono partiti/);
      });

      test('unit rossi: feedback coi rossi del registro di Windows e le chiavi del cancello', () => {
        const registro = "not ok 3 - tests\\unit\\x.test.mjs\n  location: 'D:\\\\a\\\\Filo\\\\Filo\\\\tests\\\\unit\\\\x.test.mjs:12:3'\n";
        const r = gira(allarmeUnit, { file: { 'esiti-unit/unit.log': registro } });
        assert.equal(r.stato, 0, r.registro);
        assert.deepEqual(r.chiavi, ['--chiavi-unit', 'esiti-unit/unit.log']);
        assert.match(r.testo, /Test rossi \(2 righe\):\nnot ok 3/);
        // Il registro è nato su Windows e lo legge Linux: le chiavi devono restare quelle del cancello.
        assert.deepEqual(chiaviDelRegistroUnit(registro, '/home/runner/work/Filo/Filo'), chiaviDelRegistroUnit(registro, 'D:\\a\\Filo\\Filo'));
        assert.deepEqual(chiaviDelRegistroUnit(registro, '/home/runner/work/Filo/Filo'), ['unit:tests/unit/x.test.mjs']);
      });
    });
  });

  // Il lavoro di pubblicazione sceglie solo corse RIUSCITE: una corsa verde con un rosso nuovo dentro pubblicherebbe
  // proprio quel rosso. Su main come sui rami: è il rosso che `avviso` legge.
  test('un rosso lascia la corsa rossa da sé, su main e sui rami, senza credenziali', () => {
    const rossa = elencoVerdetto.find((p) => /la corsa resta rossa/.test(p.nome));
    assert.ok(rossa, 'un rosso nuovo finirebbe in una corsa verde');
    const se = (rossa.corpo.match(/^ {8}if:\s*(.+)$/m) || [])[1] || '';
    for (const ref of ['refs/heads/main', 'refs/heads/prova']) {
      assert.equal(valutaCondizione(se, { github: { ref }, steps: { verdetto: { outcome: 'failure' } } }), true, `su ${ref} un rosso nuovo lascerebbe la corsa verde`);
      assert.equal(valutaCondizione(se, { github: { ref }, steps: { verdetto: { outcome: 'success' } } }), false);
    }
    assert.match(se, /\|\| failure\(\)/, 'anche un passo rosso prima del verdetto');
    assert.match(rossa.corpo, /exit 1/);
    assert.doesNotMatch(verdettoJob, /secrets\.|build-alarm/);
  });

  test('nessun passo dopo il verdetto può far finire verde una suite rossa', () => {
    for (const lavoro of [suite, verdettoJob]) {
      assert.doesNotMatch(lavoro, /^ {4}continue-on-error:\s*true\s*$/m, 'col lavoro continue-on-error la corsa sarebbe verde a suite rossa');
    }
  });

  test('in GitHub una prova lasciata «a fuoco» ferma la suite invece di farla risultare verde', async () => {
    const carica = async (ci) => {
      const prima = process.env.CI;
      if (ci) process.env.CI = 'true'; else delete process.env.CI;
      try {
        const href = new URL(`file://${resolve(ROOT, 'playwright.config.js').replace(/\\/g, '/')}?ci=${ci}`).href;
        return (await import(href)).default;
      } finally {
        if (prima === undefined) delete process.env.CI; else process.env.CI = prima;
      }
    };
    assert.equal((await carica(true)).forbidOnly, true, 'con CI=true, come in GitHub, girerebbe solo la prova a fuoco: verde finto');
    assert.ok(!(await carica(false)).forbidOnly, 'in locale mettere a fuoco una prova resta lo strumento di chi prova');
    assert.doesNotMatch(SUITE_YML, /\bCI:\s*(false|'false'|"false"|''|"")/, 'spegnere CI nel lavoro della suite riaprirebbe il verde finto');
  });
});

// #1184: il cancello di pubblicazione rifà gli unit su Windows; se la suite non li prova, il «verde» scelto può essere
// un commit che il cancello rifiuta a ogni giro, e la pubblicazione si ferma per giorni.
describe('suite.yml: gli unit test su Windows, gli stessi del cancello di pubblicazione', () => {
  const lavoro = senzaCommenti(job(LAVORO_UNIT_WINDOWS, SUITE_YML));
  const elenco = passi(lavoro);
  const unit = elenco.find((p) => p.id === 'unit');

  test('il lavoro ha il nome che la scelta del verde chiede alle corse, e gira su Windows', () => {
    assert.match(lavoro, /runs-on:\s*windows-latest/);
    assert.doesNotMatch(lavoro, /^ {4}name:/m, 'nelle corse un lavoro si chiama come la sua chiave: rinominato, la scelta non lo troverebbe');
    assert.match(lavoro, /timeout-minutes:\s*\d+/);
  });

  test('niente lo salta o lo tollera: rosso lui, rossa la corsa', () => {
    assert.doesNotMatch(lavoro, /^ {4}if:/m, 'saltato, la corsa sarebbe verde senza averlo passato');
    assert.doesNotMatch(lavoro, /^ {4}continue-on-error:/m, 'tollerato, la corsa sarebbe verde a unit rossi');
  });

  test('prova il commit della spinta, con lo stesso comando e lo stesso Node del cancello', () => {
    assert.match(lavoro, /ref:\s*\$\{\{\s*github\.sha\s*\}\}/);
    assert.match(lavoro, /fetch-depth:\s*0/, 'come il cancello di pubblicazione, che prova con la storia intera');
    const cancello = passi(senzaCommenti(job('release'))).find((p) => p.id === 'gate');
    const comando = 'node scripts/unit-con-riprova.mjs --registro unit.log';
    assert.ok(cancello.corpo.includes(comando), 'il cancello di pubblicazione è cambiato: questo lavoro va allineato');
    assert.ok(unit?.corpo.includes(comando));
    assert.doesNotMatch(`${cancello.corpo}\n${unit.corpo}`, /npm run test:unit/,
      'senza la riprova un flaky su Windows butta un verde, o un giro di pubblicazione');
    assert.match(unit.corpo, /continue-on-error:\s*true/, 'il passo dopo deve poter aprire il feedback');
    const node = (t) => (t.match(/node-version:\s*(\S+)/) || [])[1];
    assert.equal(node(lavoro), node(senzaCommenti(job('release'))));
    assert.match(lavoro, /node scripts\/npm-ci-ritenta\.mjs/);
  });

  test('un rosso lascia la corsa rossa da sé, su main e sui rami, e il registro va all\'avviso', () => {
    const rossa = elenco.find((p) => /la corsa resta rossa/.test(p.nome));
    assert.ok(rossa, 'unit rossi in una corsa verde: la pubblicazione sceglierebbe un commit che il cancello rifiuta');
    const se = (rossa.corpo.match(/^ {8}if:\s*(.+)$/m) || [])[1] || '';
    for (const ref of ['refs/heads/main', 'refs/heads/prova']) {
      assert.equal(valutaCondizione(se, { github: { ref }, steps: { unit: { outcome: 'failure' } } }), true, `su ${ref} gli unit rossi lascerebbero la corsa verde`);
      assert.equal(valutaCondizione(se, { github: { ref }, steps: { unit: { outcome: 'success' } } }), false);
    }
    assert.match(se, /\|\| failure\(\)/, 'anche un npm ci rosso prima degli unit');
    assert.match(rossa.corpo, /exit 1/);
    assert.doesNotMatch(lavoro, /secrets\.|environment:|build-alarm/, 'qui gira il codice provato: il feedback lo apre `avviso`');
    const carica = elenco.find((p) => /upload-artifact/.test(p.corpo));
    assert.ok(carica, 'senza il registro l\'avviso direbbe «non partiti» anche a unit rossi');
    assert.match(carica.corpo, /path:\s*unit\.log\s*$/m);
    assert.match(carica.corpo, /if:\s*always\(\)/, 'il registro serve proprio a unit rossi');
    assert.match(carica.corpo, /continue-on-error:\s*true/);
    assert.match(carica.corpo, /retention-days:\s*7/);
    assert.ok(elenco.indexOf(carica) > elenco.indexOf(unit) && elenco.indexOf(carica) < elenco.indexOf(rossa),
      'il registro si carica dopo gli unit e prima del passo che chiude rosso');
  });

  test('su main l\'avviso apre il feedback con le chiavi del cancello', () => {
    const allarme = passi(senzaCommenti(job('avviso', SUITE_YML))).find((p) => /build-alarm\.mjs/.test(p.corpo) && /Unit test rossi su Windows/.test(p.corpo));
    assert.ok(allarme, 'un rosso che non diventa un feedback ferma la pubblicazione in silenzio');
    assert.match(allarme.corpo, /--chiavi-unit esiti-unit\/unit\.log/, 'le chiavi del cancello: lo stesso rosso visto qui e là apre un feedback solo');
    assert.match(allarme.corpo, /--chiave unit-windows:non-partiti/);
    assert.match(allarme.corpo, /secrets\.FILO_BUILD_PASSPHRASE/);
    assert.match(allarme.corpo, /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
    assert.match(allarme.corpo, /node scripts\/ultima-suite-verde\.mjs --stampa/);
    assert.match(allarme.corpo, /head -80/);
    assert.match(allarme.corpo, /N_TUTTE - 80/);
  });

  test('gli unit rossi restano leggibili con l\'API, come annotazioni, anche su un ramo', () => {
    const passo = elenco.find((p) => /annotazioni-github\.mjs/.test(p.corpo));
    assert.ok(passo);
    assert.match(passo.corpo, /if:\s*always\(\) && steps\.unit\.outcome == 'failure'\s*$/m);
    assert.match(passo.corpo, /continue-on-error:\s*true/);
    assert.ok(elenco.indexOf(passo) > elenco.indexOf(unit));
    // Una corsa caduta prima del riepilogo non ha casi «not ok»: senza la coda del registro dalla cloud non si legge niente.
    assert.match(passo.corpo, /if \[ -s unit-rossi\.txt \]/);
    assert.match(passo.corpo, /tail -n \d+ unit\.log > (\S+)[\s\S]*annotazioni-github\.mjs \1/);
  });

  test('la scelta del verde chiede alle corse se questo lavoro è passato', () => {
    assert.ok(SCEGLI_JS.includes('/actions/runs/${r.id}/jobs'), 'senza chiedere i lavori, un verde di prima del lavoro passerebbe');
    assert.match(SCEGLI_JS, /scegliUltimoVerde\(runs, primoGenitore, valida\)/);
  });
});

describe('release.yml: si pubblica il commit più nuovo di main con la suite verde', () => {
  const release = () => senzaCommenti(job('release'));
  const scegli = senzaCommenti(job('scegli'));

  test('la suite non gira più qui, e `solo_suite` non c\'è più', () => {
    assert.doesNotMatch(YML, /^\s{2}suite:\s*$/m);
    assert.doesNotMatch(YML, /solo_suite/);
    assert.doesNotMatch(senzaCommenti(YML), /npx playwright test/);
    assert.match(intestazione(YML), /cron:/, 'la pubblicazione resta a orari fissi');
  });

  test('`scegli` legge main con storia e tag, può leggere le corse, e passa lo sha', () => {
    assert.ok(YML.search(/^\s{2}scegli:/m) < YML.search(/^\s{2}release:/m));
    assert.match(scegli, /runs-on:\s*ubuntu-latest/);
    assert.match(scegli, /ref:\s*main\b/);
    assert.match(scegli, /fetch-depth:\s*0/);
    assert.match(scegli, /permissions:\s*\n\s+contents:\s*read\s*\n\s+actions:\s*read/, 'senza actions: read le corse della suite non si leggono');
    assert.match(scegli, /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
    assert.match(scegli, /node scripts\/ultima-suite-verde\.mjs/);
    assert.match(scegli, /outputs:\s*\n\s*sha:\s*\$\{\{\s*steps\.scelta\.outputs\.sha\s*\}\}/);
    assert.match(scegli, /id:\s*scelta/);
  });

  test('la scelta guarda solo corse riuscite di suite.yml su main', () => {
    assert.match(SCEGLI_JS, /actions\/workflows\/suite\.yml\/runs\?branch=main&/);
    assert.match(SCEGLI_JS, /status=success/);
    assert.match(SCEGLI_JS, /--first-parent/);
  });

  test('pubblicazione ferma da più di 48 ore: un feedback con la sua chiave, e la corsa rossa', () => {
    assert.equal(CHIAVE_FERMO, 'rilascio:fermo');
    assert.equal(SOGLIA_ORE, 48);
    assert.match(scegli, /FILO_BUILD_PASSPHRASE:\s*\$\{\{\s*secrets\.FILO_BUILD_PASSPHRASE\s*\}\}/, 'senza credenziale l\'allarme non parte');
    assert.match(SCEGLI_JS, /inviaAllarme\(titolo, testo, \[chiaveDelFermo\(CHIAVE_FERMO, tag\)\]\)/,
      'la chiave porta la versione a cui è ferma: il feedback di un fermo vecchio non assorbe quello nuovo');
    const dopo = SCEGLI_JS.slice(SCEGLI_JS.indexOf('inviaAllarme(titolo, testo, [chiaveDelFermo(CHIAVE_FERMO, tag)])'));
    assert.match(dopo.slice(0, 110), /process\.exit\(1\)/, 'dopo l\'allarme la corsa deve finire rossa');
    assert.doesNotMatch(scegli, /continue-on-error/, 'un `scegli` rosso che lascia la corsa verde tace');
  });

  test('«codice nuovo dopo il tag» si conta come nel lavoro Windows', () => {
    assert.match(release(), /git rev-list --count --invert-grep --grep='\^release: v\[0-9\]' "\$\{LAST_TAG\}\.\.HEAD"/,
      'senza escludere il commit del server ogni corsa rilascerebbe di nuovo');
    assert.ok(SCEGLI_JS.includes("'--invert-grep', '--grep=^release: v[0-9]'"),
      'la guardia della pubblicazione ferma conterebbe come codice nuovo il commit del numero di versione');
  });

  test('il lavoro Windows aspetta `scegli` e parte solo con uno sha (e il Mac dipende ancora da Windows)', () => {
    const r = release();
    assert.match(r, /needs:\s*scegli/, 'senza `needs: scegli` si pubblicherebbe senza sapere cosa è verde');
    assert.match(r, /if:\s*\$\{\{\s*success\(\) && needs\.scegli\.outputs\.sha != ''\s*\}\}/,
      'senza un commit verde nuovo il lavoro Windows non deve partire');
    assert.match(senzaCommenti(job('release-mac')), /needs:\s*release/, 'il Mac resta appeso a Windows');
    assert.doesNotMatch(YML, /needs\.suite\./);
  });

  test('il lavoro Windows fa il checkout del commit scelto, non di main, e non rilegge main nell\'albero', () => {
    const r = release();
    assert.match(r, /uses: actions\/checkout@v4\s*\n\s*with:\s*\n\s*ref:\s*\$\{\{\s*needs\.scegli\.outputs\.sha\s*\}\}/,
      'il checkout deve partire dallo sha scelto');
    assert.doesNotMatch(r, /ref:\s*main\b/, 'costruire la punta di main pubblicherebbe codice mai provato');
    assert.doesNotMatch(r, /git (pull|merge|rebase|reset|checkout)\b/, 'niente deve spostare l\'albero dal commit provato');
  });

  test('senza lo sha scelto non si pubblica (il checkout cadrebbe sul ramo di default)', () => {
    const r = release();
    const check = r.slice(r.indexOf('id: check'), r.indexOf('git fetch --tags --force'));
    assert.match(check, /PROVATO="\$\{\{ needs\.scegli\.outputs\.sha \}\}"/);
    assert.match(check, /-z "\$PROVATO"/);
    assert.match(check, /"\$QUI" != "\$PROVATO"/);
    assert.match(check, /exit 1/);
  });

  test('il numero del server si applica in locale al commit provato, dopo il bump e prima della build', () => {
    const r = release();
    const bump = r.indexOf('release-bump.mjs');
    const applica = r.indexOf('release-apply-version.mjs');
    const build = r.indexOf('npm run release');
    assert.ok(bump >= 0 && applica > bump && build > applica, 'ordine: numero dal server, applicato in locale, poi build');
    assert.match(r, /release-apply-version\.mjs "\$ATTESA"/);
    assert.match(r, /ATTESA="\$\{\{ steps\.bump\.outputs\.version \}\}"/);
    assert.match(r, /PROVATO="\$\{\{ needs\.scegli\.outputs\.sha \}\}"\s*\n\s*ATTESA=/, 'il controllo dopo l\'applicazione confronta con lo sha scelto');
    assert.match(r, /sha:\s*\$\{\{\s*steps\.applica\.outputs\.sha\s*\}\}/, 'Mac e Linux ricevono lo sha costruito');
  });

  test('main andato avanti: resta una nota nel riassunto, con i due sha, e la pubblicazione prosegue', () => {
    const r = release();
    const passo = r.slice(r.indexOf('id: applica'), r.indexOf('name: Build e upload su GitHub Releases'));
    const nota = passo.slice(passo.indexOf('git fetch --quiet origin main'));
    assert.ok(passo.includes('git fetch --quiet origin main'), 'main si legge solo per la nota');
    assert.match(nota, /GITHUB_STEP_SUMMARY/);
    assert.match(nota, /\$\{PROVATO\}[\s\S]*\$\{MAIN_ORA\}/, 'con lo sha provato e quello attuale di main');
    assert.match(nota, /main si e' mosso/);
    assert.doesNotMatch(nota, /exit 1|should_release=false/, 'main mosso non ferma la pubblicazione');
  });

  test('il tag nasce sul commit costruito', () => {
    assert.match(release(), /gh release edit "\$\{\{ steps\.bump\.outputs\.version \}\}" --draft=false --latest --target "\$\{\{ steps\.applica\.outputs\.sha \}\}"/,
      'senza --target il tag cadrebbe sulla punta di main e le fusioni non pubblicate risulterebbero già uscite');
  });

  for (const nome of ['release-mac', 'release-linux']) {
    test(`${nome} ricostruisce lo stesso sha con lo stesso numero applicato in locale`, () => {
      const j = senzaCommenti(job(nome));
      // Lo sha di Windows passa dal passo che sceglie il bersaglio (#733).
      assert.match(j, /COMMIT_APPENA_USCITO:\s*\$\{\{\s*needs\.release\.outputs\.sha\s*\}\}/);
      assert.match(j, /ref:\s*\$\{\{\s*steps\.bersaglio\.outputs\.codice\s*\}\}/);
      const applica = j.indexOf('release-apply-version.mjs "$ATTESA"');
      assert.ok(applica >= 0, 'il numero va applicato anche qui, o il pacchetto esce col numero vecchio');
      assert.ok(applica < j.indexOf('npm run release:'), 'prima della build');
    });
  }
});

// Il server non apre un secondo feedback per un guasto già in coda: lo riconosce
// dalle chiavi. Un allarme senza chiavi torna al vecchio «uno per mittente», che
// ha buttato ogni allarme per tre settimane dietro a un feedback parcheggiato.
describe('ogni allarme dice al server cosa è rotto', () => {
  test('ogni passo che chiama build-alarm.mjs nei workflow passa le sue chiavi', () => {
    let chiamate = 0;
    for (const [nome, testo] of [['release.yml', YML], ['suite.yml', SUITE_YML]]) {
      for (const p of passi(senzaCommenti(testo)).filter((x) => /node scripts\/build-alarm\.mjs/.test(x.corpo))) {
        chiamate += 1;
        assert.match(p.corpo, /--chiav/, `${nome}: il passo «${p.nome}» apre un allarme senza chiavi`);
      }
    }
    assert.equal(chiamate, 3, 'le chiamate dirette sono tre: il cancello unit, la suite rossa e gli unit rossi su Windows');
    assert.match(senzaCommenti(job('release')), /build-alarm\.mjs [^\n]*--chiavi-unit unit\.log/, 'il cancello unit dà una chiave per file di test');
  });

  test('ogni chiamata a inviaAllarme o spedisciAllarme negli script passa le sue chiavi', () => {
    for (const f of ['release-platform-alarm.mjs', 'ultima-suite-verde.mjs']) {
      const src = readFileSync(resolve(ROOT, 'scripts', f), 'utf8');
      const chiamate = src.match(/await (?:invia|spedisci)Allarme\([^)]*\)/g) || [];
      assert.ok(chiamate.length, `${f} non chiama più inviaAllarme`);
      for (const c of chiamate) assert.match(c, /Allarme\([^,]+,[^,]+,[^)]+\)/, `${f}: ${c} senza chiavi`);
    }
    assert.match(SCEGLI_JS, /spedisciAllarme\(titolo, testo, \[chiaveDelFermo\(CHIAVE_FERMO_DOPO_VERDE, tag\)\]\)/,
      'un verde fermo da giorni deve aprire il suo feedback');
    assert.match(readFileSync(resolve(ROOT, 'scripts', 'bake-default-config.mjs'), 'utf8'), /keys: chiaviAllarmeBake\(mancanti\)/);
  });
});

// Nel contenitore delle routine (Linux, senza schermo, da root) un comando
// con xvfb-run ma senza la sandbox spenta non fa partire Electron: un testo
// che lo scrive a metà è la trappola che ogni giro riscopriva. Dal #739
// `npx playwright test` se lo prepara da solo e i testi non lo chiedono più:
// dove resta scritto (i comandi fuori da Playwright), è intero.
describe('il comando del contenitore è scritto intero, dovunque compaia', () => {
  test('ogni riga con `xvfb-run -a` in CLAUDE.md, nei ruoli e nei rossi noti porta anche ELECTRON_DISABLE_SANDBOX=1', () => {
    const files = ['CLAUDE.md', 'tests/rossi-noti.json',
      ...readdirSync(resolve(ROOT, 'routines', 'roles')).filter((n) => n.endsWith('.md')).map((n) => `routines/roles/${n}`)];
    for (const f of files) {
      for (const riga of readFileSync(resolve(ROOT, f), 'utf8').split(/\r?\n/)) {
        if (!/xvfb-run -a/.test(riga)) continue;
        assert.match(riga, /ELECTRON_DISABLE_SANDBOX=1/, `${f}: «${riga.trim().slice(0, 120)}» — metà comando`);
      }
    }
  });
});

// ─── L'ultima rete delle metà di piattaforma, fatta girare ───────────────────
const PIATTAFORMA_DI = { 'release-mac': 'Mac', 'release-linux': 'Linux' };
const LAVORI_PIATTAFORMA = Object.keys(PIATTAFORMA_DI);
const nomiLavori = (testo) => [...testo.slice(testo.search(/^jobs:\s*$/m)).matchAll(/^ {2}([a-z][\w-]*):\s*$/gm)].map((m) => m[1]);
const needsDi = (nome, testo) => ((job(nome, testo).match(/^ {4}needs:\s*(.+)$/m) || [])[1] || '')
  .replace(/[[\]]/g, '').split(',').map((x) => x.trim()).filter(Boolean);
const condizioneDi = (nome, testo) => (job(nome, testo).match(/^ {4}if:\s*(.+)$/m) || [])[1] || '';

const AVVISO_FINTO = [
  "import { appendFileSync } from 'node:fs';",
  "appendFileSync(new URL('./tentativi.txt', import.meta.url), 'x');",
  'process.exit(Number(process.env.INVIO_ESITO || 0));',
].join('\n');

/** Le uscite che un lavoro di piattaforma lascia agli altri: riuscito, o fallito con l'invio dell'avviso che va o non va. */
function esitiDelLavoro(nomeJob, testo) {
  const t = senzaCommenti(job(nomeJob, testo));
  const elenco = passi(t);
  const dichiarate = usciteDelLavoro(t);
  const avviso = elenco.find((p) => /node\s+\S*release-platform-alarm\.mjs(?![^\n]*--attesi)/.test(p.corpo));
  const uscitePer = (eseguiti) => Object.fromEntries(Object.entries(dichiarate)
    .map(([nome, { passo, chiave }]) => [nome, (eseguiti[passo] || {})[chiave] ?? '']));
  const esegui = (p, opzioni) => eseguiPasso((scriptDelPasso(p.corpo) || '').replace(/\$\{\{[^}]*\}\}/g, ''), opzioni);

  // Riuscito: girano i passi senza `if:` da cui il lavoro prende le sue uscite.
  const riusciti = {};
  for (const { passo } of Object.values(dichiarate)) {
    const p = elenco.find((x) => x.id === passo);
    if (p && p !== avviso && !/^ {8}if:/m.test(p.corpo) && !(passo in riusciti)) riusciti[passo] = esegui(p).uscite;
  }
  const fallito = (invioOk) => {
    if (!avviso) return { uscite: {}, tentativi: 0, riepilogo: '' };
    const r = esegui(avviso, {
      env: { ALLARME: '{{dir}}/allarme', INVIO_ESITO: invioOk ? '0' : '1' },
      file: { 'allarme/release-platform-alarm.mjs': AVVISO_FINTO },
      leggi: ['allarme/tentativi.txt'],
    });
    return { uscite: uscitePer({ [avviso.id]: r.uscite }), tentativi: r.letti['allarme/tentativi.txt'].length, riepilogo: r.riepilogo };
  };
  return { avviso, riuscito: uscitePer(riusciti), fallito };
}

/**
 * Cosa non regge nell'ultima rete: per ogni metà, con l'altra finita bene, la rete scatta quando la metà non è
 * finita e il suo avviso non risulta aperto (fallita, stroncata, scaduta), e tace quando è finita o ha avvisato.
 * Senza bash i passi non girano: restano le prove sui lavori stroncati, con l'altra metà saltata.
 */
function problemiDellaRete(testo, { esegui = haBash } = {}) {
  const problemi = [];
  const reti = nomiLavori(testo).filter((n) => !LAVORI_PIATTAFORMA.includes(n)
    && needsDi(n, testo).some((x) => LAVORI_PIATTAFORMA.includes(x)));
  if (!reti.length) return ['nessun lavoro guarda le metà di piattaforma: un guasto senza feedback resterebbe verde'];
  for (const n of reti) {
    if (/^ {4}continue-on-error:\s*true\s*$/m.test(job(n, testo))) problemi.push(`\`${n}\` è continue-on-error: anche lui lascerebbe la corsa verde`);
    if (!/exit 1/.test(senzaCommenti(job(n, testo)))) problemi.push(`\`${n}\` non fa diventare rossa la corsa`);
  }
  const scatta = (needs) => reti.filter((n) => valutaCondizione(condizioneDi(n, testo), {
    needs: Object.fromEntries(needsDi(n, testo).map((x) => [x, needs[x] || { result: 'skipped', outputs: {} }])),
  }));
  const esiti = esegui ? Object.fromEntries(LAVORI_PIATTAFORMA.map((j) => [j, esitiDelLavoro(j, testo)])) : null;
  for (const j of LAVORI_PIATTAFORMA) {
    const P = PIATTAFORMA_DI[j];
    const altro = LAVORI_PIATTAFORMA.find((x) => x !== j);
    const base = esiti ? { [altro]: { result: 'success', outputs: esiti[altro].riuscito } } : {};
    const prova = (stato, deve, caso) => {
      const accese = scatta({ ...base, [j]: stato });
      if (deve && !accese.length) problemi.push(`${P}: ${caso}, e la corsa resta verde`);
      if (!deve && accese.length) problemi.push(`${P}: ${caso}, e la corsa diventa rossa lo stesso (${accese.join(', ')})`);
    };
    // `continue-on-error` può far leggere «success» anche a un lavoro fallito: la rete non deve fidarsi dell'esito.
    for (const result of ['failure', 'cancelled', 'success']) {
      prova({ result, outputs: {} }, true, `lavoro stroncato prima dell'avviso (esito «${result}»)`);
    }
    if (!esiti) continue;
    if (!esiti[j].avviso) { problemi.push(`${P}: manca il passo che apre il feedback`); continue; }
    prova({ result: 'success', outputs: esiti[j].riuscito }, false, 'lavoro finito bene');
    prova({ result: 'skipped', outputs: {} }, false, 'lavoro che non doveva girare');
    const muto = esiti[j].fallito(false);
    if (!muto.tentativi) problemi.push(`${P}: il passo dell'avviso non chiama lo strumento che lo spedisce`);
    for (const result of ['failure', 'success']) prova({ result, outputs: muto.uscite }, true, `avviso non consegnato (esito «${result}»)`);
    if (muto.tentativi && !muto.riepilogo.trim()) problemi.push(`${P}: avviso non consegnato, e il riepilogo della corsa non lo dice`);
    const aperto = esiti[j].fallito(true);
    for (const result of ['failure', 'success']) prova({ result, outputs: aperto.uscite }, false, `feedback aperto (esito «${result}»)`);
  }
  return problemi;
}

// ─── #733: una meta' di piattaforma che fallisce non tace ────────────────────
// `release-mac` e `release-linux` sono `continue-on-error` perche' un guasto su
// Linux non deve togliere l'aggiornamento a chi sta su Windows. Il prezzo era il
// silenzio: per sei giorni nessuno ha saputo che Filo per Linux non c'era.
describe('una meta\' di piattaforma che fallisce apre un feedback', () => {
  for (const [nomeJob, piattaforma] of [['release-mac', 'Mac'], ['release-linux', 'Linux']]) {
    describe(nomeJob, () => {
      const testo = senzaCommenti(job(nomeJob));
      const elenco = passi(testo);
      // Il passo dell'allarme è quello che parte A GUASTO: lo strumento lo
      // nominano anche il passo che lo mette al riparo e il controllo finale.
      const iAllarme = elenco.findIndex((p) => /release-platform-alarm\.mjs/.test(p.corpo) && /if:\s*failure\(\)/.test(p.corpo));

      test('un guasto qui non toglie la release Windows', () => {
        assert.match(testo, /continue-on-error:\s*true/, 'un problema su una piattaforma non deve fermare le altre');
      });

      test('a guasto apre un feedback, con la stessa credenziale del cancello unit', () => {
        assert.ok(iAllarme > 0, 'manca il passo che a guasto apre il feedback: il rosso resterebbe muto');
        const allarme = elenco[iAllarme];
        assert.match(allarme.corpo, /if:\s*failure\(\)/, 'l\'allarme deve partire da QUALSIASI passo rosso, non solo dall\'ultimo');
        assert.match(allarme.corpo, /secrets\.FILO_BUILD_PASSPHRASE/, 'stessa credenziale del cancello unit e della suite rossa');
        assert.match(allarme.corpo, new RegExp(`PIATTAFORMA: ${piattaforma}`), 'il feedback deve nominare la piattaforma');
        assert.match(allarme.corpo, /VERSIONE: \$\{\{ steps\.bersaglio\.outputs\.versione \}\}/, 'e la versione a cui il lavoro si stava attaccando');
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
        assert.match(controllo.corpo, new RegExp(`release-platform-alarm\\.mjs\"? --attesi ${piattaforma}`),
          'i file attesi si chiedono allo script: qui e nel testo del feedback devono essere gli stessi');
        assert.doesNotMatch(controllo.corpo, /Filo-(Mac|Linux)\./,
          'l\'elenco dei file vive in un posto solo (PIATTAFORME dello script), qui non si ripete');
        assert.match(controllo.corpo, /mancanti=\$\{MANCANTI% \}/, 'i mancanti vanno passati all\'allarme');
        assert.match(controllo.corpo, /if \[ -n "\$MANCANTI" \]/, 'si guardano tutti i file, non si esce al primo che manca');
      });

      // Lo strumento che apre il feedback sta nel codice del progetto, e la
      // copia di lavoro diventa quella della versione a cui ci si attacca.
      test('lo strumento dell\'avviso è al sicuro prima di qualunque passo che possa fallire', () => {
        assert.ok(/actions\/checkout/.test(elenco[0].corpo),
          'il primo passo non preleva il codice: quello che fallisce prima lascia l\'avviso senza lo strumento per partire');
        const riparo = elenco.find((p) => /cp .*release-platform-alarm\.mjs/.test(p.corpo));
        assert.ok(riparo, 'lo strumento dell\'avviso non viene messo al riparo: il prelievo della versione se lo porta via');
        assert.match(riparo.corpo, /runner\.temp/, 'il riparo deve stare fuori dalla copia di lavoro, che il prelievo ripulisce');
        assert.doesNotMatch(elenco[iAllarme].corpo, /node scripts\/release-platform-alarm\.mjs/,
          'l\'avviso usa ancora lo strumento della copia di lavoro: su un tag vecchio non c\'è');
      });
    });
  }

  // L'ultima rete si fa GIRARE (#733.4, #733.6): la condizione del lavoro di rete si valuta con gli esiti di ogni
  // scenario, e il passo dell'avviso si esegue con un invio che fallisce. Letta come forma di una riga restava verde
  // con la rete che guardava solo il Mac, o con un invio che non può fallire seguito da «aperto».
  test('una metà non finita senza feedback fa rossa la corsa, per tutte e due le piattaforme', () => {
    assert.deepEqual(problemiDellaRete(YML), []);
  });

  test('la sentinella della rete diventa rossa se la rete smette di guardare Linux', () => {
    const rete = job('avviso-mancato');
    const soloMac = rete.replace(/needs\.release-linux\./g, 'needs.release-mac.');
    assert.notEqual(soloMac, rete, 'la mutazione «la rete guarda solo il Mac» non si applica più: aggiornala alla rete nuova');
    for (const esegui of haBash ? [false, true] : [false]) {
      assert.ok(problemiDellaRete(YML.replace(rete, () => soloMac), { esegui }).some((x) => /^Linux:/.test(x)),
        'con la rete che guarda solo il Mac la sentinella resta verde: un guasto Linux senza feedback tornerebbe muto');
    }
  });

  test('la sentinella della rete diventa rossa se l\'invio dell\'avviso non può fallire', { skip: !haBash && 'serve bash' }, () => {
    const linux = job('release-linux');
    const sordo = linux.replace(/^( *)if node "\$ALLARME\/release-platform-alarm\.mjs"; then ESITO=aperto; break; fi$/m,
      '$1node "$ALLARME/release-platform-alarm.mjs" || true; ESITO=aperto; break');
    assert.notEqual(sordo, linux, 'la mutazione «invio che non può fallire» non si applica più: aggiornala al passo nuovo');
    assert.ok(problemiDellaRete(YML.replace(linux, () => sordo)).some((x) => /^Linux: avviso non consegnato/.test(x)),
      'con un invio che non può fallire e l\'esito segnato riuscito la sentinella resta verde');
  });
});

// La regola sulla CAUSA, non sulla porta vista: `continue-on-error` su un
// lavoro vuol dire «se questo fallisce, la corsa resta verde». Un lavoro così
// che non apra un feedback è un rosso che nessuno vedrà mai.
test('ogni lavoro che può fallire lasciando la corsa verde apre un feedback', () => {
  for (const testo of [YML, SUITE_YML]) {
    const jobs = testo.slice(testo.search(/^jobs:\s*$/m));
    const nomi = [...jobs.matchAll(/^ {2}([a-z][\w-]*):\s*$/gm)].map((m) => m[1]);
    // `continue-on-error` del LAVORO sta a quattro spazi; quello di un passo a otto.
    const silenziosi = nomi.filter((n) => /^ {4}continue-on-error:\s*true\s*$/m.test(job(n, testo)));
    for (const n of silenziosi) {
      assert.match(senzaCommenti(job(n, testo)), /-alarm\.mjs/,
        `\`${n}\` è continue-on-error: se fallisce la corsa resta verde, quindi DEVE aprire un feedback`);
    }
  }
  const silenziosiRelease = ['release-mac', 'release-linux'].filter((n) => /^ {4}continue-on-error:\s*true\s*$/m.test(job(n)));
  assert.deepEqual(silenziosiRelease, ['release-mac', 'release-linux'],
    'i due lavori di piattaforma devono restare continue-on-error: un guasto lì non toglie la release Windows');
});

// ─── #733: rimettere i file di una piattaforma su una versione gia' uscita ───
// Il feedback dell'allarme manda a quella strada: qui si legge che c'è ancora.
describe('rimettere i file di una piattaforma su una versione già uscita', () => {
  const avvioAMano = YML.slice(0, YML.search(/^jobs:/m));

  test('si chiede a mano, per Mac o per Linux, dicendo a quale versione', () => {
    for (const voce of ['ripubblica_mac', 'ripubblica_linux', 'ripubblica_versione']) {
      assert.match(avvioAMano, new RegExp(`^ {6}${voce}:$`, 'm'),
        `senza la voce \`${voce}\` non c'è modo di riattaccare i file a una versione già uscita`);
    }
  });

  test('il feedback manda a una casella che esiste davvero', () => {
    for (const piattaforma of ['Mac', 'Linux']) {
      assert.ok(YML.includes(casella(piattaforma)),
        `il feedback dice di spuntare «${casella(piattaforma)}», che nel workflow non si chiama così: chi lo legge la cerca e non la trova`);
    }
  });

  test('non sceglie un commit né pubblica una versione nuova: il codice è quello di una versione già provata', () => {
    assert.match(senzaCommenti(job('scegli')), /if:\s*\$\{\{ !inputs\.ripubblica_mac && !inputs\.ripubblica_linux \}\}/,
      'riallegare un file già costruito non deve passare dalla scelta né dalla pubblicazione Windows');
  });

  for (const [nomeJob, piattaforma] of [['release-mac', 'mac'], ['release-linux', 'linux']]) {
    test(`\`${nomeJob}\` parte anche senza la metà Windows, e si attacca alla versione chiesta`, () => {
      const testo = senzaCommenti(job(nomeJob));
      // Sulla strada a mano la metà Windows non gira: senza `!cancelled()`
      // questo lavoro verrebbe saltato insieme a lei e non ripubblicherebbe niente.
      assert.match(testo, /if:\s*\$\{\{ !cancelled\(\)/, 'saltato insieme alla metà Windows, che a mano non gira');
      assert.match(testo, new RegExp(`inputs\\.ripubblica_${piattaforma}`), 'la casella dell\'avvio a mano non fa partire niente');
      assert.match(testo, /needs\.release\.result == 'success'/,
        'sulla strada automatica si parte solo se la metà Windows è andata bene: attaccarsi a una release che non è uscita apre un feedback per niente');
      assert.match(testo, /avvio a mano senza il numero della versione/, 'senza numero il lavoro deve fermarsi, non indovinare');
      assert.match(testo, /CODICE="\$CHIESTA"/, 'a mano si deve ricostruire il codice della versione a cui ci si attacca');
      assert.match(testo, /tr -d '\[:space:\]'/, 'uno spazio incollato per sbaglio nel numero non deve costare un giro a vuoto');
      assert.match(testo, /CHIESTA="v\$\{CHIESTA\}"/, 'la «v» dimenticata davanti al numero non deve costare un giro a vuoto');
      const passiJob = testo.slice(testo.indexOf('    steps:'));
      const occorrenze = (passiJob.match(/needs\.release\.outputs\.version/g) || []).length;
      assert.equal(occorrenze, 1,
        'la versione del lavoro Windows va letta una volta sola, nel passo che la sceglie: negli altri passi sarebbe vuota sulla strada a mano');
    });
  }
});

// ─── #785: la sezione «Verifica» con commit, corsa e SHA-256 di ogni file ───
// Le regole della sezione stanno in tests/unit/releaseImpronte.test.mjs; qui il posto del passo nei tre lavori.
describe('ogni metà scrive le impronte dei suoi file nella pagina della versione', () => {
  const CORSA = /CORSA: \$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}\/actions\/runs\/\$\{\{ github\.run_id \}\}[\s\S]*--corsa "\$CORSA"/;
  // I valori arrivano dall'ambiente: scritti nel comando con ${{ }}, una versione battuta a mano diventerebbe codice.
  const SENZA_ESPRESSIONI_NEL_COMANDO = (corpo) => assert.doesNotMatch(corpo.slice(corpo.indexOf('run: |')).replace(/\$\{\{ runner\.temp \}\}/g, ''), /\$\{\{/);

  test('Windows: dopo il controllo della bozza e prima che diventi pubblica, con lo strumento di questa corsa', () => {
    const r = senzaCommenti(job('release'));
    const elenco = passi(r);
    const iControllo = elenco.findIndex((p) => /I file per Windows sono davvero nella bozza/.test(p.nome));
    const iImpronte = elenco.findIndex((p) => /release-impronte\.mjs"? --piattaforma Windows/.test(p.corpo));
    const iPubblica = elenco.findIndex((p) => /gh release edit[^\n]*--draft=false/.test(p.corpo));
    assert.ok(iImpronte > iControllo && iImpronte < iPubblica,
      'le impronte vanno nella bozza dopo il controllo dei file e prima che diventi pubblica: una versione non esce senza «Verifica»');
    const p = elenco[iImpronte].corpo;
    assert.match(p, /if:\s*steps\.check\.outputs\.should_release == 'true'/);
    assert.match(p, /GH_TOKEN:\s*\$\{\{\s*steps\.app\.outputs\.token\s*\|\|\s*secrets\.GITHUB_TOKEN\s*\}\}/, 'la bozza si scrive con il token che l\'ha creata');
    // Il commit provato può essere più vecchio dello script: lo strumento si prende dal commit di questa corsa.
    assert.match(p, /git show "\$\{GITHUB_SHA\}:scripts\/release-impronte\.mjs" > "\$\{RUNNER_TEMP\}\/release-impronte\.mjs"/);
    assert.doesNotMatch(p, /node scripts\/release-impronte\.mjs/, 'lo strumento della copia di lavoro può non esserci');
    assert.match(p, /VERSIONE: \$\{\{ steps\.bump\.outputs\.version \}\}[\s\S]*--versione "\$VERSIONE"/);
    assert.match(p, /COMMIT: \$\{\{ steps\.applica\.outputs\.sha \}\}[\s\S]*--commit "\$COMMIT"/, 'il commit è quello costruito');
    assert.match(p, CORSA);
    SENZA_ESPRESSIONI_NEL_COMANDO(p);
    assert.match(p, /--cartella dist\b/);
  });

  for (const [nomeJob, piattaforma] of [['release-mac', 'Mac'], ['release-linux', 'Linux']]) {
    test(`${nomeJob}: dopo il controllo dei file e prima dell'allarme, con lo strumento al riparo`, () => {
      const testo = senzaCommenti(job(nomeJob));
      const elenco = passi(testo);
      const trovati = elenco.filter((x) => /release-impronte\.mjs"? --piattaforma/.test(x.corpo));
      assert.equal(trovati.length, 1, 'un passo solo scrive le impronte');
      const p = trovati[0];
      assert.equal(p.id, 'impronte', 'l\'allarme deve poter dire che si è fermato lì');
      const i = elenco.indexOf(p);
      assert.ok(i > elenco.findIndex((x) => x.id === 'controllo'), 'le righe si scrivono solo per file che sono davvero nella release');
      assert.ok(i < elenco.findIndex((x) => x.id === 'allarme'), 'un guasto qui deve aprire il feedback');
      assert.match(p.corpo, new RegExp(`--piattaforma ${piattaforma} --cartella dist\\b`));
      assert.match(p.corpo, /node "\$\{\{ runner\.temp \}\}\/strumenti\/release-impronte\.mjs"/, 'su un tag vecchio lo script della copia di lavoro non c\'è');
      assert.match(elenco.find((x) => x.id === 'riparo').corpo, /cp [^\n]*scripts\/release-impronte\.mjs "\$\{\{ runner\.temp \}\}\/strumenti\/"/);
      assert.match(p.corpo, /VERSIONE: \$\{\{ steps\.bersaglio\.outputs\.versione \}\}[\s\S]*--versione "\$VERSIONE"/);
      SENZA_ESPRESSIONI_NEL_COMANDO(p.corpo);
      assert.match(p.corpo, /--commit "\$\(git rev-parse HEAD\)"/, 'il commit è quello che la guardia ha appena controllato');
      assert.match(p.corpo, CORSA);
      assert.match(p.corpo, /--verifica-dopo \d+/, 'Mac e Linux scrivono in parallelo: senza rilettura uno cancella le righe dell\'altro');
      assert.match(p.corpo, /GH_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
    });
  }
});
