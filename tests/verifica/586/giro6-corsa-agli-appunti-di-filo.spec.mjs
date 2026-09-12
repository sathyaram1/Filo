// Verifica #586, giro 6 — la concessione che Filo si dà per l'Incolla, e il
// sito che prova a prendersela.
//
// L'Incolla del menu di Filo legge gli appunti senza domanda, e ha ragione: a
// chiedere è l'utente, non il sito. Per farlo, Filo si dà una concessione che
// vale una volta e pochi secondi. In quella finestra, però, chi chiede gli
// appunti in quella scheda se la prende: il sito che li richiede in continuazione
// non deve poterla intercettare.
//
// Qui il gesto è VERO (il tasto destro lo preme il test, non la pagina), quindi
// tutte le difese sui gesti finti non c'entrano: la domanda è solo se la
// concessione di Filo finisca in mano al sito che sta lì ad aspettarla.

import { test, expect } from '../../fixtures/electron.mjs';

const SEGRETO = 'codice-a-sei-cifre-914275';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<textarea id="ta" rows="4" cols="50" style="width:90%;height:120px"></textarea>
<div id="spia" style="margin-top:8px">niente</div>
<script>
  // Il sito chiede gli appunti in continuazione e aspetta il momento buono.
  window.__bottino = '';
  window.__tentativi = 0;
  const gira = async () => {
    for (let i = 0; i < 4000; i++) {
      window.__tentativi++;
      try {
        const t = await navigator.clipboard.readText();
        if (t) { window.__bottino = t; document.getElementById('spia').textContent = 'preso'; return; }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  gira();
</script></body></html>`;

test('un sito che chiede gli appunti in continuazione non deve prendersi la concessione dell\'Incolla di Filo', async ({ app, page: _p, shell, openTab, testServer }) => {
  test.setTimeout(240_000);
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);

  const page = await testServer.openReady(openTab, HTML);
  await page.waitForTimeout(800);

  // Gesto VERO: tasto destro dentro il campo, poi «Incolla» del menu di Filo.
  await page.click('#ta');
  await page.click('#ta', { button: 'right' });
  await page.waitForTimeout(900);

  const voce = page.locator('.sn-menu-paste-main').first();
  const presente = await voce.count();
  if (presente) await voce.click();
  else {
    const alt = page.locator('.sn-menu-item, .sn-menu-row-btn').filter({ hasText: /incolla/i }).first();
    await alt.click();
  }
  await page.waitForTimeout(2500);

  const stato = await page.evaluate(() => ({
    campo: document.getElementById('ta').value,
    bottino: window.__bottino,
    tentativi: window.__tentativi,
  }));
  const domande = await shell.locator('.perm-chip').count();
  console.log('[586 g6] Incolla vero — campo:', JSON.stringify(stato.campo),
    'bottino del sito:', JSON.stringify(stato.bottino),
    'tentativi:', stato.tentativi, 'domande:', domande);

  expect(
    String(stato.campo || ''),
    'l\'Incolla di Filo non ha incollato niente: la concessione che Filo si dà per sé se l\'è '
    + 'presa qualcun altro, oppure il menu non ha funzionato',
  ).toContain(SEGRETO);

  expect(
    String(stato.bottino || ''),
    'mentre l\'utente usava l\'Incolla di Filo, il sito che chiedeva gli appunti in continuazione '
    + 'si è preso quello che c\'era dentro: la concessione che Filo si dà per una lettura sua vale '
    + 'per la prima richiesta che arriva in quella scheda, e la prima può essere quella del sito',
  ).not.toContain(SEGRETO);
});
