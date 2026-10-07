// VERIFICA #496 — giro 18. «Una colonna per undefined».
//
// Il grafico degli arrivi sceglie il passo sulla lunghezza della finestra:
// giorni, settimane, mesi e — oltre i dieci anni — anni. La riga che spiega il
// grafico conosce solo i primi tre nomi, quindi su una finestra scritta a mano
// molto lunga scrive «Una colonna per undefined».
//
// Senza il fix il controllo è rosso.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

test('#496 giro18 — la riga sotto il titolo del grafico non scrive «undefined»', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const dati = { feedbacks: [fb({ _id: 'g18-u', seq: 1201, createdAt: g(2) })], workerLog: [] };
  await apriStatistiche(page, dati, dati.feedbacks);

  await page.evaluate(() => window.__mgTest.setFsRange('custom', { da: '1900-01-01', a: '' }));
  const riga = await page.locator('#mgFsTrendHint').textContent();
  expect(riga).not.toContain('undefined');
});
