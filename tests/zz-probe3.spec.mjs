// SONDA 3 di verifica #439 — quanto è comune il falso "solo in parte"?
// Da cancellare a fine giro.
//
// Il browser stesso costruisce certi elementi con un componente chiuso proprio
// (i comandi di un video, di un audio, di un cursore a scorrimento). Se
// l'euristica che riconosce "qui dentro non riesco a leggere" li conta, allora
// una pagina qualunque con un video dentro si sente dire "tradotta solo in
// parte" pur essendo stata tradotta tutta.

import { test, expect } from './fixtures/electron.mjs';

const WITH_VIDEO = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="title">An ordinary news article that happens to embed a video</h1>
  <video id="v" width="640" height="360" controls></video>
  <p id="p1">The first paragraph of the article, entirely readable by any script on the page.</p>
  <p id="p2">The second paragraph of the article, just as readable as the first one is.</p>
</body></html>`;

const WITH_MEDIA_MIX = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="title">A page with the usual assortment of media controls on it</h1>
  <audio id="a" controls></audio>
  <input id="r" type="range" style="width:300px">
  <p id="p1">The only paragraph here, and it is perfectly readable from the outside.</p>
</body></html>`;

async function stubTranslationProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const P = globalThis.SN_PROVIDERS;
    const origComplete = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const { messages } = args;
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return origComplete(args);
      const i = prompt.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? prompt.slice(i + 'Testo:\n\n'.length) : '';
      const SEP = '\n@@@SN_SEP@@@\n';
      return {
        text: chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join(SEP),
        provider: 'test', model: 'test-translate', usage: {},
      };
    };
  });
}

async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) {
            window.__toasts.push(n.textContent || '');
          }
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  });
}

const toasts = (page) => page.evaluate(() => window.__toasts || []);

async function clickTranslateIcon(page, anchor = 'body') {
  await page.locator(anchor).first().click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
}

test('#439 un articolo con un video dentro resta "Pagina tradotta"', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, WITH_VIDEO);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');

  await expect(page.locator('#title')).toHaveText(/^IT /);
  await expect(page.locator('#p1')).toHaveText(/^IT /);
  await expect(page.locator('#p2')).toHaveText(/^IT /);

  const t = await toasts(page);
  expect(t.join(' | ')).not.toContain('solo in parte');
  expect(t).toContain('Pagina tradotta');
});

test('#439 audio e cursori non fanno scattare "solo in parte"', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, WITH_MEDIA_MIX);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');

  await expect(page.locator('#title')).toHaveText(/^IT /);
  await expect(page.locator('#p1')).toHaveText(/^IT /);

  const t = await toasts(page);
  expect(t.join(' | ')).not.toContain('solo in parte');
  expect(t).toContain('Pagina tradotta');
});
