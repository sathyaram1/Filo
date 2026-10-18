// Il giro dal vivo dalla parte della pagina (src/shared/feedbackLivePagina.js), quello di Gestione e Feedback:
// fuori vista non legge niente e quello che servirebbe leggere parte al rientro; la finestra dei più recenti
// non fa entrare i vecchi; un giro appeso si abbandona.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shared');
require(join(SRC, 'feedbackTransitions.js'));
require(join(SRC, 'feedbackStatus.js'));
require(join(SRC, 'manageReview.js'));
require(join(SRC, 'feedbackLive.js'));
require(join(SRC, 'feedbackLivePagina.js'));
const LIVE = globalThis.SN_FEEDBACK_LIVE;
const PAG = globalThis.SN_FEEDBACK_LIVE_PAGINA;
const MR = globalThis.SN_MANAGE_REVIEW;

const doc = (id, status, extra = {}) => ({ _id: id, _updateTime: 'v1', status, createdAt: '2026-09-01T10:00:00Z', ...extra });

function pagina(lista, extra = {}) {
  const log = { letture: [], ridisegni: [], dopo: 0, fusioni: 0, giri: 0 };
  let righe = lista.slice();
  const server = new Map(lista.map((d) => [d._id, { ...d }]));
  const live = PAG.crea({
    invia: async (m) => (m && m.type === 'tab_in_vista_get' ? { ok: true, inVista: true } : { ok: true }),
    sorgenti: {
      giro: async () => { log.giri += 1; return { ok: true, giro: { kind: 'skipped' } }; },
      getMany: async (ids) => { log.letture.push(...ids); return ids.map((id) => server.get(id)).filter(Boolean); },
    },
    pronta: () => true,
    righe: () => righe,
    sostituisci: (l) => { righe = l; },
    sezioneDi: (f) => MR.manageTabFor(f, {}),
    seguiti: () => [],
    dopoFusione: () => { log.dopo += 1; },
    ridisegna: (r) => { log.ridisegni.push(Array.from(r.ids)); },
    rileggiFusioni: () => { log.fusioni += 1; },
    ...extra,
  });
  return { live, log, server, righe: () => righe };
}

test('fuori vista un riallineamento non legge: le versioni aspettano il rientro, poi si rileggono i cambiati', async () => {
  const p = pagina([doc('a', 'design'), doc('b', 'todo')]);
  p.live.impostaVista(false);
  p.server.set('a', doc('a', 'todo', { _updateTime: 'v2' }));
  await p.live.applicaEsito({ kind: 'reconcile', versions: [{ _id: 'a', _updateTime: 'v2' }, { _id: 'b', _updateTime: 'v1' }] });
  assert.deepEqual(p.log.letture, []);
  assert.equal(p.righe().find((f) => f._id === 'a').status, 'design');

  p.live.impostaVista(true);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(p.log.letture, ['a']);
  assert.equal(p.righe().find((f) => f._id === 'a').status, 'todo');
  assert.deepEqual(p.log.ridisegni, [['a']]);
  p.live.stop();
});

test('fuori vista le righe già arrivate entrano subito; ridisegno e rilettura delle fusioni aspettano', async () => {
  const p = pagina([doc('a', 'working')]);
  p.live.impostaVista(false);
  await p.live.applicaEsito({ kind: 'changed', rows: [doc('a', 'revision_security', { _updateTime: 'v2' })] });
  assert.equal(p.righe()[0].status, 'revision_security');
  assert.equal(p.log.dopo, 1, 'il lavoro senza letture non aspetta');
  assert.deepEqual(p.log.ridisegni, []);
  assert.equal(p.log.fusioni, 0);

  p.live.impostaVista(true);
  assert.equal(p.log.fusioni, 1);
  assert.deepEqual(p.log.ridisegni, [['a']]);
});

test('una pagina che tiene i più recenti non fa entrare dal riallineamento quelli più vecchi della sua finestra', async () => {
  const soglia = Date.parse('2026-09-01T00:00:00Z');
  const p = pagina([doc('a', 'design')], { finestra: () => soglia });
  p.server.set('nuovo', doc('nuovo', 'unlabeled', { createdAt: '2026-09-02T00:00:00Z' }));
  p.server.set('vecchio', doc('vecchio', 'done', { createdAt: '2026-01-01T00:00:00Z' }));
  await p.live.applicaEsito({
    kind: 'reconcile',
    versions: ['a', 'nuovo', 'vecchio'].map((id) => ({ _id: id, _updateTime: 'v1', createdAt: p.server.get(id).createdAt })),
  });
  assert.deepEqual(p.log.letture, ['nuovo']);
  assert.deepEqual(p.righe().map((f) => f._id).sort(), ['a', 'nuovo']);
});

test('un giro che non risponde si abbandona oltre il tempo, e il successivo parte', async () => {
  let chiamate = 0;
  const p = pagina([doc('a', 'design')], {
    sorgenti: {
      giro: async () => { chiamate += 1; return chiamate === 1 ? new Promise(() => {}) : { ok: true, giro: { kind: 'skipped' } }; },
      getMany: async () => [],
    },
  });
  p.live.tempi({ pollMs: 0, clockMs: 60_000, bloccatoMs: 30 });
  p.live.start();
  p.live.orologio('battito');
  assert.equal(chiamate, 1);
  p.live.orologio('battito');
  assert.equal(chiamate, 1, 'finché non scade, il giro appeso si aspetta');
  await new Promise((r) => setTimeout(r, 40));
  p.live.orologio('battito');
  assert.equal(chiamate, 2);
  p.live.stop();
});

test('le richieste di fusione: il campanello che non porta le pre-approvate non le cancella', () => {
  const prima = LIVE.fusioniDa({ pending: [{ id: 'x' }], preapproved: [{ id: 'p' }] });
  const dopo = LIVE.fusioniDa({ pending: [] }, prima);
  assert.deepEqual(dopo, { pending: [], failed: [], recent: [], preapproved: [{ id: 'p' }] });
  assert.deepEqual(LIVE.fusioniDa(null), { pending: [], failed: [], recent: [], preapproved: [] });
});

test('le fusioni ferme stanno davanti, le altre nell\'ordine che avevano', () => {
  const fusioni = { pending: [{ id: 'r', feedbackId: 'c', num: '3' }] };
  const lista = [doc('a', 'design', { seq: 1 }), doc('b', 'design', { seq: 2 }), doc('c', 'revision_security', { seq: 3 })];
  assert.deepEqual(MR.fusioniFermeInCima(lista, { fusioni }).map((f) => f._id), ['c', 'a', 'b']);
  assert.equal(MR.manageTabFor(lista[2], { fusioni }), 'inbox');
});
