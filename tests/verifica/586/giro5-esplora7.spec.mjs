// Esplorazione giro 5 (7) — NON è una prova che vale.
import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<p>posizione</p>
<script>
  window.__pos = () => new Promise((r) => navigator.geolocation.getCurrentPosition(
    (p) => r('coordinate ' + p.coords.latitude), (e) => r('errore ' + e.code + ' ' + e.message), { timeout: 25000 }));
</script></body></html>`;

test('K — la posizione: cosa dice la console', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  page.on('console', (m) => console.log('[g5-7 console]', m.type(), m.text().slice(0, 300)));
  const p = page.evaluate(() => window.__pos());
  await shell.waitForTimeout(2000);
  const c = shell.locator('.perm-chip .perm-chip-allow');
  console.log('[g5-7 K] domanda:', JSON.stringify(await shell.locator('.perm-chip').allTextContents()));
  if (await c.count()) await c.first().click();
  console.log('[g5-7 K] esito:', await Promise.race([p, new Promise((r) => setTimeout(() => r('(attesa 30s)'), 30000))]));
  // la rete c'è? proviamo una fetch qualunque dalla stessa pagina
  console.log('[g5-7 K] rete dalla pagina:', await page.evaluate(() => fetch(location.href).then((r) => 'ok ' + r.status, (e) => 'no ' + e.message)));
});
