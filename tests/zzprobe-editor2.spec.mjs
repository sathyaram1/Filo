// PROBE temporaneo (audit prober): ripristino versione vs conversazione chat.
import { test, expect } from './fixtures/electron.mjs';

async function setDocText(page, text) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

test('probe B: ripristinare una versione cancella la chat del documento?', async ({ openTab }) => {
  test.setTimeout(120000);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-module[data-type="switch"]');
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('.ed-module[data-type="chat"]');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  // 1) Testo iniziale lungo + snapshot manuale (la "vecchia versione").
  await setDocText(page, "C'era una volta, in un bosco fitto e silenzioso, una bambina che portava sempre un mantello rosso cucito dalla nonna, e ogni mattina attraversava il sentiero.");
  const v = await page.evaluate(() => window.__filoEditorVersions.snapshotManual());
  console.log('PROBE versione creata:', !!v);

  // 2) Conversazione con Filo dentro il documento (risposta del modello stubbata).
  await page.evaluate(() => {
    window.chrome.runtime.sendMessage = (msg, cb) => {
      const resp = { ok: true, text: 'Certo, ecco il mio parere sul racconto.' };
      if (typeof cb === 'function') { Promise.resolve().then(() => cb(resp)); return undefined; }
      return Promise.resolve(resp);
    };
  });
  const input = page.locator('.ed-module[data-type="chat"] [data-chat="input"]');
  await input.click();
  await input.fill('che ne pensi del racconto?');
  await input.press('Enter');
  await page.waitForTimeout(800);
  const msgsBefore = await page.locator('.ed-chat-msg').allTextContents();
  console.log('PROBE messaggi chat PRIMA:', JSON.stringify(msgsBefore));

  // 3) L'utente continua a scrivere e poi ripristina la versione vecchia.
  await setDocText(page, 'Testo completamente riscritto dopo la chiacchierata con Filo.');
  await page.evaluate(() => {
    const V = window.__filoEditorVersions;
    const l = V.list();
    V.restore(V.activeId(), l[0].id);
  });
  await page.waitForTimeout(600);
  // torna sulla pagina con la chat (il ripristino ricarica la vista)
  await page.locator('.ed-switch-icon').nth(1).click().catch(() => {});
  await page.waitForTimeout(400);
  const msgsAfter = await page.locator('.ed-chat-msg').allTextContents();
  console.log('PROBE messaggi chat DOPO ripristino:', JSON.stringify(msgsAfter));
  await page.screenshot({ path: 'tests/.shots/probe-chat-after-restore.png' });
});
