// Il ricordo automatico del filo (#868.1, #868.2, #1301): un pezzo che il modello ha già davanti non si ripesca, ciò
// che l'utente cancella non torna al modello dalle copie, e il blocco di attività nomina ogni conversazione una volta.
// Niente Electron: il filo scrive in una cartella temporanea, il ricordo va per parole come senza vettori.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import '../../src/shared/capabilities.js';
import '../../src/shared/constants.js';
import '../../src/shared/contenutoEsterno.js';
import '../../src/shared/chatArchive.js';
import '../../src/shared/filoEventi.js';
import '../../src/shared/filoApp.js';
import '../../src/shared/filoContesto.js';

const require = createRequire(import.meta.url);
globalThis.SN_CONST = { ...(globalThis.SN_CONST || {}), STORAGE_KEYS: { ...((globalThis.SN_CONST || {}).STORAGE_KEYS || {}), FILO_CHATS: 'filo_chats' } };
globalThis.chrome = { storage: { local: { async get(k) { return { [k]: undefined }; }, async set() {}, async remove() {} } } };

const { creaFilo } = require('../../src/main/services/ilFilo.js');
require('../../src/main/services/filoChats.js');
const Contesto = require('../../src/main/services/contestoFilo.js');
const Ricordi = require('../../src/main/services/ricordiFilo.js');
const E = globalThis.SN_FILO_EVENTI;
const FC = globalThis.SN_FILO_CONTESTO;
const Chats = globalThis.SN_FILO_CHATS;

const cartelle = [];
after(() => { for (const c of cartelle) togliCartella(c); });

let aperte = new Set();
function azzera() {
  const cartella = cartellaTemporanea('ricordo-filo-');
  cartelle.push(cartella);
  globalThis.SN_IL_FILO = creaFilo({ cartella });
  Contesto.dimentica(null);
  Contesto.azzeraAncore();
  Ricordi.azzera();
  aperte = new Set();
  return globalThis.SN_IL_FILO;
}

const TETTI = { giorni: 3, token: 100000 };
const faMinuti = (m) => new Date(Date.now() - m * 60000).toISOString();
// Gli esiti come li scrive il prompt: tutto quello che l'azione porta, così una copia rimasta si vede.
const osserva = (azioni) => azioni.map((a) => JSON.stringify(a._output || {})).join('\n');

async function scrivi(f, chat, role, text, minutiFa) {
  const ts = faMinuti(minutiFa);
  const ev = [];
  if (!aperte.has(chat)) { aperte.add(chat); ev.push(E.crea(E.TIPI.CHAT_APERTA, { chat }, { ts, dispositivo: 'd' })); }
  ev.push(E.crea(E.TIPI.MESSAGGIO, { chat, msg: { role, text } }, { ts, dispositivo: 'd' }));
  await f.importa(ev.map(E.riga).join(''));
  return ts;
}

async function vecchia(f, { id, titolo = '', minutiFa, scambi }) {
  for (let i = 0; i < scambi.length; i++) {
    await scrivi(f, id, 'user', scambi[i][0], minutiFa - i * 2);
    await scrivi(f, id, 'filo', scambi[i][1], minutiFa - i * 2 - 1);
  }
  if (titolo) {
    await f.importa(E.riga(E.crea(E.TIPI.CHAT_TITOLO, { chat: id, title: titolo, kind: 'conversazione' }, { ts: faMinuti(minutiFa - 60), dispositivo: 'd' })));
  }
}

const componi = (chatId, userMessage, storia = []) => Contesto.componi({ chatId, userMessage, storia, tetti: TETTI, osserva, incognito: false });
const quante = (testo, pezzo) => testo.split(pezzo).length - 1;

test('un pezzo che il modello ha già davanti non si ripesca: tre domande sullo stesso argomento lo portano una volta sola', async () => {
  const f = azzera();
  await vecchia(f, { id: 'viaggio', titolo: 'Viaggio a Lisbona', minutiFa: 6 * 24 * 60, scambi: [['consigliami un ristorante di pesce a Lisbona', 'La Taberna da Rua das Flores: prenota per le 20.']] });
  await vecchia(f, { id: 'roma', minutiFa: 7 * 24 * 60, scambi: [['che tempo fa a Roma?', 'Sole.']] });
  const domande = ['come si chiamava il ristorante di Lisbona?', 'e il ristorante di Lisbona era caro?', "cosa c'è vicino al ristorante di Lisbona?"];
  const portati = [];
  let ultimo = null;
  for (let n = 0; n < domande.length; n++) {
    await scrivi(f, 'scheda', 'user', domande[n], 30 - n * 10);
    const c = await componi('scheda', domande[n]);
    const ricordi = await Ricordi.cerca(domande[n], { vecchi: c.vecchi, davanti: c.visti, esiti: c.azioni });
    // Come fa il turno (handlers.js): i ricordi entrano nella domanda, e ci restano nei turni dopo.
    c.domanda({ turno: FC.rendiRicordi(ricordi) });
    portati.push(ricordi.length);
    ultimo = { c, ricordi };
    // Senza sapere cosa ha davanti, il pezzo tornerebbe a ogni domanda.
    assert.equal((await Ricordi.cerca(domande[n], { vecchi: c.vecchi, davanti: c.visti })).length, 1);
    const ts = await scrivi(f, 'scheda', 'filo', 'Risposta.', 30 - n * 10 - 1);
    if (ricordi.length) Contesto.ricordaEsiti('scheda', ts, { azioni: [FC.ricordoComeAzione(ricordi)] });
  }
  assert.deepEqual(portati, [1, 0, 0]);
  const davanti = JSON.stringify(ultimo.c.messaggi) + FC.rendiRicordi(ultimo.ricordi);
  assert.equal(quante(davanti, 'prenota per le 20'), 1, 'al terzo messaggio lo scambio vecchio è davanti più di una volta');
});

test('una conversazione riletta per intero non si ripesca; riletta a testa e coda sì, il mezzo può servire', async () => {
  const f = azzera();
  await vecchia(f, { id: 'viaggio', titolo: 'Viaggio a Lisbona', minutiFa: 6 * 24 * 60, scambi: [['consigliami un ristorante di pesce a Lisbona', 'La Taberna da Rua das Flores.']] });
  const q = 'il ristorante di Lisbona?';
  await scrivi(f, 'scheda', 'user', q, 5);
  const c = await componi('scheda', q);
  const letta = (intera) => ({ type: 'CERCA_CHAT', id: 'viaggio', _executed: true, _output: { chatRead: 'viaggio', found: true, transcript: 'Utente: …', ...(intera ? { intera: true } : {}) } });
  assert.deepEqual(await Ricordi.cerca(q, { vecchi: c.vecchi, davanti: c.visti, esiti: [letta(true)] }), []);
  assert.equal((await Ricordi.cerca(q, { vecchi: c.vecchi, davanti: c.visti, esiti: [letta(false)] })).length, 1);
});

test('una conversazione cancellata non arriva più al modello: né dal ricordo né dalla rilettura né dalla ricerca, in ogni scheda', async () => {
  const f = azzera();
  await vecchia(f, { id: 'hotel', titolo: 'Hotel a Porto', minutiFa: 6 * 24 * 60, scambi: [['segnati il codice della prenotazione: PNR-7Q4XK', 'Segnato: PNR-7Q4XK.']] });
  const visita = faMinuti(6 * 24 * 60 - 30);
  const pagina = 'https://hotel.example/prenotazioni/PNR-7Q4XK';
  await f.importa(E.riga(E.crea(E.TIPI.NAVIGAZIONE, { url: pagina, titolo: 'La tua prenotazione' }, { ts: visita, dispositivo: 'd', autore: 'utente' })));
  await vecchia(f, { id: 'roma', minutiFa: 7 * 24 * 60, scambi: [['che tempo fa a Roma?', 'Sole.']] });

  // Scheda A: Filo ha ripescato la conversazione da solo, poi l'ha riletta.
  await scrivi(f, 'scheda-a', 'user', 'qual era il codice della prenotazione?', 20);
  const ra = await scrivi(f, 'scheda-a', 'filo', 'Eccolo.', 19);
  const [tratto] = FC.tratti((await Contesto.messaggiDelFilo({ incognito: false })).filter((m) => m.chat === 'hotel'));
  const ricordo = FC.ricordoComeAzione([{ tratto, score: 1 }]);
  const riletta = { type: 'CERCA_CHAT', id: 'hotel', _executed: true, _output: { chatRead: 'hotel', found: true, intera: true, title: 'Hotel a Porto', transcript: 'Utente: segnati il codice della prenotazione: PNR-7Q4XK\nFilo: Segnato: PNR-7Q4XK.' } };
  Contesto.ricordaEsiti('scheda-a', ra, { azioni: [ricordo, riletta] });
  // La scheda A ha gli stessi esiti nella sua storia, che valgono più della copia in memoria.
  const storiaA = [{ role: 'user', text: 'qual era il codice della prenotazione?' }, { role: 'filo', text: 'Eccolo.', actions: [ricordo, riletta] }];

  // Scheda B: una ricerca aveva trovato la conversazione e la pagina dell'hotel.
  await scrivi(f, 'scheda-b', 'user', 'cerca la prenotazione e il sito', 10);
  const rb = await scrivi(f, 'scheda-b', 'filo', 'Trovate.', 9);
  const cercata = {
    type: 'CERCA_CHAT', query: 'prenotazione', _executed: true,
    _output: {
      chatSearch: 'prenotazione', cercatoCon: ['prenotazione'], allargata: false,
      results: [
        { id: 'hotel', title: 'Hotel a Porto', date: visita, snippet: '…il codice della prenotazione: PNR-7Q4XK…' },
        { id: 'roma', title: 'Roma', date: visita, snippet: 'che tempo fa a Roma?' },
      ],
      pagine: [{ url: pagina, title: 'La tua prenotazione', date: visita, chiusa: false }],
    },
  };
  Contesto.ricordaEsiti('scheda-b', rb, { azioni: [cercata] });

  const vede = async (chat, storia = []) => JSON.stringify((await componi(chat, 'e adesso?', storia)).messaggi);
  assert.match(await vede('scheda-a', storiaA), /PNR-7Q4XK/);
  assert.match(await vede('scheda-c'), /PNR-7Q4XK/);

  await Chats.remove('hotel');
  await f.cancellaVisite([{ ts: visita, url: pagina }]);

  for (const [chat, storia] of [['scheda-a', storiaA], ['scheda-b', []], ['scheda-c', []]]) {
    const testo = await vede(chat, storia);
    assert.doesNotMatch(testo, /PNR-7Q4XK/, `in ${chat} il codice cancellato arriva ancora al modello`);
    assert.doesNotMatch(testo, /hotel\.example/, `in ${chat} la pagina cancellata arriva ancora al modello`);
    // Quello che non è stato cancellato resta.
    assert.match(testo, /che tempo fa a Roma/, chat);
  }
  // Il modello sa che quello che aveva trovato non c'è più, invece di leggere «niente trovato».
  const c = await componi('scheda-c', 'e adesso?');
  const ricerca = c.azioni.find((a) => a._output && a._output.chatSearch);
  assert.equal(ricerca._output.cancellati, 2);
  assert.deepEqual(ricerca._output.results.map((r) => r.id), ['roma']);
  assert.equal(c.azioni.find((a) => a._output && 'chatRead' in a._output)._output.cancellata, true);
  // Le azioni senza niente di cancellato restano le stesse: il prefisso non si muove.
  const pulite = [{ type: 'CERCA_CHAT', _output: { automatica: true, results: [{ id: 'roma', date: visita }] } }];
  assert.equal(FC.senzaCancellati(pulite, { chat: () => true, pagina: () => true }), pulite);
});

test('più pezzi della stessa conversazione: il blocco di attività la nomina una volta', async () => {
  await import('../../src/shared/messages.js');
  await import('../../src/shared/esitoAzione.js');
  await import('../../src/pages/dashboard/dashboard-attivita.js');
  const D = globalThis.SN_DASH_ATTIVITA;
  const pezzo = (chat, titolo, ts, testo) => ({ tratto: { chat, titolo, ts, testo, daFuori: [] }, score: 1 });
  const giorno = '2026-10-01T10:00:00.000Z';
  const azione = FC.ricordoComeAzione([
    pezzo('viaggio', 'Viaggio a Lisbona', giorno, 'Utente: il ristorante\nFilo: Taberna'),
    pezzo('viaggio', 'Viaggio a Lisbona', '2026-10-01T10:05:00.000Z', 'Utente: era caro?\nFilo: no'),
    pezzo('mutuo', 'Mutuo', '2026-09-28T09:00:00.000Z', 'Utente: la rata\nFilo: 640 euro'),
    pezzo('viaggio', 'Viaggio a Lisbona', '2026-10-01T10:09:00.000Z', 'Utente: e vicino?\nFilo: il castello'),
  ]);
  assert.equal(D.activityRowFor(azione).text, 'Ricordato dal filo · Viaggio a Lisbona; Mutuo');
  // Senza titolo la conversazione si nomina col giorno, sempre una volta sola.
  const senza = FC.ricordoComeAzione([pezzo('x', '', giorno, 'a'), pezzo('x', '', '2026-10-01T18:00:00.000Z', 'b')]);
  assert.equal(D.activityRowFor(senza).text.split(';').length, 1);
  // Riaperta dalla Cronologia la risposta dice che Filo ha ripescato un ricordo, non che ha cercato; i titoli non
  // entrano nell'archivio, così una conversazione cancellata non resta nominata nelle altre.
  const salvato = globalThis.SN_CHAT_ARCHIVE.toStoredMessage({ role: 'filo', text: 'Taberna', actions: [azione] });
  assert.deepEqual(salvato.actions, ['RICORDO_FILO']);
  assert.doesNotMatch(JSON.stringify(salvato), /Lisbona|Mutuo/);
  assert.equal(D.summarizeActivity(salvato.actions, false), 'Ha ripescato un ricordo dal filo');
  const chiesta = globalThis.SN_CHAT_ARCHIVE.toStoredMessage({ role: 'filo', text: 'x', actions: [{ type: 'CERCA_CHAT', query: 'orche', _output: { results: [] } }] });
  assert.deepEqual(chiesta.actions, ['CERCA_CHAT']);
});
