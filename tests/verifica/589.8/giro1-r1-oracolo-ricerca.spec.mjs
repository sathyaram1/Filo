// #589.8 giro 1, rilievo 1 — la cronologia sta in uno shadow root chiuso, ma il documento del sito ha un
// oracolo di ricerca testuale (window.find) che attraversa anche gli shadow root chiusi: a pannello aperto
// dall'utente il sito ricostruisce il testo lettera per lettera, password comprese, senza che l'utente veda
// niente. La regola del lavoro dice «anche aperta dall'utente, il sito non deve poterla leggere»: questo la
// viola. Successo dal punto di vista dell'utente = il sito NON riesce a ricostruire il segreto.

import { test, expect } from '../../fixtures/electron.mjs';
import { testiCronologia } from '../../helpers/cronologiaAppunti.mjs';

const SEGRETO = 'pw-Segreta-589-otto';

const PAGINA = `<!doctype html><html><body style="padding:40px">
  <input id="campo" style="width:320px;font-size:16px">
  <script>
  // Ricostruisce un testo che inizia per 'pw-' interrogando l'oracolo di ricerca prefisso dopo prefisso.
  window.ricostruisci = () => {
    const alfabeto = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
    let noto = 'pw-';
    if (!window.find(noto, true, false, true)) return 'nessun-prefisso';
    for (let giro = 0; giro < 60; giro++) {
      let trovato = false;
      for (const c of alfabeto) {
        getSelection().removeAllRanges();
        if (window.find(noto + c, true, false, true)) { noto += c; trovato = true; break; }
      }
      if (!trovato) break;
    }
    return noto;
  };
  </script>
</body></html>`;

test('a cronologia aperta dall\'utente il sito non ricostruisce il segreto con un oracolo di ricerca', async ({ app, shell, openTab, testServer }) => {
  for (const text of ['un testo qualsiasi', SEGRETO]) {
    await shell.evaluate((t) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text: t } }), text);
  }
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');

  // Prima che l'utente apra la cronologia, il segreto non è nel documento: l'oracolo non lo trova.
  expect(await page.evaluate(() => window.find('pw-Segreta', true, false, true))).toBe(false);

  // L'utente, con un gesto vero, apre la propria cronologia per incollare.
  await page.locator('#campo').click({ button: 'right' });
  await page.locator('.sn-menu-paste-arrow').hover();
  await expect.poll(() => testiCronologia(app, page)).toContain(SEGRETO);

  // Il sito, dentro il proprio script, prova a leggere ciò che l'utente ha solo guardato.
  const ricostruito = await page.evaluate(() => window.ricostruisci());
  expect(ricostruito, 'il sito non deve poter ricostruire il testo della cronologia').not.toBe(SEGRETO);
});
