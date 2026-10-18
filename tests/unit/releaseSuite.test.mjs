// La suite completa gira in GitHub a ogni fusione su main (suite.yml); la pubblicazione (release.yml)
// prende il commit più nuovo di main con la suite verde. Qui si legge che i due workflow lo fanno davvero:
// i testi del repo lo promettono, e un pezzo mancante pubblicherebbe senza suite, in silenzio.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const YML = readFileSync(resolve(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
const SUITE_YML = readFileSync(resolve(ROOT, '.github', 'workflows', 'suite.yml'), 'utf8');
const SCEGLI_JS = readFileSync(resolve(ROOT, 'scripts', 'ultima-suite-verde.mjs'), 'utf8');
const { PASSI, casella } = await import('../../scripts/release-platform-alarm.mjs');
const { CHIAVE_FERMO, SOGLIA_ORE, LAVORO_UNIT_WINDOWS } = await import('../../scripts/ultima-suite-verde.mjs');

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

  test('parte a ogni spinta su main, e a mano su qualunque ramo', () => {
    const on = intestazione(SUITE_YML);
    assert.match(on, /^on:\s*\n\s+push:\s*\n\s+branches:\s*\[main\]/m, 'senza la spinta su main nessun commit viene provato');
    assert.match(on, /workflow_dispatch:/, 'senza l\'avvio a mano un ramo non si può provare');
    assert.doesNotMatch(on, /paths(-ignore)?:/, 'ogni fusione va provata: un filtro sui percorsi lascerebbe commit senza verdetto');
    const suitePasso = elenco.find((p) => /npx playwright test/.test(p.corpo));
    assert.doesNotMatch(suitePasso.corpo, /^\s+if:/m, 'la suite gira sempre: nessun controllo «c\'è qualcosa di nuovo»');
  });

  test('una suite partita arriva in fondo; le fusioni arrivate intanto si raccolgono nell\'ultima', () => {
    const on = intestazione(SUITE_YML);
    assert.match(on, /concurrency:\s*\n\s+group:\s*suite-\$\{\{\s*github\.ref\s*\}\}\s*\n\s+cancel-in-progress:\s*false/,
      'annullare una suite a metà butta un\'ora e non dice niente di nessun commit');
  });

  test('prova il commit della spinta, con la storia per elencare i commit dell\'avviso', () => {
    assert.match(suite, /ref:\s*\$\{\{\s*github\.sha\s*\}\}/);
    assert.match(suite, /fetch-depth:\s*0/);
  });

  test('permessi di sola lettura: legge le corse, non scrive niente', () => {
    const on = intestazione(SUITE_YML);
    assert.match(on, /permissions:\s*\n\s+contents:\s*read\s*\n\s+actions:\s*read/);
    assert.doesNotMatch(SUITE_YML, /:\s*write\b/, 'la suite non ha niente da scrivere');
  });

  test('su Linux, con quattro ore di tetto', () => {
    assert.match(suite, /runs-on:\s*ubuntu-latest/, 'la suite gira su Linux, come nel contenitore delle routine');
    assert.match(suite, /timeout-minutes:\s*240/, 'senza tetto un Electron appeso terrebbe il runner per sei ore');
  });

  test('lancia Playwright come nel contenitore senza schermo, col comando scritto intero', () => {
    assert.ok(suite.includes('ELECTRON_DISABLE_SANDBOX=1 PLAYWRIGHT_JSON_OUTPUT_NAME=suite-risultati.json xvfb-run -a npx playwright test --reporter=list,json'),
      'senza sandbox spenta e schermo virtuale Electron non parte; senza il JSON il verdetto non ha niente da leggere');
    assert.match(suite, /apt-get install -y xvfb/, 'xvfb va installato: sul runner non c\'è');
    assert.match(suite, /ensure-electron\.mjs/, 'il binario di Electron va assicurato');
    assert.match(suite, /node scripts\/npm-ci-ritenta\.mjs/, 'le dipendenze si installano con lo script che ritenta un download che non arriva');
  });

  test('il passo della suite ha un tetto suo, sotto quello del job: scaduto, il verdetto e l\'allarme girano lo stesso', () => {
    const passo = elenco.find((p) => /npx playwright test/.test(p.corpo));
    const m = passo.corpo.match(/timeout-minutes:\s*(\d+)/);
    assert.ok(m, 'il passo che lancia Playwright deve avere un timeout-minutes suo');
    assert.ok(Number(m[1]) < 240, 'il tetto del passo deve stare sotto quello del job, o è il job a morire prima del verdetto');
    assert.match(passo.corpo, /continue-on-error:\s*true/, 'l\'uscita di Playwright è rossa anche per i soli rossi noti');
    assert.match(suite, /tetto del passo/, 'l\'allarme deve dire che la suite può essere stata interrotta dal tetto');
  });

  test('il verdetto lo dà suite-verdict.mjs, e scrive le chiavi dell\'allarme', () => {
    assert.match(suite, /node scripts\/suite-verdict\.mjs suite-risultati\.json --out rossi-nuovi\.txt --chiavi chiavi-allarme\.txt/);
    assert.match(suite, /steps\.verdetto\.outcome == 'failure'/, 'l\'allarme deve partire dal verdetto, non dall\'uscita di Playwright');
  });

  test('esito e tracce restano allegati per sette giorni, anche a suite rossa', () => {
    const passo = elenco.find((p) => /upload-artifact/.test(p.corpo));
    assert.ok(passo);
    assert.match(passo.corpo, /actions\/upload-artifact@v4/);
    assert.match(passo.corpo, /retention-days:\s*7/);
    assert.match(passo.corpo, /suite-risultati\.json/);
    assert.match(passo.corpo, /test-results\//, 'senza screenshot e trace dei rossi, chi prende il feedback rilancia un\'ora di suite');
    assert.match(passo.corpo, /if:\s*always\(\)/, 'l\'artifact va caricato anche a suite rossa: è proprio allora che serve');
    assert.match(passo.corpo, /continue-on-error:\s*true/,
      'un caricamento fallito farebbe rossa una suite verde, e l\'allarme la chiamerebbe «suite non partita»');
  });

  describe('un rosso nuovo su main apre un feedback', () => {
    const allarme = elenco.find((p) => /build-alarm\.mjs/.test(p.corpo));

    test('con la stessa credenziale del cancello unit, e solo su main', () => {
      assert.ok(allarme, 'un rosso nuovo deve diventare un feedback, non un silenzio');
      assert.match(allarme.corpo, /secrets\.FILO_BUILD_PASSPHRASE/);
      assert.match(senzaCommenti(job('release')), /secrets\.FILO_BUILD_PASSPHRASE/, 'il cancello unit usa FILO_BUILD_PASSPHRASE');
      assert.match(allarme.corpo, /if:[^\n]*github\.ref == 'refs\/heads\/main'/, 'una prova su un ramo non apre feedback');
      assert.match(allarme.corpo, /if:[^\n]*steps\.verdetto\.outcome == 'failure' \|\| failure\(\)/,
        'anche un passo rosso prima della suite (npm ci, Electron, xvfb) deve diventare un feedback');
      for (const p of elenco.filter((x) => /secrets\./.test(x.corpo))) {
        assert.match(p.corpo, /github\.ref == 'refs\/heads\/main'/, `il passo «${p.nome}» porta una credenziale fuori da main`);
      }
      assert.match(allarme.corpo, /exit 1/, 'a rosso nuovo il job deve uscire rosso');
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
      assert.match(allarme.corpo, /--chiavi-da chiavi-allarme\.txt/);
      assert.match(allarme.corpo, /--chiave suite:non-partita/);
      assert.match(allarme.corpo, /-s chiavi-allarme\.txt/);
    });
  });

  // Il lavoro di pubblicazione sceglie solo corse RIUSCITE: una corsa verde con un
  // rosso nuovo dentro pubblicherebbe proprio quel rosso.
  test('un rosso su un ramo non apre feedback ma lascia la corsa rossa', () => {
    const ramo = elenco.find((p) => /github\.ref != 'refs\/heads\/main'/.test(p.corpo));
    assert.ok(ramo, 'su un ramo un rosso nuovo finirebbe in una corsa verde');
    assert.match(ramo.corpo, /steps\.verdetto\.outcome == 'failure' \|\| failure\(\)/);
    assert.match(ramo.corpo, /exit 1/);
    assert.doesNotMatch(ramo.corpo, /secrets\./);
  });

  test('nessun passo dopo il verdetto può far finire verde una suite rossa', () => {
    assert.doesNotMatch(suite, /^ {4}continue-on-error:\s*true\s*$/m, 'col lavoro continue-on-error la corsa sarebbe verde a suite rossa');
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
    assert.match(lavoro, /fetch-depth:\s*0/, 'l\'avviso elenca i commit dopo l\'ultimo verde');
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

  test('un rosso su main apre un feedback con le chiavi del cancello; su un ramo la corsa resta rossa', () => {
    const allarme = elenco.find((p) => /build-alarm\.mjs/.test(p.corpo));
    assert.ok(allarme, 'un rosso che non diventa un feedback ferma la pubblicazione in silenzio');
    assert.match(allarme.corpo, /if:[^\n]*github\.ref == 'refs\/heads\/main'[^\n]*steps\.unit\.outcome == 'failure' \|\| failure\(\)/,
      'anche un npm ci rosso prima degli unit deve diventare un feedback');
    assert.match(allarme.corpo, /--chiavi-unit unit\.log/, 'le chiavi del cancello: lo stesso rosso visto qui e là apre un feedback solo');
    assert.match(allarme.corpo, /--chiave unit-windows:non-partiti/);
    assert.match(allarme.corpo, /secrets\.FILO_BUILD_PASSPHRASE/);
    assert.match(allarme.corpo, /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
    assert.match(allarme.corpo, /node scripts\/ultima-suite-verde\.mjs --stampa/);
    assert.match(allarme.corpo, /head -80/);
    assert.match(allarme.corpo, /N_TUTTE - 80/);
    assert.match(allarme.corpo, /exit 1/);
    for (const p of elenco.filter((x) => /secrets\./.test(x.corpo))) {
      assert.match(p.corpo, /github\.ref == 'refs\/heads\/main'/, `il passo «${p.nome}» porta una credenziale fuori da main`);
    }
    const ramo = elenco.find((p) => /github\.ref != 'refs\/heads\/main'/.test(p.corpo));
    assert.ok(ramo);
    assert.match(ramo.corpo, /steps\.unit\.outcome == 'failure' \|\| failure\(\)/);
    assert.match(ramo.corpo, /exit 1/);
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

      // Il feedback è l'unica cosa che fa sapere il guasto a qualcuno, perché il
      // lavoro è continue-on-error e la corsa resta verde comunque.
      test('un avviso che non è partito non finisce verde, e lo dice a chi guarda', () => {
        const allarme = elenco[iAllarme];
        assert.doesNotMatch(allarme.corpo, /\|\|\s*echo/,
          'il passo che apre il feedback inghiotte il proprio esito: se il feedback non parte resta verde');
        assert.match(allarme.corpo, /esito=\$\{ESITO\}" >> "\$GITHUB_OUTPUT"/,
          'l\'esito dell\'avviso non esce dal passo: fuori nessuno può sapere che è rimasto muto');
        assert.match(allarme.corpo, /GITHUB_STEP_SUMMARY/, 'chi apre la corsa deve leggere che il feedback non si è aperto');
        assert.match(senzaCommenti(job(nomeJob)), /^ {4}outputs:\s*$[\s\S]{0,120}?allarme: \$\{\{ steps\.allarme\.outputs\.esito \}\}/m,
          'il lavoro non espone se l\'avviso è partito: nessun altro lavoro può accorgersene');
      });
    });
  }

  // Ultima rete. Se l'avviso non è partito, la corsa verde è l'unico posto in
  // cui il guasto poteva ancora vedersi: va fatta diventare rossa.
  test('se l\'avviso non è partito la corsa non resta verde', () => {
    const jobs = YML.slice(YML.search(/^jobs:\s*$/m));
    const nomi = [...jobs.matchAll(/^ {2}([a-z][\w-]*):\s*$/gm)].map((m) => m[1]);
    const rete = nomi.filter((n) => /needs\.release-(mac|linux)\.outputs\.allarme == 'muto'/.test(job(n)));
    assert.ok(rete.length, 'nessun lavoro si accorge di un avviso rimasto muto: il guasto non lo saprebbe nessuno');
    for (const n of rete) {
      assert.doesNotMatch(job(n), /^ {4}continue-on-error:\s*true\s*$/m,
        `\`${n}\` è l'ultimo segnale rimasto: se anche lui lascia la corsa verde non segnala niente`);
      assert.match(job(n), /exit 1/, `\`${n}\` deve far diventare rossa la corsa`);
    }
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
