// Verifica #586, giro 6 — il riquadro incorporato che non ha un indirizzo suo.
//
// Un widget scritto dalla pagina dentro un riquadro vuoto (`about:blank`, o
// `srcdoc`) è una forma comunissima: il lettore video, il modulo di pagamento,
// la finestra della videochiamata. Per il browser quel riquadro ha l'origine
// della pagina che lo ospita ed è a tutti gli effetti lo stesso sito.
//
// Qui si guarda cosa gli succede quando chiede la fotocamera: deve comparire la
// domanda, come per la pagina che lo ospita. Se invece viene negato in silenzio,
// chi naviga preme un pulsante, non succede niente e non c'è niente da
// consentire in nessun posto — la stessa forma del rilievo dei caratteri
// installati del giro 4, ma su una delle sei cose che il feedback elenca.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><body style="margin:0;padding:16px">
<iframe id="vuoto" style="width:300px;height:120px"></iframe>
<iframe id="scritto" srcdoc="<body>widget</body>" style="width:300px;height:120px"></iframe>
<script>
  window.__chiedi = (quale) => {
    const f = document.getElementById(quale);
    const w = f.contentWindow;
    return w.navigator.mediaDevices.getUserMedia({ video: true }).then(
      (s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return 'ok'; },
      (e) => 'no:' + ((e && e.name) || '?'));
  };
</script></body></html>`;

test('un riquadro senza indirizzo suo deve poter chiedere, non essere negato in silenzio', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForTimeout(600);

  const vuoto = page.evaluate(() => window.__chiedi('vuoto'));
  await shell.waitForTimeout(3000);
  const domandeVuoto = await shell.locator('.perm-chip').count();
  const esitoVuoto = await Promise.race([vuoto, new Promise((r) => setTimeout(() => r('appeso'), 4000))]);
  console.log('[586 g6] riquadro about:blank — domande:', domandeVuoto, 'esito:', esitoVuoto);

  if (domandeVuoto) await shell.locator('.perm-chip .perm-chip-x').click();
  await shell.waitForTimeout(500);

  const scritto = page.evaluate(() => window.__chiedi('scritto'));
  await shell.waitForTimeout(3000);
  const domandeScritto = await shell.locator('.perm-chip').count();
  const esitoScritto = await Promise.race([scritto, new Promise((r) => setTimeout(() => r('appeso'), 4000))]);
  console.log('[586 g6] riquadro srcdoc — domande:', domandeScritto, 'esito:', esitoScritto);
  await shell.screenshot({ path: 'tests/.shots/586-giro6-riquadro-senza-indirizzo.png' });

  // E nemmeno un sì già dato al sito lo sblocca: la pagina che lo ospita
  // ottiene la fotocamera, il suo riquadro no.
  if (domandeScritto) await shell.locator('.perm-chip .perm-chip-x').click();
  const dellaPagina = page.evaluate(() => navigator.mediaDevices.getUserMedia({ video: true })
    .then((s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} return 'ok'; },
      (e) => 'no:' + ((e && e.name) || '?')));
  await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
  await shell.locator('.perm-chip .perm-chip-allow').click();
  console.log('[586 g6] la PAGINA dopo il Consenti:', await dellaPagina);
  const dopoIlSi = await Promise.race([
    page.evaluate(() => window.__chiedi('scritto')),
    new Promise((r) => setTimeout(() => r('appeso'), 6000)),
  ]);
  console.log('[586 g6] il riquadro srcdoc dopo il Consenti al sito:', dopoIlSi);

  expect(
    domandeVuoto + domandeScritto,
    'un riquadro incorporato scritto dalla pagina — il lettore video, il modulo di pagamento, la '
    + 'finestra della videochiamata: per il browser è lo stesso sito della pagina che lo ospita — '
    + 'chiede la fotocamera e viene negato senza che compaia niente. Chi naviga preme il pulsante, '
    + 'non succede nulla, e in Impostazioni non c\'è niente da consentire perché nessuna scelta è '
    + 'mai stata presa: si può solo negare, mai consentire',
  ).toBeGreaterThan(0);
});
