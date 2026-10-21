// «Cancella tutti i dati di Filo» (#850): l'avvio dopo la richiesta svuota la cartella dei dati tranne ciò che non dice
// niente di chi usa Filo e, se non si sceglie altro, l'identità dei crediti; la parola scritta è il cancello del main.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const C = require(join(ROOT, 'src', 'main', 'cancellaTutto.js'));

const cartelle = [];
const ripristini = [];
afterEach(() => {
  while (ripristini.length) ripristini.pop()();
  while (cartelle.length) togliCartella(cartelle.pop());
});
function sostituisci(obj, nome, fn) {
  const vero = obj[nome];
  obj[nome] = fn(vero);
  ripristini.push(() => { obj[nome] = vero; });
}

// Una cartella dei dati come quella vera: i file di Filo, quelli di Chromium, e uno che non esiste ancora.
const DATI_DI_FILO = [
  'storage.json', 'storage.json.bak', 'storage.json.rovinato-2026-10-01T10-00-00-000Z', 'auth.bin',
  'segreti-letti.bin', 'appunti-tolti.json', 'archivio-schede/2026-10.jsonl', 'cronologia-ai/2026-10.jsonl',
  'segnalazioni-mie/2026-10.jsonl', 'filo/eventi.jsonl', 'filo/dispositivo', 'filo/ricordi.jsonl',
  'documenti/indice.jsonl', 'quarantena/setup.exe', 'accesso-owner-caduto', 'invito-prodotti-google',
  'Cookies', 'Network/Cookies', 'Local Storage/leveldb/000003.log', 'IndexedDB/filo_0.indexeddb.leveldb/LOG',
  'Session Storage/LOG', 'Preferences', 'Custom Dictionary.txt', 'Cache/Cache_Data/index', 'Crashpad/settings.dat',
  'Partitions/filo-priv-google.com/Cookies', 'un-file-che-nascera-domani.json',
];
const IDENTITA = ['identity.bin', 'identity.bin.prev', 'wallet.bin', 'wallet.bin.illeggibile-2026', 'wallet-stato.bin'];
const INFRA = ['Local State', 'Dictionaries/it-IT-3-0.bdic', 'adblock/lists.json', 'firmatari-c2pa/elenco.json',
  'preload-pacchetto/page-preload.js', 'aggiornamento-pronto.json'];

function riempi(segno) {
  const dir = cartellaTemporanea('filo-cancella-');
  cartelle.push(dir);
  for (const f of [...DATI_DI_FILO, ...IDENTITA, ...INFRA]) {
    fs.mkdirSync(dirname(join(dir, f)), { recursive: true });
    fs.writeFileSync(join(dir, f), 'x');
  }
  fs.writeFileSync(join(dir, 'storage.json'), JSON.stringify({
    settings: { theme: 'dark', apiKeysEnc: 'safeStorage:v1:abc' },
    filo_memory: { PROFILO: 'Si chiama Marta' },
    walletUsageQueue: [{ pseudonym: 'abcd', feature: 'chat', costUsd: 0.001 }],
  }));
  if (segno) fs.writeFileSync(join(dir, C.SEGNO), JSON.stringify(segno));
  return dir;
}

// Ciò che c'è ancora, in forma di percorsi relativi ai file.
function restano(dir) {
  const out = [];
  const giro = (sotto) => {
    for (const n of fs.readdirSync(join(dir, sotto))) {
      const rel = sotto ? `${sotto}/${n}` : n;
      if (fs.statSync(join(dir, rel)).isDirectory()) giro(rel);
      else out.push(rel);
    }
  };
  giro('');
  return out.sort();
}

const appFinta = (dir, { lucchetto = true } = {}) => ({
  getPath: (n) => { assert.equal(n, 'userData'); return dir; },
  requestSingleInstanceLock: () => lucchetto,
});

test('senza la scelta, restano solo i file di servizio e l\'identità dei crediti, col suo registro d\'uso', () => {
  const dir = riempi({ ancheIdentita: false });
  const esito = C.allAvvio(appFinta(dir));
  assert.deepEqual(esito.rimasti, []);
  assert.deepEqual(restano(dir), [...IDENTITA, ...INFRA, 'storage.json'].sort());
  // Le righe del registro d'uso ancora da scrivere sono dei crediti: storage.json rinasce con quelle sole.
  assert.deepEqual(JSON.parse(fs.readFileSync(join(dir, 'storage.json'), 'utf8')), {
    walletUsageQueue: [{ pseudonym: 'abcd', feature: 'chat', costUsd: 0.001 }],
  });
});

test('con la scelta se ne va anche l\'identità, e storage.json non rinasce', () => {
  const dir = riempi({ ancheIdentita: true });
  const esito = C.allAvvio(appFinta(dir));
  assert.deepEqual(esito.rimasti, []);
  assert.equal(esito.ancheIdentita, true);
  assert.deepEqual(restano(dir), [...INFRA].sort());
});

test('un file nuovo che nessuno ha messo in elenco se ne va: si tiene per nome, non si cancella per nome', () => {
  const dir = riempi({});
  C.allAvvio(appFinta(dir));
  assert.ok(!fs.existsSync(join(dir, 'un-file-che-nascera-domani.json')));
});

test('senza la richiesta l\'avvio non tocca niente', () => {
  const dir = riempi(null);
  assert.equal(C.allAvvio(appFinta(dir)), null);
  assert.ok(fs.existsSync(join(dir, 'filo', 'eventi.jsonl')));
  assert.ok(fs.existsSync(join(dir, 'storage.json')));
});

test('una seconda copia di Filo che non ha il lucchetto non svuota la cartella della prima', () => {
  const dir = riempi({ ancheIdentita: false });
  assert.equal(C.allAvvio(appFinta(dir, { lucchetto: false })), null);
  assert.ok(fs.existsSync(join(dir, 'filo', 'eventi.jsonl')));
  assert.ok(fs.existsSync(join(dir, C.SEGNO)), 'la richiesta resta per chi ha il lucchetto');
});

test('un file che non si lascia cancellare si dice, e il giro dopo riprova solo quello', () => {
  const dir = riempi({ ancheIdentita: false });
  sostituisci(fs, 'rmSync', (vero) => (p, o) => {
    if (String(p).endsWith('Cookies') && !String(p).includes('Partitions')) { const e = new Error('occupato'); e.code = 'EBUSY'; throw e; }
    return vero(p, o);
  });
  sostituisci(console, 'warn', () => () => {});
  const esito = C.allAvvio(appFinta(dir));
  assert.deepEqual(esito.rimasti, ['Cookies']);
  assert.equal(esito.riprova, true);
  assert.match(C.fraseEsito(esito), /tranne «Cookies» nella cartella dei dati/);
  assert.match(C.fraseEsito(esito), /Riprovo al prossimo avvio\.$/);
  const segno = JSON.parse(fs.readFileSync(join(dir, C.SEGNO), 'utf8'));
  assert.deepEqual(segno.soli, ['Cookies']);
  // Nel frattempo l'utente ha ricominciato: il giro dopo non deve portargli via niente.
  fs.writeFileSync(join(dir, 'storage.json'), JSON.stringify({ filo_memory: { PROFILO: 'nuova' } }));
  ripristini.pop()();
  ripristini.pop()();
  const secondo = C.allAvvio(appFinta(dir));
  assert.deepEqual(secondo.rimasti, []);
  assert.ok(!fs.existsSync(join(dir, 'Cookies')));
  assert.equal(JSON.parse(fs.readFileSync(join(dir, 'storage.json'), 'utf8')).filo_memory.PROFILO, 'nuova');
  assert.ok(!fs.existsSync(join(dir, C.SEGNO)));
});

test('un file bloccato per sempre non tiene la richiesta in vita oltre tre avvii', () => {
  const dir = riempi({ ancheIdentita: false });
  sostituisci(fs, 'rmSync', (vero) => (p, o) => {
    if (String(p).endsWith('Preferences')) { const e = new Error('occupato'); e.code = 'EBUSY'; throw e; }
    return vero(p, o);
  });
  sostituisci(console, 'warn', () => () => {});
  let esito;
  for (let i = 0; i < 3; i++) esito = C.allAvvio(appFinta(dir));
  assert.equal(esito.riprova, false);
  assert.ok(C.fraseEsito(esito).endsWith(`Cancellalo a mano da ${dir}.`), C.fraseEsito(esito));
  assert.ok(!fs.existsSync(join(dir, C.SEGNO)));
});

test('la frase dopo un giro riuscito dice che si riparte da zero', () => {
  assert.match(C.fraseEsito({ rimasti: [], riprova: false }), /Ho cancellato tutti i dati di Filo/);
  assert.equal(C.fraseEsito(null), '');
});

test('il main non parte senza la parola scritta, qualunque cosa mandi la pagina', async () => {
  const dir = cartellaTemporanea('filo-cancella-');
  cartelle.push(dir);
  const chiamate = [];
  sostituisci(C.dip, 'cartella', () => () => dir);
  sostituisci(C.dip, 'riapri', () => () => chiamate.push('riapri'));
  sostituisci(C.dip, 'esci', () => () => chiamate.push('esci'));
  sostituisci(C.dip, 'sessioni', () => () => [{
    clearStorageData: async () => chiamate.push('dati dei siti'),
    clearCache: async () => chiamate.push('cache'),
  }]);
  for (const parola of [undefined, '', '   ', 'confermo', 'conferma tutto', '<b>conferma</b>', 'si']) {
    assert.deepEqual(await C.chiedi({ parola }), { ok: false, error: 'parola' }, String(parola));
  }
  assert.ok(!fs.existsSync(join(dir, C.SEGNO)));
  assert.deepEqual(chiamate, []);
  assert.deepEqual(await C.chiedi({ parola: ' Conferma ', ancheIdentita: 'sì' }), { ok: true });
  const segno = JSON.parse(fs.readFileSync(join(dir, C.SEGNO), 'utf8'));
  assert.equal(segno.ancheIdentita, false, 'solo un true vero cancella l\'identità');
  await new Promise((r) => setTimeout(r, 600));
  assert.deepEqual(chiamate.sort(), ['cache', 'dati dei siti', 'esci', 'riapri']);
  // Un secondo clic mentre Filo si chiude non riscrive la richiesta.
  assert.deepEqual(await C.chiedi({ parola: 'conferma', ancheIdentita: true }), { ok: true, giaChiesto: true });
  assert.equal(JSON.parse(fs.readFileSync(join(dir, C.SEGNO), 'utf8')).ancheIdentita, false);
});

test('ogni cosa che resta ha il suo perché, e nessuna di quelle che parlano di te è fra queste', () => {
  for (const [nome, perche] of Object.entries(C.RESTA)) assert.ok(perche.length > 30, `${nome}: il perché`);
  for (const n of ['storage.json', 'auth.bin', 'segreti-letti.bin', 'appunti-tolti.json', 'archivio-schede', 'cronologia-ai',
    'segnalazioni-mie', 'filo', 'documenti', 'quarantena', 'Partitions', 'Local Storage', 'IndexedDB', 'Cookies', 'Network',
    'Preferences', 'Custom Dictionary.txt', 'Session Storage', 'Crashpad']) {
    assert.ok(!(n in C.RESTA), `${n} contiene dati di chi usa Filo: non si tiene`);
  }
  assert.deepEqual([...C.IDENTITA].sort(), ['identity.bin', 'wallet-stato.bin', 'wallet.bin']);
});

test('ogni file che Filo scrive nella cartella dei dati se ne va, tranne quelli tenuti apposta', () => {
  // Stessa lettura del codice della sentinella sulla privacy: un file nuovo entra qui da sé.
  const trovati = new Set();
  const base = /^(?:[\w.]*getPath\('(?:userData|sessionData)'\)|root|base|cartellaDati\(\))$/;
  const giro = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = join(d, n);
      if (fs.statSync(p).isDirectory()) giro(p);
      else if (n.endsWith('.js')) {
        const s = fs.readFileSync(p, 'utf8');
        if (!/getPath\('(?:userData|sessionData)'\)|FILO_USER_DATA/.test(s)) continue;
        for (const m of s.matchAll(/path\.join\(\s*([^,]+?)\s*,\s*'([^']+)'/g)) if (base.test(m[1].trim())) trovati.add(m[2]);
      }
    }
  };
  giro(join(ROOT, 'src', 'main'));
  assert.ok(trovati.has('storage.json') && trovati.has('identity.bin'), 'la lettura del codice trova i file veri');
  const tenuti = [...trovati].filter((n) => n in C.RESTA || C.IDENTITA.includes(n)).sort();
  assert.deepEqual(tenuti, ['Dictionaries', 'adblock', 'firmatari-c2pa', 'identity.bin', 'preload-pacchetto', 'wallet-stato.bin', 'wallet.bin'],
    'un file nuovo tenuto dopo «Cancella tutto» va deciso qui, col suo perché in RESTA');
});

test('la chat porta al tasto che c\'è: stesso indirizzo nel prompt, nel manifesto e nella pagina', () => {
  const prompt = fs.readFileSync(join(ROOT, 'src', 'shared', 'constants.js'), 'utf8');
  const caps = fs.readFileSync(join(ROOT, 'src', 'shared', 'capabilities.js'), 'utf8');
  const html = fs.readFileSync(join(ROOT, 'src', 'pages', 'security', 'security.html'), 'utf8');
  const js = fs.readFileSync(join(ROOT, 'src', 'pages', 'security', 'security.js'), 'utf8');
  const url = 'filo://security/security.html#cancella-tutto';
  assert.ok(prompt.includes(`NAVIGA con {url: "${url}"`));
  assert.ok(caps.includes(url));
  assert.ok(js.includes("'#cancella-tutto': { tasto: 'sec-wipe-btn', riga: 'sec-wipe-row' }"));
  assert.ok(html.includes('id="sec-wipe-btn"') && html.includes('id="sec-wipe-row"'));
  // Nessuno strumento della chat la fa al posto dell'utente: il canale lo usa solo la pagina Sicurezza.
  const usi = [];
  const giro = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = join(d, n);
      if (fs.statSync(p).isDirectory()) giro(p);
      else if (/\.(js|html)$/.test(n) && fs.readFileSync(p, 'utf8').includes('CANCELLA_TUTTI_I_DATI,')) usi.push(p.slice(ROOT.length + 1).replace(/\\/g, '/'));
    }
  };
  giro(join(ROOT, 'src'));
  assert.deepEqual(usi.sort(), ['src/main/services/handlers/storage.js', 'src/pages/security/security.js']);
});
