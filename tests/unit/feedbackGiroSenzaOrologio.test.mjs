// Il giro al minuto della dashboard non si fida di una data scritta a mano
// (#676). `updatedAt` lo firma chi scrive: il server delle routine non lo
// firma affatto, e una macchina con l'orologio indietro lo firma nel passato.
// Qui si verifica che la dashboard veda lo stesso il cambiamento, grazie ai due
// segni che nessun orologio tocca: l'ora d'ultima scrittura che tiene Firestore
// (per i feedback che la pagina sta seguendo) e il contatore degli invii.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'src', 'shared');
require(join(SRC, 'feedbackLive.js'));
const LIVE = globalThis.SN_FEEDBACK_LIVE;

/**
 * Un giro con le due sorgenti senza orologio collegate. `mondo` tiene l'ora
 * vera di Firestore per ciascun feedback e il contatore degli invii; le prove
 * la cambiano come farebbe una scrittura che non firma niente.
 */
function giro(mondo) {
  const log = { versioni: 0, cambiati: 0, versionsOf: 0, letti: [], avvisi: [], lamentele: [], contatori: 0 };
  let t = 1_000_000;
  const w = LIVE.makeWatcher({
    now: () => t,
    pageSize: 100,
    broadcast: (m) => log.avvisi.push(m),
    onWarn: (m) => log.lamentele.push(String(m)),
    listVersions: async () => {
      log.versioni += 1;
      return Object.entries(mondo.ore).map(([id, _updateTime]) => ({
        _id: id, _updateTime, createdAt: '2026-09-01T00:00:00Z',
      }));
    },
    listChangedSince: async () => {
      log.cambiati += 1;
      return { rows: (mondo.cambiati || []).slice(), complete: true };
    },
    seguiti: () => mondo.seguiti,
    versionsOf: async (ids) => {
      log.versionsOf += 1;
      log.ultimiChiesti = ids.slice();
      return ids.filter((id) => mondo.ore[id]).map((id) => ({ _id: id, _updateTime: mondo.ore[id] }));
    },
    readRows: async (ids) => {
      log.letti.push(ids.slice());
      if (mondo.letturaRotta) throw new Error('rilettura non riuscita');
      return ids.map((id) => ({ _id: id, _updateTime: mondo.ore[id], createdAt: '2026-09-01T00:00:00Z' }));
    },
    submissionCount: async () => {
      log.contatori += 1;
      if (mondo.contatoreRotto) throw new Error('contatore non raggiungibile');
      return mondo.invii;
    },
    ultimoAvvioRoutine: async () => {
      log.registri = (log.registri || 0) + 1;
      if (mondo.registroRotto) throw new Error('registro non raggiungibile');
      return mondo.avvio === undefined ? null : mondo.avvio;
    },
  });
  return { w, log, avanza: (ms) => { t += ms; } };
}

test('una scrittura che non firma l\'ora arriva lo stesso: per i seguiti si guarda l\'ora di Firestore', async () => {
  const mondo = { ore: { a: 't1', b: 't1' }, seguiti: ['a'], invii: 10 };
  const { w, log, avanza } = giro(mondo);
  await w.tick({ force: true });                 // apertura: riallineamento

  // Il server delle routine prende in carico `a`: scrive stato e presa in
  // carico, e NON tocca `updatedAt`. La domanda per data non lo porta.
  mondo.ore.a = 't2';
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });

  const ultimo = log.avvisi[log.avvisi.length - 1];
  assert.equal(ultimo.kind, 'changed');
  assert.deepEqual(ultimo.rows.map((r) => r._id), ['a']);
});

test('un seguito che non si è mosso non fa rileggere niente', async () => {
  const mondo = { ore: { a: 't1' }, seguiti: ['a'], invii: 10 };
  const { w, log, avanza } = giro(mondo);
  await w.tick({ force: true });
  const dopoApertura = log.avvisi.length;
  for (let i = 0; i < 3; i += 1) { avanza(LIVE.POLL_MS); await w.tick({ force: true }); }
  assert.equal(log.versionsOf, 3, 'tre giri, tre controlli dell\'ora vera');
  assert.deepEqual(log.letti, [], 'niente si è mosso: nessun documento riletto');
  assert.equal(log.avvisi.length, dopoApertura, 'e nessuna pagina disturbata');
});

test('nessun feedback da seguire: il giro non chiede niente in più', async () => {
  const mondo = { ore: { a: 't1' }, seguiti: [], invii: 10 };
  const { w, log, avanza } = giro(mondo);
  await w.tick({ force: true });
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  assert.equal(log.versionsOf, 0);
});

test('oltre il tetto dei seguiti il giro avvisa e si riallinea, invece di tagliare in silenzio', async () => {
  const tanti = Array.from({ length: LIVE.SEGUITI_TETTO + 7 }, (_, i) => `q${i}`);
  const mondo = { ore: {}, seguiti: tanti, invii: 10 };
  for (const id of tanti) mondo.ore[id] = 't1';
  const { w, log, avanza } = giro(mondo);
  await w.tick({ force: true });
  assert.equal(log.versioni, 1);

  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  assert.equal(log.ultimiChiesti.length, LIVE.SEGUITI_TETTO);
  assert.ok(log.lamentele.some((m) => m.includes('tetto')), 'il giro dice che qualcuno è rimasto fuori');

  // Chi è rimasto fuori non resta invisibile fino alla mezz'ora: il giro dopo
  // è un riallineamento completo.
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  assert.equal(log.versioni, 2);
});

test('un invio nuovo che la domanda per data non vede fa riallineare al giro dopo', async () => {
  const mondo = { ore: { a: 't1' }, seguiti: [], invii: 10 };
  const { w, log, avanza } = giro(mondo);
  await w.tick({ force: true });
  assert.equal(log.versioni, 1);

  // La segnalazione arriva da una macchina con l'ora indietro: il contatore
  // degli invii sale, la domanda per data non la trova.
  mondo.invii = 11;
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  assert.equal(log.versioni, 1, 'il giro in corso non si riallinea a metà');

  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  assert.equal(log.versioni, 2, 'il giro dopo si riallinea, ed è l\'unico che la vede');
});

test('il contatore fermo non fa riallineare: i giri a vuoto restano a vuoto', async () => {
  const mondo = { ore: { a: 't1' }, seguiti: [], invii: 10 };
  const { w, log, avanza } = giro(mondo);
  await w.tick({ force: true });
  for (let i = 0; i < 4; i += 1) { avanza(LIVE.POLL_MS); await w.tick({ force: true }); }
  assert.equal(log.versioni, 1);
  assert.equal(log.contatori, 5, 'una lettura del contatore per giro, riallineamento compreso');
});

test('un contatore non letto non vale «niente di nuovo»', async () => {
  const mondo = { ore: { a: 't1' }, seguiti: [], invii: 10 };
  const { w, log, avanza } = giro(mondo);
  await w.tick({ force: true });

  mondo.contatoreRotto = true;
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  assert.equal(log.versioni, 1, 'una lettura fallita non è un invio nuovo');

  // Torna a rispondere, e nel frattempo un invio c'è stato davvero: il
  // confronto riparte dal valore di prima, non da quello perso.
  mondo.contatoreRotto = false;
  mondo.invii = 11;
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  assert.equal(log.versioni, 2, 'l\'invio arrivato durante il guasto non si perde');
});

test('una rilettura fallita non si dà per fatta: il giro dopo riprova', async () => {
  const mondo = { ore: { a: 't1' }, seguiti: ['a'], invii: 10, letturaRotta: true };
  const { w, log, avanza } = giro(mondo);
  await w.tick({ force: true });

  mondo.ore.a = 't2';
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true }).catch(() => {});
  assert.deepEqual(log.letti, [['a']], 'ci ha provato');
  assert.equal(log.avvisi.length, 1, 'ma alle pagine non è arrivato niente');

  mondo.letturaRotta = false;
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  const ultimo = log.avvisi[log.avvisi.length - 1];
  assert.equal(ultimo.kind, 'changed');
  assert.deepEqual(ultimo.rows.map((r) => r._id), ['a']);
});

// ── le due domande, come arrivano a Firestore ───────────────────────────────

require(join(SRC, 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;

async function conFetch(risposta, fn) {
  const vere = globalThis.fetch;
  const chiamate = [];
  globalThis.fetch = async (url, opts) => {
    chiamate.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, json: async () => risposta, text: async () => '' };
  };
  try { return await fn(chiamate); } finally { globalThis.fetch = vere; }
}

test('l\'ora vera dei seguiti si chiede in UNA richiesta, e senza tirarsi dietro i testi', async () => {
  const doc = {
    name: 'projects/p/databases/(default)/documents/feedback/a',
    fields: { createdAt: { timestampValue: '2026-09-01T00:00:00Z' } },
    updateTime: 't9',
  };
  await conFetch([{ found: doc }], async (chiamate) => {
    const out = await FB.versionsOf(['a', 'b']);
    assert.equal(chiamate.length, 1, 'una richiesta sola per tutti gli id');
    assert.ok(chiamate[0].url.includes(':batchGet'));
    assert.equal(chiamate[0].body.documents.length, 2);
    assert.deepEqual(chiamate[0].body.mask.fieldPaths, ['createdAt'], 'niente note né allegati');
    assert.deepEqual(out, [{ _id: 'a', _updateTime: 't9', createdAt: '2026-09-01T00:00:00Z' }]);
  });
});

test('il contatore degli invii: una lettura, e «non lo so» non è zero', async () => {
  await conFetch({ fields: { value: { integerValue: '774' } } }, async (chiamate) => {
    assert.equal(await FB.submissionCount(), 774);
    assert.equal(chiamate.length, 1);
    assert.ok(chiamate[0].url.includes('counters/feedbackSeq'));
  });
  const vere = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' });
  try { assert.equal(await FB.submissionCount(), null, 'contatore assente: non lo so, non zero'); }
  finally { globalThis.fetch = vere; }
});

// Due invii nello stesso giro, uno con l'ora giusta e uno con l'ora indietro.
// Guardare se ne è arrivata ALMENO UNA non basta: la prima coprirebbe la
// seconda, e quella mandata non entrerebbe mai in lista.
test('di due invii nello stesso giro, quello con l\'ora indietro fa riallineare lo stesso', async () => {
  const mondo = { ore: { a: 't1' }, seguiti: [], invii: 10 };
  const { w, log, avanza } = giro(mondo);
  await w.tick({ force: true });
  assert.equal(log.versioni, 1);

  // Ne arrivano due: la domanda per data porta solo quella con l'ora giusta.
  mondo.invii = 12;
  mondo.cambiati = [{ _id: 'nuova', seq: 11, _updateTime: 't1' }];
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  assert.equal(log.versioni, 1, 'il giro con la domanda per data non rilegge tutto');

  // Il conto non torna (una sola arrivata su due invii), quindi il giro dopo
  // è un riallineamento completo: è lì che la seconda compare.
  mondo.cambiati = [];
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  assert.equal(log.versioni, 2);
});

test('quando il conto degli invii torna, non si rilegge niente', async () => {
  const mondo = { ore: { a: 't1' }, seguiti: [], invii: 10 };
  const { w, log, avanza } = giro(mondo);
  await w.tick({ force: true });

  mondo.invii = 12;
  mondo.cambiati = [{ _id: 'n1', seq: 11 }, { _id: 'n2', seq: 12 }];
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  mondo.cambiati = [];
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  assert.equal(log.versioni, 1, 'due invii annunciati, due arrivati: niente da riallineare');
});

// Quale segnalazione prendano in mano le routine, la dashboard non lo può
// indovinare: il server sceglie con un ordine suo, e riscrive senza firmare
// l'ora. Il registro dei worker lo dice, e costa una lettura.
test('un worker delle routine che parte fa riallineare al giro dopo', async () => {
  const mondo = { ore: { a: 't1' }, seguiti: [], invii: 10, avvio: '' };
  const { w, log, avanza } = giro(mondo);
  await w.tick({ force: true });
  assert.equal(log.versioni, 1);

  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  assert.equal(log.versioni, 1, 'registro fermo: niente da riallineare');

  // Il server fa partire un lavoro su una segnalazione qualunque della coda.
  mondo.avvio = '2026-09-24T18:00:00Z|#700|solver';
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  assert.equal(log.versioni, 2, 'il giro dopo rilegge, e la presa in carico compare');

  // Una sola volta per avvio: il registro fermo non fa ripagare niente.
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  assert.equal(log.versioni, 2);
});

test('un registro dei worker non raggiungibile non si scambia per «niente di nuovo»', async () => {
  const mondo = { ore: { a: 't1' }, seguiti: [], invii: 10, avvio: 'x|#1|solver' };
  const { w, log, avanza } = giro(mondo);
  await w.tick({ force: true });

  mondo.registroRotto = true;
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  assert.equal(log.versioni, 1, 'una lettura fallita non è un avvio');
  assert.ok(log.lamentele.some((m) => m.includes('registro')));

  // Torna raggiungibile, col valore di prima: nessun falso allarme.
  mondo.registroRotto = false;
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  avanza(LIVE.POLL_MS);
  await w.tick({ force: true });
  assert.equal(log.versioni, 1);
});
