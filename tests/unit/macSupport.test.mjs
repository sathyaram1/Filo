// Sentinella: Filo deve restare disponibile e usabile anche su Mac.
//
// PERCHÉ ESISTE
//   Filo si sviluppa su Windows: chi ci lavora non vede mai un Mac, e le cose
//   che valgono solo per Windows entrano nel codice senza che nessuno se ne
//   accorga — finché un utente Mac scarica un file che non esiste, o preme una
//   scorciatoia che non risponde. Questo test è l'unico controllo che sta
//   sempre acceso: se qualcuno smonta il pacchetto per Mac o scrive una
//   scorciatoia solo-Windows, diventa rosso subito, sulla macchina di chi ha
//   scritto la modifica.
//
//   NON prova che l'app funzioni su Mac (per quello serve un Mac vero): tiene
//   in piedi le condizioni SENZA le quali di sicuro non funziona.
// Pura logica → niente Electron, gira in millisecondi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

// ── Il pacchetto ────────────────────────────────────────────────────────────

test('il pacchetto per Mac è ancora previsto dalla configurazione di build', () => {
  const mac = pkg.build?.mac;
  assert.ok(mac, 'build.mac sparito dal package.json: nessuno costruirebbe più la versione per Mac');

  const targets = (Array.isArray(mac.target) ? mac.target : [mac.target])
    .map((t) => (typeof t === 'string' ? t : t?.target));
  assert.ok(targets.includes('dmg'), 'manca il formato dmg: è il file che scarica chi ha un Mac');
  assert.ok(targets.includes('zip'), 'manca il formato zip: senza, gli aggiornamenti automatici su Mac non hanno da dove partire');

  assert.equal(mac.artifactName, 'Filo-Mac.${ext}',
    'il nome del file è cambiato: il collegamento "scarica per Mac" del sito punta a un nome fisso e si romperebbe');
});

test('il pacchetto per Mac vale su ENTRAMBI i processori', () => {
  // Un Mac su due è Apple Silicon, l'altro è Intel. Un pacchetto per un solo
  // processore lascia fuori metà degli utenti — e il sito ha un link solo.
  const targets = pkg.build.mac.target;
  assert.ok(Array.isArray(targets), 'i formati vanno dichiarati con le architetture');
  for (const t of targets) {
    assert.ok(Array.isArray(t.arch) && t.arch.includes('universal'),
      `il formato ${t.target} non è universale: escluderebbe metà dei Mac`);
  }
});

test('esistono i comandi per costruire e pubblicare la versione Mac', () => {
  assert.ok(pkg.scripts['build:mac'], 'manca lo script build:mac');
  assert.ok(pkg.scripts['release:mac'], 'manca lo script release:mac');
});

test("l'icona per Mac esiste ed è abbastanza grande", () => {
  const iconPath = join(ROOT, pkg.build.mac.icon);
  assert.ok(existsSync(iconPath), `icona per Mac non trovata: ${pkg.build.mac.icon}`);
  // PNG: larghezza e altezza stanno nell'header, a offset 16 e 20.
  const png = readFileSync(iconPath);
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  assert.ok(w >= 512 && h >= 512,
    `l'icona per Mac è ${w}x${h}: sotto 512x512 la costruzione del pacchetto si rifiuta di partire`);
});

test('la firma locale dell\'app Mac è ancora agganciata al build', () => {
  const hook = pkg.build?.afterPack;
  assert.ok(hook, 'build.afterPack sparito: senza firma locale l\'app non parte sui Mac con chip Apple');
  assert.ok(existsSync(join(ROOT, hook)), `il passo di firma non esiste più: ${hook}`);
});

test('la firma NON tocca le due copie intermedie della build universale', () => {
  // Il pacchetto universale nasce da due copie (Intel e Apple Silicon) che
  // vengono poi fuse. La fusione pretende che i file non eseguibili delle due
  // copie siano IDENTICI: una firma li rende diversi e la costruzione muore con
  // "Expected all non-binary files to have identical SHAs". Senza questa
  // guardia il pacchetto per Mac non si costruisce affatto.
  const { default: afterPack } = require(join(ROOT, pkg.build.afterPack));

  const contesto = (appOutDir) => ({
    electronPlatformName: 'darwin',
    appOutDir,
    packager: { appInfo: { productFilename: 'Filo' } },
  });

  // Copia intermedia → non deve nemmeno provare a firmare (qui `codesign` non
  // esiste: se ci provasse, questa chiamata esploderebbe).
  return Promise.all([
    afterPack(contesto('/tmp/filo-non-esiste/mac-universal--x64-temp')),
    afterPack(contesto('/tmp/filo-non-esiste/mac-universal--arm64-temp')),
    // Un sistema che non è Mac non passa mai di qui.
    afterPack({ ...contesto('/tmp/filo-non-esiste/win-unpacked'), electronPlatformName: 'win32' }),
    // Il pacchetto finale invece la firma la prova davvero: qui fallisce (non
    // c'è né codesign né l'app), ed è proprio la prova che ci ha provato.
    assert.rejects(() => afterPack(contesto('/tmp/filo-non-esiste/mac-universal')),
      'il pacchetto finale deve essere firmato'),
  ]);
});

// ── La pubblicazione automatica ─────────────────────────────────────────────

const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

test('la pubblicazione automatica costruisce anche la versione per Mac', () => {
  assert.match(WORKFLOW, /^\s{2}release-mac:/m, 'il lavoro che costruisce la versione Mac è sparito dalla pubblicazione automatica');
  assert.match(WORKFLOW, /runs-on:\s*macos-latest/, 'la versione per Mac va costruita su una macchina Apple');
  assert.match(WORKFLOW, /npm run release:mac/, 'la pubblicazione non lancia più la build per Mac');
  // Senza le chiavi incastonate l'app arriva muta: il passo va rifatto anche qui,
  // perché il file generato non viaggia col repo.
  const macJob = WORKFLOW.slice(WORKFLOW.search(/^\s{2}release-mac:/m));
  assert.match(macJob, /bake-default-config\.mjs/,
    'il pacchetto Mac verrebbe costruito senza le chiavi di default: arriverebbe agli utenti muto');
});

test('il pacchetto Mac viene allegato alla release, non solo costruito', () => {
  // Trappola vera, e silenziosa: lo strumento di pubblicazione, se la release
  // esiste già ed è pubblicata (l'ha appena creata la metà Windows), di suo si
  // limita a un AVVISO e non allega niente — lavoro verde, nessun file. Serve
  // dirgli esplicitamente che sta pubblicando su una release, non su una bozza.
  const publish = pkg.build?.mac?.publish;
  assert.ok(Array.isArray(publish) && publish.length,
    'build.mac.publish sparito: il pacchetto Mac tornerebbe a seguire le regole della bozza e non verrebbe allegato');
  assert.equal(publish[0].releaseType, 'release',
    'senza releaseType "release" il pacchetto Mac viene costruito e NON allegato, senza errori');

  // E comunque non ci si fida: il lavoro guarda la release vera e diventa rosso
  // se i file non ci sono.
  const macJob = WORKFLOW.slice(WORKFLOW.search(/^\s{2}release-mac:/m));
  assert.match(macJob, /gh release view/,
    'manca il controllo finale: senza, un mancato allegato passa inosservato');
  for (const file of ['Filo-Mac.dmg', 'Filo-Mac.zip', 'latest-mac.yml']) {
    assert.ok(macJob.includes(file), `il controllo finale non cerca ${file}`);
  }
});

test('la versione Mac si costruisce dallo stesso codice di quella Windows', () => {
  const macJob = WORKFLOW.slice(WORKFLOW.search(/^\s{2}release-mac:/m));
  assert.match(macJob, /ref:\s*\$\{\{\s*needs\.release\.outputs\.sha\s*\}\}/,
    'il lavoro Mac non parte dal commit costruito per Windows: due file con lo stesso numero di versione e dentro codice diverso');
});

// ── Sentinella sul codice: le scorciatoie devono valere anche su Mac ────────
// Su Mac il tasto delle scorciatoie è Cmd, non Ctrl. Un controllo che guarda
// solo `ctrlKey` funziona su Windows e tace su Mac — è il modo più comune di
// rompere Filo sui Mac senza accorgersene.

function stripComments(src) {
  let out = '';
  let inBlock = false;
  for (const line of src.split('\n')) {
    let l = line;
    if (inBlock) {
      const end = l.indexOf('*/');
      if (end < 0) { out += '\n'; continue; }
      l = l.slice(end + 2);
      inBlock = false;
    }
    const block = l.indexOf('/*');
    if (block >= 0) {
      const end = l.indexOf('*/', block + 2);
      if (end < 0) { l = l.slice(0, block); inBlock = true; }
      else l = l.slice(0, block) + l.slice(end + 2);
    }
    const line2 = l.indexOf('//');
    if (line2 >= 0) l = l.slice(0, line2);
    out += l + '\n';
  }
  return out;
}

function jsFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) jsFiles(p, acc);
    else if (name.endsWith('.js') || name.endsWith('.mjs')) acc.push(p);
  }
  return acc;
}

test('nessuna scorciatoia guarda solo il tasto di Windows', () => {
  const colpevoli = [];
  for (const file of jsFiles(join(ROOT, 'src'))) {
    const code = stripComments(readFileSync(file, 'utf8'));
    code.split('\n').forEach((line, i) => {
      if (!/ctrlKey/.test(line)) return;
      if (/metaKey/.test(line)) return;
      colpevoli.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(colpevoli, [],
    'queste righe reagiscono a Ctrl ma non a Cmd: su Mac la scorciatoia non risponde.\n' + colpevoli.join('\n'));
});

test('le scorciatoie globali non rubano il tasto degli accenti su Mac', () => {
  // Alt+E/T/S/H sono scorciatoie di SISTEMA: valgono ovunque, non solo dentro
  // Filo. Su Mac Alt è il tasto Opzione, che serve a comporre gli accenti
  // (Opzione+E → é): registrarlo così toglierebbe l'accento acuto a chi scrive
  // in italiano, in qualunque programma, finché Filo è acceso.
  const src = stripComments(readFileSync(join(ROOT, 'src', 'main', 'shortcuts.js'), 'utf8'));
  assert.match(src, /darwin/,
    'shortcuts.js non distingue più il Mac: le scorciatoie globali tornerebbero a essere Opzione+lettera');
  const { acceleratorePerPiattaforma, COMMANDS } = require(join(ROOT, 'src', 'main', 'shortcuts.js'));
  const vero = process.platform;
  try {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    for (const accel of Object.keys(COMMANDS)) {
      assert.notEqual(acceleratorePerPiattaforma(accel), accel,
        `su Mac ${accel} resta Opzione+lettera: mangia gli accenti in tutto il sistema`);
    }
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    for (const accel of Object.keys(COMMANDS)) {
      assert.equal(acceleratorePerPiattaforma(accel), accel, `su Windows ${accel} non deve cambiare`);
    }
  } finally {
    Object.defineProperty(process, 'platform', { value: vero, configurable: true });
  }
});

// Un percorso di Windows scritto a mano è giusto SOLO dentro il ramo Windows di
// una tabella che conosce anche gli altri sistemi. Le eccezioni stanno qui, con
// il motivo, e restano valide solo finché quel file continua a distinguere i
// sistemi: se qualcuno toglie il ramo Mac, l'eccezione decade e il test torna
// rosso.
const PERCORSI_WINDOWS_LEGITTIMI = {
  'src/shared/constants.js':
    'tabella SISTEMI: è l\'esempio di percorso che il prompt mostra al modello QUANDO gira su Windows',
};

test('nessun percorso di Windows scritto a mano nel codice', () => {
  const colpevoli = [];
  for (const file of jsFiles(join(ROOT, 'src'))) {
    const rel = relative(ROOT, file).split('\\').join('/');
    const testo = readFileSync(file, 'utf8');
    const code = stripComments(testo);
    code.split('\n').forEach((line, i) => {
      // %APPDATA% o una lettera di unità: su Mac non esistono.
      if (!/process\.env\.APPDATA|%APPDATA%|['"][A-Z]:\\/.test(line)) return;
      if (PERCORSI_WINDOWS_LEGITTIMI[rel] && /darwin/.test(testo)) return;
      colpevoli.push(`${rel}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(colpevoli, [],
    'questi percorsi esistono solo su Windows (usa le cartelle di sistema che Electron ricava da sé):\n' + colpevoli.join('\n'));
});

test('le eccezioni sui percorsi Windows non sono avanzi', () => {
  // Un\'eccezione che non serve più è peggio di nessuna eccezione: copre
  // silenziosamente il prossimo errore vero nello stesso file.
  for (const [rel, motivo] of Object.entries(PERCORSI_WINDOWS_LEGITTIMI)) {
    const file = join(ROOT, rel);
    assert.ok(existsSync(file), `eccezione su un file che non esiste più: ${rel} (${motivo})`);
    const testo = readFileSync(file, 'utf8');
    assert.match(testo, /darwin/,
      `${rel} non distingue più i sistemi: l'eccezione "${motivo}" non vale più`);
    assert.match(stripComments(testo), /['"][A-Z]:\\/,
      `${rel} non contiene più nessun percorso Windows: togli l'eccezione`);
  }
});

// ── Il prompt dell'assistente deve sapere su che sistema gira ───────────────

test('l\'assistente sa su che computer sta girando', () => {
  require(join(ROOT, 'src', 'shared', 'capabilities.js'));
  require(join(ROOT, 'src', 'shared', 'constants.js'));
  const C = globalThis.SN_CONST;

  const mac = C.PROMPTS.filoChatStatic({ capacita: '', sistema: 'darwin' });
  const win = C.PROMPTS.filoChatStatic({ capacita: '', sistema: 'win32' });

  assert.ok(mac.includes('macOS'), 'su Mac il prompt non dice che sistema è');
  assert.ok(!mac.includes('C:\\'), 'su Mac il prompt mostra ancora un percorso di Windows come esempio');
  assert.ok(!/PowerShell/i.test(mac), 'su Mac il prompt propone ancora PowerShell');
  assert.ok(mac.includes('/Users/'), 'su Mac il prompt non mostra un percorso in stile Mac');

  assert.ok(win.includes('Windows'), 'su Windows il prompt non dice che sistema è');
  assert.ok(win.includes('C:\\'), 'su Windows l\'esempio di percorso è sparito');

  // Un `platform` sconosciuto non deve lasciare il modello senza istruzioni.
  const ignoto = C.PROMPTS.filoChatStatic({ capacita: '', sistema: 'plan9' });
  assert.ok(ignoto.includes("IL COMPUTER DELL'UTENTE"), 'un sistema sconosciuto lascia il prompt monco');
});

test('il sistema arriva al prompt dal main process', () => {
  // Il valore lo sa solo il main (`process.platform`): la pagina che manda il
  // payload non ha `process`. Se questo passaggio salta, il prompt ricade sul
  // ripiego Windows e su un Mac l\'assistente torna a proporre `C:\\`.
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'handlers.js'), 'utf8');
  assert.match(src, /sistema:\s*process\.platform/,
    'handlers.js non passa più il sistema al prompt della chat');
});
