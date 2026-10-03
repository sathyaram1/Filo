import { test } from '../../fixtures/electron.mjs';
test('sonda scritto', async ({ app, openTab, testServer }) => {
  await app.evaluate(() => {
    const A = globalThis.__filoAdblock;
    A.setDomainsForTest(['blocked.test']);
    A.configureFromSettings({ security: { adblock: { enabled: true } } });
    globalThis.__sonda = [];
    const orig = A.chiudiInPagina;
    A.chiudiInPagina = (d) => { let u = null; try { u = d.frame && d.frame.url; } catch (e) {} globalThis.__sonda.push({ type: d.resourceType, url: d.url, frame: u }); orig(d); };
  });
  const ad = testServer.origin.replace('127.0.0.1', 'blocked.test');
  const scritto = JSON.stringify(`<body style="margin:0"><img src="${ad}/w.gif" width="300" height="250"></body>`);
  const page = await testServer.openReady(openTab, `<!doctype html><title>SONDA</title>
<iframe id="scritto" width="300" height="250"></iframe>
<script>{ const d = document.getElementById('scritto').contentDocument; d.open(); d.write(${scritto}); d.close(); }</script>`, { pubblico: true });
  await page.waitForTimeout(1500);
  console.log('SONDA', JSON.stringify(await app.evaluate(() => globalThis.__sonda)));
  console.log('DENTRO', await page.evaluate(() => { const d = document.getElementById('scritto').contentDocument; return d.documentElement.outerHTML + ' ready=' + d.readyState; }));
});
