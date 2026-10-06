// Verifica #503 giro 2, rilievo 1: un riquadro con script che sta da solo in una sezione nascosta del tutto
// (scheda chiusa) non si paga a sezione chiusa, e aperta la sezione il menu deve offrire di tradurlo.
import { test, expect } from '../../fixtures/electron.mjs';

async function stubTranslationProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__filoTranslatePrompts = [];
    const origComplete = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const { messages } = args;
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return origComplete(args);
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const chunk = i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '';
      const SEP = '\n@@@SN_SEP@@@\n';
      const parts = chunk.split(/\n?@@@SN_SEP@@@\n?/);
      globalThis.__filoTranslatePrompts.push(chunk);
      return { text: parts.map((p) => `IT ${p}`).join(SEP), provider: 'test', model: 'test-translate', usage: {} };
    };
  });
}

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
const toasts = async (page) => (await page.evaluate(() => window.__toasts || [])).join(' | ');
const sent = (app) => app.evaluate(() => (globalThis.__filoTranslatePrompts || []).join('\n'));

async function clickTranslateIcon(page, anchor) {
  await page.locator(anchor).first().click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
}

const INNER = (tag) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;margin:0;padding:10px">
  <p id="fbody">${tag} an advertising slot written in english and long enough to count as text.</p>
</body></html>`;

const pagina = (frames) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">An article that carries a few embedded boxes around it</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up by the translation.</p>
  ${frames}
</body></html>`;

// Pagina tradotta, nessun avviso sul riquadro: aspetta l'esito finale.
async function esito(page) {
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(() => toasts(page), { timeout: 60000 }).toMatch(/Pagina tradotta/);
  return toasts(page);
}


test('r1 scheda nascosta con solo un riquadro con script: aperta, si offre e si traduce', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const src = testServer.html(INNER('ZZTAB')).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, pagina(`<div id="tab" hidden><iframe id="emb" src="${src}" style="width:520px;height:220px"></iframe></div>`));
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');
  const t = await esito(page);
  expect(t).not.toContain('riquadro incorporato');
  await page.waitForTimeout(3000);
  expect(await sent(app)).not.toContain('ZZTAB');
  await page.evaluate(() => { document.getElementById('tab').hidden = false; });
  await page.waitForTimeout(300);
  await page.locator('#p1').click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toHaveAttribute('aria-label', 'Traduci il testo nuovo');
  await btn.click();
  await expect(page.frameLocator('#emb').locator('#fbody')).toHaveText(/^IT /, { timeout: 60000 });
});

