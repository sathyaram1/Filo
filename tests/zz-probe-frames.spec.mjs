// TEMPORANEO — sonda: un riquadro incorporato NASCOSTO e senza script fa
// scattare l'avviso "tranne un riquadro incorporato" su una pagina tradotta
// per intero?
import { test, expect } from './fixtures/electron.mjs';

async function stub(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { gemini: 'k' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const P = globalThis.SN_PROVIDERS;
    const orig = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return orig(args);
      const i = prompt.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? prompt.slice(i + 'Testo:\n\n'.length) : '';
      const parts = chunk.split(/\n?@@@SN_SEP@@@\n?/);
      return { text: parts.map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n'), provider: 't', model: 't', usage: {} };
    };
  });
}

async function watch(page) {
  await page.evaluate(() => {
    window.__t = [];
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) {
      if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__t.push(n.textContent || '');
    } }).observe(document.documentElement, { childList: true, subtree: true });
  });
}

const CASES = {
  // Riquadro con lo script chiuso a chiave, ma FUORI dallo schermo.
  offscreen: 'style="position:absolute;left:-9999px;width:300px;height:200px" sandbox=""',
  // Riquadro con lo script chiuso a chiave, invisibile ma con un rettangolo.
  invisible: 'style="visibility:hidden;width:300px;height:200px" sandbox=""',
  // Riquadro con lo script chiuso a chiave, trasparente.
  transparent: 'style="opacity:0;width:300px;height:200px" sandbox=""',
  // Riquadro rimosso dal flusso: nessun rettangolo → deve essere ignorato.
  displayNone: 'style="display:none;width:300px;height:200px" sandbox=""',
  // Controllo: riquadro VISIBILE e chiuso a chiave → l'avviso ci deve essere.
  visible: 'style="width:300px;height:200px" sandbox=""',
};

for (const [name, attrs] of Object.entries(CASES)) {
  test(`frame ${name}`, async ({ app, openTab, testServer }) => {
    await stub(app);
    const html = `<!doctype html><html lang="en"><head><title>Tab</title></head><body style="font:16px sans-serif">
      <div id="a">A first block of English prose on the hosting page.</div>
      <div id="b">A second block, long enough to be a real unit of text.</div>
      <iframe id="f" ${attrs} srcdoc="<p>Locked away English text inside the frame.</p>"></iframe>
    </body></html>`;
    const page = await testServer.openReady(openTab, html);
    await watch(page);
    await page.locator('#a').first().click({ button: 'right', position: { x: 3, y: 3 } });
    const btn = page.locator('[data-sn-icon-id="translate"]');
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.locator('#a')).toHaveText(/^IT /);
    await expect.poll(async () => (await page.evaluate(() => window.__t || [])).length, { timeout: 15000 })
      .toBeGreaterThan(1);
    const t = (await page.evaluate(() => window.__t || [])).join(' | ');
    console.log(`FRAME ${name} :: ${t}`);
    expect(t.length).toBeGreaterThan(0);
  });
}
