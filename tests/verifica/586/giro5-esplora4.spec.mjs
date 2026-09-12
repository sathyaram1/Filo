// Esplorazione giro 5 (4) — NON è una prova che vale.
import { test, expect } from '../../fixtures/electron.mjs';

// pagina che QUERY-a local-fonts al caricamento, senza nessun gesto
const HTML_Q = `<!doctype html><html><body style="margin:0;padding:20px">
<p>un sito che guarda cosa può fare, come fanno tutti</p>
<script>
  window.__stati = {};
  (async () => {
    for (const n of ['camera','microphone','geolocation','notifications','local-fonts']) {
      try { const s = await navigator.permissions.query({ name: n }); window.__stati[n] = s.state; }
      catch (e) { window.__stati[n] = 'no:' + e.name; }
    }
    window.__fatto = true;
  })();
</script></body></html>`;

const HTML_USO = `<!doctype html><html><body style="margin:0;padding:20px">
<input id="campo" style="font-size:18px;width:300px">
<script>
  window.__pos = () => new Promise((r) => navigator.geolocation.getCurrentPosition(
    (p) => r('coordinate ' + p.coords.latitude.toFixed(2)),
    (e) => r('errore ' + e.code + ' ' + e.message), { timeout: 20000 }));
  window.__notif = () => Notification.requestPermission().then((v) => {
    let esito = 'permesso=' + v;
    try { if (v === 'granted') { new Notification('ciao'); esito += ' notifica-creata'; } }
    catch (e) { esito += ' throw:' + e.name; }
    return esito;
  });
  window.__appunti = () => navigator.clipboard.readText().then((t) => 'letto:' + t, (e) => 'no:' + e.name);
  window.__mic = () => navigator.mediaDevices.getUserMedia({ audio: true })
    .then((s) => { window.__t = s.getTracks()[0]; return 'ok'; }, (e) => 'no:' + e.name);
  window.__vivo = () => window.__t ? window.__t.readyState : 'niente';
</script></body></html>`;

test('D2 — una pagina che guarda i propri stati, senza nessun gesto', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML_Q);
  await page.waitForFunction(() => window.__fatto === true, null, { timeout: 15000 }).catch(() => {});
  await shell.waitForTimeout(2500);
  console.log('[g5-4 D2] stati letti:', JSON.stringify(await page.evaluate(() => window.__stati)));
  console.log('[g5-4 D2] domande comparse senza nessun clic:', JSON.stringify(await shell.locator('.perm-chip').allTextContents()));
});

test('E — posizione, notifiche, appunti dopo il Consenti', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML_USO);

  const p = page.evaluate(() => window.__pos());
  await shell.waitForTimeout(2000);
  console.log('[g5-4 E] domanda posizione:', JSON.stringify(await shell.locator('.perm-chip').allTextContents()));
  let c = shell.locator('.perm-chip .perm-chip-allow');
  if (await c.count()) await c.first().click();
  console.log('[g5-4 E] posizione:', await Promise.race([p, new Promise((r) => setTimeout(() => r('(attesa >25s)'), 25000))]));

  const n = page.evaluate(() => window.__notif());
  await shell.waitForTimeout(2000);
  console.log('[g5-4 E] domanda notifiche:', JSON.stringify(await shell.locator('.perm-chip').allTextContents()));
  c = shell.locator('.perm-chip .perm-chip-allow');
  if (await c.count()) await c.first().click();
  console.log('[g5-4 E] notifiche:', await Promise.race([n, new Promise((r) => setTimeout(() => r('(attesa)'), 10000))]));

  const a = page.evaluate(() => window.__appunti());
  await shell.waitForTimeout(2000);
  console.log('[g5-4 E] domanda appunti:', JSON.stringify(await shell.locator('.perm-chip').allTextContents()));
  c = shell.locator('.perm-chip .perm-chip-allow');
  if (await c.count()) await c.first().click();
  console.log('[g5-4 E] appunti:', await Promise.race([a, new Promise((r) => setTimeout(() => r('(attesa)'), 10000))]));
});

test('F — revoca dalle Impostazioni: cosa perde chi stava scrivendo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML_USO);
  const m = page.evaluate(() => window.__mic());
  await shell.waitForTimeout(2000);
  const c = shell.locator('.perm-chip .perm-chip-allow');
  if (await c.count()) await c.first().click();
  console.log('[g5-4 F] mic:', await Promise.race([m, new Promise((r) => setTimeout(() => r('(attesa)'), 8000))]));

  // chi usa Filo sta scrivendo qualcosa in quella pagina
  await page.fill('#campo', 'una risposta lunga che sto scrivendo da dieci minuti');
  console.log('[g5-4 F] campo prima:', await page.inputValue('#campo'));

  // va in Impostazioni e toglie il microfono
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const sic = await aspetta(async () => app.windows().find((w) => { try { return w.url().includes('security.html'); } catch (_) { return false; } }) || null);
  await sic.waitForLoadState('domcontentloaded').catch(() => {});
  await sic.waitForTimeout(1500);
  console.log('[g5-4 F] elenco:', JSON.stringify(await sic.locator('#perms-list li').allTextContents()));
  const via = sic.locator('#perms-list button');
  console.log('[g5-4 F] bottoni riga:', await via.allTextContents());
  // il × che toglie
  const x = sic.locator('#perms-list li button').last();
  await x.click();
  await sic.waitForTimeout(2500);

  let campo = '?';
  try { campo = await page.inputValue('#campo'); } catch (e) { campo = 'ERR ' + e.message.split('\n')[0]; }
  console.log('[g5-4 F] campo dopo la revoca:', JSON.stringify(campo));
  console.log('[g5-4 F] traccia microfono dopo:', await page.evaluate(() => window.__vivo()).catch((e) => 'ERR'));
  console.log('[g5-4 F] url pagina:', await page.evaluate(() => location.href).catch(() => 'morta'));
});

async function aspetta(fn, ms = 15_000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); }
  return null;
}
