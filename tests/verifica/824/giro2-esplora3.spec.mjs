// #824 giro 2: «Incolla» del tasto destro di Filo.

import { test, expect } from '../../fixtures/electron.mjs';

async function apriEsatta(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

const moduloDi = (shell, title) => shell.evaluate(async (t) => {
  const s = await window.filoShell.tabs.snapshot();
  const tab = s.tabs.find((x) => x.title === t);
  return tab ? tab.formDirty : null;
}, title);

const EDITOR = {
  ricco: `<div id="ed" contenteditable="true" style="min-height:80px;border:1px solid"></div>
    <script>ed.addEventListener('paste', (e) => { e.preventDefault(); const p = document.createElement('p'); p.textContent = e.clipboardData.getData('text/plain'); ed.appendChild(p); });</script>`,
  textarea: '<textarea id="ed"></textarea>',
};

for (const [nome, corpo] of Object.entries(EDITOR)) {
  test(`Incolla di Filo in ${nome}`, async ({ app, shell, testServer }) => {
    const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>I</title></head><body>${corpo}</body></html>`));
    const TESTO = 'Bozza incollata dal menu di Filo';
    await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), TESTO);
    await page.locator('#ed').click();
    await page.locator('#ed').click({ button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible();
    const voce = page.locator('.sn-menu').getByText('Incolla', { exact: true }).first();
    await voce.click();
    await expect.poll(() => page.locator('#ed').evaluate((e) => e.value ?? e.textContent), { timeout: 5000 }).toContain(TESTO);
    await page.waitForTimeout(1200);
    console.log('INCOLLA', nome, 'formDirty', await moduloDi(shell, 'I'));
  });
}
