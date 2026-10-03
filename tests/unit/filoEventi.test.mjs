// Sentinella del filo (#866): il file cresce solo in coda, ogni riga è un evento intero nel formato fisso, una
// cancellazione toglie dal disco solo quello che copre, e nessun tetto taglia niente. Niente Electron: il filo
// scrive in una cartella temporanea.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, appendFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import '../../src/shared/chatArchive.js';
import '../../src/shared/filoEventi.js';

const require = createRequire(import.meta.url);
globalThis.SN_CONST = { STORAGE_KEYS: { FILO_CHATS: 'filo_chats' } };

let magazzino = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(k) { return { [k]: magazzino[k] }; },
      async set(o) { Object.assign(magazzino, o); },
      async remove(k) { for (const x of [].concat(k)) delete magazzino[x]; },
    },
  },
};

const { creaFilo } = require('../../src/main/services/ilFilo.js');
require('../../src/main/services/filoChats.js');
const E = globalThis.SN_FILO_EVENTI;
const Chats = globalThis.SN_FILO_CHATS;

const cartelle = new Set();
after(() => { for (const c of cartelle) rmSync(c, { recursive: true, force: true }); });

function nuovo(cartella = cartellaTemporanea('filo-ev-')) {
  cartelle.add(cartella);
  const f = creaFilo({ cartella });
  globalThis.SN_IL_FILO = f;
  return { f, cartella, file: join(cartella, 'eventi.jsonl') };
}
const leggi = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
const righe = (file) => leggi(file).split('\n').filter(Boolean);

test('ogni riga è un evento intero col formato fisso, anche con a capo e caratteri strani nel testo', async () => {
  magazzino = {};
  const { f, file } = nuovo();
  await Chats.append('c1', { role: 'user', text: 'riga uno\nriga due fine <b>html</b> 🙂' });
  await Chats.append('c1', { role: 'filo', text: 'risposta' });
  await f.registraVisita({ url: 'https://example.com/', titolo: 'Esempio', scheda: 3 });
  const ids = new Set();
  for (const r of righe(file)) {
    const ev = JSON.parse(r);
    assert.deepEqual(Object.keys(ev).slice(0, 6), ['v', 'id', 'ts', 'dispositivo', 'autore', 'tipo']);
    assert.equal(ev.v, E.VERSIONE);
    assert.ok(E.AUTORI.includes(ev.autore));
    assert.ok(E.valido(ev), r);
    assert.ok(!ids.has(ev.id), 'id ripetuto');
    ids.add(ev.id);
  }
  assert.equal(ids.size, 3);
  const chat = await Chats.get('c1');
  assert.equal(chat.messages[0].text, 'riga uno\nriga due fine <b>html</b> 🙂');
  const [m1, m2, nav] = righe(file).map((r) => JSON.parse(r));
  assert.equal(m1.autore, 'utente');
  assert.equal(m2.autore, 'filo');
  assert.equal(nav.tipo, 'navigazione');
  assert.equal(nav.titolo, 'Esempio');
  assert.equal(nav.scheda, 3);
});

test('il file cresce solo in coda: quello che c’era resta byte per byte', async () => {
  magazzino = {};
  const { f, file } = nuovo();
  let prima = leggi(file);
  const passi = [
    () => Chats.append('a', { role: 'user', text: 'ciao' }),
    () => Chats.append('a', { role: 'filo', text: 'ciao a te' }),
    () => f.registraVisita({ url: 'https://a.example/', titolo: 'A' }),
    () => Chats.close('a'),
    () => Chats.setTriage('a', { title: 'Saluti', kind: 'conversazione' }),
    () => Chats.setUserTriage('a', { title: 'Saluti miei' }),
    () => Chats.append('a', { role: 'user', text: 'riapro' }),
  ];
  for (const passo of passi) {
    await passo();
    const dopo = leggi(file);
    assert.ok(dopo.startsWith(prima), 'una scrittura ha cambiato una riga già scritta');
    assert.ok(dopo.length > prima.length, 'una scrittura non ha aggiunto niente');
    prima = dopo;
  }
});

test('cancellare una chat la toglie dal file e lascia ogni altra riga identica e in ordine', async () => {
  magazzino = {};
  const { f, file } = nuovo();
  await Chats.append('resta', { role: 'user', text: 'questa resta' });
  await Chats.append('via', { role: 'user', text: 'SEGRETO-DA-CANCELLARE' });
  await f.registraVisita({ url: 'https://resta.example/', titolo: 'Resta' });
  await Chats.append('via', { role: 'filo', text: 'anche questa SEGRETO-DA-CANCELLARE' });
  await Chats.close('via');
  const altre = righe(file).filter((r) => !r.includes('"chat":"via"'));
  await Chats.remove('via');
  const testo = leggi(file);
  assert.ok(!testo.includes('SEGRETO-DA-CANCELLARE'), 'il testo della chat cancellata è ancora su disco');
  const dopo = righe(file);
  assert.deepEqual(dopo.slice(0, -1), altre);
  const ultima = JSON.parse(dopo[dopo.length - 1]);
  assert.equal(ultima.tipo, 'cancellazione');
  assert.equal(ultima.chat, 'via');
  assert.equal(await Chats.get('via'), null);
  assert.equal((await Chats.get('resta')).messages.length, 1);
});

test('«cancella le pagine dell’ultima ora» toglie quelle pagine e nessun’altra', async () => {
  magazzino = {};
  const { f, file } = nuovo();
  const ora = Date.now();
  const iso = (msFa) => new Date(ora - msFa).toISOString();
  await f.registraVisita({ url: 'https://vecchia.example/', titolo: 'Vecchia', ts: iso(3 * 3600e3) });
  await f.registraVisita({ url: 'https://recente.example/1', titolo: 'Recente 1', ts: iso(10 * 60e3) });
  await f.registraVisita({ url: 'https://recente.example/2', titolo: 'Recente 2', ts: iso(30 * 60e3) });
  await Chats.append('c', { role: 'user', text: 'chat di adesso', ts: iso(5 * 60e3) });
  const tolte = await f.cancellaPagine(E.periodo('ultima_ora', { ora: new Date(ora) }));
  assert.equal(tolte, 2);
  const testo = leggi(file);
  assert.ok(!testo.includes('recente.example'), 'una pagina dell’ultima ora è ancora su disco');
  assert.ok(testo.includes('vecchia.example'), 'è sparita anche una pagina più vecchia');
  assert.ok(testo.includes('chat di adesso'), 'cancellare le pagine ha toccato la chat');
  const rimaste = await f.pagine();
  assert.deepEqual(rimaste.map((p) => p.url), ['https://vecchia.example/']);
  assert.equal(await f.cancellaPagine(E.periodo('tutto')), 1);
  assert.deepEqual(await f.pagine(), []);
});

test('un messaggio di 20.000 caratteri torna intero, e oltre le 5000 voci non si taglia niente', async () => {
  magazzino = {};
  const { f, cartella } = nuovo();
  const lungo = 'parola '.repeat(2858).slice(0, 20000);
  await Chats.append('lunga', { role: 'user', text: lungo });
  for (let i = 0; i < 60; i++) {
    await f.transazione((t) => t.scrivi(Array.from({ length: 100 }, (_, j) => t.evento(E.TIPI.NAVIGAZIONE, {
      url: `https://n.example/${i * 100 + j}`, titolo: `Pagina ${i * 100 + j}`,
    }, { autore: 'utente' }))));
  }
  const riletto = nuovo(cartella).f;
  const chat = await riletto.chat('lunga');
  assert.equal(chat.messages[0].text.length, 20000);
  assert.equal(chat.messages[0].text, lungo);
  assert.equal((await riletto.pagine()).length, 6000);
});

test('con 50.000 eventi nel filo un messaggio si scrive veloce come a filo vuoto', async () => {
  magazzino = {};
  const vuoto = nuovo();
  const pieno = nuovo();
  const dispositivo = 'prova';
  const blocco = [];
  for (let i = 0; i < 50000; i++) {
    blocco.push(E.riga(E.crea(i % 2 ? E.TIPI.NAVIGAZIONE : E.TIPI.MESSAGGIO, i % 2
      ? { url: `https://p.example/${i}`, titolo: `Pagina ${i}` }
      : { chat: `c${(i / 2) % 500}`, msg: { role: 'user', text: `messaggio numero ${i} `.repeat(8) } }, { dispositivo })));
  }
  writeFileSync(pieno.file, blocco.join(''));
  const misura = async ({ f }) => {
    globalThis.SN_IL_FILO = f;
    await f.carica();
    const tempi = [];
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      await Chats.append('misura', { role: 'user', text: `domanda ${i}` });
      tempi.push(performance.now() - t0);
    }
    return tempi.sort((a, b) => a - b)[7];
  };
  const tVuoto = await misura(vuoto);
  const tPieno = await misura(pieno);
  assert.equal((await pieno.f.chats()).length, 501);
  assert.ok(tPieno < tVuoto * 3 + 15, `a filo pieno un messaggio ci mette ${tPieno.toFixed(1)} ms, a filo vuoto ${tVuoto.toFixed(1)} ms`);
});

test('dall’incognito niente arriva su disco, e da fuori non si vede', async () => {
  magazzino = {};
  const { f, file } = nuovo();
  await Chats.append('normale', { role: 'user', text: 'chat normale' });
  const prima = leggi(file);
  await f.transazione((t) => t.scrivi([t.evento(E.TIPI.MESSAGGIO, { chat: 'incog', msg: { role: 'user', text: 'chat-incognito' } })]),
    { incognito: true });
  await f.registraVisita({ url: 'https://incognito.example/', titolo: 'Segreta' }, { incognito: true });
  assert.equal(leggi(file), prima, 'l’incognito ha scritto sul file');
  assert.equal(await f.chat('incog'), null);
  assert.ok(await f.chat('incog', { incognito: true }));
  assert.equal((await f.pagine(null, { incognito: true })).length, 1);
  assert.equal((await f.pagine()).length, 0);
  assert.match((await f.esporta({ incognito: true })).toString('utf8'), /chat-incognito/);
  f.resetIncognito();
  assert.equal(await f.chat('incog', { incognito: true }), null);
});

test('le chat salvate prima del filo diventano segmenti, uguali a prima e senza doppioni', async () => {
  const vecchie = [
    {
      id: 'recente', startedAt: '2026-09-27T09:00:00.000Z', updatedAt: '2026-09-27T09:05:00.000Z', closedAt: '2026-09-27T09:06:00.000Z',
      title: 'Discussione sulla coscienza', kind: 'conversazione', onboarding: false, titleByUser: true, triagedCount: 2,
      messages: [
        { role: 'user', text: 'La coscienza è emergente?', ts: '2026-09-27T09:00:10.000Z', images: 1 },
        { role: 'filo', text: 'Dipende.', ts: '2026-09-27T09:05:00.000Z', actions: ['CERCA_WEB'], letti: [{ valore: 'x', regola: 'codice', fonte: 'da fuori' }] },
      ],
    },
    {
      id: 'vecchia', startedAt: '2026-09-20T08:00:00.000Z', updatedAt: '2026-09-20T08:01:00.000Z', closedAt: null,
      title: '', kind: null, onboarding: true,
      messages: [{ role: 'filo', text: 'Ciao, come ti chiami?', ts: '2026-09-20T08:00:00.000Z' }, { role: 'user', text: 'Ada', ts: '2026-09-20T08:01:00.000Z', daModello: true }],
    },
  ];
  magazzino = { filo_chats: JSON.parse(JSON.stringify(vecchie)) };
  const { f, cartella } = nuovo();
  const dopo = await f.chats();
  assert.deepEqual(dopo.map((c) => c.id), ['recente', 'vecchia']);
  for (const c of vecchie) {
    const m = dopo.find((x) => x.id === c.id);
    for (const k of Object.keys(c)) assert.deepEqual(m[k], c[k], `${c.id}.${k} cambiato dalla migrazione`);
  }
  assert.equal(magazzino.filo_chats, undefined, 'la chiave vecchia è rimasta in storage.json');
  // Un avvio interrotto dopo la scrittura del filo ritrova la chiave: la migrazione si ripete senza doppioni.
  magazzino = { filo_chats: JSON.parse(JSON.stringify(vecchie)) };
  const ancora = nuovo(cartella).f;
  const due = await ancora.chats();
  assert.equal(due.length, 2);
  assert.equal(due.reduce((n, c) => n + c.messages.length, 0), 4);
});

test('una riga lasciata a metà da un guasto si salta, e quello che arriva dopo si legge', async () => {
  magazzino = {};
  const { f, cartella, file } = nuovo();
  await Chats.append('g', { role: 'user', text: 'prima del guasto' });
  appendFileSync(file, '{"v":1,"id":"rotta","ts":"2026-');
  const dopo = nuovo(cartella).f;
  globalThis.SN_IL_FILO = dopo;
  await Chats.append('g', { role: 'filo', text: 'dopo il guasto' });
  const riletto = await nuovo(cartella).f.chat('g');
  assert.deepEqual(riletto.messages.map((m) => m.text), ['prima del guasto', 'dopo il guasto']);
  void f;
});

test('una cancellazione scritta ma non ancora tolta dal file si completa alla partenza dopo', async () => {
  magazzino = {};
  const { cartella, file } = nuovo();
  await Chats.append('x', { role: 'user', text: 'DA-TOGLIERE' });
  appendFileSync(file, E.riga(E.crea(E.TIPI.CANCELLAZIONE, { chat: 'x' }, { dispositivo: 'prova' })));
  const f2 = nuovo(cartella).f;
  assert.equal(await f2.chat('x'), null);
  assert.ok(!leggi(file).includes('DA-TOGLIERE'));
});

test('esporta e reimporta su un profilo vuoto riporta il filo intero, e reimportare non duplica', async () => {
  magazzino = {};
  const a = nuovo();
  await Chats.append('e', { role: 'user', text: 'da esportare' });
  await Chats.append('e', { role: 'filo', text: 'risposta' });
  await Chats.close('e');
  await a.f.registraVisita({ url: 'https://esporta.example/', titolo: 'Esporta' });
  const buf = await a.f.esporta();
  const b = nuovo();
  assert.equal((await b.f.importa(buf)).aggiunti, 4);
  assert.deepEqual(await b.f.chats(), await a.f.chats());
  assert.deepEqual((await b.f.pagine()).map((p) => p.url), ['https://esporta.example/']);
  assert.equal((await b.f.importa(buf)).aggiunti, 0);
  assert.notEqual(await b.f.dispositivo(), await a.f.dispositivo(), 'il profilo nuovo ha preso l’identità del vecchio');
});

test('un evento di un tipo che questa versione non conosce resta su disco anche dopo una cancellazione', async () => {
  magazzino = {};
  const { cartella, file } = nuovo();
  const futuro = E.riga(E.crea('azione', { cosa: 'tema scuro' }, { dispositivo: 'telefono' }));
  appendFileSync(file, futuro);
  const f = nuovo(cartella).f;
  globalThis.SN_IL_FILO = f;
  await Chats.append('z', { role: 'user', text: 'qualcosa' });
  await Chats.remove('z');
  assert.ok(leggi(file).includes(futuro));
});

test('periodo(): ultima ora, oggi, tutto e le ultime N ore', () => {
  const ora = new Date(2026, 9, 3, 15, 30);
  assert.equal(Date.parse(E.periodo('ultima_ora', { ora }).da), ora.getTime() - 3600e3);
  assert.equal(Date.parse(E.periodo('oggi', { ora }).da), new Date(2026, 9, 3).getTime());
  assert.deepEqual(E.periodo('tutto', { ora }), { da: null, a: null });
  assert.equal(Date.parse(E.periodo('', { ore: 3, ora }).da), ora.getTime() - 3 * 3600e3);
  assert.equal(E.periodo('boh', { ora }), null);
});

test('il filo lo scrive un modulo solo, e solo in coda o riscrivendo dopo una cancellazione', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const sorgenti = [];
  const giro = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) giro(p);
      else if (e.endsWith('.js')) sorgenti.push(p);
    }
  };
  giro(join(ROOT, 'src'));
  const chi = sorgenti.filter((p) => readFileSync(p, 'utf8').includes('eventi.jsonl')).map((p) => relative(ROOT, p).replace(/\\/g, '/'));
  assert.deepEqual(chi.sort(), ['src/main/services/exportData.js', 'src/main/services/ilFilo.js']);
  const modulo = readFileSync(join(ROOT, 'src', 'main', 'services', 'ilFilo.js'), 'utf8');
  const aperture = [...modulo.matchAll(/fsp\.open\(([^,]+),\s*'([a-z+]+)'\)/g)].map((m) => [m[1].trim(), m[2]]);
  assert.deepEqual(aperture, [['fileEventi()', 'a'], ['tmp', 'w']], 'il file del filo si apre solo in coda (o il temporaneo della compattazione)');
  assert.doesNotMatch(modulo, /writeFile\(\s*fileEventi\(\)|truncate|ftruncate/, 'il file del filo non si riscrive sul posto');
});
