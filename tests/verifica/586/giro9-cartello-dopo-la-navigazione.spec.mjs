// Verifica #586, giro 9 — premere una fonte nel riquadro rimasto in piedi dopo
// che la pagina se n'è andata.
//
// Il riquadro «cosa condividi» non se ne va quando la pagina che l'aveva chiesto
// cambia indirizzo (vedi giro9-navigare-con-la-scelta-aperta). Questa prova
// guarda cosa succede a chi ci clicca sopra: la richiesta di quel sito non esiste
// più, ma Filo accende comunque il cartello «può vedere il tuo schermo» col nome
// del sito di prima, su una pagina che non ha chiesto niente e a cui non arriva
// niente. È un cartello che mente, e il rilievo del giro 4 diceva perché conta:
// la volta che è vero non gli crede più nessuno.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:16px">
<p>prima pagina</p>
<script>
  window.__esito = 'niente';
  window.__schermo = () => navigator.mediaDevices.getDisplayMedia({ video: true }).then(
    (s) => { window.__esito = 'ottenuto'; return 'ottenuto'; },
    (e) => { window.__esito = 'rifiutato:' + ((e && e.name) || '?'); return window.__esito; });
</script></body></html>`;

test('premere una fonte dopo che la pagina se n\'è andata non deve accendere un cartello che mente', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);
  const hostPrima = new URL(page.url()).host;
  const altra = testServer.html('<!doctype html><html><body><h1>un altro posto</h1></body></html>');

  page.evaluate(() => window.__schermo()).catch(() => {});
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').first().click();
  await expect(shell.locator('.perm-source')).toHaveCount(1, { timeout: 20_000 });

  await page.evaluate((u) => { window.location.href = u; }, altra).catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));

  const restato = await shell.locator('.perm-source').count().catch(() => 0);
  console.log('[586 g9] riquadro ancora in piedi dopo la navigazione:', restato);
  test.skip(restato === 0, 'il riquadro se n\'è andato con la pagina: niente da premere');

  await shell.locator('.perm-source-item').first().click();
  await new Promise((r) => setTimeout(r, 2500));

  const cartelli = await shell.locator('.perm-live').allTextContents().catch(() => []);
  const esitoPagina = await page.evaluate(() => window.__esito).catch(() => 'pagina nuova');
  console.log('[586 g9] cartelli dopo il clic sulla fonte:', JSON.stringify(cartelli),
    'cosa è arrivato alla pagina:', esitoPagina);

  expect(
    cartelli.join(' | '),
    'cliccando nel riquadro rimasto in piedi Filo accende il cartello «può vedere il tuo schermo» '
    + `col nome del sito di prima (${hostPrima}) su una pagina che non ha chiesto niente e a cui `
    + 'non arriva niente: un avviso che dice il falso, e che chi legge non può distinguere da uno '
    + 'vero',
  ).not.toMatch(/vedere il tuo schermo/i);
});
