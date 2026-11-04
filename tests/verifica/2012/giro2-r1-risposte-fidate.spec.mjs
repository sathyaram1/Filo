// #2012 giro 2: nella sede owner la risposta di una routine fidata alla domanda di fine sessione deve arrivare.
// La risposta del server è costruita come la costruisce oggi l'operazione «answers» di routineClosingAdmin
// (filo-security, functions/src/routine/closing.js): per ogni biglietto solo questi campi, la fiducia no.
import { test, expect } from '@playwright/test';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { stampaRisposte } from '../../../scripts/routine-domanda.mjs';

/** Il biglietto come lo tiene il server, e la voce come la manda «answers». */
const biglietto = { slug: 'v', role: 'verifier', num: '#40', feedbackId: 'f', branch: 'b', createdAtMs: 1, releasedAtMs: 2,
  closing: { askedAtMs: 3, question: 'Q?', answer: 'RISPOSTA DI UNA ROUTINE FIDATA' }, fiducia: 'fidato' };
const comeLaMandaIlServer = (t) => ({ slug: t.slug || '', role: t.role || '', num: t.num || '', feedbackId: t.feedbackId || '', branch: t.branch || '',
  createdAtMs: t.createdAtMs || null, releasedAtMs: t.releasedAtMs || null, closing: t.closing || null });

test('r1 nella sede owner la risposta di una routine fidata si legge', async () => {
  const dir = cartellaTemporanea('v2012-');
  try {
    const out = [];
    const err = [];
    const codice = await stampaRisposte({ orchestrator: [], workers: [comeLaMandaIlServer(biglietto)] }, {
      env: { FILO_SEDE: 'owner' }, cwd: dir, scrivi: (x) => out.push(String(x)), errore: (x) => err.push(String(x)),
    });
    expect(codice).toBe(0);
    expect(out.join('\n'), err.join('\n')).toContain('RISPOSTA DI UNA ROUTINE FIDATA');
  } finally {
    togliCartella(dir);
  }
});
