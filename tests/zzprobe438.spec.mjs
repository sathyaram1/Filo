import { test, expect } from './fixtures/electron.mjs';

test('probe: lingue del correttore nativo + evento context-menu', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const info = await app.evaluate(async ({ session, app: a }) => {
    const ses = session.defaultSession;
    return {
      available: (ses.availableSpellCheckerLanguages || []).slice(0, 20),
      current: ses.getSpellCheckerLanguages ? ses.getSpellCheckerLanguages() : null,
      enabled: ses.isSpellCheckerEnabled ? ses.isSpellCheckerEnabled() : null,
      locale: a.getLocale(),
    };
  });
  console.log('PROBE', JSON.stringify(info));

  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px">
    <div id="ed" contenteditable="true" spellcheck="true" style="border:1px solid #999;min-height:60px;padding:8px;font:18px sans-serif"></div>
  </body>`);

  // Cattura i broadcast nativi in pagina
  await page.evaluate(() => {
    globalThis.__nat = [];
    globalThis.chrome.runtime.onMessage._listeners.push((m) => {
      if (m && m.type === '_spell:native') globalThis.__nat.push(m);
    });
  });

  for (const txt of ['wrlod ciao', 'ciiao come stai', 'helo world']) {
    await page.evaluate(() => { const e = document.getElementById('ed'); e.textContent = ''; e.focus(); });
    await page.keyboard.type(txt, { delay: 20 });
    await page.waitForTimeout(1000);
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
    const nat = await page.evaluate(() => { const a = globalThis.__nat.slice(); globalThis.__nat.length = 0; return a; });
    console.log('TXT', txt, '=> NATIVE', JSON.stringify(nat));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  expect(true).toBe(true);
});
