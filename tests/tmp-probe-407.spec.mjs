// Cattura visiva: l'avviso più lungo introdotto dal lavoro e il menu nei suoi
// stati nuovi, in tema chiaro e in tema scuro.
import { test, expect } from './fixtures/electron.mjs';

async function stub(app, theme) {
  await app.evaluate(async (_e, th) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      theme: th,
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
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
      const SEP = '\n@@@SN_SEP@@@\n';
      return {
        text: chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join(SEP),
        provider: 'test', model: 'test-translate', usage: {},
      };
    };
  }, theme);
}

const PAGE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:24px;max-width:640px">
  <h1 id="t">The end of an era in European football</h1>
  <div id="s">A short standfirst explaining what this article is about.</div>
  <p id="p1">First paragraph of the body text, long enough to be picked up by the extractor.</p>
  <figure><figcaption id="cap">The stadium on the last day of the season</figcaption></figure>
  <aside><h3 id="rel">Read also</h3><ul><li><a id="rl" href="#y">Another English headline</a></li></ul></aside>
</body></html>`;

async function openMenu(page, anchor) {
  const el = page.locator(anchor).first();
  await el.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  await el.click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  return btn;
}

for (const theme of ['light', 'dark']) {
  test(`resa visiva tema ${theme}`, async ({ app, openTab, testServer }) => {
    await stub(app, theme);
    const page = await testServer.openReady(openTab, PAGE);

    // 1. Avviso di fine lavoro, quello lungo: il sito ha aggiunto testo dopo.
    const btn = await openMenu(page, '#p1');
    console.log(`[${theme}] etichetta iniziale:`, await btn.getAttribute('aria-label'));
    await btn.click();
    await expect(page.locator('#t')).toHaveText(/^IT /);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/407-tema-${theme}-tradotta.png` });

    // 2. Il sito aggiunge testo DOPO: l'avviso lungo e il menu che offre di
    //    prenderlo, con "Mostra originale" ancora raggiungibile.
    await page.evaluate(() => {
      const d = document.createElement('p');
      d.id = 'later';
      d.textContent = 'A paragraph that the site added after the translation had finished.';
      document.body.appendChild(d);
    });
    await page.waitForTimeout(400);
    const btn2 = await openMenu(page, '#p1');
    console.log(`[${theme}] etichetta con testo nuovo:`, await btn2.getAttribute('aria-label'));
    const items = await page.evaluate(() => Array.from(document.querySelectorAll('.sn-menu-item, [class*="sn-menu"] button'))
      .map((b) => (b.textContent || b.getAttribute('aria-label') || '').trim()).filter(Boolean));
    console.log(`[${theme}] voci menu:`, JSON.stringify(items));
    await page.screenshot({ path: `tests/.shots/407-tema-${theme}-menu-testo-nuovo.png` });
    await page.keyboard.press('Escape');

    // 3. L'avviso lungo, catturato mentre è in vista.
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.className = 'sn-toasts';
      document.body.appendChild(box);
    });
    await page.waitForTimeout(200);
  });
}
