// Verifica locale «domande-server» (#1149), giro 2, rilievo 1: le note per gli agenti di chi ha chiesto, riprendendo
// il feedback, arrivano anche a chi lo verifica, che non deve vedere il racconto di chi ha lavorato. Fascicolo dal
// canale vero (fetchWork), su un Firestore in memoria.
import { test, expect } from './../../fixtures/electron.mjs';
import { SRV, server, feedback, domandaDalCanale, fascicolo } from './helpers/server-domande.mjs';

test.skip(!SRV, 'manca il worktree del server accanto a questo repo');

test('r1 chi verifica un feedback ripreso da una domanda non riceve le note per gli agenti di chi ha chiesto', async () => {
  const S = await server({
    'routine-tickets/tchi': { role: 'new-work', fiducia: 'fidato', feedbackId: 'fbA', slug: 's', leaseId: 'l' },
    'routine-keys/s': {},
  });
  await feedback(S, 'fbA', { seq: 813, status: 'design', reason: 'decisione', priority: 1, fiducia: 'fidato' });
  // Chi ha chiesto si è fermato sulla domanda: il segnalibro della ripresa c'è, come dopo uno stop vero.
  await S.mem().doc('routine-state/fbA').set({ ripresa: { ruolo: 'new-work', motivo: 'decisione', at: new Date().toISOString() } });
  const d = await domandaDalCanale(S, 'tchi', {
    titolo: 'TITOLO-DELLA-DOMANDA', priorita: 'importante', contesto: 'CONTESTO-PER-L-OWNER',
    notePerAgenti: 'NOTE-DI-CHI-HA-LAVORATO: la causa sta nel modulo del canale, scartata la strada della cache',
    opzioni: [{ testo: 'Riprendi', azione: { tipo: 'riprendi', feedbackId: 'fbA' } }], consiglio: { opzione: 0, perche: 'basta riprendere' },
  });
  expect(d.ok).toBe(true);
  const r = await S.domande.perOwner({ op: 'rispondi', id: d.id, scelta: 0, testo: 'RISPOSTA-DELL-OWNER' }, { who: 'owner@example.com' });
  expect(r.ok).toBe(true);

  // Chi riprende il lavoro le note le riceve (giro 1, terzo rilievo): la cura non gliele toglie.
  const lavoratore = JSON.stringify(await fascicolo(S, { role: 'new-work', feedbackId: 'fbA', segreto: 'segreto-lavoratore' }));
  expect(lavoratore).toContain('NOTE-DI-CHI-HA-LAVORATO');

  const verificatore = JSON.stringify(await fascicolo(S, { role: 'verifier', feedbackId: 'fbA', segreto: 'segreto-verificatore' }));
  expect(verificatore, 'la decisione dell\'owner arriva a chi verifica').toContain('RISPOSTA-DELL-OWNER');
  expect(verificatore, 'con la domanda a cui rispondeva').toContain('TITOLO-DELLA-DOMANDA');
  expect(verificatore, 'le note di chi ha lavorato non arrivano a chi verifica').not.toContain('NOTE-DI-CHI-HA-LAVORATO');
});
