// Le chiavi che la costruzione incastona nell'eseguibile devono essere quelle
// che l'applicazione legge davvero. Sentinella nata dal secondo giro di
// verifica del #581.
//
// Il caso. La costruzione scriveva nel file generato anche una chiave Gemini.
// L'applicazione non la legge (`default-keys.js` cerca solo openrouter e
// tavily), quindi quella chiave faceva due danni: viaggiava dentro un installer
// che chiunque scarica senza servire a niente, e soprattutto veniva contata dal
// cancello «questa versione ha almeno una chiave?». Bastava lei presente e la
// chiave della ricerca web assente perché la pubblicazione andasse avanti
// dicendo che era tutto a posto, mentre quello che l'applicazione ricavava dal
// file era vuoto: la versione arrivava ai tester senza ricerca web e col primo
// stadio del rilevamento siti pericolosi spento. È esattamente il caso che quel
// cancello esiste per fermare.
//
// La regola che questa sentinella tiene ferma è una sola: se la costruzione
// esce contenta, l'applicazione da quel file ricava almeno una chiave.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RADICE = resolve(__dirname, '..', '..');
const BAKE = join(RADICE, 'scripts', 'bake-default-config.mjs');
// Il percorso vero da cui l'applicazione legge: `default-keys.js` lo compone da
// sé, quindi per provare la catena completa il file va messo lì.
const FILE_VERO = join(RADICE, 'src', 'main', 'config', 'default-keys.generated.json');

// Fa girare la costruzione con un ambiente pulito (niente parola d'ordine: così
// non tocca la rete) più le chiavi passate. Ritorna il codice d'uscita e il file
// scritto, se c'è.
function costruisci(chiavi) {
  const cartella = mkdtempSync(join(tmpdir(), 'filo-bake-'));
  const out = join(cartella, 'generato.json');
  const env = { ...process.env, FILO_BAKE_OUT: out };
  for (const n of ['FILO_BUILD_PASSPHRASE', 'FILO_DEFAULT_OPENROUTER_KEY', 'FILO_DEFAULT_GEMINI_KEY',
    'FILO_DEFAULT_TAVILY_KEY', 'FILO_DEFAULT_SAFEBROWSING_KEY']) delete env[n];
  Object.assign(env, chiavi);

  let uscita = 0;
  try {
    execFileSync(process.execPath, [BAKE], { env, stdio: 'pipe' });
  } catch (e) {
    uscita = typeof e.status === 'number' ? e.status : 1;
  }
  const contenuto = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
  rmSync(cartella, { recursive: true, force: true });
  return { uscita, contenuto };
}

// Quello che l'applicazione ricava da un file generato, passando dal codice
// vero e non da una copia della sua logica.
function cosaLeggeLApplicazione(contenuto) {
  assert.equal(existsSync(FILE_VERO), false,
    'c\'è già un file di chiavi generato: questa prova non deve calpestarlo');
  writeFileSync(FILE_VERO, JSON.stringify(contenuto), 'utf8');
  try {
    const require = createRequire(import.meta.url);
    const percorso = join(RADICE, 'src', 'main', 'config', 'default-keys.js');
    delete require.cache[require.resolve(percorso)];
    const dk = require(percorso);
    return {
      chiavi: dk.getBuildKeys(),
      almenoUna: dk.hasAnyBuildKey(),
      safeBrowsing: dk.getBuildSafeBrowsingKey(),
    };
  } finally {
    rmSync(FILE_VERO, { force: true });
    const require = createRequire(import.meta.url);
    try { delete require.cache[require.resolve(join(RADICE, 'src', 'main', 'config', 'default-keys.js'))]; } catch (_) {}
  }
}

test('se la costruzione esce contenta, l’applicazione ha almeno una chiave', () => {
  const r = costruisci({ FILO_DEFAULT_TAVILY_KEY: 'tav-di-prova' });
  assert.equal(r.uscita, 0, 'con la chiave della ricerca web la costruzione deve passare');
  assert.ok(r.contenuto, 'deve aver scritto il file');

  const letto = cosaLeggeLApplicazione(r.contenuto);
  assert.equal(letto.almenoUna, true,
    'la costruzione è passata ma l\'applicazione non ricava nessuna chiave dal file');
  assert.equal(letto.chiavi.tavily, 'tav-di-prova');
});

test('nessuna chiave incastonata che l’applicazione non legga', () => {
  // Tutte le sorgenti accese insieme: quello che finisce nel file deve essere
  // solo ciò che l'applicazione va poi a cercare. Una chiave in più sarebbe una
  // credenziale dentro un pacchetto pubblico in cambio di niente, e una bugia
  // per il cancello qui sotto.
  const r = costruisci({
    FILO_DEFAULT_TAVILY_KEY: 'tav-di-prova',
    FILO_DEFAULT_GEMINI_KEY: 'gem-di-prova',
    FILO_DEFAULT_OPENROUTER_KEY: 'or-di-prova',
    FILO_DEFAULT_SAFEBROWSING_KEY: 'gsb-di-prova',
  });
  assert.equal(r.uscita, 0);

  const incastonate = Object.keys(r.contenuto.apiKeys || {});
  const letto = cosaLeggeLApplicazione(r.contenuto);
  const lette = Object.keys(letto.chiavi);

  const diPiu = incastonate.filter((k) => !lette.includes(k));
  assert.deepEqual(diPiu, [],
    `chiavi incastonate che l'applicazione non legge mai: ${diPiu.join(', ')}`);

  // La chiave del rilevamento siti pericolosi sta fuori dalla mappa dei
  // provider, ma per la stessa strada: deve arrivare.
  assert.equal(letto.safeBrowsing, 'gsb-di-prova');
});

test('senza la chiave che l’applicazione legge la costruzione si ferma, anche se altre ce ne sono', () => {
  // Il caso del #581: manca la ricerca web, c'è solo una chiave che nessuno
  // legge. Prima la pubblicazione andava avanti contenta.
  const r = costruisci({ FILO_DEFAULT_GEMINI_KEY: 'gem-di-prova' });
  assert.notEqual(r.uscita, 0,
    'senza nessuna chiave leggibile la pubblicazione deve fermarsi');
});

test('senza nessuna chiave da nessuna fonte la costruzione si ferma', () => {
  const r = costruisci({});
  assert.notEqual(r.uscita, 0);
});
