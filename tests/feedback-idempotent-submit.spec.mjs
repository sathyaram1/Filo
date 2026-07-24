// #370 — anti-duplicati: ripremere "Invia" dopo un (falso) errore di invio NON
// deve creare un feedback duplicato. Il box assegna a una singola composizione un
// `submissionId` STABILE, che il server usa come chiave per deduplicare i
// re-invii identici. Se invece l'utente MODIFICA il contenuto, l'id cambia (è un
// messaggio diverso: deve poter essere inviato a parte).
//
// Asserisce IL SUCCESSO dell'invariante lato UI: due tentativi consecutivi dalla
// stessa bozza portano lo STESSO submissionId; dopo una modifica del testo, uno
// NUOVO. Il submit di rete è stubbato (il primo tentativo simula il timeout che
// tornava ok:false).
//
// Pre-condizione che renderebbe rosso il test senza il fix: prima non esisteva
// alcun submissionId → il payload non lo conteneva e ogni re-invio era un nuovo
// documento.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1',
    null,
    { timeout: 8_000 },
  );
  return win;
}

test('re-invio della stessa bozza → stesso submissionId; dopo una modifica → nuovo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  // Cattura i submissionId di ogni submit_feedback. Il PRIMO tentativo simula il
  // timeout storico (ok:false) → il box resta aperto e riabilita "Invia". I
  // successivi vanno a buon fine (ok:true) → il box si chiude.
  await page.evaluate(() => {
    window.__subIds = [];
    let calls = 0;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'submit_feedback') {
        window.__subIds.push(msg.payload && msg.payload.submissionId);
        calls += 1;
        // Primo invio: falso errore (come il vecchio timeout a 20s).
        if (calls === 1) return Promise.resolve({ ok: false, error: 'timeout (test)' });
        return Promise.resolve({ ok: true, id: 'test-fb' });
      }
      return orig(msg, ...rest);
    };
  });

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await page.locator('.sn-fb-text').fill('Feedback che va in timeout e viene ripetuto');

  // 1º invio → errore simulato, box ancora aperto.
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-status')).toContainText('Errore invio', { timeout: 6_000 });
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  // 2º invio della STESSA bozza → successo, box chiuso.
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 6_000 });

  const ids = await page.evaluate(() => window.__subIds);
  expect(ids.length, 'due tentativi di invio').toBe(2);
  expect(ids[0], 'submissionId presente').toBeTruthy();
  expect(ids[1], 'i re-invii identici condividono lo stesso id (dedup lato server)').toBe(ids[0]);

  // Ora una NUOVA composizione modificata: l'id deve cambiare.
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await page.locator('.sn-fb-text').fill('Un feedback diverso');
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 6_000 });

  const ids2 = await page.evaluate(() => window.__subIds);
  expect(ids2.length).toBe(3);
  expect(ids2[2], 'un messaggio diverso ha un submissionId nuovo').not.toBe(ids2[0]);
});
