// Sentinella della home come coda del filo (#869): quali righe, in che ordine, a pezzi senza salti; quale conversazione
// una scheda nuova continua; quando Filo saluta la giornata; due suoi messaggi di fila sono uno; la ricerca nel filo;
// il messaggio di Filo resta una lettura per il modello (#592.4). Niente Electron: il filo scrive in una cartella temporanea.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { costoInUnita } from '../helpers/tempoRelativo.mjs';
import '../../src/shared/contenutoEsterno.js';
import '../../src/shared/chatArchive.js';
import '../../src/shared/filoEventi.js';
import '../../src/shared/filoApp.js';
import '../../src/shared/filoCoda.js';
import '../../src/shared/filoContesto.js';
import '../../src/shared/constants.js';

const require = createRequire(import.meta.url);
globalThis.SN_CONST = { ...(globalThis.SN_CONST || {}), STORAGE_KEYS: { ...((globalThis.SN_CONST || {}).STORAGE_KEYS || {}), FILO_CHATS: 'filo_chats' } };
globalThis.chrome = globalThis.chrome || { storage: { local: { async get(k) { return { [k]: undefined }; }, async set() {}, async remove() {} } } };

const { creaFilo } = require('../../src/main/services/ilFilo.js');
require('../../src/main/services/filoChats.js');
const Parla = require('../../src/main/services/filoParla.js');
const C = globalThis.SN_FILO_CODA;
const E = globalThis.SN_FILO_EVENTI;
const CA = globalThis.SN_CHAT_ARCHIVE;
const FC = globalThis.SN_FILO_CONTESTO;

const cartelle = [];
after(() => { for (const c of cartelle) togliCartella(c); });
function azzera() {
  const cartella = cartellaTemporanea('filo-coda-');
  cartelle.push(cartella);
  globalThis.SN_IL_FILO = creaFilo({ cartella });
  return globalThis.SN_IL_FILO;
}

const ORA = new Date(2026, 9, 18, 15, 0, 0).getTime();
const fa = (minuti) => new Date(ORA - minuti * 60000).toISOString();
const chat = (id, msgs, extra = {}) => ({ id, updatedAt: msgs[msgs.length - 1].ts, messages: msgs, ...extra });
const m = (role, text, ts, extra = {}) => ({ role, text, ts, ...extra });

test('le righe stanno in ordine di tempo: messaggi di più chat, una riga per chat di app, cambi fuori dalla chat, pagine ripiegate', () => {
  const chats = [
    chat('a', [m('user', 'tema scuro', fa(50)), m('filo', 'Fatto.', fa(49), { cambi: ['c1'] })]),
    chat('b', [m('user', 'orche?', fa(20)), m('filo', 'Cacciano in branco.', fa(19))], { dispositivi: ['qui', 'telefono'] }),
    chat('e', [m('user', 'riassumi', fa(30)), m('filo', 'Ecco.', fa(29))], { app: 'editor', rif: 'f1', soggetto: 'tesi', startedAt: fa(30) }),
  ];
  const pagine = [
    { id: 'p1', ts: fa(48), url: 'https://www.youtube.com/watch?v=1', titolo: 'orche - YouTube', dispositivo: 'qui' },
    { id: 'p2', ts: fa(40), url: 'https://example.org/', titolo: '', dispositivo: 'qui' },
    { id: 'p3', ts: fa(10), url: 'https://wiki.org/orca', titolo: 'Orca', dispositivo: 'telefono' },
  ];
  const cambi = [
    { id: 'c1', ts: fa(49), via: 'chat', frase: 'tema: scuro' },
    { id: 'c2', ts: fa(35), via: 'interfaccia', frase: 'zoom 125%', provenienza: 'dalle Preferenze', annullabile: true, tipo: 'impostazioni' },
  ];
  const el = C.elementi({ chats, pagine, cambi, qui: 'qui' });
  assert.deepEqual(el.map((x) => x.key), ['m:a:0', 'm:a:1', 'p:p1', 'c:c2', 'a:e', 'm:b:0', 'm:b:1', 'p:p3']);
  const gruppo = el[2];
  assert.equal(gruppo.k, 'pagine');
  assert.deepEqual(gruppo.pagine.map((p) => p.id), ['p1', 'p2']);
  assert.equal(C.nomeDelGruppo(gruppo), 'orche - YouTube');
  assert.equal(el[6].altrove, true, 'il messaggio arrivato dal telefono lo dice');
  assert.ok(!el[5].altrove);
  assert.equal(el[7].pagine[0].altrove, true);
  assert.ok(!el.some((x) => x.key === 'c:c1'), 'un cambio chiesto in chat ha il segno sulla bolla, non una riga');
});

test('#1490: un cambio ritoccato resta all’ora del primo ritocco, e chi allinea dopo l’ultimo lo riceve riscritto', () => {
  const cambi = [{ id: 'z', ts: fa(30), agg: fa(29), via: 'interfaccia', tipo: 'zoom', frase: 'zoom di youtube.com: 125% → 100%', provenienza: 'con un gesto sulla pagina', annullabile: true }];
  const pagine = [{ id: 'p', ts: fa(29.5), url: 'https://www.youtube.com/watch?v=2', titolo: 'jazz' }];
  const el = C.elementi({ pagine, cambi });
  assert.deepEqual(el.map((x) => x.key), ['c:z', 'p:p']);
  assert.equal(el[0].ts, fa(30));
  assert.equal(el[0].fine, fa(29));
  assert.deepEqual(C.pezzo(el, { dopo: fa(29.5) }).elementi.map((x) => x.key), ['c:z'], 'il ritocco dopo l’ultima lettura riscrive la riga');
  assert.equal(C.siFonde({ chats: [chat('h', [m('filo', 'Buongiorno.', fa(29.7), { spontaneo: true })])], cambi }, 'h', { ora: ORA }), false, 'il ritocco è venuto dopo il messaggio di Filo');
});

test('un gruppo di pagine non sta a cavallo di due giorni', () => {
  const ieri = new Date(2026, 9, 17, 23, 50).toISOString();
  const oggi = new Date(2026, 9, 18, 0, 10).toISOString();
  const el = C.elementi({ pagine: [{ id: 'x', ts: ieri, url: 'https://a.it/', titolo: 'A' }, { id: 'y', ts: oggi, url: 'https://b.it/', titolo: 'B' }] });
  assert.deepEqual(el.map((x) => x.key), ['p:x', 'p:y']);
});

test('a pezzi: gli ultimi prima del cursore, mai due con la stessa ora divisi, fino a un punto, quelli arrivati dopo', () => {
  const lista = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, ts: fa(100 - i * 10) }));
  lista[4].ts = lista[5].ts;
  const ultimi = C.pezzo(lista, { quanti: 3 });
  assert.deepEqual(ultimi.elementi.map((x) => x.key), ['k7', 'k8', 'k9']);
  assert.equal(ultimi.inizio, false);
  const prima = C.pezzo(lista, { prima: lista[7].ts, quanti: 2 });
  assert.deepEqual(prima.elementi.map((x) => x.key), ['k4', 'k5', 'k6'], 'k4 ha la stessa ora di k5: viene con lui');
  const tutto = C.pezzo(lista, { prima: lista[3].ts, quanti: 50 });
  assert.equal(tutto.inizio, true);
  const fino = C.pezzo(lista, { prima: lista[9].ts, fino: lista[1].ts, quanti: 2 });
  assert.equal(fino.elementi[0].key, 'k0');
  assert.deepEqual(C.pezzo(lista, { dopo: lista[8].ts }).elementi.map((x) => x.key), ['k9']);
});

test('la conversazione che una scheda nuova continua: entro un’ora, o se l’ultima parola è di Filo che ha scritto da sé', () => {
  const recente = chat('r', [m('user', 'ciao', fa(30))]);
  const vecchia = chat('v', [m('user', 'ciao', fa(200))]);
  assert.equal(C.chatCorrente([vecchia, recente], { ora: ORA }).id, 'r');
  assert.equal(C.chatCorrente([vecchia], { ora: ORA }), null);
  const spontanea = chat('s', [m('filo', 'Il timer è suonato.', fa(150), { spontaneo: true })]);
  assert.equal(C.chatCorrente([vecchia, spontanea], { ora: ORA }).id, 's');
  const ieri = new Date(ORA - 86400000).toISOString();
  const spontaneaDiIeri = chat('y', [m('filo', 'Il timer è suonato.', ieri, { spontaneo: true })]);
  assert.equal(C.chatCorrente([spontaneaDiIeri], { ora: ORA }), null, 'il saluto di oggi non si fonde con la parola spontanea di ieri');
  const acc = chat('o', [m('user', 'mi chiamo Ada', fa(5))], { onboarding: true });
  const app = chat('e', [m('user', 'x', fa(2))], { app: 'editor', rif: 'f' });
  assert.equal(C.chatCorrente([acc, app], { ora: ORA }), null, 'l’accoglienza e le chat delle app non si continuano dalla home');
  const finita = chat('f', [m('user', 'portami alla home', fa(3))], { finita: true });
  assert.equal(C.chatCorrente([recente, finita], { ora: ORA }), null, 'chiusa apposta dall’utente, l’ultima non si continua');
  const finitaSpontanea = chat('g', [m('filo', 'Il timer è suonato.', fa(3), { spontaneo: true })], { finita: true });
  assert.equal(C.chatCorrente([finitaSpontanea], { ora: ORA }), null);
});

test('il saluto della giornata: dopo le cinque, se nella home oggi non si è detto niente', () => {
  const ieri = chat('i', [m('user', 'buonanotte', new Date(2026, 9, 17, 23, 0).toISOString())]);
  assert.equal(C.serveGiornata([ieri], { ora: ORA }), true);
  assert.equal(C.serveGiornata([ieri], { ora: new Date(2026, 9, 18, 3, 0).getTime() }), false);
  const oggi = chat('o', [m('filo', 'Buongiorno.', new Date(2026, 9, 18, 8, 0).toISOString(), { spontaneo: true })]);
  assert.equal(C.serveGiornata([ieri, oggi], { ora: ORA }), false);
});

test('cercare nel filo: tutte le parole, senza accenti né maiuscole, nei messaggi, nelle pagine e nel contenuto delle schede chiuse', () => {
  const chats = [
    chat('a', [m('user', 'Le ORCHE cacciano in branco?', fa(30)), m('filo', 'Sì, perché collaborano.', fa(29))]),
    chat('e', [m('user', 'orche nel documento', fa(5))], { app: 'editor', rif: 'f' }),
  ];
  const pagine = [
    { id: 'p1', ts: fa(40), url: 'https://youtube.com/watch?v=1', titolo: 'Orche a caccia' },
    { id: 'p2', ts: fa(20), url: 'https://youtube.com/watch?v=1', titolo: 'Orche a caccia' },
  ];
  const schede = [{ url: 'https://natura.it/cetacei', title: 'Cetacei', summary: 'Le orche vivono in gruppi familiari.', closedAt: fa(60) }];
  const r = C.cerca({ chats, pagine, schede }, 'orche');
  assert.deepEqual(r.messaggi.map((x) => x.chat), ['e', 'a']);
  assert.equal(r.messaggi[0].app, 'editor');
  assert.deepEqual(r.pagine.map((x) => x.url), ['https://youtube.com/watch?v=1', 'https://natura.it/cetacei'], 'una pagina vista due volte è una');
  assert.equal(r.pagine[0].id, 'p2');
  assert.match(r.pagine[1].estratto, /orche vivono/);
  assert.equal(C.cerca({ chats }, 'perche').messaggi.length, 1);
  assert.equal(C.cerca({ chats }, 'orche delfini').messaggi.length, 0);
  assert.equal(C.cerca({ chats }, ' ').messaggi.length, 0);
});

test('nei passi allargati una parola corta vale da inizio parola (#1295)', () => {
  const chats = [
    chat('z', [m('user', 'Parliamo di Zen e del respiro', fa(30))]),
    chat('x', [m('user', 'Quando arrivano i pacchi?', fa(20))]),
  ];
  assert.deepEqual(C.cerca({ chats }, 'iva', { largo: true }).messaggi, []);
  assert.equal(C.cerca({ chats }, 'iva').messaggi.length, 1, 'la ricerca stretta resta com’era');
  assert.deepEqual(C.cerca({ chats }, 'zen', { largo: true }).messaggi.map((x) => x.chat), ['z']);
});

test('un messaggio di Filo che si fonde riscrive il suo di prima; senza il segno, o con l’utente in mezzo, restano due', () => {
  const st = E.nuovoStato();
  const scrivi = (msg, ts) => E.applica(st, E.crea(E.TIPI.MESSAGGIO, { chat: 'h', msg }, { ts, dispositivo: 'qui', autore: msg.role === 'user' ? 'utente' : 'filo' }));
  scrivi({ role: 'filo', text: 'Il timer è suonato.', spontaneo: true }, fa(10));
  scrivi({ role: 'filo', text: 'Il timer è suonato e il download è finito.', spontaneo: true, fonde: true }, fa(9));
  let c = E.copiaChat(st.chat.get('h'), { dispositivi: true });
  assert.deepEqual(c.messages.map((x) => x.text), ['Il timer è suonato e il download è finito.']);
  assert.equal(c.messages[0].ts, fa(10), 'il messaggio resta dov’era nel filo');
  assert.deepEqual(c.dispositivi, ['qui']);
  assert.equal(c.messages[0].fonde, undefined);
  scrivi({ role: 'user', text: 'grazie' }, fa(8));
  scrivi({ role: 'filo', text: 'Buongiorno.', spontaneo: true, fonde: true }, fa(7));
  c = E.copiaChat(st.chat.get('h'));
  assert.equal(c.messages.length, 3);
  assert.equal(c.dispositivi, undefined);
  scrivi({ role: 'filo', text: 'Il download è finito.', spontaneo: true }, fa(1));
  c = E.copiaChat(st.chat.get('h'));
  assert.deepEqual(c.messages.slice(-2).map((x) => [x.text, x.ts]), [['Buongiorno.', fa(7)], ['Il download è finito.', fa(1)]], 'senza il segno è un messaggio nuovo, alla sua ora');
});

test('si fonde solo un messaggio di Filo recente, di oggi, con niente in mezzo nel filo', () => {
  const saluto = chat('h', [m('filo', 'Buongiorno.', fa(10), { spontaneo: true })]);
  assert.equal(C.siFonde({ chats: [saluto] }, 'h', { ora: ORA }), true);
  assert.equal(C.siFonde({ chats: [chat('h', [m('filo', 'Buongiorno.', fa(5 * 60), { spontaneo: true })])] }, 'h', { ora: ORA }), false, 'ore dopo è un messaggio nuovo');
  const mezzanotte = new Date(2026, 9, 19, 0, 5).getTime();
  assert.equal(C.siFonde({ chats: [chat('h', [m('filo', 'x', new Date(2026, 9, 18, 23, 55).toISOString(), { spontaneo: true })])] }, 'h', { ora: mezzanotte }), false, 'mai fra un giorno e l’altro');
  assert.equal(C.siFonde({ chats: [saluto], pagine: [{ id: 'p', ts: fa(5), url: 'https://a.it/' }] }, 'h', { ora: ORA }), false, 'una pagina visitata in mezzo');
  assert.equal(C.siFonde({ chats: [saluto], cambi: [{ id: 'c', ts: fa(5), via: 'interfaccia' }] }, 'h', { ora: ORA }), false, 'un cambio fatto in mezzo');
  assert.equal(C.siFonde({ chats: [saluto, chat('e', [m('user', 'riassumi', fa(4))], { app: 'editor' })] }, 'h', { ora: ORA }), false, 'un messaggio altrove in mezzo');
  assert.equal(C.siFonde({ chats: [saluto], pagine: [{ id: 'p', ts: fa(20), url: 'https://a.it/' }] }, 'h', { ora: ORA }), true, 'quello che è venuto prima non conta');
  assert.equal(C.siFonde({ chats: [chat('h', [m('filo', 'Fatto.', fa(2))])] }, 'h', { ora: ORA }), false, 'una risposta non si riscrive');
});

test('Filo parla per primo: il secondo evento finisce nello stesso messaggio, e per il modello resta una lettura (#592.4)', async () => {
  const f = azzera();
  const chiesti = [];
  const annunci = [];
  Parla.collega({
    puoParlare: async () => true,
    genera: async ({ eventi, fondi, precedente }) => {
      chiesti.push({ eventi: eventi.map((e) => e.tipo), fondi, precedente });
      return { message: eventi.map((e) => `${e.tipo}: ${e.testo}`).join(' · '), suggestions: [] };
    },
    annuncia: (a) => annunci.push(a),
  });
  await Parla.giro({ subito: [{ tipo: 'timer', testo: 'timer «pasta»' }] });
  await Parla.giro({ subito: [{ tipo: 'download', testo: 'fattura.pdf' }] });
  const [c] = await f.chats();
  assert.equal(c.messages.length, 1);
  assert.equal(c.messages[0].text, 'timer: timer «pasta» · download: fattura.pdf');
  assert.deepEqual(chiesti[1], { eventi: ['timer', 'download'], fondi: true, precedente: 'timer: timer «pasta»' });
  assert.equal(annunci[1].fuso, true);
  assert.equal(annunci[1].i, 0);
  const lettura = FC.letturaDaFuori(c.messages[0]);
  assert.equal(lettura && lettura.type, 'TESTO_DI_FUORI', 'i nomi di file e sveglie dentro il messaggio non diventano parole di Filo');
  assert.equal(CA.toStoredMessage({ role: 'filo', text: 'x', spontaneo: true, motivi: [{ tipo: 'timer', testo: 't' }] }).spontaneo, true);
});

test('il prompt del messaggio dice perché Filo scrive, e quando sostituisce il suo messaggio di prima', () => {
  const P = globalThis.SN_CONST.PROMPTS;
  const eventi = globalThis.SN_ESTERNO.imbusta({ tipo: 'TESTO_SALVATO', conIntestazione: true, testo: '- è suonato timer «pasta»' });
  const p = P.filoDashboard({ eventi, fondi: true, ultimoMessaggio: 'Il timer è suonato.' });
  assert.match(p, /PERCHÉ SCRIVI ADESSO:[\s\S]*pasta/);
  assert.match(p, /scrivine UNO che dica tutto/);
  assert.match(p, /preparare la dashboard/);
  assert.match(P.filoDashboard({}), /message resta vuoto/);
});

// Misurato a 2,5 unità da solo (2.000 chat e 20.000 pagine), quasi 5 con la suite unit in parallelo: alloca molto, e il
// riferimento no. Un costo quadratico costerebbe centinaia di volte tanto: il tetto prende quello, non il carico.
const TETTO = 12;
test('con migliaia di eventi le righe e il pezzo da mostrare si fanno senza attesa', () => {
  const chats = [];
  for (let i = 0; i < 2000; i++) {
    const t0 = ORA - (2000 - i) * 3600000;
    chats.push(chat(`c${i}`, [m('user', `domanda ${i}`, new Date(t0).toISOString()), m('filo', `risposta ${i}`, new Date(t0 + 1000).toISOString())]));
  }
  const pagine = Array.from({ length: 20000 }, (_, i) => ({ id: `p${i}`, ts: new Date(ORA - (20000 - i) * 360000).toISOString(), url: `https://s${i % 50}.it/${i}`, titolo: `Pagina ${i}` }));
  let r = null;
  const c = costoInUnita(() => { r = C.pezzo(C.elementi({ chats, pagine, cambi: [], qui: 'qui' })); }, { tetto: TETTO });
  assert.ok(r.elementi.length > 0 && r.elementi.length <= C.PEZZO + 2);
  assert.ok(c.entro, c.come);
});

// #872 — la Cronologia non c'è più: una scheda chiusa ritrovata nel filo porta la sua voce d'archivio, così si riapre
// com'era (scroll, paese), anche quando la ricerca l'ha trovata fra le visite per il titolo.
test('una scheda chiusa ritrovata nel filo porta la sua voce d’archivio', () => {
  const C = globalThis.SN_FILO_CODA;
  const pagine = [{ id: 'v1', ts: '2026-09-01T10:00:00.000Z', url: 'https://a.test/orche', titolo: 'Orche' }];
  const schede = [
    { id: 'arch-vecchia', url: 'https://a.test/orche', title: 'Orche', closedAt: '2026-08-01T10:00:00.000Z' },
    { id: 'arch-nuova', url: 'https://a.test/orche', title: 'Orche', closedAt: '2026-09-01T11:00:00.000Z' },
    { id: 'arch-contenuto', url: 'https://b.test/', title: 'Altro', summary: 'branchi di orche nel nord', closedAt: '2026-08-02T10:00:00.000Z' },
  ];
  const r = C.cerca({ chats: [], pagine, schede }, 'orche');
  const titolo = r.pagine.find((p) => p.url === 'https://a.test/orche');
  assert.equal(titolo.archivio, 'arch-nuova');
  assert.equal(titolo.id, 'v1');
  const contenuto = r.pagine.find((p) => p.url === 'https://b.test/');
  assert.equal(contenuto.archivio, 'arch-contenuto');
  assert.ok(contenuto.estratto.includes('orche'));
  // Una visita entrata dall'archivio (le schede di prima del filo) lo dice da sé.
  const migrata = C.cerca({ chats: [], pagine: [{ id: 'v9', ts: '2026-01-01T00:00:00.000Z', url: 'https://c.test/', titolo: 'Delfini', archivio: 'arch-9' }], schede: [] }, 'delfini');
  assert.equal(migrata.pagine[0].archivio, 'arch-9');
});

test('una riga tardiva si posa subito dopo la sua chat, e chi chiede le novità la riceve lo stesso (#1295)', () => {
  const t = (s) => `2026-10-20T07:01:${s}.000Z`;
  const kant = { id: 'k', messages: [
    { role: 'user', text: 'Parlami di Kant', ts: t('01') },
    { role: 'user', text: '/sleep 4', ts: t('02') },
    { role: 'filo', text: 'ESITO', ts: t('10'), tardiva: true },
    { role: 'filo', text: 'ESITO 2', ts: t('11'), tardiva: true },
  ] };
  const carbonara = { id: 'c', messages: [{ role: 'user', text: 'Carbonara?', ts: t('05') }, { role: 'filo', text: 'Così.', ts: t('06') }] };
  const el = C.elementi({ chats: [kant, carbonara] });
  assert.deepEqual(el.map((e) => e.text), ['Parlami di Kant', '/sleep 4', 'ESITO', 'ESITO 2', 'Carbonara?', 'Così.']);
  const novita = C.pezzo(el, { dopo: t('06') }).elementi.map((e) => e.text);
  assert.deepEqual(novita, ['ESITO', 'ESITO 2']);
  // Senza il segno conta l'ora d'arrivo, come sempre.
  const senza = C.elementi({ chats: [{ ...kant, messages: kant.messages.map(({ tardiva, ...m }) => m) }, carbonara] });
  assert.deepEqual(senza.map((e) => e.text).slice(-2), ['ESITO', 'ESITO 2']);
  assert.equal(CA.toStoredMessage({ role: 'filo', text: 'x', tardiva: true }).tardiva, true);
  assert.equal(CA.toStoredMessage({ role: 'user', text: 'x', tardiva: true }).tardiva, undefined);
});
