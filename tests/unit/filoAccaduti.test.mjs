// #1561 — nel filo entrano azioni, cambi di stato, schede, ricerche, download, documenti dell'editor, timer, avvisi e
// sistema. Ogni evento nasce una volta, dal punto che scrive quello stato, e se ne va con quello che cancella la sua
// chat o le sue pagine. Niente Electron: il filo scrive in una cartella temporanea.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import '../../src/shared/chatArchive.js';
import '../../src/shared/filoEventi.js';
import '../../src/shared/sitiComuni.js';
import '../../src/shared/filoAccaduti.js';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.SN_CONST = { STORAGE_KEYS: { FILO_CHATS: 'filo_chats' } };
globalThis.chrome = { storage: { local: { async get(k) { return { [k]: undefined }; }, async set() {}, async remove() {} } } };

const { creaFilo } = require('../../src/main/services/ilFilo.js');
require('../../src/main/services/filoChats.js');
const E = globalThis.SN_FILO_EVENTI;
const A = globalThis.SN_FILO_ACCADUTI;
const Chats = globalThis.SN_FILO_CHATS;

const cartelle = new Set();
after(() => { for (const c of cartelle) togliCartella(c); });
function nuovo() {
  const cartella = cartellaTemporanea('filo-acc-');
  cartelle.add(cartella);
  const f = creaFilo({ cartella });
  globalThis.SN_IL_FILO = f;
  return { f, cartella, file: join(cartella, 'eventi.jsonl') };
}
const leggi = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
const scrivi = (f, tipo, campi, o = {}) => f.transazione((t) => t.scrivi([t.evento(tipo, campi, o)]), o.incognito != null ? { incognito: o.incognito } : undefined);

test('ogni tipo nuovo ha la sua forma: un evento senza i campi che lo dicono non entra', () => {
  const base = (tipo, campi) => E.crea(tipo, campi, { dispositivo: 'd' });
  const T = E.TIPI;
  assert.ok(E.valido(base(T.AZIONE, { nome: 'ZOOM_PAGINA', parametri: { percentuale: 150 }, esito: { eseguita: true } })));
  assert.ok(!E.valido(base(T.AZIONE, { nome: 'ZOOM_PAGINA' })), 'un\'azione senza esito');
  for (const t of [T.SCHEDA_APERTA, T.SCHEDA_CHIUSA, T.SCHEDA_DAVANTI]) {
    assert.ok(E.valido(base(t, { scheda: 's1' })));
    assert.ok(!E.valido(base(t, {})), `${t} senza la scheda`);
  }
  assert.ok(E.valido(base(T.RICERCA, { testo: 'orche' })));
  assert.ok(!E.valido(base(T.RICERCA, { testo: '' })));
  assert.ok(E.valido(base(T.DOWNLOAD, { scaricamento: '7', stato: 'finito', file: 'a.pdf' })));
  assert.ok(E.valido(base(T.FILE, { file: 'doc1', azione: 'scritto' })));
  assert.ok(E.valido(base(T.TIMER_SCATTATO, { timer: 't1' })));
  assert.ok(E.valido(base(T.NOTIFICA, { testo: 'Aggiornamento pronto' })));
  assert.ok(E.valido(base(T.SISTEMA, { cosa: 'rete', online: false })));
  assert.ok(E.valido(base(T.CAMBIO, { cambio: 'c1', ambito: 'impostazioni', cambi: [{ chiave: 'theme', prima: 'light', dopo: 'dark' }] })));
  assert.ok(!E.valido(base(T.CAMBIO, { cambio: 'c1', ambito: 'impostazioni', cambi: [{}] })), 'un cambio senza chiave');
});

test('un\'azione porta quello che è stato chiesto e com\'è andata, non i campi che Filo ci scrive sopra', () => {
  const action = { type: 'NAVIGA', url: 'https://example.com/', _callId: 'x', _output: { pagina: 'TESTO LUNGO' }, _executed: true };
  assert.deepEqual(A.parametriAzione(action), { url: 'https://example.com/' });
  assert.deepEqual(A.esitoAzione({ executed: true, output: { pagina: 'TESTO LUNGO' } }, { fatto: 'Aperta example.com', cambi: [{ id: 'c1' }] }),
    { eseguita: true, fatto: 'Aperta example.com', cambi: ['c1'] });
  assert.deepEqual(A.esitoAzione({ executed: false, needsConfirm: 2 }), { eseguita: false, chiede: 2 });
  assert.deepEqual(A.esitoAzione({ executed: false, rejected: true, error: 'argomenti sbagliati' }), { eseguita: false, rifiutata: true, errore: 'argomenti sbagliati' });
  assert.deepEqual(A.esitoAzione({ executed: false, output: { blocked: 'segreto' } }), { eseguita: false, fermata: 'segreto' });
  assert.deepEqual(A.esitoAzione(null), { eseguita: false });
  assert.ok(!JSON.stringify(A.esitoAzione({ executed: true, output: { pagina: 'TESTO LUNGO' } })).includes('TESTO LUNGO'), 'il contenuto letto non va su disco');
});

test('una pagina di risultati è una ricerca, con le parole cercate; una pagina qualsiasi no', () => {
  assert.deepEqual(A.ricercaNellIndirizzo('https://www.google.com/search?q=orche+assassine&sca_esv=1&source=hp'), { testo: 'orche assassine', sito: 'Google' });
  assert.deepEqual(A.ricercaNellIndirizzo('https://www.youtube.com/results?search_query=jazz'), { testo: 'jazz', sito: 'YouTube' });
  assert.deepEqual(A.ricercaNellIndirizzo('https://www.amazon.it/s?k=zaino&ref=nb'), { testo: 'zaino', sito: 'Amazon' });
  assert.deepEqual(A.ricercaNellIndirizzo('https://negozio.example/search?q=scarpe%20rosse'), { testo: 'scarpe rosse', sito: 'negozio.example' });
  assert.equal(A.ricercaNellIndirizzo('https://www.google.com/maps/place/Roma'), null);
  assert.equal(A.ricercaNellIndirizzo('https://www.google.com/search?q=%20%20'), null, 'una ricerca vuota non è una ricerca');
  assert.equal(A.ricercaNellIndirizzo('https://it.wikipedia.org/wiki/Orca'), null);
  assert.equal(A.ricercaNellIndirizzo('filo://newtab/'), null);
  assert.equal(A.ricercaNellIndirizzo('non è un indirizzo'), null);
});

test('il sistema: rete caduta e tornata, batteria sotto la soglia una volta, Bluetooth collegato; non ogni punto di batteria', () => {
  const s = (o) => ({ rete: { online: true, nome: 'Casa' }, batteria: { livello: 50, collegata: false, inCarica: false }, bluetooth: { acceso: true, dispositivi: [] }, ...o });
  assert.deepEqual(A.cambiSistema(s(), s({ rete: { online: false } })), [{ cosa: 'rete', online: false }]);
  assert.deepEqual(A.cambiSistema(s({ rete: { online: false } }), s()), [{ cosa: 'rete', online: true, nome: 'Casa' }]);
  assert.deepEqual(A.cambiSistema(s({ batteria: { livello: 50 } }), s({ batteria: { livello: 49 } })), [], 'un punto di batteria non è un evento');
  assert.deepEqual(A.cambiSistema(s({ batteria: { livello: 16 } }), s({ batteria: { livello: 15 } })), [{ cosa: 'batteria', livello: 15, soglia: 15 }]);
  assert.deepEqual(A.cambiSistema(s({ batteria: { livello: 15 } }), s({ batteria: { livello: 14 } })), [], 'la soglia passata non si ripete');
  assert.deepEqual(A.cambiSistema(s({ batteria: { livello: 30 } }), s({ batteria: { livello: 4 } })), [{ cosa: 'batteria', livello: 4, soglia: 5 }]);
  assert.deepEqual(A.cambiSistema(s({ batteria: { livello: 16 } }), s({ batteria: { livello: 15, collegata: true, inCarica: true } })), [], 'in carica non si avvisa');
  assert.deepEqual(A.cambiSistema(s(), s({ bluetooth: { acceso: true, dispositivi: ['Cuffie'] } })), [{ cosa: 'bluetooth', dispositivo: 'Cuffie', collegato: true }]);
  assert.deepEqual(A.cambiSistema(s({ bluetooth: { acceso: true, dispositivi: ['Cuffie'] } }), s()), [{ cosa: 'bluetooth', dispositivo: 'Cuffie', collegato: false }]);
  assert.deepEqual(A.cambiSistema(s({ bluetooth: { acceso: true, dispositivi: null } }), s({ bluetooth: { acceso: true, dispositivi: ['Cuffie'] } })), [], 'da «non so» non si deduce un collegamento');
  assert.deepEqual(A.cambiSistema(null, s()), [], 'senza una lettura prima non è successo niente');
});

test('l\'editor: aperto, creato, rinominato, tolto; una sessione di scrittura è un evento, non uno per salvataggio', () => {
  const doc = (id, title, modified) => ({ id, meta: { title, modified } });
  const raffiche = new Map();
  const c0 = { activeId: 'a', files: [doc('a', 'Tesi', '1'), doc('b', 'Ricette', '1')] };
  assert.deepEqual(A.cambiEditor(undefined, c0, { raffiche }), [], 'la prima copia della collezione non è successa adesso');
  let adesso = 1_000_000;
  const c1 = { ...c0, activeId: 'b' };
  assert.deepEqual(A.cambiEditor(c0, c1, { raffiche, adesso }), [{ file: 'b', azione: 'aperto', titolo: 'Ricette' }]);
  const scritto = (n) => ({ activeId: 'b', files: [doc('a', 'Tesi', '1'), doc('b', 'Ricette', String(n))] });
  assert.deepEqual(A.cambiEditor(c1, scritto(2), { raffiche, adesso: adesso += 2000 }), [{ file: 'b', azione: 'scritto', titolo: 'Ricette' }]);
  for (let n = 3; n < 30; n++) assert.deepEqual(A.cambiEditor(scritto(n - 1), scritto(n), { raffiche, adesso: adesso += 3000 }), [], 'ogni pausa salva: non è un evento');
  adesso += A.RAFFICA_MS + 1;
  assert.equal(A.cambiEditor(scritto(30), scritto(31), { raffiche, adesso }).length, 1, 'dopo una pausa lunga è una sessione nuova');
  const nuovo = { activeId: 'c', files: [...scritto(31).files, doc('c', 'Senza titolo', '1')] };
  assert.deepEqual(A.cambiEditor(scritto(31), nuovo, { raffiche, adesso }), [{ file: 'c', azione: 'creato', titolo: 'Senza titolo' }]);
  const rinominato = { activeId: 'c', files: [...scritto(31).files, doc('c', 'Lettera', '1')] };
  assert.deepEqual(A.cambiEditor(nuovo, rinominato, { raffiche, adesso }), [{ file: 'c', azione: 'rinominato', titolo: 'Lettera', prima: 'Senza titolo' }]);
  assert.deepEqual(A.cambiEditor(rinominato, scritto(31), { raffiche, adesso }), [{ file: 'c', azione: 'tolto', titolo: 'Lettera' }],
    'tornare al documento appena lasciato non è un\'apertura nuova');
  // Due editor aperti salvano a turno ognuno col suo documento davanti: non è un'apertura a ogni salvataggio.
  const r2 = new Map();
  const conA = { activeId: 'a', files: c0.files };
  const conB = { activeId: 'b', files: c0.files };
  let t = 5_000_000;
  const aperture = [];
  for (let i = 0; i < 10; i++) aperture.push(...A.cambiEditor(i % 2 ? conB : conA, i % 2 ? conA : conB, { raffiche: r2, adesso: t += 4000 }));
  assert.ok(aperture.length <= 2, `due editor a turno hanno fatto ${aperture.length} aperture`);
});

test('l\'editor: il documento rimesso davanti dall\'utente, anche subito e solo per leggerlo, è un\'apertura; due editor con la loro ora vecchia no', () => {
  const doc = (id, title) => ({ id, meta: { title, modified: '1' } });
  const files = [doc('a', 'Lettera al relatore'), doc('b', 'Ricette')];
  const raffiche = new Map();
  let adesso = 1_000_000;
  const su = (activeId, apertoAlle) => ({ activeId, files, ...(apertoAlle ? { apertoAlle } : {}) });
  const t = (s) => `2026-10-22T10:00:${String(s).padStart(2, '0')}.000Z`;
  A.cambiEditor(su('a'), su('b', t(1)), { raffiche, adesso });
  assert.deepEqual(A.cambiEditor(su('b', t(1)), su('a', t(3)), { raffiche, adesso: adesso += 2000 }),
    [{ file: 'a', azione: 'aperto', titolo: 'Lettera al relatore' }], 'tornato alla lettera dopo due secondi');
  assert.deepEqual(A.cambiEditor(su('a', t(3)), su('a', t(9)), { raffiche, adesso: adesso += 2000 }),
    [{ file: 'a', azione: 'aperto', titolo: 'Lettera al relatore' }], 'l\'Editor riaperto sullo stesso documento');
  // Due editor a turno, ognuno con l'ora della sua ultima apertura.
  const aperture = [];
  for (let i = 0; i < 10; i++) {
    aperture.push(...A.cambiEditor(i % 2 ? su('b', t(9)) : su('a', t(8)), i % 2 ? su('a', t(8)) : su('b', t(9)), { raffiche, adesso: adesso += 4000 }));
  }
  assert.deepEqual(aperture, [], 'nessuna ora nuova, nessuna apertura');
});

test('azioni, schede e ricerche entrano in coda e si rileggono in ordine; un id già visto non entra due volte', async () => {
  const { f, file } = nuovo();
  await scrivi(f, E.TIPI.SCHEDA_APERTA, { scheda: 's1', davanti: true }, { autore: 'utente' });
  await scrivi(f, E.TIPI.AZIONE, { nome: 'ZOOM_PAGINA', parametri: { percentuale: 150 }, esito: { eseguita: true }, via: 'chat', chat: 'c1' }, { autore: 'filo' });
  await scrivi(f, E.TIPI.TIMER_SCATTATO, { timer: 't1', nome: 'pasta' }, { autore: 'automazione', id: 'timer:t1:2026' });
  await scrivi(f, E.TIPI.TIMER_SCATTATO, { timer: 't1', nome: 'pasta' }, { autore: 'automazione', id: 'timer:t1:2026' });
  await scrivi(f, E.TIPI.SCHEDA_CHIUSA, { scheda: 's1' }, { autore: 'utente' });
  const acc = await f.accaduti();
  assert.deepEqual(acc.map((e) => e.tipo), ['scheda.aperta', 'azione', 'timer.scattato', 'scheda.chiusa']);
  assert.equal(leggi(file).split('\n').filter((r) => r.includes('timer.scattato')).length, 1, 'il timer che suonava già prima della riapertura è scritto una volta');
  assert.deepEqual((await f.accaduti({ tipi: ['scheda.aperta', 'scheda.chiusa'] })).map((e) => e.scheda), ['s1', 's1']);
  // Riaperto il filo dal disco, gli stessi eventi.
  const g = creaFilo({ cartella: dirname(file) });
  assert.deepEqual((await g.accaduti()).map((e) => e.id), acc.map((e) => e.id));
});

test('cancellare una chat porta via anche le sue azioni e le sue ricerche, dal disco e dalla memoria', async () => {
  const { f, file } = nuovo();
  await Chats.append('via', { role: 'user', text: 'cerca SEGRETO-CHAT' });
  await scrivi(f, E.TIPI.AZIONE, { nome: 'CERCA_WEB', parametri: { query: 'SEGRETO-CHAT' }, esito: { eseguita: true }, chat: 'via' }, { autore: 'filo' });
  await scrivi(f, E.TIPI.RICERCA, { testo: 'SEGRETO-CHAT', dove: 'web', chat: 'via' }, { autore: 'filo' });
  await scrivi(f, E.TIPI.AZIONE, { nome: 'ZOOM_PAGINA', parametri: {}, esito: { eseguita: true }, chat: 'resta' }, { autore: 'filo' });
  await Chats.remove('via');
  assert.ok(!leggi(file).includes('SEGRETO-CHAT'), 'il testo della chat cancellata è ancora su disco');
  assert.deepEqual((await f.accaduti()).map((e) => e.chat), ['resta']);
  // L'azione che l'ha cancellata arriva dopo la cancellazione, col titolo nel suo esito: se ne va con lei.
  await scrivi(f, E.TIPI.AZIONE, {
    nome: 'TOGLI_CHAT', parametri: { per_sempre: true }, esito: { eseguita: true, fatto: 'Cancellata per sempre la conversazione «SEGRETO-CHAT»' }, chat: 'via',
  }, { autore: 'filo' });
  assert.ok(!leggi(file).includes('SEGRETO-CHAT'), 'l\'azione arrivata dopo la cancellazione ha riscritto il titolo su disco');
  assert.deepEqual((await f.accaduti()).map((e) => e.chat), ['resta']);
});

test('un accaduto di una chat cancellata, rimasto sul disco dopo la cancellazione, se ne va alla riapertura', async () => {
  const { f, file } = nuovo();
  await Chats.append('tarda', { role: 'user', text: 'ciao' });
  await Chats.remove('tarda');
  const tardo = E.crea(E.TIPI.AZIONE, { nome: 'TOGLI_CHAT', parametri: {}, esito: { eseguita: true, fatto: 'TITOLO-TARDIVO' }, chat: 'tarda' },
    { autore: 'filo', dispositivo: 'd' });
  appendFileSync(file, E.riga(tardo));
  const g = creaFilo({ cartella: dirname(file) });
  assert.deepEqual((await g.accaduti()).map((e) => e.chat), []);
  assert.ok(!leggi(file).includes('TITOLO-TARDIVO'), 'la riapertura non ha tolto l\'accaduto della chat cancellata');
  assert.ok(leggi(file).includes('"cancellazione"'), 'la cancellazione resta per gli altri dispositivi');
});

test('cancellare le pagine porta via le ricerche fatte su quei siti, i download e le ricerche di Filo del periodo', async () => {
  const { f, file } = nuovo();
  const ora = Date.now();
  const iso = (msFa) => new Date(ora - msFa).toISOString();
  await f.registraVisita({ url: 'https://www.google.com/search?q=PAROLE-CERCATE&hl=it', titolo: 'PAROLE-CERCATE - Cerca con Google', ts: iso(10 * 60e3) });
  await f.registraVisita({ url: 'https://www.youtube.com/results?search_query=orche', titolo: 'YouTube', ts: iso(5 * 60e3) });
  await scrivi(f, E.TIPI.DOWNLOAD, { scaricamento: '1', stato: 'finito', file: 'FILE-SCARICATO.pdf', url: 'https://files.example/a.pdf' }, { ts: iso(8 * 60e3) });
  await scrivi(f, E.TIPI.RICERCA, { testo: 'RICERCA-DI-FILO', dove: 'web' }, { ts: iso(7 * 60e3), autore: 'filo' });
  await scrivi(f, E.TIPI.SCHEDA_APERTA, { scheda: 's1' }, { ts: iso(9 * 60e3) });
  const cercate = (await f.accaduti({ tipi: ['ricerca'] })).filter((e) => e.dove === 'sito');
  assert.deepEqual(cercate.map((e) => [e.testo, e.sito]), [['PAROLE-CERCATE', 'Google'], ['orche', 'YouTube']]);
  // Con un sito: se ne va la sua visita con la sua ricerca, il resto resta.
  await f.cancellaPagine({ da: null, a: null, sito: 'google.com' });
  assert.ok(!leggi(file).includes('PAROLE-CERCATE'), 'la ricerca fatta su Google è rimasta su disco');
  assert.ok(leggi(file).includes('RICERCA-DI-FILO') && leggi(file).includes('FILE-SCARICATO'));
  // L'ultima ora: anche download e ricerche di Filo; le schede restano (dicono solo quale scheda).
  await f.cancellaPagine(E.periodo('ultima_ora', { ora: new Date(ora + 1000) }));
  const testo = leggi(file);
  for (const x of ['orche', 'FILE-SCARICATO', 'RICERCA-DI-FILO']) assert.ok(!testo.includes(x), `${x} è ancora su disco`);
  assert.deepEqual((await f.accaduti()).map((e) => e.tipo), ['scheda.aperta']);
});

test('cancellare le pagine porta via anche le azioni di Filo: del periodo, e con un sito quelle che ne nominano un indirizzo', async () => {
  const { f, file } = nuovo();
  const ora = Date.now();
  const iso = (msFa) => new Date(ora - msFa).toISOString();
  const azione = (parametri, msFa) => scrivi(f, E.TIPI.AZIONE, { nome: 'X', parametri, esito: { eseguita: true }, via: 'assistente' }, { ts: iso(msFa), autore: 'filo' });
  await azione({ url: 'https://www.CLINICA-ESEMPIO.it/VISITA-PRENOTATA' }, 9 * 60e3);
  await azione({ indirizzo: 'clinica-esempio.it/ORARI-DEL-REPARTO' }, 8 * 60e3);
  await azione({ url: 'https://altro-sito.example/pagina' }, 7 * 60e3);
  await azione({ query: 'GOTTA-CERCATA' }, 6 * 60e3);
  await azione({ query: 'DI-IERI' }, 26 * 60 * 60e3);
  await f.cancellaPagine({ da: null, a: null, sito: 'clinica-esempio.it' });
  assert.ok(!/VISITA-PRENOTATA|ORARI-DEL-REPARTO/.test(leggi(file)), 'un\'azione con l\'indirizzo del sito cancellato è rimasta su disco');
  assert.ok(leggi(file).includes('altro-sito') && leggi(file).includes('GOTTA-CERCATA'));
  await f.cancellaPagine(E.periodo('ultima_ora', { ora: new Date(ora + 1000) }));
  assert.ok(!leggi(file).includes('GOTTA-CERCATA') && !leggi(file).includes('altro-sito'), 'le azioni dell\'ultima ora sono rimaste');
  assert.deepEqual((await f.accaduti()).map((e) => e.parametri.query), ['DI-IERI']);
});

test('cancellare le pagine porta via anche gli avvisi: del periodo, e con un sito quelli che nascono da lui o lo nominano', async () => {
  const { f, file } = nuovo();
  const ora = Date.now();
  const iso = (msFa) => new Date(ora - msFa).toISOString();
  const avviso = (campi, msFa) => scrivi(f, E.TIPI.NOTIFICA, { genere: 'finestra', ...campi }, { ts: iso(msFa), autore: 'filo' });
  await avviso({ testo: 'Scaricato: REFERTO-CLINICA.pdf', url: 'https://files.clinica-esempio.it/r.pdf' }, 9 * 60e3);
  await avviso({ testo: 'Sito bloccato: casino-esempio.com · pubblicità e tracciamento' }, 8 * 60e3);
  await avviso({ testo: 'Schede riordinate' }, 7 * 60e3);
  await avviso({ testo: 'Aggiornamento DI-IERI pronto' }, 26 * 60 * 60e3);
  await f.cancellaPagine({ da: null, a: null, sito: 'clinica-esempio.it' });
  assert.ok(!leggi(file).includes('REFERTO-CLINICA'), 'l\'avviso dello scaricamento dal sito cancellato è rimasto su disco');
  await f.cancellaPagine({ da: null, a: null, sito: 'casino-esempio.com' });
  assert.ok(!leggi(file).includes('Sito bloccato'), 'l\'avviso che nomina il sito cancellato è rimasto su disco');
  assert.ok(leggi(file).includes('Schede riordinate'));
  await f.cancellaPagine(E.periodo('ultima_ora', { ora: new Date(ora + 1000) }));
  assert.ok(!leggi(file).includes('Schede riordinate'), 'gli avvisi dell\'ultima ora sono rimasti');
  assert.deepEqual((await f.accaduti()).map((e) => e.testo), ['Aggiornamento DI-IERI pronto']);
  // Uno che arriva dopo la cancellazione, nel suo periodo, non entra.
  await avviso({ testo: 'Scaricato: TARDIVO.pdf', url: 'https://files.clinica-esempio.it/t.pdf' }, 30 * 60e3);
  assert.ok(!leggi(file).includes('TARDIVO'));
});

test('dall\'incognito gli accaduti restano in memoria', async () => {
  const { f, file } = nuovo();
  await scrivi(f, E.TIPI.SCHEDA_APERTA, { scheda: 'segreta' }, { incognito: true });
  await f.registraVisita({ url: 'https://www.google.com/search?q=CERCATO-IN-INCOGNITO', titolo: 'x' }, { incognito: true });
  assert.ok(!leggi(file).includes('segreta') && !leggi(file).includes('CERCATO-IN-INCOGNITO'));
  assert.equal((await f.accaduti({}, { incognito: true })).length, 2);
  assert.equal((await f.accaduti({}, { incognito: false })).length, 0);
});

test('i cambi di stato nel filo: un ritocco della stessa cosa riscrive il cambio con un evento in coda, tornato com\'era lo ritira', async () => {
  const { f, file } = nuovo();
  const voce = (cambi, o = {}) => ({ id: 'c0000000001', ts: '2026-10-21T10:00:00.000Z', tipo: 'zoom', via: 'interfaccia', dove: 'zoom', cambi, ...o });
  await f.transazione((t) => t.scrivi([E.eventoCambio(voce([{ chiave: 'zoom:a.it', prima: 100, dopo: 125 }]), { dispositivo: t.dispositivo })]));
  const prima = leggi(file);
  await f.transazione((t) => t.scrivi([E.eventoCambio(voce([{ chiave: 'zoom:a.it', prima: 100, dopo: 150 }]), { dispositivo: t.dispositivo, fonde: true, ts: '2026-10-21T10:00:30.000Z' })]));
  assert.ok(leggi(file).startsWith(prima), 'il filo si è riscritto invece di crescere in coda');
  assert.deepEqual(await f.cambi(), [{ ...voce([{ chiave: 'zoom:a.it', prima: 100, dopo: 150 }]), agg: '2026-10-21T10:00:30.000Z' }]);
  await f.transazione((t) => t.scrivi([E.eventoCambio(voce([]), { dispositivo: t.dispositivo, fonde: true, ts: '2026-10-21T10:01:00.000Z' })]));
  assert.deepEqual(await f.cambi(), [], 'tornato al valore di partenza, il cambio se ne va');
  const g = creaFilo({ cartella: dirname(file) });
  assert.deepEqual(await g.cambi(), [], 'riaperto il filo, idem');
});

test('il registro dei cambi di prima entra nel filo intero, coi ritocchi, e una seconda volta non duplica', () => {
  const lista = [
    { id: 'c1', ts: '2026-09-01T10:00:00.000Z', tipo: 'impostazioni', via: 'chat', cambi: [{ chiave: 'theme', prima: 'light', dopo: 'dark' }] },
    { id: 'c2', ts: '2026-09-02T10:00:00.000Z', agg: '2026-09-02T10:01:00.000Z', tipo: 'zoom', via: 'interfaccia', dove: 'zoom', cambi: [{ chiave: 'zoom:a.it', prima: 100, dopo: 150 }] },
    { id: 'c3', ts: '2026-09-03T10:00:00.000Z', tipo: 'impostazioni', via: 'interfaccia', annulla: 'c1', cambi: [{ chiave: 'theme', prima: 'dark', dopo: 'light' }] },
    { id: 'c4', ts: '2026-09-04T10:00:00.000Z', tipo: 'impostazioni', via: 'chat', cambi: [{ chiave: 'apiKeys.openrouter', segreto: true, vuotoPrima: true, vuotoDopo: false }] },
  ];
  const eventi = E.daCambiSalvati(lista, { dispositivo: 'd' });
  const st = E.nuovoStato();
  for (const ev of eventi) E.applica(st, ev);
  assert.deepEqual(E.cambiDi(st), lista);
  assert.deepEqual(E.daCambiSalvati(lista, { dispositivo: 'd', gia: new Set(lista.map((e) => e.id)) }), []);
  assert.deepEqual(eventi.map((e) => e.autore), ['filo', 'utente', 'utente', 'utente', 'filo']);
});

test('l\'import di un backup porta gli accaduti ma non i cambi di quell\'installazione', async () => {
  const { f } = nuovo();
  await scrivi(f, E.TIPI.SCHEDA_APERTA, { scheda: 's1' });
  await f.transazione((t) => t.scrivi([E.eventoCambio({ id: 'c9', ts: new Date().toISOString(), tipo: 'impostazioni', via: 'chat', cambi: [{ chiave: 'theme', prima: 'light', dopo: 'dark' }] }, { dispositivo: t.dispositivo })]));
  const backup = await f.esporta();
  const { f: g } = nuovo();
  await g.importa(backup);
  assert.equal((await g.accaduti()).length, 1);
  assert.deepEqual(await g.cambi(), []);
});

// ── Ognuno nasce una volta sola, dal punto che scrive quello stato ──────────────────────────────────────────────────
function sorgenti() {
  const out = [];
  const giro = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) giro(p);
      else if (e.endsWith('.js')) out.push(p);
    }
  };
  giro(join(ROOT, 'src'));
  return out.map((p) => ({ p: relative(ROOT, p).replace(/\\/g, '/'), testo: readFileSync(p, 'utf8') }));
}

test('ogni accaduto ha un punto solo da cui nasce', () => {
  const tutti = sorgenti();
  const chi = (re) => tutti.filter((s) => re.test(s.testo)).map((s) => s.p).sort();
  const PORTE = {
    azione: [/accaduti'\)\.azione\(/, ['src/main/services/handlers.js']],
    // Volume, Wi-Fi e Bluetooth: dalla porta che chat e tasti della home condividono.
    comandoSistema: [/accaduti'\)\.comandoSistema\(/, ['src/main/services/comandiSistema.js']],
    ricerca: [/SN_ACCADUTI\?\.ricerca\(|accaduti'\)\.ricerca\(/, ['src/main/services/webSearch.js']],
    download: [/accaduti'\)\.download\(/, ['src/main/services/downloads.js']],
    timerScattato: [/accaduti'\)\.timerScattato\(/, ['src/main/services/alarmWatcher.js']],
    notifica: [/SN_ACCADUTI\?\.notifica\(|accaduti'\)\.notifica\(/, ['src/shared/filoMemory.js']],
    // Gli avvisi fuori dalla home: quelli brevi spinti alle pagine, e ogni carta che la cornice mette a schermo.
    avviso: [/accaduti'\)\.avviso\(/, ['src/main/services/impostazioniPerOrigine.js']],
    avvisoInCornice: [/accaduti'\)\.avvisoInCornice\(/, ['src/main/avvisiSopraPagina.js']],
    // Un'azione che chat e tasti fanno dallo stesso punto la scrive quel punto.
    azioneFatta: [/accaduti'\)\.azioneFatta\(/, ['src/main/services/layoutIcone.js']],
    sistema: [/accaduti'\)\.sistema\(/, ['src/main/services/statoSistema.js']],
    schede: [/_nelFilo\('scheda(Aperta|Chiusa|Davanti)'/, ['src/main/tabs.js']],
  };
  for (const [nome, [re, attesi]] of Object.entries(PORTE)) assert.deepEqual(chi(re), attesi, `${nome} nasce da più punti`);
  // Il resto del codice non scrive accaduti da sé: passa dalle porte.
  const diretti = tutti.filter((s) => s.p !== 'src/main/services/accaduti.js' && s.p !== 'src/main/services/ilFilo.js'
    && /TIPI\(?\)?\.(AZIONE|SCHEDA_APERTA|SCHEDA_CHIUSA|SCHEDA_DAVANTI|RICERCA|DOWNLOAD|FILE|TIMER_SCATTATO|NOTIFICA|SISTEMA)\b/.test(s.testo)
    && s.p !== 'src/shared/filoEventi.js');
  assert.deepEqual(diretti.map((s) => s.p), []);
  // La ricerca letta nell'indirizzo nasce con la visita, nello stesso punto.
  const ilFilo = tutti.find((s) => s.p === 'src/main/services/ilFilo.js').testo;
  assert.equal((ilFilo.match(/TIPI\.RICERCA/g) || []).length, 1);
  // Un'azione entra una volta per esecuzione: executeFiloAction la manda, nessun altro.
  const handlers = tutti.find((s) => s.p === 'src/main/services/handlers.js').testo;
  assert.equal((handlers.match(/azioneNelFilo\(action, finale/g) || []).length, 1);
  // Le porte dell'Aiuto che non passano da executeFiloAction (ricerca web, documenti, barra) la mandano da sé.
  assert.deepEqual(chi(/ctx\.azioneDellAiuto\(/),
    ['src/main/services/handlers/ai.js', 'src/main/services/handlers/file.js', 'src/main/services/handlers/nav.js']);
  // Ogni strada che toglie una scheda la dice chiusa, una volta.
  const tabs = tutti.find((s) => s.p === 'src/main/tabs.js').testo;
  assert.equal((tabs.match(/_nelFilo\('schedaChiusa'/g) || []).length, (tabs.match(/_avvisaSorvegliante\(tab, 'chiusa'\)/g) || []).length);
  // I cambi li scrive il registro, e la migrazione del registro di prima.
  assert.deepEqual(chi(/eventoCambio\(|daCambiSalvati\(/).filter((p) => p !== 'src/shared/filoEventi.js'),
    ['src/main/services/ilFilo.js', 'src/main/services/registroCambi.js']);
});

test('il registro dei cambi non scrive più in storage.json', () => {
  const registro = readFileSync(join(ROOT, 'src', 'main', 'services', 'registroCambi.js'), 'utf8');
  assert.doesNotMatch(registro, /FILO_CAMBI/);
});

// Dove nasce il segno di ogni azione del catalogo quando a farla è l'utente coi tasti di Filo (#1561): chat e
// interfaccia non divergono. Un'azione nuova si mette qui, e se ha un tasto suo il tasto la dichiara.
const SEGNO_DAI_TASTI = {
  // Il messaggio del tasto la dichiara (GESTI in src/shared/filoAccaduti.js).
  gesto: ['INVIA_FEEDBACK', 'TOGLI_PERMESSO_SITO', 'EVENTO_CALENDARIO', 'DIMENTICA', 'CORREGGI_MEMORIA',
    'NON_TENERE_APERTA', 'CARTA_HOME', 'INSTALLA_AGGIORNAMENTO', 'CANCELLA_ARCHIVIO'],
  // Chat e tasti passano dallo stesso punto, che scrive l'azione: aprire un file, dargli un nome, instradare una scheda.
  punto: ['VOLUME', 'BLUETOOTH', 'WIFI', 'SPOSTA_ICONA', 'APRI_FILE', 'RINOMINA_FILE', 'PROXY_TAB', 'RIMUOVI_PROXY'],
  // Dai tasti passa dalla porta delle azioni, come la chat.
  porta: ['PULISCI_TAB'],
  // Dai tasti lascia lo stato che scrive: un cambio, una scheda, un documento, una cancellazione, una ricerca.
  stato: ['NAVIGA', 'TIMER', 'SVEGLIA', 'CANCELLA_SVEGLIA', 'MODIFICA_SVEGLIA', 'SALVA_APPUNTO', 'CERCA_WEB', 'APRI_SALVATA',
    'CANCELLA_PAGINE', 'TOGLI_CHAT', 'RIMETTI_CHAT', 'IMPOSTA_PREFERENZA', 'IMPOSTA_ESTETICA', 'REGOLA_PROXY_DOMINIO',
    'RIMUOVI_REGOLA_PROXY', 'ANNULLA_CAMBIO', 'ZOOM_PAGINA', 'RIMEDIO_CREDITI', 'CHIUDI_SCHEDE'],
  // I tasti della finestra sono gesti, non azioni di Filo.
  barra: ['COMANDO_FINESTRA', 'ACCOUNT'],
  // Nessun tasto la fa: letture, proposte e comandi che si chiedono solo a parole.
  soloFilo: ['SALVA_LEZIONE', 'ONBOARDING', 'CAPACITA_DETTAGLIO', 'LEGGI_IMPOSTAZIONI', 'CERCA_CHAT',
    'CERCA_SALVATE', 'LEGGI_FILE', 'LEGGI_DOCUMENTO', 'LEGGI_PAGINA', 'VEDI_SCHERMO', 'CERCA_DOCUMENTI', 'LEGGI_TRASPARENZA',
    'CANCELLA_MEMORIA', 'ESEGUI_COMANDO', 'RIMUOVI_PROXY_TUTTE', 'TIENI_APERTA', 'STILE_PAGINA', 'RIPRISTINA_STILE_PAGINA',
    'ORDINA_DESKTOP'],
};

test('ogni azione del catalogo dice dove nasce il suo segno quando la fa l\'utente coi tasti, e ogni tasto dichiarato esiste', () => {
  const livelli = readFileSync(join(ROOT, 'src', 'shared', 'actionLevels.js'), 'utf8');
  const registro = livelli.slice(livelli.indexOf('REGISTRY'), livelli.indexOf('LETTURE'));
  const catalogo = [...registro.matchAll(/^ {4}([A-Z_]+): \{/gm)].map((m) => m[1]).sort();
  assert.ok(catalogo.length > 40, 'il catalogo si legge');
  const dichiarate = Object.values(SEGNO_DAI_TASTI).flat();
  assert.deepEqual([...new Set(dichiarate)].sort(), [...dichiarate].sort(), 'un\'azione sta in un posto solo');
  assert.deepEqual([...dichiarate].sort(), catalogo, 'un\'azione nuova del catalogo dice dove nasce il suo segno dai tasti');

  // Ogni azione «gesto» ha un tasto che la dichiara, e ogni tasto dichiara un'azione del catalogo.
  const prova = { percorso: '/tmp/a.pdf', testo: 'x', sempreAperta: 'a.it', payload: { text: 'x' }, evento: { titolo: 'x' }, mossa: { tipo: 'togli' }, ids: ['a'], country: 'fr', id: 'i' };
  const dichiarateDaiTasti = new Set();
  for (const [tipo, g] of Object.entries(A.GESTI)) {
    const a = g.azione(prova);
    assert.ok(a && catalogo.includes(a.type), `${tipo} dichiara un'azione del catalogo`);
    dichiarateDaiTasti.add(a.type);
  }
  assert.deepEqual([...dichiarateDaiTasti].sort(), [...SEGNO_DAI_TASTI.gesto].sort());

  // Il tasto esiste davvero: un messaggio che il main ascolta.
  const messaggi = readFileSync(join(ROOT, 'src', 'shared', 'messages.js'), 'utf8');
  const nomeDi = new Map([...messaggi.matchAll(/^ {4}([A-Z_0-9]+): '([a-z_0-9:]+)'/gm)].map((m) => [m[2], m[1]]));
  const tutti = sorgenti();
  for (const tipo of Object.keys(A.GESTI)) {
    const nome = nomeDi.get(tipo);
    assert.ok(nome, `${tipo} è un messaggio`);
    assert.ok(tutti.some((s) => s.p.startsWith('src/main/services/handlers') && new RegExp(`\\bon\\(MSG\\.${nome}\\b`).test(s.testo)), `${nome} ha chi lo ascolta`);
  }
});

// Il punto che fa la cosa scrive l'azione per tutte le strade (#1561): ogni file del main che apre un file col sistema
// lo segna, e il nome e l'instradamento nascono dove si fanno.
test('aprire un file, dargli un nome e instradare una scheda lasciano l\'azione dal punto che lo fa, per tutte le strade', () => {
  const tutti = sorgenti();
  const apronoFile = tutti.filter((s) => s.p.startsWith('src/main/') && /shell\.openPath\(/.test(s.testo)).map((s) => s.p);
  // Il calendario apre il suo .ics, la cartella di uno scaricamento è una cartella, i test non aprono niente.
  const nonFile = ['src/main/services/handlers/filo.js', 'src/main/test-window-mode.js'];
  for (const p of apronoFile.filter((x) => !nonFile.includes(x))) {
    assert.match(tutti.find((s) => s.p === p).testo, /\.fileAperto\(/, `${p} apre un file: lo segna nel filo`);
  }
  const testo = (p) => tutti.find((s) => s.p === p).testo;
  assert.match(testo('src/main/services/nomiFile.js'), /azioneDalPunto\('RINOMINA_FILE'/);
  assert.match(testo('src/main/tabs.js'), /azioneDalPunto\('PROXY_TAB'/);
  assert.match(testo('src/main/tabs.js'), /azioneDalPunto\('RIMUOVI_PROXY'/);
  for (const g of ['file_apri', 'tabs:set-proxy', 'tabs:clear-proxy']) assert.ok(!(g in A.GESTI), `${g}: il segno nasce nel punto, non due volte`);
});

test('un tasto respinto dal main non lascia niente; uno riuscito o fallito lascia l\'azione col suo esito', () => {
  assert.equal(A.gestoComeAzione('filo_memory_forget', { sempreAperta: 'a.it' }, { ok: false, code: 'forbidden', error: 'forbidden' }), null);
  assert.equal(A.gestoComeAzione('filo_memory_edit', {}, { ok: false, error: 'bad_request' }), null);
  assert.equal(A.gestoComeAzione('get_settings', {}, { ok: true }), null);
  assert.deepEqual(A.gestoComeAzione('filo_memory_forget', { sempreAperta: 'a.it' }, { ok: true, tolta: true }),
    { action: { type: 'NON_TENERE_APERTA', sito: 'a.it' }, res: { executed: true } });
  assert.deepEqual(A.gestoComeAzione('filo_installa_aggiornamento', {}, { ok: false, error: 'Questa copia di Filo non si aggiorna da sé' }),
    { action: { type: 'INSTALLA_AGGIORNAMENTO' }, res: { executed: false, error: 'Questa copia di Filo non si aggiorna da sé' } });
  // Il testo di una segnalazione sì, le sue immagini no.
  const f = A.gestoComeAzione('submit_feedback', { payload: { text: ' non salva ', url: 'https://a.it/x', images: [{ dataUrl: 'data:…' }] } }, { ok: true });
  assert.deepEqual(f.action, { type: 'INVIA_FEEDBACK', testo: 'non salva', pagina: 'https://a.it/x' });
});
