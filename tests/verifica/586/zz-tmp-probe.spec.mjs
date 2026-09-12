import { test } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<button id="b" style="font-size:20px">premi</button>
<script>
  window.__out = null;
  document.getElementById('b').addEventListener('click', async () => {
    const o = {};
    try { const f = await window.queryLocalFonts(); o.fonts = f.length; } catch (e) { o.fonts = 'no ' + e.name; }
    window.__out = o;
  });
</script></body></html>`;

test('quali permessi arrivano davvero al gestore', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const pagina = await testServer.openReady(openTab, HTML);
  await app.evaluate(({ session }) => {
    globalThis.__visti = [];
    session.defaultSession.setPermissionRequestHandler((wc, p, cb) => { globalThis.__visti.push(p); cb(true); });
    const vecchio = session.defaultSession.setPermissionCheckHandler;
    session.defaultSession.setPermissionCheckHandler((wc, p) => { globalThis.__visti.push('check:' + p); return true; });
    void vecchio;
  });
  await pagina.click('#b');
  await pagina.waitForTimeout(3000);
  console.log('[probe] esito pagina:', JSON.stringify(await pagina.evaluate(() => window.__out)));
  console.log('[probe] permessi arrivati al gestore:', JSON.stringify(await app.evaluate(() => globalThis.__visti)));
});
