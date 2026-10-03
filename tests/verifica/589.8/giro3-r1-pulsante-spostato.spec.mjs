// #589.8 giro 3 — a menu aperto dall'utente, il sito sposta Incolla (o la freccia) fuori dal menu, nel suo
// documento, e lo preme da script: il filtro dei gesti finti sta sulla radice del menu, e fuori da lì non c'è più.
// Successo per l'utente: il sito non incolla da sé gli appunti nel suo campo, né apre la cronologia.

import { test, expect } from '../../fixtures/electron.mjs';
import { statoCronologia } from '../../helpers/cronologiaAppunti.mjs';

const SEGRETO = 'pw-Segreta-589-otto';

const PAGINA = `<!doctype html><html><body style="padding:40px">
  <input id="campo" style="width:320px;font-size:16px">
  <script>
  window.sposta = (sel) => {
    const b = document.querySelector(sel);
    if (!b) return false;
    document.body.appendChild(b);
    b.click();
    return true;
  };
  </script>
</body></html>`;

test('il sito non preme Incolla spostandolo fuori dal menu che l\'utente ha aperto', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate((t) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text: t } }), SEGRETO);
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');

  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu-paste-main')).toBeVisible();
  expect(await page.evaluate(() => window.sposta('.sn-menu-paste-main'))).toBe(true);
  await page.waitForTimeout(1500);
  expect(await page.locator('#campo').inputValue(), 'il sito non deve incollarsi gli appunti da solo').not.toContain(SEGRETO);
});

test('il sito non apre la cronologia spostando la freccia fuori dal menu che l\'utente ha aperto', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate((t) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text: t } }), SEGRETO);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');

  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu-paste-arrow')).toBeVisible();
  expect(await page.evaluate(() => window.sposta('.sn-menu-paste-arrow'))).toBe(true);
  await page.waitForTimeout(800);
  expect(await statoCronologia(app, page), 'la freccia premuta dal sito non apre la cronologia').toBeNull();
});

test('il sito non avvia la dettatura spostando Detta fuori dal menu che l\'utente ha aperto', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');

  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu-split-main').first()).toBeVisible();
  const tutto = () => page.evaluate(() => {
    let t = document.documentElement.innerText || '';
    for (const el of document.querySelectorAll('*')) if (el.shadowRoot) t += ' ' + el.shadowRoot.textContent;
    return t;
  });
  expect(await page.evaluate(() => window.sposta('.sn-menu-split-main'))).toBe(true);
  await page.waitForTimeout(1500);
  const visto = await tutto();
  console.log('dopo Detta premuto dal sito:', JSON.stringify(visto.slice(0, 300)));
  expect(visto, 'il sito non deve accendere il microfono da solo').not.toMatch(/Ti ascolto|Microfono/);
});
