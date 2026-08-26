// Sonda: tasto destro DENTRO un riquadro incorporato, su una pagina non ancora
// tradotta. Cosa cambia e cosa dice Filo?
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

test('tasto destro dentro il riquadro, pagina non tradotta', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await stubModel(app);
  const inner = testServer.html(`<!doctype html><html lang="en"><body style="padding:8px">
    <h2 id="ih">An embedded english heading</h2>
    <p id="ip">An embedded english paragraph with enough words to be a block.</p>
  </body></html>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="padding:20px">
    <h1 id="h">The outer heading in english</h1>
    <iframe id="fr" src="${inner}" width="500" height="200"></iframe>
  </body></html>`);
  await page.waitForTimeout(1500);
  const frame = page.frames().find((f) => f !== page.mainFrame());

  const box = await page.locator('#fr').boundingBox();
  await page.mouse.click(box.x + 40, box.y + 20, { button: 'right' });
  await page.waitForTimeout(800);
  const label = await frame.locator('.sn-menu [data-sn-icon-id="translate"]').getAttribute('aria-label');
  console.log('ETICHETTA icona nel riquadro:', JSON.stringify(label));
  await frame.locator('.sn-menu [data-sn-icon-id="translate"]').click();

  const seen = [];
  for (let i = 0; i < 20; i++) {
    const t = await page.evaluate(() => Array.from(
      document.querySelectorAll('.sn-toast')).map((x) => x.textContent));
    const ft = await frame.evaluate(() => Array.from(
      document.querySelectorAll('.sn-toast')).map((x) => x.textContent));
    for (const x of t) if (!seen.includes('top:' + x)) seen.push('top:' + x);
    for (const x of ft) if (!seen.includes('frame:' + x)) seen.push('frame:' + x);
    await page.waitForTimeout(300);
  }
  console.log('AVVISI VISTI:', JSON.stringify(seen));
  console.log('FUORI:', JSON.stringify(await page.evaluate(() => document.getElementById('h').innerText)));
  console.log('DENTRO:', JSON.stringify(await frame.evaluate(() => document.getElementById('ih').innerText)));
  console.log('CHIAMATE:', await app.evaluate(() => globalThis.__vChunks.length));
  await page.screenshot({ path: 'tests/.shots/tmp-iframe2.png' });
  expect(1).toBe(1);
});
