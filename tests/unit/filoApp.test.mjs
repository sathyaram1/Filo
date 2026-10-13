// Sentinella delle conversazioni delle altre app nel filo (#974): l'Editor, i Mazzi e l'Aiuto scrivono una
// conversazione ciascuno, la home ne mostra una riga nel posto giusto, al modello arriva la riga e non lo scambio,
// e quando l'app la cancella se ne va anche dal filo. Niente Electron: il filo scrive in una cartella temporanea.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import '../../src/shared/contenutoEsterno.js';
import '../../src/shared/chatArchive.js';
import '../../src/shared/filoEventi.js';
import '../../src/shared/filoApp.js';
import '../../src/shared/filoContesto.js';
import '../../src/shared/filoState.js';

const require = createRequire(import.meta.url);
globalThis.SN_CONST = { ...(globalThis.SN_CONST || {}), STORAGE_KEYS: { ...((globalThis.SN_CONST || {}).STORAGE_KEYS || {}), FILO_CHATS: 'filo_chats' } };
globalThis.chrome = { storage: { local: { async get(k) { return { [k]: undefined }; }, async set() {}, async remove() {} } } };

const { creaFilo } = require('../../src/main/services/ilFilo.js');
require('../../src/main/services/filoChats.js');
const App = require('../../src/main/services/conversazioniApp.js');
const Contesto = require('../../src/main/services/contestoFilo.js');
const A = globalThis.SN_FILO_APP;
const E = globalThis.SN_FILO_EVENTI;
const FC = globalThis.SN_FILO_CONTESTO;
const FS = globalThis.SN_FILO_STATE;
const Chats = globalThis.SN_FILO_CHATS;

const cartelle = [];
after(() => { for (const c of cartelle) togliCartella(c); });

function azzera() {
  const cartella = cartellaTemporanea('filo-app-');
  cartelle.push(cartella);
  globalThis.SN_IL_FILO = creaFilo({ cartella });
  return globalThis.SN_IL_FILO;
}

const ORA = Date.parse('2026-10-06T12:00:00.000Z');
const fa = (minuti) => new Date(ORA - minuti * 60000).toISOString();

// Una chat già nel filo, scritta come la scrive chi la salva: eventi con la loro ora.
async function semina(f, { id, app = null, rif = '', soggetto = '', messaggi = [], chiusa = null }) {
  const ev = [E.crea(E.TIPI.CHAT_APERTA, { chat: id, ...(app ? { app, rif, soggetto } : {}) }, { ts: messaggi[0] ? messaggi[0].ts : fa(0), dispositivo: 'd' })];
  for (const m of messaggi) ev.push(E.crea(E.TIPI.MESSAGGIO, { chat: id, msg: { role: m.role, text: m.text } }, { ts: m.ts, dispositivo: 'd' }));
  if (chiusa) ev.push(E.crea(E.TIPI.CHAT_CHIUSA, { chat: id }, { ts: chiusa, dispositivo: 'd' }));
  await f.importa(ev.map(E.riga).join(''));
}

test('un messaggio nella chat dell’Editor diventa una conversazione del filo col suo documento', async () => {
  const f = azzera();
  await App.annota({ app: 'editor', rif: 'file-1:mod-1', soggetto: 'tesi', dove: 'filo://editor/editor.html?file=file-1', messaggi: [{ role: 'user', text: 'Riassumi il capitolo 2' }] });
  await App.annota({ app: 'editor', rif: 'file-1:mod-1', soggetto: 'tesi', messaggi: [{ role: 'filo', text: 'Il capitolo 2 parla di licheni.' }] });
  const [c] = await f.chats();
  assert.equal(c.app, 'editor');
  assert.equal(c.soggetto, 'tesi');
  assert.equal(c.title, 'Editor · tesi');
  assert.equal(c.kind, 'conversazione');
  assert.equal(c.dove, 'filo://editor/editor.html?file=file-1');
  assert.deepEqual(c.messages.map((m) => [m.role, m.text]), [['user', 'Riassumi il capitolo 2'], ['filo', 'Il capitolo 2 parla di licheni.']]);
  // La risposta di un'altra app ripete un documento o una pagina: riletta, resta una lettura.
  assert.ok(c.messages[1].esterno && !c.messages[0].esterno);
  assert.equal(A.testoRiga(c), "2 messaggi nell'Editor su tesi");
});

test('la stessa chat dell’app continua la sua riga entro l’ora, dopo un’ora ne apre un’altra', () => {
  const chats = [{ id: 'x', app: 'mazzi', rif: 'd1', updatedAt: fa(30), messages: [{}] }];
  assert.equal(A.daContinuare(chats, { app: 'mazzi', rif: 'd1', ora: ORA }).id, 'x');
  assert.equal(A.daContinuare(chats, { app: 'mazzi', rif: 'd2', ora: ORA }), null);
  assert.equal(A.daContinuare(chats, { app: 'editor', rif: 'd1', ora: ORA }), null);
  const vecchia = [{ id: 'x', app: 'mazzi', rif: 'd1', updatedAt: fa(61), messages: [{}] }];
  assert.equal(A.daContinuare(vecchia, { app: 'mazzi', rif: 'd1', ora: ORA }), null);
});

test('il nome cambiato del documento cambia la riga, e una domanda riprovata non si scrive due volte', async () => {
  const f = azzera();
  await App.annota({ app: 'editor', rif: 'f:m', soggetto: 'bozza', messaggi: [{ role: 'user', text: 'ciao' }] });
  await App.annota({ app: 'editor', rif: 'f:m', soggetto: 'bozza', messaggi: [{ role: 'user', text: 'ciao' }] });
  await App.annota({ app: 'editor', rif: 'f:m', soggetto: 'tesi finale', messaggi: [{ role: 'filo', text: 'eccomi' }] });
  const [c] = await f.chats();
  assert.equal(c.messages.length, 2);
  assert.equal(c.title, 'Editor · tesi finale');
  assert.equal(A.testoRiga(c), "2 messaggi nell'Editor su tesi finale");
});

test('un’app sconosciuta, un riferimento vuoto o solo spazi non scrivono niente', async () => {
  const f = azzera();
  assert.equal(await App.annota({ app: 'posta', rif: 'x', messaggi: [{ role: 'user', text: 'ciao' }] }), null);
  assert.equal(await App.annota({ app: 'editor', rif: '', messaggi: [{ role: 'user', text: 'ciao' }] }), null);
  assert.equal(await App.annota({ app: 'editor', rif: 'f:m', messaggi: [{ role: 'user', text: '   ' }] }), null);
  assert.equal((await f.chats()).length, 0);
});

test('il soggetto è un’etichetta su una riga: a capo e caratteri di controllo non passano', () => {
  assert.equal(A.soggetto('  tesi\n\u0007di laurea\u2028 '), 'tesi di laurea');
  assert.equal(A.soggetto('x'.repeat(500)).length, 120);
  assert.equal(A.testoRiga({ app: 'aiuto', soggetto: 'wikipedia.org', messages: [{}] }), "1 messaggio nell'Aiuto su wikipedia.org");
  assert.equal(A.testoRiga({ app: 'mazzi', soggetto: 'Atraxa', messages: [{}, {}, {}] }), '3 messaggi nei Mazzi su Atraxa');
});

test('la home a vuoto mostra le righe nate dopo la sua ultima conversazione, dentro i giorni della chat', async () => {
  const f = azzera();
  await semina(f, { id: 'vecchia-app', app: 'editor', rif: 'a:1', soggetto: 'diario', messaggi: [{ role: 'user', text: 'x', ts: fa(60 * 24 * 5) }] });
  await semina(f, { id: 'casa', messaggi: [{ role: 'user', text: 'ciao', ts: fa(120) }], chiusa: fa(110) });
  await semina(f, { id: 'prima', app: 'mazzi', rif: 'd', soggetto: 'Atraxa', messaggi: [{ role: 'user', text: 'rampa', ts: fa(130) }] });
  await semina(f, { id: 'dopo', app: 'editor', rif: 'b:1', soggetto: 'tesi', messaggi: [{ role: 'user', text: 'capitolo', ts: fa(30) }, { role: 'filo', text: 'ok', ts: fa(29) }] });
  const righe = A.perLaHome(await f.chats(), { chat: null, ora: ORA, giorni: 3 });
  assert.deepEqual(righe.map((r) => r.id), ['dopo']);
  assert.equal(righe[0].testo, "2 messaggi nell'Editor su tesi");
  // Senza conversazioni della home, solo il tetto dei giorni.
  const f2 = azzera();
  await semina(f2, { id: 'vecchia-app', app: 'editor', rif: 'a:1', messaggi: [{ role: 'user', text: 'x', ts: fa(60 * 24 * 5) }] });
  await semina(f2, { id: 'nuova', app: 'aiuto', rif: 'h|1', soggetto: 'wikipedia.org', messaggi: [{ role: 'user', text: 'y', ts: fa(60) }] });
  assert.deepEqual(A.perLaHome(await f2.chats(), { ora: ORA, giorni: 3 }).map((r) => r.id), ['nuova']);
});

test('in una conversazione della home una riga sta dove è nata: dentro, o in testa alla conversazione che segue', async () => {
  const f = azzera();
  await semina(f, { id: 'ieri', messaggi: [{ role: 'user', text: 'a', ts: fa(300) }], chiusa: fa(290) });
  await semina(f, { id: 'fra-le-due', app: 'mazzi', rif: 'd', messaggi: [{ role: 'user', text: 'b', ts: fa(200) }] });
  await semina(f, { id: 'oggi', messaggi: [{ role: 'user', text: 'c', ts: fa(100) }, { role: 'filo', text: 'd', ts: fa(99) }] });
  await semina(f, { id: 'durante', app: 'editor', rif: 'f:m', messaggi: [{ role: 'user', text: 'e', ts: fa(50) }] });
  const chats = await f.chats();
  assert.deepEqual(A.perLaHome(chats, { chat: 'oggi', ora: ORA }).map((r) => r.id), ['fra-le-due', 'durante']);
  // La conversazione di ieri, chiusa prima: nessuna delle due.
  assert.deepEqual(A.perLaHome(chats, { chat: 'ieri', ora: ORA }).map((r) => r.id), []);
  // La home a vuoto, con «oggi» ancora aperta: quello nato dopo il suo ultimo messaggio.
  assert.deepEqual(A.perLaHome(chats, { chat: null, ora: ORA }).map((r) => r.id), ['durante']);
});

test('al modello entra la riga all’ora d’inizio, non lo scambio; i ricordi non la ripescano', async () => {
  const f = azzera();
  await semina(f, { id: 'casa', messaggi: [{ role: 'user', text: 'buongiorno', ts: fa(200) }, { role: 'filo', text: 'ciao', ts: fa(199) }] });
  await semina(f, {
    id: 'ed1', app: 'editor', rif: 'f:m', soggetto: 'tesi',
    messaggi: [{ role: 'user', text: 'SEGRETO-DEL-CAPITOLO', ts: fa(100) }, { role: 'filo', text: 'risposta lunga', ts: fa(99) }],
  });
  const filo = await Contesto.messaggiDelFilo();
  const righe = filo.filter((m) => m.chat === 'ed1');
  assert.equal(righe.length, 1);
  assert.ok(righe[0].riga);
  assert.equal(righe[0].ts, fa(100));
  assert.match(righe[0].text, /conversazione nell'Editor su «tesi»: 2 messaggi/);
  assert.match(righe[0].text, /CERCA_CHAT e id "ed1"/);
  const tratto = FC.finestra(filo, { ora: ORA, giorni: 3, token: 100000 }).messaggi.map((m) => m.content).join('\n');
  assert.ok(!tratto.includes('SEGRETO-DEL-CAPITOLO'), 'lo scambio intero non deve entrare nel contesto');
  assert.ok(tratto.includes("conversazione nell'Editor su «tesi»"));
  assert.ok(!FC.tratti(filo).some((t) => t.chat === 'ed1'), 'una riga non è uno scambio da ripescare');
  const recenti = FS.conversazioniRecenti(filo, ORA).righe.join('\n');
  assert.match(recenti, /\] \(conversazione nell'Editor/);
  assert.ok(!recenti.includes('utente: (conversazione'));
});

test('le chat delle app non si chiudono né si classificano alla partenza', async () => {
  azzera();
  await App.annota({ app: 'mazzi', rif: 'd1', soggetto: 'Atraxa', messaggi: [{ role: 'user', text: 'rampa' }] });
  assert.equal((await Chats.listDangling()).length, 0);
  assert.equal((await Chats.listUntriaged()).length, 0);
});

test('quando l’app cancella la sua conversazione, se ne va anche dal filo: per mazzo e per documento', async () => {
  const f = azzera();
  await App.annota({ app: 'mazzi', rif: 'd1', soggetto: 'Atraxa', messaggi: [{ role: 'user', text: 'rampa' }] });
  await App.annota({ app: 'mazzi', rif: 'd2', soggetto: 'Kenrith', messaggi: [{ role: 'user', text: 'pescate' }] });
  await App.annota({ app: 'editor', rif: 'file-9:mod-1', soggetto: 'tesi', messaggi: [{ role: 'user', text: 'uno' }] });
  await App.annota({ app: 'editor', rif: 'file-9:mod-2', soggetto: 'tesi', messaggi: [{ role: 'user', text: 'due' }] });
  assert.equal((await App.dimentica({ app: 'mazzi', rif: 'd1' })).length, 1);
  assert.equal((await App.dimentica({ app: 'editor', prefisso: 'file-9:' })).length, 2);
  assert.equal((await App.dimentica({ app: 'editor' })).length, 0, 'senza riferimento non si cancella tutto');
  const rimaste = await f.chats();
  assert.deepEqual(rimaste.map((c) => c.rif), ['d2']);
  // Via anche dal disco, non solo dalla vista.
  const testo = (await f.esporta()).toString('utf8');
  assert.ok(!testo.includes('rampa') && !testo.includes('"uno"'));
});

test('il soggetto nuovo si piega anche da un evento di titolo, e un tipo sconosciuto di app resta una chat qualunque', () => {
  const s = E.nuovoStato();
  E.applica(s, E.crea(E.TIPI.CHAT_APERTA, { chat: 'c', app: 'aiuto', rif: 'h|1', soggetto: 'a.it', dove: 'https://a.it/x' }, { dispositivo: 'd' }));
  E.applica(s, E.crea(E.TIPI.CHAT_TITOLO, { chat: 'c', title: 'Aiuto · b.it', soggetto: 'b.it' }, { dispositivo: 'd' }));
  const c = E.copiaChat(s.chat.get('c'));
  assert.equal(c.soggetto, 'b.it');
  assert.equal(c.dove, 'https://a.it/x');
  assert.equal(A.testoRiga({ ...c, app: 'sconosciuta' }), '');
});
