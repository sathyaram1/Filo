import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <p id="intro">A visible paragraph that every reader sees without clicking anything at all.</p>
  <div id="tanti"></div>
  <script>
    const c = document.getElementById('tanti');
    let h = '';
    for (let i = 0; i < 4000; i++) h += '<div style="max-height:0;overflow:hidden"><p>Collapsed section number ' + i + ' with a sentence of English prose inside it that nobody opened.</p></div>';
    c.innerHTML = h;
  </script>
</body></html>`;

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
      return { text: chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n'), provider: 'test', model: 't', usage: {} };
    };
  });
}

test('tempi e conteggio', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA);
  const apri = async () => {
    await page.locator('#intro').first().click({ button: 'right', position: { x: 5, y: 5 } });
    const b = page.locator('[data-sn-icon-id="translate"]');
    await expect(b).toBeVisible();
    return b;
  };
  await (await apri()).click();
  await expect(page.locator('#intro')).toHaveText(/^IT /, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');

  const spia = await page.evaluate(() => {
    const E = window.SN_EXTRACT;
    if (!E || typeof E.hasRevealedText !== 'function') return false;
    window.__conta = 0;
    const orig = E.hasRevealedText;
    E.hasRevealedText = function (...a) { window.__conta++; return orig.apply(this, a); };
    return true;
  });

  const tempi = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    await apri();
    tempi.push(Date.now() - t0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  const conta = await page.evaluate(() => window.__conta);
  console.log(['', '===SONDA===', 'spia installata: ' + spia, 'chiamate: ' + conta, 'tempi: ' + tempi.join(', '), '===FINE===', ''].join('\n'));
  expect(true).toBe(true);
});
