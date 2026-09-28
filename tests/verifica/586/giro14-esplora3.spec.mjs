// Verifica #586 giro 14: esplorazione 3 (si cancella prima della registrazione).
import { test, expect } from '../../fixtures/electron.mjs';

test.use({ argomentiApp: ['--use-fake-device-for-media-stream'] });

const riga = (shell) => shell.locator('#perm-bar .perm-row');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LETTORE = `<!doctype html><title>Widget</title><script>
  window.stati = async () => {
    const out = {};
    for (const n of ['camera', 'microphone', 'geolocation', 'notifications']) {
      try { out[n] = (await navigator.permissions.query({ name: n })).state; } catch (e) { out[n] = 'err'; }
    }
    out.notPerm = Notification.permission;
    return out;
  };
</script>`;

test('J: stati letti da riquadri con indirizzo, srcdoc e scritti dalla pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const widget = testServer.html(LETTORE).replace('127.0.0.1', 'localhost');
  const host = await testServer.openReady(openTab, `<!doctype html><title>Ospite</title>
    <iframe id="a" src="${widget}"></iframe>
    <iframe id="b" srcdoc="${LETTORE.replace(/"/g, '&quot;')}"></iframe>
    <iframe id="c"></iframe>`);
  await sleep(1500);
  const frames = host.frames();
  const out = {};
  for (const f of frames) {
    try { out[f.url()] = await f.evaluate(() => (window.stati ? window.stati() : null)); } catch (e) { out[f.url()] = 'err ' + e.message; }
  }
  out.scritto = await host.evaluate(async () => {
    const w = document.getElementById('c').contentWindow;
    const r = {};
    for (const n of ['camera', 'notifications']) r[n] = (await w.navigator.permissions.query({ name: n })).state;
    r.notPerm = w.Notification.permission;
    return r;
  });
  console.log('J', JSON.stringify(out));
});

test('K: getDisplayMedia, scelta della scheda', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><title>Presenta</title><script>
    window.chiedi = () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      .then((s) => { window.__s = s; return s.getTracks().map((t) => t.kind + ':' + t.label + ':' + JSON.stringify(t.getSettings().displaySurface || t.getSettings().deviceId)); }, (e) => 'err:' + e.name);
  </script>`);
  await page.evaluate(() => { window.__e = null; window.chiedi().then((r) => { window.__e = r; }); });
  await expect(riga(shell)).toHaveCount(1, { timeout: 10_000 });
  console.log('K domanda', JSON.stringify(await riga(shell).innerText()));
  await expect(shell.locator('#perm-bar .perm-si')).toBeEnabled();
  await shell.locator('#perm-bar .perm-si').click();
  await expect(shell.locator('#perm-bar .perm-fonte[data-tipo="scheda"]').first()).toBeVisible({ timeout: 10_000 });
  await shell.locator('#perm-bar .perm-fonte[data-tipo="scheda"]').first().click();
  await expect.poll(() => page.evaluate(() => window.__e), { timeout: 10_000 }).not.toBeNull();
  console.log('K esito', JSON.stringify(await page.evaluate(() => window.__e)));
  await sleep(1500);
  console.log('K segno', JSON.stringify(await shell.locator('.tab .perm-uso').evaluateAll((els) => els.map((e) => e.dataset.tip))));
});
