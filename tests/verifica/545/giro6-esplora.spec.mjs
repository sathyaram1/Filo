// #545 giro 6: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

async function apri(openTab) {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
  return page;
}
async function modifica(page, on) {
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeVisible({ visible: on });
}
async function assegna(page, tipo, sc) {
  await page.locator(`.ed-module[data-type="${tipo}"]`).click();
  await page.fill('#cfgShortcut', sc);
  await page.click('#cfgSave');
  await page.waitForTimeout(150);
  const aperto = await page.locator('#cfgShortcut').count();
  const avviso = aperto ? await page.locator('#cfgShortcutTaken').innerText().catch(() => '') : '';
  const hint = aperto ? await page.locator('#cfgShortcutHint').isVisible().catch(() => false) : false;
  if (aperto) await page.click('#cfgCancel');
  return { salvata: !aperto, avviso, hint };
}
async function aggiungi(page, tipo) {
  await page.locator('.ed-cell-empty').first().click();
  await page.locator(`.ed-overlay [data-add="${tipo}"]`).click();
  await page.waitForSelector(`.ed-module[data-type="${tipo}"]`);
}
const stats = (page) => page.locator('#overlay h3', { hasText: 'Statistiche' });

test('nomi scritti delle combinazioni dell\'Editor', async ({ openTab }) => {
  const page = await apri(openTab);
  await aggiungi(page, 'search-replace');
  await modifica(page, true);
  const out = {};
  for (const sc of ['Cmd+S', 'Comando+S', 'ctrl + s', 'Ctrl+S ', 'Ctrl+\\', 'Ctrl+F', 'Cmd+F', 'Ctrl+Plus', 'Ctrl+=', 'Ctrl+_', 'Ctrl++', 'Ctrl+Shift+S', 'Ctrl+Alt+S', 'Ctrl+M', 'Ctrl+Q', 'Ctrl+Shift+I', 'Ctrl+Y', 'Ctrl+P', 'Ctrl+N', 'Ctrl+Shift+F', 'Ctrl-S', 'Ctrl S']) {
    out[sc] = await assegna(page, 'word-count', sc);
    if (out[sc].salvata) await assegna(page, 'word-count', '');
  }
  out['Ctrl+F su cerca'] = await assegna(page, 'search-replace', 'Ctrl+F');
  console.log(JSON.stringify(out, null, 1));
  await modifica(page, false);
  await page.click('#doc');
  await page.keyboard.press('Control+f');
  const focus = await page.evaluate(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.sr);
  console.log('Ctrl+F focus su', focus);
});

test('Ctrl+F salvata prima del modulo Cerca', async ({ openTab }) => {
  const page = await apri(openTab);
  await modifica(page, true);
  const r = await assegna(page, 'word-count', 'Ctrl+F');
  console.log('Ctrl+F senza cerca', JSON.stringify(r));
  await modifica(page, false);
  await page.click('#doc');
  await page.keyboard.press('Control+f');
  console.log('stats prima', await stats(page).count());
  if (await stats(page).count()) { await page.keyboard.press('Escape'); }
  await aggiungi(page, 'search-replace');
  await page.click('#doc');
  await page.keyboard.press('Control+f');
  await page.waitForTimeout(200);
  console.log('stats dopo aver aggiunto Cerca', await stats(page).count());
  const focus = await page.evaluate(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.sr);
  console.log('focus dopo', focus);
  await page.keyboard.press('Escape');
  await modifica(page, true);
  await page.locator('.ed-module[data-type="word-count"]').click();
  console.log('avviso alla riapertura', await page.locator('#cfgShortcutTaken').isVisible(), await page.locator('#cfgShortcutTaken').innerText());
  await page.screenshot({ path: 'tests/.shots/g6-riapertura.png' });
});

test('Ctrl+M su Linux', async ({ openTab, app }) => {
  const page = await apri(openTab);
  await modifica(page, true);
  const r = await assegna(page, 'word-count', 'Ctrl+M');
  console.log('Ctrl+M', JSON.stringify(r));
  await modifica(page, false);
  await page.click('#doc');
  await page.keyboard.press('Control+m');
  await page.waitForTimeout(400);
  const min = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => [w.isMinimized(), w.isVisible()]));
  console.log('stats', await stats(page).count(), 'finestre', JSON.stringify(min));
});

test('Ctrl+Z senza scorciatoia dopo il clic su un modulo', async ({ openTab, shell, app }) => {
  const page = await apri(openTab);
  await page.click('#doc');
  await page.keyboard.type('prima parola', { delay: 20 });
  await page.waitForTimeout(600);
  await page.locator('.ed-module[data-type="word-count"]').click();
  await expect(stats(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(stats(page)).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  console.log('dopo Ctrl+Z', page.url(), JSON.stringify(await page.locator('#doc').innerText()));
});

test('pannello aperto: Esc e combinazioni', async ({ openTab }) => {
  const page = await apri(openTab);
  await modifica(page, true);
  await assegna(page, 'word-count', 'Ctrl+Shift+1');
  await page.locator('.ed-module[data-type="comment"]').click();
  await page.click('#cfgShortcut');
  const prima = await page.locator('#root').getAttribute('class');
  await page.keyboard.press('Control+Shift+1');
  await page.keyboard.press('Control+Backslash');
  await page.keyboard.press('Control+s');
  console.log('pannello ancora', await page.locator('#cfgShortcut').count(), 'stats', await stats(page).count(), 'sidebar uguale', prima === await page.locator('#root').getAttribute('class'), 'campo', JSON.stringify(await page.locator('#cfgShortcut').inputValue()));
  await page.keyboard.press('Escape');
  console.log('dopo Esc pannello', await page.locator('#cfgShortcut').count());
});
