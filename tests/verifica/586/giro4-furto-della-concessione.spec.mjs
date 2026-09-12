// Esplorazione giro 4 — la concessione che Filo si dà per sé, presa dal sito.
//
// Quando l'utente preme «Incolla» (o «Detta») nel menu di Filo dentro una
// pagina web, Filo si annuncia al main e per pochi secondi quella pagina può
// leggere gli appunti (o aprire il microfono) senza domanda. La concessione è
// legata alla SCHEDA, non a chi ha chiesto: il codice del sito che gira nella
// stessa pagina può arrivare per primo e prendersela.
import { test } from '../../fixtures/electron.mjs';

const SEGRETO = 'password-negli-appunti-9Z2';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<textarea id="ta" rows="4" cols="60"></textarea>
<script>
  window.__rubato = null;
  window.__tentativi = 0;
  window.__errori = {};
  // Il sito non fa NIENTE di speciale: chiede gli appunti in continuazione.
  // Finché nessuno gli dà niente, ogni tentativo fallisce.
  const bussa = async () => {
    while (!window.__rubato) {
      window.__tentativi++;
      try {
        const t = await navigator.clipboard.readText();
        if (t) { window.__rubato = t; return; }
      } catch (e) {
        const n = (e && e.name) || 'errore';
        window.__errori[n] = (window.__errori[n] || 0) + 1;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  bussa();
</script></body></html>`;

test('gli appunti che il sito prende mentre l\'utente usa l\'Incolla di Filo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await testServer.openReady(openTab, HTML);
  await page.waitForTimeout(800);
  console.log('[586 g4] prima del gesto, rubato =', JSON.stringify(await page.evaluate(() => window.__rubato)));
  console.log('[586 g4] errori del sito finora:', JSON.stringify(await page.evaluate(() => window.__errori)));

  // Adesso l'utente, davvero: tasto destro sul campo e «Incolla».
  await page.click('#ta', { button: 'right' });
  await page.waitForTimeout(900);
  const voci = await page.evaluate(() => [...document.querySelectorAll('.sn-menu-item, .sn-menu-row-btn, button')]
    .map((n) => (n.className || '') + ' :: ' + (n.textContent || '').slice(0, 30)).slice(0, 40));
  console.log('[586 g4] voci del menu:', JSON.stringify(voci, null, 1));

  const incolla = page.locator('.sn-menu-paste-main').first();
  if (await incolla.count()) {
    await incolla.click();
  } else {
    console.log('[586 g4] voce Incolla non trovata');
  }
  await page.waitForTimeout(2500);

  const rubato = await page.evaluate(() => window.__rubato);
  const dentro = await page.evaluate(() => document.getElementById('ta').value);
  const tent = await page.evaluate(() => window.__tentativi);
  const err = await page.evaluate(() => window.__errori);
  console.log('[586 g4] tentativi del sito:', tent, 'errori:', JSON.stringify(err));
  console.log('[586 g4] RUBATO dal sito:', JSON.stringify(rubato));
  console.log('[586 g4] incollato da Filo nel campo:', JSON.stringify(dentro));
  console.log('[586 g4] pastiglie:', JSON.stringify(await shell.locator('.perm-chip').allTextContents()));
});
