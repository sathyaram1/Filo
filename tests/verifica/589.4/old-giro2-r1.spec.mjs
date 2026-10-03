// #589.4 giro 2, rilievo 1 — su un sito che blocca il tasto destro con un ascoltatore in cattura su window, il menu Incolla
// aperto dall'utente deve mostrare ancora la cronologia degli appunti.

import { test, expect } from '../../fixtures/electron.mjs';

const PASSWORD = 'Pw-segreta-5894!';

test('sito che blocca il tasto destro in cattura su window: il menu Incolla mostra ancora la cronologia', async ({ shell, openTab, testServer }) => {
  const r = await shell.evaluate((text) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text } }), PASSWORD);
  expect(r).toEqual({ ok: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px"><script>window.addEventListener('contextmenu', (e) => e.preventDefault(), true);</script><textarea id="ta" rows="5" cols="50"></textarea></body></html>`, { pubblico: true });
  await page.locator('#ta').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.locator('.sn-menu-paste-arrow').click();
  const sub = page.locator('.sn-menu-history-sub');
  await expect(sub).toBeVisible();
  await expect(sub).toContainText(PASSWORD);
});
