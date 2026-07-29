// Unit test per src/shared/editorVersions.js — lo storico versioni dei file
// dell'editor (logica pura, senza DOM né storage).
//
// Cuore del feedback "versionamento illimitato": una modifica automatica di Filo
// crea un punto di ripristino annullabile; lo storico può crescere illimitato ma
// non deve accumulare rumore (versioni consecutive identiche). Questi test
// asseriscono il SUCCESSO di quelle proprietà, non l'assenza di errori.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'editorVersions.js'));

const V = globalThis.SN_EDITOR_VERSIONS;

function content(text) {
  return { meta: { title: 'Doc' }, content: { type: 'doc', text }, comments: [], modules: [] };
}

test('record crea una versione con id, timestamp, sorgente e contenuto', () => {
  let store = {};
  const r = V.record(store, 'file-1', { content: content('a'), source: 'filo', label: 'Modifica di Filo', ts: 111 });
  store = r.store;
  assert.equal(r.created, true);
  assert.ok(r.version.id, 'la versione ha un id');
  assert.equal(r.version.ts, 111);
  assert.equal(r.version.source, 'filo');
  assert.equal(r.version.label, 'Modifica di Filo');
  assert.deepEqual(r.version.content, content('a'));
  assert.equal(V.listFor(store, 'file-1').length, 1);
});

test('versioni consecutive identiche NON creano rumore (dedup)', () => {
  let store = {};
  store = V.record(store, 'f', { content: content('x'), source: 'filo' }).store;
  const r2 = V.record(store, 'f', { content: content('x'), source: 'filo' });
  store = r2.store;
  assert.equal(r2.created, false, 'il secondo record identico non crea una nuova versione');
  assert.equal(V.listFor(store, 'f').length, 1);
});

test('contenuti diversi si accumulano illimitatamente in ordine cronologico', () => {
  let store = {};
  for (let i = 0; i < 50; i++) {
    store = V.record(store, 'f', { content: content('v' + i), source: 'filo', ts: 1000 + i }).store;
  }
  const list = V.listFor(store, 'f');
  assert.equal(list.length, 50, 'nessun cap: 50 versioni distinte conservate');
  assert.deepEqual(list[0].content, content('v0'));
  assert.deepEqual(list[49].content, content('v49'));
  assert.equal(V.latest(store, 'f').ts, 1049);
});

test('ripristino: get restituisce ESATTAMENTE il contenuto salvato (torna identico)', () => {
  let store = {};
  const original = content('testo originale importante');
  const r = V.record(store, 'f', { content: original, source: 'filo' });
  store = r.store;
  // simula ulteriori modifiche
  store = V.record(store, 'f', { content: content('rovinato da filo'), source: 'filo' }).store;
  const restored = V.get(store, 'f', r.version.id);
  assert.ok(restored, 'la versione è ancora recuperabile dopo altre modifiche');
  assert.deepEqual(restored.content, original, 'il contenuto ripristinato è identico all\'originale');
});

test('più file hanno storici indipendenti', () => {
  let store = {};
  store = V.record(store, 'a', { content: content('A1'), source: 'filo' }).store;
  store = V.record(store, 'b', { content: content('B1'), source: 'filo' }).store;
  store = V.record(store, 'a', { content: content('A2'), source: 'filo' }).store;
  assert.equal(V.listFor(store, 'a').length, 2);
  assert.equal(V.listFor(store, 'b').length, 1);
});

test('dropFile rimuove lo storico di un file cancellato', () => {
  let store = {};
  store = V.record(store, 'a', { content: content('A'), source: 'filo' }).store;
  store = V.record(store, 'b', { content: content('B'), source: 'filo' }).store;
  store = V.dropFile(store, 'a');
  assert.equal(V.listFor(store, 'a').length, 0);
  assert.equal(V.listFor(store, 'b').length, 1);
});

test('source sconosciuta ricade su "manual"', () => {
  const r = V.record({}, 'f', { content: content('m'), source: 'boh' });
  assert.equal(r.version.source, 'manual');
});

// ── Snapshot manuali (#379): la soglia che decide se una modifica a mano merita
// un punto di ripristino. Contenuto realistico: un doc ProseMirror con paragrafi.
function doc(...paragraphs) {
  return {
    meta: { title: 'Doc' },
    content: {
      type: 'doc',
      content: paragraphs.map((t) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })),
    },
    comments: [], modules: [],
  };
}

test('plainText estrae il testo dei paragrafi con a-capo ai confini di blocco', () => {
  assert.equal(V.plainText(doc('Prima riga', 'Seconda riga')), 'Prima riga\nSeconda riga');
  assert.equal(V.plainText(doc()), '');
  assert.equal(V.plainText(null), '');
});

test('textChangeSize: contenuto identico = 0 (nessuna modifica)', () => {
  assert.equal(V.textChangeSize(doc('Cappuccetto Rosso'), doc('Cappuccetto Rosso')), 0);
});

test('textChangeSize misura la regione centrale cambiata, non l\'intero testo', () => {
  // Prefisso e suffisso comuni identici, cambia solo una parola in mezzo.
  const a = doc('Il gatto nero salta il muro');
  const b = doc('Il gatto bianco salta il muro');
  // "nero"→"bianco": la regione diversa è piccola, non l'intera frase.
  assert.ok(V.textChangeSize(a, b) <= 6, 'solo la parola cambiata conta');
});

test('textChangeSize conta un blocco di testo aggiunto in fondo', () => {
  const a = doc('Inizio.');
  const added = 'x'.repeat(200);
  const b = doc('Inizio.', added);
  assert.ok(V.textChangeSize(a, b) >= 200, 'il blocco aggiunto pesa per la sua lunghezza');
});

test('isSignificantManualChange: sotto soglia = no, sopra soglia = sì', () => {
  const base = doc('Testo di partenza.');
  // Piccola correzione: una manciata di caratteri → NON significativa.
  const small = doc('Testo di partenza!!');
  assert.equal(V.isSignificantManualChange(base, small), false);
  // Blocco lungo scritto a mano → significativa (oltre i 140 char di default).
  const big = doc('Testo di partenza.', 'a'.repeat(200));
  assert.equal(V.isSignificantManualChange(base, big), true);
});

test('isSignificantManualChange rispetta una soglia personalizzata', () => {
  const a = doc('abc');
  const b = doc('abc', 'de'); // ~3 char cambiati
  assert.equal(V.isSignificantManualChange(a, b, 2), true, 'soglia 2: 3 char bastano');
  assert.equal(V.isSignificantManualChange(a, b, 50), false, 'soglia 50: 3 char no');
});

test('un percorso completo di snapshot manuale: sopra soglia crea, sotto no', () => {
  let store = {};
  const base = doc('Bozza.');
  // Prima registriamo un riferimento (come farebbe l'editor sul file caricato)…
  // poi una modifica manuale grande → snapshot 'manual'.
  const bigEdit = doc('Bozza.', 'Un lungo paragrafo scritto a mano dall\'utente. ' + 'parola '.repeat(30));
  assert.equal(V.isSignificantManualChange(base, bigEdit), true);
  const r = V.record(store, 'f', { content: bigEdit, source: 'manual', label: 'Modifica manuale', ts: 1 });
  store = r.store;
  assert.equal(r.created, true);
  assert.equal(V.latest(store, 'f').source, 'manual');
  // Una micro-correzione successiva NON sarebbe significativa rispetto a bigEdit.
  const tweak = doc('Bozza!', 'Un lungo paragrafo scritto a mano dall\'utente. ' + 'parola '.repeat(30));
  assert.equal(V.isSignificantManualChange(bigEdit, tweak), false);
});
