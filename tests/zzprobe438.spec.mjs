import { test, expect } from './fixtures/electron.mjs';

test('probe: il correttore nativo marca la parola?', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const info = await app.evaluate(async ({ session, app: a }) => ({
    current: session.defaultSession.getSpellCheckerLanguages(),
    locale: a.getLocale(),
  }));
  console.log('PROBE', JSON.stringify(info));

  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px">
    <div id="ed" contenteditable="true" spellcheck="true" style="border:1px solid #999;min-height:60px;padding:8px;font:18px sans-serif"></div>
  </body>`);

  await app.evaluate(({ webContents }) => {
    globalThis.__ctx = [];
    for (const wc of webContents.getAllWebContents()) {
      wc.on('context-menu', (_e, p) => {
        globalThis.__ctx.push({
          url: (wc.getURL() || '').slice(0, 40),
          mis: p.misspelledWord,
          sug: p.dictionarySuggestions,
          editable: p.isEditable,
          sel: p.selectionText,
        });
      });
    }
  });

  for (const txt of ['wrlod ciao', 'ciiao come stai', 'helo world', 'funzionaaa bene']) {
    await page.evaluate(() => { const e = document.getElementById('ed'); e.textContent = ''; e.focus(); });
    await page.keyboard.type(txt, { delay: 25 });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const ed = document.getElementById('ed');
      const node = ed.firstChild;
      const m = /\S+/.exec(node.data);
      const rg = document.createRange();
      rg.setStart(node, m.index); rg.setEnd(node, m.index + m[0].length);
      const b = rg.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await page.mouse.click(r.x, r.y, { button: 'right' });
    await page.waitForTimeout(1500);
    const ctx = await app.evaluate(() => { const a = globalThis.__ctx.slice(); globalThis.__ctx.length = 0; return a; });
    const menu = await page.evaluate(() => {
      const m = document.querySelector('.sn-menu');
      if (!m || m.style.display === 'none') return null;
      return Array.from(m.children)
        .filter((c) => !c.classList.contains('sn-menu-sep') && c.style.display !== 'none')
        .map((c) => (c.querySelector('.sn-menu-label')?.textContent || c.textContent).trim());
    });
    console.log('TXT', JSON.stringify(txt), 'CTX', JSON.stringify(ctx), 'MENU', JSON.stringify(menu));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  expect(true).toBe(true);
});
