// Esplorazione giro 4 — dopo il «Consenti», il sito ottiene davvero la cosa?
// E la domanda si legge, su una finestra stretta?
import { test } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px"><p>pagina</p>
<script>
  window.__posizione = () => new Promise((r) => {
    navigator.geolocation.getCurrentPosition(
      (p) => r('OK ' + p.coords.latitude + ',' + p.coords.longitude),
      (e) => r('no: ' + e.code + ' ' + e.message), { timeout: 12000 });
  });
  window.__notifiche = () => Notification.requestPermission().then((s) => {
    if (s !== 'granted') return 'permesso=' + s;
    try { const n = new Notification('ciao', { body: 'prova' }); return 'permesso=granted, notifica creata=' + !!n; }
    catch (e) { return 'permesso=granted ma la notifica esplode: ' + e.name + ' ' + e.message; }
  }, (e) => 'errore ' + e);
  window.__appunti = () => navigator.clipboard.readText().then((t) => 'letto: ' + t, (e) => 'no: ' + e.name);
</script></body></html>`;

test('dopo il Consenti: posizione, notifiche, appunti arrivano davvero?', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('testo-negli-appunti'));
  const page = await testServer.openReady(openTab, HTML);

  for (const quale of ['__posizione', '__notifiche', '__appunti']) {
    const p = page.evaluate((q) => window[q](), quale);
    await shell.waitForTimeout(1200);
    console.log(`[586 g4] ${quale} → domanda: ${JSON.stringify(await shell.locator('.perm-chip').allTextContents())}`);
    const ok = shell.locator('.perm-chip .perm-chip-allow');
    if (await ok.count()) await ok.first().click();
    const r = await Promise.race([p, new Promise((r2) => setTimeout(() => r2('(in attesa oltre i 20s)'), 20000))]);
    console.log(`[586 g4] ${quale} → dopo il Consenti: ${JSON.stringify(r)}`);
  }
});

test('la domanda su una finestra stretta: si legge cosa si sta per dare?', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);

  for (const larghezza of [1280, 800, 640, 520]) {
    await app.evaluate(({ BrowserWindow }, w) => {
      const win = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
      win.setSize(w, 800);
    }, larghezza);
    await shell.waitForTimeout(600);
    const p = page.evaluate(() => window.__posizione());
    await shell.waitForTimeout(1200);
    const misura = await shell.evaluate(() => {
      const t = document.querySelector('.perm-chip .perm-chip-text');
      if (!t) return null;
      const cs = getComputedStyle(t);
      // Quanto del testo si vede davvero
      const visibile = t.clientWidth;
      const intero = t.scrollWidth;
      return {
        testo: t.textContent, visibile, intero, tagliato: intero > visibile + 1,
        larghezzaFinestra: window.innerWidth, whiteSpace: cs.whiteSpace,
      };
    });
    console.log(`[586 g4] finestra ${larghezza}px →`, JSON.stringify(misura));
    const x = shell.locator('.perm-chip .perm-chip-x');
    if (await x.count()) await x.first().click();
    await Promise.race([p, new Promise((r2) => setTimeout(r2, 2000))]);
    await shell.waitForTimeout(400);
  }
});
