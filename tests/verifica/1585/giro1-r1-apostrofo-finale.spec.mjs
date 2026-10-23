// Verifica #1585, rilievo 1: le parole italiane giuste che finiscono con l'apostrofo (imperativi, troncamenti) non
// devono avere il segno d'errore, come col dizionario del browser, che l'apostrofo finale non lo guarda.

import { test, expect } from '../../fixtures/electron.mjs';

test('r1 «di\'», «fa\'», «va\'», «sta\'», «be\'» col modello spento non hanno il segno', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false },
    });
  });
  await expect.poll(() => app.evaluate(() => globalThis.__filoDizionarioDiFilo.stato().fase), { timeout: 20_000 }).toBe('pronto');

  const url = testServer.html(`<!doctype html><meta charset="utf-8"><body style="margin:0">
    <textarea id="ta" lang="it" style="display:block;width:900px;height:160px;font:22px monospace"></textarea>
  </body>`);
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#ta').click();
  // «andatto» c'è perché il correttore abbia di sicuro guardato il testo: il suo segno arriva, gli altri no.
  await page.keyboard.type("di' la verità, fa' attenzione, va' via, sta' zitto, be' sono andatto ");
  const segni = page.locator('.sn-spell-overlay .sn-errore');
  await expect(segni.filter({ hasText: 'andatto' })).toHaveCount(1, { timeout: 5000 });
  const segnati = await segni.allTextContents();
  expect(segnati).toEqual(['andatto']);
});
