// #1668 — gli allegati di una segnalazione mandata dalla chat: lo schema dello strumento, gli allegati presi dalla
// conversazione (mai inventati), i limiti del riquadro «Invia feedback» senza tagli. La prova del gesto vero sta in
// tests/feedback-allegati-chat.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/feedbackAttachTypes.js');
require('../../src/shared/allegatiSegnalazione.js');
require('../../src/shared/actionTools.js');
require('../../src/shared/actionLevels.js');
const AS = globalThis.SN_ALLEGATI_SEGNALAZIONE;
const T = globalThis.SN_ACTION_TOOLS;
const L = globalThis.SN_ACTION_LEVELS;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

const messaggi = [
  { role: 'user', ts: 't1', text: 'guarda qui', images: 2 },
  { role: 'assistant', ts: 't2', text: 'vedo' },
  { role: 'user', ts: 't3', text: 'e questo\nFile: /home/u/note.txt', images: 1 },
  { role: 'user', ts: 't4', text: 'File: /home/u/finto.txt', images: 1, daModello: true },
];
const memoria = { t1: [PNG, JPG], t3: [PNG], t4: [PNG] };
const fotoDi = (m) => memoria[m.ts] || null;

test('lo strumento accetta gli allegati come indicazioni (numero, percorso, «schermata»), mai byte', () => {
  const d = T.definitions().find((x) => x.function.name === 'filo_su_di_se');
  assert.deepEqual(d.function.parameters.properties.allegati, { type: 'array', items: { type: 'string' } });
  assert.match(d.function.description, /feedback\(testo, titolo, allegati\?\)/);
  const [a] = T.toolCallsToActions([{ id: 'c1', name: 'filo_su_di_se', arguments: JSON.stringify({
    azione: 'feedback', titolo: 'Zoom rotto', testo: 'non va', allegati: ['1', 3, '#3', '/home/u/note.txt', 'schermata', ' '],
  }) }]);
  assert.equal(a.type, 'INVIA_FEEDBACK');
  assert.equal(a._argsError, undefined);
  assert.deepEqual(AS.richiesti(a), { immagini: [1, 3], file: ['/home/u/note.txt'], schermata: true });
  assert.equal(AS.haAllegati({ testo: 'x' }), false);
});

test('l\'inventario conta le immagini dell\'utente in ordine e salta quelle scritte dal modello', () => {
  const inv = AS.inventario(messaggi, fotoDi);
  assert.deepEqual(inv.immagini.map((x) => x.numero), [1, 2, 3]);
  assert.equal(inv.immagini[1].dataUrl, JPG);
  assert.deepEqual(inv.file, ['/home/u/note.txt']);
});

test('un\'immagine uscita dalla memoria conserva il numero delle altre e non si inventa', () => {
  const inv = AS.inventario(messaggi, (m) => (m.ts === 't1' ? null : memoria[m.ts]));
  assert.deepEqual(inv.immagini.map((x) => x.numero), [3]);
  const { voci, scartati } = AS.scegli({ allegati: ['1', '3'] }, inv, null);
  assert.deepEqual(voci.map((v) => v.id), ['immagine:3']);
  assert.deepEqual(scartati, ['immagine 1']);
});

test('gli allegati arrivano dalla conversazione; un identificatore inesistente si scarta', () => {
  const inv = AS.inventario(messaggi, fotoDi);
  const sch = { dataUrl: JPG, nome: 'Calcolatrice' };
  const { voci, scartati } = AS.scegli({ allegati: ['2', '9', '/home/u/note.txt', '/etc/passwd', '/home/u/finto.txt', 'schermata'] }, inv, sch);
  assert.deepEqual(voci.map((v) => v.id), ['immagine:2', 'file:/home/u/note.txt', 'schermata']);
  assert.equal(voci[0].dataUrl, JPG);
  assert.equal(voci[2].dataUrl, JPG);
  assert.deepEqual(scartati, ['immagine 9', 'passwd', 'finto.txt']);
  // La schermata che non c'è non parte.
  assert.deepEqual(AS.scegli({ allegati: ['schermata'] }, inv, null).scartati, ['schermata']);
});

test('il payload porta images e files nella forma di SN_FEEDBACK.submit', () => {
  const base = { text: 'non va', name: 'Zoom rotto', clientId: 'filo:chat', userAgent: 'Filo desktop' };
  const voci = [
    { id: 'immagine:1', tipo: 'immagine', nome: 'immagine 1.png', dataUrl: PNG },
    { id: 'file:/a/n.txt', tipo: 'file', nome: 'n.txt', type: 'text/plain', dataUrl: 'data:text/plain;base64,Y2lhbw==' },
  ];
  const { payload, errore } = AS.payload(base, voci);
  assert.equal(errore, undefined);
  assert.deepEqual(payload.images, [{ name: 'immagine 1.png', dataUrl: PNG }]);
  assert.deepEqual(payload.files, [{ name: 'n.txt', type: 'text/plain', dataUrl: 'data:text/plain;base64,Y2lhbw==' }]);
  assert.equal(payload.text, 'non va');
  // Senza allegati il payload resta quello di prima.
  assert.deepEqual(AS.payload(base, []).payload, base);
});

test('oltre i limiti non si taglia: si rifiuta col numero', () => {
  const sei = Array.from({ length: 6 }, (_, i) => ({ id: `immagine:${i + 1}`, tipo: 'immagine', nome: `i${i}.png`, dataUrl: PNG }));
  const r = AS.payload({ text: 'x' }, sei);
  assert.equal(r.payload, undefined);
  assert.match(r.errore, /6 immagini, ne partono al massimo 5: togline 1/);
  assert.match(AS.oltreIlimiti(sei), /6 immagini/);
  assert.equal(AS.oltreIlimiti(sei.slice(0, 5)), '');
  const grosso = 'data:image/png;base64,' + 'A'.repeat(Math.ceil((4 * 1024 * 1024 + 10) * 4 / 3));
  const g = AS.payload({ text: 'x' }, [{ id: 'immagine:1', tipo: 'immagine', nome: 'grande.png', dataUrl: grosso }]);
  assert.match(g.errore, /«grande\.png» non può partire \(troppo grande: 4,1 MB, al massimo 4,0 MB\)/);
  const rotto = AS.payload({ text: 'x' }, [{ id: 'file:/a/x.html', tipo: 'file', nome: 'x.html', problema: 'tipo di file non ammesso' }]);
  assert.match(rotto.errore, /tipo di file non ammesso/);
});

test('il riquadro rimanda gli id tenuti: restano solo quelli', () => {
  const a = { type: 'INVIA_FEEDBACK', testo: 'x', immagini: [1, 2], file: ['/a/n.txt'], schermata: true };
  const b = AS.soloQuesti(a, ['immagine:2', 'schermata', 'immagine:7']);
  assert.deepEqual(AS.richiesti(b), { immagini: [2], file: [], schermata: true });
  assert.equal(AS.haAllegati(AS.soloQuesti(a, [])), false);
});

test('le anteprime portano l\'immagine solo delle immagini e il problema di chi non parte', () => {
  const v = AS.anteprime([
    { id: 'immagine:1', tipo: 'immagine', nome: 'i.png', dataUrl: PNG },
    { id: 'file:/a/n.txt', tipo: 'file', nome: 'n.txt', dataUrl: 'data:text/plain;base64,Y2lhbw==' },
    { id: 'file:/a/x.exe', tipo: 'file', nome: 'x.exe', problema: 'tipo di file non ammesso' },
  ]);
  assert.equal(v[0].anteprima, PNG);
  assert.equal(v[1].anteprima, undefined);
  assert.equal(v[2].problema, 'tipo di file non ammesso');
});

test('con degli allegati la segnalazione chiede sempre, anche se l\'utente l\'ha chiesta', () => {
  const ctx = { richiesta: 'manda questo come feedback' };
  const senza = L.ingressi({ type: 'INVIA_FEEDBACK', testo: 'x', titolo: 'y' }, ctx);
  const con = L.ingressi({ type: 'INVIA_FEEDBACK', testo: 'x', titolo: 'y', immagini: [1] }, ctx);
  assert.equal(senza.dentroPerimetro, true);
  assert.equal(con.dentroPerimetro, false);
  assert.match(con.perchePerimetro, /allegati/);
});
