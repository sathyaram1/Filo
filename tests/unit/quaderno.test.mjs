// #872 — il quaderno delle memorie: ogni riga sa da quali eventi del filo è nata, il compattatore passa le fonti
// dalle lezioni alle note, una riga tolta resta nascosta e non torna dallo stesso tratto, una corretta vale subito.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(root, 'src', 'shared', 'constants.js'));
require(join(root, 'src', 'shared', 'quaderno.js'));
require(join(root, 'src', 'shared', 'filoMemory.js'));
require(join(root, 'src', 'shared', 'filoEventi.js'));

const Q = globalThis.SN_QUADERNO;
const M = globalThis.SN_FILO_MEMORY;
const E = globalThis.SN_FILO_EVENTI;

function disco() {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) { return { [key]: store[key] === undefined ? undefined : JSON.parse(JSON.stringify(store[key])) }; },
        async set(obj) { for (const [k, v] of Object.entries(obj)) store[k] = JSON.parse(JSON.stringify(v)); },
      },
    },
  };
  return store;
}

// Il compattatore finto: integra la lezione L1 in PREFERENZE citando il suo segno, come chiede il prompt.
async function compatta(uscita) {
  const memory = await M.getMemory();
  const buf = await M.getLessonsBuffer();
  const meta = await M.getFonti();
  const { rif } = Q.perCompattatore(memory, meta, buf);
  const letto = Q.leggiCompattatore(M.parseCompactorOutput(uscita), { rif, meta, tolte: meta.nascoste, ora: '2026-10-19T10:00:00.000Z' });
  await M.applicaCompattazione({ patch: letto.patch, righe: letto.righe, usate: buf, inizio: '2026-10-19T10:00:00.000Z' });
  return letto;
}

test('il filo dice dove sta un messaggio dal suo evento, anche dopo una fusione, e smette quando la chat se ne va', () => {
  const st = E.nuovoStato();
  const a = E.crea(E.TIPI.CHAT_APERTA, { chat: 'c1' }, { dispositivo: 'd', ts: '2026-10-01T10:00:00.000Z' });
  const u = E.crea(E.TIPI.MESSAGGIO, { chat: 'c1', msg: { role: 'user', text: 'Sono vegetariano' } }, { dispositivo: 'd', ts: '2026-10-01T10:00:01.000Z' });
  const f1 = E.crea(E.TIPI.MESSAGGIO, { chat: 'c1', msg: { role: 'filo', text: 'Ciao', spontaneo: true } }, { dispositivo: 'd', autore: 'filo', ts: '2026-10-01T10:00:02.000Z' });
  const f2 = E.crea(E.TIPI.MESSAGGIO, { chat: 'c1', msg: { role: 'filo', text: 'Ciao, e il timer è finito', spontaneo: true, fonde: true } }, { dispositivo: 'd', autore: 'filo', ts: '2026-10-01T10:05:00.000Z' });
  for (const ev of [a, u, f1, f2]) E.applica(st, ev);
  assert.deepEqual(E.dove(st, u.id), { tipo: 'messaggio', chat: 'c1', i: 0, ts: '2026-10-01T10:00:01.000Z', role: 'user', app: null });
  assert.equal(E.dove(st, f1.id).i, 1);
  assert.equal(E.dove(st, f2.id).i, 1, 'il messaggio fuso si ritrova da tutti e due gli eventi');
  const copia = E.copiaChat(st.chat.get('c1'), { ids: true });
  assert.deepEqual(copia.eids, [u.id, f2.id]);
  assert.equal(E.copiaChat(st.chat.get('c1'))._ids, undefined, 'senza chiederli gli id non escono');
  E.applica(st, E.crea(E.TIPI.CANCELLAZIONE, { chat: 'c1' }, { dispositivo: 'd' }));
  assert.equal(E.dove(st, u.id), null);
  assert.equal(E.dove(st, 'inesistente'), null);
});

test('una lezione porta le sue fonti fino alla riga del modulo, con la data in cui è nata', async () => {
  disco();
  await M.setMemory({ PROFILO: 'Si chiama Marta', PREFERENZE: '' });
  await M.appendLesson('L’utente è vegetariano.', { fonti: ['ev-u1', 'ev-f1'] });
  const [lezione] = await M.getLessonsBuffer();
  assert.deepEqual(lezione.fonti, ['ev-u1', 'ev-f1']);
  const letto = await compatta('PROFILO:\nSi chiama Marta (fonti: R1)\n\nPREFERENZE:\nÈ vegetariano (fonti: L1)');
  assert.deepEqual(letto.scartate, []);
  assert.deepEqual(await M.getMemory(), { PROFILO: 'Si chiama Marta', PREFERENZE: 'È vegetariano' });
  const q = await M.quaderno();
  const pref = q.moduli.find((m) => m.nome === 'PREFERENZE').righe[0];
  assert.equal(pref.testo, 'È vegetariano');
  assert.deepEqual(pref.fonti, ['ev-u1', 'ev-f1']);
  assert.equal(pref.nata, lezione.ts);
  assert.deepEqual(q.lezioni, [], 'le lezioni lette dal compattatore escono dal buffer');
  const marta = q.moduli.find((m) => m.nome === 'PROFILO').righe[0];
  assert.deepEqual(marta.fonti, [], 'una riga di prima del quaderno si vede, senza fonti');
});

test('le lezioni arrivate mentre il compattatore lavorava restano per il giro dopo', async () => {
  disco();
  await M.setMemory({ PROFILO: '', PREFERENZE: '' });
  await M.appendLesson('Prima', { fonti: ['a'] });
  const memory = await M.getMemory();
  const buf = await M.getLessonsBuffer();
  const meta = await M.getFonti();
  const { rif } = Q.perCompattatore(memory, meta, buf);
  await M.appendLesson('Arrivata dopo', { fonti: ['b'] });
  const letto = Q.leggiCompattatore({ PREFERENZE: 'Prima (fonti: L1)' }, { rif, meta, tolte: [] });
  await M.applicaCompattazione({ patch: letto.patch, righe: letto.righe, usate: buf });
  assert.deepEqual((await M.getLessonsBuffer()).map((l) => l.text), ['Arrivata dopo']);
});

test('una riga corretta prende il posto della vecchia, tiene le fonti e il compattatore la riporta com’è', async () => {
  disco();
  await M.setMemory({ PROFILO: '', PREFERENZE: '' });
  await M.appendLesson('L’utente è vegetariano.', { fonti: ['ev-u1'] });
  await compatta('PREFERENZE:\nÈ vegetariano (fonti: L1)');
  assert.equal(await M.editLine({ modulo: 'PREFERENZE', riga: 'È vegetariano' }, 'È vegano'), true);
  assert.equal((await M.getMemory()).PREFERENZE, 'È vegano', 'il prompt del messaggio dopo la legge da qui');
  const riga = (await M.quaderno()).moduli.find((m) => m.nome === 'PREFERENZE').righe[0];
  assert.deepEqual(riga.fonti, ['ev-u1']);
  assert.ok(riga.corretta);
  const { moduli } = Q.perCompattatore(await M.getMemory(), await M.getFonti(), []);
  assert.match(moduli, /\[R\d+\] È vegano \(scritta dall'utente\)/);
  // Una correzione con a capo non passa: una riga è una riga.
  assert.equal(await M.editLine({ modulo: 'PREFERENZE', riga: 'È vegano' }, 'a\nb'), false);
});

test('una riga tolta resta fra le nascoste, non torna dallo stesso tratto, torna se il filo la ridice', async () => {
  disco();
  await M.setMemory({ PROFILO: '', PREFERENZE: '' });
  await M.appendLesson('L’utente è vegetariano.', { fonti: ['ev-u1', 'ev-f1'] });
  await compatta('PREFERENZE:\nÈ vegetariano (fonti: L1)\nAma il mare (fonti: L1)');
  const id = await M.hideLine({ modulo: 'PREFERENZE', riga: 'È vegetariano' });
  assert.ok(id);
  assert.equal((await M.getMemory()).PREFERENZE, 'Ama il mare');
  const q = await M.quaderno();
  assert.equal(q.nascoste.length, 1);
  assert.deepEqual(q.nascoste[0].fonti, ['ev-u1', 'ev-f1']);

  // Lo stesso scambio rianalizzato: la lezione non entra.
  await M.appendLesson('L’utente è vegetariano', { fonti: ['ev-u1'] });
  assert.deepEqual(await M.getLessonsBuffer(), []);
  // Il compattatore che la riscrive a memoria (senza fonti, o citando solo quel tratto) non la rimette.
  await M.appendLesson('Le piace cucinare', { fonti: ['ev-u9'] });
  const letto = await compatta('PREFERENZE:\nAma il mare (fonti: R1)\nÈ vegetariano\nVegetariano convinto (fonti: R1)\nLe piace cucinare (fonti: L1)');
  assert.deepEqual(letto.scartate, ['È vegetariano', 'Vegetariano convinto'], 'con parole sue, dallo stesso tratto, è la stessa riga');
  assert.ok(!(await M.getMemory()).PREFERENZE.includes('È vegetariano'));
  assert.ok((await M.getMemory()).PREFERENZE.includes('Le piace cucinare'), 'una riga diversa dallo stesso giro resta');
  // Un messaggio nuovo che la ridice la riporta.
  await M.appendLesson('L’utente è vegetariano.', { fonti: ['ev-u7'] });
  assert.equal((await M.getLessonsBuffer()).length, 1);

  // Rimessa: torna nel modulo con le sue fonti.
  assert.equal(await M.restoreHidden(id), true);
  assert.ok((await M.getMemory()).PREFERENZE.split('\n').includes('È vegetariano'));
  const tornata = (await M.quaderno()).moduli.find((m) => m.nome === 'PREFERENZE').righe.find((r) => r.testo === 'È vegetariano');
  assert.deepEqual(tornata.fonti, ['ev-u1', 'ev-f1']);
});

test('cancellata per sempre: il testo se ne va dal disco, il tratto resta chiuso', async () => {
  const store = disco();
  await M.setMemory({ PROFILO: '', PREFERENZE: '' });
  await M.appendLesson('Abita in via Roma 3.', { fonti: ['ev-x'] });
  const [l] = await M.getLessonsBuffer();
  const id = await M.hideLine({ lezione: { ts: l.ts, text: l.text } });
  assert.deepEqual(await M.getLessonsBuffer(), []);
  assert.equal(await M.forgetHiddenForever(id), true);
  assert.ok(!JSON.stringify(store).includes('via Roma'), 'il testo non resta da nessuna parte');
  assert.deepEqual((await M.quaderno()).nascoste, []);
  assert.equal(await M.restoreHidden(id), false);
  // Il compattatore che la rifà dallo stesso tratto non passa.
  assert.ok(Q.tornaDaTolta('Abita in via Roma', ['ev-x'], (await M.getFonti()).nascoste));
});

test('dimenticare a parole nasconde (forgetLine), e un sito tenuto aperto si toglie e basta', async () => {
  disco();
  await M.setMemory({ PROFILO: 'Vive a Lisbona', PREFERENZE: '' });
  assert.equal(await M.forgetLine({ modulo: 'PROFILO', riga: 'Vive a Lisbona' }), true);
  assert.equal((await M.quaderno()).nascoste[0].testo, 'Vive a Lisbona');
  assert.equal(await M.forgetLine({ modulo: 'PROFILO', riga: 'Vive a Lisbona' }), false, 'una riga che non c\'è più non si nasconde due volte');
});

test('il compattatore: segni in testa tolti, fonti unite, righe senza segni riconosciute per testo', () => {
  const meta = Q.normaMeta({ righe: { PROFILO: [{ testo: 'Si chiama Marta', fonti: ['m1'], nata: '2026-09-01T00:00:00.000Z' }] } });
  const { moduli, lezioni, rif } = Q.perCompattatore({ PROFILO: 'Si chiama Marta' }, meta, [{ ts: '2026-10-01T00:00:00.000Z', text: 'Ha due gatti', fonti: ['g1'] }]);
  assert.match(moduli, /^PROFILO:\n\[R1\] Si chiama Marta$/);
  assert.equal(lezioni, '[L1] Ha due gatti');
  const r = Q.leggiCompattatore({ PROFILO: '[R1] Si chiama Marta\n- Si chiama Marta e ha due gatti (fonti: R1, L1)\nSi chiama Marta' }, { rif, meta, tolte: [] });
  assert.deepEqual(r.righe.PROFILO[0], { testo: 'Si chiama Marta', fonti: ['m1'], nata: '2026-09-01T00:00:00.000Z' });
  assert.deepEqual(r.righe.PROFILO[1].fonti, ['m1', 'g1']);
  assert.equal(r.righe.PROFILO[1].nata, '2026-09-01T00:00:00.000Z', 'la data è quella della fonte più vecchia');
  assert.equal(r.patch.PROFILO.split('\n')[1], '- Si chiama Marta e ha due gatti');
});

test('le fonti non hanno doppioni, e oltre il tetto tengono la nascita e le ultime', () => {
  const tante = Array.from({ length: Q.FONTI_MAX + 50 }, (_, i) => `e${i}`);
  const u = Q.unisci(tante, ['e0', 'e1']);
  assert.equal(u.length, Q.FONTI_MAX);
  assert.equal(u[0], 'e0');
  assert.equal(u[u.length - 1], `e${Q.FONTI_MAX + 49}`);
});

test('il compattatore non scrive sopra un cambio dell’utente fatto mentre il modello lavorava, e la lezione aspetta', async () => {
  disco();
  await M.setMemory({ PROFILO: '', PREFERENZE: 'È vegetariano' });
  await M.appendLesson('Ama le spezie', { fonti: ['ev-s'] });
  const meta = await M.getFonti();
  const buf = await M.getLessonsBuffer();
  const { rif } = Q.perCompattatore(await M.getMemory(), meta, buf);
  assert.equal(await M.editLine({ modulo: 'PREFERENZE', riga: 'È vegetariano' }, 'È vegano'), true);
  const letto = Q.leggiCompattatore({ PREFERENZE: 'È vegetariano (fonti: R1)\nAma le spezie (fonti: L1)' }, { rif, meta, tolte: [] });
  assert.equal(await M.applicaCompattazione({ patch: letto.patch, righe: letto.righe, usate: buf, versione: meta.versione || 0 }), false);
  assert.equal((await M.getMemory()).PREFERENZE, 'È vegano');
  assert.deepEqual((await M.getLessonsBuffer()).map((l) => l.text), ['Ama le spezie']);
  // Senza cambi in mezzo l'uscita si applica.
  const m2 = await M.getFonti();
  assert.equal(await M.applicaCompattazione({ patch: { PREFERENZE: 'È vegano\nAma le spezie' }, usate: await M.getLessonsBuffer(), versione: m2.versione }), true);
  assert.equal((await M.getMemory()).PREFERENZE, 'È vegano\nAma le spezie');
});

test('la correzione di una lezione già riordinata va alla riga che ne è nata, mai a una che ne ha assorbite altre', async () => {
  disco();
  await M.setMemory({ PROFILO: '', PREFERENZE: '' });
  await M.appendLesson('L’utente è vegetariano.', { fonti: ['ev-u1', 'ev-f1'] });
  const [l] = await M.getLessonsBuffer();
  await compatta('PREFERENZE:\nÈ vegetariano (fonti: L1)');
  assert.equal(await M.editLine({ lezione: { ts: l.ts, text: l.text } }, 'È vegano', { fonti: ['ev-u1'] }), true);
  assert.equal((await M.getMemory()).PREFERENZE, 'È vegano');
  disco();
  await M.setMemory({ PROFILO: '', PREFERENZE: '' });
  await M.appendLesson('L’utente è vegetariano.', { fonti: ['ev-u1'] });
  const [l2] = await M.getLessonsBuffer();
  await compatta('PREFERENZE:\nÈ vegetariano, ama le spezie e cucina curry il sabato (fonti: L1)');
  assert.equal(await M.editLine({ lezione: { ts: l2.ts, text: l2.text } }, 'È vegano', { fonti: ['ev-u1'] }), false);
  assert.equal(await M.editLine({ lezione: { ts: l2.ts, text: l2.text } }, 'È vegano'), false, 'senza fonti non si indovina');
});

test('due righe uguali in un modulo sono una sola, anche quando una correzione le fa coincidere', async () => {
  disco();
  await M.setMemory({ PROFILO: '', PREFERENZE: 'Ama il tè\nAma il caffè\nama il tè' });
  assert.equal((await M.getMemory()).PREFERENZE, 'Ama il tè\nAma il caffè');
  assert.equal(await M.editLine({ modulo: 'PREFERENZE', riga: 'Ama il caffè' }, 'Ama il tè'), true);
  assert.equal((await M.getMemory()).PREFERENZE, 'Ama il tè');
  assert.equal((await M.quaderno()).moduli.find((m) => m.nome === 'PREFERENZE').righe.length, 1);
});

test('una riga corretta in niente si toglie anche se intanto è stata riordinata: va fra le nascoste con le sue fonti', async () => {
  disco();
  await M.setMemory({ PROFILO: '', PREFERENZE: '' });
  await M.appendLesson('L’utente è vegetariano.', { fonti: ['ev-u1', 'ev-f1'] });
  const [l] = await M.getLessonsBuffer();
  await compatta('PREFERENZE:\nÈ vegetariano (fonti: L1)');
  assert.equal(await M.hideLine({ lezione: { ts: l.ts, text: l.text } }), null, 'senza fonti non si indovina');
  const id = await M.hideLine({ lezione: { ts: l.ts, text: l.text } }, { fonti: ['ev-u1'] });
  assert.ok(id);
  assert.equal((await M.getMemory()).PREFERENZE, '');
  const n = (await M.getFonti()).nascoste.find((x) => x.id === id);
  assert.equal(n.testo, 'È vegetariano');
  assert.deepEqual(n.fonti, ['ev-u1', 'ev-f1']);
  assert.equal(await M.hideLine({ modulo: 'PREFERENZE', riga: 'È vegetariano' }, { fonti: ['ev-u1'] }), null, 'tolta una volta, non ce n’è un’altra');
});
