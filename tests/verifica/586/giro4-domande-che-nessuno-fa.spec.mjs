// Verifica #586, giro 4 — le domande che nessun browser fa, scritte in inglese.
//
// #586 chiede che i permessi sensibili passino da una scelta, «e per prudenza
// tutto ciò che non è nella lista dei permessi innocui». La lista degli innocui
// è ferma a sei voci, e fuori di lì finiscono anche cose che nessun browser
// chiede mai e che i siti normali usano di continuo:
//
//   · tenere acceso lo schermo mentre va un video (Screen Wake Lock): lo
//     chiedono i lettori video, le mappe mentre navighi, le pagine di ricette;
//   · l'inclinazione del telefono/portatile (i sensori generici);
//   · lo spazio che il sito si tiene da parte (persistent storage).
//
// Per chi usa Filo: apri un video e, appena parte, compare una pastiglia che
// dice «questo sito vuole usare «screen-wake-lock»» — una parola inglese dentro
// una Filo tutta in italiano, per una cosa che nessuno gli ha mai chiesto
// altrove. Chi nega si ritrova lo schermo che si spegne durante il film.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<p>un sito con un video</p>
<script>
  window.__schermoAcceso = () => navigator.wakeLock.request('screen')
    .then(() => 'ok', (e) => 'no: ' + ((e && e.name) || 'errore'));
  window.__sensore = () => new Promise((r) => {
    try {
      const a = new Accelerometer({ frequency: 10 });
      a.addEventListener('error', (e) => r('no: ' + (e.error && e.error.name)));
      a.addEventListener('reading', () => r('ok'));
      a.start();
      setTimeout(() => r('niente'), 4000);
    } catch (e) { r('throw ' + e.name); }
  });
  window.__spazio = () => navigator.storage.persist().then((v) => 'persist=' + v, (e) => 'no: ' + e.name);
</script></body></html>`;

// Le parole che non devono comparire in una domanda rivolta a chi usa Filo:
// sono i nomi tecnici che Chromium usa fra sé e sé.
const INGLESE = /«[a-z-]+»/;

test('tenere acceso lo schermo mentre va un video non è una domanda da fare', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);

  const esito = page.evaluate(() => window.__schermoAcceso());
  // Se una domanda arriva, la si guarda; se non arriva, tanto meglio.
  await shell.waitForTimeout(2000);
  const testi = await shell.locator('.perm-chip').allTextContents();
  console.log('[586 g4] wake lock → domanda:', JSON.stringify(testi));
  if (testi.length) {
    await shell.screenshot({ path: 'tests/.shots/586-giro4-domanda-in-inglese.png' });
  }
  const x = shell.locator('.perm-chip .perm-chip-x');
  if (await x.count()) await x.first().click();
  console.log('[586 g4] wake lock → esito per la pagina:',
    await Promise.race([esito, new Promise((r) => setTimeout(() => r('(in attesa)'), 5000))]));

  expect(
    testi.join(' | '),
    'tenere acceso lo schermo durante un video non lo chiede nessun browser: qui compare '
    + 'una domanda, e per giunta col nome tecnico inglese del permesso',
  ).toBe('');
});

test('nessuna domanda deve mostrare il nome tecnico inglese del permesso', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);
  const trovate = [];

  for (const quale of ['__schermoAcceso', '__sensore', '__spazio']) {
    const p = page.evaluate((q) => window[q](), quale).catch(() => null);
    await shell.waitForTimeout(2000);
    const testi = await shell.locator('.perm-chip').allTextContents();
    console.log(`[586 g4] ${quale} → domanda: ${JSON.stringify(testi)}`);
    for (const t of testi) if (INGLESE.test(t)) trovate.push(`${quale}: ${t}`);
    const x = shell.locator('.perm-chip .perm-chip-x');
    if (await x.count()) await x.first().click();
    await Promise.race([p, new Promise((r) => setTimeout(r, 4000))]);
    await shell.waitForTimeout(400);
  }

  expect(
    trovate,
    'una domanda scritta col nome tecnico del permesso non la capisce nessuno: '
    + 'chi la legge non sa cosa sta per dare, e la risposta più probabile è a caso',
  ).toEqual([]);
});
