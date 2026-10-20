// #1301 — il ricordo automatico del filo: un pezzo che il modello ha già davanti non si ripesca, quello che l'utente
// cancella non arriva più al modello in nessuna scheda, la ricerca dei cambi si allarga, il blocco di attività nomina
// ogni conversazione una volta, il ricordo per parole regge punteggiatura e parole che non ci sono, e la rilettura di
// una conversazione sta nella finestra del modello. Niente Electron: il filo scrive in una cartella temporanea.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../src/shared/constants.js');
require('../../src/shared/messages.js');
require('../../src/shared/contenutoEsterno.js');
require('../../src/shared/chatArchive.js');
require('../../src/shared/filoEventi.js');
require('../../src/shared/filoApp.js');
require('../../src/shared/filoContesto.js');
require('../../src/shared/timeFormat.js');
require('../../src/shared/storage.js');
require('../../src/shared/themeTokens.js');
require('../../src/shared/tabColor.js');
require('../../src/shared/ttsVoices.js');
require('../../src/shared/filoMemory.js');
require('../../src/shared/preferences.js');
require('../../src/shared/cambi.js');
require('../../src/shared/esitoAzione.js');
require('../../src/pages/dashboard/dashboard-attivita.js');
globalThis.SN_CONST = { ...globalThis.SN_CONST, STORAGE_KEYS: { ...globalThis.SN_CONST.STORAGE_KEYS, FILO_CHATS: 'filo_chats' } };
globalThis.chrome = { storage: { local: { async get(k) { return { [k]: undefined }; }, async set() {}, async remove() {} } } };

const { creaFilo } = require('../../src/main/services/ilFilo.js');
require('../../src/main/services/filoChats.js');
const Contesto = require('../../src/main/services/contestoFilo.js');
const E = globalThis.SN_FILO_EVENTI;
const FC = globalThis.SN_FILO_CONTESTO;
const CA = globalThis.SN_CHAT_ARCHIVE;
const K = globalThis.SN_CAMBI;
const Chats = globalThis.SN_FILO_CHATS;

const cartelle = [];
after(() => { for (const c of cartelle) togliCartella(c); });
function azzera() {
  const cartella = cartellaTemporanea('ricordo-filo-');
  cartelle.push(cartella);
  globalThis.SN_IL_FILO = creaFilo({ cartella });
  globalThis.SN_ARCHIVED_TABS = { list: async () => [] };
  Contesto.dimentica(null);
  Contesto.azzeraAncore();
  return globalThis.SN_IL_FILO;
}

const ORA = Date.parse('2026-10-17T12:00:00.000Z');
const fa = (minuti) => new Date(ORA - minuti * 60000).toISOString();
const GIORNO = 24 * 60;
const TETTI = { giorni: 3, token: 100000 };

async function semina(f, { id, scambi, minuti, titolo = '' }) {
  const ev = [E.crea(E.TIPI.CHAT_APERTA, { chat: id }, { ts: fa(minuti + 1), dispositivo: 'd' })];
  scambi.forEach(([u, r], i) => {
    ev.push(E.crea(E.TIPI.MESSAGGIO, { chat: id, msg: { role: 'user', text: u } }, { ts: fa(minuti - i * 2), dispositivo: 'd' }));
    ev.push(E.crea(E.TIPI.MESSAGGIO, { chat: id, msg: { role: 'filo', text: r } }, { ts: fa(minuti - i * 2 - 1), dispositivo: 'd' }));
  });
  if (titolo) ev.push(E.crea(E.TIPI.CHAT_TITOLO, { chat: id, title: titolo, kind: 'conversazione' }, { ts: fa(minuti - 60), dispositivo: 'd' }));
  await f.importa(ev.map(E.riga).join(''));
}

const testo = (msgs) => msgs.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const davanti = async ({ chatId, storia = [] }) => {
  const r = await Contesto.componi({ chatId, userMessage: 'e adesso?', storia, incognito: false, tetti: TETTI, osserva: (az) => JSON.stringify(az), ora: ORA });
  return `${testo(r.messaggi)}\n${JSON.stringify(r.coda)}`;
};

test('un pezzo che una risposta ha già con sé non si ripesca: al terzo messaggio sullo stesso argomento è davanti una volta', async () => {
  const f = azzera();
  await semina(f, {
    id: 'lisbona', minuti: 6 * GIORNO, titolo: 'Viaggio a Lisbona',
    scambi: [['consigliami un ristorante di pesce a Lisbona', 'La Taberna da Rua das Flores.'], ['a Lisbona prendo il tram 28?', 'Sì, da Martim Moniz.']],
  });
  for (let i = 0; i < 12; i++) await semina(f, { id: `altro-${i}`, minuti: 5 * GIORNO + i, scambi: [[`domanda ${i} sul giardino`, `risposta ${i}`]] });
  const tutti = await Contesto.messaggiDelFilo({ incognito: false });
  const azioni = [];
  const ripescati = [];
  for (const domanda of ['come si chiamava il ristorante di Lisbona?', 'il ristorante di Lisbona era caro?', 'e cosa c\'è vicino al ristorante di Lisbona?']) {
    const tratti = FC.daRipescare(tutti, { davanti: [], azioni });
    const presi = FC.ricordiPerParole(domanda, tratti);
    ripescati.push(presi.map((r) => r.tratto.chiave));
    // Come fa il turno: il ricordo diventa un'azione della risposta, e la risposta resta davanti ai turni dopo.
    if (presi.length) azioni.push(FC.ricordoComeAzione(presi));
  }
  assert.equal(ripescati[0].length, 1);
  assert.deepEqual(ripescati.slice(1), [[], []]);
  const volte = azioni.flatMap((a) => a._output.results).filter((r) => /Taberna/.test(r.snippet)).length;
  assert.equal(volte, 1);
  // Riletta per intera con l'id, la conversazione è già davanti: nessun suo scambio torna come ricordo.
  const riletta = { type: 'CERCA_CHAT', _output: { chatRead: 'lisbona', found: true, transcript: '…' } };
  assert.deepEqual(FC.daRipescare(tutti, { azioni: [riletta] }).filter((t) => t.chat === 'lisbona'), []);
  // Uscita dagli esiti davanti (una risposta oltre i venti messaggi), lo stesso scambio si può ripescare di nuovo.
  assert.equal(FC.daRipescare(tutti, { azioni: [] }).filter((t) => t.chat === 'lisbona').length, 2);
});

test('una conversazione cancellata non arriva più al modello, né nella scheda che l\'aveva ripescata né nelle altre', async () => {
  const f = azzera();
  await semina(f, { id: 'prenotazione', minuti: 6 * GIORNO, scambi: [['il codice della prenotazione dell\'hotel è QX9PL4W7', 'Segnato.']] });
  await semina(f, { id: 'scheda-a', minuti: 30, scambi: [['qual era il codice dell\'hotel?', 'Te l\'ho ritrovato qui sopra.']] });
  await semina(f, { id: 'scheda-b', minuti: 20, scambi: [['ciao', 'Ciao!']] });
  await semina(f, { id: 'scheda-c', minuti: 10, scambi: [['cerca l\'hotel', 'Trovato.']] });
  const tutti = await Contesto.messaggiDelFilo({ incognito: false });
  const vecchi = tutti.filter((m) => m.chat === 'prenotazione');
  const ricordo = FC.ricordoComeAzione(FC.tratti(vecchi).map((t) => ({ tratto: t, score: 1 })));
  const ricerca = {
    type: 'CERCA_CHAT', _executed: true,
    _output: { chatSearch: 'hotel', results: [{ id: 'prenotazione', title: '', snippet: 'codice QX9PL4W7' }], daFuori: [{ testo: 'QX9PL4W7', fonte: 'x', chat: 'prenotazione' }] },
  };
  const rilettura = { type: 'CERCA_CHAT', _executed: true, _output: { chatRead: 'prenotazione', found: true, transcript: 'Utente: il codice è QX9PL4W7' } };
  const risposta = (id) => tutti.filter((m) => m.chat === id && m.role === 'filo').pop();
  Contesto.ricordaEsiti('scheda-a', risposta('scheda-a').ts, { azioni: [ricordo] });
  Contesto.ricordaEsiti('scheda-c', risposta('scheda-c').ts, { azioni: [ricerca, rilettura] });
  // La scheda A ha la risposta col ricordo anche nella sua storia, e un turno interrotto che il filo non ha.
  const storiaA = [
    { role: 'user', text: 'qual era il codice dell\'hotel?' },
    { role: 'filo', text: 'Te l\'ho ritrovato qui sopra.', actions: [ricordo] },
    { role: 'filo', text: '', interrotto: true, actions: [rilettura] },
  ];
  assert.match(await davanti({ chatId: 'scheda-a', storia: storiaA }), /QX9PL4W7/);
  assert.match(await davanti({ chatId: 'scheda-b' }), /QX9PL4W7/);

  await Chats.remove('prenotazione');
  assert.doesNotMatch(await davanti({ chatId: 'scheda-a', storia: storiaA }), /QX9PL4W7/);
  assert.doesNotMatch(await davanti({ chatId: 'scheda-b' }), /QX9PL4W7/);
  assert.doesNotMatch(await davanti({ chatId: 'scheda-c' }), /QX9PL4W7/);
  // Il modello sa che quella rilettura non c'è più, e la ricerca dice che il suo risultato è stato cancellato.
  const r = await Contesto.componi({ chatId: 'scheda-b', userMessage: 'e adesso?', incognito: false, tetti: TETTI, osserva: () => '', ora: ORA });
  const out = r.azioni.filter((a) => a.type === 'CERCA_CHAT').map((a) => a._output);
  assert.ok(out.some((o) => o.chatRead === 'prenotazione' && o.found === false));
  assert.ok(out.some((o) => o.chatSearch === 'hotel' && o.results.length === 0 && o.cancellate === 1 && !o.daFuori));
});

test('una pagina cancellata dalla Sicurezza dopo che una ricerca l\'aveva trovata non arriva più al modello', async () => {
  const f = azzera();
  await f.registraVisita({ url: 'https://hotel-lisbona.example/prenotazione?id=ZK2M', titolo: 'Prenotazione ZK2M', ts: fa(60) });
  await f.registraVisita({ url: 'https://tram.example/linea-28', titolo: 'Tram 28', ts: fa(50) });
  await semina(f, { id: 'scheda-p', minuti: 10, scambi: [['trova la pagina dell\'hotel', 'Eccola.']] });
  const risposta = (await Contesto.messaggiDelFilo({ incognito: false })).filter((m) => m.chat === 'scheda-p' && m.role === 'filo').pop();
  Contesto.ricordaEsiti('scheda-p', risposta.ts, {
    azioni: [{ type: 'CERCA_CHAT', _executed: true, _output: { chatSearch: 'hotel tram', results: [], pagine: [
      { url: 'https://hotel-lisbona.example/prenotazione?id=ZK2M', title: 'Prenotazione ZK2M', chiusa: false },
      { url: 'https://tram.example/linea-28', title: 'Tram 28', chiusa: false },
    ] } }],
  });
  assert.match(await davanti({ chatId: 'scheda-p' }), /ZK2M/);
  await f.cancellaPagine({ da: null, a: null, sito: 'hotel-lisbona.example' });
  const dopo = await davanti({ chatId: 'scheda-p' });
  assert.doesNotMatch(dopo, /ZK2M/);
  assert.match(dopo, /Tram 28/);
});

test('la ricerca dei cambi si allarga come quella delle conversazioni: una parola in più non fa sparire il tema scuro', () => {
  const eventi = [
    { id: 'c1', ts: fa(3 * 60), tipo: 'impostazioni', via: 'chat', cambi: [{ chiave: 'textScale', prima: 1, dopo: 1.2 }] },
    { id: 'c2', ts: fa(GIORNO), tipo: 'impostazioni', via: 'chat', cambi: [{ chiave: 'theme', prima: 'light', dopo: 'dark' }] },
  ];
  assert.deepEqual(K.cerca(eventi, 'tema scuro').results.map((c) => c.id), ['c2']);
  const largo = K.cerca(eventi, 'cambio tema scuro');
  assert.deepEqual(largo.results.map((c) => c.id), ['c2']);
  assert.equal(largo.allargata, true);
  assert.deepEqual(K.cerca(eventi, 'il tema scuro di ieri?').results.map((c) => c.id), ['c2']);
  assert.deepEqual(K.cerca(eventi, 'di ieri').results, []);
  assert.deepEqual(K.cerca(eventi, '').results, []);
});

test('il blocco di attività nomina ogni conversazione ripescata una volta, anche quando ne vengono più scambi', () => {
  const tratti = FC.tratti([
    { chat: 'lisbona', titolo: 'Viaggio a Lisbona', role: 'user', text: 'il ristorante?', ts: fa(9000) },
    { chat: 'lisbona', titolo: 'Viaggio a Lisbona', role: 'filo', text: 'Taberna da Rua.', ts: fa(8999) },
    { chat: 'lisbona', titolo: 'Viaggio a Lisbona', role: 'user', text: 'è caro il ristorante?', ts: fa(8990) },
    { chat: 'lisbona', titolo: 'Viaggio a Lisbona', role: 'filo', text: 'Medio.', ts: fa(8989) },
    { chat: 'porto', titolo: 'Gita a Porto', role: 'user', text: 'un ristorante a Porto?', ts: fa(8000) },
    { chat: 'porto', titolo: 'Gita a Porto', role: 'filo', text: 'Cantinho.', ts: fa(7999) },
  ]);
  const a = FC.ricordoComeAzione(tratti.map((t) => ({ tratto: t, score: 1 })));
  const righe = [];
  globalThis.SN_DASH_ATTIVITA.tellActionInActivity({ addRow: (...x) => righe.push(x), mostra() {} }, a);
  assert.equal(righe.length, 1);
  assert.equal(righe[0][2], 'Ricordato dal filo · Viaggio a Lisbona; Gita a Porto');
});

test('senza vettori il ricordo per parole regge la punteggiatura e non pretende le parole che non ci sono', () => {
  const vecchi = [];
  const scambio = (chat, giorni, u, r) => {
    vecchi.push({ chat, role: 'user', text: u, ts: fa(giorni * GIORNO) }, { chat, role: 'filo', text: r, ts: fa(giorni * GIORNO - 1) });
  };
  scambio('lisbona', 10, 'consigliami un ristorante di pesce a Lisbona', 'La Taberna da Rua das Flores.');
  scambio('mutuo', 9, 'quanto pago di rata del mutuo?', 'La rata è di 640 euro.');
  for (let i = 0; i < 8; i++) scambio(`altro-${i}`, 8 - i * 0.1, `domanda ${i} sul giardino`, `risposta ${i}`);
  vecchi.sort((x, y) => Date.parse(x.ts) - Date.parse(y.ts));
  const tratti = FC.tratti(vecchi);
  for (const q of ['il ristorante di Lisbona?', 'il ristorante di «Lisbona»!', 'Lisbona, il ristorante...', 'come si chiamava il ristorante di Lisbona?']) {
    const presi = FC.ricordiPerParole(q, tratti);
    assert.equal(presi.length, 1, q);
    assert.equal(presi[0].tratto.chat, 'lisbona', q);
  }
  // Le parole che non ci sono non bastano a ripescare: ne servono due rare che ci siano davvero.
  assert.deepEqual(FC.ricordiPerParole('come si chiamava quel posto?', tratti), []);
  assert.deepEqual(FC.ricordiPerParole('ok grazie!', tratti), []);
  assert.deepEqual(CA.paroleDellaRicerca('«Lisbona?» example.com, c++ (tram)'), ['lisbona', 'example.com', 'c++', 'tram']);
});

test('la rilettura di una conversazione sta nella finestra nota del modello, e dopo un rifiuto si accorcia', () => {
  // Senza finestra nota vale il tetto in token, come prima; con una finestra piccola quello che ci sta ancora.
  assert.equal(FC.tettoRilettura({ token: 100000, libero: null }), 350000);
  const libero = FC.spazioInFinestra({ finestra: 32768, occupati: 30000 });
  assert.ok(libero > 20000 && libero < 50000, String(libero));
  assert.equal(FC.tettoRilettura({ token: 100000, libero }), libero);
  assert.equal(FC.tettoRilettura({ token: 100000, libero: -500 }), FC.RILETTURA_MINIMA);
  // Il rifiuto con le misure: la rilettura scende abbastanza da stare sotto la finestra.
  const caratteri = 180000;
  const [nuova] = FC.riletturePiuCorte({ max: 32768, chiesti: Math.ceil(caratteri / 3.5), caratteri, lunghezze: [150000] });
  assert.ok(caratteri - (150000 - nuova) < 32768 * 3.5, String(nuova));
  // Senza misure si dimezza quello che si può togliere; al minimo non c'è più niente da accorciare.
  assert.deepEqual(FC.riletturePiuCorte({ lunghezze: [108000] }), [58000]);
  assert.equal(FC.riletturePiuCorte({ lunghezze: [FC.RILETTURA_MINIMA] }), null);
  // La finestra dal catalogo di OpenRouter, anche per un nome con la scorciatoia di smistamento.
  const finestre = FC.finestreDaCatalogo([{ id: 'deepseek/deepseek-v4-flash', context_length: 32768 }, { id: 'x/y', top_provider: { context_length: 8000 } }, { id: 'z/w' }]);
  assert.equal(FC.finestraDi(finestre, 'deepseek/deepseek-v4-flash:nitro'), 32768);
  assert.equal(FC.finestraDi(finestre, 'x/y'), 8000);
  assert.equal(FC.finestraDi(finestre, 'z/w'), null);
});
