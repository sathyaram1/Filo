// Verifica #586, giro 9 — cambiare pagina mentre il riquadro «cosa condividi» è
// aperto.
//
// Per chi usa Filo: un sito ti chiede di vedere il tuo schermo, tu rispondi
// «Consenti» e compare il riquadro con le cose fra cui scegliere. Poi cambi
// idea e vai da un'altra parte — clicchi un link, premi indietro, riscrivi
// l'indirizzo — senza aver scelto niente.
//
// Quello che deve succedere: il riquadro se ne va con la pagina che l'aveva
// chiesto, come fa la pastiglia della domanda. Non deve restare lì sopra la
// pagina nuova col nome del sito di prima, e non deve portarsi via altro.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:16px">
<p>prima pagina</p>
<script>
  window.__schermo = () => navigator.mediaDevices.getDisplayMedia({ video: true }).then(
    (s) => 'ottenuto', (e) => 'rifiutato:' + ((e && e.name) || '?'));
</script></body></html>`;

test('il riquadro «cosa condividi» se ne va con la pagina che l\'aveva chiesto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);
  const altra = testServer.html('<!doctype html><html><body><h1>un altro posto</h1></body></html>');

  page.evaluate(() => window.__schermo()).catch(() => {});
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').first().click();
  await expect(shell.locator('.perm-source')).toHaveCount(1, { timeout: 20_000 });
  const cimaPrima = await shell.evaluate(() => {
    const v = document.documentElement.style.getPropertyValue('--sn-reserve-top');
    return v || getComputedStyle(document.documentElement).getPropertyValue('--sn-reserve-top');
  }).catch(() => '?');
  console.log('[586 g9] riquadro aperto; riserva in cima:', JSON.stringify(cimaPrima));

  // Chi naviga se ne va senza scegliere niente.
  await page.evaluate((u) => { window.location.href = u; }, altra).catch(() => {});
  await new Promise((r) => setTimeout(r, 3000));

  // Filo è ancora in piedi?
  const viva = await shell.evaluate(() => 1).then(() => true, () => false);
  console.log('[586 g9] la cornice di Filo risponde ancora dopo la navigazione:', viva,
    'finestre:', app.windows().length);
  expect(viva, 'dopo aver navigato con il riquadro «cosa condividi» aperto la cornice di Filo non '
    + 'risponde più: la finestra è morta').toBe(true);

  const restato = await shell.locator('.perm-source').count().catch(() => -1);
  const testo = (await shell.locator('.perm-source').allTextContents().catch(() => [])).join(' | ');
  await shell.screenshot({ path: 'tests/.shots/586-giro9-riquadro-rimasto.png' }).catch(() => {});
  console.log('[586 g9] riquadri della scelta dopo la navigazione:', restato,
    JSON.stringify(testo.replace(/\s+/g, ' ').slice(0, 160)));

  expect(
    restato,
    'la pagina che aveva chiesto lo schermo se n\'è andata e il riquadro «cosa condividi» è ancora '
    + 'lì sopra la pagina nuova, con il nome del sito di prima e con la pagina spinta giù: chi ci '
    + `clicca consegna lo schermo a una pagina che non c'è più (${JSON.stringify(testo.replace(/\s+/g, ' ').slice(0, 160))})`,
  ).toBe(0);
});
