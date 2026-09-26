// Sentinella: Filo deve restare disponibile e usabile anche su Linux.
//
// PERCHÉ ESISTE
//   Gemella di macSupport.test.mjs, e per lo stesso motivo. Filo si scrive e si
//   prova su Windows: la versione per Linux esiste solo dentro la
//   pubblicazione automatica, e se qualcuno la smonta — il pacchetto tolto dal
//   build, il nome del file cambiato, il lavoro sparito dal workflow — non se
//   ne accorge nessuno finché un utente Linux clicca "Scarica" e trova un 404.
//
//   Sta in un file suo, non dentro quella del Mac, perché quella dice nel nome
//   di cosa parla: mischiarci Linux renderebbe entrambe più difficili da
//   leggere e da far crescere. La regola è la stessa: una regola nuova per
//   Linux si aggiunge QUI.
//
//   NON prova che l'app funzioni su un Linux desktop (per quello serve un Linux
//   desktop vero): tiene in piedi le condizioni SENZA le quali di sicuro non
//   funziona.
// Pura logica → niente Electron, gira in millisecondi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
// I file che devono stare nella release vivono in un posto solo dal #733:
// il controllo del workflow li chiede a questo script invece di nominarli.
const { PIATTAFORME } = await import('../../scripts/release-platform-alarm.mjs');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

// ── Il pacchetto ────────────────────────────────────────────────────────────

test('il pacchetto per Linux è ancora previsto dalla configurazione di build', () => {
  const linux = pkg.build?.linux;
  assert.ok(linux, 'build.linux sparito dal package.json: nessuno costruirebbe più la versione per Linux');

  const targets = (Array.isArray(linux.target) ? linux.target : [linux.target])
    .map((t) => (typeof t === 'string' ? t : t?.target));
  assert.ok(targets.includes('AppImage'),
    'manca il formato AppImage: è il file che scarica chi ha un Linux, e l\'unico che gira su qualunque distribuzione senza installare niente');
});

test('il file per Linux si chiama sempre allo stesso modo', () => {
  // Il sito ha un collegamento solo (.../releases/latest/download/…) e non sa
  // che numero di versione sia uscito: se il nome porta la versione, quel
  // collegamento risponde 404 il giorno dopo.
  assert.equal(pkg.build.linux.artifactName, 'Filo-Linux.${ext}',
    'il nome del file è cambiato: il collegamento "scarica per Linux" del sito punta a un nome fisso e si romperebbe');
});

test("l'icona per Linux esiste ed è abbastanza grande", () => {
  const iconPath = join(ROOT, pkg.build.linux.icon);
  assert.ok(existsSync(iconPath), `icona per Linux non trovata: ${pkg.build.linux.icon}`);
  // PNG: larghezza e altezza stanno nell'header, a offset 16 e 20.
  const png = readFileSync(iconPath);
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  assert.ok(w >= 256 && h >= 256,
    `l'icona per Linux è ${w}x${h}: sotto 256x256 la costruzione dell'AppImage si rifiuta di partire`);
});

test('esistono i comandi per costruire e pubblicare la versione Linux', () => {
  assert.ok(pkg.scripts['build:linux'], 'manca lo script build:linux');
  assert.ok(pkg.scripts['release:linux'], 'manca lo script release:linux');
  // "Costruisci" deve costruire e basta: su una macchina di CI lo strumento, se
  // non glielo si vieta, cerca da sé un token per pubblicare e muore alla fine.
  assert.match(pkg.scripts['build:linux'], /--publish never/,
    'build:linux può provare a pubblicare da solo su una macchina di CI');
  assert.match(pkg.scripts['release:linux'], /--publish always/,
    'release:linux non pubblica più');
});

test("la finestra di Filo si riconosce nella barra delle applicazioni", () => {
  // Senza `StartupWMClass` la finestra aperta non viene associata all'icona da
  // cui è partita: nella barra compaiono due voci, una col nome giusto e una
  // generica. È il difetto Linux più visibile e costa una riga.
  assert.ok(pkg.build.linux.desktop?.StartupWMClass,
    'sparito StartupWMClass: su Linux la finestra non si aggancia più alla sua icona nella barra');
  assert.ok(pkg.build.linux.category,
    'sparita la categoria: senza, Filo non compare fra le applicazioni del menu di sistema');
});

test("l'invito filo:// arriva a Filo anche su Linux", () => {
  // Su Linux il collegamento passa dal file .desktop dentro l'AppImage, e
  // quella riga `MimeType=x-scheme-handler/filo` la scrive electron-builder
  // SOLO se il protocollo è dichiarato nella ricetta.
  const protocolli = pkg.build?.protocols || [];
  const filo = protocolli.find((p) => Array.isArray(p.schemes) && p.schemes.includes('filo'));
  assert.ok(filo, 'senza build.protocols l\'AppImage non dichiara filo:// e su Linux il link d\'invito non apre Filo');
});

// ── Il doppio clic deve aprire Filo, non un errore che nessuno legge ───────
//
// Chromium, all'avvio, si chiude in una gabbia di sicurezza che vuole un
// permesso del kernel (gli spazi dei nomi utente non privilegiati). Dove quel
// permesso è negato ripiega su `chrome-sandbox`, che dovrebbe appartenere a
// root ed essere setuid: dentro un AppImage quel marchio non può esistere, e
// allora Chromium non parte affatto — «No usable sandbox!», sul terminale, dove
// chi ha fatto doppio clic non lo legge mai. Quel permesso è negato di serie su
// Ubuntu dalla 23.10 in avanti, cioè sulla versione che si scarica oggi.
//
// La voce di menu dentro il pacchetto chiede `--no-sandbox` da sé (lo scrive
// electron-builder), ma vale solo per chi ha integrato l'applicazione: il
// doppio clic passa dal lanciatore interno del pacchetto, che eseguiva il
// programma senza aggiungere niente. Da qui il passo che mette un lanciatore
// al posto del programma. Se sparisce, il doppio clic torna a non aprire
// niente su metà delle macchine Linux, in silenzio.

test('il doppio clic sul pacchetto Linux avvia Filo senza la gabbia di sicurezza', async () => {
  const { writeFileSync, readFileSync: leggi, existsSync: c_e } = await import('node:fs');
  const { cartellaTemporanea } = await import('../helpers/percorsi.mjs');

  const hook = pkg.build?.afterPack;
  assert.ok(hook, 'build.afterPack sparito: nessuno mette più il lanciatore nel pacchetto Linux');
  const { default: afterPack } = require(join(ROOT, hook));

  // Una finta cartella impacchettata: dentro c'è solo il "programma".
  const dove = cartellaTemporanea('filo-linux-lanciatore-');
  writeFileSync(join(dove, 'filo'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  await afterPack({
    electronPlatformName: 'linux',
    appOutDir: dove,
    packager: { executableName: 'filo', appInfo: { productFilename: 'Filo' } },
  });

  assert.ok(c_e(join(dove, 'filo-bin')),
    'il programma vero non è stato spostato: il lanciatore non ha niente da avviare');
  const lanciatore = leggi(join(dove, 'filo'), 'utf8');
  assert.match(lanciatore, /--no-sandbox/,
    'il lanciatore non sa più avviare Filo senza gabbia: su Ubuntu 24.04 il doppio clic non aprirebbe niente');
  assert.match(lanciatore, /filo-bin/, 'il lanciatore non nomina il programma vero');
  // Senza `exec -a` il processo si chiamerebbe «filo-bin» e la finestra non si
  // aggancerebbe più alla sua icona nella barra (StartupWMClass=Filo).
  assert.match(lanciatore, /exec -a/,
    'il lanciatore cambia il nome del processo: la finestra non si aggancia più alla sua icona nella barra');
  // Le tre manopole del kernel che portano a «No usable sandbox!». Filo è un
  // browser: la gabbia si spegne dove il sistema la nega, non dappertutto.
  for (const manopola of ['apparmor_restrict_unprivileged_userns', 'max_user_namespaces', 'unprivileged_userns_clone']) {
    assert.ok(lanciatore.includes(manopola),
      `il lanciatore non guarda più ${manopola}: o spegne la gabbia a chi non serve, o non la spegne a chi serve`);
  }

  // Una seconda passata sulla stessa cartella non deve rifare lo spostamento,
  // altrimenti il lanciatore prenderebbe il posto del programma vero.
  await afterPack({
    electronPlatformName: 'linux',
    appOutDir: dove,
    packager: { executableName: 'filo', appInfo: { productFilename: 'Filo' } },
  });
  assert.equal(leggi(join(dove, 'filo'), 'utf8'), lanciatore, 'la seconda passata ha riscritto il lanciatore');
  assert.match(leggi(join(dove, 'filo-bin'), 'utf8'), /exit 0/, 'la seconda passata ha sovrascritto il programma vero');
});

// Il lanciatore scritto sopra viene ESEGUITO, su questa macchina, e si guarda
// cosa passa davvero al programma. La risposta giusta la calcola il test
// leggendo le stesse manopole: dove il kernel concede gli spazi dei nomi, Filo
// deve partire protetto; dove li nega, deve partire lo stesso.
test('il lanciatore spegne la gabbia solo dove questo sistema la nega', { skip: process.platform === 'win32' && 'il lanciatore è del pacchetto Linux' }, async () => {
  const { writeFileSync, readFileSync: leggi, chmodSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { cartellaTemporanea } = await import('../helpers/percorsi.mjs');

  const { default: afterPack } = require(join(ROOT, pkg.build.afterPack));
  const dove = cartellaTemporanea('filo-linux-avvio-');
  // Il finto programma stampa gli argomenti che gli arrivano.
  writeFileSync(join(dove, 'filo'), '#!/bin/sh\necho "$@"\n', { mode: 0o755 });
  await afterPack({
    electronPlatformName: 'linux',
    appOutDir: dove,
    packager: { executableName: 'filo', appInfo: { productFilename: 'Filo' } },
  });
  chmodSync(join(dove, 'filo'), 0o755);

  const manopola = (p) => { try { return leggi(p, 'utf8').trim(); } catch (_) { return null; } };
  const negata = manopola('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') === '1'
    || manopola('/proc/sys/user/max_user_namespaces') === '0'
    || manopola('/proc/sys/kernel/unprivileged_userns_clone') === '0';

  const uscita = String(execFileSync(join(dove, 'filo'), ['ciao'], { encoding: 'utf8' })).trim();
  assert.ok(uscita.includes('ciao'), 'il lanciatore non passa al programma gli argomenti che ha ricevuto');
  assert.equal(uscita.includes('--no-sandbox'), negata,
    negata
      ? 'qui il kernel nega gli spazi dei nomi e il lanciatore non spegne la gabbia: Filo non si aprirebbe'
      : 'qui il kernel concede gli spazi dei nomi e il lanciatore spegne la gabbia lo stesso: difesa buttata via');

  // La voce di menu del pacchetto chiede `--no-sandbox` sempre, senza guardare
  // niente: chi ha integrato Filo fra le applicazioni passa di lì. Se quella
  // richiesta arrivasse fino a Chromium, su ogni Linux che la gabbia la concede
  // Filo navigherebbe scoperto. La decisione sta in un posto solo.
  const daMenu = String(execFileSync(join(dove, 'filo'), ['--no-sandbox', 'ciao'], { encoding: 'utf8' })).trim();
  assert.ok(daMenu.includes('ciao'), 'il lanciatore perde gli argomenti quando gli arriva anche --no-sandbox');
  assert.equal(daMenu.includes('--no-sandbox'), negata,
    negata
      ? 'aperto dal menu delle applicazioni Filo non parte: la gabbia va spenta anche di lì'
      : 'aperto dal menu delle applicazioni Filo naviga senza gabbia su una macchina che la concede');
});

test('il pacchetto costruito, se c\'è, ha il lanciatore al posto giusto', () => {
  // Quando la build Linux è appena girata (nel contenitore delle routine, o nel
  // lavoro «Verifica build Linux»), si guarda il risultato vero invece della
  // ricetta. Se non c'è, non c'è niente da dire.
  const dentro = join(ROOT, 'dist', 'linux-unpacked');
  if (!existsSync(join(dentro, 'filo'))) return;
  assert.ok(existsSync(join(dentro, 'filo-bin')),
    'nel pacchetto costruito il programma vero non è stato spostato: il lanciatore non c\'è');
  assert.match(readFileSync(join(dentro, 'filo'), 'utf8'), /--no-sandbox/,
    'nel pacchetto costruito il lanciatore non chiede l\'avvio senza gabbia');
});

// ── La pubblicazione automatica ─────────────────────────────────────────────

const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
const linuxJob = () => {
  const i = WORKFLOW.search(/^\s{2}release-linux:/m);
  assert.notEqual(i, -1, 'il lavoro che costruisce la versione Linux è sparito dalla pubblicazione automatica');
  return WORKFLOW.slice(i);
};

test('la pubblicazione automatica costruisce anche la versione per Linux', () => {
  const job = linuxJob();
  assert.match(job, /runs-on:\s*ubuntu-latest/, 'l\'AppImage va costruita su una macchina Linux');
  assert.match(job, /npm run release:linux/, 'la pubblicazione non lancia più la build per Linux');
  // Senza le chiavi incastonate l'app arriva muta: il passo va rifatto anche
  // qui, perché il file generato non viaggia col repo.
  assert.match(job, /bake-default-config\.mjs/,
    'il pacchetto Linux verrebbe costruito senza le chiavi di default: arriverebbe agli utenti muto');
  // Un problema su Linux non deve togliere l'aggiornamento a chi è su Windows.
  assert.match(job, /continue-on-error:\s*true/,
    'un fallimento su Linux farebbe risultare rossa una pubblicazione Windows perfettamente riuscita');
});

test('il pacchetto Linux viene allegato alla release, non solo costruito', () => {
  // Stessa trappola del Mac: lo strumento di pubblicazione, se la release
  // esiste già ed è pubblicata (l'ha appena creata la metà Windows), di suo si
  // limita a un AVVISO e non allega niente — lavoro verde, nessun file.
  const publish = pkg.build?.linux?.publish;
  assert.ok(Array.isArray(publish) && publish.length,
    'build.linux.publish sparito: il pacchetto Linux tornerebbe a seguire le regole della bozza e non verrebbe allegato');
  assert.equal(publish[0].releaseType, 'release',
    'senza releaseType "release" il pacchetto Linux viene costruito e NON allegato, senza errori');

  // E comunque non ci si fida: il lavoro guarda la release vera.
  const job = linuxJob();
  assert.match(job, /gh release view/,
    'manca il controllo finale: senza, un mancato allegato passa inosservato');
  assert.match(job, /release-platform-alarm\.mjs --attesi Linux/,
    'il controllo finale non chiede l\'elenco dei file attesi: senza elenco non guarda niente e resta verde');
  for (const file of ['Filo-Linux.AppImage', 'latest-linux.yml']) {
    assert.ok(PIATTAFORME.Linux.attesi.includes(file), `il controllo finale non cerca ${file}`);
  }
});

// ── Il primo avvio, spiegato dove l'utente è bloccato ──────────────────────
// Due muri certi, tutti e due prima che l'utente abbia visto Filo, quindi
// impossibili da spiegare da dentro l'app. Un file scaricato da un browser
// arriva senza il permesso di essere eseguito: il doppio clic non lo avvia. E
// un AppImage, per montarsi, apre libfuse.so.2, che Ubuntu dalla 22.04,
// Debian 12 e le Fedora recenti non installano più di serie: dove manca, il
// doppio clic muore con un errore che a un utente non dice niente.
//
// È lo stesso caso del Mac senza certificato Apple, dove il foglietto sta
// dentro il disco che l'utente ha appena aperto. Un AppImage è un file solo e
// non ha un "dentro": il foglietto va allegato accanto, con un nome fisso, e
// il sito lo mette vicino al bottone "Scarica per Linux".
const FOGLIETTO = 'Se-Filo-non-si-apre-Linux.txt';

test('il foglietto del primo avvio su Linux esiste e dice le due cose che servono', () => {
  const path = join(ROOT, 'build', FOGLIETTO);
  assert.ok(existsSync(path),
    `sparito ${FOGLIETTO}: chi scarica Filo su Linux resta davanti a un file che non parte, senza sapere perché`);
  const testo = readFileSync(path, 'utf8');
  assert.match(testo, /chmod \+x|Consenti l'esecuzione/,
    'il foglietto non spiega come dare al file il permesso di partire: è il muro che incontrano tutti');
  assert.match(testo, /libfuse/,
    'il foglietto non nomina libfuse2: su Ubuntu 22.04 e successive il doppio clic muore lì');
});

// La terza cosa che su Linux si rompe in silenzio, e che su Windows e Mac non
// si rompe: il link d'invito. La dichiarazione che lega i filo:// a Filo vive
// nella voce di menu DENTRO il pacchetto, e il sistema la legge solo se il
// pacchetto è installato fra le applicazioni. Chi tiene il file singolo e lo
// apre col doppio clic clicca il link e non vede succedere niente. La strada
// che funziona c'è (incollare il link nella pagina Crediti) ma nessuno gliela
// indica nel momento in cui il link gli muore in mano.
test('il foglietto dice cosa fare quando il link d\'invito non apre Filo', () => {
  const testo = readFileSync(join(ROOT, 'build', FOGLIETTO), 'utf8');
  assert.match(testo, /invito/i,
    'il foglietto non nomina l\'invito: su Linux il link non apre Filo e il tester resta fermo lì, senza crediti');
  assert.match(testo, /Crediti/,
    'il foglietto non dice dove si incolla il link d\'invito quando il clic non apre niente');
});

test('il recap degli aggiornamenti dice anche la faccenda del link d\'invito', () => {
  const notes = readFileSync(join(ROOT, 'src', 'shared', 'patchNotes.js'), 'utf8');
  const riga = notes.split('\n').find((r) => /anche per Linux/.test(r)) || '';
  assert.ok(riga, 'la riga del changelog sulla versione Linux è sparita');
  assert.match(riga, /invito/,
    'il changelog racconta la versione Linux senza dire che il link d\'invito non apre Filo da solo');
});

test('il foglietto sale nella release, con un nome fisso che il sito può linkare', () => {
  const job = linuxJob();
  assert.match(job, /gh release upload/,
    'nessuno allega il foglietto alla release: resterebbe un file del repo che l\'utente non vede mai');
  assert.ok(job.includes(FOGLIETTO),
    `il lavoro di pubblicazione non nomina più ${FOGLIETTO}`);
  // Deve stare anche nel controllo finale, altrimenti un allegato mancato
  // passa inosservato esattamente come passerebbe per l'AppImage.
  assert.ok(PIATTAFORME.Linux.attesi.includes(FOGLIETTO),
    'il controllo finale non pretende il foglietto: un giorno non salirebbe e nessuno se ne accorgerebbe');
});

test('il recap degli aggiornamenti non promette un doppio clic che non funziona', () => {
  // La riga del changelog diceva «si apre con un doppio clic»: su un AppImage
  // appena scaricato non è vero, e la prima cosa che l'utente prova è proprio
  // quella.
  const notes = readFileSync(join(ROOT, 'src', 'shared', 'patchNotes.js'), 'utf8');
  for (const riga of notes.split(/\r?\n/)) {
    if (!/Linux/i.test(riga) || !/doppio clic/i.test(riga)) continue;
    assert.ok(/esegu|chmod|libfuse/i.test(riga),
      `il recap promette il doppio clic senza dire cosa fare quando non basta: «${riga.trim().slice(0, 100)}»`);
  }
});

test("l'aggiornamento automatico su Linux ha da dove partire", () => {
  // `latest-linux.yml` è il file che electron-updater legge su Linux: senza,
  // chi ha scaricato l'AppImage resta fermo a quella versione per sempre.
  assert.ok(PIATTAFORME.Linux.attesi.includes('latest-linux.yml') && /--attesi Linux/.test(linuxJob()),
    'nessuno controlla che latest-linux.yml finisca nella release: l\'aggiornamento automatico su Linux resterebbe muto');
});

test('la versione Linux si costruisce dallo stesso codice di quella Windows', () => {
  assert.match(linuxJob(), /ref:\s*\$\{\{\s*needs\.release\.outputs\.sha\s*\}\}/,
    'il lavoro Linux non parte dal commit costruito per Windows: due file con lo stesso numero di versione e dentro codice diverso');
});

test('esiste un modo di provare la build Linux senza bruciare una versione', () => {
  const path = join(ROOT, '.github', 'workflows', 'verifica-linux.yml');
  assert.ok(existsSync(path),
    'sparito il lavoro "Verifica build Linux": l\'unico momento in cui l\'AppImage si costruisce tornerebbe a essere la pubblicazione vera');
  const testo = readFileSync(path, 'utf8');
  assert.match(testo, /npm run build:linux/, 'il lavoro di verifica non costruisce più il pacchetto');
  assert.ok(!/--publish always|release:linux/.test(testo),
    'il lavoro di verifica pubblica: deve costruire e fermarsi');
  assert.match(testo, /linuxSupport\.test\.mjs/,
    'il lavoro di verifica non fa più girare questa sentinella prima di costruire');
});

// Quel lavoro è l'unico che risponde a «col doppio clic si apre ancora?»:
// costruisce il pacchetto, nega la gabbia come fa Ubuntu 24.04 e lo avvia. Se
// non riparte quando si tocca il pezzo che fa aprire Filo, la risposta arriva
// dal tester invece che da qui.
test('il lavoro che apre davvero il pacchetto riparte se si tocca il pezzo che lo fa aprire', () => {
  const osservati = (nome) => {
    const testo = readFileSync(join(ROOT, '.github', 'workflows', nome), 'utf8');
    const dopo = testo.split(/^\s*paths:\s*$/m)[1] || '';
    const fine = dopo.search(/^\S/m);
    const blocco = fine === -1 ? dopo : dopo.slice(0, fine);
    return [...blocco.matchAll(/^\s*-\s*'([^']+)'/gm)].map((m) => m[1]);
  };
  const copre = (percorsi, file) => percorsi.some((p) => {
    if (p === file) return true;
    const stella = p.indexOf('*');
    return stella !== -1 && file.startsWith(p.slice(0, stella));
  });

  const linux = osservati('verifica-linux.yml');
  for (const f of ['scripts/after-pack-linux.js', 'scripts/after-pack.js', 'build/Se-Filo-non-si-apre-Linux.txt']) {
    assert.ok(copre(linux, f), `«Verifica build Linux» non riparte quando cambia ${f}`);
  }
  // Lo smistatore decide anche se la firma locale per Mac viene messa, e senza
  // quella firma sui Mac con chip Apple l'app non si apre.
  assert.ok(copre(osservati('verifica-mac.yml'), 'scripts/after-pack.js'),
    '«Verifica build Mac» non riparte quando cambia lo smistatore che chiama la firma');
});

// ── Un aggiornamento che non si installa non resta un segreto ──────────────
// Su Linux l'aggiornamento riscrive il file .AppImage da cui Filo sta girando:
// riesce se l'app è partita davvero come AppImage e se quel file è scrivibile.
// Se fallisce in silenzio, il tester resta fermo alla prima versione per
// sempre — che è esattamente il motivo per cui la versione Linux esiste.

const { avvisaSeAggiornamentoBloccato } = require(join(ROOT, 'src', 'main', 'updater.js'));

function conPiattaforma(p, fn) {
  const vero = process.platform;
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
  return Promise.resolve(fn()).finally(() => {
    Object.defineProperty(process, 'platform', { value: vero, configurable: true });
  });
}

function memoriaFinta() {
  const scritte = [];
  globalThis.SN_FILO_MEMORY = {
    listNotifications: async () => scritte.slice(),
    addNotification: async (n) => { scritte.unshift({ ...n, dismissed: false }); return n; },
  };
  return scritte;
}

test('su Linux, un aggiornamento che non si installa diventa un avviso leggibile', async () => {
  const scritte = memoriaFinta();
  await conPiattaforma('linux', () => avvisaSeAggiornamentoBloccato('0.2.229'));
  assert.equal(scritte.length, 1, 'nessun avviso: su Linux l\'utente resterebbe fermo senza saperlo');
  const n = scritte[0];
  assert.ok(n.text.includes('0.2.229'), 'l\'avviso non dice quale versione');
  assert.ok(n.text.includes('filo.red'), 'l\'avviso non dice dove prenderla');
  assert.ok(!/Mac/.test(n.text), 'su Linux l\'avviso parla di Mac');
  // Il file nuovo arriva dal browser senza il permesso di essere eseguito,
  // come il primo: se l'avviso non lo dice, l'utente sbatte contro lo stesso
  // muro una seconda volta, e stavolta senza il foglietto del download.
  assert.match(n.text, /esecuzione|esegui/i,
    'l\'avviso dice di sostituire il file ma non di ridargli il permesso di esecuzione: il doppio clic non partirà');
  // Il marcatore serve a noi, non all'utente: non deve finire nel testo.
  assert.ok(!/aggiornamento-linux/.test(n.text), 'un marcatore interno è finito sotto gli occhi dell\'utente');
});

test('su Linux la stessa versione non riempie la colonna di schede uguali', async () => {
  const scritte = memoriaFinta();
  await conPiattaforma('linux', async () => {
    await avvisaSeAggiornamentoBloccato('0.2.229');
    await avvisaSeAggiornamentoBloccato('0.2.229');
    await avvisaSeAggiornamentoBloccato('0.2.229');
  });
  assert.equal(scritte.length, 1, 'ogni riavvio aggiungeva una scheda nuova');
});

test('un avviso già scritto su Mac non ne fa comparire un altro, e viceversa', async () => {
  // I due marcatori restano distinti apposta: una macchina sola ne vede uno
  // solo, e unificarli farebbe ricomparire a chi l'aveva già scartato su Mac
  // lo stesso avviso per la stessa versione.
  const scritte = memoriaFinta();
  await conPiattaforma('darwin', () => avvisaSeAggiornamentoBloccato('0.2.229'));
  await conPiattaforma('linux', () => avvisaSeAggiornamentoBloccato('0.2.229'));
  assert.equal(scritte.length, 2);
  assert.notEqual(scritte[0].action.tipo, scritte[1].action.tipo);
});

// ── La modalità terminale su Linux ─────────────────────────────────────────

const { resolveShell, shellInvocation, defaultShell } = require(join(ROOT, 'src', 'main', 'services', 'terminal.js'));

test('su Linux il terminale non prova ad avviare PowerShell', () => {
  conPiattaforma('linux', () => {
    // Qualunque cosa chieda una preferenza salvata su una macchina Windows,
    // qui deve uscire una shell che esiste davvero.
    for (const chiesta of [undefined, '', 'powershell', 'cmd']) {
      assert.equal(resolveShell(chiesta), 'sh', `su Linux "${chiesta}" deve diventare la shell di sistema`);
    }
    assert.equal(resolveShell('bash'), 'bash', 'chi sceglie Bash deve avere Bash');
    // Il ripiego dei comandi dell'assistente e quello della sessione
    // persistente del terminale devono essere LO STESSO: se divergono, le due
    // strade equivalenti rispondono con due shell diverse.
    assert.equal(defaultShell(), 'sh', 'la shell predefinita fuori da Windows non può essere di Windows');
    assert.equal(resolveShell(defaultShell()), resolveShell(undefined),
      'il ripiego dei comandi dell\'assistente e quello della modalità terminale non coincidono');
    assert.equal(shellInvocation('powershell', 'ls').file, '/bin/sh',
      'su Linux il comando partirebbe con powershell.exe, che lì non esiste');
  });
});

test('la shell scelta vale su TUTTE E DUE le strade: i comandi dell\'assistente e il terminale', () => {
  // Erano due regole diverse: i comandi dell'assistente onoravano "bash", la
  // sessione persistente della dashboard ricadeva sempre su /bin/sh. Risultato:
  // su Linux e Mac la voce "Bash" delle Preferenze non faceva niente, e le due
  // strade equivalenti si comportavano in modo diverso.
  const sorgente = readFileSync(join(ROOT, 'src', 'main', 'services', 'shell.js'), 'utf8');
  assert.match(sorgente, /resolveShell/,
    'la sessione persistente decide da sé quale shell usare invece di chiedere alla regola unica (terminal.js)');
  const ipc = readFileSync(join(ROOT, 'src', 'main', 'ipc.js'), 'utf8');
  assert.match(ipc, /resolveShell\(/,
    'ipc.js confronta la shell CHIESTA invece di quella vera: fuori da Windows la sessione si ricreerebbe a ogni comando, perdendo la cartella');
});

// La prova vera: si apre una sessione e si guarda chi risponde. Solo fuori da
// Windows (là la voce "Bash" significa WSL, che non c'è su ogni macchina).
// NON è logica pura — spawna una shell — ma è deterministico: `/bin/sh` e
// `bash` ci sono su qualunque Linux e su qualunque Mac.
test('chi sceglie Bash ottiene davvero Bash, e chi non sceglie niente la shell di sistema', { skip: process.platform === 'win32' && 'su Windows "bash" vuol dire WSL' }, async () => {
  const { createSession } = require(join(ROOT, 'src', 'main', 'services', 'shell.js'));

  const chiedi = (shell) => new Promise((risolvi, rifiuta) => {
    const sessione = createSession({ shell });
    let uscita = '';
    const stop = setTimeout(() => { try { sessione.kill(); } catch (_) {} rifiuta(new Error('la shell non ha risposto')); }, 15000);
    // `$BASH_VERSION` è vuota in sh e piena in bash: è la shell stessa a dire
    // chi è, invece di fidarsi di quello che abbiamo chiesto noi.
    sessione.exec('echo "sono:${BASH_VERSION:-non-bash}"', {
      onData: ({ chunk }) => { uscita += chunk; },
      onExit: () => { clearTimeout(stop); try { sessione.kill(); } catch (_) {} risolvi({ uscita, shell: sessione.shell }); },
      onError: ({ message }) => { clearTimeout(stop); try { sessione.kill(); } catch (_) {} rifiuta(new Error(message)); },
    });
  });

  const conBash = await chiedi('bash');
  assert.equal(conBash.shell, 'bash', 'la sessione non si è nemmeno accorta della scelta');
  assert.ok(!/sono:non-bash/.test(conBash.uscita),
    `chi ha scelto Bash sta parlando con un'altra shell: ${conBash.uscita.trim()}`);

  const senzaScelta = await chiedi(undefined);
  assert.equal(senzaScelta.shell, 'sh', 'fuori da Windows la shell predefinita deve essere quella di sistema');
});

// ── Il prompt dell'assistente sa cos'è un Linux ─────────────────────────────

test("su Linux l'assistente non propone comandi e percorsi di Windows", () => {
  require(join(ROOT, 'src', 'shared', 'capabilities.js'));
  require(join(ROOT, 'src', 'shared', 'constants.js'));
  const C = globalThis.SN_CONST;

  const linux = C.PROMPTS.filoChatStatic({ capacita: '', sistema: 'linux' });
  assert.ok(linux.includes('Linux'), 'su Linux il prompt non dice che sistema è');
  assert.ok(!linux.includes('C:\\'), 'su Linux il prompt mostra ancora un percorso di Windows come esempio');
  assert.ok(!/PowerShell/i.test(linux), 'su Linux il prompt propone ancora PowerShell');
  assert.ok(linux.includes('/home/'), 'su Linux il prompt non mostra un percorso in stile Linux');
});

// ── Le scorciatoie: su Linux il tasto è Ctrl, come su Windows ──────────────

test('su Linux le scorciatoie si chiamano e funzionano come su Windows', () => {
  require(join(ROOT, 'src', 'shared', 'tasti.js'));
  const T = globalThis.SN_TASTI;

  for (const accel of ['Ctrl+V', 'Ctrl+B', 'Alt+E', 'Alt+1', 'Alt+0']) {
    assert.equal(T.etichetta(accel, 'linux'), accel,
      `su Linux ${accel} non deve diventare un tasto del Mac`);
  }
  // Il salto di scheda resta su Alt, e lo zero resta la decima: su Linux
  // nessuna barra dei menu si prende Ctrl+0, che arriva alla pagina.
  const evento = (mods, code) => ({ ...mods, code });
  assert.equal(T.indiceSaltoScheda(evento({ altKey: true }, 'Digit2'), 'linux'), 1);
  assert.equal(T.indiceSaltoScheda(evento({ altKey: true }, 'Digit0'), 'linux'), 9);
  assert.equal(T.indiceSaltoScheda(evento({ metaKey: true }, 'Digit2'), 'linux'), null);
  assert.equal(T.riservato('Ctrl+0', 'linux'), false,
    'su Linux lo zoom arriva alla pagina: quel tasto non è riservato');
});
