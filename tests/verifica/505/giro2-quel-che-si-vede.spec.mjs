// #505 giro 2, il rovescio — rimandare le sezioni ripiegate non deve lasciare
// in lingua originale del testo che l'utente sta GUARDANDO. Qui si prova il
// testo girato di novanta gradi (le etichette verticali sui lati, i nastrini
// d'angolo): sullo schermo si legge benissimo.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <p id="intro">A visible paragraph that every reader sees without clicking anything at all.</p>
  <div id="verticale" style="transform:rotate(90deg);transform-origin:left top;margin:60px 0 0 60px">
    Vertical side label that readers see turned ninety degrees on the page.
  </div>
  <div id="verticaleNeg" style="transform:rotate(-90deg);margin:80px 0 0 0">
    Another vertical label turned the other way round, equally readable.
  </div>
  <div id="ribaltato" style="transform:scale(-1,1);margin-top:60px">
    Mirrored text that is still painted on the screen at full size.
  </div>
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
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return origComplete(args);
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const chunk = i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '';
      return {
        text: chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n'),
        provider: 'test', model: 'test-translate', usage: {},
      };
    };
  });
}

test('il testo girato di lato resta tradotto: si vede, quindi si traduce', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#intro').click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();

  await expect(page.locator('#intro')).toHaveText(/^IT /, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/.shots/verifica-505-giro2-testo-girato.png', fullPage: true }).catch(() => {});

  const rimasti = await page.evaluate(() => ['verticale', 'verticaleNeg', 'ribaltato']
    .filter((id) => !/^\s*IT /.test(document.getElementById(id).textContent || '')));
  expect(rimasti, `testo visibile rimasto in lingua originale: ${rimasti.join(', ')}`).toEqual([]);
});
