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
  for (const file of ['Filo-Linux.AppImage', 'latest-linux.yml']) {
    assert.ok(job.includes(file), `il controllo finale non cerca ${file}`);
  }
});

test("l'aggiornamento automatico su Linux ha da dove partire", () => {
  // `latest-linux.yml` è il file che electron-updater legge su Linux: senza,
  // chi ha scaricato l'AppImage resta fermo a quella versione per sempre.
  assert.ok(linuxJob().includes('latest-linux.yml'),
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
    assert.equal(defaultShell(), 'bash', 'la shell predefinita fuori da Windows non può essere di Windows');
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
