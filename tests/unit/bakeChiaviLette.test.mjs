// Sentinella: le chiavi che il bake scrive nel file generato sono quelle che l'applicazione ne legge, valore per valore.
// Una chiave scritta e non letta viaggia nell'installer pubblico per niente, e inganna il cancello «almeno una chiave» (#581, secondo giro).
// Quali chiavi possono entrare nell'installer lo decide tests/unit/chiaviNelPacchettoPubblico.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
// La cartella temporanea si chiede sempre a questo aiuto: costruirsela a mano
// significa provare su un percorso che sulla macchina di chi sviluppa Filo non
// esiste (vedi CLAUDE.md § Run / test), e una sentinella lo impedisce.
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

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
  const cartella = cartellaTemporanea('filo-bake-');
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
  togliCartella(cartella);
  return { uscita, contenuto };
}

// Quello che l'applicazione ricava da un file generato, passando dal codice
// vero e non da una copia della sua logica.
function cosaLeggeLApplicazione(contenuto) {
  assert.equal(existsSync(FILE_VERO), false,
    'c\'è già un file di chiavi generato: questa prova non deve calpestarlo');
  writeFileSync(FILE_VERO, JSON.stringify(contenuto), 'utf8');
  // Un FILO_DEFAULT_* nell'ambiente di chi lancia la prova si spaccerebbe per una chiave letta dal file.
  const ambiente = Object.entries(process.env).filter(([n]) => n.startsWith('FILO_DEFAULT_'));
  for (const [n] of ambiente) delete process.env[n];
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
    for (const [n, v] of ambiente) process.env[n] = v;
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

  const letto = cosaLeggeLApplicazione(r.contenuto);
  // Per valore e non per nome: OpenRouter fra le chiavi lette c'è ancora, ma solo dall'ambiente di sviluppo.
  const diPiu = Object.entries(r.contenuto.apiKeys || {})
    .filter(([k, v]) => typeof v === 'string' && v.trim() && letto.chiavi[k] !== v.trim())
    .map(([k]) => k);
  assert.deepEqual(diPiu, [],
    `chiavi incastonate che l'applicazione non legge dal file: ${diPiu.join(', ')}`);

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
