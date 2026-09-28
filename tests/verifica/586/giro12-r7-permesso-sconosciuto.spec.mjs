// Verifica #586 giro 12, rilievo 7: tutto ciò che Filo non conosce ha un nome solo e una memoria sola.
import { test, expect } from '../../fixtures/electron.mjs';

const riga = (shell) => shell.locator('#perm-bar .perm-row');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGINA = `<!doctype html><html><head><title>Ricette</title></head><body>
<button id="b">modalità cucina</button>
<script>
  window.sveglio = () => navigator.wakeLock.request('screen').then(() => 'ok', (e) => 'err:' + e.name);
  window.caratteri = () => window.queryLocalFonts().then((f) => f.length, (e) => 'err:' + e.name);
</script></body></html>`;

test('tenere acceso lo schermo non si chiede, e un sì a una cosa non ne apre altre', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.click('#b');
  expect(await page.evaluate(() => window.caratteri())).toBe(0);
  await page.evaluate(() => { window.__w = null; window.sveglio().then((r) => { window.__w = r; }); });
  await sleep(1500);
  const domanda = (await riga(shell).count()) ? await riga(shell).innerText() : '';
  if (domanda) {
    await expect(shell.locator('#perm-bar .perm-si')).toBeEnabled();
    await shell.locator('#perm-bar .perm-si').click();
  }
  await expect.poll(() => page.evaluate(() => window.__w)).toBe('ok');
  await page.click('#b');
  const dopo = await page.evaluate(() => window.caratteri());
  expect(dopo, `dopo il sì a «${domanda}» il sito legge i caratteri installati senza che nessuno li abbia chiesti`).toBe(0);
  expect(domanda, 'chiesto il permesso di tenere acceso lo schermo').toBe('');
});
