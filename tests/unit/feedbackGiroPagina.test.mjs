// Il giro di una pagina (SN_FEEDBACK_LIVE.makeGiroPagina), lo stesso per la Gestione e la pagina Feedback
// (#738): quando chiede al main, cosa fonde, cosa segna come arrivato, e che fuori vista non legge niente.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackLive.js'));
const LIVE = globalThis.SN_FEEDBACK_LIVE;

const SEZIONE = { unlabeled: 'inbox', design: 'inbox', todo: 'queue', working: 'queue' };
const attendi = () => new Promise((r) => setImmediate(r));

// Una pagina finta: la lista in mano, il canale col main che registra, l'orologio a mano.
function pagina({ righe = [], esito = { kind: 'skipped' }, pronta = true } = {}) {
  const st = {
    lista: righe.map((r) => ({ ...r })),
    mandati: [], dopo: [], ricariche: 0, ora: 1_000_000, battito: null, ascolto: null, esito,
    pronta,
  };
  const giro = LIVE.makeGiroPagina({
    send: async (m) => {
      st.mandati.push(m);
      if (m.type === 'tab_in_vista_get') return { ok: true, inVista: true };
      if (m.giro) return { ok: true, giro: st.esito };
      return { ok: true };
    },
    ascolta: (fn) => { st.ascolto = fn; },
    pronta: () => st.pronta,
    ricarica: () => { st.ricariche += 1; },
    lista: () => st.lista,
    imposta: (l) => { st.lista = l; },
    righe: async (ids) => ids.map((id) => ({ _id: id, _updateTime: 'nuova', status: 'design' })),
    sezioneDi: (fb) => SEZIONE[fb.status] || null,
    dopo: (x) => st.dopo.push(x),
    ora: () => st.ora,
    timer: { setInterval: (f) => { st.battito = f; return 1; }, clearInterval: () => { st.battito = null; } },
  });
  return { giro, st };
}

const giri = (st) => st.mandati.filter((m) => m.giro === true).length;

test('fuori vista non chiede niente, nemmeno dopo ore; tornando in vista si allinea subito', async () => {
  const { giro, st } = pagina({ righe: [{ _id: 'a', _updateTime: 'v1', status: 'todo' }] });
  giro.start();
  await attendi();
  st.ascolto({ type: 'tab_in_vista', inVista: false });
  for (let i = 0; i < 100; i += 1) { st.ora += LIVE.POLL_MS; st.battito(); }
  await attendi();
  assert.equal(giri(st), 0);
  st.ascolto({ type: 'tab_in_vista', inVista: true });
  await attendi();
  assert.equal(giri(st), 1);
});

test('un cambio di sezione portato dal giro arriva alla pagina, e chi l\'ha cambiata è segnato come arrivato', async () => {
  const { giro, st } = pagina({
    righe: [{ _id: 'a', _updateTime: 'v1', status: 'todo' }, { _id: 'b', _updateTime: 'v1', status: 'unlabeled' }],
    esito: { kind: 'changed', rows: [{ _id: 'a', _updateTime: 'v2', status: 'design' }, { _id: 'b', _updateTime: 'v1', status: 'unlabeled' }] },
  });
  giro.start();
  const out = await giro.giro({ force: true });
  assert.equal(out.changed, 1, 'la riga già vista non si rifonde');
  assert.equal(st.lista.find((f) => f._id === 'a').status, 'design');
  assert.deepEqual(st.dopo.map((d) => [d.ids, d.statiMossi]), [[['a'], true]]);
  assert.deepEqual(Array.from(giro.arrivate), ['a']);
});

test('il riallineamento rilegge solo i cambiati e i nuovi; una lettura interrotta non fa uscire nessuno', async () => {
  const { giro, st } = pagina({
    righe: [{ _id: 'a', _updateTime: 'v1', status: 'todo' }, { _id: 'b', _updateTime: 'v1', status: 'todo' }],
    esito: { kind: 'reconcile', versions: [{ _id: 'a', _updateTime: 'v1' }, { _id: 'c', _updateTime: 'v1' }], complete: false },
  });
  giro.start();
  const letti = [];
  giro.prova.setLiveSources({ getMany: async (ids) => { letti.push(...ids); return ids.map((id) => ({ _id: id, _updateTime: 'v1', status: 'todo' })); } });
  await giro.giro({ force: true });
  assert.deepEqual(letti, ['c']);
  assert.deepEqual(st.lista.map((f) => f._id).sort(), ['a', 'b', 'c']);
});

test('la prima lista mai arrivata si rilegge al ritmo del giro, senza chiedere un giro', async () => {
  const { giro, st } = pagina({ pronta: false });
  giro.start();
  await attendi();
  st.ora += LIVE.POLL_MS;
  st.battito();
  st.battito();
  await attendi();
  assert.equal(st.ricariche, 1);
  assert.equal(giri(st), 0);
});

test('un giro in corso si riusa; dati finti in pagina fermano il giro', async () => {
  const { giro, st } = pagina({ righe: [{ _id: 'a', _updateTime: 'v1', status: 'todo' }] });
  giro.start();
  const uno = giro.giro({ force: true });
  assert.equal(giro.giro({ force: true }), uno);
  await uno;
  assert.equal(giri(st), 1);
  giro.stop();
  giro.blocca(true);
  giro.start();
  assert.equal(giro.acceso(), false);
  await attendi();
  assert.ok(st.mandati.some((m) => m.off === true), 'fermandosi lo dice al main');
});

test('chi seguire con l\'ora di Firestore: i feedback in mano alle routine, letti dalla regola condivisa', async () => {
  globalThis.SN_MANAGE_REVIEW = { workProgress: (fb) => (fb.status === 'working' ? { status: 'working' } : null) };
  try {
    const { giro } = pagina({ righe: [{ _id: 'a', status: 'working' }, { _id: 'b', status: 'todo' }] });
    assert.deepEqual(giro.seguiti(), ['a']);
  } finally {
    delete globalThis.SN_MANAGE_REVIEW;
  }
});
