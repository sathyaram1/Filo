import { test, expect } from '../../fixtures/electron.mjs';

async function stub(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__p = [];
    const orig = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return orig(args);
      const A = '<<<TESTO_IN_PAGINA>>>\n'; const Z = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(A); const f = prompt.lastIndexOf(Z);
      const chunk = i >= 0 && f > i ? prompt.slice(i + A.length, f) : '';
      globalThis.__p.push(chunk);
      return { text: chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n'), provider: 't', model: 't', usage: {} };
    };
  });
}
async function watch(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__toasts.push(n.textContent || ''); })
      .observe(document.documentElement, { childList: true, subtree: true });
  });
}
const toasts = async (page) => (await page.evaluate(() => window.__toasts || [])).join(' | ');
const sent = (app) => app.evaluate(() => (globalThis.__p || []).join('\n'));
async function clickTranslate(page) {
  await page.locator('#p1').click({ button: 'right', position: { x: 5, y: 5 } });
  const b = page.locator('[data-sn-icon-id="translate"]');
  await expect(b).toBeVisible();
  await b.click();
}
const inner = (t) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;margin:0;padding:10px"><p id="fbody">${t} an embedded box written in english and long enough to count as text.</p></body></html>`;
const pageOf = (frames, bodyStyle = '') => `<!doctype html><html lang="en"><body style="${bodyStyle}font:16px sans-serif;padding:20px">
  <h1 id="head">An article that carries a few embedded boxes around it</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up by the translation.</p>
  ${frames}
</body></html>`;
const box = 'width:300px;height:200px;border:0';

// Un riquadro visto solo attraverso una finestrella da un pixel è un francobollo come un riquadro da un pixel.
for (const [nome, html] of [
  ['ricetta per i lettori di schermo', (src) => `<div style="position:absolute;width:1px;height:1px;overflow:hidden;margin:-1px;clip:rect(0,0,0,0)"><iframe sandbox src="${src}" style="${box}"></iframe></div>`],
  ['contenitore da un pixel', (src) => `<div style="width:1px;height:1px;overflow:hidden"><iframe sandbox src="${src}" style="${box}"></iframe></div>`],
]) {
  test(`r1 riquadro chiuso a chiave ritagliato a un pixel (${nome}): «Pagina tradotta», nessun avviso`, async ({ app, openTab, testServer }) => {
    test.setTimeout(120000);
    await stub(app);
    const page = await testServer.openReady(openTab, pageOf(html(testServer.html(inner('ZZLOCK')))));
    await watch(page);
    await clickTranslate(page);
    await expect.poll(() => toasts(page), { timeout: 30000 }).toContain('Pagina tradotta');
    await page.waitForTimeout(2500);
    expect(await toasts(page)).not.toContain('riquadro incorporato');
  });
}

test('r1 riquadro con script ritagliato a un pixel: non si paga', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stub(app);
  const src = testServer.html(inner('ZZTINY')).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, pageOf(`<div style="width:1px;height:1px;overflow:hidden"><iframe src="${src}" style="${box}"></iframe></div>`));
  await page.waitForTimeout(1000);
  await watch(page);
  await clickTranslate(page);
  await expect.poll(() => toasts(page), { timeout: 30000 }).toContain('Pagina tradotta');
  await page.waitForTimeout(3000);
  expect(await sent(app)).not.toContain('ZZTINY');
});
