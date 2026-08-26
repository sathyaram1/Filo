// Sonda: pagina con un riquadro incorporato (iframe) pieno di testo inglese.
import { test, expect } from './fixtures/electron.mjs';

const MARK = '‹IT›';

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

async function toastText(page) {
  return page.evaluate(() => {
    const all = document.querySelectorAll('.sn-toast:not([data-sn-closing])');
    const t = all[all.length - 1];
    return t ? t.textContent : null;
  });
}
const settled = async (page) => {
  const t = await toastText(page);
  return t && !/^Traduzione pagina/.test(t) ? t : null;
};

test('riquadro incorporato: cosa succede al suo testo', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await stubModel(app);
  const inner = testServer.html(`<!doctype html><html lang="en"><body style="padding:8px">
    <h2 id="ih">An embedded english heading</h2>
    <p id="ip">An embedded english paragraph with enough words to be a block.</p>
  </body></html>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="padding:20px">
    <h1 id="h">The outer heading in english</h1>
    <p id="p">The outer paragraph in english with enough words.</p>
    <iframe id="fr" src="${inner}" width="500" height="200"></iframe>
  </body></html>`);
  await page.waitForTimeout(1500);

  await page.locator('body').first().click({ button: 'right', position: { x: 5, y: 5 } });
  await page.locator('.sn-menu [data-sn-icon-id="translate"]').click();
  await expect.poll(() => settled(page), { timeout: 45_000 }).not.toBeNull();
  const toast = await settled(page);
  const outer = await page.evaluate(() => document.getElementById('h').innerText);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  const insideH = frame ? await frame.evaluate(() => document.getElementById('ih').innerText) : '(nessun frame)';
  const insideP = frame ? await frame.evaluate(() => document.getElementById('ip').innerText) : '(nessun frame)';
  console.log('TOAST:', JSON.stringify(toast));
  console.log('FUORI:', JSON.stringify(outer));
  console.log('DENTRO h:', JSON.stringify(insideH));
  console.log('DENTRO p:', JSON.stringify(insideP));
  await page.screenshot({ path: 'tests/.shots/tmp-iframe.png' });

  // Ora: tasto destro DENTRO il riquadro e clic su Traduci.
  const box = await page.locator('#fr').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 30, { button: 'right' });
  await page.waitForTimeout(800);
  const menus = await page.evaluate(() => document.querySelectorAll('.sn-menu').length);
  console.log('MENU nel top dopo destro dentro il riquadro:', menus);
  const inFrameMenu = frame ? await frame.evaluate(() => document.querySelectorAll('.sn-menu').length) : -1;
  console.log('MENU dentro il riquadro:', inFrameMenu);
  if (inFrameMenu > 0) {
    await frame.locator('.sn-menu [data-sn-icon-id="translate"]').click();
    await page.waitForTimeout(3000);
    console.log('DOPO clic dentro — DENTRO h:', JSON.stringify(await frame.evaluate(() => document.getElementById('ih').innerText)));
    console.log('DOPO clic dentro — TOAST:', JSON.stringify(await toastText(page)));
  }
  expect(1).toBe(1);
});
