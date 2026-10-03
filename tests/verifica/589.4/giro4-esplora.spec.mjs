// #589.4 giro 4 — esplorazione: le scritture fatte dall'utente dal menu (copia, togli una voce) arrivano ancora alla
// cronologia, anche dentro un riquadro di un altro sito; il tasto Menu della tastiera su un sito che annulla il destro.
import { test, expect } from '../../fixtures/electron.mjs';

const PASSWORD = 'Pw-segreta-5894!';
const CAMPO = '<!doctype html><html><body style="padding:40px"><p id="p">testo da copiare quarantadue</p><textarea id="ta" rows="5" cols="50"></textarea></body></html>';
const BLOCCA = "<script>window.addEventListener('contextmenu', (e) => e.preventDefault(), true);</script></body>";

async function storia(shell) {
  const r = await shell.evaluate(() => window.filoShell.message({ type: 'get_clipboard_history' }));
  return JSON.stringify(r.items || []);
}

async function copiaDalMenu(dove) {
  await dove.locator('#p').dblclick();
  await dove.locator('#p').click({ button: 'right' });
  await expect(dove.locator('.sn-menu')).toBeVisible();
  await dove.locator('.sn-menu .sn-menu-item', { hasText: /^Copia$/ }).first().click();
}

test('Copia dal menu su un sito: la voce entra nella cronologia', async ({ shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, CAMPO, { pubblico: true });
  await copiaDalMenu(page);
  await expect.poll(() => storia(shell)).toContain('quarantadue');
});

test('Copia dal menu dentro il riquadro di un altro sito: la voce entra nella cronologia', async ({ shell, openTab, testServer }) => {
  const dentro = testServer.html(CAMPO).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab,
    `<!doctype html><html><body style="margin:0;padding:12px"><iframe id="embed" src="${dentro}" width="640" height="460"></iframe></body></html>`);
  await copiaDalMenu(page.frameLocator('#embed'));
  await expect.poll(() => storia(shell)).toContain('quarantadue');
});

test('togliere una voce dal menu Incolla dentro un riquadro di un altro sito la toglie davvero', async ({ shell, openTab, testServer }) => {
  await shell.evaluate((text) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text } }), PASSWORD);
  const dentro = testServer.html(CAMPO).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab,
    `<!doctype html><html><body style="margin:0;padding:12px"><iframe id="embed" src="${dentro}" width="640" height="460"></iframe></body></html>`);
  const fl = page.frameLocator('#embed');
  await fl.locator('#ta').click({ button: 'right' });
  await fl.locator('.sn-menu-paste-arrow').click();
  const riga = fl.locator('.sn-menu-history-item', { hasText: PASSWORD });
  await expect(riga).toBeVisible();
  await riga.hover();
  await riga.locator('.sn-menu-history-remove').click();
  await expect.poll(() => storia(shell)).not.toContain(PASSWORD);
});

test('sito che annulla il tasto destro: il tasto Menu della tastiera mostra la cronologia', async ({ shell, openTab, testServer }) => {
  await shell.evaluate((text) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text } }), PASSWORD);
  const page = await testServer.openReady(openTab, CAMPO.replace('</body>', BLOCCA), { pubblico: true });
  await page.locator('#ta').click();
  await page.keyboard.press('ContextMenu');
  await expect(page.locator('.sn-menu[role=menu]')).toBeVisible();
  await page.locator('.sn-menu-paste-arrow').click();
  await expect(page.locator('.sn-menu-history-sub')).toContainText(PASSWORD);
});
