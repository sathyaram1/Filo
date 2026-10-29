// #1476: Ctrl/Cmd+Shift+T riapre la scheda chiusa più di recente, poi quella prima, e finita la pila scende
// nell'archivio senza riproporre quelle già riaperte né quelle cancellate. Il tasto è descritto come tale.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SchedeChiuse = require('../../src/main/tabs/schedeChiuse.js');
require('../../src/shared/tasti.js');
const T = globalThis.SN_TASTI;

const voce = (url, extra = {}) => ({ url, indice: 0, storia: null, ...extra });
const arch = (id, url, closedAt, extra = {}) => ({ id, url, closedAt, ...extra });

test('la pila ridà le schede dalla più recente, una volta sola', () => {
  const p = SchedeChiuse.crea();
  p.ricorda(voce('https://a.example/'));
  p.ricorda(voce('https://b.example/'));
  assert.equal(p.quante, 2);
  assert.equal(p.prendi().url, 'https://b.example/');
  assert.equal(p.prendi().url, 'https://a.example/');
  assert.equal(p.prendi(), null);
});

test('finita la pila si scende nell\'archivio, dalla più recente, senza ripetere quelle già riaperte', () => {
  const p = SchedeChiuse.crea();
  const v = p.ricorda(voce('https://oggi.example/'));
  p.archiviata(v, 'id-oggi');
  const archivio = [
    arch('id-ieri', 'https://ieri.example/', '2026-10-21T10:00:00Z'),
    arch('id-oggi', 'https://oggi.example/', '2026-10-22T10:00:00Z'),
    arch('id-lunedi', 'https://lunedi.example/', '2026-10-19T10:00:00Z'),
  ];
  assert.equal(p.prendi().url, 'https://oggi.example/');
  // Quella appena ridata dalla pila sta anche nell'archivio: non torna una seconda volta.
  const e1 = p.dallArchivio(archivio);
  assert.equal(e1.id, 'id-ieri');
  p.segnaRiaperta(e1.id);
  assert.equal(p.dallArchivio(archivio).id, 'id-lunedi');
  p.segnaRiaperta('id-lunedi');
  assert.equal(p.dallArchivio(archivio), null);
});

test('una scheda ripresa dalla pila prima che l\'archivio risponda non torna dall\'archivio', () => {
  const p = SchedeChiuse.crea();
  const v = p.ricorda(voce('https://lenta.example/'));
  p.prendi();
  p.archiviata(v, 'id-lenta');
  assert.equal(p.dallArchivio([arch('id-lenta', 'https://lenta.example/', '2026-10-22T10:00:00Z')]), null);
});

// Chi conta le riaperte ha bisogno della voce d'archivio: con la scheda ripresa, o dopo, se l'archivio è lento.
test('la pila ridà la voce d\'archivio con la scheda, e dice se l\'archivio ha risposto a scheda già ripresa', () => {
  const p = SchedeChiuse.crea();
  const e = arch('id-b', 'https://b.example/', '2026-10-22T10:00:00Z');
  const b = p.ricorda(voce('https://b.example/'));
  assert.equal(p.archiviata(b, e), false);
  assert.equal(p.prendi().voceArchivio, e);
  const lenta = p.ricorda(voce('https://lenta.example/'));
  p.prendi();
  assert.equal(p.archiviata(lenta, arch('id-l', 'https://lenta.example/', '2026-10-22T11:00:00Z')), true);
});

test('l\'archivio non ripropone indirizzi tagliati né pagine che non sono siti', () => {
  const p = SchedeChiuse.crea();
  const archivio = [
    arch('t', 'https://tagliato.example/', '2026-10-22T12:00:00Z', { urlTagliato: true }),
    arch('f', 'filo://options/options.html', '2026-10-22T11:00:00Z'),
    arch('ok', 'https://buona.example/', '2026-10-22T09:00:00Z'),
  ];
  assert.equal(p.dallArchivio(archivio).id, 'ok');
  assert.equal(p.dallArchivio([]), null);
  assert.equal(p.dallArchivio(null), null);
});

test('una scheda cancellata dall\'archivio (o mai entrata) non torna nemmeno dalla pila', () => {
  const p = SchedeChiuse.crea();
  const a = p.ricorda(voce('https://a.example/'));
  const b = p.ricorda(voce('https://b.example/'));
  const c = p.ricorda(voce('https://c.example/'));
  p.archiviata(a, 'id-a');
  p.archiviata(b, 'id-b');
  // Le sue pagine erano state tolte dal filo: l'archivio l'ha rifiutata.
  p.archiviata(c, null);
  p.dimentica(['id-b']);
  assert.equal(p.prendi().url, 'https://a.example/');
  assert.equal(p.prendi(), null);

  const q = SchedeChiuse.crea();
  q.ricorda(voce('filo://options/options.html'));
  q.dimentica(null);
  assert.equal(q.quante, 0, 'archivio svuotato: la pila si svuota con lui');
});

test('riaperta da un\'altra porta (la ricerca del filo), la scheda esce anche dalla pila', () => {
  const p = SchedeChiuse.crea();
  const a = p.ricorda(voce('https://a.example/'));
  p.archiviata(a, 'id-a');
  p.segnaRiaperta('id-a');
  assert.equal(p.prendi(), null);
});

test('oltre il tetto se ne vanno le più vecchie, le recenti restano in ordine', () => {
  const p = SchedeChiuse.crea({ tetto: 3 });
  for (const n of [1, 2, 3, 4, 5]) p.ricorda(voce(`https://${n}.example/`));
  assert.equal(p.quante, 3);
  assert.deepEqual([p.prendi(), p.prendi(), p.prendi()].map((v) => v.url),
    ['https://5.example/', 'https://4.example/', 'https://3.example/']);
  assert.ok(SchedeChiuse.TETTO >= 100, 'il tetto vero è abbondante');
});

test('una home vuota non si ricorda; una home con cronologia, una pagina di Filo o un sito sì', () => {
  const vuota = { prima: [], dopo: [] };
  assert.equal(SchedeChiuse.daRicordare('filo://newtab/', vuota), false);
  assert.equal(SchedeChiuse.daRicordare('filo://newtab/', null), false);
  assert.equal(SchedeChiuse.daRicordare('', null), false);
  assert.equal(SchedeChiuse.daRicordare('about:blank', null), false);
  assert.equal(SchedeChiuse.daRicordare('filo://newtab/', { prima: [{ url: 'https://a.example/' }], dopo: [] }), true);
  assert.equal(SchedeChiuse.daRicordare('filo://newtab/?chat=x', vuota), true);
  assert.equal(SchedeChiuse.daRicordare('filo://options/options.html', vuota), true);
  assert.equal(SchedeChiuse.daRicordare('https://a.example/', vuota), true);
});

test('una voce d\'archivio diventa una voce da riaprire con scroll, paese e colore', () => {
  const v = SchedeChiuse.daArchivio(arch('x', 'https://a.example/', '2026-10-22T10:00:00Z', {
    scrollPosition: 40, proxy: { country: 'us', tier: 'residential' }, identityColor: 'rgb(1,2,3)',
  }));
  assert.deepEqual(v, { url: 'https://a.example/', scroll: 40, proxy: { country: 'us', tier: 'residential' }, colore: 'rgb(1,2,3)' });
  assert.deepEqual(SchedeChiuse.daArchivio({ url: 'https://b.example/' }), { url: 'https://b.example/', scroll: null, proxy: null, colore: null });
});

test('Ctrl+Shift+T è descritto come «riapre l\'ultima scheda chiusa» su ogni sistema', () => {
  for (const [scritta, s] of [['Ctrl+Shift+T', 'win32'], ['Ctrl+Shift+T', 'linux'], ['Cmd+Shift+T', 'darwin']]) {
    assert.match(T.chiLaPrende(scritta, s), /riapre l'ultima scheda chiusa/, `${scritta} su ${s}`);
  }
  assert.match(T.chiLaPrende('Ctrl+T', 'win32'), /apre una scheda nuova/);
});
