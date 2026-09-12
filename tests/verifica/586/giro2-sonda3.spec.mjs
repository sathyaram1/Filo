// Sonda 3 del giro 2 (#586): schermo intero, riquadro di un altro sito,
// e la scelta di cosa condividere quando si cambia scheda.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><body style="margin:0;background:#eee">
<button id="fs" style="padding:20px">a tutto schermo</button>
<button id="share" style="padding:20px">condividi</button>
<script>
  document.getElementById('fs').addEventListener('click', () => document.documentElement.requestFullscreen());
  document.getElementById('share').addEventListener('click', () => {
    navigator.mediaDevices.getDisplayMedia({ video: true }).then(
      (s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (_) {} window.__r = 'ok'; },
      (e) => { window.__r = (e && e.name) || 'errore'; });
  });
  window.__cam = () => navigator.mediaDevices.getUserMedia({ video: true }).then(
    () => 'ok', (e) => 'no:' + ((e && e.name) || ''));
</script>
</body></html>`;

async function cimaAreaPagina(app) {
  return app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm || !Array.isArray(tm.tabs)) continue;
      const t = tm.tabs.find((x) => x.id === tm.activeId);
      if (!t) continue;
      const b = t.view.getBounds();
      return { y: b.y, height: b.height, fs: !!tm.pageFullscreen, cfs: !!tm.contentFullscreen };
    }
    return null;
  });
}

test('sonda3: a tutto schermo la domanda resta visibile', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.click('#fs');
  await page.waitForTimeout(1200);
  // eslint-disable-next-line no-console
  console.log('[586-g3] area a tutto schermo, prima della domanda:', JSON.stringify(await cimaAreaPagina(app)));

  const p = page.evaluate(() => window.__cam());
  const chip = shell.locator('.perm-chip');
  await expect(chip).toHaveCount(1, { timeout: 15_000 });
  await page.waitForTimeout(600);
  const area = await cimaAreaPagina(app);
  const box = await chip.boundingBox();
  // eslint-disable-next-line no-console
  console.log('[586-g3] a tutto schermo — area', JSON.stringify(area), 'pastiglia', JSON.stringify(box));
  await chip.locator('.perm-chip-x').click();
  await p;
  expect(true).toBe(true);
});

test('sonda3: la scelta di cosa condividere quando si cambia scheda', async ({ shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const a = await testServer.openReady(openTab, PAGINA);
  const b = await testServer.openReady(openTab, '<!doctype html><html><body>altro sito</body></html>');
  void b;
  // torna su A
  await shell.evaluate(() => {
    const tabs = window.filoShell.tabs;
    return tabs.list().then((l) => tabs.activate(l[l.length - 2].id)).catch(() => {});
  }).catch(() => {});
  await shell.waitForTimeout(500);

  await a.click('#share');
  const chip = shell.locator('.perm-chip');
  await expect(chip).toHaveCount(1, { timeout: 15_000 });
  await chip.locator('.perm-chip-allow').click();
  const scelta = shell.locator('.perm-source');
  await expect(scelta).toHaveCount(1, { timeout: 15_000 });

  // ora passo all'altra scheda: la scelta di cosa condividere resta lì?
  const ids = await shell.evaluate(() => window.filoShell.tabs.list().then((l) => l.map((t) => t.id)));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), ids[ids.length - 1]);
  await shell.waitForTimeout(900);
  // eslint-disable-next-line no-console
  console.log('[586-g3] dopo cambio scheda — scelte fonte visibili:', await scelta.count(),
    '| pastiglie:', await chip.count());
  expect(true).toBe(true);
});

test('sonda3: un riquadro di un altro sito chiede per sé', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const dentro = testServer.html(`<!doctype html><html><body>riquadro
<script>
  window.parent.postMessage('pronto', '*');
  addEventListener('message', () => {
    navigator.mediaDevices.getUserMedia({ video: true }).then(
      () => parent.postMessage('cam:ok', '*'), (e) => parent.postMessage('cam:no:' + e.name, '*'));
  });
</script></body></html>`).replace('127.0.0.1', 'localhost');
  const fuori = `<!doctype html><html><body style="margin:0">
<iframe id="f" src="${dentro}" allow="camera; microphone" style="width:400px;height:200px"></iframe>
<script>
  window.__esito = null;
  addEventListener('message', (e) => {
    if (e.data === 'pronto') return;
    window.__esito = e.data;
  });
  window.__chiedi = () => document.getElementById('f').contentWindow.postMessage('vai', '*');
</script></body></html>`;
  const page = await testServer.openReady(openTab, fuori);
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__chiedi());
  const chip = shell.locator('.perm-chip');
  await expect(chip).toHaveCount(1, { timeout: 15_000 });
  // eslint-disable-next-line no-console
  console.log('[586-g3] riquadro — pastiglia:', JSON.stringify(await chip.allTextContents()));
  await chip.locator('.perm-chip-allow').click();
  await page.waitForTimeout(1500);
  const memoria = await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return (s.security && s.security.sitePermissions) || {};
  });
  // eslint-disable-next-line no-console
  console.log('[586-g3] riquadro — esito pagina:', await page.evaluate(() => window.__esito),
    '| memoria:', JSON.stringify(memoria));
  expect(true).toBe(true);
});
