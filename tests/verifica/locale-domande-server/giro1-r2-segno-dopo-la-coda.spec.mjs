// Verifica locale «domande-server» (#1149), giro 1, rilievo 2: una scelta «riprendi» su una domanda non fidata rimette
// il feedback in coda col testo della domanda PRIMA di segnarlo come scritto da uno sporco. Si osserva ogni scrittura
// sul feedback: in nessun istante un biglietto deve poter nascere pulito davanti a quel testo.
import { test, expect } from './../../fixtures/electron.mjs';
import { SRV, server, feedback, nascitaDelProssimo } from './helpers/server-domande.mjs';

test.skip(!SRV, 'manca il worktree del server accanto a questo repo');

test('r2 il feedback ripreso da una domanda non fidata non è mai in coda senza il segno dello sporco', async () => {
  const S = await server({
    'routine-tickets/tspo': { role: 'new-work', fiducia: 'non_fidato', feedbackId: 'fbA', slug: 's', leaseId: 'l' },
    'routine-keys/s': {},
  });
  await feedback(S, 'fbA', { seq: 813, status: 'design', reason: 'decisione', priority: 1, fiducia: 'fidato' });
  const live = { ok: true, fp: 'tspo', ticket: S.mem.doc('routine-tickets/tspo') };
  const r = await S.deliver.applyDelivery(live, 'domanda', { domanda: {
    titolo: 'Testo scritto da un biglietto sporco', priorita: 'importante',
    opzioni: [{ testo: 'Riprendi', azione: { tipo: 'riprendi', feedbackId: 'fbA' } }], consiglio: { opzione: 0, perche: 'x' },
  } }, {}, Date.now());
  expect(r.ok).toBe(true);

  // Dopo ogni scrittura sul feedback: se è in coda col testo della domanda, chi lo prende adesso deve nascere sporco.
  const istanti = [];
  const guarda = async () => {
    const fb = await S.deliver.readFeedbackDoc('fbA');
    if (fb.status === 'todo' && String(fb.notes || '').includes('Testo scritto da un biglietto sporco')) {
      istanti.push(nascitaDelProssimo(S, 'fbA').fiducia);
    }
  };
  const base = S.fsMod.db;
  S.fsMod.db = () => {
    const api = base();
    const conGuardia = (ref) => (ref.path === 'feedback/fbA'
      ? Object.assign({}, ref, {
        set: async (...a) => { await ref.set(...a); await guarda(); },
        update: async (...a) => { await ref.update(...a); await guarda(); },
      })
      : ref);
    return Object.assign({}, api, {
      doc: (p) => conGuardia(api.doc(p)),
      collection: (c) => Object.assign({}, api.collection(c), { doc: (id) => conGuardia(api.collection(c).doc(id)) }),
      runTransaction: async (fn) => { const out = await api.runTransaction(fn); await guarda(); return out; },
    });
  };
  try {
    const risposta = await S.domande.perOwner({ op: 'rispondi', id: 'D-1', scelta: 0 }, { who: 'owner@example.com' });
    expect(risposta.ok).toBe(true);
  } finally {
    S.fsMod.db = base;
  }
  expect(istanti.length, 'il feedback non è mai tornato in coda col testo della domanda').toBeGreaterThan(0);
  expect(istanti, 'c\'è un istante in cui #813 è in coda col testo di uno sporco e un biglietto nascerebbe pulito').not.toContain('fidato');
});
