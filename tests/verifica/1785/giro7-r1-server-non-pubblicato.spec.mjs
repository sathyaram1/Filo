// #1785 giro 7: quando l'operazione non c'è sul server (prima della pubblicazione, o con una pubblicazione fallita) il
// server risponde con una pagina 404 in HTML. Dal cloud va detto come un guasto da ritentare, come fa la strada dell'owner,
// non come un no del server.
import { test, expect } from '@playwright/test';
import { call } from '../../../scripts/routine-channel.mjs';
import { chiamaFeedback, salvaSchedaDaOwner } from '../../../scripts/lib/feedback-cloud.mjs';
import { letturaCloud } from '../../../scripts/schede.mjs';
import { leggiDalCloud } from '../../../scripts/leggi-feedback.mjs';

// La risposta vera di cloudfunctions.net per una funzione che non esiste: 404, text/html.
const paginaHtml = async () => new Response('<html><body>Error: Page not found</body></html>', { status: 404, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
const chiama = (path, payload) => call(path, payload, { fetchImpl: paginaHtml, attempts: 1 });

test('r1 la funzione non ancora pubblicata è un guasto sulla strada del biglietto, come su quella dell’owner', async () => {
  const owner = await salvaSchedaDaOwner({ numero: '1', scheda: {} }, { idToken: 't', fetchImpl: paginaHtml });
  expect(owner.guasto, `owner: ${owner.motivo}`).toBe(true);

  const cloud = await chiamaFeedback('tk', { op: 'leggi', numeri: ['812'] }, { chiama });
  expect(cloud.guasto, `cloud: ${cloud.motivo}`).toBe(true);

  const elenco = await letturaCloud('tk', { chiama });
  expect(elenco.codice, `elenca: ${elenco.motivo}`).toBe(4);

  const lettura = await leggiDalCloud('812', { ticket: 'tk', opz: { chiama } });
  expect(lettura.codice, `feedback:leggi: ${lettura.errore}`).toBe(4);
});
