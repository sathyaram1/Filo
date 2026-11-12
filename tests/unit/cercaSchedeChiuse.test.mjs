// #884 — le schede chiuse che SCHEDE_CHIUSE dà alla chat: chi le ha chiuse (anche per le voci di prima), il filtro per
// periodo e motivo, e cosa esce di una pagina delicata. #1397 — la pila ricorda la scheda che ha suonato per ultima.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const C = require('../../src/main/services/cercaSchedeChiuse.js');
const SchedeChiuse = require('../../src/main/tabs/schedeChiuse.js');

const ORA = new Date(2026, 9, 28, 18, 0);
const voce = (id, closedAt, extra = {}) => ({ id, url: `https://${id}.example/pagina`, title: `Pagina ${id}`, closedAt, summary: `Parla di ${id}.`, ...extra });
const VOCI = [
  voce('orche', '2026-10-27T09:00:00', { motivo: 'mano' }),
  voce('ricetta', '2026-10-28T08:30:00', { motivo: 'pulizia', giro: 'idle', reason: 'feed già letto' }),
  voce('doppia', '2026-10-28T08:31:00', { reason: 'duplicato' }),
  voce('vecchia', '2026-09-01T10:00:00', { reason: 'manual' }),
  voce('chat', '2026-10-28T12:00:00', { motivo: 'filo' }),
  voce('crash', '2026-10-26T12:00:00', { reason: 'manual', chiusaDaSola: true }),
];

test('chi l\'ha chiusa: il motivo scritto, o quello che si legge dal reason di prima', () => {
  assert.deepEqual(VOCI.map(C.motivoDi), ['mano', 'pulizia', 'doppione', 'mano', 'filo', 'pagina']);
  assert.equal(C.motivoDi({ reason: 'Notizia di ieri, già letta' }), 'pulizia');
  assert.equal(C.motivoDi({ reason: 'auto' }), 'pulizia');
  assert.equal(C.motivoDi({ motivo: 'inventato', reason: 'manual' }), 'mano');
});

test('per periodo: da e a come giorni o istanti, dalla chiusa più di recente', () => {
  const r = C.richiesta({ da: '2026-10-28' }, { ora: ORA });
  assert.deepEqual(C.filtra(VOCI, r).map((v) => v.id), ['chat', 'doppia', 'ricetta']);
  const ieri = C.richiesta({ da: '2026-10-27', a: '2026-10-27' }, { ora: ORA });
  assert.deepEqual(C.filtra(VOCI, ieri).map((v) => v.id), ['orche']);
  assert.deepEqual(C.filtra(VOCI, C.richiesta({}, { ora: ORA })).map((v) => v.id), ['chat', 'doppia', 'ricetta', 'orche', 'crash', 'vecchia']);
  assert.match(C.richiesta({ da: 'ieri sera tardi' }).errore, /periodo/);
  assert.match(C.richiesta({ da: '2026-10-28', a: '2026-10-01' }).errore, /periodo/);
});

test('per motivo, anche detto con un sinonimo; uno sconosciuto si dice', () => {
  const quali = (m) => C.filtra(VOCI, C.richiesta({ motivo: m }, { ora: ORA })).map((v) => v.id);
  assert.deepEqual(quali('pulizia'), ['ricetta']);
  assert.deepEqual(quali('inattività'), ['ricetta']);
  assert.deepEqual(quali('filo'), ['chat']);
  assert.deepEqual(quali('assistente'), ['chat']);
  assert.deepEqual(quali('doppione'), ['doppia']);
  assert.deepEqual(quali('mano'), ['orche', 'vecchia']);
  assert.match(C.richiesta({ motivo: 'boh' }).errore, /motivo non capito/);
  assert.equal(C.richiesta({ cerca: '  orche   marine ' }).cerca, 'orche marine');
});

test('al modello: titolo, quando, perché e riassunto; di una pagina delicata solo il sito; un indirizzo tagliato non si riapre', () => {
  const p = C.perModello(VOCI[1]);
  assert.deepEqual(p, { id: 'ricetta', titolo: 'Pagina ricetta', url: 'https://ricetta.example/pagina', chiusa: '2026-10-28T08:30:00', motivo: 'pulizia', giro: 'idle', riassunto: 'Parla di ricetta.' });
  const d = C.perModello(voce('banca', '2026-10-28T09:00:00', { url: 'https://www.banca.example/conto?id=1' }), { delicata: true });
  assert.equal(d.titolo, 'banca.example');
  assert.equal(d.url, 'https://www.banca.example/');
  assert.equal(d.riassunto, '');
  assert.equal(d.delicata, true);
  const t = C.perModello(voce('lungo', '2026-10-28T09:00:00', { urlTagliato: true }));
  assert.equal(t.tagliato, true);
  assert.equal(t.url, 'https://lungo.example/');
  const lungo = C.perModello(voce('x', '2026-10-28T09:00:00', { summary: 'a'.repeat(1000) }));
  assert.equal(lungo.riassunto.length, 400);
  assert.ok(lungo.riassunto.endsWith('…'));
});

test('#1397 — la pila ridà la scheda chiusa che ha suonato per ultima, e una volta riaperta non più', () => {
  const pila = SchedeChiuse.crea();
  pila.ricorda({ url: 'https://musica.example/a', audioAt: 1000, titolo: 'Album A' });
  pila.ricorda({ url: 'https://news.example/' });
  const b = pila.ricorda({ url: 'https://musica.example/b', audioAt: 3000, titolo: 'Album B' });
  pila.ricorda({ url: 'https://musica.example/c', audioAt: 2000 });
  assert.equal(pila.ultimaCheSuonava(), b);
  pila.riprendi(b);
  assert.equal(pila.ultimaCheSuonava().url, 'https://musica.example/c');
  assert.equal(SchedeChiuse.crea().ultimaCheSuonava(), null);
});

test('una pagina delicata esce in una forma sola, la stessa per la ricerca nel filo e per SCHEDE_CHIUSE', () => {
  assert.deepEqual(C.soloSito('https://www.banca.example:8443/conto?id=1'), { sito: 'banca.example:8443', url: 'https://www.banca.example:8443/' });
  assert.deepEqual(C.soloSito('non un indirizzo'), { sito: 'sito', url: '' });
  const d = C.perModello(voce('banca', '2026-10-28T09:00:00', { url: 'https://www.banca.example:8443/conto' }), { delicata: true });
  assert.deepEqual({ titolo: d.titolo, url: d.url }, { titolo: 'banca.example:8443', url: 'https://www.banca.example:8443/' });
  const handlers = require('node:fs').readFileSync(new URL('../../src/main/services/handlers.js', import.meta.url), 'utf8');
  assert.ok(!/https:\/\/\$\{sito\}\//.test(handlers), 'la ricerca nel filo non riscrive per conto suo il sito di una pagina delicata');
});

test('#1686 — riaperta dall\'archivio, la scheda porta con sé l\'ora in cui suonava; una voce già riaperta si sa', () => {
  assert.equal(SchedeChiuse.daArchivio({ url: 'https://musica.example/', audioAt: '2026-10-28T09:00:00.000Z' }).audioAt, Date.parse('2026-10-28T09:00:00.000Z'));
  assert.equal('audioAt' in SchedeChiuse.daArchivio({ url: 'https://news.example/' }), false);
  const pila = SchedeChiuse.crea();
  assert.equal(pila.eRiaperta('a1'), false);
  pila.segnaRiaperta('a1');
  assert.equal(pila.eRiaperta('a1'), true);
});

test('lo strumento offre al modello tutti e soli i motivi che la ricerca riconosce', () => {
  require('../../src/shared/actionTools.js');
  const offerti = globalThis.SN_ACTION_TOOLS.TOOLS.SCHEDE_CHIUSE.properties.motivo.enum;
  assert.deepEqual([...offerti].sort(), [...C.MOTIVI].sort());
});
