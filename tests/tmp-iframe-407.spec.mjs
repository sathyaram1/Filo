// Sonda: il titolo della scheda dopo la traduzione.
import { test, expect } from './fixtures/electron.mjs';

async function stubModel(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => {
      const raw = messages[messages.length - 1]?.content;
      const content = typeof raw === 'string' ? raw : JSON.stringify(raw);
      if (content.indexOf('Traduci il seguente testo in italiano mantenendo struttura') !== 0) {
        return { text: '{}', model: 'm', provider: 'gemini', usage: {} };
      }
      const i = content.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? content.slice(i + 'Testo:\n\n'.length) : content;
      const segs = chunk.split(/\n?@@@\s*SN_SEP\s*@@@\n?/);
      return { text: segs.map((s) => '‹IT› ' + s).join('\n@@@SN_SEP@@@\n'), model: 'm', provider: 'gemini', usage: {} };
    };
  });
}

test('titolo della scheda dopo la traduzione', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await stubModel(app);
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en">
    <head><title>Breaking news from the capital city</title></head>
    <body style="padding:20px"><h1 id="h">Breaking news from the capital city</h1>
    <p id="p">The first paragraph of the article, written in english.</p></body></html>`);
  await page.locator('body').first().click({ button: 'right', position: { x: 5, y: 5 } });
  await page.locator('.sn-menu [data-sn-icon-id="translate"]').click();
  await page.waitForTimeout(4000);
  console.log('H1:', JSON.stringify(await page.evaluate(() => document.getElementById('h').innerText)));
  console.log('TITLE:', JSON.stringify(await page.evaluate(() => document.title)));
  const tabs = await shell.evaluate(() => Array.from(document.querySelectorAll('.tab-title, .tab .title, [class*="tab"] [class*="title"]')).map((e) => e.textContent));
  console.log('SCHEDE:', JSON.stringify(tabs));
  expect(1).toBe(1);
});
