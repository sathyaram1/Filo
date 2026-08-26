// Il caso "non fa nulla" più comune per un utente vero: il modello non è
// raggiungibile (nessuna chiave, chiave rifiutata, rete giù). Filo deve DIRLO.
import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:24px">
  <h1 id="t">An English headline</h1>
  <p id="p">A paragraph of English body text, long enough to be worth translating.</p>
</body></html>`;

async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__toasts.push(n.textContent || '');
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
}

async function openMenu(page, anchor) {
  const el = page.locator(anchor).first();
  await el.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  await el.click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  return btn;
}

test('nessuna chiave configurata: cosa vede l’utente', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: {} });
  });
  const page = await testServer.openReady(openTab, PAGE);
  await watchToasts(page);
  const btn = await openMenu(page, '#p');
  await btn.click();
  await page.waitForTimeout(9000);
  console.log('SENZA CHIAVE toast:', JSON.stringify(await page.evaluate(() => window.__toasts)));
  console.log('SENZA CHIAVE testo:', await page.locator('#t').textContent());
  const btn2 = await openMenu(page, '#p');
  console.log('SENZA CHIAVE etichetta dopo:', await btn2.getAttribute('aria-label'));
  await page.screenshot({ path: 'tests/.shots/407-senza-chiave.png' });
});

test('chiave rifiutata dal provider: cosa vede l’utente', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const P = globalThis.SN_PROVIDERS;
    const orig = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      if (String(last?.content || '').indexOf('@@@SN_SEP@@@') < 0) return orig(args);
      const e = new Error('API key not valid');
      e.code = 'AUTH';
      e.status = 401;
      throw e;
    };
  });
  const page = await testServer.openReady(openTab, PAGE);
  await watchToasts(page);
  const btn = await openMenu(page, '#p');
  await btn.click();
  await page.waitForTimeout(9000);
  console.log('CHIAVE KO toast:', JSON.stringify(await page.evaluate(() => window.__toasts)));
  const btn2 = await openMenu(page, '#p');
  console.log('CHIAVE KO etichetta dopo:', await btn2.getAttribute('aria-label'));
  await page.screenshot({ path: 'tests/.shots/407-chiave-ko.png' });
});
