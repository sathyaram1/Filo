// Esplorazione giro 4 — la forma «piatta» della strada vecchia dello schermo.
//
// `getUserMedia({ video: { chromeMediaSource: 'desktop' } })`, senza il
// `mandatory` attorno. La domanda che compare dice «vuole usare la fotocamera».
// Cosa arriva davvero, se si consente?
import { test } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<script>
  const tracce = (s) => s.getTracks().map((t) => t.kind + ' | ' + t.label + ' | ' + JSON.stringify(t.getSettings()));
  window.__piatto = () => navigator.mediaDevices.getUserMedia({ video: { chromeMediaSource: 'desktop' } })
    .then(tracce, (e) => 'no:' + ((e && e.name) || 'errore'));
  window.__piattoConId = () => navigator.mediaDevices.getUserMedia({
    video: { chromeMediaSource: 'desktop', chromeMediaSourceId: 'screen:0:0' },
  }).then(tracce, (e) => 'no:' + ((e && e.name) || 'errore'));
</script></body></html>`;

test('la forma piatta: la domanda dice fotocamera — cosa arriva?', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);

  for (const quale of ['__piatto', '__piattoConId']) {
    const p = page.evaluate((q) => window[q](), quale);
    await shell.waitForTimeout(1200);
    const chips = await shell.locator('.perm-chip').allTextContents();
    console.log(`[586 g4] ${quale} → domanda: ${JSON.stringify(chips)}`);
    const ok = shell.locator('.perm-chip .perm-chip-allow');
    if (await ok.count()) await ok.first().click();
    const r = await Promise.race([p, new Promise((r2) => setTimeout(() => r2('(in attesa)'), 6000))]);
    console.log(`[586 g4] ${quale} → CONSENTITO, arriva: ${JSON.stringify(r)}`);
    console.log(`[586 g4] ${quale} → segno della ripresa: ${JSON.stringify(await shell.locator('.perm-live').allTextContents())}`);
    // pulizia della memoria per la prova dopo
    await shell.waitForTimeout(500);
  }
});

const HTML2 = `<!doctype html><html><body style="margin:0;padding:20px"><p id="p">viva</p>
<script>
  window.__ammazza = () => {
    try { delete navigator.mediaDevices.getUserMedia; } catch (_) {}
    navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop' } } })
      .then(() => {}, () => {});
    return 'sparato';
  };
</script></body></html>`;

test('la riga che ammazza la scheda, con la protezione tolta dalla pagina', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML2);
  const finestrePrima = app.windows().length;
  try { await page.evaluate(() => window.__ammazza()); } catch (e) { console.log('[586 g4] evaluate:', e.message); }
  await new Promise((r) => setTimeout(r, 4000));
  let shellViva = 'sì';
  try { await shell.evaluate(() => document.title); } catch (e) { shellViva = 'NO: ' + e.message.slice(0, 80); }
  console.log('[586 g4] finestre prima:', finestrePrima, 'dopo:', app.windows().length);
  console.log('[586 g4] la cornice di Filo è ancora viva?', shellViva);
});
