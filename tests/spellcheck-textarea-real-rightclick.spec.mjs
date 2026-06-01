// Feedback alpha gRrZZ (riaperto): "in questo stesso box non mi corregge questa
// parolla (non vedo suggerimenti quando clicco con il tasto destro su parolla)".
//
// "Questo box" = la textarea del form feedback (un <textarea>, editabile
// "supportato" → percorso openSpellWordMenu, NON openNormalMenuAt). I test
// esistenti coprivano gli <input> e iniettavano a mano il broadcast nativo.
// Qui facciamo un VERO click destro su una <textarea> con una parola italiana
// errata e ci affidiamo al correttore NATIVO reale di Electron: la correzione
// deve comparire in cima al menu, come faceva la vecchia estensione. Niente
// chiave LLM in test → l'unica fonte è il nativo, esattamente come per l'utente
// senza provider configurato.

import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><body style="margin:0">
  <textarea id="ta" lang="it" spellcheck="true"
    style="font:24px monospace;padding:10px;width:520px;height:140px"></textarea>
</body></html>`;

test('click destro reale su parola errata in textarea: correzione nativa in cima', async ({ app, openTab, testServer }) => {
  const url = testServer.html(PAGE);
  const page = await openTab(url);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoReady === '1',
    null, { timeout: 8000 },
  );

  // Salta se l'italiano non è disponibile nell'ambiente (CI senza dizionari):
  // senza dizionario il nativo non marca la parola e il test non avrebbe segnale.
  const itAvailable = await app.evaluate(({ session }) => {
    const ses = session.defaultSession;
    const avail = ses.availableSpellCheckerLanguages || [];
    return avail.some((l) => l.toLowerCase().startsWith('it'));
  });
  test.skip(!itAvailable, 'dizionario italiano non disponibile in questo ambiente');

  // Scrive una parola palesemente errata in italiano e mette il caret dentro.
  await page.evaluate(() => {
    const ta = document.getElementById('ta');
    ta.value = 'questa parolla';
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });

  // Dà tempo al correttore nativo di marcare la parola dopo il focus/typing.
  await page.waitForTimeout(600);

  // Click destro REALE sopra "parolla" (verso la fine della stringa).
  const box = await page.locator('#ta').boundingBox();
  await page.mouse.click(box.x + 230, box.y + 26, { button: 'right' });

  // Il menu Filo si apre.
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 4000 });

  // E la correzione deve comparire in cima (alimentata dal nativo reale).
  const correction = page.locator('.sn-menu .sn-menu-correction');
  await expect(correction).toBeVisible({ timeout: 4000 });
});
