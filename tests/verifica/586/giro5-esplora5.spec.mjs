// Esplorazione giro 5 (5) — NON è una prova che vale.
import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<input id="campo" style="font-size:18px;width:320px">
<script>
  window.__mic = () => navigator.mediaDevices.getUserMedia({ audio: true }).then(() => 'ok', (e) => 'no:' + e.name);
  window.__nag = 0;
  window.__nagLoop = () => { window.__nag++; return navigator.mediaDevices.getUserMedia({ video: true })
    .then(() => 'ok', (e) => { setTimeout(window.__nagLoop, 100); return 'no'; }); };
</script></body></html>`;

test('G — due schede dello stesso sito: la revoca le ricarica tutte?', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const url = testServer.html(HTML);
  const a = await openTab(url);
  await a.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  const m = a.evaluate(() => window.__mic());
  await shell.waitForTimeout(2000);
  const c = shell.locator('.perm-chip .perm-chip-allow');
  if (await c.count()) await c.first().click();
  console.log('[g5-5 G] mic scheda A:', await Promise.race([m, new Promise((r) => setTimeout(() => r('(attesa)'), 8000))]));

  const b = await openTab(url);
  await b.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await b.fill('#campo', 'sto scrivendo qui, e non ho mai dato niente a nessuno');
  console.log('[g5-5 G] campo B prima:', await b.inputValue('#campo'));
  await a.fill('#campo', 'anche qui');

  // revoca dal tasto destro sulla scheda A? usiamo le Impostazioni (più diretto)
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const sic = await aspetta(async () => app.windows().find((w) => { try { return w.url().includes('security.html'); } catch (_) { return false; } }) || null);
  await sic.waitForLoadState('domcontentloaded').catch(() => {});
  await sic.waitForTimeout(1500);
  await sic.locator('#perms-list li button').last().click();
  await sic.waitForTimeout(2500);
  console.log('[g5-5 G] campo A dopo:', JSON.stringify(await a.inputValue('#campo').catch((e) => 'ERR')));
  console.log('[g5-5 G] campo B dopo:', JSON.stringify(await b.inputValue('#campo').catch((e) => 'ERR')));
});

test('H — la × e il sito che richiede subito: si può ancora usare la pagina?', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);
  page.evaluate(() => window.__nagLoop()).catch(() => {});
  for (let i = 0; i < 4; i++) {
    await shell.waitForTimeout(1500);
    const x = shell.locator('.perm-chip .perm-chip-x');
    const n = await x.count();
    if (n) await x.first().click();
    console.log(`[g5-5 H] giro ${i}: pastiglie=${n}`);
  }
  await shell.waitForTimeout(1500);
  console.log('[g5-5 H] tentativi della pagina:', await page.evaluate(() => window.__nag));
  console.log('[g5-5 H] pastiglie ancora lì:', await shell.locator('.perm-chip').count());
});

test('I — incognito: la partizione nuova nasce protetta?', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const url = testServer.html(HTML);
  await shell.evaluate(() => window.filoShell.tabs.newIncognitoWindow ? window.filoShell.tabs.newIncognitoWindow() : null).catch(() => {});
  await shell.waitForTimeout(1500);
  console.log('[g5-5 I] finestre:', app.windows().map((w) => { try { return w.url().slice(0, 50); } catch (_) { return '?'; } }));
});

async function aspetta(fn, ms = 15_000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); }
  return null;
}
