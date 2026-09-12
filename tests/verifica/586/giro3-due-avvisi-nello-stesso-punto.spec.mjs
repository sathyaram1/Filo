// Verifica #586, giro 3 — la domanda del permesso e l'avviso «ho bloccato una
// finestra» nascono nello stesso punto della fascia sotto la barra, e si
// coprono a vicenda.
//
// Sono le due cose che Filo segnala lì: se un sito apre una finestra (bloccata)
// e poi chiede la fotocamera, una delle due sparisce sotto l'altra. Chi naviga
// vede un avviso solo e non sa che ce n'è un secondo.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0"><p>pagina</p>
<script>
  window.__apri = () => { try { window.open('https://esempio.invalido/x', '_blank'); } catch (_) {} };
  window.__cam = () => navigator.mediaDevices.getUserMedia({ video: true }).then(
    () => 'ok', (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
</script></body></html>`;

test('l\'avviso della finestra bloccata e la domanda del permesso non si coprono', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);

  await page.evaluate(() => window.__apri());
  const avviso = shell.locator('.popup-chip');
  await expect(avviso, 'l\'avviso della finestra bloccata non è comparso').toHaveCount(1, { timeout: 15_000 });

  page.evaluate(() => window.__cam()).catch(() => {});
  const domanda = shell.locator('.perm-chip');
  await expect(domanda).toHaveCount(1, { timeout: 20_000 });
  await shell.waitForTimeout(500);

  const a = await avviso.first().boundingBox();
  const d = await domanda.first().boundingBox();
  console.log('[586 g3] avviso:', JSON.stringify(a), 'domanda:', JSON.stringify(d));
  await shell.screenshot({ path: 'tests/.shots/586-giro3-due-avvisi.png' });

  const sovrapposti = !!a && !!d
    && a.x < d.x + d.width && d.x < a.x + a.width
    && a.y < d.y + d.height && d.y < a.y + a.height;
  expect(
    sovrapposti,
    `i due avvisi si sovrappongono: «finestra bloccata» a ${JSON.stringify(a)}, `
    + `«il sito chiede un permesso» a ${JSON.stringify(d)}`,
  ).toBe(false);
});
