// La sincronizzazione della vista pubblica: quante letture costa e, con più
// feedback del tetto, quali schede si possono ancora togliere.
// Non deve fermare: niente rete, la collezione è un doppio in memoria.
// La regola narrata sta in `publishPublicView` e nel gemello dentro Filo
// (src/main/services/handlers/auth.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Credenziali finte: senza, acquireBearer chiuderebbe il processo. Le due
// strade del service account vanno tolte di mezzo, o in CI vincono loro.
process.env.FILO_ADMIN_REFRESH_TOKEN = 'refresh-finto';
delete process.env.FILO_SA_KEY;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.FILO_FEEDBACK_PRIVKEY;

const { publishPublicView } = await import('../../scripts/publish-public-view.mjs');
const FB = globalThis.SN_FEEDBACK;

const TETTO = FB.LIST_PAGE_SIZE;

function feedbackChiuso(i) {
  return {
    _id: `fb${i}`,
    seq: i,
    subSeq: 0,
    name: `Segnalazione ${i}`,
    status: 'done',
    statusPublic: 'closed',
    resolvedInVersion: '0.2.70',
    createdAt: `2026-0${1 + (i % 8)}-01T10:00:00Z`,
    resolvedAt: '2026-09-10T10:00:00Z',
  };
}

// Il doppio della collezione: risponde alle stesse domande che fa lo script e
// tiene il conto dei documenti letti, che è il numero che si vuole far
// scendere.
function collezioneFinta({ feedbacks, schede }) {
  const conto = { letti: 0, chiamate: [], scritte: [], tolte: [] };
  const perData = feedbacks.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ id_token: 'token-finto' }),
    text: async () => '{}',
  });
  FB.list = async ({ pageSize }) => {
    conto.chiamate.push('list');
    const righe = perData.slice(0, pageSize);
    conto.letti += righe.length;
    return righe;
  };
  FB.listResolved = async () => { conto.chiamate.push('listResolved'); return []; };
  FB.listAllPublic = async () => { conto.chiamate.push('listAllPublic'); return schede.slice(); };
  FB.getMany = async (ids) => {
    conto.chiamate.push(`getMany:${ids.length}`);
    const trovati = feedbacks.filter((f) => ids.includes(f._id));
    conto.letti += trovati.length;
    return trovati;
  };
  FB.publishPublicCard = async (id, card) => { conto.scritte.push({ id, card }); return true; };
  FB.unpublishPublicCard = async (id) => { conto.tolte.push(id); return true; };
  FB.ensureSeqCounter = async (n, opts) => { conto.contatore = { n, allowLower: !!(opts && opts.allowLower) }; return n; };
  return conto;
}

test('con più feedback del tetto una scheda orfana si toglie lo stesso', async () => {
  // Oltre il tetto per data d'invio: la pagina è piena, quindi la vecchia
  // domanda («la pagina non ha toccato il tetto?») direbbe sempre di no, e la
  // scheda del feedback cancellato resterebbe in bacheca per sempre.
  const feedbacks = Array.from({ length: TETTO + 274 }, (_, i) => feedbackChiuso(i + 1));
  const schede = [
    { _id: 'fb1', seq: 1, subSeq: 0, name: 'Segnalazione 1', status: 'done', statusPublic: 'closed', resolvedInVersion: '0.2.70' },
    { _id: 'fb-cancellato', seq: 900, subSeq: 0, name: 'Non esiste più', status: 'done', statusPublic: 'closed', resolvedInVersion: '0.2.70' },
  ];
  const conto = collezioneFinta({ feedbacks, schede });

  const r = await publishPublicView();

  assert.equal(r.complete, true, 'le schede sono state confrontate tutte: si può togliere');
  assert.equal(r.tuttiLetti, false, 'la pagina per data d_invio ha toccato il tetto');
  assert.deepEqual(conto.tolte, ['fb-cancellato']);
  // Il contatore NON si abbassa su una lettura parziale: il massimo `seq` che
  // si è visto non è il massimo che esiste.
  assert.equal(conto.contatore.allowLower, false);
});

test('le schede fuori pagina si chiedono tutte, a blocchi', async () => {
  const feedbacks = Array.from({ length: TETTO + 300 }, (_, i) => feedbackChiuso(i + 1));
  // Le schede dei 300 più vecchi: fuori dalla pagina per data d'invio.
  const fuoriPagina = feedbacks.slice(TETTO);
  const schede = fuoriPagina.map((f) => ({
    _id: f._id, seq: f.seq, subSeq: 0, name: f.name, status: 'done',
    statusPublic: 'closed', resolvedInVersion: '0.2.70',
  }));
  const conto = collezioneFinta({ feedbacks, schede });

  const r = await publishPublicView();

  const chiesti = conto.chiamate.filter((c) => c.startsWith('getMany:'))
    .reduce((n, c) => n + Number(c.split(':')[1]), 0);
  assert.equal(chiesti, 300, 'nessuna scheda fuori pagina resta senza il suo feedback');
  assert.equal(r.complete, true);
  assert.deepEqual(conto.tolte, [], 'niente da togliere: ogni scheda ha il suo feedback');
});

test('le schede pubbliche si leggono una volta sola per giro', async () => {
  const feedbacks = [feedbackChiuso(1)];
  const conto = collezioneFinta({ feedbacks, schede: [] });
  await publishPublicView();
  const letture = conto.chiamate.filter((c) => c === 'listAllPublic').length;
  assert.equal(letture, 1, 'la seconda passata sulle schede era una lettura pagata due volte');
});

test('a parità di dati le scritture sono le stesse di una lettura intera', async () => {
  const feedbacks = Array.from({ length: 20 }, (_, i) => feedbackChiuso(i + 1));
  const conto = collezioneFinta({ feedbacks, schede: [] });
  const r = await publishPublicView();
  assert.equal(r.tuttiLetti, true);
  assert.deepEqual(conto.scritte.map((s) => s.id), feedbacks.map((f) => f._id).sort(
    (a, b) => feedbacks.findIndex((f) => f._id === a) - feedbacks.findIndex((f) => f._id === b),
  ));
  for (const s of conto.scritte) {
    assert.equal(typeof s.card.name, 'string');
    assert.equal(s.card.statusPublic, 'closed');
  }
  // Il contatore si può riportare in pari: qui si è letto tutto.
  assert.equal(conto.contatore.allowLower, true);
});
