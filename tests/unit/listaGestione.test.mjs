// #2470: la Gestione all'apertura chiede i cambiati e il conto, non tutti i feedback; le schede pubbliche a delta.
// Le letture si contano su un Firestore finto. Regole in src/main/services/listaGestione.js. Senza rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LG = require(join(ROOT, 'src', 'main', 'services', 'listaGestione.js'));

const iso = (ms) => new Date(ms).toISOString();
const CAMPI = ['name', 'status', 'updatedAt'];

function mondo(n = 2000) {
  let ora = Date.parse('2026-11-14T08:00:00Z');
  const docs = new Map();
  for (let i = 0; i < n; i += 1) docs.set(`d${i}`, { _id: `d${i}`, name: `n${i}`, _updateTime: iso(ora - 86400e3), updatedAt: iso(ora - 86400e3) });
  const letture = { tutti: 0, documenti: 0, cambiati: 0, conti: 0 };
  let disco = null;
  const deps = {
    adesso: () => ora,
    leggiTutti: async ({ fields }) => {
      assert.deepEqual(fields, CAMPI);
      letture.tutti += 1; letture.documenti += docs.size;
      return { rows: [...docs.values()].map((d) => ({ ...d })), complete: true, readTime: iso(ora) };
    },
    leggiCambiati: async ({ since }) => {
      letture.cambiati += 1;
      const rows = [...docs.values()].filter((d) => d.updatedAt > since).map((d) => ({ ...d }));
      letture.documenti += Math.max(1, rows.length);
      return { rows, complete: true, readTime: iso(ora) };
    },
    conta: async () => { letture.conti += 1; letture.documenti += Math.ceil(docs.size / 1000); return docs.size; },
    leggiFile: () => disco,
    scriviFile: (t) => { disco = t; },
    togliFile: () => { disco = null; },
  };
  return {
    deps, letture, docs,
    disco: () => disco,
    avanza: (ms) => { ora += ms; },
    scrivi: (id, extra = {}) => { ora += 1; docs.set(id, { ...(docs.get(id) || { _id: id }), ...extra, _updateTime: iso(ora), updatedAt: iso(ora) }); },
  };
}

const attendi = () => new Promise((r) => setImmediate(r));

test('la seconda apertura, anche dopo un riavvio, legge i soli cambiati più il conto', async () => {
  const m = mondo();
  const lista = LG.creaLista(m.deps);
  const prima = await lista.carica({ chi: 'owner@x', campi: CAMPI });
  assert.equal(prima.rows.length, 2000);
  assert.equal(m.letture.tutti, 1);
  await attendi();
  assert.ok(m.disco(), 'la copia resta sul disco');

  m.avanza(3600e3);
  m.scrivi('d5', { name: 'cambiato' });
  m.scrivi('nuovo', { name: 'arrivato' });
  const prima2 = m.letture.documenti;
  // Un main nuovo (Filo riavviato) con lo stesso disco.
  const dopo = await LG.creaLista(m.deps).carica({ chi: 'owner@x', campi: CAMPI });
  assert.equal(m.letture.tutti, 1, 'nessuna lettura intera');
  assert.equal(dopo.rows.length, 2001);
  assert.equal(dopo.rows.find((r) => r._id === 'd5').name, 'cambiato');
  assert.ok(dopo.daCopia);
  assert.equal(dopo.pienoAt, prima.pienoAt, 'il riallineamento si conta dall\'ultima lettura intera');
  assert.ok(m.letture.documenti - prima2 <= 5, `letture all'apertura: ${m.letture.documenti - prima2}`);
});

test('un conto che non torna (cancellazione), un\'altra persona, sei ore o un conto non letto: si rilegge tutto', async () => {
  const m = mondo(50);
  const lista = LG.creaLista(m.deps);
  await lista.carica({ chi: 'owner@x', campi: CAMPI });
  m.docs.delete('d7');
  const r = await lista.carica({ chi: 'owner@x', campi: CAMPI });
  assert.equal(m.letture.tutti, 2);
  assert.ok(!r.rows.some((x) => x._id === 'd7'));

  await lista.carica({ chi: 'altro@x', campi: CAMPI });
  assert.equal(m.letture.tutti, 3, 'la copia è di chi l\'ha letta');

  m.avanza(LG.PIENO_MS + 1);
  await lista.carica({ chi: 'altro@x', campi: CAMPI });
  assert.equal(m.letture.tutti, 4);

  const rotto = LG.creaLista({ ...m.deps, conta: async () => { throw new Error('rete'); } });
  await rotto.carica({ chi: 'altro@x', campi: CAMPI });
  assert.equal(m.letture.tutti, 5);
});

test('all\'uscita dall\'account la copia sparisce dal disco', async () => {
  const m = mondo(5);
  const lista = LG.creaLista(m.deps);
  await lista.carica({ chi: 'owner@x', campi: CAMPI });
  await attendi();
  assert.ok(m.disco());
  lista.dimentica();
  assert.equal(m.disco(), null);
  await lista.carica({ chi: 'owner@x', campi: CAMPI });
  assert.equal(m.letture.tutti, 2);
});

test('due aperture insieme pagano una lettura', async () => {
  const m = mondo(10);
  const lista = LG.creaLista(m.deps);
  await Promise.all([lista.carica({ chi: 'o', campi: CAMPI }), lista.carica({ chi: 'o', campi: CAMPI })]);
  assert.equal(m.letture.tutti, 1);
});

function schede(n = 1200) {
  let ora = Date.parse('2026-11-14T08:00:00Z');
  const carte = new Map();
  for (let i = 0; i < n; i += 1) carte.set(`c${i}`, { _id: `c${i}`, votes: {}, publishedAt: iso(ora - 86400e3 + i) });
  const letture = { tutte: 0, cambiate: 0, documenti: 0 };
  const deps = {
    adesso: () => ora,
    leggiTutte: async () => { letture.tutte += 1; letture.documenti += carte.size; return [...carte.values()].map((c) => ({ ...c })); },
    leggiCambiate: async ({ since }) => {
      letture.cambiate += 1;
      const rows = [...carte.values()].filter((c) => c.publishedAt > since).map((c) => ({ ...c }));
      letture.documenti += Math.max(1, rows.length);
      return { rows, complete: true };
    },
  };
  return { deps, letture, carte, avanza: (ms) => { ora += ms; }, pubblica: (id) => { ora += 1; carte.set(id, { _id: id, votes: { u: 1 }, publishedAt: iso(ora) }); } };
}

test('le schede: tutte una volta, poi le sole cambiate; le scritture del main aggiornano la copia', async () => {
  const s = schede();
  const S = LG.creaSchede(s.deps);
  assert.equal((await S.tutte()).length, 1200);
  assert.equal((await S.tutte()).length, 1200);
  assert.equal(s.letture.tutte, 1, 'la seconda domanda di fila risponde con quello che c\'è');
  s.avanza(60e3);
  s.pubblica('c3');
  const dopo = await S.tutte();
  assert.equal(s.letture.tutte, 1);
  assert.deepEqual(dopo.find((c) => c._id === 'c3').votes, { u: 1 });
  S.tolta('c9');
  S.scritta('c10', { name: 'riscritta' });
  const ora = await S.tutte();
  assert.ok(!ora.some((c) => c._id === 'c9'));
  assert.equal(ora.find((c) => c._id === 'c10').name, 'riscritta');
  assert.ok(s.letture.documenti < 1210, `letture: ${s.letture.documenti}`);
  s.avanza(LG.PIENO_MS + 1);
  await S.tutte();
  assert.equal(s.letture.tutte, 2, 'ogni sei ore tutte di nuovo');
  S.dimentica();
  await S.tutte({});
  assert.equal(s.letture.tutte, 3, 'dopo una scrittura dall\'esito incerto si rilegge tutto');
});
