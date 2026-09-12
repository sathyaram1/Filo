// Verifica #586, giro 5 — la domanda che nasce da una pagina che non ha chiesto
// niente, e il permesso che continua a leggersi «negato».
//
// Due cose che si toccano, tutt'e due sui caratteri installati.
//
// 1. Una pagina che si limita a GUARDARE cosa può fare — `navigator.permissions
//    .query`, la riga con cui ogni sito educato decide se mostrare o no un
//    bottone — fa comparire una pastiglia col nome del sito, senza che nessuno
//    abbia cliccato niente. Nessun browser apre una domanda per una lettura di
//    stato: la domanda segue una richiesta, non uno sguardo.
//
// 2. Nella stessa riga il sito legge «negato», mentre per fotocamera,
//    microfono, posizione e notifiche legge «da chiedere». È il rilievo che il
//    giro 3 aveva chiuso, rimasto aperto proprio sul permesso che ne ha più
//    bisogno: il sito legge «negato», smette lì, e la domanda che è comparsa
//    dietro le sue spalle non servirà mai a niente.
//
// Per chi usa Filo: apri un sito qualunque e, senza aver toccato niente,
// compare «vuole vedere i caratteri installati sul tuo computer».

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<p>un sito che guarda cosa può fare, prima di chiedere</p>
<script>
  window.__stati = {};
  (async () => {
    for (const n of ['camera', 'microphone', 'geolocation', 'notifications', 'local-fonts']) {
      try { const s = await navigator.permissions.query({ name: n }); window.__stati[n] = s.state; }
      catch (e) { window.__stati[n] = 'no:' + e.name; }
    }
    window.__fatto = true;
  })();
</script></body></html>`;

test('guardare i propri permessi non deve far comparire una domanda', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  await page.waitForFunction(() => window.__fatto === true, null, { timeout: 15_000 }).catch(() => {});
  await shell.waitForTimeout(2500);

  const domande = await shell.locator('.perm-chip').allTextContents();
  console.log('[586 g5] domande comparse senza nessun clic:', JSON.stringify(domande));
  if (domande.length) await shell.screenshot({ path: 'tests/.shots/586-giro5-domanda-mai-chiesta.png' });

  expect(
    domande,
    'una pagina che si è limitata a leggere i propri stati ha fatto comparire una domanda: '
    + 'chi naviga si vede chiedere un permesso per un gesto che non ha fatto, su ogni '
    + 'caricamento della pagina finché non risponde',
  ).toEqual([]);
});

test('prima di rispondere, ogni permesso deve leggersi «da chiedere», caratteri compresi', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  await page.waitForFunction(() => window.__fatto === true, null, { timeout: 15_000 }).catch(() => {});
  const stati = await page.evaluate(() => window.__stati);
  console.log('[586 g5] stati letti dal sito:', JSON.stringify(stati));

  expect(
    stati['local-fonts'],
    'il sito legge «negato» su una cosa che nessuno ha mai negato, e smette lì: è il rilievo '
    + 'del giro 3 rimasto aperto sull\'unico permesso che Filo chiede partendo da una lettura '
    + 'di stato',
  ).toBe('prompt');
});
