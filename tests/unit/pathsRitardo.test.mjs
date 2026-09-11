// La coda che stacca l'orologio dai percorsi condivisi (#584, secondo giro).
//
// PERCHÉ ESISTE. Togliere il `clientId` dal documento non bastava. Firestore
// scrive da sé su ogni documento l'ora in cui l'ha ricevuto, al microsecondo, e
// la rimanda a chiunque legga: l'app non può né scriverla né toglierla. Finché
// un percorso partiva nell'istante in cui lo facevi, due percorsi salvati su
// due domini diversi a meno di un secondo l'uno dall'altro erano della stessa
// persona nella stessa sessione. Era la stessa ricucitura di prima, fatta
// dall'orologio invece che da un codice.
//
// Quindi un percorso entra in una coda e ne esce più tardi, a un'ora
// sorteggiata, uno alla volta. Qui si tiene ferma quella promessa.
//
// Senza il fix questi test sono ROSSI: `collectAndSave` scriveva subito, e la
// prima asserzione (niente richieste nell'istante della raccolta) cade.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'paths.js'));
require(join(ROOT, 'src', 'main', 'services', 'pathsCollector.js'));

const { ACTIONS } = globalThis.SN_CONST;
const Collector = globalThis.SN_PATHS_COLLECTOR;
const { RITARDO_MIN_MS, RITARDO_MAX_MS } = Collector._internal;

let scritture = [];
let fetchOrig;

function invokeAIFinto(intento) {
  return async ({ action }) => {
    if (action === ACTIONS.HELP_INTENT_GUESS) return { text: intento };
    if (action === ACTIONS.HELP_INTENT_JUDGE) return { text: '{"ok":true}' };
    return { text: '' };
  };
}

function sessione(url, intento) {
  return {
    rawUrl: url,
    rawSteps: [{ selector: '#x', action: 'click' }],
    rawUserMessages: [intento],
    success: true,
  };
}

async function raccogli(url, intento) {
  const r = await Collector.collectAndSave({
    session: sessione(url, intento), invokeAI: invokeAIFinto(intento),
  });
  assert.equal(r.saved, true, r.reason);
  return r;
}

beforeEach(() => {
  scritture = [];
  fetchOrig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    scritture.push({ url: String(url), body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ name: 'a/b/c/xyz' }), text: async () => '{}' };
  };
  Collector._reset();
  Collector._setAuto(false);   // niente timer veri nei test
});

afterEach(() => { globalThis.fetch = fetchOrig; Collector._reset(); });

test('un percorso non parte nell’istante in cui lo fai: resta in coda', async () => {
  await raccogli('https://banca-esempio.it/conto', 'controllare il saldo');
  assert.equal(scritture.length, 0, 'la scrittura immediata è proprio la chiave di join da togliere');
  assert.equal(Collector.inCoda(), 1);

  // e nemmeno subito dopo: un giro di coda adesso non manda fuori niente
  await Collector.flush({ now: Date.now() });
  assert.equal(scritture.length, 0);
  assert.equal(Collector.inCoda(), 1);
});

test('il ritardo è sorteggiato dentro una finestra dichiarata, non fisso', async () => {
  const attese = [];
  for (const sorte of [0, 0.25, 0.5, 0.75, 1]) {
    Collector._reset();
    Collector._setAuto(false);
    Collector._setSorteggio(() => sorte);
    const prima = Date.now();
    await raccogli('https://esempio.it/x', 'una cosa');
    const [voce] = Collector._peek();
    attese.push(voce.nonPrimaDi - prima);
  }
  for (const a of attese) {
    assert.ok(a >= RITARDO_MIN_MS - 1000 && a <= RITARDO_MAX_MS + 1000, `ritardo fuori finestra: ${a}ms`);
  }
  assert.ok(new Set(attese).size > 1, 'un ritardo sempre uguale sarebbe di nuovo un orario');
  assert.ok(RITARDO_MIN_MS >= 30 * 60 * 1000, 'meno di mezz’ora non stacca niente');
  assert.ok(RITARDO_MAX_MS >= 12 * 60 * 60 * 1000, 'la finestra deve essere larga ore, non minuti');
});

test('due percorsi della stessa sessione non escono insieme, nemmeno dopo che l’app è stata chiusa a lungo', async () => {
  await raccogli('https://banca-esempio.it/conto', 'controllare il saldo');
  await raccogli('https://clinica-esempio.it/prenota', 'prenotare una visita');
  assert.equal(Collector.inCoda(), 2);

  // L'app è rimasta chiusa una settimana: entrambi sono maturi da un pezzo.
  const fraUnaSettimana = Date.now() + 7 * 24 * 60 * 60 * 1000;
  await Collector.flush({ now: fraUnaSettimana });
  assert.equal(scritture.length, 1,
    'svuotare la coda tutta insieme rimetterebbe i percorsi della sessione a millisecondi l’uno dall’altro');
  assert.equal(Collector.inCoda(), 1);

  await Collector.flush({ now: fraUnaSettimana });
  assert.equal(scritture.length, 2);
  assert.equal(Collector.inCoda(), 0);

  // e i due sono finiti su domini diversi, come devono
  const domini = scritture.map((s) => s.url.match(/\/paths\/([^/]+)\/entries/)[1]).sort();
  assert.deepEqual(domini, ['banca-esempio.it', 'clinica-esempio.it']);
});

test('l’ordine di uscita non rifà l’ordine della sessione', async () => {
  // col sorteggio fermo sull'ultimo dei maturi esce il secondo per primo:
  // basta a provare che la scelta non è "il più vecchio".
  Collector._setSorteggio(() => 0.999);
  await raccogli('https://primo-esempio.it/a', 'prima cosa');
  await raccogli('https://secondo-esempio.it/b', 'seconda cosa');
  await Collector.flush({ now: Date.now() + RITARDO_MAX_MS + 1000 });
  assert.equal(scritture.length, 1);
  assert.match(scritture[0].url, /secondo-esempio\.it/);
});

test('nel documento che parte non c’è nessuna ora: solo il giorno', async () => {
  await raccogli('https://esempio.it/x', 'una cosa');
  await Collector.flush({ now: Date.parse('2026-09-11T17:33:41.512Z') + RITARDO_MAX_MS });
  assert.equal(scritture.length, 1);
  const { createdAt } = scritture[0].body.fields;
  assert.match(createdAt.timestampValue, /T00:00:00\.000Z$/,
    'un’ora nel documento sarebbe la chiave di join che la coda serve a togliere');
});

test('se la rete manca il percorso resta in coda e riparte dopo', async () => {
  await raccogli('https://esempio.it/x', 'una cosa');
  globalThis.fetch = async () => { throw new Error('offline'); };
  await Collector.flush({ now: Date.now() + RITARDO_MAX_MS + 1000 });
  assert.equal(Collector.inCoda(), 1, 'un percorso perso perché mancava la rete è un percorso perso');

  globalThis.fetch = async (url, opts) => {
    scritture.push({ url: String(url), body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ name: 'a/b/c/xyz' }), text: async () => '{}' };
  };
  await Collector.flush({ now: Date.now() + RITARDO_MAX_MS + 2000 });
  assert.equal(scritture.length, 1);
  assert.equal(Collector.inCoda(), 0);
});

test('un percorso vecchio di più di un mese si butta invece di spedirlo', async () => {
  await raccogli('https://esempio.it/x', 'una cosa');
  await Collector.flush({ now: Date.now() + 40 * 24 * 60 * 60 * 1000 });
  assert.equal(scritture.length, 0);
  assert.equal(Collector.inCoda(), 0);
});

test('la coda sopravvive alla chiusura dell’app: quello che c’era sul disco riparte', async () => {
  const disco = new Map();
  globalThis.SN_STORAGE = {
    getRaw: async (k, d) => (disco.has(k) ? disco.get(k) : d),
    setRaw: async (k, v) => { disco.set(k, JSON.parse(JSON.stringify(v))); },
  };
  try {
    await raccogli('https://esempio.it/x', 'una cosa');
    assert.ok(disco.get('pathsOutbox')?.length === 1, 'la coda deve finire sul disco, non solo in memoria');

    // l'app si chiude e riapre: stessa coda, stesso ritardo già sorteggiato
    Collector._reset();
    Collector._setAuto(false);
    assert.equal(await Collector.flush({ now: Date.now() }), 1, 'non è ancora maturo');
    assert.equal(scritture.length, 0);
    await Collector.flush({ now: Date.now() + RITARDO_MAX_MS + 1000 });
    assert.equal(scritture.length, 1);
    assert.equal(disco.get('pathsOutbox').length, 0);
  } finally {
    delete globalThis.SN_STORAGE;
  }
});

// Il tetto della coda, e chi resta fuori quando è pieno.
//
// Prima il tetto era cento e il centunesimo faceva sparire il PIÙ VECCHIO,
// senza dire niente: cioè quello che aveva già aspettato ore ed era il più
// vicino a partire (#584, quarto giro). Adesso il tetto è più largo, e quando è
// pieno a restare fuori è quello nuovo, che lo dichiara al chiamante.
//
// Senza il fix il secondo test è rosso: i primi della coda sparivano e
// `collectAndSave` diceva lo stesso di averli salvati.
test('la coda ha un tetto: un utente che chiede aiuto tutto il giorno non riempie il disco', async () => {
  Collector._setSorteggio(() => 0.5);
  const { MAX_IN_CODA } = Collector._internal;
  for (let i = 0; i < MAX_IN_CODA + 30; i += 1) {
    await Collector.collectAndSave({
      session: sessione(`https://esempio${i}.it/x`, 'una cosa'),
      invokeAI: invokeAIFinto('una cosa'),
    });
  }
  assert.ok(Collector.inCoda() <= MAX_IN_CODA, `in coda ce ne sono ${Collector.inCoda()}`);
});

test('a coda piena non sparisce quello che aspettava: resta fuori quello nuovo, e si sa', async () => {
  Collector._setSorteggio(() => 0.5);
  const { MAX_IN_CODA } = Collector._internal;
  for (let i = 0; i < MAX_IN_CODA; i += 1) {
    await raccogli(`https://pieno${i}.it/x`, 'una cosa');
  }
  const primo = Collector._peek()[0];
  assert.equal(Collector.inCoda(), MAX_IN_CODA);

  const r = await Collector.collectAndSave({
    session: sessione('https://uno-di-troppo.it/x', 'una cosa'),
    invokeAI: invokeAIFinto('una cosa'),
  });
  assert.equal(r.saved, false, 'a coda piena non si può dire di aver salvato');
  assert.match(String(r.reason), /piena/i);
  assert.equal(Collector.inCoda(), MAX_IN_CODA);
  assert.equal(Collector._peek()[0].id, primo.id, 'il più vecchio è ancora lì');
  assert.ok(
    !Collector._peek().some((v) => v.domain === 'uno-di-troppo.it'),
    'quello nuovo non è entrato al posto di nessuno',
  );
});

test('un percorso salvato mentre la coda si sta ancora leggendo dal disco non la cancella', async () => {
  const disco = new Map();
  disco.set('pathsOutbox', [{
    id: 'vecchio', domain: 'vecchio-esempio.it', initialUrl: '/a', intent: 'una cosa di ieri',
    steps: [], success: true, accodatoIl: Date.now(), nonPrimaDi: Date.now() + 60_000,
  }]);
  globalThis.SN_STORAGE = {
    // il disco vero non risponde nello stesso istante: è in quella finestra che
    // il percorso di ieri spariva
    getRaw: async (k, d) => { await new Promise((r) => setTimeout(r, 30)); return disco.has(k) ? disco.get(k) : d; },
    setRaw: async (k, v) => { disco.set(k, JSON.parse(JSON.stringify(v))); },
  };
  try {
    Collector._reset();
    Collector._setAuto(false);
    Collector.init();                       // avvio: la lettura è partita
    await raccogli('https://nuovo-esempio.it/x', 'una cosa di adesso');
    await new Promise((r) => setTimeout(r, 60));

    const domini = Collector._peek().map((v) => v.domain).sort();
    assert.deepEqual(domini, ['nuovo-esempio.it', 'vecchio-esempio.it'],
      'il percorso che aspettava sul disco è sparito senza dire niente');
    assert.equal(disco.get('pathsOutbox').length, 2, 'e sul disco deve restare anche lui');
  } finally {
    delete globalThis.SN_STORAGE;
  }
});
