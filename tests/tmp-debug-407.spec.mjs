import { test, expect } from './fixtures/electron.mjs';

const PROMPT_HEAD = 'Traduci il seguente testo in italiano mantenendo struttura';

async function stubModel(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    globalThis.__vChunks = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => {
      const raw = messages[messages.length - 1]?.content;
      const content = typeof raw === 'string' ? raw : JSON.stringify(raw);
      if (content.indexOf('Traduci il seguente testo in italiano mantenendo struttura') !== 0) {
        return { text: '{}', model: 'm', provider: 'gemini', usage: {} };
      }
      const i = content.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? content.slice(i + 'Testo:\n\n'.length) : content;
      globalThis.__vChunks.push(chunk);
      const segs = chunk.split(/\n?@@@\s*SN_SEP\s*@@@\n?/);
      return { text: segs.map((s) => '‹IT› ' + s).join('\n@@@SN_SEP@@@\n'), model: 'm', provider: 'gemini', usage: {} };
    };
  });
}

const LABELS = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="h">The page heading in english</h1>
  <form id="f" action="/x">
    <input id="q" type="search" name="q" placeholder="Search the whole site" title="Type your query here">
    <input id="txt" type="text" name="city" value="Original value of the field">
    <input id="btn" type="button" value="Open the panel now">
    <input id="sub" type="submit" name="do" value="Send the form data">
    <select id="sel" name="country">
      <option id="o1" value="uk">United Kingdom of stuff</option>
      <option id="o2" value="it">Italy and other places</option>
    </select>
    <button id="b2" title="Click here to subscribe">Subscribe to the newsletter</button>
  </form>
  <img id="img" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
       alt="A dog running across a green field" title="Photo of a dog">
</body></html>`;

test('debug stato dopo traduzione', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await stubModel(app);
  const page = await testServer.openReady(openTab, LABELS);
  await page.locator('body').first().click({ button: 'right', position: { x: 5, y: 5 } });
  await page.locator('.sn-menu [data-sn-icon-id="translate"]').click();
  await page.waitForTimeout(4000);
  const st = await page.evaluate(() => {
    const T = globalThis.SN_TRANSLATE_PAGE;
    return {
      has: T.hasTranslation(), partial: T.isPartial(), newC: T.hasNewContent(),
      restore: T.showsRestore(), missing: T.missing(), total: T.total(),
      toasts: Array.from(document.querySelectorAll('.sn-toast')).map((t) => t.textContent),
    };
  });
  console.log('STATO:', JSON.stringify(st, null, 1));
  await page.locator('body').first().click({ button: 'right', position: { x: 5, y: 5 } });
  const lab = await page.locator('.sn-menu [data-sn-icon-id="translate"]').getAttribute('aria-label');
  console.log('ICONA:', lab);
  await page.keyboard.press('Escape');
  expect(1).toBe(1);
});
