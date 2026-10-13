// Verifica locale «domande-server» (#1149), giro 1, rilievo 3: con la scelta «riprendi» il lavoro riparte, ma a chi
// riprende non arrivano né il contesto né le note per gli agenti scritte da chi ha chiesto (SPEC-DOMANDE §3.2).
import { test, expect } from './../../fixtures/electron.mjs';
import { SRV, server, feedback } from './helpers/server-domande.mjs';

test.skip(!SRV, 'manca il worktree del server accanto a questo repo');

const CONTESTO = 'Il menu si chiude perché due ascoltatori si contendono il clic.';
const NOTE = 'Il punto è nel gestore dei clic del menu; la strada del ritardo è già stata provata e scartata.';

test('r3 chi riprende il feedback riceve contesto e note per gli agenti della domanda a cui l\'owner ha risposto', async () => {
  const S = await server({
    'routine-tickets/tpul': { role: 'new-work', fiducia: 'fidato', feedbackId: 'fbA', slug: 's', leaseId: 'l' },
    'routine-keys/s': {},
  });
  await feedback(S, 'fbA', { seq: 813, status: 'design', reason: 'decisione', priority: 1, fiducia: 'fidato' });
  const live = { ok: true, fp: 'tpul', ticket: S.mem.doc('routine-tickets/tpul') };
  const r = await S.deliver.applyDelivery(live, 'domanda', { domanda: {
    titolo: 'Quale strada per il menu che si chiude?', priorita: 'importante', contesto: CONTESTO, problema: 'Il menu sparisce.',
    opzioni: [
      { testo: 'Un ascoltatore solo', pro: 'semplice', contro: 'tocca tutti i menu', azione: { tipo: 'riprendi', feedbackId: 'fbA' } },
      { testo: 'Lascia così', azione: { tipo: 'archivia', feedbackId: 'fbA' } },
    ],
    consiglio: { opzione: 0, perche: 'è la causa' }, notePerAgenti: NOTE,
  } }, {}, Date.now());
  expect(r.ok).toBe(true);
  const risposta = await S.domande.perOwner({ op: 'rispondi', id: 'D-1', scelta: 0 }, { who: 'owner@example.com' });
  expect(risposta.ok).toBe(true);

  const fb = await S.deliver.readFeedbackDoc('fbA');
  expect(fb.status).toBe('todo');
  const state = S.mem.doc('routine-state/fbA') || {};
  const payload = S.payload.buildPayload({ role: 'fixer', branch: 'worker/fbA' }, { feedback: fb, ripresa: S.payload.ripresaFor(state, fb) });
  const visto = JSON.stringify(payload);
  expect(visto, 'la scelta dell\'owner arriva').toContain('Opzione 1 della domanda D-1');
  expect(visto, 'il contesto della domanda non arriva a chi riprende').toContain(CONTESTO);
  expect(visto, 'le note per gli agenti non arrivano a chi riprende: riesplora da capo').toContain(NOTE);
});
