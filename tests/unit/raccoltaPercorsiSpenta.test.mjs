// La raccolta dei percorsi dell'Aiuto è spenta finché il server non ha la
// funzione che li riceve (#897): niente modelli pagati, niente coda, e quello
// che una versione precedente aveva messo in coda si butta senza spedirlo.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'pathsSafety.js'));
require(join(ROOT, 'src', 'shared', 'paths.js'));
require(join(ROOT, 'src', 'shared', 'capabilities.js'));
require(join(ROOT, 'src', 'shared', 'patchNotes.js'));
require(join(ROOT, 'src', 'main', 'services', 'pathsCollector.js'));

const { ACTIONS, STORAGE_KEYS } = globalThis.SN_CONST;
const Collector = globalThis.SN_PATHS_COLLECTOR;
const Paths = globalThis.SN_PATHS;
const { RACCOLTA_ACCESA, RITARDO_MAX_MS } = Collector._internal;
const CHIAVE = STORAGE_KEYS.PATHS_OUTBOX;

const SITO_VERO = 'https://negoziofelice.it/account/ordini';
const SESSIONE = {
  rawUrl: SITO_VERO,
  rawSteps: [{ selector: '[aria-label="Ordini"]', action: 'click' }],
  rawUserMessages: ['dove sono i miei ordini?'],
  success: true,
};

let modelli;
let invii;
let disco;
let fetchVero;
let submitVero;

function invokeAI({ action }) {
  modelli.push(action);
  if (action === ACTIONS.HELP_INTENT_GUESS) return Promise.resolve({ text: 'vedere gli ordini' });
  return Promise.resolve({ text: '{"ok":true}' });
}

function inCoda(id, quando) {
  return {
    id, domain: 'negoziofelice.it', initialUrl: '/account/ordini', intent: 'vedere gli ordini',
    steps: [{ selector: '[aria-label="Ordini"]', action: 'click' }], success: true,
    accodatoIl: quando, nonPrimaDi: quando,
  };
}

beforeEach(() => {
  modelli = [];
  invii = [];
  disco = new Map();
  fetchVero = globalThis.fetch;
  submitVero = Paths.submit;
  globalThis.fetch = async (url) => { invii.push(String(url)); throw new Error('nessuna rete nei test'); };
  Paths.submit = async (doc) => { invii.push(doc); return { id: 'mai' }; };
  globalThis.SN_STORAGE = {
    getRaw: async (k, d) => (disco.has(k) ? disco.get(k) : d),
    setRaw: async (k, v) => { disco.set(k, JSON.parse(JSON.stringify(v))); },
  };
  Collector._reset();
  Collector._setAuto(false);
  Collector._setAccesa(false);
});

afterEach(() => {
  globalThis.fetch = fetchVero;
  Paths.submit = submitVero;
  delete globalThis.SN_STORAGE;
  Collector._reset();
});

test('a raccolta spenta la porta dice no anche per un sito vero: il riquadro «Ha funzionato?» non compare', async () => {
  const r = await Collector.raccoglibile(SITO_VERO);
  assert.equal(r.ok, false);
  assert.match(r.reason, /spenta/);
});

test('un SAVE_PATH arrivato comunque non paga nessun modello e non accoda niente', async () => {
  const r = await Collector.collectAndSave({ session: SESSIONE, invokeAI });
  assert.equal(r.saved, false);
  assert.match(r.reason, /spenta/);
  assert.deepEqual(modelli, [], 'le due chiamate di pulizia si pagano anche per un percorso che non partirà');
  assert.equal(Collector.inCoda(), 0);
  assert.equal(disco.has(CHIAVE), false, 'niente deve finire sul disco');
  assert.deepEqual(invii, []);
});

test('e nemmeno chi accoda direttamente fa entrare qualcosa', async () => {
  const r = await Collector._internal.accoda(inCoda('x', Date.now()));
  assert.equal(r.spenta, true);
  assert.equal(Collector.inCoda(), 0);
});

test('all’avvio la coda rimasta da una versione precedente si butta, senza nessun invio', async () => {
  const ieri = Date.now() - 24 * 60 * 60 * 1000;
  disco.set(CHIAVE, [inCoda('maturo', ieri), inCoda('fresco', Date.now())]);
  Collector.init({ ottieniIdToken: async () => 'token' });
  for (let i = 0; i < 50 && disco.get(CHIAVE).length; i += 1) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(disco.get(CHIAVE), [], 'i percorsi rimasti devono sparire dal disco');
  assert.equal(Collector.inCoda(), 0);
  // e un giro di coda, anche molto dopo, non manda fuori niente
  assert.equal(await Collector.flush({ now: Date.now() + RITARDO_MAX_MS * 2 }), 0);
  assert.deepEqual(invii, [], 'non potrebbero arrivare da nessuna parte: non si prova nemmeno');
});

test('anche un giro di coda chiamato senza avvio butta invece di spedire', async () => {
  disco.set(CHIAVE, [inCoda('maturo', Date.now() - 60_000)]);
  assert.equal(await Collector.flush({ now: Date.now() + RITARDO_MAX_MS * 2 }), 0);
  assert.deepEqual(disco.get(CHIAVE), []);
  assert.deepEqual(invii, []);
});

test('con l’interruttore acceso la stessa coda riparte: è lui che decide, e basta riaccenderlo', async () => {
  Collector._setAccesa(true);
  disco.set(CHIAVE, [inCoda('maturo', Date.now() - 60_000)]);
  Collector.init({ ottieniIdToken: async () => '' });
  assert.equal(await Collector.flush({ now: Date.now() + RITARDO_MAX_MS * 2 }), 0);
  assert.equal(invii.length, 1, 'acceso, il percorso maturo parte');
  assert.equal((await Collector.raccoglibile(SITO_VERO)).ok, true);
  const r = await Collector.collectAndSave({ session: SESSIONE, invokeAI });
  assert.equal(r.saved, true, r.reason);
  assert.deepEqual(modelli, [ACTIONS.HELP_INTENT_GUESS, ACTIONS.HELP_INTENT_JUDGE]);
});

// Finché è spenta, nessun testo promette che i passi aiutano altri utenti, e
// dove se ne parla si dice che non escono dal computer.
const leggi = (p) => readFileSync(join(ROOT, p), 'utf8');
const PROMESSE = /chi user[àa]|aiutano chi|aiuti anche gli altri|avvantaggiat|con le altre installazioni|Serve a tutte le installazioni|Quelle che mandi tu partono|percorso che Filo condivide/i;
const SPENTA = { skip: RACCOLTA_ACCESA ? 'raccolta accesa: i testi tornano a descriverla' : false };

test('nessun testo dell’app promette che i passi aiutano altri utenti', SPENTA, () => {
  for (const f of ['src/content/sidebar.js', 'src/shared/capabilities.js', 'src/shared/patchNotes.js', 'SECURITY.md']) {
    const trovato = leggi(f).match(PROMESSE);
    assert.equal(trovato, null, `${f} promette ancora: «${trovato && trovato[0]}»`);
  }
});

test('il manifesto e le note di versione dicono che i passi restano sul computer', SPENTA, () => {
  const aiuto = globalThis.SN_CAPABILITIES.get('help-sidebar');
  assert.match(`${aiuto.desc} ${aiuto.doesNot}`, /non escono dal tuo computer/);
  // In un blocco qualunque: uscita la versione che la porta, la riga resta lì e sopra se ne apre un altro.
  const righe = globalThis.SN_PATCH_NOTES.NOTES.flatMap((n) => [...(n.features || []), ...(n.fixes || [])]);
  assert.ok(righe.some((r) => /Ha funzionato/.test(r) && /non escono dal computer/.test(r)),
    'chi aggiorna deve sapere che la domanda è sparita, e perché');
});

test('SECURITY.md dice che la raccolta è spenta e cosa manca per riaccenderla', SPENTA, () => {
  const sec = leggi('SECURITY.md');
  const breve = sec.slice(sec.indexOf('## In breve'), sec.indexOf('## 1.'));
  assert.match(breve, /non li raccoglie e non li manda a nessuno/);
  const otto = sec.slice(sec.indexOf('## 8.'), sec.indexOf('## 9.'));
  const inizio = otto.indexOf('**Stato:');
  const stato = otto.slice(inizio, otto.indexOf('\n\n', inizio));
  assert.match(stato, /spenta fino a dopo il lancio/);
  assert.match(stato, /`pathSubmit`/);
  assert.match(stato, /non escono dal\s+computer/);
});
