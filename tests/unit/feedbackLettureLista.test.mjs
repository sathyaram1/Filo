// Quanto costa ELENCARE i feedback: richieste, documenti letti e byte che
// tornano indietro. Non deve fermare: niente rete vera, `fetch` è un doppio.
// La regola narrata sta nel commento di CAMPI_LISTA in src/shared/feedback.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
require(resolve(ROOT, 'src', 'shared', 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;

// Un feedback come sono quelli veri: il report della lavorazione e i livelli
// pesano decine di KB, il resto della riga poche centinaia di byte.
function feedbackFinto(i, extra = {}) {
  return {
    _id: `fb${i}`,
    seq: i,
    subSeq: 0,
    name: `Segnalazione ${i}`,
    text: 'Non funziona il tasto.',
    status: 'done',
    statusPublic: 'closed',
    priority: 2,
    createdAt: '2026-09-01T10:00:00Z',
    resolvedAt: '2026-09-10T10:00:00Z',
    notes: 'R'.repeat(24_000),
    livelli: { l4: { esito: 'ok', at: '2026-09-10T09:00:00Z', ruolo: 'secaudit', by: 'x', testo: 'S'.repeat(12_000) } },
    reviewComment: 'C'.repeat(2_000),
    images: ['https://example.invalid/a.png'],
    files: [{ url: 'https://example.invalid/b.txt', name: 'b.txt', type: 'text/plain' }],
    ...extra,
  };
}

function valore(v) {
  if (typeof v === 'number') return { integerValue: String(v) };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valore) } };
  if (v && typeof v === 'object') {
    const fields = {};
    for (const [k, vv] of Object.entries(v)) fields[k] = valore(vv);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function documento(fb, soloCampi) {
  const fields = {};
  for (const [k, v] of Object.entries(fb)) {
    if (k.startsWith('_')) continue;
    if (soloCampi && !soloCampi.includes(k)) continue;
    fields[k] = valore(v);
  }
  return {
    name: `projects/p/databases/(default)/documents/feedback/${fb._id}`,
    fields,
    createTime: '2026-09-01T10:00:00Z',
    updateTime: '2026-09-10T10:00:00Z',
  };
}

// Il doppio della rete: risponde con i feedback che gli si danno, rispettando
// la proiezione chiesta, e tiene il conto di richieste, documenti e byte.
function reteFinta(feedbacks) {
  const conto = { richieste: 0, documenti: 0, byte: 0, query: [] };
  globalThis.fetch = async (url, init) => {
    conto.richieste += 1;
    const body = JSON.parse((init && init.body) || '{}');
    let corpo;
    if (body.structuredQuery) {
      const q = body.structuredQuery;
      conto.query.push(q);
      const campi = (q.select && q.select.fields || []).map((f) => f.fieldPath);
      let righe = feedbacks.slice();
      const filtro = q.where && q.where.fieldFilter;
      if (filtro) {
        const soglia = filtro.value.timestampValue;
        righe = righe.filter((f) => String(f[filtro.field.fieldPath] || '') > soglia);
      }
      const dopo = q.startAt && q.startAt.values && q.startAt.values[0];
      if (dopo) righe = righe.filter((f) => String(f.resolvedAt || '') < dopo.timestampValue);
      righe = righe.slice(0, q.limit || righe.length);
      corpo = righe.map((f) => ({ document: documento(f, campi.length ? campi : null) }));
      conto.documenti += righe.length;
    } else {
      const campi = body.mask && body.mask.fieldPaths;
      const voluti = new Set((body.documents || []).map((d) => String(d).split('/').pop()));
      const righe = feedbacks.filter((f) => voluti.has(f._id));
      corpo = righe.map((f) => ({ found: documento(f, campi || null) }));
      conto.documenti += righe.length;
    }
    const testo = JSON.stringify(corpo);
    conto.byte += Buffer.byteLength(testo, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(testo), text: async () => testo };
  };
  return conto;
}

test('la lista proiettata torna gli stessi feedback, con una frazione dei byte', async () => {
  const dati = Array.from({ length: 50 }, (_, i) => feedbackFinto(i + 1));

  const intero = reteFinta(dati);
  const tutto = await FB.list({ pageSize: 500, idToken: 'x' });

  const leggero = reteFinta(dati);
  const righe = await FB.list({ pageSize: 500, idToken: 'x', fields: FB.CAMPI_LISTA });

  // Stessi feedback, stessi titoli, stessi stati: la lista non perde niente.
  assert.deepEqual(righe.map((r) => r._id), tutto.map((r) => r._id));
  assert.deepEqual(righe.map((r) => r.name), tutto.map((r) => r.name));
  assert.deepEqual(righe.map((r) => r.status), tutto.map((r) => r.status));
  assert.deepEqual(righe.map((r) => r.priority), tutto.map((r) => r.priority));
  assert.equal(leggero.documenti, intero.documenti);

  // Quello che non c'è più è la parte che una riga non mostra mai.
  assert.equal(righe[0].notes, undefined);
  assert.equal(righe[0].livelli, undefined);
  assert.equal(righe[0].images, undefined);
  assert.equal(FB.soloLista(righe[0]), true);

  // Il taglio è quello che ci si aspetta: meno di un decimo dei byte.
  assert.ok(leggero.byte * 10 < intero.byte,
    `proiezione ${leggero.byte} byte contro ${intero.byte}: il taglio non c'è`);
});

test('chi apre un feedback si riprende tutto', async () => {
  const dati = [feedbackFinto(1)];
  reteFinta(dati);
  const [pieno] = await FB.getMany(['fb1'], { idToken: 'x' });
  assert.equal(pieno.notes.length, 24_000);
  assert.deepEqual(pieno.images, ['https://example.invalid/a.png']);
  assert.equal(pieno.files[0].name, 'b.txt');
  assert.equal(FB.soloLista(pieno), false);
});

test('anche getMany sa chiedere la sola proiezione', async () => {
  const dati = [feedbackFinto(1)];
  reteFinta(dati);
  const [riga] = await FB.getMany(['fb1'], { idToken: 'x', fields: FB.CAMPI_LISTA });
  assert.equal(riga.name, 'Segnalazione 1');
  assert.equal(riga.notes, undefined);
  assert.equal(FB.soloLista(riga), true);
});

test('i chiusi si chiedono dall_ultima sincronizzazione, non gli ultimi 500', async () => {
  const vecchi = Array.from({ length: 40 }, (_, i) => feedbackFinto(i + 1, {
    _id: `vecchio${i}`, resolvedAt: `2026-08-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
  }));
  const nuovo = feedbackFinto(99, { _id: 'chiuso-oggi', resolvedAt: '2026-09-20T10:00:00Z' });
  const dati = [nuovo, ...vecchi];

  const senzaData = reteFinta(dati);
  const tutti = await FB.listResolved({ idToken: 'x' });
  assert.equal(tutti.length, 41);
  assert.equal(senzaData.documenti, 41);
  assert.equal(senzaData.query[0].where, undefined, 'senza data non si filtra: è il ripiego');

  const conData = reteFinta(dati);
  const nuovi = await FB.listResolved({ idToken: 'x', sinceIso: '2026-09-01T00:00:00Z' });
  // Quello chiuso dopo l'ultima sincronizzazione arriva; quelli chiusi prima
  // non vengono nemmeno riletti.
  assert.deepEqual(nuovi.map((r) => r._id), ['chiuso-oggi']);
  assert.equal(conData.documenti, 1);
  assert.equal(conData.query[0].where.fieldFilter.field.fieldPath, 'resolvedAt');
  assert.equal(conData.query[0].where.fieldFilter.op, 'GREATER_THAN');
});

test('se le chiusure arretrate sono tante, si pagina invece di tagliarle', async () => {
  // Cento chiusure dopo l'ultima sincronizzazione, con una pagina da dieci:
  // senza cursore ne resterebbero fuori novanta, in silenzio.
  const dati = Array.from({ length: 100 }, (_, i) => feedbackFinto(i + 1, {
    _id: `c${String(i).padStart(3, '0')}`,
    resolvedAt: `2026-09-${String(30 - Math.floor(i / 4)).padStart(2, '0')}T${String(23 - (i % 4) * 5).padStart(2, '0')}:00:00Z`,
  }));
  dati.sort((a, b) => (a.resolvedAt < b.resolvedAt ? 1 : -1));
  const conto = reteFinta(dati);
  const righe = await FB.listResolved({ idToken: 'x', pageSize: 10, sinceIso: '2026-09-01T00:00:00Z' });
  assert.equal(righe.length, 100);
  assert.ok(conto.richieste >= 10, `pagine chieste: ${conto.richieste}`);
  assert.equal(new Set(righe.map((r) => r._id)).size, 100, 'nessun doppione fra le pagine');
});
