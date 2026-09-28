import { test, expect } from '../../fixtures/electron.mjs';
const PAGINA = `<!doctype html><html><head><title>V</title></head><body><button id="b">x</button><script>
  window.wake = () => navigator.wakeLock.request('screen').then(() => 'ok', (e) => 'err:' + e.name);
  window.fonts = () => window.queryLocalFonts().then((f) => f.length, (e) => 'err:' + e.name);
  window.q = async (n) => { try { return (await navigator.permissions.query({ name: n })).state; } catch (e) { return 'err:' + e.name; } };
  window.notif = () => Notification.permission;
</script></body></html>`;
test('nomi', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ session }) => {
    globalThis.__log = [];
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((wc, p, cb, d) => { globalThis.__log.push({ req: p, d: JSON.stringify(d).slice(0, 300) }); cb(false); });
    ses.setPermissionCheckHandler((wc, p, o, d) => { globalThis.__log.push({ chk: p, o, d: JSON.stringify(d).slice(0, 300) }); return false; });
  });
  const page = await testServer.openReady(openTab, PAGINA);
  const out = {};
  await page.click('#b'); out.wake = await page.evaluate(() => window.wake());
  await page.click('#b'); out.fonts = await page.evaluate(() => window.fonts());
  for (const n of ['local-fonts', 'screen-wake-lock', 'camera', 'notifications', 'window-management', 'clipboard-read']) out['q_' + n] = await page.evaluate((x) => window.q(x), n);
  out.notif = await page.evaluate(() => window.notif());
  console.log('out', JSON.stringify(out));
  for (const l of await app.evaluate(() => globalThis.__log)) console.log('log', JSON.stringify(l));
});
