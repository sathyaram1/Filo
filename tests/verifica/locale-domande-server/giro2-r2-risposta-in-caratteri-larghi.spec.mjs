// Verifica locale «domande-server» (#1149), giro 2, rilievo 2: una domanda vicina al tetto del blocco più una
// risposta lunga in caratteri da tre byte, dentro il tetto del turno, non stanno nel tetto della conversazione: il
// taglio butta la domanda e chi riprende riceve la risposta senza la domanda.
import { test, expect } from './../../fixtures/electron.mjs';
import { SRV, server, feedback, domandaDalCanale, fascicolo } from './helpers/server-domande.mjs';

test.skip(!SRV, 'manca il worktree del server accanto a questo repo');

test('r2 chi riprende riceve la domanda anche dopo una risposta lunga in caratteri da tre byte', async () => {
  const S = await server({
    'routine-tickets/tchi': { role: 'new-work', fiducia: 'fidato', feedbackId: 'fbA', slug: 's', leaseId: 'l' },
    'routine-keys/s': {},
  });
  await feedback(S, 'fbA', { seq: 813, status: 'design', reason: 'decisione', priority: 1, fiducia: 'fidato' });
  await S.mem().doc('routine-state/fbA').set({ ripresa: { ruolo: 'new-work', motivo: 'decisione', at: new Date().toISOString() } });
  const d = await domandaDalCanale(S, 'tchi', {
    titolo: 'TITOLO-DELLA-DOMANDA', priorita: 'importante', notePerAgenti: 'n'.repeat(23400),
    opzioni: [{ testo: 'Riprendi', azione: { tipo: 'riprendi', feedbackId: 'fbA' } }], consiglio: { opzione: 0, perche: 'p' },
  });
  expect(d.ok, 'la domanda sta nel tetto del blocco').toBe(true);
  // 9000 caratteri, sotto i 10000 di un turno: 27000 byte.
  const r = await S.domande.perOwner({ op: 'rispondi', id: d.id, scelta: 0, testo: '€'.repeat(9000) }, { who: 'owner@example.com' });
  expect(r.ok).toBe(true);
  const lavoratore = JSON.stringify(await fascicolo(S, { role: 'new-work', feedbackId: 'fbA', segreto: 'segreto-lavoratore' }));
  expect(lavoratore, 'la risposta arriva').toContain('€€€€');
  expect(lavoratore, 'e la domanda a cui risponde pure').toContain('TITOLO-DELLA-DOMANDA');
});
