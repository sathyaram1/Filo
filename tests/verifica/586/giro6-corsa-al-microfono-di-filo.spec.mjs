// Verifica #586, giro 6 — la seconda porta della stessa causa: la dettatura.
//
// Come per l'Incolla, anche la dettatura di Filo dentro una pagina web si dà una
// concessione al volo per accendere il microfono senza domanda: a chiedere è
// l'utente. Qui il gesto è VERO — il tasto destro e la voce «Detta» li preme il
// test — e il sito sta lì a chiedere il microfono in continuazione, aspettando
// che la concessione passi.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<textarea id="ta" rows="4" cols="50" style="width:90%;height:120px"></textarea>
<script>
  window.__preso = null;
  window.__tentativi = 0;
  const prova = () => {
    window.__tentativi++;
    try {
      navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
        if (!window.__preso) window.__preso = s.getTracks().map((t) => t.kind + ':' + t.readyState);
      }, () => {});
    } catch (_) {}
  };
  for (let i = 0; i < 50; i++) prova();
  setInterval(() => { for (let i = 0; i < 10; i++) prova(); }, 25);
</script></body></html>`;

test('un sito che chiede il microfono in continuazione non deve prendersi la concessione della dettatura', async ({ shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await testServer.openReady(openTab, HTML);
  await page.waitForTimeout(800);

  await page.click('#ta');
  await page.click('#ta', { button: 'right' });
  await page.waitForTimeout(900);

  const detta = page.locator('button, .sn-menu-item, .sn-menu-row-btn').filter({ hasText: /🎤/ }).first();
  const c = await detta.count();
  console.log('[586 g6] voce «Detta» trovata:', c);
  if (c) await detta.click();
  await page.waitForTimeout(2500);

  const stato = await page.evaluate(() => ({ preso: window.__preso, tentativi: window.__tentativi }));
  console.log('[586 g6] microfono preso dal sito:', JSON.stringify(stato.preso), 'tentativi:', stato.tentativi);

  expect(
    stato.preso,
    'mentre l\'utente faceva partire la dettatura di Filo, il sito che chiedeva il microfono in '
    + 'continuazione se l\'è preso: la concessione che Filo si dà per una richiesta sua vale per '
    + 'la prima che arriva in quella scheda, e la prima può essere quella del sito',
  ).toBeNull();
});
